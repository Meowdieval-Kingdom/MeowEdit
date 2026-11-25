import { getBridgeUserId } from "../bridge-context";
import type { ContentSetDocument } from "./types";

/** Last published draft, kept locally so saved-but-unpublished changes can be reverted. */
function key(setId: string): string {
  return "meowedit.published-snapshot.v1." + (getBridgeUserId() ?? "local") + "." + setId;
}

export function savePublishedSnapshot(setId: string, draft: ContentSetDocument): void {
  try { localStorage.setItem(key(setId), JSON.stringify(draft)); } catch { /* snapshot is optional */ }
}

export function loadPublishedSnapshot(setId: string): ContentSetDocument | null {
  try {
    const raw = localStorage.getItem(key(setId));
    return raw ? JSON.parse(raw) as ContentSetDocument : null;
  } catch {
    return null;
  }
}

export function clearPublishedSnapshot(setId: string): void {
  try { localStorage.removeItem(key(setId)); } catch { /* snapshot is optional */ }
}
