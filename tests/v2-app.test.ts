import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBridgeActions, resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState
} from "../src/bridge-context";
import { mountApp } from "../src/v2/app";
import { emptyContentSet, localized, namedRef } from "../src/v2/factory";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));

interface Call { path: string; init?: RequestInit }

function makeValidDraft() {
  const set = emptyContentSet("published-set", "Published Set");
  set.campaigns.push({
    schemaVersion: 2, id: "mission-1", name: localized("Mission"), description: localized(""),
    boardPreviewUnitId: namedRef(capabilities.ids.units[0]), questIds: [],
    floors: [{ id: "floor-1", number: 1, mode: "authored", questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: ["Unit"], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 }, nodes: [], routes: [] }],
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

describe("v2-only editor app", () => {
  let container: HTMLElement;
  let calls: Call[];
  let sets: Array<{ setId: string; draftVersion: number; publishedPackageId?: string }>;

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    calls = [];
    sets = [
      { setId: "published-set", draftVersion: 3, publishedPackageId: "published-set-abcdef" },
      { setId: "fresh-set", draftVersion: 0 }
    ];
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      let body: unknown = { sets };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath === "/v1/editor/campaign-sets" && init?.method === "POST") body = { setId: "new-set", draftVersion: 1 };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST")
        body = { code: "draft_conflict", currentVersion: 7 };
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

  it("lists sets with status badges and no duplicate example section", () => {
    expect(container.textContent).toContain("Your content sets");
    expect(container.querySelector(".set-badge.published")?.textContent).toContain("Published");
    expect(container.querySelector('[data-open="published-set"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Live examples");
    expect(container.querySelector("[data-view-example]")).toBeNull();
  });

  it("opens an existing set into its overview, not the creation wizard", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-toggle-advanced]')).not.toBeNull());
    expect(container.textContent).toContain("1 campaigns");
    expect(container.textContent).not.toContain("Step 1 of 5");
    expect(calls.some(call => call.path === "/v1/editor/campaign-sets/published-set")).toBe(true);
  });

  it("starts the guided wizard only for a brand-new set", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    expect(container.textContent).toContain("Step 1 of 5");
    expect(container.querySelector('[data-v2-bind="set.setId"]')).not.toBeNull();
    expect(container.querySelector('[data-v2-bind="set.name.default"]')).not.toBeNull();
  });

  it("walks the guided wizard with one or two fields per step", () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    const setId = container.querySelector<HTMLInputElement>('[data-v2-bind="set.setId"]')!;
    setId.value = "new-set";
    setId.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 2 of 5");
    expect(container.querySelector('[data-v2-bind="campaigns[0].id"]')).not.toBeNull();
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 3 of 5");
    expect(container.querySelector('[data-v2-bind="campaigns[0].boardPreviewUnitId"]')).not.toBeNull();
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 4 of 5");
    expect(container.querySelector("[data-kind]")).not.toBeNull();
    expect(container.querySelector(".guided-advanced")).not.toBeNull();
  });

  it("adds all four content kinds from the guided step", () => {
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
      const savedDraft = localStorage.getItem("meowedit.v2.sets.author-1")!;
      expect(savedDraft).toContain(kind === "event" ? '"id":"event-1"' : kind + "-one");
      container.querySelector<HTMLElement>("[data-prev]")!.click();
    }
    const saved = localStorage.getItem("meowedit.v2.sets.author-1")!;
    expect(saved).toContain("dialogue-one");
    expect(saved).toContain("quest-one");
    expect(saved).toContain("army-one");
  });

  it("switches from compact to advanced controls inside the same set view", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-toggle-advanced]')).not.toBeNull());
    expect(container.querySelector('[data-toggle-advanced]')!.textContent).toContain("Advanced");
    container.querySelector<HTMLElement>('[data-toggle-advanced]')!.click();
    expect(container.querySelector("#advanced-host")).toBeNull();
    expect(container.querySelector('[data-detail-action]')).not.toBeNull();
    expect(container.querySelectorAll("[data-save]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-publish]")).toHaveLength(1);
    expect(container.querySelector('[data-toggle-advanced]')!.textContent).toContain("Compact");
  });

  it("adds and removes nested items in the advanced set view", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-toggle-advanced]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-toggle-advanced]')!.click();
    container.querySelector<HTMLElement>('[data-focus="campaigns"]')!.click();
    container.querySelector<HTMLElement>('[data-detail-action="add-node"]')!.click();
    expect(container.querySelectorAll('[data-detail-action="remove-node"]')).toHaveLength(1);
    container.querySelector<HTMLElement>('[data-detail-action="remove-node"]')!.click();
    expect(container.querySelectorAll('[data-detail-action="remove-node"]')).toHaveLength(0);
    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-add="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-detail-action="add-cell-pick"]')!.click();
    expect(container.querySelectorAll('[data-detail-action="remove-cell-pick"]')).toHaveLength(1);
  });

  it("saves a draft and publishes it from the set view", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-save]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Draft conflict"));
    expect(calls.some(call => call.init?.method === "POST" && call.path.includes("/campaign-sets/"))).toBe(true);
  });

  it("saves and publishes a valid set with warnings and hash verification", async () => {
    setBridgeFetch(async (requestPath, init) => {
      let body: unknown = { sets };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST") body = { draftVersion: 4 };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: makeValidDraft() };
      else if (requestPath.endsWith("/publish")) body = { packageId: "pkg-1", contentHash: "different" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-save]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Saved as private draft v4"));
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("HASH MISMATCH"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("resets tester progress"));
  });

  it("renames a set and shows local-only drafts without a backend call", async () => {
    localStorage.setItem("meowedit.v2.sets.author-1", JSON.stringify({
      "offline-set": { draft: makeValidDraft(), draftVersion: 0 }
    }));
    await mountApp(container);
    expect(container.querySelector(".set-badge.local")).not.toBeNull();
    const before = calls.length;
    container.querySelector<HTMLElement>('[data-open="offline-set"]')!.click();
    expect(calls.length).toBe(before);
    expect(container.textContent).toContain("Published Set");
  });

  it("hides deletion without permission and deletes when granted", async () => {
    expect(container.querySelector('[data-delete="published-set"]')).toBeNull();
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: true, actions: { signOut: vi.fn() } });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-delete="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Deleted published-set"));
    expect(calls.some(call => call.path.endsWith("/published-set") && call.init?.method === "DELETE")).toBe(true);
  });

  it("renders and edits every advanced section", async () => {
    const fullSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/v2/fixtures/valid-set.fixture.json"), "utf8"));
    setBridgeFetch(async (requestPath, init) => {
      let body: unknown = { sets };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST") body = { draftVersion: 4 };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: fullSet };
      else if (requestPath.endsWith("/publish")) body = { packageId: "pkg", contentHash: "x" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-toggle-advanced]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-toggle-advanced]')!.click();

    const sections = ["campaigns", "quests", "armies", "dialogues"];
    for (const section of sections) {
      container.querySelector<HTMLElement>('[data-focus="' + section + '"]')!.click();
      expect(container.querySelector('[data-detail-action]')).not.toBeNull();
    }

    container.querySelector<HTMLElement>('[data-focus="campaigns"]')!.click();
    for (const action of ["add-event", "add-condition", "add-action", "add-node", "add-route", "add-offer"]) {
      const button = container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]');
      expect(button, action).not.toBeNull();
      button!.click();
    }
    for (const action of ["remove-offer", "remove-route", "remove-node", "remove-action", "remove-condition", "remove-event"]) {
      const button = container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]');
      expect(button, action).not.toBeNull();
      button!.click();
    }

    container.querySelector<HTMLElement>('[data-focus="quests"]')!.click();
    for (const action of ["add-fetch-item", "add-battle-target", "add-distance", "add-effect"]) {
      container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]')!.click();
    }
    for (const action of ["remove-effect", "remove-distance", "remove-battle-target", "remove-fetch-item"]) {
      container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]')!.click();
    }

    container.querySelector<HTMLElement>('[data-focus="armies"]')!.click();
    container.querySelector<HTMLElement>('[data-detail-action="add-unit"]')!.click();
    container.querySelector<HTMLElement>('[data-detail-action="add-cell-pick"]')!.click();
    const bool = container.querySelector<HTMLInputElement>('[data-v2-bool]')!;
    bool.checked = true;
    bool.dispatchEvent(new Event("change", { bubbles: true }));
    const cells = container.querySelector<HTMLInputElement>('[data-v2-cells]')!;
    cells.value = "0,0; 1,2";
    cells.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>('[data-detail-action="remove-cell-pick"]')!.click();
    container.querySelector<HTMLElement>('[data-detail-action="remove-unit"]')!.click();

    container.querySelector<HTMLElement>('[data-focus="dialogues"]')!.click();
    for (const action of ["add-speaker", "add-segment", "add-dialogue-action", "add-dialogue-node"]) {
      container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]')!.click();
    }
    for (const action of ["remove-dialogue-action", "remove-segment", "remove-speaker", "remove-dialogue-node"]) {
      container.querySelector<HTMLElement>('[data-detail-action="' + action + '"]')!.click();
    }
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).toContain("campaigns");
  });

  it("falls back to the checked-in capability manifest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(capabilities), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities") throw new Error("No capabilities endpoint");
      return new Response(JSON.stringify({ sets }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    expect(container.textContent).toContain("Your content sets");
  });

  it("signs out and returns to the set browser", async () => {
    container.querySelector<HTMLElement>("[data-sign-out]")!.click();
    expect(getBridgeActions()?.signOut).toHaveBeenCalled();
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-back-browser]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-back-browser]")!.click();
    expect(container.textContent).toContain("Your content sets");
  });
});
