import { describe, expect, it } from "vitest";
import { EDITOR_SESSION_STORAGE_KEY, defaultEditorSession, loadEditorSession, saveEditorSession } from "../src/legacy/editor-session";
import { EditorNavigationHistory } from "../src/legacy/editor-navigation";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    setRaw: (key: string, value: string) => { values.set(key, value); }
  };
}

describe("editor session persistence", () => {
  it("restores the active mode, focused category context, and nested return path", () => {
    const storage = storageFixture();
    const session = {
      ...defaultEditorSession(),
      activeEditorStep: 3,
      editorMode: "full" as const,
      helpVisible: true,
      sidebarCollapsed: true,
      selectedArmyPlacementId: "placement-1",
      armyCatalogKind: "buildings" as const,
      selectedCampaignFloorId: "floor-2",
      selectedCampaignNodeId: "boss-2",
      relatedReturnContexts: [{
        parentType: "campaign" as const, parentKey: "campaign-1", floorId: "floor-2", nodeId: "boss-2",
        target: "army" as const, parentStep: 3, returnLabel: "Willow Road"
      }]
    };

    saveEditorSession(storage, session);

    expect(storage.getItem(EDITOR_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(loadEditorSession(storage)).toEqual(session);
    const history = new EditorNavigationHistory();
    history.restore(loadEditorSession(storage).relatedReturnContexts);
    expect(history.current()).toEqual(session.relatedReturnContexts[0]);
  });

  it("falls back safely for malformed session data and ignores invalid return contexts", () => {
    const storage = storageFixture();
    storage.setRaw(EDITOR_SESSION_STORAGE_KEY, "not-json");
    expect(loadEditorSession(storage)).toEqual(defaultEditorSession());

    const history = new EditorNavigationHistory();
    history.restore([{ parentType: "quest", target: "dialogue", parentKey: "q", dialogueSlot: "other", parentStep: 1, returnLabel: "Quest" }]);
    expect(history.current()).toBeNull();
  });

  it("starts with optional help hidden", () => {
    expect(defaultEditorSession().helpVisible).toBe(false);
  });

  it("tolerates blocked browser storage for the transient session", () => {
    const blocked = {
      getItem: () => { throw new Error("Storage is unavailable"); },
      setItem: () => { throw new Error("Storage is unavailable"); }
    };
    expect(loadEditorSession(blocked)).toEqual(defaultEditorSession());
    expect(() => saveEditorSession(blocked, defaultEditorSession())).not.toThrow();
  });
});
