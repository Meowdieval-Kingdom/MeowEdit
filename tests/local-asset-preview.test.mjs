import { Writable } from "node:stream";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { confirmedAssetRoot, installLocalAssetMiddleware, LOCAL_ASSET_CONFIRMATION } from "../tools/local-asset-preview.mjs";

const temporaryDirectories = [];

class TestResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

async function dispatch(middleware, url) {
  const response = new TestResponse();
  const finished = new Promise(resolve => response.once("finish", resolve));
  middleware({ url }, response, () => {
    response.statusCode = 404;
    response.end("demo public fallback");
  });
  await finished;
  return response;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meowedit-local-assets-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("confirmed local asset preview", () => {
  it("requires the exact confirmation and both asset folders", async () => {
    const projectRoot = await temporaryDirectory();
    const assetRoot = path.join(projectRoot, ".local-assets", "source");
    await mkdir(path.join(assetRoot, "avatars"), { recursive: true });
    await mkdir(path.join(assetRoot, "game-preview"), { recursive: true });
    const configPath = path.join(projectRoot, "meowedit.local-assets.json");

    await writeFile(configPath, JSON.stringify({ confirmation: "yes", assetRoot }));
    expect(confirmedAssetRoot(configPath, projectRoot)).toBeNull();
    await writeFile(configPath, JSON.stringify({ confirmation: LOCAL_ASSET_CONFIRMATION, assetRoot }));
    expect(confirmedAssetRoot(configPath, projectRoot)).toBe(assetRoot);
    expect(confirmedAssetRoot(path.join(projectRoot, "missing.json"), projectRoot)).toBeNull();
  });

  it("serves only local avatar and game preview files after opt-in", async () => {
    const projectRoot = await temporaryDirectory();
    const assetRoot = path.join(projectRoot, ".local-assets", "source");
    await mkdir(path.join(assetRoot, "avatars"), { recursive: true });
    await mkdir(path.join(assetRoot, "game-preview"), { recursive: true });
    await writeFile(path.join(assetRoot, "avatars", "unit.png"), "local unit art");
    await writeFile(path.join(assetRoot, "game-preview", "frame.png"), "local frame art");
    await writeFile(path.join(projectRoot, "meowedit.local-assets.json"), JSON.stringify({
      confirmation: LOCAL_ASSET_CONFIRMATION,
      assetRoot
    }));

    let middleware;
    const mockViteServer = {
      config: { root: projectRoot },
      middlewares: { use(handler) { middleware = handler; } }
    };
    expect(installLocalAssetMiddleware(mockViteServer, projectRoot)).toBe(assetRoot);
    const avatar = await dispatch(middleware, "/avatars/unit.png");
    expect(avatar.headers["content-type"]).toBe("image/png");
    expect(avatar.body).toBe("local unit art");

    const frame = await dispatch(middleware, "/game-preview/frame.png");
    expect(frame.body).toBe("local frame art");

    const outside = await dispatch(middleware, "/avatars/%2e%2e%2fsecret.png");
    expect(outside.statusCode).toBe(404);
  });

  it("leaves demo public files in control without the local confirmation file", async () => {
    const projectRoot = await temporaryDirectory();
    let mounted = false;
    const mockViteServer = {
      config: { root: projectRoot },
      middlewares: { use() { mounted = true; } }
    };
    expect(installLocalAssetMiddleware(mockViteServer, projectRoot)).toBeNull();
    expect(mounted).toBe(false);
  });
});
