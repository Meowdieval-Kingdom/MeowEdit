import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftToWorkspace, workspaceToDraft } from "../src/editor/convert";
import { loadWorkspace, saveWorkspace } from "../src/editor/workspace-store";
import { emptyContentSet, localized, namedRef } from "../src/content/factory";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const catalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/army-catalog.json"), "utf8"));
const roster = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/unit-roster.json"), "utf8"));

function draftWithArmy(): ContentSetDocument {
  const draft = emptyContentSet("editor-set", "Editor Set");
  draft.armies.push({
    schemaVersion: 2, id: "test-army", name: localized("Test Army"),
    units: [{ unitId: namedRef(capabilities.ids.units[0]), x: 0, y: 0, spellIds: [] }],
    spellIds: [], blessingIds: [], CellBlessingPicks: []
  });
  draft.dialogues.push({
    schemaVersion: 2, sequenceId: "intro", startNodeId: "opening", pauseMode: "pause",
    defaultCharactersPerSecond: 30,
    nodes: [{
      id: "opening", headline: localized("Opening"), textSpeed: 30,
      speakers: [], segments: [{ speakerIds: [], text: localized("Hello") }],
      actions: [{ label: localized("Continue"), targetNodeId: "", meowEdit: {
        decision: { id: "", label: localized(""), outcomeId: "", outcomeLabel: localized("") },
        defaultContinue: true
      } }]
    }]
  });
  return draft;
}

describe("editor", () => {
  beforeEach(async () => {
    vi.resetModules();
    if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
    else document.querySelector("#app")!.innerHTML = "";
    for (const key of Object.keys(localStorage))
      if (key.startsWith("meowedit.workspace.v1.")) localStorage.removeItem(key);
    const editorSession = {
      activeEditorStep: 6, editorMode: "full", helpVisible: false, sidebarCollapsed: false,
      selectedArmyPlacementId: null, armyCatalogKind: "units", selectedMissionFloorId: null,
      selectedMissionNodeId: null, relatedReturnContexts: []
    };
    localStorage.setItem("meowedit.editor-session.v1.author-1", JSON.stringify(editorSession));
    localStorage.setItem("meowedit.editor-session.v1.author-1.editor-set", JSON.stringify(editorSession));
    const bridge = await import("../src/bridge-context");
    bridge.setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("unit-roster.json"))
        return new Response(JSON.stringify(roster), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("army-catalog.json"))
        return new Response(JSON.stringify(catalog), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200 });
    }));
  });

  afterEach(async () => {
    const bridge = await import("../src/bridge-context");
    bridge.resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("renders the army editor with the footprint-aware grid and cloud controls", async () => {
    const { mountEditor } = await import("../src/editor/main");
    const onSave = vi.fn();
    mountEditor({
      setId: "editor-set",
      draft: draftWithArmy(), capabilities, selected: { section: "armies", index: 0 },
      onSave, onDraftChange: vi.fn(), onBack: vi.fn()
    });
    await vi.waitFor(() => expect(document.querySelector(".army-grid-cell")).not.toBeNull());
    expect(document.querySelector(".app-shell")).not.toBeNull();
    expect(document.querySelector(".army-grid-placement")).not.toBeNull();
    const save = document.querySelector<HTMLButtonElement>('[data-action="save-package"]')!;
    expect(save.disabled).toBe(true);
    const nameField = document.querySelector<HTMLInputElement>('[data-bind="name"]')!;
    nameField.value = "Changed army";
    nameField.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>('[data-action="save-package"]')!.disabled).toBe(false);
    document.querySelector<HTMLElement>('[data-action="save-package"]')!.click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("starts a fresh mount at the first guided step instead of a stale saved step", async () => {
    const { mountEditor } = await import("../src/editor/main");
    mountEditor({
      setId: "editor-set", draft: draftWithArmy(), capabilities, selected: { section: "armies", index: 0 },
      forceMode: "guided", onSave: vi.fn(), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    await vi.waitFor(() => expect(document.querySelector(".army-guided-heading")).not.toBeNull());
    expect(document.querySelector(".army-guided-heading")!.textContent).toContain("Step 1 of 7");
    expect(document.querySelector('[data-action="editor-next"]')).not.toBeNull();
  });

  it("renders the dialogue, quest and mission screens with their real layouts", async () => {
    const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;
    const { mountEditor } = await import("../src/editor/main");
    const mount = (section: string, index: number) => mountEditor({
      setId: "editor-set",
      draft: fullSet, capabilities, selected: { section, index },
      onSave: vi.fn(async () => "saved"), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    mount("dialogues", 0);
    await vi.waitFor(() => expect(document.querySelector("[data-dialogue-node-graph]")).not.toBeNull());
    expect(document.querySelector(".preview-panel, .game-screen")).not.toBeNull();

    mount("quests", 0);
    await vi.waitFor(() => expect(document.querySelector('[data-bind="definition.title"]')).not.toBeNull());

    mount("missions", 0);
    await vi.waitFor(() => expect(document.querySelector(".mission-floor-tab")).not.toBeNull());
  });

  it("offers JSON transfer in the full editor and not in the topbar", async () => {
    const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;
    const { mountEditor } = await import("../src/editor/main");
    const mount = (section: string, index: number) => mountEditor({
      setId: "transfer-set", draft: fullSet, capabilities,
      selected: { section, index }, forceMode: "full", onSave: vi.fn(async () => "saved"), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    for (const section of ["dialogues", "quests", "armies", "missions"]) {
      mount(section, 0);
      await vi.waitFor(() => expect(document.querySelector(".editor-transfer-bar")).not.toBeNull());
      expect(document.querySelectorAll('.editor-transfer-bar [data-action="open-transfer"]')).toHaveLength(1);
      expect(document.querySelector('.topbar-actions [data-action="open-transfer"]')).toBeNull();
    }
  });

  it("round-trips a structured draft through the editor workspace without losing structured-only fields", () => {
    const draft = draftWithArmy();
    draft.missions.push({
      schemaVersion: 2, id: "mission-1", name: localized("Mission"), description: localized(""),
      boardPreviewUnitId: namedRef(capabilities.ids.units[0]), questIds: [],
      floors: [], events: [],
      settings: {
        startingLives: 3, startingSardines: 10, startingNodeCount: 12,
        playerFactionId: namedRef(capabilities.ids.factions[0]), factionSelectionEnabled: true,
        battleShopEnabled: true, shopPoolKinds: ["Unit"], questNodeCountPerRandomFloor: 2,
        shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
        blessingsEnabled: true, restoreArmyAfterLoss: true
      }
    });
    const workspace = draftToWorkspace(draft, capabilities, { section: "armies", index: 0 });
    expect(workspace.armies[0].name).toBe("Test Army");
    expect(workspace.dialogues[0].sequence.nodes[0].actions).toHaveLength(0);
    workspace.armies[0].name = "Renamed Army";
    workspaceToDraft(draft, workspace, capabilities);
    expect(draft.armies[0].name.default).toBe("Renamed Army");
    expect(draft.missions[0].settings.blessingsEnabled).toBe(true);
    expect(draft.dialogues[0].nodes[0].actions[0].meowEdit.defaultContinue).toBe(true);
  });

  it("repairs stale catalog IDs to the matching current unit", async () => {
    const { reconcileCatalogIds } = await import("../src/editor/main");
    const army = {
      key: "a", id: "a", name: "Old Army", previewFloor: 1,
      units: [{ id: "p1", unitId: "Missing/Fighter/1", x: 0, y: 0, spellIds: [] }],
      spellIds: [], blessingIds: []
    };
    const workspace = draftToWorkspace(draftWithArmy(), capabilities);
    workspace.armies = [army];
    const changed = reconcileCatalogIds(workspace, catalog);
    expect(changed).toBe(1);
    expect(workspace.armies[0].units[0].unitId).toBe("Peasants/Fighter/1");
  });

  it("round-trips auto-accept and per-mission sardine payout settings", () => {
    const draft = draftWithArmy();
    const structured = JSON.parse(JSON.stringify(draft)) as ContentSetDocument;
    structured.quests.push({
      schemaVersion: 2, id: "intro", title: localized("Intro"), description: localized(""),
      acceptLabel: localized("Accept"), declineLabel: localized("Decline"), autoAccept: true,
      meowEdit: {
        schemaVersion: 2, dialogueLinks: { offer: [], active: [], completion: [], failure: [] },
        logicKind: "standard", timer: {
          decisionId: namedRef(""), payOutcomeId: namedRef(""), waitOutcomeId: namedRef(""),
          counterId: namedRef(""), counterTarget: 1, counterLabel: localized(""),
          countEvent: "battle-won", paymentResource: "sardines", paymentAmount: 0,
          paymentCompletesImmediately: false, completionEffects: []
        }, completionEffects: [], fetchItems: [], battleTargets: [],
        killCount: { targetKind: "unit", targetId: namedRef("unit"), count: 1 }, minimumNodeDistances: []
      }
    });
    structured.missions.push({
      schemaVersion: 2, id: "mission", name: localized("Mission"), description: localized(""),
      boardPreviewUnitId: namedRef(""), questIds: [], floors: [], events: [],
      settings: {
        startingLives: 3, startingSardines: 0, startingNodeCount: 12,
        playerFactionId: namedRef(""), factionSelectionEnabled: false, battleShopEnabled: false,
        shopPoolKinds: [], questNodeCountPerRandomFloor: 0, shopNodeCountPerRandomFloor: 0,
        nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false, blessingsEnabled: false,
        restoreArmyAfterLoss: true, sardinePayoutEnabled: false,
        sardinePayoutBase: 7, sardinePayoutPerFloor: 3
      }
    });
    const workspace = draftToWorkspace(structured, capabilities);
    expect(workspace.quests[0].definition.autoAccept).toBe(true);
    expect(workspace.missions[0].settings.sardinePayoutEnabled).toBe(false);
    expect(workspace.missions[0].settings.sardinePayoutBase).toBe(7);
    workspaceToDraft(structured, workspace, capabilities);
    expect(structured.quests[0].autoAccept).toBe(true);
    expect(structured.missions[0].settings.sardinePayoutEnabled).toBe(false);
    expect(structured.missions[0].settings.sardinePayoutPerFloor).toBe(3);
  });

  it("maps event armyId to the structured registry parameter key", () => {
    const draft = draftWithArmy();
    const workspace = draftToWorkspace(draft, capabilities);
    workspace.missions.push({
      key: "mission-1", id: "mission-1", name: "Mission", description: "", questIds: [],
      designMode: "custom", boardPreviewUnitId: "",
      floors: [], settings: {
        startingLives: 3, startingSardines: 10, startingNodeCount: 12, playerFactionId: capabilities.ids.factions[0],
        factionSelectionEnabled: true, battleShopEnabled: true, shopPoolKinds: ["Unit"],
        questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3,
        nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
        sardinePayoutEnabled: true, sardinePayoutBase: 10, sardinePayoutPerFloor: 1
      },
      events: [{ id: "event-1", trigger: "mission-start", actions: [
        { kind: "replace-player-army", armyId: "test-army" }
      ] }]
    });
    workspaceToDraft(draft, workspace, capabilities);
    expect(draft.missions[0].events[0].actions[0].parameters).toEqual([
      { key: "army", value: { id: "test-army", label: { default: "test-army", locales: {} } } }
    ]);
    const reopened = draftToWorkspace(draft, capabilities);
    expect(reopened.missions[0].events[0].actions[0].armyId).toBe("test-army");
  });

  it("keeps Drawflow positions and editor labels in the native, per-set workspace", () => {
    const draft = draftWithArmy();
    const workspace = loadWorkspace("set-a", draft, capabilities);
    workspace.dialogues[0].sequence.nodes[0].editorPosition = { x: 320, y: 180, reverse: true };
    workspace.dialogues[0].sequence.nodes[0].editorLabel = "Opening beat";
    workspace.armies[0].units[0].id = "placement-custom";
    workspace.missions = [];
    saveWorkspace("set-a", workspace);

    const reloaded = loadWorkspace("set-a", draft, capabilities);
    expect(reloaded.dialogues[0].sequence.nodes[0].editorPosition).toEqual({ x: 320, y: 180, reverse: true });
    expect(reloaded.dialogues[0].sequence.nodes[0].editorLabel).toBe("Opening beat");
    expect(reloaded.armies[0].units[0].id).toBe("placement-custom");

    const other = loadWorkspace("set-b", draft, capabilities);
    expect(other.dialogues[0].sequence.nodes[0].editorPosition).toBeUndefined();
    expect(other.armies[0].units[0].id).toBe("placement-0");
  });

  it("copies the previous moment's speaker defaults into a new guided moment", async () => {
    const draft = draftWithArmy();
    const node = draft.dialogues[0].nodes[0];
    node.speakers = [{ id: "speaker-1", unitId: namedRef(capabilities.ids.units[0]), displayName: localized("Elder"), side: "left", mood: "neutral" }] as never;
    node.segments[0].speakerIds = ["speaker-1"];
    const { mountEditor } = await import("../src/editor/main");
    mountEditor({
      setId: "editor-set", draft, capabilities, selected: { section: "dialogues", index: 0 }, forceMode: "guided",
      onSave: vi.fn(async () => "saved"), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    await vi.waitFor(() => expect(document.querySelector('[data-action="editor-next"]')).not.toBeNull());
    for (let i = 0; i < 3; i++) document.querySelector<HTMLElement>('[data-action="editor-next"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="guided-add-node"]')).not.toBeNull());
    document.querySelector<HTMLElement>('[data-action="guided-add-node"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-bind="nodes.1.speakers.0.unitId"]')).not.toBeNull());
    expect(document.querySelector<HTMLSelectElement>('[data-bind="nodes.1.speakers.0.unitId"]')!.value).toBe(capabilities.ids.units[0]);
    expect(document.querySelector(".guided-moment-name")?.hasAttribute("open")).toBe(false);
    expect(document.querySelector('[data-bind="nodes.1.editorLabel"]')?.hasAttribute("data-guided-autofocus")).toBe(false);
  });

  it("restores dimmed guided context when clicking outside the focus area", async () => {
    const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;
    const { mountEditor } = await import("../src/editor/main");
    mountEditor({
      setId: "focus-set", draft: fullSet, capabilities, selected: { section: "missions", index: 0 }, forceMode: "guided",
      onSave: vi.fn(async () => "saved"), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    await vi.waitFor(() => expect(document.querySelector(".mission-guided-progress")).not.toBeNull());
    expect(document.querySelector(".guided-context-unmuted")).toBeNull();
    document.querySelector<HTMLElement>(".mission-guided-step-heading")!.click();
    expect(document.querySelector(".guided-context-unmuted")).not.toBeNull();
  });

});



