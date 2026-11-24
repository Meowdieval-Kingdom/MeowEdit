import { DEFAULT_MOODS, type ArmyCatalog, type UnitRoster, type UnitRosterEntry } from "./model";

/** Adds every Army catalog unit form to dialogue and quest character pickers, while excluding buildings. */
export function includeArmyUnitsInRoster(roster: UnitRoster, catalog: ArmyCatalog): UnitRoster {
  const units = new Map(roster.units.map(unit => [unit.id, unit]));

  for (const armyUnit of catalog.units) {
    for (const level of armyUnit.levels) {
      const existing = units.get(level.id);
      const entry: UnitRosterEntry = {
        id: level.id,
        displayName: existing?.displayName || level.name || armyUnit.name,
        faction: existing?.faction || armyUnit.faction,
        level: level.level,
        moods: existing?.moods ?? [...DEFAULT_MOODS],
        ...(existing?.portraitCaptures ? { portraitCaptures: existing.portraitCaptures } : {}),
        ...((existing?.portrait || level.previewImage) ? { portrait: existing?.portrait || level.previewImage } : {})
      };
      units.set(entry.id, entry);
    }
  }

  return {
    ...roster,
    source: roster.source + " Army catalog units and upgrade forms are selectable too; buildings are excluded.",
    units: [...units.values()].sort((left, right) =>
      left.faction.localeCompare(right.faction)
        || left.displayName.localeCompare(right.displayName)
        || (left.level ?? 0) - (right.level ?? 0))
  };
}
