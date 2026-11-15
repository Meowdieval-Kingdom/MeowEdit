import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRasterAssets } from "./demo-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const confirmation = "USE REAL ASSETS LOCALLY";
const defaultRoot = path.join(projectRoot, ".local-assets", "source");
const configPath = path.join(projectRoot, "meowedit.local-assets.json");
const readline = createInterface({ input: process.stdin, output: process.stdout });

try {
  const enteredRoot = await readline.question(`Real asset folder (contains avatars/ and game-preview/) [${defaultRoot}]: `);
  const assetRoot = path.resolve(projectRoot, enteredRoot.trim() || defaultRoot);
  const typedConfirmation = await readline.question(`Type exactly "${confirmation}" to enable real assets for the local dev preview: `);
  if (typedConfirmation.trim() !== confirmation) {
    throw new Error("Confirmation phrase did not match; the local real-asset preview was not enabled.");
  }

  for (const folder of ["avatars", "game-preview"]) {
    await access(path.join(assetRoot, folder), constants.R_OK);
  }
  const localImages = await findRasterAssets(assetRoot);
  if (!localImages.some(file => file.startsWith("avatars/"))
    || !localImages.some(file => file.startsWith("game-preview/"))) {
    throw new Error("The selected asset folder needs at least one image under both avatars/ and game-preview/.");
  }

  const config = {
    confirmation: typedConfirmation.trim(),
    assetRoot
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log("Real assets are enabled only for the local Vite development preview.");
  console.log("Production builds continue to use the watermarked public assets.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  readline.close();
}
