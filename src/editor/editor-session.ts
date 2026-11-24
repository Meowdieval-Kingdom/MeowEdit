import { getBridgeUserId } from "../bridge-context";
import type { ArmyCatalogKind } from "./army-catalog";
import type { EditorMode } from "./view";
import type { RelatedEditorReturnContext } from "./editor-navigation";

export const EDITOR_SESSION_STORAGE_KEY = "meowedit.editor-session.v1";

export function editorSessionKey(setId?: string): string {
  const user = getBridgeUserId() ?? "local";
  return setId ? `${EDITOR_SESSION_STORAGE_KEY}.${user}.${setId}` : `${EDITOR_SESSION_STORAGE_KEY}.${user}`;
}

export interface EditorSessionState {
  activeEditorStep: number;
  editorMode: EditorMode;
  helpVisible: boolean;
  sidebarCollapsed: boolean;
  selectedArmyPlacementId: string | null;
  armyCatalogKind: ArmyCatalogKind;
  selectedMissionFloorId: string | null;
  selectedMissionNodeId: string | null;
  relatedReturnContexts: RelatedEditorReturnContext[];
}

export function defaultEditorSession(): EditorSessionState {
  return {
    activeEditorStep: 0,
    editorMode: "guided",
    helpVisible: false,
    sidebarCollapsed: false,
    selectedArmyPlacementId: null,
    armyCatalogKind: "units",
    selectedMissionFloorId: null,
    selectedMissionNodeId: null,
    relatedReturnContexts: []
  };
}

export function loadEditorSession(storage: Pick<Storage, "getItem">, setId?: string): EditorSessionState {
  const fallback = defaultEditorSession();
  try {
    const parsed = JSON.parse(storage.getItem(editorSessionKey(setId)) ?? "null") as Partial<EditorSessionState> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      activeEditorStep: Number.isInteger(parsed.activeEditorStep) && Number(parsed.activeEditorStep) >= 0
        ? Math.min(Number(parsed.activeEditorStep), 20) : fallback.activeEditorStep,
      editorMode: parsed.editorMode === "full" ? "full" : "guided",
      helpVisible: parsed.helpVisible === true,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      selectedArmyPlacementId: typeof parsed.selectedArmyPlacementId === "string" ? parsed.selectedArmyPlacementId : null,
      armyCatalogKind: parsed.armyCatalogKind === "buildings" ? "buildings" : "units",
      selectedMissionFloorId: typeof parsed.selectedMissionFloorId === "string" ? parsed.selectedMissionFloorId : null,
      selectedMissionNodeId: typeof parsed.selectedMissionNodeId === "string" ? parsed.selectedMissionNodeId : null,
      relatedReturnContexts: Array.isArray(parsed.relatedReturnContexts)
        ? parsed.relatedReturnContexts as RelatedEditorReturnContext[] : []
    };
  } catch {
    return fallback;
  }
}

export function saveEditorSession(storage: Pick<Storage, "setItem">, session: EditorSessionState, setId?: string): void {
  try {
    storage.setItem(editorSessionKey(setId), JSON.stringify(session));
  } catch {
    // Draft content has its own save warning; transient navigation can safely fall back to defaults.
  }
}

