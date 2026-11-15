import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { verifyDemoAssets } from "./demo-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const result = await verifyDemoAssets(publicDir);
if (!result.ok) {
  console.error("Demo asset verification failed:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const { files } = JSON.parse(await readFile(path.join(publicDir, "demo-assets.manifest.json"), "utf8"));
  console.log(`Verified ${Object.keys(files).length} demo-watermarked public images.`);
}
