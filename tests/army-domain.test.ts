import { describe, expect, it } from "vitest";
import { addArmyUnit, addArmyUnitSpell, moveArmyUnit, removeArmyUnitSpell, replaceArmyUnit, type ArmyPlacementMove } from "../src/editor/army-domain";
import { armyFixture, catalog } from "./fixtures";
import { armyFootprintsOverlap, canPlaceArmyLevel } from "../src/editor/army-catalog";

describe("army editing operations", () => {
  it("adds a placement with an independent spell list and rejects occupied cells", () => {
    const army = armyFixture();
    expect(addArmyUnit(army, { id: "p2", unitId: "Peasants/Fighter/2", x: 1, y: 0, spellIds: ["fireball"] })).toBe(true);
    expect(army.units[1].spellIds).toEqual(["fireball"]);
    expect(addArmyUnit(army, { id: "p3", unitId: "Peasants/Fighter/1", x: 1, y: 0, spellIds: [] })).toBe(false);
    expect(addArmyUnit(army, { id: "p4", unitId: "", x: 2, y: 0, spellIds: [] })).toBe(false);
    expect(army.units).toHaveLength(2);
  });

  it("replaces a unit in place and clears spells only when the unit changes", () => {
    const army = armyFixture();
    army.units[0].spellIds = ["fireball"];
    expect(replaceArmyUnit(army, "placement-1", "Peasants/Fighter/1")).toBe(true);
    expect(army.units[0].spellIds).toEqual(["fireball"]);
    expect(replaceArmyUnit(army, "placement-1", "Peasants/Fighter/2")).toBe(true);
    expect(army.units[0]).toMatchObject({ unitId: "Peasants/Fighter/2", x: 0, y: 0, spellIds: [] });
    expect(replaceArmyUnit(army, "missing", "Peasants/Fighter/1")).toBe(false);
    expect(replaceArmyUnit(army, "placement-1", "")).toBe(false);
  });

  it("moves selected units and swaps with an occupied placement", () => {
    const army = armyFixture();
    army.units.push({ id: "p2", unitId: "Peasants/Fighter/2", x: 1, y: 0, spellIds: [] });
    expect(moveArmyUnit(army, "placement-1", 1, 0)).toBe(true);
    expect(army.units.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 1, y: 0 }, { x: 0, y: 0 }]);
    expect(moveArmyUnit(army, "placement-1", 2, 0)).toBe(true);
    expect(moveArmyUnit(army, "missing", 0, 0)).toBe(false);
    expect(army.units[0]).toMatchObject({ x: 2, y: 0 });
  });

  it("validates a full swap before changing positions, including building footprints", () => {
    const army = armyFixture();
    army.units[0].unitId = "Peasants/Chapel/1";
    army.units.push({ id: "p2", unitId: "Peasants/Fighter/1", x: 0, y: 1, spellIds: [] });
    const grid = { width: 3, height: 3 };
    const validateSwap = (moves: readonly ArmyPlacementMove[]) => {
      const movingIds = new Set(moves.map(move => move.placement.id));
      const stationary = army.units.filter(unit => !movingIds.has(unit.id));
      const proposals = moves.map(move => ({ id: move.placement.id, unitId: move.placement.unitId, x: move.x, y: move.y }));
      return proposals.every(move => canPlaceArmyLevel(stationary, catalog, move.unitId, move.x, move.y, grid))
        && proposals.every((move, index) => proposals.slice(index + 1).every(other => !armyFootprintsOverlap(catalog, move, other)));
    };
    expect(moveArmyUnit(army, "placement-1", 0, 1, validateSwap)).toBe(true);
    expect(army.units.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 0, y: 1 }, { x: 0, y: 0 }]);

    army.units[0].x = 0; army.units[0].y = 0;
    army.units[1].x = 0; army.units[1].y = 1;
    army.units.push({ id: "p3", unitId: "Peasants/Fighter/1", x: 1, y: 1, spellIds: [] });
    expect(moveArmyUnit(army, "placement-1", 0, 1, validateSwap)).toBe(false);
    expect(army.units.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  });

  it("validates, de-duplicates, and removes per-unit spells", () => {
    const army = armyFixture();
    expect(addArmyUnitSpell(army, "placement-1", "fireball", ["fireball", "shield"])).toBe(true);
    expect(addArmyUnitSpell(army, "placement-1", "fireball", ["fireball", "shield"])).toBe(false);
    expect(addArmyUnitSpell(army, "placement-1", "unknown", ["fireball", "shield"])).toBe(false);
    expect(addArmyUnitSpell(army, "missing", "shield", ["fireball", "shield"])).toBe(false);
    expect(removeArmyUnitSpell(army, "placement-1", 4)).toBe(false);
    expect(removeArmyUnitSpell(army, "placement-1", 0)).toBe(true);
    expect(army.units[0].spellIds).toEqual([]);
  });
});
