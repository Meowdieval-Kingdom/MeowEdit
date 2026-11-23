import { getBridgeUserId } from "../bridge-context";
import type { ContentSetDocument, GameCapabilities } from "../content/types";
import { draftToWorkspace } from "./convert";
import type { Workspace } from "./model";

/**
 * The restored editor keeps its native v1 workspace as its own state, scoped
 * per set. Drawflow positions, editor labels, army placement IDs and campaign
 * design mode live here exactly as they did in v1 — they are authoring state,
 * not part of the game's strict structured content contract.
 */

function workspaceKey(setId: string): string {
  return "meowedit.workspace.v1." + (getBridgeUserId() ?? "local") + "." + setId;
}

function metaKey(setId: string): string {
  return workspaceKey(setId) + ".meta";
}

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Workspace>;
  return candidate.schemaVersion === 1
    && Array.isArray(candidate.dialogues) && candidate.dialogues.every(item => item?.sequence && Array.isArray(item.sequence.nodes))
    && Array.isArray(candidate.quests) && candidate.quests.every(item => item?.definition && item?.extension)
    && Array.isArray(candidate.armies) && candidate.armies.every(item => Array.isArray(item?.units))
    && Array.isArray(candidate.campaigns) && candidate.campaigns.every(item => item?.settings && Array.isArray(item?.floors));
}

export function loadWorkspace(
  setId: string,
  draft: ContentSetDocument,
  capabilities: GameCapabilities,
  selected?: { section: string; index: number }
): Workspace {
  try {
    const raw = localStorage.getItem(workspaceKey(setId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isWorkspace(parsed)) return parsed;
    }
  } catch {
    // A damaged local workspace is replaced by a fresh one from the cloud draft.
  }
  return draftToWorkspace(draft, capabilities, selected);
}

export function saveWorkspace(setId: string, workspace: Workspace, syncedDraftVersion?: number): void {
  try {
    localStorage.setItem(workspaceKey(setId), JSON.stringify(workspace));
    if (syncedDraftVersion !== undefined)
      localStorage.setItem(metaKey(setId), JSON.stringify({ syncedDraftVersion }));
  } catch {
    // The cloud save reports storage failures; keep the in-memory workspace usable.
  }
}

export function markWorkspaceDirty(setId: string): void {
  try {
    const raw = localStorage.getItem(metaKey(setId));
    const previous = raw ? JSON.parse(raw) as { syncedDraftVersion?: number } : {};
    localStorage.setItem(metaKey(setId), JSON.stringify({ ...previous, dirty: true }));
  } catch {
    // Navigation metadata is not critical.
  }
}

export function markWorkspaceSynced(setId: string, draftVersion: number): void {
  try {
    localStorage.setItem(metaKey(setId), JSON.stringify({ dirty: false, syncedDraftVersion: draftVersion }));
  } catch {
    // Navigation metadata is not critical.
  }
}

/** True when the local workspace has edits that were never synced into the draft. */
export function hasUnsyncedWorkspace(setId: string): boolean {
  try {
    const raw = localStorage.getItem(metaKey(setId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { dirty?: boolean };
    return parsed.dirty === true;
  } catch {
    return false;
  }
}
