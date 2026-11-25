import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { markWorkspaceDirty, markWorkspaceSynced, hasUnsyncedWorkspace } from "../src/editor/workspace-store";
import { mountApp } from "../src/content/app";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));
const valid = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8"));

function mockApi(handler: (path: string, init?: RequestInit) => Response) {
  setBridgeFetch(async (requestPath, init) => handler(requestPath, init));
}

describe("save and publish flows", () => {
  let container: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    setBridgeState({ userId: "flow-user", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });
  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  async function openSet() {
    mockApi(requestPath => {
      let body: unknown = { sets: [{ setId: "test-set", draftVersion: 2 }] };
      if (requestPath === "/v1/editor/capabilities") body = caps;
      else if (requestPath.includes("/mission-sets/") && !requestPath.endsWith("/publish")) body = { draftVersion: 2, draft: valid };
      else if (requestPath.endsWith("/publish")) body = { packageId: "pkg-1", contentHash: "hash" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountApp(container);
    // session view defaults to browser with no prior set; open directly
    container.querySelector<HTMLElement>('[data-open="test-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-save]")).not.toBeNull());
  }

  it("reports a successful save with the new version", async () => {
    await openSet();
    mockApi((requestPath, init) => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(caps), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.endsWith("/mission-sets/test-set") && init?.method === "POST")
        return new Response(JSON.stringify({ draftVersion: 3 }), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath === "/v1/editor/mission-sets")
        return new Response(JSON.stringify({ sets: [{ setId: "test-set", draftVersion: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ sets: [{ setId: "test-set", draftVersion: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Saved changes to test-set (v3)"));
  });

  it("reports a 409 draft conflict from the HTTP error body", async () => {
    await openSet();
    mockApi(requestPath => {
      if (requestPath.endsWith("/mission-sets/test-set"))
        return new Response(JSON.stringify({ code: "draft_conflict", currentVersion: 9 }), { status: 409, headers: { "content-type": "application/json" } });
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(caps), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ sets: [{ setId: "test-set", draftVersion: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    container.querySelector<HTMLElement>("[data-save]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("server is at version 9"));
  });

  it("marks a publish as hash verified when hashes match", async () => {
    const packed = new Response("{}");
    void packed;
    await openSet();
    const { packContentSet } = await import("../src/content/packer");
    const hash = (await packContentSet(valid, caps)).contentHash;
    mockApi(requestPath => {
      if (requestPath === "/v1/editor/capabilities")
        return new Response(JSON.stringify(caps), { status: 200, headers: { "content-type": "application/json" } });
      if (requestPath.endsWith("/publish"))
        return new Response(JSON.stringify({ packageId: "pkg-1", contentHash: hash }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ sets: [{ setId: "test-set", draftVersion: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    container.querySelector<HTMLElement>("[data-publish]")!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("hash verified"));
  });

  it("tracks unsynced local workspace edits", () => {
    expect(hasUnsyncedWorkspace("test-set")).toBe(false);
    markWorkspaceDirty("test-set");
    expect(hasUnsyncedWorkspace("test-set")).toBe(true);
    markWorkspaceSynced("test-set", 3);
    expect(hasUnsyncedWorkspace("test-set")).toBe(false);
  });
});

