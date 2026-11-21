import type { UnitRoster, Workspace } from "./model";
import { createPackageEntries } from "./export";

export interface BridgePackageFile {
  path: string;
  content: string;
}

export interface BridgePackagePayload {
  campaignSetId: string;
  files: BridgePackageFile[];
  contentHash: string;
}

const CONTENT_ROOT = "meowdieval-content/";

/** Builds the same canonical file map and SHA-256 hash that Tactics validates at runtime. */
export async function createBridgePackagePayload(
  campaignSetId: string,
  workspace: Workspace,
  roster: UnitRoster
): Promise<BridgePackagePayload> {
  const normalizedSetId = campaignSetId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalizedSetId))
    throw new Error("Campaign set ID must use lowercase letters, numbers, dots, underscores, or hyphens.");
  if (workspace.campaigns.length === 0)
    throw new Error("Add at least one campaign before publishing content to the game.");

  // The Bridge only carries JSON package files; Tactics rejects any other path,
  // including the ZIP-only README.txt.
  const files = createPackageEntries(workspace, roster)
    .filter(entry => entry.path.startsWith(CONTENT_ROOT) && entry.path.endsWith(".json"))
    .map(entry => ({
      path: entry.path.slice(CONTENT_ROOT.length),
      content: typeof entry.content === "string" ? entry.content : new TextDecoder().decode(entry.content)
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const canonical = files.map(file => `${file.path}\n${file.content}\n`).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { campaignSetId: normalizedSetId, files, contentHash };
}
