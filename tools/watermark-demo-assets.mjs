import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoAssetManifest, findRasterAssets, sha256File, DEMO_ASSET_MANIFEST } from "./demo-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const sourceRoot = path.join(projectRoot, ".local-assets", "source");
const watermarkFont = path.join(publicDir, "game-preview", "fonts", "LTSaeada-ExtraLight.otf").replaceAll(path.sep, "/");
const imageMagick = process.env.MEOWEDIT_IMAGEMAGICK || "magick";
const workDir = await mkdtemp(path.join(os.tmpdir(), "meowedit-watermark-"));
const assets = await findRasterAssets(publicDir);

if (assets.length === 0) throw new Error("No public raster assets were found to watermark.");

try {
  const missingSources = [];
  for (const relativePath of assets) {
    try {
      await readFile(path.join(sourceRoot, relativePath));
    } catch {
      missingSources.push(relativePath);
    }
  }
  if (missingSources.length) {
    throw new Error(`Original local source is missing for: ${missingSources.join(", ")}. Restore it under .local-assets/source before watermarking.`);
  }

  for (let index = 0; index < assets.length; index += 1) {
    const relativePath = assets[index];
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(publicDir, relativePath);
    const metadata = execFileSync(imageMagick, ["identify", "-format", "%w %h", sourcePath], { encoding: "utf8" }).trim();
    const [width, height] = metadata.split(/\s+/).map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`Could not read image dimensions: ${relativePath}`);

    const fontSize = Math.max(12, Math.min(24, Math.round(Math.min(width, height) * 0.08)));
    const tileWidth = Math.max(54, Math.min(96, Math.round(Math.min(width, height) * 0.3)));
    const tileHeight = Math.max(42, Math.min(76, Math.round(tileWidth * 0.68)));
    const outlinePath = path.join(workDir, `outline-${index}.png`);
    const fillPath = path.join(workDir, `fill-${index}.png`);
    const tilePath = path.join(workDir, `tile-${index}.png`);
    const rotatedTilePath = path.join(workDir, `rotated-${index}.png`);
    const overlayPath = path.join(workDir, `overlay-${index}.png`);
    const extension = path.extname(targetPath);
    const tempOutputPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath, extension)}.watermark-${process.pid}${extension}`);
    try {
      execFileSync(imageMagick, ["-size", `${tileWidth}x${tileHeight}`, "xc:none", "-font", watermarkFont,
        "-pointsize", String(fontSize + 2), "-stroke", "#241b13", "-strokewidth", "1.1", "-fill", "none",
        "-gravity", "center", "-annotate", "0", "DEMO", `PNG32:${outlinePath}`], { stdio: "pipe" });
      execFileSync(imageMagick, ["-size", `${tileWidth}x${tileHeight}`, "xc:none", "-font", watermarkFont,
        "-pointsize", String(fontSize), "-fill", "#fff8d9", "-gravity", "center", "-annotate", "0", "DEMO",
        `PNG32:${fillPath}`], { stdio: "pipe" });
      execFileSync(imageMagick, [outlinePath, fillPath, "-compose", "over", "-composite", "-channel", "A",
        "-evaluate", "Multiply", "0.68", "+channel", `PNG32:${tilePath}`], { stdio: "pipe" });
      execFileSync(imageMagick, [tilePath, "-background", "none", "-rotate", "-28", `PNG32:${rotatedTilePath}`], { stdio: "pipe" });
      execFileSync(imageMagick, ["-size", `${width}x${height}`, `tile:${rotatedTilePath}`, `PNG32:${overlayPath}`], { stdio: "pipe" });
      execFileSync(imageMagick, [sourcePath, overlayPath, "-compose", "over", "-composite", tempOutputPath], { stdio: "pipe" });
      if (await sha256File(sourcePath) === await sha256File(tempOutputPath)) {
        throw new Error("The generated watermark did not change the image.");
      }
      await rename(tempOutputPath, targetPath);
    } catch (error) {
      await rm(tempOutputPath, { force: true });
      throw new Error(`Watermarking failed for ${relativePath}: ${error.message}`);
    }

    console.log(`Watermarked ${relativePath}`);
  }

  const manifest = await createDemoAssetManifest(publicDir);
  await writeFile(path.join(publicDir, DEMO_ASSET_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated ${DEMO_ASSET_MANIFEST} with ${assets.length} image hashes.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
