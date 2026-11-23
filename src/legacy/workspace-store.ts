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

export function loadWorkspace(
  setId: string,
  draft: ContentSetDocument,
  capabilities: GameCapabilities,
  selected?: { section: string; index: number }
): Workspace {
  try {
    const raw = localStorage.getItem(workspaceKey(setId));
    if (raw) {
      const parsed = JSON.parse(raw) as Workspace;
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.dialogues) && Array.isArray(parsed.quests)
        && Array.isArray(parsed.armies) && Array.isArray(parsed.campaigns)) return parsed;
    }
  } catch {
    // A damaged local workspace is replaced by a fresh one from the cloud draft.
  }
  return draftToWorkspace(draft, capabilities, selected);
}

export function saveWorkspace(setId: string, workspace: Workspace): void {
  try {
    localStorage.setItem(workspaceKey(setId), JSON.stringify(workspace));
  } catch {
    // The cloud save reports storage failures; keep the in-memory workspace usable.
  }
}
