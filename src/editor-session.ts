import type { ArmyCatalogKind } from "./army-catalog";
import type { EditorMode } from "./view";
import type { RelatedEditorReturnContext } from "./editor-navigation";

export const EDITOR_SESSION_STORAGE_KEY = "meowedit.editor-session.v1";

export interface EditorSessionState {
  activeEditorStep: number;
  editorMode: EditorMode;
  helpVisible: boolean;
  sidebarCollapsed: boolean;
  selectedArmyPlacementId: string | null;
  armyCatalogKind: ArmyCatalogKind;
  selectedCampaignFloorId: string | null;
  selectedCampaignNodeId: string | null;
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
    selectedCampaignFloorId: null,
    selectedCampaignNodeId: null,
    relatedReturnContexts: []
  };
}

export function loadEditorSession(storage: Pick<Storage, "getItem">): EditorSessionState {
  const fallback = defaultEditorSession();
  try {
    const parsed = JSON.parse(storage.getItem(EDITOR_SESSION_STORAGE_KEY) ?? "null") as Partial<EditorSessionState> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      activeEditorStep: Number.isInteger(parsed.activeEditorStep) && Number(parsed.activeEditorStep) >= 0
        ? Math.min(Number(parsed.activeEditorStep), 20) : fallback.activeEditorStep,
      editorMode: parsed.editorMode === "full" ? "full" : "guided",
      helpVisible: parsed.helpVisible === true,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      selectedArmyPlacementId: typeof parsed.selectedArmyPlacementId === "string" ? parsed.selectedArmyPlacementId : null,
      armyCatalogKind: parsed.armyCatalogKind === "buildings" ? "buildings" : "units",
      selectedCampaignFloorId: typeof parsed.selectedCampaignFloorId === "string" ? parsed.selectedCampaignFloorId : null,
      selectedCampaignNodeId: typeof parsed.selectedCampaignNodeId === "string" ? parsed.selectedCampaignNodeId : null,
      relatedReturnContexts: Array.isArray(parsed.relatedReturnContexts)
        ? parsed.relatedReturnContexts as RelatedEditorReturnContext[] : []
    };
  } catch {
    return fallback;
  }
}

export function saveEditorSession(storage: Pick<Storage, "setItem">, session: EditorSessionState): void {
  try {
    storage.setItem(EDITOR_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Draft content has its own save warning; transient navigation can safely fall back to defaults.
  }
}
