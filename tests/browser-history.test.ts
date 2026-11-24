import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountApp } from "../src/content/app";
import type { GameCapabilities } from "../src/content/types";

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
