import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), relativePath), "utf8"));
}

describe("captured avatar assets", () => {
  it("provides valid PNG files for every Compendium and Army preview reference", () => {
    const roster = readJson("public/unit-roster.json");
    const catalog = readJson("public/army-catalog.json");
    const dialoguePortraits = roster.units.map(unit => unit.portrait);
    const armyPortraits = catalog.units.flatMap(unit => unit.levels.map(level => level.previewImage));

    expect(roster.units.length).toBeGreaterThan(0);
    expect(dialoguePortraits.every(Boolean)).toBe(true);
    const unitIds = new Set(catalog.units.map(unit => unit.id));
    expect(catalog.buildings.some(building => unitIds.has(building.id))).toBe(false);

    for (const relativeImage of new Set([...dialoguePortraits, ...armyPortraits].filter(Boolean))) {
      const imagePath = path.resolve(process.cwd(), "public", relativeImage.replace(/^\.\//, ""));
      expect(existsSync(imagePath), `${relativeImage} should be present in public assets`).toBe(true);
      expect(readFileSync(imagePath).subarray(0, pngSignature.length), `${relativeImage} should be a PNG`).toEqual(pngSignature);
    }
  });
});
