import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountApp } from "../src/content/app";
import { emptyContentSet, localized, namedRef } from "../src/content/factory";
import type { GameCapabilities } from "../src/content/types";
import { saveScratchWorkspace, SCRATCH_WORKSPACE } from "../src/editor/workspace-store";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const roster = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/unit-roster.json"), "utf8"));
const catalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/army-catalog.json"), "utf8"));

describe("browser history routing", () => {
  let container: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    let app = document.querySelector<HTMLElement>("#app");
    if (!app) {
      document.body.innerHTML = '<div id="app"></div>';
      app = document.querySelector<HTMLElement>("#app");
    } else app.innerHTML = "";
    container = app!;
    setBridgeState({ userId: "history-user", canPublish: false, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(capabilities), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ sets: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("unit-roster.json"))
        return new Response(JSON.stringify(roster), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("army-catalog.json"))
        return new Response(JSON.stringify(catalog), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200 });
    }));
    await mountApp(container);
  });

  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("records each guided step in history and replays the previous step on Back", async () => {
    container.querySelector<HTMLElement>('[data-create="dialogues"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".guided-step-heading")).not.toBeNull(), { timeout: 10000 });
    await vi.waitFor(() => expect(location.hash).toContain("step=0"));
    const firstStepHash = location.hash;
    expect(document.querySelector(".guided-step-heading")?.textContent).toContain("Speaker");

    document.querySelector<HTMLElement>('[data-action="editor-next"]')!.click();
    await vi.waitFor(() => expect(location.hash).toContain("step=1"));
    expect(document.querySelector(".guided-step-heading")?.textContent).toContain("Lines");
    const sessionKey = "meowedit.editor-session.v1.history-user";
    expect(JSON.parse(localStorage.getItem(sessionKey)!).activeEditorStep).toBe(1);

    history.pushState(null, "", firstStepHash);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(sessionKey)!).activeEditorStep).toBe(0));
    expect(document.querySelector(".guided-step-heading")?.textContent).toContain("Speaker");
  });

  it("opens a local army from the Local drafts Edit button", async () => {
    container.querySelector<HTMLElement>('[data-create="armies"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="open-content-editor"]')).not.toBeNull(), { timeout: 10000 });
    document.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Your dashboard"));
    const edit = container.querySelector<HTMLElement>('[data-edit-local^="armies|"]');
    expect(edit).not.toBeNull();
    edit!.click();
    await vi.waitFor(() => expect(document.querySelector(".army-editor")).not.toBeNull(), { timeout: 10000 });
  });

  it("keeps section jumps inside the editor and toggles help text there", async () => {
    container.querySelector<HTMLElement>('[data-create="quests"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="open-full-editor"]')).not.toBeNull(), { timeout: 10000 });
    expect(location.hash).toContain("#/edit/__scratch__/quests/");
    document.querySelector<HTMLElement>('[data-action="open-full-editor"]')!.click();
    const before = location.hash;
    expect(document.querySelector('[data-action="jump-section"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-action="jump-section"]')!.click();
    expect(location.hash).toBe(before);

    document.querySelector<HTMLElement>('[data-action="toggle-help"]')!.click();
    expect(document.querySelector(".app-shell")!.classList.contains("help-visible")).toBe(true);
    document.querySelector<HTMLElement>('[data-action="toggle-help"]')!.click();
    expect(document.querySelector(".app-shell")!.classList.contains("help-visible")).toBe(false);
  });

  it("creates a mission from the Create new content button", async () => {
    container.querySelector<HTMLElement>('[data-create="missions"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".mission-editor")).not.toBeNull(), { timeout: 10000 });
    expect(location.hash).toContain("#/edit/__scratch__/missions/");
  });

  it("opens a local mission from the Local drafts Edit button", async () => {
    container.querySelector<HTMLElement>('[data-create="missions"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="open-content-editor"]')).not.toBeNull(), { timeout: 10000 });
    document.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Your dashboard"));
    const edit = container.querySelector<HTMLElement>('[data-edit-local^="missions|"]');
    expect(edit).not.toBeNull();
    edit!.click();
    await vi.waitFor(() => expect(document.querySelector(".mission-editor")).not.toBeNull(), { timeout: 10000 });
  });

  it("opens the set record that was clicked after returning to the set dashboard", async () => {
    const draft = emptyContentSet("published-set", "Published Set");
    for (const [id, name] of [["mission-a", "First Mission"], ["mission-b", "Second Mission"]]) {
      draft.missions.push({
        schemaVersion: 2, id, name: localized(name), description: localized(""),
        boardPreviewUnitId: namedRef(capabilities.ids.units[0]), questIds: [],
        floors: [{ id: id + "-floor", number: 1, mode: "authored", questPoolMode: "mission",
          questPoolIds: [], shopPoolMode: "mission", shopPoolKinds: ["Unit"], shopLevel: 1,
          randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 }, nodes: [], routes: [] }],
        events: [],
        settings: { startingLives: 3, startingSardines: 10, startingNodeCount: 12,
          playerFactionId: namedRef(capabilities.ids.factions[0]), factionSelectionEnabled: true,
          battleShopEnabled: true, shopPoolKinds: ["Unit"], questNodeCountPerRandomFloor: 2,
          shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false }
      } as never);
    }
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(capabilities), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath === "/v1/editor/mission-sets")
        return new Response(JSON.stringify({ sets: [{ setId: "published-set", draftVersion: 1 }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.includes("/v1/editor/mission-sets/"))
        return new Response(JSON.stringify({ setId: "published-set", draftVersion: 1, draft }),
          { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200 });
    });
    await mountApp(container);

    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-edit="missions:0"]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-edit="missions:0"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-bind="name"]')).not.toBeNull());
    expect(document.querySelector<HTMLInputElement>('[data-bind="name"]')!.value).toBe("First Mission");

    document.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-edit="missions:1"]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-edit="missions:1"]')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-bind="name"]')?.value).toBe("Second Mission"));
  });

  it("opens the record that was clicked after returning to the dashboard", async () => {
    const scratch = {
      schemaVersion: 1, dialogues: [], quests: [], armies: [], missions: [],
      selectedType: null, selectedKey: null, activeNodeId: null
    };
    (scratch.armies as unknown[]).push(
      { key: "local-a", id: "army-a", idAuto: true, name: "First Army", units: [], spellIds: [], blessingIds: [] },
      { key: "local-b", id: "army-b", idAuto: true, name: "Second Army", units: [], spellIds: [], blessingIds: [] }
    );
    saveScratchWorkspace(scratch as never);
    await mountApp(container);

    container.querySelector<HTMLElement>('[data-edit-local="armies|local-a"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-bind="name"]')).not.toBeNull());
    expect(document.querySelector<HTMLInputElement>('[data-bind="name"]')!.value).toBe("First Army");

    document.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Your dashboard"));
    container.querySelector<HTMLElement>('[data-edit-local="armies|local-b"]')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-bind="name"]')?.value).toBe("Second Army"));
  });

  it("drops older local drafts that have no editor key", async () => {
    const scratch = JSON.parse(localStorage.getItem("meowedit.workspace.v1.history-user." + SCRATCH_WORKSPACE) ?? "null");
    expect(scratch).toBeNull();
    const workspace = {
      schemaVersion: 1, dialogues: [], quests: [], armies: [], missions: [],
      selectedType: null, selectedKey: null, activeNodeId: null
    };
    (workspace.armies as unknown[]).push({ id: "army-1", idAuto: true, name: "Old Army", units: [], spellIds: [], blessingIds: [] });
    (workspace.missions as unknown[]).push({ id: "mission-1", idAuto: true, name: "Old Mission", description: "",
      designMode: "custom", boardPreviewUnitId: "", questIds: [], floors: [], events: [],
      settings: { startingLives: 3, startingSardines: 10, startingNodeCount: 12, playerFactionId: "",
        factionSelectionEnabled: true, battleShopEnabled: true, shopPoolKinds: ["Unit"],
        questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2,
        continueWithGeneratedFloors: false, sardinePayoutEnabled: true, sardinePayoutBase: 10, sardinePayoutPerFloor: 1 } });
    saveScratchWorkspace(workspace as never);
    await mountApp(container);

    expect(container.querySelector('[data-edit-local^="armies|"]')).toBeNull();
    expect(container.querySelector('[data-edit-local^="missions|"]')).toBeNull();
    expect(container.textContent).toContain("No local drafts yet.");
    const stored = JSON.parse(localStorage.getItem("meowedit.workspace.v1.history-user." + SCRATCH_WORKSPACE)!);
    expect(stored.armies).toEqual([]);
    expect(stored.missions).toEqual([]);
  });

  it("returns to the dashboard when browser Back is pressed from a set dashboard", async () => {
    setBridgeFetch(async requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(capabilities), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath === "/v1/editor/mission-sets")
        return new Response(JSON.stringify({ sets: [{ setId: "published-set", draftVersion: 0 }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.includes("/v1/editor/mission-sets/"))
        return new Response(JSON.stringify({ setId: "published-set", draftVersion: 0,
          draft: emptyContentSet("published-set", "Published Set") }),
          { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200 });
    });
    await mountApp(container);
    expect(container.textContent).toContain("Your dashboard");

    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-back-browser]")).not.toBeNull());
    expect(location.hash).toBe("#/set/published-set");

    history.back();
    await vi.waitFor(() => expect(location.hash).toBe("#/"));
    await vi.waitFor(() => expect(container.textContent).toContain("Your dashboard"));
  });

  it("returns to the dashboard when the editor's back link is followed by browser Back", async () => {
    container.querySelector<HTMLElement>('[data-create="armies"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="open-content-editor"]')).not.toBeNull(), { timeout: 10000 });
    expect(location.hash).toContain("#/edit/");
    document.querySelector<HTMLElement>('[data-action="open-content-editor"]')!.click();
    await vi.waitFor(() => expect(location.hash).toBe("#/"));
    expect(container.textContent).toContain("Your dashboard");

    history.back();
    await vi.waitFor(() => expect(location.hash).toContain("#/edit/"));
    await vi.waitFor(() => expect(document.querySelector(".app-shell")).not.toBeNull());
  });
});
