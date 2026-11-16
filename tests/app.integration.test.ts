import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArmyCatalog } from "../src/model";
import { workspacePackage } from "../src/export";
import { EDITOR_SESSION_STORAGE_KEY, defaultEditorSession } from "../src/editor-session";
import { catalog as baseCatalog, rosterFixture, workspaceFixture } from "./fixtures";

function clickCampaignCanvasAt(x: number, y: number): void {
  const canvas = document.querySelector<HTMLElement>("[data-campaign-canvas]")!;
  const rect = canvas.getBoundingClientRect();
  const snap = Number(canvas.dataset.snap);
  const clientX = rect.left + Number(canvas.dataset.offsetX) + x * snap;
  const clientY = rect.top + Number(canvas.dataset.offsetY) + y * snap;
  canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
}

function chooseCampaignNodeType(kind: string): void {
  const addMenu = document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-add-menu"]');
  if (addMenu?.getAttribute("aria-expanded") !== "true") addMenu?.click();
  document.querySelector<HTMLButtonElement>('[data-action="campaign-node-tool"][data-kind="' + kind + '"]')!.click();
}

function dragCampaignPlugs(fromNodeId: string, toNodeId: string): void {
  const output = document.querySelector<HTMLElement>('[data-campaign-port="output"][data-node-id="' + fromNodeId + '"]')!;
  const input = document.querySelector<HTMLElement>('[data-campaign-port="input"][data-node-id="' + toNodeId + '"]')!;
  const down = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(down, "clientX", { value: 0 });
  Object.defineProperty(down, "clientY", { value: 0 });
  output.dispatchEvent(down);
  const up = new Event("pointerup", { bubbles: true, cancelable: true });
  input.dispatchEvent(up);
}

function goToCampaignStep(step: number): void {
  const approachChoice = document.querySelector<HTMLButtonElement>('[data-action="campaign-design-choice"][data-mode="custom"]');
  if (approachChoice) approachChoice.click();
  for (let attempt = 0; attempt < 10; attempt++) {
    const label = document.querySelector(".campaign-guided-step-heading > span")?.textContent ?? "";
    const stepName = document.querySelector(".campaign-guided-step-heading h1")?.textContent ?? "";
    const current = Number(label.match(/Step (\d+)/)?.[1] ?? 1) - 1;
    if (current === step) return;
    if (current < step) {
      document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    } else if (stepName === "Node") {
      document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    } else {
      document.querySelector<HTMLButtonElement>('[data-action="editor-back"]')!.click();
    }
  }
  throw new Error("Campaign guided flow did not reach step " + step);
}

function dropCampaignNodeAt(nodeId: string, x: number, y: number): void {
  const canvas = document.querySelector<HTMLElement>("[data-campaign-canvas]")!;
  const rect = canvas.getBoundingClientRect();
  const snap = Number(canvas.dataset.snap);
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { getData: () => nodeId } });
  Object.defineProperty(drop, "clientX", { value: rect.left + Number(canvas.dataset.offsetX) + x * snap });
  Object.defineProperty(drop, "clientY", { value: rect.top + Number(canvas.dataset.offsetY) + y * snap });
  canvas.dispatchEvent(drop);
}

function changeImportFile(name: string, body: string): void {
  const picker = document.querySelector<HTMLInputElement>("#import-file")!;
  const file = new File([body], name, { type: name.endsWith(".zip") ? "application/zip" : "application/json" });
  Object.defineProperty(file, "text", { configurable: true, value: async () => body });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: async () => new TextEncoder().encode(body).buffer });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

function changeImportZip(blob: Blob): void {
  const picker = document.querySelector<HTMLInputElement>("#import-file")!;
  const file = new File([blob], "content-package.zip", { type: "application/zip" });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: () => blob.arrayBuffer() });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("browser application flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("lets Advanced browse drafts, fold the sidebar, and reach import/export from its footer", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="new-dialogue"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();

    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    expect(sidebar.querySelector(".doc-item")).toBeNull();
    expect(sidebar.querySelector('[data-action="open-import"]')).not.toBeNull();
    expect(sidebar.querySelector('[data-action="export-package"]')).not.toBeNull();

    const toggle = document.querySelector<HTMLButtonElement>(".sidebar-collapse-button")!;
    toggle.click();
    expect(document.querySelector(".app-layout")?.classList.contains("is-sidebar-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    document.querySelector<HTMLButtonElement>('[data-action="open-content-picker"]')!.click();
    const picker = document.querySelector<HTMLDialogElement>("#content-picker-dialog")!;
    expect(picker.querySelector('[data-action="select-item"]')).not.toBeNull();
    picker.querySelector<HTMLButtonElement>('[data-action="select-item"]')!.click();
    expect(picker.hasAttribute("open")).toBe(false);
    expect(document.querySelector(".app-layout")?.classList.contains("is-sidebar-collapsed")).toBe(true);
    expect(document.querySelector(".topbar [data-action='delete-active']")).toBeNull();
    expect(document.querySelector(".topbar [data-action='delete-item']")).toBeNull();
    expect(document.querySelector(".topbar [data-action='export-package']")).toBeNull();
  });

  it("opens and dismisses the mobile navigation with its toggle and backdrop", async () => {
    const previousWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      vi.resetModules();
      localStorage.clear();
      document.body.innerHTML = '<div id="app"></div>';
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
      })));

      await import("../src/main");
      document.querySelector<HTMLButtonElement>('[data-action="new-dialogue"]')!.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();

      const toggle = document.querySelector<HTMLButtonElement>(".mobile-brand")!;
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const layout = document.querySelector<HTMLElement>(".app-layout")!;
      toggle.click();
      expect(sidebar.classList.contains("is-open")).toBe(true);
      expect(layout.classList.contains("is-sidebar-open")).toBe(true);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.querySelector(".mobile-menu-chevron")?.textContent).toBe("‹");

      document.querySelector<HTMLButtonElement>(".sidebar-backdrop")!.click();
      expect(sidebar.classList.contains("is-open")).toBe(false);
      expect(layout.classList.contains("is-sidebar-open")).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      toggle.click();
      toggle.click();
      expect(sidebar.classList.contains("is-open")).toBe(false);
      expect(toggle.getAttribute("aria-label")).toBe("Open navigation menu");
    } finally {
      if (previousWidth) Object.defineProperty(window, "innerWidth", previousWidth);
      else Reflect.deleteProperty(window, "innerWidth");
    }
  });

  it("toggles optional Help in Guided and Advanced and stores the choice", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="new-dialogue"]')!.click();

    const guidedHelp = document.querySelector<HTMLButtonElement>('.guided-editor-header [data-action="toggle-help"]')!;
    expect(guidedHelp.getAttribute("aria-pressed")).toBe("false");
    guidedHelp.click();
    expect(document.querySelector(".app-shell")?.classList.contains("help-visible")).toBe(true);
    expect(JSON.parse(localStorage.getItem(EDITOR_SESSION_STORAGE_KEY)!).helpVisible).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();
    const advancedHelp = document.querySelector<HTMLButtonElement>('.topbar [data-action="toggle-help"]')!;
    expect(advancedHelp.getAttribute("aria-pressed")).toBe("true");
    advancedHelp.click();
    expect(document.querySelector(".app-shell")?.classList.contains("help-visible")).toBe(false);
    expect(JSON.parse(localStorage.getItem(EDITOR_SESSION_STORAGE_KEY)!).helpVisible).toBe(false);
  });

  it("creates an army, replaces a field unit, assigns its spell, and saves a campaign floor", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const catalog: ArmyCatalog = {
      ...baseCatalog,
      units: [...baseCatalog.units, { id: "Cats/Archer/1", name: "Archer", factionId: "Cats", faction: "Cats", levels: [{ id: "Cats/Archer/1", name: "Archer", level: 1 }] }]
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? catalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="new-army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#army-unit-picker")).not.toBeNull());

    const unitPicker = document.querySelector<HTMLSelectElement>("#army-unit-picker")!;
    unitPicker.value = "Cats/Fighter/1";
    unitPicker.dispatchEvent(new Event("change", { bubbles: true }));
    const levelPicker = document.querySelector<HTMLSelectElement>("#army-level-picker")!;
    levelPicker.value = "2";
    document.querySelector<HTMLButtonElement>('[data-action="add-selected-army-unit"]')!.click();

    const replacementPicker = document.querySelector<HTMLSelectElement>("#army-unit-picker")!;
    replacementPicker.value = "Cats/Archer/1";
    replacementPicker.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="replace-army-placement"]')!.click();

    const unitSpellPicker = document.querySelector<HTMLSelectElement>("#army-unit-spell-picker")!;
    unitSpellPicker.value = "fireball";
    document.querySelector<HTMLButtonElement>('[data-action="add-army-unit-spell"]')!.click();
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.armies[0].units[0]).toMatchObject({ unitId: "Cats/Archer/1", x: 0, y: 0, spellIds: ["fireball"] });

    document.querySelector<HTMLButtonElement>('[data-action="add-selected-army-unit"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.armies[0].units).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      return event;
    };
    const setCellRects = () => {
      for (const cell of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-army-cell]"))) {
        const x = Number(cell.dataset.x) * 100, y = Number(cell.dataset.y) * 100;
        cell.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + 100, bottom: y + 100, width: 100, height: 100, toJSON: () => ({}) } as DOMRect);
      }
    };
    const dragTo = (placementId: string, x: number, y: number, swapTargetId?: string) => {
      const placement = Array.from(document.querySelectorAll<HTMLElement>("[data-army-placement]")).find(item => item.dataset.placementId === placementId)!;
      placement.dispatchEvent(pointer("pointerdown", 50, 50));
      document.querySelector("#app")!.dispatchEvent(pointer("pointermove", x, y));
      if (swapTargetId) {
        const target = Array.from(document.querySelectorAll<HTMLElement>("[data-army-placement]")).find(item => item.dataset.placementId === swapTargetId)!;
        expect(target.classList.contains("is-swap-target")).toBe(true);
      }
      document.dispatchEvent(pointer("pointerup", x, y));
    };
    setCellRects();
    const firstPlacement = (saved.armies[0].units as Array<{ id: string }>)[0];
    const secondPlacement = (saved.armies[0].units as Array<{ id: string }>)[1];
    dragTo(firstPlacement.id, 150, 50, secondPlacement.id);
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.armies[0].units.map((unit: { x: number; y: number }) => ({ x: unit.x, y: unit.y }))).toEqual([{ x: 1, y: 0 }, { x: 0, y: 0 }]);

    setCellRects();
    dragTo(firstPlacement.id, 250, 50);
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.armies[0].units[0]).toMatchObject({ x: 2, y: 0 });
    expect(saved.armies[0].units[1]).toMatchObject({ x: 0, y: 0 });

    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(1);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-set-floor-mode"][data-mode="mixed"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-add-floor"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.campaigns[0].floors).toHaveLength(2);
    expect(saved.campaigns[0].floors[0].mode).toBe("mixed");
  });

  it("lets the guided Army lineup add a building from its own catalog tab", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="new-army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="army-catalog-kind"][data-kind="buildings"]')!.click();
    expect(document.querySelector("#army-entity-preview")?.textContent).toContain("A broad defensive structure.");
    document.querySelector<HTMLButtonElement>('[data-action="army-catalog-kind"][data-kind="units"]')!.click();
    expect(document.querySelector<HTMLSelectElement>("#army-unit-picker")?.value).toBe("Cats/Fighter/1");
    document.querySelector<HTMLButtonElement>('[data-action="army-catalog-kind"][data-kind="buildings"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-selected-army-unit"]')!.click();

    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.armies[0].units[0]).toMatchObject({ unitId: "Cats/Barricade/1", x: 0, y: 0 });
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    expect(document.querySelector(".army-grid-placement")?.getAttribute("style")).toContain("grid-column:1 / span 2");
    expect(document.querySelector(".army-stats-card")?.textContent).toContain("250");
    expect(document.querySelectorAll(".army-stats-card")).toHaveLength(1);

    const floorPicker = document.querySelector<HTMLInputElement>('[data-bind="previewFloor"]')!;
    floorPicker.value = "5";
    floorPicker.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="editor-back"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="army-catalog-kind"][data-kind="units"]')!.click();
    const unitPicker = document.querySelector<HTMLSelectElement>("#army-unit-picker")!;
    unitPicker.value = "Cats/Fighter/1";
    unitPicker.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="add-selected-army-unit"]')!.click();
    const placements = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).armies[0].units as Array<{ id: string; unitId: string; x: number; y: number }>;
    const fighter = placements.find(unit => unit.unitId === "Cats/Fighter/1")!;
    const building = placements.find(unit => unit.unitId === "Cats/Barricade/1")!;
    expect(fighter).toMatchObject({ x: 2, y: 0 });
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();

    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 7 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      return event;
    };
    for (const cell of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-army-cell]"))) {
      const x = Number(cell.dataset.x) * 100, y = Number(cell.dataset.y) * 100;
      cell.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + 100, bottom: y + 100, width: 100, height: 100, toJSON: () => ({}) } as DOMRect);
    }
    const fighterTile = Array.from(document.querySelectorAll<HTMLElement>("[data-army-placement]")).find(item => item.dataset.placementId === fighter.id)!;
    fighterTile.dispatchEvent(pointer("pointerdown", 250, 50));
    document.querySelector("#app")!.dispatchEvent(pointer("pointermove", 150, 50));
    expect(Array.from(document.querySelectorAll<HTMLElement>("[data-army-placement]")).find(item => item.dataset.placementId === building.id)?.classList.contains("is-swap-target")).toBe(true);
    document.dispatchEvent(pointer("pointerup", 150, 50));

    const swapped = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).armies[0].units as Array<{ id: string; x: number; y: number }>;
    expect(swapped.find(unit => unit.id === building.id)).toMatchObject({ x: 2, y: 0 });
    expect(swapped.find(unit => unit.id === fighter.id)).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps a settings-only campaign in a short randomizer flow", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Approach");
    document.querySelector<HTMLButtonElement>('[data-action="campaign-design-choice"][data-mode="settings-only"]')!.click();
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Name");

    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    let campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign).toMatchObject({ designMode: "settings-only", questIds: [], settings: { questNodeCountPerRandomFloor: 0, continueWithGeneratedFloors: true } });
    expect(campaign.floors[0]).toMatchObject({ mode: "random", nodes: [], routes: [], randomSettings: { questNodeCount: 0 } });

    goToCampaignStep(1);
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Randomizer settings");
    expect(document.querySelector(".campaign-board-workspace")).toBeNull();
    expect(document.querySelector(".campaign-quest-step")).toBeNull();
    expect(document.querySelector('[data-bind="floors.0.randomSettings.questNodeCount"]')).toBeNull();
    expect(document.querySelector(".campaign-optional-quest-content")).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-action="campaign-add-floor"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign.floors).toHaveLength(2);
    expect(campaign.floors.every((floor: { mode: string; nodes: unknown[] }) => floor.mode === "random" && floor.nodes.length === 0)).toBe(true);

    goToCampaignStep(4);
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Starting run");
    goToCampaignStep(5);
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Progression");
    expect(document.querySelector('[data-bind="settings.questNodeCountPerRandomFloor"]')).toBeNull();
    goToCampaignStep(6);
    expect(document.querySelector(".campaign-review-summary")?.textContent).toContain("Randomizer only");
    expect(document.querySelector(".campaign-review-summary")?.textContent).not.toContain("Current board");

    goToCampaignStep(1);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-set-floor-mode"][data-mode="authored"]')!.click();
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Floors");
    expect(document.querySelector(".campaign-board-workspace")).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    expect(document.querySelector(".campaign-guided-step-heading h1")?.textContent).toBe("Map");
    expect(document.querySelector(".campaign-board-workspace")).not.toBeNull();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign.designMode).toBe("custom");
  });

  it("configures campaign shop pools, floor unlocks, and exact per-node prices", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-design-choice"][data-mode="custom"]')!.click();
    goToCampaignStep(2);
    chooseCampaignNodeType("Shop");
    clickCampaignCanvasAt(1, 0);
    const before = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const shopIndex = before.campaigns[0].floors[0].nodes.findIndex((node: { kind: string }) => node.kind === "Shop");
    const path = (suffix: string) => `[data-bind="floors.0.nodes.${shopIndex}.${suffix}"]`;
    const stockMode = document.querySelector<HTMLSelectElement>(path("shopOfferMode"))!;
    stockMode.value = "exact";
    stockMode.dispatchEvent(new Event("change", { bubbles: true }));
    for (let index = 0; index < 3; index++) document.querySelector<HTMLButtonElement>('[data-action="campaign-add-shop-offer"]')!.click();

    const setSelect = (selector: string, value: string) => {
      const element = document.querySelector<HTMLSelectElement>(selector)!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const offerPath = (index: number, field: string) => path(`shopOffers.${index}.${field}`);
    const offerData = [
      { kind: "SpellUnlock", id: "fireball", price: "7" },
      { kind: "Blessing", id: "blessing", price: "9" },
      { kind: "Unit", id: "", price: "15" }
    ];
    for (const [index, offer] of offerData.entries()) {
      setSelect(offerPath(index, "kind"), offer.kind);
      const item = document.querySelector<HTMLSelectElement>(offerPath(index, "contentId"))!;
      const itemId = offer.id || Array.from(item.options).find(option => option.value)?.value || "";
      setSelect(offerPath(index, "contentId"), itemId);
      const price = document.querySelector<HTMLInputElement>(offerPath(index, "price"))!;
      price.value = offer.price;
      price.dispatchEvent(new Event("input", { bubbles: true }));
    }
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    let campaign = saved.campaigns[0];
    expect(campaign.floors[0].nodes[shopIndex]).toMatchObject({
      kind: "Shop", shopOfferMode: "exact", shopOffers: [
        { kind: "SpellUnlock", contentId: "fireball", price: 7 },
        { kind: "Blessing", contentId: "blessing", price: 9 },
        { kind: "Unit", price: 15 }
      ]
    });

    goToCampaignStep(5);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-shop-pool"][data-scope="campaign"][data-kind="Blessing"]')!.click();
    goToCampaignStep(6);
    const shopTier = document.querySelector<HTMLSelectElement>('[data-bind="floors.0.shopLevel"]')!;
    shopTier.value = "3";
    shopTier.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-floor-shop-mode"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-shop-pool"][data-scope="floor"][data-kind="Unit"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    campaign = saved.campaigns[0];
    expect(campaign.settings.shopPoolKinds).not.toContain("Blessing");
    expect(campaign.floors[0]).toMatchObject({ shopLevel: 3, shopPoolMode: "custom" });
    expect(campaign.floors[0].shopPoolKinds).not.toContain("Unit");
  });

  it("migrates older browser drafts and removes the unfinished bridge example", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const legacy = workspaceFixture() as any;
    delete legacy.armies;
    legacy.selectedType = "unknown";
    legacy.selectedKey = "missing";
    legacy.activeNodeId = "missing-node";
    legacy.quests[0].definition.objectiveKind = "Fetch";
    legacy.quests[0].definition.itemId = "old-herb";
    legacy.quests[0].itemDisplayName = "";
    legacy.quests[0].extension = {} as any;
    const bridgeQuest = structuredClone(legacy.quests[0]);
    bridgeQuest.definition.id = "repair-the-bridge";
    legacy.quests.push(bridgeQuest);
    legacy.dialogues[0].sequenceIdAuto = true;
    legacy.dialogues[0].sequence.sequenceId = "new-dialogue";
    legacy.dialogues[0].sequence.nodes[0].headline = "Opening";
    legacy.dialogues[0].sequence.nodes.push({ id: "node-1", headline: "New node", textSpeed: "default", speakers: [], segments: [], actions: [] });
    const bridgeDialogue = structuredClone(legacy.dialogues[0]);
    bridgeDialogue.sequence.sequenceId = "bridge-repair-conversation";
    legacy.dialogues.push(bridgeDialogue);
    const campaign = legacy.campaigns[0];
    delete campaign.designMode;
    campaign.settings = { startingLives: 5 };
    campaign.questIds = undefined;
    const floor = campaign.floors[0];
    delete floor.questPoolMode;
    delete floor.questPoolIds;
    delete floor.randomSettings;
    delete floor.nodes;
    delete floor.routes;
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(legacy));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    const migrated = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(migrated.armies).toEqual([]);
    expect(migrated.selectedType).toBeNull();
    expect(migrated.selectedKey).toBeNull();
    expect(migrated.dialogues).toHaveLength(1);
    expect(migrated.dialogues[0].sequence.nodes.map((node: { headline: string }) => node.headline)).toEqual(["", ""]);
    expect(migrated.quests).toHaveLength(1);
    expect(migrated.quests[0].extension).toMatchObject({
      dialogueLinks: { offer: "", active: "", completion: "", failure: "" },
      fetchItems: [{ id: "old-herb", displayName: "old herb", count: 1 }], battleTargets: [], killCount: null,
      minimumNodeDistances: [], timer: { decisionId: "", counterTarget: 3 }, completionEffects: []
    });
    expect(migrated.campaigns[0]).toMatchObject({ designMode: "custom", questIds: [], settings: { startingLives: 5, startingSardines: 10 } });
    expect(migrated.campaigns[0].floors[0]).toMatchObject({ questPoolMode: "campaign", questPoolIds: [], randomSettings: { nodeCount: 12 }, nodes: [], routes: [] });
  });

  it("falls back to an empty workspace when saved JSON is malformed", async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.setItem("meowedit.workspace.v1", "{broken json");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    expect(document.querySelectorAll('[data-action="select-item"]')).toHaveLength(0);
    expect(localStorage.getItem("meowedit.workspace.v1")).toBe("{broken json");
  });

  it("starts a clean draft when the saved workspace schema is unsupported", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify({ schemaVersion: 2, dialogues: [], quests: [] }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    expect(document.querySelectorAll('[data-action="select-item"]')).toHaveLength(0);
    expect(document.querySelector(".welcome-main")).not.toBeNull();
  });

  it("clears draft links to the removed bridge example", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const draft = workspaceFixture();
    draft.quests[0].extension.dialogueLinks.offer = "bridge-repair-conversation";
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).quests[0].extension.dialogueLinks.offer).toBe("");
  });

  it("restores an existing saved selection for each editor type", async () => {
    const cases = [
      ["dialogue", "dialogue-key"],
      ["quest", "quest-key"],
      ["army", "army-key"],
      ["campaign", "campaign-key"]
    ] as const;
    for (const [selectedType, selectedKey] of cases) {
      vi.resetModules();
      localStorage.clear();
      document.body.innerHTML = '<div id="app"></div>';
      const draft = workspaceFixture();
      draft.selectedType = selectedType;
      draft.selectedKey = selectedKey;
      localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

      await import("../src/main");
      const restored = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
      expect(restored.selectedType).toBe(selectedType);
      expect(restored.selectedKey).toBe(selectedKey);
    }
  });

  it("migrates an older randomizer-only campaign draft to settings-only mode", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const draft = workspaceFixture();
    const campaign = draft.campaigns[0];
    delete campaign.designMode;
    campaign.questIds = [];
    campaign.settings.questNodeCountPerRandomFloor = 0;
    campaign.floors[0].mode = "random";
    campaign.floors[0].nodes = [];
    campaign.floors[0].routes = [];
    campaign.floors[0].randomSettings.questNodeCount = 0;
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).campaigns[0].designMode).toBe("settings-only");
  });

  it("clears a selected type whose record was removed from the saved workspace", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const staleSelection = workspaceFixture();
    staleSelection.selectedType = "campaign";
    staleSelection.selectedKey = "deleted-campaign";
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(staleSelection));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await import("../src/main");
    const migrated = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(migrated.selectedType).toBeNull();
    expect(migrated.selectedKey).toBeNull();
    expect(migrated.activeNodeId).toBeNull();
  });

  it("uses safe roster and army-catalog fallbacks for unsupported catalog versions", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog")
        ? { schemaVersion: 2, units: [], spells: [], blessings: [] }
        : { schemaVersion: 2, units: [] }
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    expect(document.querySelector(".army-picker-section .army-empty")?.textContent).toContain("No units are present in the game catalog");
  });

  it("warns when browser storage rejects a workspace save", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New dialogue"]')!.click();

    const browserStorage = window.localStorage;
    const rejectedSetItem = vi.fn(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    vi.stubGlobal("localStorage", {
      getItem: browserStorage.getItem.bind(browserStorage),
      setItem: rejectedSetItem,
      removeItem: browserStorage.removeItem.bind(browserStorage),
      clear: browserStorage.clear.bind(browserStorage),
      key: browserStorage.key.bind(browserStorage),
      get length() { return browserStorage.length; }
    });
    const momentName = document.querySelector<HTMLInputElement>('[data-bind="nodes.0.editorLabel"]')!;
    momentName.value = "could-not-save";
    momentName.dispatchEvent(new Event("change", { bubbles: true }));

    expect(rejectedSetItem).toHaveBeenCalledWith("meowedit.workspace.v1", expect.any(String));
    expect(document.querySelector(".toast-warning")?.textContent).toContain("Browser storage is full");
    expect(document.querySelector("[data-action='editor-next']")).not.toBeNull();
  });

  it("advances the guided dialogue from its focused field when Enter is pressed", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New dialogue"]')!.click();

    const title = document.querySelector<HTMLInputElement>('[data-bind="nodes.0.editorLabel"]')!;
    title.focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    title.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-action="add-speaker"]')).not.toBeNull();
  });

  it("fills a selected character name and preserves an author override", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const roster = {
      ...rosterFixture,
      units: [{ id: "Cats/Fighter/1", displayName: "Fighter", faction: "Cats", moods: ["Normal"] }]
    };
    const armyCatalog = {
      ...baseCatalog,
      units: [...baseCatalog.units,
        { id: "Cats/Archer/1", name: "Archer", factionId: "Cats", faction: "Cats", levels: [{ id: "Cats/Archer/1", name: "Archer", level: 1, previewImage: "./avatars/Cats-Archer-1.png" }] },
        { id: "Neutral/Stray/1", name: "Stray", factionId: "Neutral", faction: "Neutral", levels: [{ id: "Neutral/Stray/1", name: "Stray", level: 1, previewImage: "./avatars/Neutral-Stray-1.png" }] }
      ]
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? armyCatalog : roster
    })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New dialogue"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-speaker"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-bind="nodes.0.speakers.0.unitId"] option[value="Cats/Fighter/1"]')).not.toBeNull());
    const characterOptions = [...document.querySelectorAll<HTMLSelectElement>('[data-bind="nodes.0.speakers.0.unitId"] option')].map(option => option.value);
    expect(characterOptions).toContain("Cats/Fighter/2");
    expect(characterOptions).toContain("Cats/Archer/1");
    expect(characterOptions).toContain("Neutral/Stray/1");
    expect(characterOptions).not.toContain("Cats/Barricade/1");
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-bind="nodes.0.speakers.0.unitId"] option')]
      .find(option => option.value === "Cats/Fighter/2")?.textContent).toContain("Level 2");

    const chooseCharacter = (unitId: string): void => {
      const picker = document.querySelector<HTMLSelectElement>('[data-bind="nodes.0.speakers.0.unitId"]')!;
      picker.value = unitId;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    };
    chooseCharacter("Cats/Fighter/1");
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-bind="nodes.0.speakers.0.displayName"]')?.value).toBe("Fighter"));
    chooseCharacter("Cats/Archer/1");
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-bind="nodes.0.speakers.0.displayName"]')?.value).toBe("Archer"));

    const displayName = document.querySelector<HTMLInputElement>('[data-bind="nodes.0.speakers.0.displayName"]')!;
    displayName.value = "Village Elder";
    displayName.dispatchEvent(new Event("input", { bubbles: true }));
    chooseCharacter("Cats/Fighter/1");
    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const dialogue = saved.dialogues.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(dialogue.sequence.nodes[0].speakers[0]).toMatchObject({ unitId: "Cats/Fighter/1", displayName: "Village Elder" });
  });

  it("derives a quest ID from its title until the author overrides the ID", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New quest"]')!.click();

    const title = document.querySelector<HTMLInputElement>('[data-bind="definition.title"]')!;
    title.value = "Find Old Key";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.quests[0]).toMatchObject({ idAuto: true, definition: { id: "find-old-key", title: "Find Old Key" } });

    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();
    const id = document.querySelector<HTMLInputElement>('[data-bind="definition.id"]')!;
    id.value = "old-key-story";
    id.dispatchEvent(new Event("input", { bubbles: true }));
    const editedTitle = document.querySelector<HTMLInputElement>('[data-bind="definition.title"]')!;
    editedTitle.value = "Find the Old Key";
    editedTitle.dispatchEvent(new Event("input", { bubbles: true }));

    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.quests[0]).toMatchObject({ idAuto: false, definition: { id: "old-key-story", title: "Find the Old Key" } });
  });

  it("rewrites dialogue routes and the active node when a node ID changes", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const draft = workspaceFixture();
    const dialogue = draft.dialogues[0];
    dialogue.sequence.nodes[0].continueTargetNodeId = "opening";
    dialogue.sequence.nodes[0].actions = [{ label: "Again", targetNodeId: "opening" }];
    dialogue.sequence.nodes.push({
      ...dialogue.sequence.nodes[0], id: "ending", headline: "Ending", continueTargetNodeId: "opening",
      actions: [{ label: "Return", targetNodeId: "opening" }]
    });
    draft.selectedType = "dialogue";
    draft.selectedKey = dialogue.key;
    draft.activeNodeId = "opening";
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();

    const nodeId = document.querySelector<HTMLInputElement>('[data-bind="nodes.0.id"]')!;
    nodeId.value = "start-here";
    nodeId.dispatchEvent(new Event("change", { bubbles: true }));
    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const updated = saved.dialogues.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(updated.sequence.startNodeId).toBe("start-here");
    expect(saved.activeNodeId).toBe("start-here");
    expect(updated.sequence.nodes[0]).toMatchObject({ id: "start-here", continueTargetNodeId: "start-here", actions: [{ targetNodeId: "start-here" }] });
    expect(updated.sequence.nodes[1]).toMatchObject({ continueTargetNodeId: "start-here", actions: [{ targetNodeId: "start-here" }] });
  });

  it("updates quest dialogue links when the linked dialogue ID is renamed", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const draft = workspaceFixture();
    draft.quests[0].extension.dialogueLinks.offer = draft.dialogues[0].sequence.sequenceId;
    draft.selectedType = "dialogue";
    draft.selectedKey = draft.dialogues[0].key;
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();

    const sequenceId = document.querySelector<HTMLInputElement>('[data-bind="sequenceId"]')!;
    sequenceId.value = "elder-introduction";
    sequenceId.dispatchEvent(new Event("change", { bubbles: true }));
    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.dialogues[0].sequence.sequenceId).toBe("elder-introduction");
    expect(saved.quests[0].extension.dialogueLinks.offer).toBe("elder-introduction");
  });

  it("creates an army from a campaign node and returns to that exact floor and node", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(1);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-add-floor"]')!.click();
    const floors = document.querySelectorAll<HTMLButtonElement>('[data-action="campaign-select-floor"]');
    floors[1].click();
    goToCampaignStep(2);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-node"][data-node-id="battle-a-2"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="create-campaign-army"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="return-to-parent"]')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(saved.selectedType).toBe("campaign");
    expect(campaign.floors[1].nodes.find((node: { id: string }) => node.id === "battle-a-2")?.armyId).toBe(saved.armies.at(-1).id);
    expect(document.querySelector(".campaign-node-focus")).not.toBeNull();
    expect(document.querySelector(".campaign-context-map .campaign-board-workspace")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    expect(document.querySelector<HTMLElement>('.campaign-node[data-node-id="battle-a-2"]')?.classList.contains("is-selected")).toBe(true);
  });

  it("keeps a campaign return target through a quest to army handoff", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(4);
    document.querySelector<HTMLButtonElement>('[data-action="create-campaign-pool-quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="open-campaign-pool-quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="create-quest-battle-army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();

    const returnedQuest = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const quest = returnedQuest.quests.find((item: { key: string }) => item.key === returnedQuest.selectedKey);
    expect(returnedQuest.selectedType).toBe("quest");
    expect(quest.extension.battleTargets[0].armyId).toBe(returnedQuest.armies.at(-1).id);
    expect(document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    const returnedCampaign = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(returnedCampaign.selectedType).toBe("campaign");
    expect(returnedCampaign.campaigns.find((item: { key: string }) => item.key === returnedCampaign.selectedKey)?.questIds).toContain(quest.definition.id);
  });

  it("does not add an unselected campaign quest just because it was opened for editing", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(4);
    document.querySelector<HTMLButtonElement>('[data-action="open-campaign-pool-quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();

    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign.questIds).toEqual([]);
    expect(saved.selectedType).toBe("campaign");
  });

  it("adds campaign nodes and connects them directly with plugs", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(2);
    expect(document.querySelector(".campaign-map-status")?.textContent).toContain("Drag plugs to connect");

    chooseCampaignNodeType("Reward");
    expect(document.querySelector(".campaign-map-status")?.textContent).toContain("place a Reward node");
    clickCampaignCanvasAt(0, 1);
    expect(document.querySelector(".campaign-node-focus")).not.toBeNull();
    expect(document.querySelector(".campaign-context-map .campaign-board-workspace")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="open-guided-editor"]')!.click();
    expect(document.querySelector(".campaign-node-focus")).not.toBeNull();
    expect(document.querySelector(".campaign-context-map .campaign-board-workspace")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    const reward = campaign.floors[0].nodes.find((node: { kind: string }) => node.kind === "Reward");
    expect(reward).toMatchObject({ id: "reward-1", x: 0, y: 1 });

    const moveDataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const nodeDragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(nodeDragStart, "dataTransfer", { value: moveDataTransfer });
    document.querySelector<HTMLElement>('[data-campaign-node][data-node-id="reward-1"]')!.dispatchEvent(nodeDragStart);
    expect(moveDataTransfer.setData).toHaveBeenCalledWith("text/plain", "reward-1");
    expect(moveDataTransfer.effectAllowed).toBe("move");

    const plugDragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(plugDragStart, "dataTransfer", { value: { setData: vi.fn(), effectAllowed: "" } });
    document.querySelector<HTMLElement>('[data-campaign-port="output"][data-node-id="reward-1"]')!.dispatchEvent(plugDragStart);
    expect(plugDragStart.defaultPrevented).toBe(true);

    const dragOverDataTransfer = { dropEffect: "" };
    const canvasDragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(canvasDragOver, "dataTransfer", { value: dragOverDataTransfer });
    document.querySelector<HTMLElement>("[data-campaign-canvas]")!.dispatchEvent(canvasDragOver);
    expect(canvasDragOver.defaultPrevented).toBe(true);
    expect(dragOverDataTransfer.dropEffect).toBe("move");
    const outsideDragOver = new Event("dragover", { bubbles: true, cancelable: true });
    document.querySelector<HTMLElement>(".campaign-board-tools")!.dispatchEvent(outsideDragOver);
    expect(outsideDragOver.defaultPrevented).toBe(false);

    const rewardOutput = document.querySelector<HTMLElement>('[data-campaign-port="output"][data-node-id="reward-1"]')!;
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperties(pointerDown, { clientX: { value: 25 }, clientY: { value: 30 } });
    rewardOutput.dispatchEvent(pointerDown);
    const pointerMove = new Event("pointermove", { bubbles: true });
    Object.defineProperties(pointerMove, { clientX: { value: 90 }, clientY: { value: 120 } });
    rewardOutput.dispatchEvent(pointerMove);
    expect(document.querySelector<SVGLineElement>(".campaign-route-draft")?.hasAttribute("hidden")).toBe(false);

    const sameNodeInput = document.querySelector<HTMLElement>('[data-campaign-port="input"][data-node-id="reward-1"]')!;
    sameNodeInput.dispatchEvent(new Event("pointerup", { bubbles: true, cancelable: true }));
    expect(document.querySelector("#toast-region")?.textContent).toContain("Drop the plug on a different node");
    expect(document.querySelector<SVGLineElement>(".campaign-route-draft")?.hasAttribute("hidden")).toBe(true);

    rewardOutput.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event("pointerup", { bubbles: true, cancelable: true }));
    expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).campaigns[0].floors[0].routes).toHaveLength(4);

    dragCampaignPlugs("reward-1", "start");
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const savedCampaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    const route = savedCampaign.floors[0].routes.find((item: { fromNodeId: string; toNodeId: string }) => item.fromNodeId === "reward-1" && item.toNodeId === "start");
    expect(route?.oneWay).toBe(false);
    expect(document.querySelector("#toast-region")?.textContent).toContain("Nodes connected.");
    const routeLine = document.querySelector<SVGPathElement>('[data-campaign-route-id="' + route.id + '"]')!;
    const routeKey = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    routeLine.dispatchEvent(routeKey);
    expect(routeKey.defaultPrevented).toBe(true);
    expect(document.querySelector('.campaign-route-remove-float[data-route-id="' + route.id + '"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-node"][data-node-id="start"]')!.click();
    document.querySelector<HTMLDetailsElement>(".campaign-focused-connections")!.querySelector("summary")!.click();
    expect(document.querySelector<HTMLButtonElement>('[data-action="campaign-remove-route"][data-route-id="' + route.id + '"]')?.getAttribute("aria-label")).toContain("Disconnect Reward 1 linked with Start");
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-route-direction"][data-route-id="' + route.id + '"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey).floors[0].routes.find((item: { id: string }) => item.id === route.id)?.oneWay).toBe(true);
    document.querySelector<HTMLDetailsElement>(".campaign-focused-connections")!.querySelector("summary")!.click();

    document.querySelector<HTMLButtonElement>('[data-action="campaign-remove-route"][data-route-id="' + route.id + '"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey).floors[0].routes.some((item: { id: string }) => item.id === route.id)).toBe(false);

    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    dragCampaignPlugs("reward-1", "start");
    const secondRoute = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).campaigns[0].floors[0].routes.find((item: { fromNodeId: string; toNodeId: string }) => item.fromNodeId === "reward-1" && item.toNodeId === "start");
    document.querySelector<SVGPathElement>('[data-campaign-route-id="' + secondRoute.id + '"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>('.campaign-route-remove-float[data-route-id="' + secondRoute.id + '"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.campaign-route-remove-float[data-route-id="' + secondRoute.id + '"]')!.click();
    dropCampaignNodeAt("reward-1", 2, 1);
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey).floors[0].nodes.find((node: { id: string }) => node.id === "reward-1")).toMatchObject({ x: 2, y: 1 });
  });

  it("explains invalid plug connections and clears the draft preview", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(2);
    chooseCampaignNodeType("Reward");
    clickCampaignCanvasAt(3, -2);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    dragCampaignPlugs("start", "reward-1");

    expect(document.querySelector("#toast-region")?.textContent).toContain("Drop on a neighboring node");
    const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign.floors[0].routes).toHaveLength(4);
    expect(document.querySelector(".campaign-route-draft")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".campaign-map-status")?.textContent).toContain("Drag plugs to connect");
  });

  it("authors a custom campaign across floors, routes, quest and army links, and review", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(2);
    chooseCampaignNodeType("Quest");
    clickCampaignCanvasAt(0, -1);
    expect(document.querySelector(".campaign-context-map .campaign-board-workspace")).not.toBeNull();
    expect(document.querySelector(".campaign-node-focus h2")?.textContent).toBe("Floor 1 · Quest 1");
    document.querySelector<HTMLButtonElement>('[data-action="create-campaign-node-quest"]')!.click();
    document.querySelector<HTMLInputElement>('[data-bind="definition.title"]')!.value = "Find the Old Road";
    document.querySelector<HTMLInputElement>('[data-bind="definition.title"]')!.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    let campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    const quest = saved.quests[0];
    expect(campaign.questIds).toContain(quest.definition.id);
    expect(campaign.floors[0].nodes.find((node: { id: string }) => node.id === "quest-1")?.questId).toBe(quest.definition.id);

    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    dragCampaignPlugs("start", "quest-1");
    chooseCampaignNodeType("Reward");
    clickCampaignCanvasAt(1, 0);
    document.querySelector<HTMLInputElement>('[data-bind="floors.0.nodes.5.rewardAmount"]')!.value = "25";
    document.querySelector<HTMLInputElement>('[data-bind="floors.0.nodes.5.rewardAmount"]')!.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="campaign-back-to-map"]')!.click();
    dragCampaignPlugs("reward-1", "battle-b-1");

    document.querySelector<HTMLButtonElement>('[data-action="campaign-node"][data-node-id="battle-a-1"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="create-campaign-army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign.floors[0].nodes.find((node: { id: string }) => node.id === "battle-a-1")?.armyId).toBe(saved.armies[0].id);
    expect(campaign.floors[0].nodes.find((node: { id: string }) => node.id === "reward-1")?.rewardAmount).toBe(25);

    goToCampaignStep(1);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-add-floor"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-set-floor-mode"][data-mode="random"]')!.click();
    document.querySelector<HTMLInputElement>('[data-bind="floors.1.randomSettings.nodeCount"]')!.value = "16";
    document.querySelector<HTMLInputElement>('[data-bind="floors.1.randomSettings.nodeCount"]')!.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="campaign-select-floor"][data-floor-id="' + campaign.floors[0].id + '"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-set-floor-mode"][data-mode="mixed"]')!.click();
    goToCampaignStep(4);
    const questFilter = document.querySelector<HTMLInputElement>('[data-campaign-quest-filter="campaign"]')!;
    questFilter.value = "no matching quest";
    questFilter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>(".campaign-quest-pool-list .campaign-quest-row")?.hidden).toBe(true);
    questFilter.value = "Old Road";
    questFilter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>(".campaign-quest-pool-list .campaign-quest-row")?.hidden).toBe(false);
    goToCampaignStep(5);
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-floor-pool-mode"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="campaign-toggle-floor-quest"][data-quest-id="' + quest.definition.id + '"]')!.click();
    goToCampaignStep(0);
    const name = document.querySelector<HTMLInputElement>('[data-bind="name"]')!;
    name.value = "The Old Road";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    goToCampaignStep(8);
    const lives = document.querySelector<HTMLInputElement>('[data-bind="settings.startingLives"]')!;
    lives.value = "5";
    lives.dispatchEvent(new Event("input", { bubbles: true }));

    goToCampaignStep(10);
    expect(document.querySelector(".campaign-review-summary")?.textContent).toContain("The Old Road");
    expect(document.querySelector(".campaign-review-summary")?.textContent).toContain("2");
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    campaign = saved.campaigns.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(campaign).toMatchObject({ name: "The Old Road", settings: { startingLives: 5 } });
    expect(campaign.floors.map((floor: { mode: string }) => floor.mode)).toEqual(["mixed", "random"]);
    expect(campaign.floors[1].randomSettings.nodeCount).toBe(16);
  });

  it("restores an in-progress Campaign-to-Army handoff after a browser reload", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    const draft = workspaceFixture();
    draft.selectedType = "army";
    draft.selectedKey = draft.armies[0].key;
    localStorage.setItem("meowedit.workspace.v1", JSON.stringify(draft));
    localStorage.setItem(EDITOR_SESSION_STORAGE_KEY, JSON.stringify({
      ...defaultEditorSession(), editorMode: "full", activeEditorStep: 3,
      selectedCampaignFloorId: draft.campaigns[0].floors[0].id, selectedCampaignNodeId: "battle-a-1",
      relatedReturnContexts: [{
        parentType: "campaign", parentKey: draft.campaigns[0].key, floorId: draft.campaigns[0].floors[0].id,
        nodeId: "battle-a-1", target: "army", parentStep: 3, returnLabel: draft.campaigns[0].name
      }]
    }));

    await import("../src/main");
    expect(document.querySelector(".full-army-editor")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();

    const restored = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(restored.selectedType).toBe("campaign");
    expect(restored.campaigns[0].floors[0].nodes.find((node: { id: string }) => node.id === "battle-a-1")?.armyId).toBe(draft.armies[0].id);
    expect(JSON.parse(localStorage.getItem(EDITOR_SESSION_STORAGE_KEY)!).activeEditorStep).toBe(3);
  });

  it("authors a dialogue moment, speaker, line, choice, and named outcome", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New dialogue"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="guided-add-node"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-speaker"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-segment"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-action"]')!.click();

    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="toggle-decision"]')!.click();
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const dialogue = saved.dialogues.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(dialogue.sequence.nodes).toHaveLength(2);
    expect(dialogue.sequence.nodes[1].speakers).toHaveLength(1);
    expect(dialogue.sequence.nodes[1].segments).toHaveLength(2);
    expect(dialogue.sequence.nodes[1].actions[0].decision).toMatchObject({ id: "decision-node-2", outcomeId: "option-1" });

    document.querySelector<HTMLButtonElement>('[data-action="remove-action"][data-node-index="1"][data-index="0"]')!.click();
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.dialogues.find((item: { key: string }) => item.key === saved.selectedKey).sequence.nodes[1].actions).toEqual([]);
  });

  it("configures quest details and creates a dialogue link directly from Advanced", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="editor-next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-battle-target"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="remove-battle-target"][data-index="1"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="add-minimum-distance"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="remove-minimum-distance"][data-index="0"]')!.click();

    const objective = document.querySelector<HTMLSelectElement>('[data-bind="definition.objectiveKind"]')!;
    objective.value = "Fetch";
    objective.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="add-fetch-item"]')!.click();
    const itemName = document.querySelector<HTMLInputElement>('[data-bind="extension.fetchItems.0.displayName"]')!;
    itemName.value = "Old Silver Key";
    itemName.dispatchEvent(new Event("input", { bubbles: true }));
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    let quest = saved.quests.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(quest.extension.fetchItems[0]).toMatchObject({ id: "old-silver-key", displayName: "Old Silver Key" });
    document.querySelector<HTMLButtonElement>('[data-action="remove-fetch-item"][data-index="0"]')!.click();

    const battleObjective = document.querySelector<HTMLSelectElement>('[data-bind="definition.objectiveKind"]')!;
    battleObjective.value = "Battle";
    battleObjective.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="create-quest-battle-army"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="open-full-editor"]')!.click();
    expect(document.querySelector<HTMLAnchorElement>('a[href="#quest-dialogues"]')).not.toBeNull();
    expect(document.querySelector('[data-bind="extension.dialogueLinks.offer"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="create-quest-dialogue"][data-slot="offer"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();

    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    quest = saved.quests.find((item: { key: string }) => item.key === saved.selectedKey);
    expect(quest.extension.battleTargets[0].armyId).toBe(saved.armies[0].id);
    expect(quest.extension.dialogueLinks.offer).toBe(saved.dialogues[0].sequence.sequenceId);
  });

  it("imports supported JSON documents, reports invalid files, and exports active content", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    changeImportFile("welcome.json", JSON.stringify({ sequenceId: "welcome", startNodeId: "opening", nodes: [{ id: "opening", headline: "Welcome", segments: [], actions: [] }] }));
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).dialogues).toHaveLength(1));
    expect(document.querySelector("#toast-region")?.textContent).toContain("Imported 1 content item");

    changeImportFile("invalid.json", JSON.stringify({ unsupported: true }));
    await vi.waitFor(() => expect(document.querySelector("#toast-region")?.textContent).toContain("Choose a MeowEdit workspace"));

    const createObjectURL = vi.fn(() => "blob:meowedit-test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    document.querySelector<HTMLButtonElement>('[data-action="export-active"]')!.click();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>('[data-action="export-package"]')!.click();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("imports the complete ZIP package format back into the browser workspace", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));
    await import("../src/main");

    changeImportZip(workspacePackage(workspaceFixture(), rosterFixture));
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
      expect(saved.dialogues).toHaveLength(1);
      expect(saved.quests).toHaveLength(1);
      expect(saved.armies).toHaveLength(1);
      expect(saved.campaigns).toHaveLength(1);
    });
    expect(document.querySelector("#toast-region")?.textContent).toContain("Imported 4 content items");
  });

  it("imports examples once and removes them only after the confirmation dialog closes", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const examples = {
      format: "meowedit-game-examples",
      dialogues: [{ sequenceId: "elder-greeting", startNodeId: "opening", nodes: [{ id: "opening", segments: [], actions: [] }] }],
      quests: [{ definition: { id: "lost-supplies", title: "Lost Supplies", objectiveKind: "Fetch" } }]
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("game-examples") ? examples : String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    changeImportFile("existing-dialogue.json", JSON.stringify({ sequenceId: "elder-greeting", startNodeId: "opening", nodes: [{ id: "opening", segments: [], actions: [] }] }));
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).dialogues).toHaveLength(1));
    document.querySelector<HTMLButtonElement>('[data-action="import-game-examples"]')!.click();
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).quests).toHaveLength(1));
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.dialogues[0].isGameExample).toBeFalsy();
    expect(document.querySelector("#toast-region")?.textContent).toContain("Skipped 1 item");

    const importExamplesAgain = document.createElement("button");
    importExamplesAgain.dataset.action = "import-game-examples";
    document.querySelector("#app")!.append(importExamplesAgain);
    importExamplesAgain.click();
    await vi.waitFor(() => expect(document.querySelector("#toast-region")?.textContent).toContain("All game examples already exist"));
    expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).quests).toHaveLength(1);

    const exampleQuest = saved.quests[0];
    document.querySelector<HTMLButtonElement>('[data-action="select-item"][data-type="quest"][data-key="' + exampleQuest.key + '"]')!.click();
    const dialog = document.querySelector<HTMLDialogElement>("#remove-examples-dialog")!;
    Object.defineProperty(dialog, "showModal", { configurable: true, value: vi.fn() });
    document.querySelector<HTMLButtonElement>('[data-action="remove-game-examples"]')!.click();
    dialog.returnValue = "cancel";
    dialog.dispatchEvent(new Event("close"));
    expect(JSON.parse(localStorage.getItem("meowedit.workspace.v1")!).quests).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('[data-action="remove-game-examples"]')!.click();
    dialog.returnValue = "confirm";
    dialog.dispatchEvent(new Event("close"));
    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.dialogues).toHaveLength(1);
    expect(saved.quests).toEqual([]);
    expect(saved.selectedType).toBe("dialogue");
    expect(saved.selectedKey).toBe(saved.dialogues[0].key);
    expect(saved.activeNodeId).toBe(saved.dialogues[0].sequence.startNodeId);
  });

  it.each([
    { name: "an unavailable file", response: { ok: false, json: async () => ({}) }, message: "The game examples could not be loaded." },
    { name: "an unsupported format", response: { ok: true, json: async () => ({ format: "other", dialogues: [], quests: [] }) }, message: "The game examples file has an unsupported format." }
  ])("shows a useful message when importing examples from $name fails", async ({ response, message }) => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("game-examples")
      ? response
      : { ok: true, json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture }));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[data-action="import-game-examples"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#toast-region")?.textContent).toContain(message));
    expect(localStorage.getItem("meowedit.workspace.v1")).toBeNull();
  });

  it("removes a quest from its campaign references after list deletion is confirmed", async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("army-catalog") ? baseCatalog : rosterFixture
    })));

    await import("../src/main");
    document.querySelector<HTMLButtonElement>('[aria-label="New campaign"]')!.click();
    goToCampaignStep(4);
    document.querySelector<HTMLButtonElement>('[data-action="create-campaign-pool-quest"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="return-to-parent"]')!.click();
    let saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    const questId = saved.quests[0].definition.id;
    const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog")!;
    Object.defineProperty(dialog, "showModal", { configurable: true, value: vi.fn() });
    document.querySelector<HTMLButtonElement>('[data-action="delete-item"][data-type="quest"]')!.click();
    dialog.returnValue = "confirm";
    dialog.dispatchEvent(new Event("close"));

    saved = JSON.parse(localStorage.getItem("meowedit.workspace.v1")!);
    expect(saved.quests).toEqual([]);
    expect(saved.campaigns[0].questIds).not.toContain(questId);
    expect(saved.selectedType).toBe("campaign");
  });
});
