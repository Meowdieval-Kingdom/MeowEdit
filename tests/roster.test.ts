import { describe, expect, it } from "vitest";
import { includeArmyUnitsInRoster } from "../src/legacy/roster";
import type { ArmyCatalog, UnitRoster } from "../src/legacy/model";
import { catalog, rosterFixture } from "./fixtures";

describe("dialogue character roster", () => {
  it("adds every Army unit, keeps captured portraits, and excludes buildings", () => {
    const roster: UnitRoster = {
      ...rosterFixture,
      units: [{ id: "Peasants/Fighter/1", displayName: "Fighter", faction: "Peasants", portrait: "./avatars/Peasants-Fighter-1.png", moods: ["Normal"] }]
    };
    const armyCatalog: ArmyCatalog = {
      ...catalog,
      units: [
        ...catalog.units,
        { id: "Nobles/Royal Archer/1", name: "Archer", factionId: "Peasants", faction: "Peasants", levels: [{ id: "Nobles/Royal Archer/1", name: "Archer", level: 1, previewImage: "./avatars/Nobles-Royal Archer-1.png" }] },
        { id: "Neutral/Stray/1", name: "Stray", factionId: "Neutral", faction: "Neutral", levels: [{ id: "Neutral/Stray/1", name: "Stray", level: 1, previewImage: "./avatars/Neutral-Stray-1.png" }] }
      ]
    };

    const merged = includeArmyUnitsInRoster(roster, armyCatalog);

    expect(merged.units.map(unit => unit.id)).toEqual(expect.arrayContaining([
      "Peasants/Fighter/1", "Peasants/Fighter/2", "Nobles/Royal Archer/1", "Neutral/Stray/1"
    ]));
    expect(merged.units.filter(unit => unit.id === "Peasants/Fighter/1")).toHaveLength(1);
    expect(merged.units.find(unit => unit.id === "Peasants/Fighter/1")?.portrait).toBe("./avatars/Peasants-Fighter-1.png");
    expect(merged.units.find(unit => unit.id === "Nobles/Royal Archer/1")?.portrait).toBe("./avatars/Nobles-Royal Archer-1.png");
    expect(merged.units.find(unit => unit.id === "Peasants/Fighter/2")).toMatchObject({
      displayName: "Fighter", level: 2, portrait: "./avatars/Peasants-Fighter-2.png"
    });
    expect(merged.units.find(unit => unit.id === "Neutral/Stray/1")).toMatchObject({
      level: 1, portrait: "./avatars/Neutral-Stray-1.png"
    });
    expect(merged.units.find(unit => unit.id === "Neutral/Stray/1")?.moods).toEqual([
      "Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"
    ]);
    expect(merged.units.some(unit => unit.id === "Peasants/Chapel/1")).toBe(false);
  });
});

