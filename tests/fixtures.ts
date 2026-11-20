import { DEFAULT_QUEST, emptyQuestExtension, type ArmyCatalog, type ArmyRecord, type CampaignRecord, type DialogueRecord, type QuestRecord, type UnitRoster, type Workspace } from "../src/model";
import { createCampaignFloor } from "../src/campaign-domain";

export const catalog: ArmyCatalog = {
  schemaVersion: 1,
  gridSizes: [{ minFloor: 1, width: 3, height: 3 }, { minFloor: 5, width: 5, height: 5 }],
  units: [{ id: "Cats/Fighter/1", name: "Fighter", factionId: "Cats", faction: "Cats", levels: [
    { id: "Cats/Fighter/1", name: "Fighter", level: 1, description: "A sturdy test fighter.", tier: 1, previewImage: "./avatars/Cats-Fighter-1.png", footprint: { width: 1, height: 1 }, stats: { maxHealth: 100, maxMana: 20, manaRegen: 1, attackDamage: 10, attackSpeed: 1, attackRange: 1, minAttackRange: 0, critChance: 0.05, spellPower: 2, armorResist: 3, magicResist: 4, movementSpeed: 2 } },
    { id: "Cats/Fighter/2", name: "Fighter", level: 2, description: "A stronger test fighter.", tier: 1, previewImage: "./avatars/Cats-Fighter-2.png", footprint: { width: 1, height: 1 }, stats: { maxHealth: 150, maxMana: 25, manaRegen: 2, attackDamage: 15, attackSpeed: 1.2, attackRange: 1, minAttackRange: 0, critChance: 0.1, spellPower: 3, armorResist: 5, magicResist: 6, movementSpeed: 2.5 } }
  ] }],
  buildings: [{ id: "Cats/Barricade/1", name: "Barricade", factionId: "Cats", faction: "Cats", levels: [
    { id: "Cats/Barricade/1", name: "Barricade", level: 1, description: "A broad defensive structure.", tier: 2, footprint: { width: 2, height: 1 }, stats: { maxHealth: 250, maxMana: 0, manaRegen: 0, attackDamage: 0, attackSpeed: 0, attackRange: 0, minAttackRange: 0, critChance: 0, spellPower: 0, armorResist: 20, magicResist: 10, movementSpeed: 0 } }
  ] }], factions: [{ id: "Cats", name: "Cats" }],
  spells: [{ id: "fireball", name: "Fireball", description: "Deals fire damage to nearby enemies.", tier: 1, manaCost: 5, coinCost: 2, cooldown: 3, maxTargets: 4 }, { id: "shield", name: "Shield", description: "Protects an ally." }],
  blessings: [
    { id: "blessing", name: "Blessing", description: "Boosts armor for the battle.", level: 1 },
    { id: "picked-column", name: "Lane Guardian", description: "A lane effect.", level: 1, family: "cell", mechanics: { rule: "PickedColumn", persistentId: "lane-root", rootPersistentId: "lane-root", cellCount: 1, effect: { description: "Attack Speed +10%." }, baneRule: "None" } },
    { id: "random-cells", name: "Lucky Fields", description: "Two selected cells and one bane.", family: "cell", mechanics: { rule: "RandomCells", persistentId: "random-root", rootPersistentId: "random-root", cellCount: 2, effect: { description: "Attack +10%." }, baneRule: "RandomCells", baneCellCount: 1, baneEffect: { description: "Armor -5." } } },
    { id: "grid-column", name: "Extra Column", description: "Adds one column.", family: "grid", mechanics: { effect: "AddColumn" } }
  ],
  curses: [{ id: "cell-curse", name: "Cracked Front", description: "A front curse.", level: 1, family: "cell", isCurse: true,
    mechanics: { rule: "BackRow", persistentId: "cracked-root", rootPersistentId: "cracked-root", effect: { description: "Attack Speed +20%." }, baneRule: "FrontRow", baneEffect: { description: "Armor -15." } } }]
};

export function armyFixture(): ArmyRecord {
  return { key: "army-key", id: "test-army", idAuto: false, name: "Test Army", previewFloor: 1,
    units: [{ id: "placement-1", unitId: "Cats/Fighter/1", x: 0, y: 0, spellIds: [] }], spellIds: [], blessingIds: [] };
}

export function dialogueFixture(): DialogueRecord {
  return { key: "dialogue-key", sequenceIdAuto: false, sequence: {
    schemaVersion: 1, sequenceId: "test-dialogue", startNodeId: "opening", pauseMode: "pause", defaultCharactersPerSecond: 30,
    nodes: [{ id: "opening", headline: "Elder", textSpeed: "default", speakers: [], segments: [{ speakerIds: [], text: "Welcome." }], actions: [] }]
  } };
}

export function questFixture(): QuestRecord {
  const extension = emptyQuestExtension();
  extension.battleTargets = [{ id: "battle-1", label: "Battle 1", nodeKind: "Battle", floorOffset: 0, armyId: "" }];
  return { key: "quest-key", idAuto: false, definition: { ...DEFAULT_QUEST, id: "test-quest", title: "Test Quest" }, extension };
}

export function campaignFixture(): CampaignRecord {
  return {
    key: "campaign-key", id: "test-campaign", idAuto: false, name: "Test Campaign", description: "", designMode: "custom", questIds: [],
    events: [],
    floors: [createCampaignFloor(1, "authored", prefix => prefix + "-id")],
    settings: { startingLives: 3, startingSardines: 10, startingNodeCount: 12, playerFactionId: "", battleShopEnabled: true,
      shopPoolKinds: ["Unit", "Blessing", "Research", "SpellUnlock"],
      questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false }
  };
}

export function workspaceFixture(): Workspace {
  return { schemaVersion: 1, dialogues: [dialogueFixture()], quests: [questFixture()], armies: [armyFixture()], campaigns: [campaignFixture()],
    selectedType: "army", selectedKey: "army-key", activeNodeId: null };
}

export const rosterFixture: UnitRoster = { schemaVersion: 1, rosterVersion: "test", source: "test", units: [] };
