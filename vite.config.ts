import { defineConfig } from "vite";
import { localAssetPreviewPlugin } from "./tools/local-asset-preview.mjs";

export default defineConfig({
  base: "./",
  plugins: [localAssetPreviewPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
