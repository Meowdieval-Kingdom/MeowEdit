import { describe, expect, it } from "vitest";
import { armyFootprintsOverlap, armyGridSize, canPlaceArmyLevel, firstAvailableArmyCell } from "../src/legacy/army-catalog";
import { catalog } from "./fixtures";

describe("army catalog formation geometry", () => {
  it("finds room for a building footprint and reserves every covered cell", () => {
    const grid = armyGridSize(catalog, 1);
    const units: Array<{ id: string; unitId: string; x: number; y: number }> = [];
    const first = firstAvailableArmyCell(units, catalog, "Peasants/Chapel/1", grid);
    expect(first).toEqual({ x: 0, y: 0 });
    units.push({ id: "barricade", unitId: "Peasants/Chapel/1", ...first! });

    expect(canPlaceArmyLevel(units, catalog, "Peasants/Fighter/1", 1, 0, grid)).toBe(false);
    expect(canPlaceArmyLevel(units, catalog, "Peasants/Fighter/1", 2, 0, grid)).toBe(true);
    expect(canPlaceArmyLevel(units, catalog, "Peasants/Chapel/1", 2, 2, grid)).toBe(false);
    expect(armyFootprintsOverlap(catalog, units[0], { unitId: "Peasants/Fighter/1", x: 1, y: 0 })).toBe(true);
  });

  it("excludes the moving placement while checking a new position", () => {
    const army = [
      { id: "wide", unitId: "Peasants/Chapel/1", x: 0, y: 0 },
      { id: "fighter", unitId: "Peasants/Fighter/1", x: 2, y: 0 }
    ];
    const grid = armyGridSize(catalog, 1);
    expect(canPlaceArmyLevel(army, catalog, "Peasants/Chapel/1", 0, 0, grid, "wide")).toBe(true);
    expect(canPlaceArmyLevel(army, catalog, "Peasants/Chapel/1", 1, 0, grid, "wide")).toBe(false);
  });

  it("extends the formation for selected grid blessings", () => {
    expect(armyGridSize(catalog, 1, ["grid-column"])).toEqual({ width: 3, height: 4 });
    expect(armyGridSize(catalog, 1, ["grid-column", "unknown"])).toEqual({ width: 3, height: 4 });
  });

  it("also applies grid effects if the game catalog classifies one as a curse", () => {
    const curseCatalog = {
      ...catalog,
      curses: [{ id: "grid-row-curse", name: "Grid Row Curse", family: "grid" as const, mechanics: { effect: "AddRow" } }]
    };
    expect(armyGridSize(curseCatalog, 1, ["grid-row-curse"])).toEqual({ width: 4, height: 3 });
  });
});
