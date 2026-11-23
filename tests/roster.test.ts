import { describe, expect, it } from "vitest";
import { includeArmyUnitsInRoster } from "../src/legacy/roster";
import type { ArmyCatalog, UnitRoster } from "../src/legacy/model";
import { catalog, rosterFixture } from "./fixtures";

describe("dialogue character roster", () => {
  it("adds every Army unit, keeps captured portraits, and excludes buildings", () => {
    const roster: UnitRoster = {
      ...rosterFixture,
      units: [{ id: "Cats/Fighter/1", displayName: "Fighter", faction: "Cats", portrait: "./avatars/fighter.png", moods: ["Normal"] }]
    };
    const armyCatalog: ArmyCatalog = {
      ...catalog,
      units: [
        ...catalog.units,
        { id: "Cats/Archer/1", name: "Archer", factionId: "Cats", faction: "Cats", levels: [{ id: "Cats/Archer/1", name: "Archer", level: 1, previewImage: "./avatars/archer.png" }] },
        { id: "Neutral/Stray/1", name: "Stray", factionId: "Neutral", faction: "Neutral", levels: [{ id: "Neutral/Stray/1", name: "Stray", level: 1, previewImage: "./avatars/Neutral-Stray-1.png" }] }
      ]
    };

    const merged = includeArmyUnitsInRoster(roster, armyCatalog);

    expect(merged.units.map(unit => unit.id)).toEqual(expect.arrayContaining([
      "Cats/Fighter/1", "Cats/Fighter/2", "Cats/Archer/1", "Neutral/Stray/1"
    ]));
    expect(merged.units.filter(unit => unit.id === "Cats/Fighter/1")).toHaveLength(1);
    expect(merged.units.find(unit => unit.id === "Cats/Fighter/1")?.portrait).toBe("./avatars/fighter.png");
    expect(merged.units.find(unit => unit.id === "Cats/Archer/1")?.portrait).toBe("./avatars/archer.png");
    expect(merged.units.find(unit => unit.id === "Cats/Fighter/2")).toMatchObject({
      displayName: "Fighter", level: 2, portrait: "./avatars/Cats-Fighter-2.png"
    });
    expect(merged.units.find(unit => unit.id === "Neutral/Stray/1")).toMatchObject({
      level: 1, portrait: "./avatars/Neutral-Stray-1.png"
    });
    expect(merged.units.find(unit => unit.id === "Neutral/Stray/1")?.moods).toEqual([
      "Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"
    ]);
    expect(merged.units.some(unit => unit.id === "Cats/Barricade/1")).toBe(false);
  });
});
