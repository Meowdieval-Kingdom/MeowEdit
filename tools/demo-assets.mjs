import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const DEMO_ASSET_MANIFEST = "demo-assets.manifest.json";
export const DEMO_WATERMARK_LABEL = "DEMO";
export const RASTER_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"
]);

export async function findRasterAssets(publicDir) {
  const results = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && RASTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(path.relative(publicDir, absolutePath).split(path.sep).join("/"));
      }
    }
  }

  await visit(publicDir);
  return results.sort((left, right) => left.localeCompare(right));
}

export async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function createDemoAssetManifest(publicDir) {
  const assets = await findRasterAssets(publicDir);
  const files = {};
  for (const relativePath of assets) {
    files[relativePath] = await sha256File(path.join(publicDir, relativePath));
  }
  return {
    schemaVersion: 1,
    watermark: DEMO_WATERMARK_LABEL,
    files
  };
}

export async function verifyDemoAssets(publicDir, manifestPath = path.join(publicDir, DEMO_ASSET_MANIFEST)) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`Could not read demo asset manifest: ${error.message}`] };
  }

  if (manifest.schemaVersion !== 1 || manifest.watermark !== DEMO_WATERMARK_LABEL
    || typeof manifest.files !== "object" || manifest.files === null || Array.isArray(manifest.files)) {
    return { ok: false, errors: ["Demo asset manifest has an unsupported format or watermark label."] };
  }

  const actualPaths = await findRasterAssets(publicDir);
  const expectedPaths = Object.keys(manifest.files).sort((left, right) => left.localeCompare(right));
  for (const relativePath of actualPaths) {
    if (!Object.hasOwn(manifest.files, relativePath)) {
      errors.push(`Public raster asset is missing from the manifest: ${relativePath}`);
      continue;
    }
    const actualHash = await sha256File(path.join(publicDir, relativePath));
    if (manifest.files[relativePath] !== actualHash) {
      errors.push(`Public raster asset differs from its watermarked manifest: ${relativePath}`);
    }
  }
  for (const relativePath of expectedPaths) {
    if (!actualPaths.includes(relativePath)) {
      errors.push(`Manifest entry has no public raster asset: ${relativePath}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
