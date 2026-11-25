import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("refreshing on an editor route", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    location.hash = "";
  });

  it("restores the editor instead of the dashboard", async () => {
    const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));
    const draft = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8"));
    const missionId = draft.missions[0].id as string;
    const roster = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/unit-roster.json"), "utf8"));
    const catalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/army-catalog.json"), "utf8"));

    localStorage.setItem("meowedit.v2.sets.deep-user", JSON.stringify({
      "published-set": { draft, draftVersion: 1 }
    }));
    location.hash = "#/edit/published-set/missions/" + missionId + "?step=0&mode=full";

    const bridge = await import("../src/bridge-context");
    bridge.setBridgeState({ userId: "deep-user", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    bridge.setBridgeFetch(async requestPath => {
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

    const { mountApp } = await import("../src/content/app");
    await mountApp(container);

    await vi.waitFor(() => expect(container.querySelector(".mission-editor")).not.toBeNull());
    expect(container.textContent).not.toContain("Your dashboard");
    expect(location.hash).toContain("#/edit/published-set/missions/" + missionId);
  }, 20000);
});
