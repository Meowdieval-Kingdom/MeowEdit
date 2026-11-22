import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBridgeActions, resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState
} from "../src/bridge-context";
import { mountApp } from "../src/v2/app";
import { emptyContentSet, localized, namedRef } from "../src/v2/factory";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));
const validSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/v2/fixtures/valid-set.fixture.json"), "utf8"));

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
    sets = [{ setId: "published-set", draftVersion: 3, publishedPackageId: "published-set-abcdef" }];
    setBridgeState({ userId: "author-1", canPublish: true, actions: { signOut: vi.fn() } });
    setBridgeFetch(async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      let body: unknown = { sets: [] };
      if (requestPath === "/v1/editor/capabilities") body = capabilities;
      else if (requestPath === "/v1/editor/campaign-sets" && init?.method === "POST")
        body = { setId: "new-set", draftVersion: 1 };
      else if (requestPath === "/v1/editor/campaign-sets") body = { sets };
      else if (requestPath.includes("/v1/editor/campaign-sets/") && !requestPath.endsWith("/publish"))
        body = { setId: "published-set", draftVersion: 3, draft: validSet };
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

  it("shows backend sets with draft and published badges", () => {
    expect(container.textContent).toContain("Your content sets");
    expect(container.textContent).toContain("published-set");
    expect(container.querySelector(".set-badge.published")?.textContent).toContain("Published");
    expect(container.querySelector('[data-open="published-set"]')).not.toBeNull();
    expect(calls.some(call => call.path === "/v1/editor/campaign-sets")).toBe(true);
  });

  it("marks a set with no server or local draft as new", async () => {
    sets = [...sets, { setId: "fresh-set", draftVersion: 0 }];
    await mountApp(container);
    const row = container.querySelector<HTMLElement>('[data-open="fresh-set"]')!.closest(".set-row")!;
    expect(row.textContent).toContain("New");
  });

  it("opens an existing set from the backend", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Board character"));
    expect(calls.some(call => call.path === "/v1/editor/campaign-sets/published-set")).toBe(true);
    expect(container.querySelector(".set-badge.published")).not.toBeNull();
    expect(container.querySelector("[data-advanced]")).not.toBeNull();
  });

  it("guides a new set through a few focused fields per step", async () => {
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    expect(container.textContent).toContain("Step 1 of 5");
    const setId = container.querySelector<HTMLInputElement>('[data-v2-bind="set.setId"]')!;
    setId.value = "new-set";
    setId.dispatchEvent(new Event("change", { bubbles: true }));
    const name = container.querySelector<HTMLInputElement>('[data-v2-bind="set.name.default"]')!;
    name.value = "New Set";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 2 of 5");
    expect(container.querySelector('[data-v2-bind="campaigns[0].id"]')).not.toBeNull();
    expect(container.querySelector("[data-advanced]")).not.toBeNull();
  });

  it("saves a private draft and then publishes it", async () => {
    sets = [...sets, { setId: "new-set", draftVersion: 0 }];
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-open="new-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Step 1 of 5"));
    const setName = container.querySelector<HTMLInputElement>('[data-v2-bind="set.name.default"]')!;
    setName.value = "New Set";
    setName.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 2 of 5");
    const campaignId = container.querySelector<HTMLInputElement>('[data-v2-bind="campaigns[0].id"]')!;
    campaignId.value = "mission-1";
    campaignId.dispatchEvent(new Event("change", { bubbles: true }));
    const campaignName = container.querySelector<HTMLInputElement>('[data-v2-bind="campaigns[0].name.default"]')!;
    campaignName.value = "Mission One";
    campaignName.dispatchEvent(new Event("change", { bubbles: true }));
    // Walk through board character and content to the review step.
    for (let index = 0; index < 3; index++) container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Review & publish");
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Saved as private draft"));
    expect(container.querySelector(".set-badge.draft")?.textContent).toContain("Draft v1");
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Published"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("resets tester progress"));
    expect(calls.some(call => call.path.endsWith("/publish"))).toBe(true);
  });

  it("shows local-only drafts and opens them without a backend call", async () => {
    localStorage.setItem("meowedit.v2.sets.author-1", JSON.stringify({
      "offline-set": { draft: validSet, draftVersion: 0 }
    }));
    await mountApp(container);
    expect(container.querySelector(".set-badge.local")?.textContent).toContain("Local only");
    container.querySelector<HTMLElement>('[data-open="offline-set"]')!.click();
    expect(container.textContent).toContain("Step 1 of 5");
    expect(calls.some(call => call.path === "/v1/editor/campaign-sets/offline-set")).toBe(false);
  });

  it("adds each content kind from the guided step", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Board character"));
    container.querySelector<HTMLElement>("[data-next]")!.click();
    expect(container.textContent).toContain("Step 4 of 5");
    for (const kind of ["dialogue", "quest", "army", "event"] as const) {
      container.querySelector<HTMLElement>('[data-kind="' + kind + '"]')!.click();
      const title = container.querySelector<HTMLInputElement>('[data-v2-bind="draftTitle"]');
      if (title) {
        title.value = kind + "-one";
        title.dispatchEvent(new Event("change", { bubbles: true }));
      }
      container.querySelector<HTMLElement>("[data-next]")!.click();
      container.querySelector<HTMLElement>("[data-prev]")!.click();
      expect(container.textContent).toContain(kind);
    }
    const draft = JSON.parse(localStorage.getItem("meowedit.v2.sets.author-1")!);
    expect(draft["published-set"].draft.dialogues).toHaveLength(2);
    expect(draft["published-set"].draft.quests).toHaveLength(2);
    expect(draft["published-set"].draft.armies).toHaveLength(2);
    expect(draft["published-set"].draft.campaigns[0].events.length).toBeGreaterThanOrEqual(2);
  });

  it("opens the detailed editor and returns to the guided flow", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-advanced]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-advanced]")!.click();
    await vi.waitFor(() => expect(container.querySelector("#advanced-host .v2-editor")).not.toBeNull());
    container.querySelector<HTMLElement>('[data-v2-action="back"]')!.click();
    expect(container.textContent).toContain("Step 3 of 5");
  });

  it("handles save conflicts and a cancelled publish", async () => {
    setBridgeFetch(async (requestPath, init) => {
      const body = requestPath.includes("/campaign-sets/") && init?.method === "POST"
        ? { code: "draft_conflict", currentVersion: 7 }
        : requestPath.includes("/campaign-sets/") && !requestPath.endsWith("/publish")
          ? { setId: "published-set", draftVersion: 3, draft: makeValidDraft() }
          : requestPath.endsWith("/campaign-sets")
            ? { code: "draft_conflict", currentVersion: 7 }
            : requestPath.endsWith("/publish") ? { packageId: "x" } : { sets };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Step 3 of 5"));
    for (let index = 0; index < 2; index++) container.querySelector<HTMLElement>("[data-next]")!.click();
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Draft conflict"));

    vi.stubGlobal("confirm", vi.fn(() => false));
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Publish cancelled"));
  });

  it("signs out and returns to the set browser", async () => {
    container.querySelector<HTMLElement>("[data-sign-out]")!.click();
    expect(getBridgeActions()?.signOut).toHaveBeenCalled();
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-back-browser]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-back-browser]")!.click();
    expect(container.textContent).toContain("Your content sets");
  });

  it("renames a set through a version-guarded save", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "Renamed Set"));
    container.querySelector<HTMLElement>('[data-rename="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Renamed to Renamed Set"));
    const save = calls.find(call => call.init?.method === "POST" && call.path.includes("/campaign-sets/"));
    expect(save).toBeDefined();
    expect(JSON.parse(String(save!.init?.body)).draft.set.name.default).toBe("Renamed Set");
  });

  it("hides deletion without permission and deletes when granted", async () => {
    expect(container.querySelector('[data-delete="published-set"]')).toBeNull();
    setBridgeState({
      userId: "author-1", canPublish: true, canDeleteSets: true, actions: { signOut: vi.fn() }
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-delete="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Deleted published-set"));
    expect(calls.some(call => call.path.endsWith("/published-set") && call.init?.method === "DELETE")).toBe(true);
  });

  it("blocks upload while the draft has validation errors", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-next]")).not.toBeNull());
    for (let index = 0; index < 2; index++) container.querySelector<HTMLElement>("[data-next]")!.click();
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Fix the validation issues"));
    expect(calls.some(call => call.init?.method === "POST")).toBe(false);
  });

  it("keeps a set when deletion is cancelled", async () => {
    setBridgeState({
      userId: "author-1", canPublish: true, canDeleteSets: true, actions: { signOut: vi.fn() }
    });
    vi.stubGlobal("confirm", vi.fn(() => false));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-delete="published-set"]')!.click();
    expect(calls.some(call => call.init?.method === "DELETE")).toBe(false);
    expect(container.querySelector('[data-open="published-set"]')).not.toBeNull();
  });

  it("reports a failed example lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(capabilities), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    setBridgeFetch(async () => {
      throw new Error("Catalog unavailable");
    });
    await mountApp(container);
    expect(container.textContent).toContain("No published content is available yet.");
  });

  it("lists live published sets as examples and inspects one", async () => {
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/content/campaigns")
        return new Response(JSON.stringify({ sets: [{
          setId: "example-set", packageId: "example-set-abc", contentHash: "hash", publishedAt: "2026-01-01"
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath === "/v1/content/campaigns/example-set-abc")
        return new Response(JSON.stringify({ files: [{
          path: "campaigns/Campaigns.json",
          content: JSON.stringify({ campaigns: [{ id: "mission", name: { default: "Example Mission" } }] })
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ sets: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    expect(container.textContent).toContain("Live examples");
    expect(container.querySelector('[data-view-example="example-set-abc"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-view-example="example-set-abc"]')!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Example Mission")));
  });
});
