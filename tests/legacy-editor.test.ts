import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeState, setBridgeState } from "../src/bridge-context";
import { draftToWorkspace, emptySideCar, workspaceToDraft } from "../src/legacy/adapter";
import { emptyContentSet, localized, namedRef } from "../src/v2/factory";
import type { ContentSetV2Document, GameCapabilities } from "../src/v2/types";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const catalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/army-catalog.json"), "utf8"));
const roster = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/unit-roster.json"), "utf8"));

function draftWithArmy(): ContentSetV2Document {
  const draft = emptyContentSet("legacy-set", "Legacy Set");
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

describe("restored v1 editor", () => {
  beforeEach(() => {
    if (!document.querySelector("#app")) document.body.innerHTML = '<div id="app"></div>';
    else document.querySelector("#app")!.innerHTML = "";
    localStorage.setItem("meowedit.editor-session.v1", JSON.stringify({
      activeEditorStep: 0, editorMode: "full", helpVisible: false, sidebarCollapsed: false,
      selectedArmyPlacementId: null, armyCatalogKind: "units", selectedCampaignFloorId: null,
      selectedCampaignNodeId: null, relatedReturnContexts: []
    }));
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("unit-roster.json"))
        return new Response(JSON.stringify(roster), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("army-catalog.json"))
        return new Response(JSON.stringify(catalog), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200 });
    }));
  });

  afterEach(() => {
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("renders the real v1 army editor with the footprint-aware grid and cloud controls", async () => {
    const { mountLegacyEditor } = await import("../src/legacy/main");
    const onSave = vi.fn();
    mountLegacyEditor({
      draft: draftWithArmy(), capabilities, selected: { section: "armies", index: 0 },
      onSave, onDraftChange: vi.fn(), onBack: vi.fn()
    });
    await vi.waitFor(() => expect(document.querySelector(".army-grid-cell")).not.toBeNull());
    expect(document.querySelector(".app-shell")).not.toBeNull();
    expect(document.querySelector(".army-grid-placement")).not.toBeNull();
    expect(document.querySelector('[data-action="save-package"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-action="save-package"]')!.click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("renders the v1 dialogue, quest and campaign screens with their real layouts", async () => {
    const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/v2/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetV2Document;
    const { mountLegacyEditor } = await import("../src/legacy/main");
    const mount = (section: string, index: number) => mountLegacyEditor({
      draft: fullSet, capabilities, selected: { section, index },
      onSave: vi.fn(), onDraftChange: vi.fn(), onBack: vi.fn()
    });
    mount("dialogues", 0);
    await vi.waitFor(() => expect(document.querySelector("[data-dialogue-node-graph]")).not.toBeNull());
    expect(document.querySelector(".preview-panel, .game-screen")).not.toBeNull();

    mount("quests", 0);
    await vi.waitFor(() => expect(document.querySelector('[data-bind="definition.title"]')).not.toBeNull());

    mount("campaigns", 0);
    await vi.waitFor(() => expect(document.querySelector(".campaign-floor-tab")).not.toBeNull());
  });

  it("round-trips a v2 draft through the v1 workspace without losing v2-only fields", () => {
    const draft = draftWithArmy();
    draft.campaigns.push({
      schemaVersion: 2, id: "campaign-1", name: localized("Campaign"), description: localized(""),
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
    const sideCar = emptySideCar();
    const workspace = draftToWorkspace(draft, sideCar, capabilities, { section: "armies", index: 0 });
    expect(workspace.armies[0].name).toBe("Test Army");
    expect(workspace.dialogues[0].sequence.nodes[0].actions).toHaveLength(0);
    workspace.armies[0].name = "Renamed Army";
    workspaceToDraft(draft, workspace, sideCar, capabilities);
    expect(draft.armies[0].name.default).toBe("Renamed Army");
    expect(draft.campaigns[0].settings.blessingsEnabled).toBe(true);
    expect(draft.dialogues[0].nodes[0].actions[0].meowEdit.defaultContinue).toBe(true);
  });
});
