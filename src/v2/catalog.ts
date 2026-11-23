export interface CatalogLevel {
  id: string;
  level: number;
  description?: string;
  footprint?: { width: number; height: number };
  stats?: Record<string, number | undefined>;
}

export interface CatalogAbility {
  id: string;
  name: string;
  level?: number;
  description?: string;
  family?: string;
  isCurse?: boolean;
}

export interface CatalogEntity {
  id: string;
  name: string;
  faction?: string;
  levels: CatalogLevel[];
}

export interface ArmyCatalogLite {
  units: CatalogEntity[];
  buildings: CatalogEntity[];
  spells: CatalogAbility[];
  blessings: CatalogAbility[];
  curses: CatalogAbility[];
}

let cached: Promise<ArmyCatalogLite> | null = null;

export function loadArmyCatalog(): Promise<ArmyCatalogLite> {
  if (!cached) cached = fetch("./army-catalog.json", { cache: "no-cache" })
    .then(response => response.json() as Promise<ArmyCatalogLite>)
    .catch(() => ({ units: [], buildings: [], spells: [], blessings: [], curses: [] }));
  return cached;
}

export function findEntity(catalog: ArmyCatalogLite, id: string): CatalogEntity | undefined {
  return catalog.units.find(unit => unit.levels.some(level => level.id === id))
    ?? catalog.buildings.find(unit => unit.levels.some(level => level.id === id));
}

export function findLevel(catalog: ArmyCatalogLite, id: string): CatalogLevel | undefined {
  return [...catalog.units, ...catalog.buildings]
    .flatMap(unit => unit.levels)
    .find(level => level.id === id);
}

export function findAbility(catalog: ArmyCatalogLite, id: string): CatalogAbility | undefined {
  return [...catalog.spells, ...catalog.blessings, ...catalog.curses].find(ability => ability.id === id);
}
