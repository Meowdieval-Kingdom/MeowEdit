import { describe, expect, it } from "vitest";
import { armyFootprintsOverlap, armyGridSize, canPlaceArmyLevel, firstAvailableArmyCell } from "../src/army-catalog";
import { catalog } from "./fixtures";

describe("army catalog formation geometry", () => {
  it("finds room for a building footprint and reserves every covered cell", () => {
    const grid = armyGridSize(catalog, 1);
    const units: Array<{ id: string; unitId: string; x: number; y: number }> = [];
    const first = firstAvailableArmyCell(units, catalog, "Cats/Barricade/1", grid);
    expect(first).toEqual({ x: 0, y: 0 });
    units.push({ id: "barricade", unitId: "Cats/Barricade/1", ...first! });

    expect(canPlaceArmyLevel(units, catalog, "Cats/Fighter/1", 1, 0, grid)).toBe(false);
    expect(canPlaceArmyLevel(units, catalog, "Cats/Fighter/1", 2, 0, grid)).toBe(true);
    expect(canPlaceArmyLevel(units, catalog, "Cats/Barricade/1", 2, 2, grid)).toBe(false);
    expect(armyFootprintsOverlap(catalog, units[0], { unitId: "Cats/Fighter/1", x: 1, y: 0 })).toBe(true);
  });

  it("excludes the moving placement while checking a new position", () => {
    const army = [
      { id: "wide", unitId: "Cats/Barricade/1", x: 0, y: 0 },
      { id: "fighter", unitId: "Cats/Fighter/1", x: 2, y: 0 }
    ];
    const grid = armyGridSize(catalog, 1);
    expect(canPlaceArmyLevel(army, catalog, "Cats/Barricade/1", 0, 0, grid, "wide")).toBe(true);
    expect(canPlaceArmyLevel(army, catalog, "Cats/Barricade/1", 1, 0, grid, "wide")).toBe(false);
  });
});
