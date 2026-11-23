import type { ArmyRecord, ArmyUnitPlacement } from "./model";

export interface ArmyPlacementMove {
  placement: ArmyUnitPlacement;
  x: number;
  y: number;
}

export function addArmyUnit(
  army: ArmyRecord,
  placement: ArmyUnitPlacement,
  canPlace?: (placement: ArmyUnitPlacement) => boolean
): boolean {
  if (!placement.unitId || army.units.some(unit => unit.x === placement.x && unit.y === placement.y)) return false;
  if (canPlace && !canPlace(placement)) return false;
  army.units.push({ ...placement, spellIds: [...(placement.spellIds ?? [])] });
  return true;
}

export function replaceArmyUnit(
  army: ArmyRecord,
  placementId: string,
  unitId: string,
  canReplace?: (unit: ArmyUnitPlacement, unitId: string) => boolean
): boolean {
  const unit = army.units.find(item => item.id === placementId);
  if (!unit || !unitId) return false;
  if (unit.unitId === unitId) return true;
  if (canReplace && !canReplace(unit, unitId)) return false;
  unit.unitId = unitId;
  unit.spellIds = [];
  return true;
}

export function moveArmyUnit(
  army: ArmyRecord,
  placementId: string,
  x: number,
  y: number,
  canMove?: (moves: readonly ArmyPlacementMove[]) => boolean
): boolean {
  const unit = army.units.find(item => item.id === placementId);
  if (!unit) return false;
  const occupant = army.units.find(item => item.id !== unit.id && item.x === x && item.y === y);
  const moves: ArmyPlacementMove[] = [{ placement: unit, x, y }];
  if (occupant) moves.push({ placement: occupant, x: unit.x, y: unit.y });
  if (canMove && !canMove(moves)) return false;
  for (const move of moves) {
    move.placement.x = move.x;
    move.placement.y = move.y;
  }
  return true;
}

export function addArmyUnitSpell(army: ArmyRecord, placementId: string, spellId: string, validSpellIds: readonly string[]): boolean {
  const unit = army.units.find(item => item.id === placementId);
  if (!unit || !spellId || !validSpellIds.includes(spellId)) return false;
  unit.spellIds ??= [];
  if (unit.spellIds.includes(spellId)) return false;
  unit.spellIds.push(spellId);
  return true;
}

export function removeArmyUnitSpell(army: ArmyRecord, placementId: string, index: number): boolean {
  const unit = army.units.find(item => item.id === placementId);
  if (!unit?.spellIds || !Number.isInteger(index) || index < 0 || index >= unit.spellIds.length) return false;
  unit.spellIds.splice(index, 1);
  return true;
}
