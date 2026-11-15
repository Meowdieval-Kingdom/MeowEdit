import type { Plugin, ViteDevServer } from "vite";

export declare const LOCAL_ASSET_CONFIRMATION: string;
export declare function confirmedAssetRoot(configPath: string, projectRoot: string): string | null;
export declare function installLocalAssetMiddleware(server: ViteDevServer, projectRoot: string): string | null;
export declare function localAssetPreviewPlugin(): Plugin;
