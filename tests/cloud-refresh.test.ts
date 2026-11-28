import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountApp } from "../src/content/app";
import { packContentSet } from "../src/content/packer";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";
import { draftToWorkspace } from "../src/editor/convert";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const cloudDraft = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;

function respond(requestPath: string, packageFiles?: unknown) {
  let body: unknown = { sets: [
    { setId: "published-set", draftVersion: 3, publishedPackageId: "published-set-abcdef" },
    { setId: "fresh-set", draftVersion: 0 }
  ] };
  if (requestPath === "/v1/editor/capabilities") body = capabilities;
  else if (requestPath.startsWith("/v1/content/missions/")) body = { files: packageFiles };
  else if (requestPath.includes("/v1/editor/mission-sets/")) body = { setId: "published-set", draftVersion: 3, draft: cloudDraft };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("cloud refresh and discard", () => {
  let container: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    history.replaceState(null, "", "#/dashboard");
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    setBridgeState({ userId: "author-1", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async requestPath => respond(requestPath));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
  });

  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("refresh from cloud drops the cached workspace and reloads the draft", async () => {
    const stale = draftToWorkspace(cloudDraft, capabilities);
    stale.dialogues[0].sequence.nodes[0].segments[0].text = "stale local line";
    localStorage.setItem("meowedit.workspace.v1.author-1.published-set", JSON.stringify(stale));
    localStorage.setItem("meowedit.workspace.v1.author-1.published-set.meta", JSON.stringify({ dirty: true }));
    setBridgeFetch(async requestPath => respond(requestPath));

    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-refresh-cloud]")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-refresh-cloud]")!.click();
    await vi.waitFor(() => expect(localStorage.getItem("meowedit.workspace.v1.author-1.published-set")).toBeNull());
    expect(container.textContent).not.toContain("stale local line");
  });

  it("exit and discard resets to the published version and clears tabs", async () => {
    const packed = await packContentSet(cloudDraft);
    const requested: string[] = [];
    setBridgeFetch(async requestPath => {
      requested.push(requestPath);
      return respond(requestPath, packed.files);
    });

    container.querySelector<HTMLElement>('[data-open="published-set"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-edit='missions:0']")).not.toBeNull());
    container.querySelector<HTMLElement>("[data-edit='missions:0']")!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-action="exit-discard"]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-action="exit-discard"]')!.click();
    await vi.waitFor(() => expect(container.querySelector("[data-back-browser]")).not.toBeNull());
    expect(requested).toContain("/v1/content/missions/published-set-abcdef");
    const session = JSON.parse(localStorage.getItem("meowedit.content.session.author-1") ?? "{}");
    expect(session.tabs["published-set"] ?? []).toHaveLength(0);
  });
});
