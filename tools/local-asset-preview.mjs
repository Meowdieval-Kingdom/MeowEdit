import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const LOCAL_ASSET_CONFIRMATION = "USE REAL ASSETS LOCALLY";

export function confirmedAssetRoot(configPath, projectRoot) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.confirmation !== LOCAL_ASSET_CONFIRMATION || typeof config.assetRoot !== "string" || !config.assetRoot.trim()) {
      return null;
    }
    const root = path.resolve(projectRoot, config.assetRoot);
    if (!["avatars", "game-preview"].every(folder => existsSync(path.join(root, folder)))) return null;
    return root;
  } catch {
    return null;
  }
}

function sendLocalImage(root, requestUrl, response, next) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    next();
    return;
  }

  const folder = pathname.startsWith("/avatars/") ? "avatars"
    : pathname.startsWith("/game-preview/") ? "game-preview" : null;
  if (!folder) {
    next();
    return;
  }

  const basePath = path.resolve(root, folder);
  const imagePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(basePath, imagePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    next();
    return;
  }

  try {
    if (!statSync(imagePath).isFile()) return next();
  } catch {
    next();
    return;
  }

  const contentType = ({
    ".avif": "image/avif", ".bmp": "image/bmp", ".gif": "image/gif", ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg", ".png": "image/png", ".tif": "image/tiff", ".tiff": "image/tiff", ".webp": "image/webp"
  })[path.extname(imagePath).toLowerCase()];
  if (!contentType) return next();
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store");
  createReadStream(imagePath).on("error", next).pipe(response);
}

export function installLocalAssetMiddleware(server, projectRoot) {
  const configPath = path.join(projectRoot, "meowedit.local-assets.json");
  const root = confirmedAssetRoot(configPath, projectRoot);
  if (!root) return null;
  server.middlewares.use((request, response, next) => {
    if (!request.url) return next();
    sendLocalImage(root, request.url, response, next);
  });
  return root;
}

export function localAssetPreviewPlugin() {
  return {
    name: "meowedit-local-real-asset-preview",
    apply: "serve",
    configureServer(server) {
      installLocalAssetMiddleware(server, server.config.root);
    }
  };
}
