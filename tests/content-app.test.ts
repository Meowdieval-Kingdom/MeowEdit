import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountApp } from "../src/content/app";
import { emptyContentSet, localized, namedRef } from "../src/content/factory";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));

function makeValidDraft() {
  const set = emptyContentSet("published-set", "Published Set");
  set.campaigns.push({
    schemaVersion: 2, id: "mission-1", name: localized("Mission"), description: localized(""),
    boardPreviewUnitId: namedRef(capabilities.ids.units[0]), questIds: [],
    floors: [{ id: "floor-1", number: 1, mode: "authored", questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: ["Unit"], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 },
      nodes: [], routes: [] }],
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

function respond(requestPath: string, init: RequestInit | undefined, draft: unknown = makeValidDraft(), version = 3) {
  let body: unknown = { sets: [
    { setId: "published-set", draftVersion: version, publishedPackageId: "published-set-abcdef" },
    { setId: "fresh-set", draftVersion: 0 }
  ] };
  if (requestPath === "/v1/editor/capabilities") body = capabilities;
  else if (requestPath === "/v1/editor/campaign-sets" && init?.method === "POST") body = { setId: "new-set", draftVersion: 1 };
  else if (requestPath.includes("/v1/editor/campaign-sets/") && init?.method === "POST") body = { draftVersion: version + 1 };
  else if (requestPath.endsWith("/publish")) body = { packageId: "pkg-1", contentHash: "different" };
  else if (requestPath.includes("/v1/editor/campaign-sets/")) body = { setId: "published-set", draftVersion: version, draft };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("set manager and single editor", () => {
  let container: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async (requestPath, init) => respond(requestPath, init));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
  });

  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("lists sets with status badges and no examples section", () => {
    expect(container.textContent).toContain("Sets");
    expect(container.querySelector(".set-badge.published")).not.toBeNull();
    expect(container.querySelector(".set-badge.local")).not.toBeNull();
    expect(container.textContent).not.toContain("Import examples");
  });

  it("opens a set to a read-only dashboard with a single editor entry point", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-open-editor]")).not.toBeNull());
    expect(container.textContent).toContain("Published Set");
    expect(container.querySelectorAll("[data-edit]").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Quick fields");
    expect(container.querySelector("[data-toggle-raw]")).toBeNull();
  });

  it("creates a set from prompts and opens its dashboard", async () => {
    vi.stubGlobal("prompt", vi.fn((_message: string, fallback?: string) => fallback ?? "new-set"));
    container.querySelector<HTMLElement>("[data-new-set]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("new-set"));
    expect(localStorage.getItem("meowedit.v2.sets.author-1")).toContain("new-set");
  });

  it("opens the classic editor from an entry and returns to the dashboard", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-open-editor]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-edit='campaigns:0']")!.click();
    await vi.waitFor(() => expect(container.querySelector(".app-shell")).not.toBeNull());
    expect(container.querySelector('[data-action="open-content-editor"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-open-editor]")).not.toBeNull());
  });

  it("reports a hash mismatch when publishing", async () => {
    const validSet = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8"));
    setBridgeFetch(async (requestPath, init) => respond(requestPath, init, validSet));
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("HASH MISMATCH"));
  });

  it("does not open a stale local copy when the saved draft cannot load", async () => {
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(capabilities), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.includes("/v1/editor/campaign-sets/")) throw new Error("network down");
      return respond(requestPath, undefined);
    });
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("saved draft could not be loaded"));
    expect(container.querySelector("[data-open-editor]")).toBeNull();
  });

  it("rejects an invalid capability manifest", async () => {
    const invalid = new Response(JSON.stringify({ ...capabilities, ids: undefined }),
      { status: 200, headers: { "content-type": "application/json" } });
    setBridgeFetch(async () => invalid.clone());
    vi.stubGlobal("fetch", vi.fn(async () => invalid.clone()));
    await expect(mountApp(document.createElement("div"))).rejects.toThrow("capability manifest is invalid");
  });

  it("renames a set from a prompt and hides delete when not authorized", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "Renamed Set"));
    container.querySelector<HTMLElement>('[data-rename="published-set"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Renamed Set"));
    expect(container.querySelector("[data-delete]")).toBeNull();
  });

  it("blocks upload while validation fails", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-save]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Fix the validation issues"));
  });

  it("restores the help preference across remounts", async () => {
    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-open-editor]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-toggle-help]")!.click();
    expect(container.querySelector(".editor-main")?.classList.contains("help-visible")).toBe(true);
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    await mountApp(container);
    expect(container.textContent).toContain("Hide help");
    expect(container.querySelector('[data-open="published-set"]')).not.toBeNull();
  });
});
