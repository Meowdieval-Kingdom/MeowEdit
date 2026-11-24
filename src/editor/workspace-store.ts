import { getBridgeUserId } from "../bridge-context";
import type { ContentSetDocument, GameCapabilities } from "../content/types";
import { draftToWorkspace } from "./convert";
import { createSeedWorkspace } from "./seed";
import type { Workspace } from "./model";

export const SCRATCH_WORKSPACE = "__scratch__";

/**
 * The editor keeps its native workspace as its own state, scoped per set.
 * Drawflow positions, editor labels, army placement IDs and mission design
 * mode live here exactly as authored — they are authoring state,
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
    && Array.isArray(candidate.missions) && candidate.missions.every(item => item?.settings && Array.isArray(item?.floors));
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

const SCRATCH_SECTIONS = ["dialogues", "quests", "armies", "missions"] as const;

function hasEditorKey(value: unknown): boolean {
  const key = (value as { key?: unknown } | null)?.key;
  return typeof key === "string" && key.length > 0;
}

/** Unassigned scratch workspace shared by the dashboard and the classic editor. */
export function loadScratchWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(workspaceKey(SCRATCH_WORKSPACE));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isWorkspace(parsed)) {
        // Records without an editor key cannot be opened or addressed; drop them.
        const cleaned = { ...parsed } as Workspace;
        let removed = false;
        for (const section of SCRATCH_SECTIONS) {
          const kept = parsed[section].filter(hasEditorKey);
          if (kept.length !== parsed[section].length) removed = true;
          (cleaned[section] as unknown[]) = kept;
        }
        if (removed) {
          if (cleaned.selectedKey && !SCRATCH_SECTIONS.some(section =>
            (cleaned[section] as unknown as Array<{ key: string }>).some(item => item.key === cleaned.selectedKey))) {
            cleaned.selectedKey = null;
            cleaned.selectedType = null;
            cleaned.activeNodeId = null;
          }
          saveScratchWorkspace(cleaned);
        }
        return cleaned;
      }
    }
  } catch {
    // Fall through to a fresh scratch workspace.
  }
  return createSeedWorkspace();
}

export function saveScratchWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(workspaceKey(SCRATCH_WORKSPACE), JSON.stringify(workspace));
  } catch {
    // The editor reports storage failures where relevant.
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
