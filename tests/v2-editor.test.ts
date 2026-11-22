import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState } from "../src/bridge-context";
import { mountV2Editor } from "../src/v2/editor";

const capabilities = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/v2/fixtures/capabilities.fixture.json"), "utf8"));

describe("structured v2 editor", () => {
  let container: HTMLElement;
  let requests: Array<{ path: string; init?: RequestInit }>;

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="v2"></div>';
    container = document.querySelector<HTMLElement>("#v2")!;
    requests = [];
    setBridgeState({ userId: "author-1", canPublish: true, actions: null });
    setBridgeFetch(async (requestPath, init) => {
      requests.push({ path: requestPath, init });
      const body = requestPath.endsWith("/publish")
        ? { packageId: "test-set-abc", contentHash: "mismatch" }
        : { draftVersion: 1 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(capabilities), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mountV2Editor(container, () => undefined);
  });

  afterEach(() => {
    resetBridgeFetch();
    resetBridgeState();
    vi.unstubAllGlobals();
  });

  it("renders the set, campaign, validation panel and explicit actions", () => {
    expect(container.querySelector('[data-v2-bind="set.setId"]')).not.toBeNull();
    expect(container.querySelector('[data-v2-action="save-local"]')).not.toBeNull();
    expect(container.querySelector('[data-v2-action="save-upload"]')).not.toBeNull();
    expect(container.querySelector('[data-v2-action="publish"]')).not.toBeNull();
    expect(container.textContent).toContain("Validation");
  });

  it("autosaves edits locally and revalidates", () => {
    const input = container.querySelector<HTMLInputElement>('[data-v2-bind="set.name.default"]')!;
    input.value = "Renamed Set";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("meowedit.v2.draft.author-1")!).set.name.default).toBe("Renamed Set");
  });

  it("adds campaigns, events, conditions and actions through structured controls", () => {
    container.querySelector<HTMLElement>('[data-v2-action="add-campaign"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="select-campaign"]')).toHaveLength(2);
    container.querySelector<HTMLElement>('[data-v2-action="add-event"]')!.click();
    expect(container.querySelector('[data-v2-bind$=".trigger"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-v2-action="add-condition"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-action"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-condition"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-v2-action="remove-action"]')).toHaveLength(2);
  });

  it("uploads a versioned create payload", async () => {
    container.querySelector<HTMLElement>('[data-v2-action="save-upload"]')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].path).toBe("/v1/editor/campaign-sets");
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.schemaVersion).toBe(2);
    expect(body.draft.schemaVersion).toBe(2);
    await vi.waitFor(() => expect(container.textContent).toContain("version 1"));
  });

  it("warns about tester progress and verifies the publish hash", async () => {
    container.querySelector<HTMLElement>('[data-v2-action="save-upload"]')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("version 1"));
    container.querySelector<HTMLElement>('[data-v2-action="publish"]')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("resets tester progress"));
    expect(requests[1].path).toContain("/publish");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ schemaVersion: 2, expectedDraftVersion: 1 });
    await vi.waitFor(() => expect(container.textContent).toContain("HASH MISMATCH"));
  });

  it("edits quests, armies, dialogues and floor nodes/routes", () => {
    container.querySelector<HTMLElement>('[data-v2-action="add-quest"]')!.click();
    expect(container.querySelector('[data-v2-bind="quests[0].objectiveKind"]')).not.toBeNull();
    const questTitle = container.querySelector<HTMLInputElement>('[data-v2-bind="quests[0].title.default"]')!;
    questTitle.value = "Recover the Key";
    questTitle.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>('[data-v2-action="add-fetch-item"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-fetch-item"]')).toHaveLength(1);
    container.querySelector<HTMLElement>('[data-v2-action="add-distance"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-distance"]')).toHaveLength(1);

    container.querySelector<HTMLElement>('[data-v2-action="add-army"]')!.click();
    expect(container.querySelector('[data-v2-bind="armies[0].id"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-v2-action="add-unit"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-unit"]')).toHaveLength(1);
    container.querySelector<HTMLElement>('[data-v2-action="add-cell-pick"]')!.click();
    const cells = container.querySelector<HTMLInputElement>('[data-v2-cells]')!;
    cells.value = "0,0; 1,2";
    cells.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("meowedit.v2.draft.author-1")!).armies[0].CellBlessingPicks[0].Cells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 2 }]);

    container.querySelector<HTMLElement>('[data-v2-action="add-dialogue"]')!.click();
    expect(container.querySelector('[data-v2-bind="dialogues[0].sequenceId"]')).not.toBeNull();
    container.querySelector<HTMLElement>('[data-v2-action="add-speaker"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-segment"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-dialogue-action"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-speaker"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-v2-action="remove-segment"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-v2-action="remove-dialogue-action"]')).toHaveLength(1);
    const defaultContinue = container.querySelector<HTMLInputElement>('[data-v2-bool$=".defaultContinue"]')!;
    defaultContinue.checked = false;
    defaultContinue.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("meowedit.v2.draft.author-1")!).dialogues[0].nodes[0].actions[0].meowEdit.defaultContinue).toBe(false);

    container.querySelector<HTMLElement>('[data-v2-action="select-campaign"][data-index="0"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-node"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-node"]')!.click();
    container.querySelector<HTMLElement>('[data-v2-action="add-offer"][data-node="0"]')!.click();
    const offerPrice = container.querySelector<HTMLInputElement>('[data-v2-bind$=".shopOffers[0].price"]')!;
    offerPrice.value = "7";
    offerPrice.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector<HTMLElement>('[data-v2-action="add-route"]')!.click();
    expect(container.querySelectorAll('[data-v2-action="remove-node"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-v2-action="remove-route"]')).toHaveLength(1);
    const saved = JSON.parse(localStorage.getItem("meowedit.v2.draft.author-1")!);
    expect(saved.campaigns[0].floors[0].routes).toHaveLength(1);
    expect(saved.campaigns[0].floors[0].nodes[0].shopOffers[0].price).toBe(7);
  });

  it("returns to the previous editor", async () => {
    let returned = false;
    document.body.innerHTML = '<div id="v2"></div>';
    await mountV2Editor(document.querySelector<HTMLElement>("#v2")!, () => { returned = true; });
    document.querySelector<HTMLElement>('[data-v2-action="back"]')!.click();
    expect(returned).toBe(true);
  });
});
