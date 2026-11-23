import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAbility, findEntity, findLevel, loadArmyCatalog } from "../src/v2/catalog";

const catalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/army-catalog-lite.json"), "utf8"));

describe("v2 army catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the checked-in catalog and finds entities, levels and abilities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalog), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    const loaded = await loadArmyCatalog();
    expect(loaded.units.length).toBeGreaterThan(0);
    const unitId = catalog.units[0].levels[0].id as string;
    expect(findEntity(loaded, unitId)?.id).toBe(catalog.units[0].id);
    expect(findLevel(loaded, unitId)?.id).toBe(unitId);
    const spellId = catalog.spells[0].id as string;
    expect(findAbility(loaded, spellId)?.id).toBe(spellId);
  });

  it("returns undefined for unknown IDs", () => {
    expect(findEntity(catalog, "missing-unit")).toBeUndefined();
    expect(findLevel(catalog, "missing-level")).toBeUndefined();
    expect(findAbility(catalog, "missing-ability")).toBeUndefined();
  });

  it("ships a lite catalog without art paths, mechanics or source hashes", () => {
    expect(catalog).not.toHaveProperty("implementationSources");
    expect(catalog.units[0].levels[0]).not.toHaveProperty("previewImage");
    expect(catalog.spells[0]).not.toHaveProperty("sourceHash");
    expect(readFileSync(path.resolve(process.cwd(), "public/army-catalog-lite.json")).length).toBeLessThan(200_000);
  });
});
