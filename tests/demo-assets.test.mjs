import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoAssetManifest, verifyDemoAssets } from "../tools/demo-assets.mjs";

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meowedit-demo-assets-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("demo asset manifest", () => {
  it("accepts an exact manifest of published raster files", async () => {
    const publicDir = await temporaryDirectory();
    await mkdir(path.join(publicDir, "avatars"));
    await writeFile(path.join(publicDir, "avatars", "unit.png"), Buffer.from("watermarked-png"));
    await writeFile(path.join(publicDir, "notes.json"), "{}");
    const manifest = await createDemoAssetManifest(publicDir);
    const manifestPath = path.join(publicDir, "demo-assets.manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(verifyDemoAssets(publicDir, manifestPath)).resolves.toEqual({ ok: true, errors: [] });
  });

  it("rejects changed, missing, and unlisted raster files", async () => {
    const publicDir = await temporaryDirectory();
    await mkdir(path.join(publicDir, "avatars"));
    await writeFile(path.join(publicDir, "avatars", "unit.png"), Buffer.from("watermarked-png"));
    const manifest = await createDemoAssetManifest(publicDir);
    const manifestPath = path.join(publicDir, "demo-assets.manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await writeFile(path.join(publicDir, "avatars", "unit.png"), Buffer.from("original-png"));
    await writeFile(path.join(publicDir, "avatars", "new.png"), Buffer.from("new-unwatermarked-png"));
    await expect(verifyDemoAssets(publicDir, manifestPath)).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("differs from its watermarked manifest: avatars/unit.png"),
        expect.stringContaining("missing from the manifest: avatars/new.png")
      ])
    });

    await rm(path.join(publicDir, "avatars", "unit.png"));
    await rm(path.join(publicDir, "avatars", "new.png"));
    await expect(verifyDemoAssets(publicDir, manifestPath)).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining("has no public raster asset: avatars/unit.png")])
    });
  });

  it("rejects an incorrect manifest label", async () => {
    const publicDir = await temporaryDirectory();
    const manifestPath = path.join(publicDir, "demo-assets.manifest.json");
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, watermark: "", files: {} }));
    await expect(verifyDemoAssets(publicDir, manifestPath)).resolves.toMatchObject({ ok: false });
  });
});
