const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

export function createStoredZip(entries: ZipEntry[]): Blob {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/\\/g, "/"));
    const bytes = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0);
    write32(localView, 14, crc);
    write32(localView, 18, bytes.length);
    write32(localView, 22, bytes.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0);
    write32(centralView, 16, crc);
    write32(centralView, 20, bytes.length);
    write32(centralView, 24, bytes.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + bytes.length;
  }

  const centralDirectory = concat(centralParts);
  const localFiles = concat(localParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, localFiles.length);
  write16(endView, 20, 0);
  const archive = concat([localFiles, centralDirectory, end]);
  const blobBytes = new ArrayBuffer(archive.byteLength);
  new Uint8Array(blobBytes).set(archive);
  return new Blob([blobBytes], { type: "application/zip" });
}

export function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50 || offset + 30 > bytes.length) {
      throw new Error("This ZIP is not a MeowEdit stored archive.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 30);
    const compression = view.getUint16(8, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    if (compression !== 0) {
      throw new Error("Only uncompressed MeowEdit ZIP packages can be imported in this version.");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error("The ZIP package is incomplete.");
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, bytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }
  if (files.size === 0) throw new Error("No files were found in this ZIP package.");
  return files;
}
