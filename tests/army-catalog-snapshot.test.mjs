import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gameSnapshot = JSON.parse(readFileSync("public/army-catalog.json", "utf8"));

describe("checked-in game catalog", () => {
  it("includes current blessings, curses, cell effects, and implementation fingerprints", () => {
    expect(gameSnapshot.blessings.length).toBeGreaterThan(100);
    expect(gameSnapshot.curses.length).toBeGreaterThan(50);
    expect(gameSnapshot.curses.some(item => item.isAdventureOnly)).toBe(true);
    const cellEffects = [...gameSnapshot.blessings, ...gameSnapshot.curses].filter(item => item.family === "cell");
    expect(cellEffects.length).toBeGreaterThan(20);
    expect(cellEffects.some(item => item.mechanics.effect?.description)).toBe(true);
    expect(cellEffects.some(item => item.mechanics.baneEffect?.description)).toBe(true);
    expect(gameSnapshot.implementationSources.length).toBeGreaterThan(50);
    expect(gameSnapshot.implementationSources.some(item => item.id.endsWith("CellBlessingResolver.cs"))).toBe(true);
    expect([...gameSnapshot.spells, ...gameSnapshot.blessings, ...gameSnapshot.curses]
      .every(item => /^[a-f0-9]{64}$/.test(item.sourceHash ?? ""))).toBe(true);
  });
});
