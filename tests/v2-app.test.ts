import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBridgeActions, resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState
} from "../src/bridge-context";
import { mountApp } from "../src/v2/app";
import { emptyContentSet, localized, namedRef } from "../src/v2/factory";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));
const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/v2/fixtures/valid-set.fixture.json"), "utf8"));

interface Call { path: string; init?: RequestInit }

function makeValidDraft() {
  const set = emptyContentSet("published-set", "Published Set");
  set.campaigns.push({
    schemaVersion: 2, id: "mission-1", name: localized("Mission"), description: localized(""),
    boardPreviewUnitId: namedRef(capabilities.ids.units[0]), questIds: [],
    floors: [{ id: "floor-1", number: 1, mode: "authored", questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: ["Unit"], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 },
      nodes: [{
        id: "start", label: localized("Start"), kind: "Start", x: 0, y: 0,
        armyId: namedRef("mission-1"), questId: namedRef("mission-1"),
        enemyFactionId: namedRef(capabilities.ids.factions[0]), rewardKind: "Sardines", rewardAmount: 0,
        rewardContentId: namedRef("mission-1"), shopOfferMode: "generated", shopOffers: []
      }], routes: [] }],
    events: [],
    settings: {
      startingLives: 3, startingSardines: 10, startingNodeCount: 12,
      playerFactionId: namedRef(capabilities.ids.factions[0]), factionSelectionEnabled: true,
      battleShopEnabled: true, shopPoolKinds: ["Unit"], questNodeCountPerRandomFloor: 2,
      shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
      blessingsEnabled: true, restoreArmyAfterLoss: true
    }
  });
  set.set.campaignOrder = ["mission-1"];
  return set;
}

async function mountWithDraft(container: HTMLElement, draft: unknown, draftVersion = 3): Promise<void> {
  setBridgeFetch(async (requestPath, init) => {
    let body: unknown = { sets: [{ setId: "published-set", draftVersion }] };
    if (requestPath === "/v1/editor/capabilities") body = capabilities;
    else if (requestPath === "/v1/editor/campaign-sets" && init?.method === "POST") body = { setId: "new-set", draftVersion: 1 };
    else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST") body = { draftVersion: draftVersion + 1 };
    else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
      body = { setId: "published-set", draftVersion, draft };
    else if (requestPath.endsWith("/publish")) body = { packageId: "pkg-1", contentHash: "different" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  await mountApp(container);
}

async function openPublished(container: HTMLElement): Promise<void> {
  container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
  await vi.waitFor(() => expect(container.querySelector('[data-add="campaigns"]')).not.toBeNull());
}

describe("v2-only editor app", () => {
  let container: HTMLElement;
  let calls: Call[];

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    calls = [];
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      let body: unknown = { sets: [
        { setId: "published-set", draftVersion: 3, publishedPackageId: "published-set-abcdef" },
        { setId: "fresh-set", draftVersion: 0 }
      ] };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath === "/v1/editor/campaign-sets" && init?.method === "POST") body = { setId: "new-set", draftVersion: 1 };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST") body = { code: "draft_conflict", currentVersion: 7 };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: makeValidDraft() };
      else if (requestPath.endsWith("/publish")) body = { packageId: "published-set-newhash", contentHash: "mismatch" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
  });

  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("lists sets once with status badges and no examples section", () => {
    expect(container.textContent).toContain("Your content sets");
    expect(container.querySelector(".set-badge.published")?.textContent).toContain("Published");
    expect(container.textContent).not.toContain("Live examples");
    expect(container.querySelector("[data-view-example]")).toBeNull();
  });

  it("opens an existing set to a per-category list, not a wizard", async () => {
    await openPublished(container);
    expect(container.textContent).not.toContain("Step 1 of 5");
    expect(container.querySelectorAll("[data-entry-edit]")).toHaveLength(1);
    expect(container.querySelector('[data-add="campaigns"]')).not.toBeNull();
    expect(container.textContent).toContain("Mission");
  });

  it("shows an empty list for a category with no entries", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    expect(container.textContent).toContain("No quests yet");
    expect(container.querySelectorAll("[data-entry-edit]")).toHaveLength(0);
  });

  it("starts the guided wizard only for a brand-new set", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    expect(container.textContent).toContain("Step 1 of 5");
    expect(container.querySelector('[data-v2-bind="set.setId"]')).not.toBeNull();
  });

  it("walks the guided wizard with one or two fields per step", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    const setId = container.querySelector<HTMLInputElement>('[data-v2-bind="set.setId"]')!;
    setId.value = "new-set";
    setId.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 2 of 5");
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 3 of 5");
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 4 of 5");
    expect(container.querySelector(".guided-advanced")).not.toBeNull();
  });

  it("adds an entry through a two-field guided form", async () => {
    await openPublished(container);
    for (const [section, name] of [["quests", "Find Key"], ["armies", "Guards"], ["dialogues", "Elder Intro"]] as const) {
      container.querySelector<HTMLElement>('[data-focus="' + section + '"]')!.click();
      container.querySelector<HTMLElement>('[data-add="' + section + '"]')!.click();
      expect(container.querySelectorAll("[data-v2-add]")).toHaveLength(2);
      const nameInput = container.querySelector<HTMLInputElement>('[data-v2-add="name"]')!;
      nameInput.value = name;
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLElement>("[data-add-create]")!.click();
      expect(container.querySelector("[data-entry-back]")).not.toBeNull();
      expect(localStorage.getItem("meowedit.v2.sets.author-1")).toContain(name);
      container.querySelector<HTMLElement>("[data-entry-back]")!.click();
      expect(container.querySelectorAll("[data-entry-edit]")).toHaveLength(1);
    }
  });

  it("edits exactly one entry in the advanced view and returns to the list", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    expect(container.querySelector('[data-entry-back]')).not.toBeNull();
    const fields = container.querySelectorAll("[data-v2-bind]");
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.length).toBeLessThan(30);
    const name = container.querySelector<HTMLInputElement>('[data-v2-bind="campaigns[0].name.default"]')!;
    name.value = "Renamed Mission";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("meowedit.v2.sets.author-1")!)["published-set"].draft.campaigns[0].name.default).toBe("Renamed Mission");
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();
    expect(container.textContent).toContain("Renamed Mission");
    expect(container.querySelector('[data-add="campaigns"]')).not.toBeNull();
  });

  it("removes an entry from the list", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-remove="0"]')!.click();
    expect(window.confirm).toHaveBeenCalled();
    expect(container.querySelectorAll("[data-entry-edit]")).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("meowedit.v2.sets.author-1")!)["published-set"].draft.campaigns).toHaveLength(0);
  });

  it("adds and removes nested items only inside the selected entry", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.querySelector('[data-rich-action="toggle-node"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-rich-action="toggle-node"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="connect-node"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="add-event"]')!.click();
    expect(container.querySelectorAll('[data-rich-action="remove-event"]')).toHaveLength(1);
    container.querySelector<HTMLElement>('[data-rich-action="remove-event"]')!.click();
    expect(container.querySelectorAll('[data-rich-action="remove-event"]')).toHaveLength(0);
  });

  it("edits nested quest, army and dialogue fields consistently", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    for (const section of ["quests", "armies", "dialogues"] as const) {
      container.querySelector<HTMLElement>('[data-focus="' + section + '"]')!.click();
      container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
      expect(container.querySelectorAll("[data-v2-bind]").length).toBeGreaterThan(0);
      expect(container.querySelectorAll("[data-rich-action]").length).toBeGreaterThan(0);
      container.querySelector<HTMLElement>('[data-entry-back]')!.click();
      expect(container.querySelector('[data-add="' + section + '"]')).not.toBeNull();
    }
  });

  it("lists and edits every content type with its nested controls", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    for (const section of ["campaigns", "quests", "armies", "dialogues"] as const) {
      container.querySelector<HTMLElement>('[data-focus="' + section + '"]')!.click();
      expect(container.querySelectorAll("[data-entry-edit]").length).toBeGreaterThan(0);
      container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
      container.querySelector<HTMLElement>("[data-toggle-raw]")!.click();
      expect(container.querySelectorAll("[data-v2-bind]").length).toBeGreaterThan(0);
      for (const action of ["add-condition", "add-action", "add-node", "add-route", "add-offer",
        "add-fetch-item", "add-battle-target", "add-distance", "add-effect", "add-unit", "add-cell-pick",
        "add-speaker", "add-segment", "add-dialogue-action", "add-dialogue-node"]) {
        const button = container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]');
        if (button) button.click();
      }
      for (const action of ["remove-condition", "remove-action", "remove-node", "remove-route", "remove-offer",
        "remove-fetch-item", "remove-battle-target", "remove-distance", "remove-effect", "remove-unit",
        "remove-cell-pick", "remove-speaker", "remove-segment", "remove-dialogue-action", "remove-dialogue-node"]) {
        const buttons = container.querySelectorAll<HTMLElement>('[data-detail-action="' + action + '"]');
        if (buttons.length) buttons[buttons.length - 1].click();
      }
      const bool = container.querySelector<HTMLInputElement>("[data-v2-bool]");
      if (bool) {
        bool.checked = !bool.checked;
        bool.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const attr of ["v2-list", "v2-ref", "v2-cells", "v2-bane-cells"]) {
        const field = container.querySelector<HTMLInputElement>('[data-' + attr + ']');
        if (!field) continue;
        field.value = attr === "v2-cells" || attr === "v2-bane-cells" ? "0,0; 1,2" : "sample-id";
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      container.querySelector<HTMLElement>('[data-entry-back]')!.click();
    }
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("provides rich guided editors for all four categories", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    expect(container.querySelector(".guided-progress")).not.toBeNull();
    for (let index = 0; index < 6; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.textContent).toContain("Review");
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();

    container.querySelector<HTMLElement>('[data-focus="dialogues"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    expect(container.querySelector(".dialogue-preview")).not.toBeNull();
    container.querySelector<HTMLElement>('[data-rich-action="add-dialogue-node"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="add-segment"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="add-speaker"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();

    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.querySelector('[data-rich-action="add-army-unit"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.querySelectorAll(".army-cell").length).toBe(25);
    container.querySelector<HTMLElement>('[data-rich-action="toggle-cell"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="add-spell"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();

    container.querySelector<HTMLElement>('[data-focus="campaigns"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.querySelectorAll(".campaign-cell").length).toBe(25);
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("shows objective-specific quest forms and decision previews", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    for (const kind of ["Fetch", "Battle", "KillCount", "Timer"]) {
      const objective = container.querySelector<HTMLSelectElement>('[data-v2-bind="quests[0].objectiveKind"]')!;
      objective.value = kind;
      objective.dispatchEvent(new Event("change", { bubbles: true }));
      expect(container.querySelectorAll("[data-rich-action]").length).toBeGreaterThan(0);
    }
    for (const action of ["add-fetch-item", "add-battle-target", "add-distance", "add-effect"]) {
      const button = container.querySelector<HTMLElement>('[data-rich-action="' + action + '"]');
      if (button) button.click();
    }
    container.querySelector<HTMLElement>('[data-entry-back]')!.click();

    container.querySelector<HTMLElement>('[data-focus="dialogues"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    expect(container.querySelector('[data-rich-action="preview-reset"]')).not.toBeNull();
    const choice = container.querySelector<HTMLElement>('[data-rich-action="preview-choice"]');
    if (choice) choice.click();
    container.querySelector<HTMLElement>('[data-rich-action="preview-reset"]')!.click();
  });

  it("walks every campaign step and its controls", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    for (let step = 0; step < 8; step++) {
      expect(container.querySelector("[data-rich-action]")).not.toBeNull();
      for (const action of ["add-floor", "toggle-node", "toggle-route-direction",
        "toggle-quest", "add-event", "remove-event", "remove-node", "remove-floor"]) {
        const button = container.querySelector<HTMLElement>('[data-rich-action="' + action + '"]');
        if (button) button.click();
      }
      const checkboxes = container.querySelectorAll<HTMLInputElement>("[data-v2-bool]");
      for (const box of checkboxes) {
        box.checked = !box.checked;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (step < 7) container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    }
    expect(container.textContent).toContain("Review");
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("supports the dialogue moment map and choice connections", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="dialogues"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    expect(container.querySelectorAll(".dialogue-graph-node").length).toBeGreaterThan(0);
    container.querySelector<HTMLElement>('[data-rich-action="zoom-in"]')!.click();
    expect(container.textContent).toContain("110%");
    container.querySelector<HTMLElement>('[data-rich-action="zoom-reset"]')!.click();
    const connect = container.querySelector<HTMLElement>('[data-rich-action="connect-choice"]');
    if (connect) {
      connect.click();
      const target = container.querySelectorAll<HTMLElement>('[data-rich-action="select-node"]')[1];
      if (target) target.click();
    }
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("edits per-entry spells and cell targets", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const addUnit = container.querySelector<HTMLElement>('[data-rich-action="add-army-unit"]');
    if (addUnit) addUnit.click();
    const addSpell = container.querySelector<HTMLElement>('[data-rich-action="add-unit-spell"]');
    if (addSpell) addSpell.click();
    for (let index = 0; index < 3; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const configure = container.querySelector<HTMLElement>('[data-rich-action="configure-cells"]');
    if (configure) {
      configure.click();
      expect(container.querySelector(".cell-focus")).not.toBeNull();
      const target = container.querySelector<HTMLElement>('[data-rich-action="toggle-cell-target"]');
      if (target) target.click();
      container.querySelector<HTMLElement>('[data-rich-action="cell-region"][data-region="bane"]')!.click();
      container.querySelector<HTMLElement>('[data-rich-action="close-cell-focus"]')!.click();
      expect(container.querySelector(".cell-focus")).toBeNull();
    }
  });

  it("uses Enter to advance guided steps and restores related-record context", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    const field = container.querySelector<HTMLInputElement>(".guided-step input[data-v2-bind]")!;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.querySelector(".guided-progress .current")).not.toBeNull();

    for (let index = 0; index < 2; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const createArmy = container.querySelector<HTMLElement>('[data-rich-action="create-node-army"]');
    if (createArmy) {
      createArmy.click();
      expect(container.textContent).toContain("Return to Campaign");
      container.querySelector<HTMLElement>("[data-return-to-parent]")!.click();
      expect(container.textContent).toContain("Edit Campaign");
    }
  });

  it("creates related armies and dialogues from quest fields", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const createArmy = container.querySelector<HTMLElement>('[data-rich-action="create-battle-army"]');
    if (createArmy) {
      createArmy.click();
      expect(container.textContent).toContain("Return to Quest");
      container.querySelector<HTMLElement>("[data-return-to-parent]")!.click();
    }
    for (let index = 0; index < 5; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const createDialogue = container.querySelector<HTMLElement>('[data-rich-action="create-dialogue-link"]');
    if (createDialogue) {
      createDialogue.click();
      expect(container.textContent).toContain("Return to Quest");
      container.querySelector<HTMLElement>("[data-return-to-parent]")!.click();
    }
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("blocks upload while validation fails", async () => {
    const broken = structuredClone(fullSet);
    broken.campaigns[0].boardPreviewUnitId.id = "missing-unit";
    setBridgeFetch(async requestPath => {
      let body: unknown = { sets: [{ setId: "published-set", draftVersion: 3 }] };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: broken };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    await openPublished(container);
    container.querySelector<HTMLElement>("[data-save]")!.click();
    expect(container.textContent).toContain("Fix the validation issues");
  });

  it("toggles quest pool membership and route direction", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    for (let index = 0; index < 4; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const quest = container.querySelector<HTMLElement>('[data-rich-action="toggle-quest"]');
    if (quest) {
      quest.click();
      container.querySelector<HTMLElement>('[data-rich-action="toggle-quest"]')!.click();
    }
    for (let index = 0; index < 2; index++)
      container.querySelector<HTMLElement>('[data-rich-action="prev-step"]')!.click();
    const direction = container.querySelector<HTMLElement>('[data-rich-action="toggle-route-direction"]');
    if (direction) direction.click();
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).not.toBeNull();
  });

  it("supports campaign approach choice, ability filters and route distances", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="set-approach"][data-approach="settings-only"]')!.click();
    expect(container.querySelectorAll(".guided-progress span")).toHaveLength(5);
    container.querySelector<HTMLElement>('[data-rich-action="set-approach"][data-approach="custom"]')!.click();
    expect(container.querySelectorAll(".guided-progress span")).toHaveLength(8);

    container.querySelector<HTMLElement>("[data-entry-back]")!.click();
    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    for (let index = 0; index < 3; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="ability-filter"][data-filter="field"]')!.click();
    expect(container.textContent).toContain("Field effects ✓");

    container.querySelector<HTMLElement>("[data-entry-back]")!.click();
    container.querySelector<HTMLElement>('[data-focus="campaigns"]')!.click();
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    for (let index = 0; index < 2; index++)
      container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    expect(container.textContent).toContain("step(s)");
  });

  it("cancels a guided add without changing the draft", async () => {
    await openPublished(container);
    const before = localStorage.getItem("meowedit.v2.sets.author-1");
    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    container.querySelector<HTMLElement>('[data-add="quests"]')!.click();
    container.querySelector<HTMLElement>("[data-add-cancel]")!.click();
    expect(container.querySelectorAll("[data-entry-edit]")).toHaveLength(0);
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).toBe(before);
  });

  it("blocks upload with validation errors and saves/publishes valid drafts", async () => {
    await mountWithDraft(container, makeValidDraft());
    await openPublished(container);
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Saved as private draft v4"));
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("HASH MISMATCH"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("resets tester progress"));
    expect(container.querySelectorAll("[data-save]")).toHaveLength(1);
  });

  it("renames and deletes sets with the permission gate", async () => {
    localStorage.setItem("meowedit.v2.sets.author-1", JSON.stringify({
      "offline-set": { draft: makeValidDraft(), draftVersion: 0 }
    }));
    await mountApp(container);
    expect(container.querySelector(".set-badge.local")).not.toBeNull();
    expect(container.querySelector('[data-delete="published-set"]')).toBeNull();
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: true, actions: { signOut: vi.fn() } });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-delete="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Deleted published-set"));
  });

  it("adds all content kinds from the creation wizard", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    for (let index = 0; index < 3; index++) container.querySelector<HTMLElement>("[data-next]")!.click();
    for (const kind of ["dialogue", "quest", "army", "event"] as const) {
      container.querySelector<HTMLElement>('[data-kind="' + kind + '"]')!.click();
      const title = container.querySelector<HTMLInputElement>('[data-v2-bind="draftTitle"]');
      if (title) {
        title.value = kind + "-one";
        title.dispatchEvent(new Event("change", { bubbles: true }));
      }
      container.querySelector<HTMLElement>("[data-next]")!.click();
      container.querySelector<HTMLElement>("[data-prev]")!.click();
    }
    const saved = localStorage.getItem("meowedit.v2.sets.author-1")!;
    expect(saved).toContain("dialogue-one");
    expect(saved).toContain("quest-one");
    expect(saved).toContain("army-one");
    expect(saved).toContain('"trigger":"campaign-start"');
  });

  it("handles draft conflicts and a cancelled publish", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Draft conflict"));
    vi.stubGlobal("confirm", vi.fn(() => false));
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Publish cancelled"));
  });

  it("falls back to the checked-in capability manifest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(capabilities), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities") throw new Error("No endpoint");
      return new Response(JSON.stringify({ sets: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    expect(container.textContent).toContain("No content sets yet");
  });

  it("renames a set through a version-guarded save", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "Renamed Set"));
    container.querySelector<HTMLElement>('[data-rename="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Renamed to Renamed Set"));
    expect(calls.some(call => call.init?.method === "POST" && call.path.includes("/campaign-sets/"))).toBe(true);
  });

  it("restores the Help preference and last set across remounts", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>("[data-toggle-help]")!.click();
    expect(container.querySelector(".editor-main")?.classList.contains("help-visible")).toBe(true);
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    await mountApp(container);
    expect(container.textContent).toContain("Mission");
    expect(container.textContent).toContain("Hide help");
  });

  it("shows the app version next to sign out and no Bridge branding", async () => {
    expect(container.textContent).toContain("v0.2.0");
    expect(container.textContent).not.toMatch(/tactics bridge/i);
  });

  it("applies suggested reference fixes from the validation panel", async () => {
    const stale = structuredClone(fullSet);
    stale.campaigns[0].boardPreviewUnitId.id = "Cats/Fighter/1";
    setBridgeFetch(async requestPath => {
      let body: unknown = { sets: [{ setId: "published-set", draftVersion: 3 }] };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: stale };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    await openPublished(container);
    const fix = container.querySelector<HTMLElement>("[data-fix-ref]");
    expect(fix).not.toBeNull();
    const path = fix!.dataset.fixRef!;
    const suggestion = fix!.dataset.suggestion!;
    fix!.click();
    const saved = JSON.parse(localStorage.getItem("meowedit.v2.sets.author-1")!)["published-set"].draft;
    const parts = path.replace(/\.id$/, "").replace(/\[(\d+)\]/g, ".$1").split(".");
    let value: any = saved;
    for (const part of parts) value = value[part];
    expect(value.id ?? value).toBe(suggestion);
  });

  it("signs out and returns to the set browser", async () => {
    container.querySelector<HTMLElement>("[data-sign-out]")!.click();
    expect(getBridgeActions()?.signOut).toHaveBeenCalled();
    await openPublished(container);
    container.querySelector<HTMLElement>("[data-back-browser]")!.click();
    expect(container.textContent).toContain("Your content sets");
  });

  it("opens the restored classic editor from a set entry", async () => {
    await mountWithDraft(container, fullSet);
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-classic-edit="0"]')!.click();
    await vi.waitFor(() => expect(container.querySelector(".app-shell")).not.toBeNull());
    expect(container.querySelector('[data-action="save-package"]')).not.toBeNull();
    expect(container.querySelector('[data-action="open-v2-editor"]')).not.toBeNull();
  });

  it("does not open a stale local copy when the saved draft cannot be loaded", async () => {
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(capabilities), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.includes("/v1/editor/campaign-sets/")) throw new Error("network down");
      return new Response(JSON.stringify({ sets: [{ setId: "published-set", draftVersion: 3 }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    });
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("saved draft could not be loaded"));
    expect(container.querySelector('[data-add="campaigns"]')).toBeNull();
  });

  it("rejects an invalid capability manifest from both the API and the fallback file", async () => {
    const invalid = new Response(JSON.stringify({ ...capabilities, ids: undefined }),
      { status: 200, headers: { "content-type": "application/json" } });
    setBridgeFetch(async requestPath => requestPath === "/v1/editor/capabilities" ? invalid : invalid);
    vi.stubGlobal("fetch", vi.fn(async () => invalid.clone()));
    await expect(mountApp(document.createElement("div"))).rejects.toThrow("capability manifest is invalid");
  });

  it("only advances the guided flow from fields inside the guided step", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    const stray = document.createElement("input");
    container.append(stray);
    stray.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.textContent).toContain("Step 1 of 5");
    const field = container.querySelector<HTMLInputElement>('[data-v2-bind="set.setId"]')!;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.textContent).toContain("Step 2 of 5");
  });

  it("restores the last edited entry and guided step after a remount", async () => {
    await openPublished(container);
    container.querySelector<HTMLElement>('[data-entry-edit="0"]')!.click();
    container.querySelector<HTMLElement>('[data-rich-action="next-step"]')!.click();
    const session = JSON.parse(localStorage.getItem("meowedit.v2.session.author-1")!);
    expect(session.entry).toMatchObject({ section: "campaigns", index: 0 });
    expect(session.rich.step).toBe(1);
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    await mountApp(container);
    expect(container.querySelector(".v2-details")).not.toBeNull();
    expect(container.textContent).toContain("Edit Campaign");
  });
});
