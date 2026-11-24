import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountApp } from "../src/content/app";
import { loadScratchWorkspace, SCRATCH_WORKSPACE } from "../src/editor/workspace-store";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8"));
const valid = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8"));

describe("dashboard and scratch content", () => {
  let container: HTMLElement;
  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    container = document.querySelector<HTMLElement>("#app")!;
    setBridgeState({ userId: "dash-user", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
    setBridgeFetch(async (requestPath, init) => {
      let body: unknown = { sets: [{ setId: "target-set", draftVersion: 2, publishedPackageId: "pkg" }] };
      if (requestPath === "/v1/editor/capabilities") body = caps;
      else if (requestPath.endsWith("/campaign-sets/target-set") && init?.method === "POST") body = { draftVersion: 3 };
      else if (requestPath.includes("/campaign-sets/") && !requestPath.endsWith("/publish")) body = { draftVersion: 2, draft: valid };
      else if (requestPath.endsWith("/publish")) body = { packageId: "pkg-new", contentHash: "hash" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountApp(container);
  });
  afterEach(() => {
    resetBridgeFetch(); resetBridgeState(); vi.unstubAllGlobals();
  });

  it("lands on a dashboard with creation buttons and local drafts", () => {
    expect(container.textContent).toContain("Your dashboard");
    expect(container.textContent).toContain("Create new content");
    expect(container.textContent).toContain("Local drafts (not in a set)");
    for (const section of ["dialogues", "quests", "armies", "campaigns"])
      expect(container.querySelector('[data-create="' + section + '"]')).not.toBeNull();
    expect(container.querySelector('[data-open="target-set"]')).not.toBeNull();
  });

  it("creates a local army, assigns it to a set and uploads immediately", async () => {
    vi.stubGlobal("prompt", vi.fn((_message: string, fallback?: string) => fallback ?? "army-1"));
    localStorage.setItem("meowedit.v2.sets.dash-user", JSON.stringify({
      "target-set": { draft: valid, draftVersion: 2, publishedPackageId: "pkg" }
    }));
    container.querySelector<HTMLElement>('[data-create="armies"]')!.click();
    await vi.waitFor(() => expect(container.querySelector(".app-shell")).not.toBeNull(), { timeout: 10000 });
    expect(loadScratchWorkspace().armies[0].id).toBe("army-1");
    expect(container.querySelector('[data-action="save-package"]')?.textContent).toContain("Save locally");
    expect(container.querySelector('[data-action="open-content-editor"]')?.textContent).toContain("Dashboard");
    for (let i = 0; i < 10 && !container.querySelector('[data-action="assign-to-set"]'); i++)
      container.querySelector<HTMLElement>('[data-action="editor-next"]')?.click();
    await vi.waitFor(() => expect(container.querySelector('[data-action="assign-to-set"]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-action="assign-to-set"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".assign-overlay")).not.toBeNull());
    const overlay = document.querySelector<HTMLElement>(".assign-overlay")!;
    expect(overlay.textContent).toContain("Assign to set");
    overlay.querySelector<HTMLElement>("[data-assign-confirm]")!.click();
    await vi.waitFor(() => expect(document.querySelector(".assign-overlay")).toBeNull());
    expect(loadScratchWorkspace().armies).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem("meowedit.v2.sets.dash-user") ?? "{}");
    expect(stored["target-set"].draftVersion).toBe(3);
    expect(stored["target-set"].draft.armies.some((army: { id: string }) => army.id === "army-1")).toBe(true);
  }, 20000);

  it("shows a replace summary when the target set already has the same id", async () => {
    const scratch = loadScratchWorkspace();
    scratch.armies.push({ key: "local-key", id: "guards", idAuto: true, name: "Local Guards", previewFloor: 1,
      units: [], spellIds: [], blessingIds: [] } as never);
    localStorage.setItem("meowedit.workspace.v1.dash-user." + SCRATCH_WORKSPACE, JSON.stringify(scratch));
    localStorage.setItem("meowedit.v2.sets.dash-user", JSON.stringify({
      "target-set": { draft: valid, draftVersion: 2, publishedPackageId: "pkg" }
    }));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-assign-local="armies|local-key"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".assign-overlay")).not.toBeNull());
    expect(document.querySelector(".assign-summary")?.textContent).toContain("already has");
  });

  it("exports and deletes local drafts from the dashboard", async () => {
    const scratch = loadScratchWorkspace();
    scratch.armies.push({ key: "exp-key", id: "export-army", idAuto: true, name: "Export Army", previewFloor: 1,
      units: [], spellIds: [], blessingIds: [] } as never);
    localStorage.setItem("meowedit.workspace.v1.dash-user." + SCRATCH_WORKSPACE, JSON.stringify(scratch));
    await mountApp(container);
    container.querySelector<HTMLElement>('[data-export-local="armies|exp-key"]')!.click();
    container.querySelector<HTMLElement>('[data-delete-local="armies|exp-key"]')!.click();
    expect(loadScratchWorkspace().armies.some(a => a.key === "exp-key")).toBe(false);
  });

  it("imports JSON into the scratch workspace", async () => {
    await mountApp(container);
    const file = new File([JSON.stringify({ armies: [{ id: "imported-army", name: "Imported", units: [], spellIds: [], blessingIds: [] }] })],
      "content.json", { type: "application/json" });
    const input = container.querySelector<HTMLInputElement>("#dashboard-import-file")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain("Imported"));
    expect(loadScratchWorkspace().armies.some(a => a.id === "imported-army")).toBe(true);
  });


});
