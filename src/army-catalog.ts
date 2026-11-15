import type { ArmyCatalog, ArmyCatalogLevel, ArmyCatalogUnit } from "./model";

export type ArmyCatalogKind = "units" | "buildings";

export interface ResolvedArmyLevel {
  entity: ArmyCatalogUnit;
  level: ArmyCatalogLevel;
  kind: ArmyCatalogKind;
}

export interface ArmyFootprint {
  width: number;
  height: number;
}

export function resolveArmyLevel(catalog: ArmyCatalog, levelId: string): ResolvedArmyLevel | undefined {
  for (const kind of ["units", "buildings"] as const) {
    const entity = catalog[kind].find(item => item.levels.some(level => level.id === levelId));
    const level = entity?.levels.find(item => item.id === levelId);
    if (entity && level) return { entity, level, kind };
  }
  return undefined;
}

export function armyFootprint(catalog: ArmyCatalog, levelId: string): ArmyFootprint {
  const footprint = resolveArmyLevel(catalog, levelId)?.level.footprint;
  return {
    width: Math.max(1, Math.floor(footprint?.width ?? 1)),
    height: Math.max(1, Math.floor(footprint?.height ?? 1))
  };
}

export function armyGridSize(catalog: ArmyCatalog, floor: number): ArmyFootprint {
  return [...catalog.gridSizes].sort((a, b) => b.minFloor - a.minFloor).find(size => floor >= size.minFloor)
    ?? { width: 3, height: 3 };
}

export function canPlaceArmyLevel(
  units: ReadonlyArray<{ id: string; unitId: string; x: number; y: number }>,
  catalog: ArmyCatalog,
  levelId: string,
  x: number,
  y: number,
  grid: ArmyFootprint,
  ignorePlacementId?: string
): boolean {
  const footprint = armyFootprint(catalog, levelId);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0
    || x + footprint.width > grid.width || y + footprint.height > grid.height) return false;

  return !units.some(unit => {
    if (unit.id === ignorePlacementId) return false;
    const occupied = armyFootprint(catalog, unit.unitId);
    return x < unit.x + occupied.width && x + footprint.width > unit.x
      && y < unit.y + occupied.height && y + footprint.height > unit.y;
  });
}

export function armyFootprintsOverlap(catalog: ArmyCatalog, left: { unitId: string; x: number; y: number }, right: { unitId: string; x: number; y: number }): boolean {
  const leftSize = armyFootprint(catalog, left.unitId);
  const rightSize = armyFootprint(catalog, right.unitId);
  return left.x < right.x + rightSize.width && left.x + leftSize.width > right.x
    && left.y < right.y + rightSize.height && left.y + leftSize.height > right.y;
}

export function firstAvailableArmyCell(
  units: ReadonlyArray<{ id: string; unitId: string; x: number; y: number }>,
  catalog: ArmyCatalog,
  levelId: string,
  grid: ArmyFootprint
): { x: number; y: number } | undefined {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (canPlaceArmyLevel(units, catalog, levelId, x, y, grid)) return { x, y };
    }
  }
  return undefined;
}
