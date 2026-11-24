import type {
  ArmyCatalog,
  ArmyRecord,
  MissionRecord,
  MissionFloor,
  MissionShopOfferKind,
  DialogueRecord,
  QuestRecord,
  Workspace
} from "./model";
import { armyFootprintsOverlap, armyGridSize, canPlaceArmyLevel, resolveArmyLevel } from "./army-catalog";
import { findAction, isKnownTrigger } from "../content/registries";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  target?: string;
}

const ALLOWED_OBJECTIVES = ["Escort", "Fetch", "Battle", "ClearFloor", "Timer", "KillCount"];
const ALLOWED_SOURCES = ["QuestGiver", "Letter", "Item"];
const ALLOWED_REWARDS = ["Sardines", "ExtraLife", "Blessing"];
const MISSION_SHOP_KINDS: MissionShopOfferKind[] = ["Unit", "Blessing", "Research", "SpellUnlock"];

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateDialogue(record: DialogueRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sequence = record.sequence;
  const nodes = sequence.nodes ?? [];
  const nodeIds = nodes.map(node => node.id);
  const nodeMap = new Map(nodes.map(node => [node.id, node]));

  if (!nonEmpty(sequence.sequenceId)) issues.push({ level: "error", message: "Dialogue ID is required." });
  else if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(sequence.sequenceId))
    issues.push({ level: "error", message: 'Dialogue ID "' + sequence.sequenceId + '" may only use lowercase letters, numbers, -, _ and .' });
  if (nodes.length === 0) issues.push({ level: "error", message: "Add at least one dialogue node." });
  if (!uniqueValues(nodeIds)) issues.push({ level: "error", message: "Node IDs must be unique within a dialogue." });
  if (!nodeMap.has(sequence.startNodeId)) {
    issues.push({ level: "error", message: "The start node must point to an existing node." });
  }
  if (!(sequence.defaultCharactersPerSecond >= 1)) {
    issues.push({ level: "error", message: "Text speed must be at least 1 character per second." });
  }

  for (const node of nodes) {
    if (!nonEmpty(node.id)) issues.push({ level: "error", message: "Every node needs an ID.", target: node.id });
    if (node.speakers.length > 2) {
      issues.push({ level: "error", message: "A dialogue node can use at most two avatar slots.", target: node.id });
    }
    const sides = node.speakers.map(speaker => speaker.side.toLowerCase());
    if (!uniqueValues(sides)) {
      issues.push({ level: "error", message: "Use each avatar side only once in a node.", target: node.id });
    }
    const speakerIds = node.speakers.map(speaker => speaker.id);
    if (!uniqueValues(speakerIds)) {
      issues.push({ level: "error", message: "Speaker IDs must be unique within a node.", target: node.id });
    }
    if (node.segments.length === 0) {
      issues.push({ level: "warning", message: "This node has no dialogue text.", target: node.id });
    }
    for (const segment of node.segments) {
      for (const speakerId of segment.speakerIds) {
        if (!speakerIds.includes(speakerId)) {
          issues.push({ level: "error", message: "A text segment refers to a speaker that is not in this node.", target: node.id });
        }
      }
    }
    for (const action of node.actions) {
      if (action.targetNodeId && !nodeMap.has(action.targetNodeId)) {
        issues.push({ level: "error", message: "A dialogue choice points to a missing node.", target: node.id });
      }
      if (action.decision && (!nonEmpty(action.decision.id) || !nonEmpty(action.decision.outcomeId))) {
        issues.push({ level: "error", message: "A saved decision needs both a decision ID and an outcome ID.", target: node.id });
      }
    }
  }

  // Linear sequences are a supported runtime shape: the player synthesizes a
  // Continue action and advances to the next node, so no branch warning here.
  return issues;
}

export function validateQuest(
  record: QuestRecord,
  workspace: Workspace,
  catalog: ArmyCatalog
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const quest = record.definition;

  if (!nonEmpty(quest.id)) issues.push({ level: "error", message: "Quest ID is required." });
  if (!nonEmpty(quest.title)) issues.push({ level: "error", message: "Quest title is required." });
  if (!ALLOWED_SOURCES.includes(quest.sourceKind)) {
    issues.push({ level: "error", message: "Choose a supported quest source." });
  }
  if (!ALLOWED_OBJECTIVES.includes(quest.objectiveKind)) {
    issues.push({ level: "error", message: "Choose a supported objective type." });
  }
  if (!ALLOWED_REWARDS.includes(quest.rewardKind)) {
    issues.push({ level: "error", message: "Choose a supported reward type." });
  }
  if (!(quest.firstFloor >= 1)) issues.push({ level: "error", message: "First available floor must be 1 or higher." });
  if (!(quest.repeatEveryFloors >= 1)) issues.push({ level: "error", message: "Repeat interval must be 1 or higher." });
  if (!(quest.rewardAmount >= 0)) issues.push({ level: "error", message: "Reward amount cannot be negative." });
  if (quest.sourceSlot !== -1 && quest.sourceSlot !== 0 && quest.sourceSlot !== 1) {
    issues.push({ level: "error", message: "Source slot must be either Any, 0, or 1." });
  }
  if (quest.objectiveKind === "Escort" && !nonEmpty(quest.escortUnitId)) {
    issues.push({ level: "error", message: "Choose the unit that needs escorting." });
  }
  if (quest.objectiveKind === "Fetch") {
    const fetchItems = record.extension.fetchItems ?? [];
    if (fetchItems.length === 0 && !nonEmpty(quest.itemId)) {
      issues.push({ level: "error", message: "Add at least one item to collect." });
    }
    const fetchIds = fetchItems.map(item => item.id);
    if (!uniqueValues(fetchIds)) issues.push({ level: "error", message: "Fetched item IDs must be unique." });
    for (const item of fetchItems) {
      if (!nonEmpty(item.displayName) || !nonEmpty(item.id)) issues.push({ level: "error", message: "Each fetched item needs a name and generated ID." });
      if (!(item.count >= 1)) issues.push({ level: "error", message: "Fetched item quantities must be at least 1." });
    }
  }
  if (quest.objectiveKind !== "Timer" && !nonEmpty(quest.targetNodeKind)) {
    issues.push({ level: "error", message: "Choose the target node type." });
  }
  if (quest.objectiveKind === "Battle") {
    const targets = record.extension.battleTargets ?? [];
    if (targets.length === 0) issues.push({ level: "error", message: "Add at least one battle target." });
    const targetIds = targets.map(target => target.id);
    if (!uniqueValues(targetIds)) issues.push({ level: "error", message: "Battle target IDs must be unique within a quest." });
    for (const target of targets) {
      if (!nonEmpty(target.label) || !nonEmpty(target.nodeKind)) issues.push({ level: "error", message: "Each battle target needs a label and node type." });
      if (!(target.floorOffset >= 0)) issues.push({ level: "error", message: "Battle floor offsets cannot be negative." });
      if (target.armyId && !workspace.armies.some(army => army.id === target.armyId)) {
        issues.push({ level: "error", message: "Battle “" + target.label + "” refers to a missing army configuration." });
      }
    }
  }
  if (quest.objectiveKind === "KillCount") {
    const objective = record.extension.killCount;
    if (!objective) issues.push({ level: "error", message: "Configure what the player must defeat." });
    else {
      if (!(objective.count >= 1)) issues.push({ level: "error", message: "Kill count must be at least 1." });
      const allowedIds = objective.targetKind === "unit"
        ? catalog.units.map(unit => unit.id)
        : catalog.factions.map(faction => faction.id);
      if (!allowedIds.includes(objective.targetId)) issues.push({ level: "error", message: "Choose a target from the game unit catalog." });
    }
  }
  for (const rule of record.extension.minimumNodeDistances ?? []) {
    if (!(rule.minimumHops >= 1)) issues.push({ level: "error", message: "Minimum node distance must be at least 1 hop." });
  }

  const dialogueIds = new Set(workspace.dialogues.map(item => item.sequence.sequenceId));
  const links = record.extension.dialogueLinks;
  for (const [event, dialogueId] of Object.entries(links)) {
    if (dialogueId && !dialogueIds.has(dialogueId)) {
      issues.push({ level: "error", message: "The " + event + " dialogue reference is missing." });
    }
  }

  if (record.extension.logicKind === "timer-project") {
    const logic = record.extension.timer;
    if (!nonEmpty(logic.decisionId)) issues.push({ level: "error", message: "Choose a decision ID for the project choices." });
    if (!(logic.counterTarget >= 1)) issues.push({ level: "error", message: "The battle counter target must be 1 or higher." });
    if (!(logic.paymentAmount >= 0)) issues.push({ level: "error", message: "Payment amount cannot be negative." });
    if (!nonEmpty(links.offer)) issues.push({ level: "warning", message: "Link an offer dialogue so players can choose how the project starts." });
    if (logic.completionEffects.length === 0) {
      issues.push({ level: "warning", message: "Add a completion effect such as a world event or path unlock." });
    }
    for (const effect of logic.completionEffects) {
      if (!nonEmpty(effect.targetId)) {
        issues.push({ level: "error", message: "Every completion effect needs a target ID." });
      }
    }
    const linkedDialogue = workspace.dialogues.find(item => item.sequence.sequenceId === links.offer);
    if (linkedDialogue) {
      const outcomes = linkedDialogue.sequence.nodes.flatMap(node => node.actions.map(action => action.decision))
        .filter(decision => decision?.id === logic.decisionId)
        .map(decision => decision?.outcomeId);
      if (!outcomes.includes(logic.payOutcomeId)) {
        issues.push({ level: "warning", message: "The linked dialogue has no matching pay-now decision outcome." });
      }
      if (!outcomes.includes(logic.waitOutcomeId)) {
        issues.push({ level: "warning", message: "The linked dialogue has no matching wait decision outcome." });
      }
    }
  }

  return issues;
}

export function validateWorkspace(workspace: Workspace, catalog: ArmyCatalog = { schemaVersion: 1, gridSizes: [], units: [], buildings: [], factions: [], spells: [], blessings: [] }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dialogueIds = workspace.dialogues.map(item => item.sequence.sequenceId);
  const questIds = workspace.quests.map(item => item.definition.id);
  const armyIds = workspace.armies.map(item => item.id);

  if (!uniqueValues(dialogueIds)) issues.push({ level: "error", message: "Dialogue IDs must be unique across this workspace." });
  if (!uniqueValues(questIds)) issues.push({ level: "error", message: "Quest IDs must be unique across this workspace." });
  if (!uniqueValues(armyIds)) issues.push({ level: "error", message: "Army IDs must be unique across this workspace." });
  for (const dialogue of workspace.dialogues) {
    for (const issue of validateDialogue(dialogue)) {
      issues.push({ ...issue, message: "Dialogue “" + dialogue.sequence.sequenceId + "”: " + issue.message });
    }
  }
  for (const quest of workspace.quests) {
    for (const issue of validateQuest(quest, workspace, catalog)) {
      issues.push({ ...issue, message: "Quest “" + quest.definition.id + "”: " + issue.message });
    }
  }
  for (const army of workspace.armies) {
    for (const issue of validateArmy(army, catalog)) {
      issues.push({ ...issue, message: "Army “" + army.id + "”: " + issue.message });
    }
  }
  const missionIds = workspace.missions.map(item => item.id);
  if (!uniqueValues(missionIds)) issues.push({ level: "error", message: "Mission IDs must be unique across this workspace." });
  for (const mission of workspace.missions) {
    for (const issue of validateMission(mission, workspace, catalog)) {
      issues.push({ ...issue, message: "Mission “" + (mission.name || mission.id) + "”: " + issue.message });
    }
  }
  return issues;
}

const MISSION_NODE_KINDS = new Set(["Start", "Battle", "Reward", "Boss", "Quest", "Shop"]);
const MISSION_REWARD_KINDS = new Set(["Sardines", "ExtraLife", "Blessing", "UnitUnlock", "ShopLevelUnlock", "SpellUnlock"]);
// Use the canonical registry vocabulary instead of a stale local whitelist; the
// runtime and publisher accept every trigger listed there (for example battle-won).

export function validateMission(
  mission: MissionRecord,
  workspace: Workspace,
  catalog: ArmyCatalog
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!nonEmpty(mission.id)) issues.push({ level: "error", message: "Mission ID is required." });
  if (!nonEmpty(mission.name)) issues.push({ level: "error", message: "Mission name is required." });
  if (mission.floors.length === 0) issues.push({ level: "error", message: "Add at least one floor board." });
  if (!Number.isInteger(mission.settings.startingLives) || mission.settings.startingLives < 1) issues.push({ level: "error", message: "Starting lives must be a whole number of at least one." });
  if (!mission.settings.factionSelectionEnabled && !mission.settings.playerFactionId) {
    issues.push({ level: "error", message: "Choose a player faction when faction selection is disabled." });
  }
  // 0 is a legitimate "start broke" value at runtime (AdventureRunFactory clamps at 0).
  if (!Number.isInteger(mission.settings.startingSardines) || mission.settings.startingSardines < 0 || mission.settings.startingSardines > 50) issues.push({ level: "error", message: "Starting Sardines must be a whole number between 0 and 50, matching Adventure settings." });
  if (!Number.isInteger(mission.settings.startingNodeCount) || mission.settings.startingNodeCount < 12 || mission.settings.startingNodeCount > 30 || mission.settings.startingNodeCount % 2 !== 0) issues.push({ level: "error", message: "Starting random floor node count must be an even number between 12 and 30." });
  if (!Number.isInteger(mission.settings.questNodeCountPerRandomFloor) || mission.settings.questNodeCountPerRandomFloor < 0 || mission.settings.questNodeCountPerRandomFloor > 4) issues.push({ level: "error", message: "Generated Quest nodes per floor must be a whole number between 0 and 4." });
  if (!Number.isInteger(mission.settings.shopNodeCountPerRandomFloor) || mission.settings.shopNodeCountPerRandomFloor < 0 || mission.settings.shopNodeCountPerRandomFloor > 7) issues.push({ level: "error", message: "Generated Shop nodes per floor must be a whole number between 0 and 7." });
  if (!Number.isInteger(mission.settings.nodeGrowthPerFloor) || mission.settings.nodeGrowthPerFloor < 1 || mission.settings.nodeGrowthPerFloor > 10) issues.push({ level: "error", message: "Generated floor node growth must be a whole number between 1 and 10." });
  if (mission.settings.startingNodeCount - mission.settings.questNodeCountPerRandomFloor - mission.settings.shopNodeCountPerRandomFloor < 4) {
    issues.push({ level: "error", message: "Random floor settings must leave room for Start, Boss, and at least two Battles." });
  }
  if (mission.settings.playerFactionId && !catalog.factions.some(item => item.id === mission.settings.playerFactionId)) {
    issues.push({ level: "error", message: "Choose a player faction from the game catalog." });
  }
  if (mission.boardPreviewUnitId && !catalog.units.some(unit =>
    unit.levels.some(level => level.id === mission.boardPreviewUnitId))) {
    issues.push({ level: "error", message: "Choose a board preview unit from the game catalog, or use the selected faction hero." });
  }
  if (!uniqueValues(mission.settings.shopPoolKinds) || mission.settings.shopPoolKinds.some(kind => !MISSION_SHOP_KINDS.includes(kind))) {
    issues.push({ level: "error", message: "Mission shop pools must use unique, supported offer categories." });
  }

  const events = mission.events ?? [];
  if (!uniqueValues(events.map(event => event.id))) issues.push({ level: "error", message: "Mission event IDs must be present and unique." });
  for (const event of events) {
    const label = "Mission event “" + (event.id || "(missing ID)") + "”: ";
    if (!nonEmpty(event.id)) issues.push({ level: "error", message: label + "ID is required." });
    if (!isKnownTrigger(event.trigger)) {
      issues.push({ level: "error", message: label + "choose a supported trigger." });
      continue;
    }
    // floorNumber 0 plus a blank nodeId is the runtime sentinel for "no floor"
    // on mission-start events (AdventureContentPackageCatalog).
    const floorNumber = event.floorNumber ?? 0;
    if (event.trigger === "mission-start" && (floorNumber !== 0 || event.nodeId)) {
      issues.push({ level: "error", message: label + "Mission start events cannot target a floor or node." });
    }
    if (floorNumber !== 0 && (!Number.isInteger(floorNumber) || !mission.floors.some(floor => floor.number === floorNumber))) {
      issues.push({ level: "error", message: label + "choose a floor that exists in this mission." });
    }
    if (event.nodeId) {
      if (event.floorNumber === undefined || !Number.isInteger(event.floorNumber)) {
        issues.push({ level: "error", message: label + "choose a floor before targeting a specific node." });
      } else {
        const floor = mission.floors.find(item => item.number === event.floorNumber);
        const node = floor?.nodes.find(item => item.id === event.nodeId);
        if (!node) {
          issues.push({ level: "error", message: label + "target node “" + event.nodeId + "” does not exist on Floor " + event.floorNumber + "." });
        } else if ((event.trigger === "before-battle" || event.trigger === "after-battle") && node.kind !== "Battle" && node.kind !== "Boss") {
          issues.push({ level: "error", message: label + "battle triggers must target a Battle or Boss node." });
        } else if (event.trigger === "node-cleared" && node.kind === "Start") {
          issues.push({ level: "error", message: label + "node-cleared triggers cannot target a Start node." });
        }
      }
    }
    if (event.actions.length === 0) issues.push({ level: "error", message: label + "add at least one action." });
    for (const action of event.actions) {
      if (action.kind === "replace-player-army") {
        const armyId = action.armyId;
        if (typeof armyId !== "string" || !workspace.armies.some(army => army.id === armyId)) {
          issues.push({ level: "error", message: label + "replace-player-army must reference an Army Editor army." });
        }
      } else if (!findAction(action.kind)) {
        // Registered actions round-trip through parameters unchanged; only warn
        // about genuinely unknown kinds that the runtime would not understand.
        issues.push({ level: "warning", message: label + "action “" + (action.kind || "(missing kind)") + "” is not currently editable; it will be preserved in export." });
      }
    }
  }

  const questIds = mission.questIds ?? [];
  if (!uniqueValues(questIds)) issues.push({ level: "error", message: "Mission quest IDs must be unique." });
  for (const questId of questIds) {
    if (!workspace.quests.some(item => item.definition.id === questId)) {
      issues.push({ level: "error", message: "Mission quest pool refers to missing quest “" + questId + "”." });
    }
  }

  const floorNumbers = mission.floors.map(floor => floor.number);
  if (new Set(floorNumbers).size !== floorNumbers.length) issues.push({ level: "error", message: "Floor numbers must be unique within a mission." });
  for (const floor of mission.floors) {
    issues.push(...validateMissionFloor(floor, mission, workspace, catalog));
  }
  return issues;
}

function validateMissionFloor(
  floor: MissionFloor,
  mission: MissionRecord,
  workspace: Workspace,
  catalog: ArmyCatalog
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = "Floor " + floor.number + ": ";
  if (!Number.isInteger(floor.number) || floor.number < 1) issues.push({ level: "error", message: prefix + "floor number must be a whole number of at least one." });
  if (!Number.isInteger(floor.shopLevel) || floor.shopLevel < 1 || floor.shopLevel > 4) issues.push({ level: "error", message: prefix + "shop tier must be a whole number from 1 to 4." });
  if (floor.shopPoolMode !== "mission" && floor.shopPoolMode !== "custom") issues.push({ level: "error", message: prefix + "choose the mission shop pools or a custom floor pool." });
  if (!uniqueValues(floor.shopPoolKinds) || floor.shopPoolKinds.some(kind => !MISSION_SHOP_KINDS.includes(kind))) {
    issues.push({ level: "error", message: prefix + "floor shop pools must use unique, supported offer categories." });
  }
  const activeShopKinds = floor.shopPoolMode === "custom" ? floor.shopPoolKinds : mission.settings.shopPoolKinds;
  const hasShopNodes = floor.nodes.some(node => node.kind === "Shop") || (floor.mode !== "authored" && floor.randomSettings.shopNodeCount > 0);
  if (hasShopNodes && activeShopKinds.length === 0) issues.push({ level: "error", message: prefix + "generated shops need at least one enabled offer pool." });
  if (!["authored", "random", "mixed"].includes(floor.mode)) {
    issues.push({ level: "error", message: prefix + "choose an authored, random, or mixed board." });
    return issues;
  }

  const random = floor.randomSettings;
  if (floor.questPoolMode !== "mission" && floor.questPoolMode !== "custom") issues.push({ level: "error", message: prefix + "choose a mission or custom quest pool." });
  const randomQuestPool = floor.questPoolMode === "custom" ? floor.questPoolIds : mission.questIds;
  if (floor.mode !== "authored" && randomQuestPool.some(questId => {
    const quest = workspace.quests.find(item => item.definition.id === questId);
    return (quest?.extension.minimumNodeDistances?.length ?? 0) > 0;
  })) {
    issues.push({ level: "error", message: prefix + "minimum node-distance quest rules require a fully authored floor so the game can guarantee them." });
  }
  if (!uniqueValues(floor.questPoolIds)) issues.push({ level: "error", message: prefix + "floor Quest pool IDs must be unique." });
  for (const questId of floor.questPoolIds) {
    if (!mission.questIds.includes(questId)) issues.push({ level: "error", message: prefix + "floor Quest pool contains “" + questId + "” outside the mission Quest pool." });
  }
  if (floor.mode === "random" || floor.mode === "mixed") {
    if (!Number.isInteger(random.nodeCount) || !(random.nodeCount >= (floor.mode === "random" ? 12 : 0))) {
      issues.push({ level: "error", message: prefix + (floor.mode === "random"
        ? "a random board needs at least twelve total nodes, matching Adventure generation."
        : "generated node count cannot be negative.") });
    }
    if (random.nodeCount > 30) issues.push({ level: "error", message: prefix + "generated nodes exceed the 30-node floor limit." });
    if (floor.mode === "random" && random.nodeCount % 2 !== 0) issues.push({ level: "error", message: prefix + "random floor node count must be even, matching Adventure setup." });
    if (!Number.isInteger(random.questNodeCount) || !Number.isInteger(random.shopNodeCount) || random.questNodeCount < 0 || random.questNodeCount > 4 || random.shopNodeCount < 0 || random.shopNodeCount > 7) {
      issues.push({ level: "error", message: prefix + "generated Quest nodes are limited to 0–4 and Shop nodes to 0–7." });
    }
    if (random.questNodeCount > 0 && randomQuestPool.length === 0) {
      issues.push({ level: "error", message: prefix + "generated Quest nodes need at least one quest in the selected floor pool." });
    }
    const generatedBattles = random.nodeCount
      - (floor.mode === "random" ? 2 : 0)
      - random.questNodeCount
      - random.shopNodeCount;
    if (generatedBattles < (floor.mode === "random" ? 2 : 0)) {
      issues.push({ level: "error", message: prefix + "random settings must leave room for at least two Battle nodes." });
    }
  }

  if (floor.mode === "random") {
    if (floor.nodes.length > 0) issues.push({ level: "warning", message: prefix + "authored node placements are saved but ignored while this board is random." });
    return issues;
  }

  if (floor.nodes.length > 30) issues.push({ level: "error", message: prefix + "authored nodes exceed the 30-node floor limit." });
  if (floor.mode === "mixed" && floor.nodes.length + random.nodeCount > 30) {
    issues.push({ level: "error", message: prefix + "authored plus generated nodes exceed the 30-node floor limit." });
  }
  const nodeIds = floor.nodes.map(node => node.id);
  if (!uniqueValues(nodeIds)) issues.push({ level: "error", message: prefix + "node IDs must be unique." });
  const starts = floor.nodes.filter(node => node.kind === "Start");
  const bosses = floor.nodes.filter(node => node.kind === "Boss");
  if (starts.length !== 1) issues.push({ level: "error", message: prefix + "an authored board needs exactly one Start node." });
  if (bosses.length !== 1) issues.push({ level: "error", message: prefix + "an authored board needs exactly one Boss node." });
  if (floor.nodes.filter(node => node.kind === "Battle").length < 2) {
    issues.push({ level: "error", message: prefix + "an authored board needs at least two Battle nodes." });
  }

  const occupiedPositions = floor.nodes.map(node => node.x + ":" + node.y);
  if (!uniqueValues(occupiedPositions)) issues.push({ level: "error", message: prefix + "only one node can occupy a board cell." });
  const nodeMap = new Map(floor.nodes.map(node => [node.id, node]));
  for (const node of floor.nodes) {
    if (!MISSION_NODE_KINDS.has(node.kind)) issues.push({ level: "error", message: prefix + "node “" + node.label + "” has an unsupported type." });
    if (!nonEmpty(node.id) || !nonEmpty(node.label)) issues.push({ level: "error", message: prefix + "every node needs a stable ID and label." });
    if (!Number.isInteger(node.x) || Math.abs(node.x) > 30 || !Number.isInteger(node.y) || Math.abs(node.y) > 30) {
      issues.push({ level: "error", message: prefix + "nodes use integer Adventure-map grid coordinates within 30 steps of the origin." });
    }
    // "none" is the runtime sentinel for no army/faction on non-battle nodes.
    if (node.armyId && node.armyId !== "none" && !workspace.armies.some(army => army.id === node.armyId)) {
      issues.push({ level: "error", message: prefix + "node “" + node.label + "” refers to a missing Army configuration." });
    }
    if (node.enemyFactionId && node.enemyFactionId !== "none" && !catalog.factions.some(faction => faction.id === node.enemyFactionId)) {
      issues.push({ level: "error", message: prefix + "node “" + node.label + "” refers to a missing faction." });
    }
    if (node.kind === "Quest" && node.questId) {
      if (!mission.questIds.includes(node.questId)) issues.push({ level: "error", message: prefix + "Quest node “" + node.label + "” uses a quest outside the mission quest pool." });
      if (!workspace.quests.some(quest => quest.definition.id === node.questId)) issues.push({ level: "error", message: prefix + "Quest node “" + node.label + "” refers to a missing quest." });
    }
    if (node.kind === "Reward") {
      if (!MISSION_REWARD_KINDS.has(node.rewardKind)) issues.push({ level: "error", message: prefix + "choose a supported reward for “" + node.label + "”." });
      if (node.rewardAmount < 0) issues.push({ level: "error", message: prefix + "reward amounts cannot be negative." });
      if (["Blessing", "UnitUnlock", "SpellUnlock"].includes(node.rewardKind) && !nonEmpty(node.rewardContentId)) {
        issues.push({ level: "error", message: prefix + "node “" + node.label + "” needs a reward content ID." });
      }
    }
    if (node.kind === "Shop") {
      if (node.shopOfferMode !== "generated" && node.shopOfferMode !== "exact") {
        issues.push({ level: "error", message: prefix + "choose generated stock or exact offers for shop “" + node.label + "”." });
      }
      if (node.shopOfferMode === "exact") {
        if (node.shopOffers.length !== 3) issues.push({ level: "error", message: prefix + "exact shop “" + node.label + "” needs exactly three offers, matching the Adventure map shop." });
        const offerKeys = node.shopOffers.map(offer => offer.kind + ":" + offer.contentId);
        if (!uniqueValues(offerKeys)) issues.push({ level: "error", message: prefix + "exact shop offers must be unique." });
        for (const offer of node.shopOffers) {
          if (!MISSION_SHOP_KINDS.includes(offer.kind)) {
            issues.push({ level: "error", message: prefix + "shop “" + node.label + "” has an unsupported offer category." });
            continue;
          }
          const validId = offer.kind === "Blessing"
            ? catalog.blessings.some(item => item.id === offer.contentId)
            : offer.kind === "SpellUnlock"
              ? catalog.spells.some(item => item.id === offer.contentId)
              : catalog.units.some(unit => unit.id === offer.contentId || unit.levels.some(level => level.id === offer.contentId));
          if (!validId) issues.push({ level: "error", message: prefix + "shop “" + node.label + "” has a missing or unknown " + offer.kind + " item." });
          if (!Number.isInteger(offer.price) || offer.price < 0) issues.push({ level: "error", message: prefix + "shop prices must be whole numbers of zero or more." });
        }
      }
    }
  }

  const seenRoutes = new Set<string>();
  for (const route of floor.routes) {
    if (route.fromNodeId === route.toNodeId) {
      issues.push({ level: "error", message: prefix + "a route cannot loop back to the same node." });
      continue;
    }
    if (!nodeMap.has(route.fromNodeId) || !nodeMap.has(route.toNodeId)) {
      issues.push({ level: "error", message: prefix + "a route refers to a node that no longer exists." });
      continue;
    }
    const from = nodeMap.get(route.fromNodeId)!;
    const to = nodeMap.get(route.toNodeId)!;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (Math.max(dx, dy) !== 1) {
      issues.push({ level: "error", message: prefix + "routes must connect adjacent Adventure grid positions, including diagonal neighbours." });
    }
    const routeKey = route.oneWay
      ? route.fromNodeId + ">" + route.toNodeId
      : [route.fromNodeId, route.toNodeId].sort().join("<>");
    if (seenRoutes.has(routeKey)) issues.push({ level: "error", message: prefix + "duplicate routes are not allowed." });
    seenRoutes.add(routeKey);
  }
  if (starts.length === 1) {
    if (starts[0].x !== 0 || starts[0].y !== 0) {
      issues.push({ level: "error", message: prefix + "Start must be at Adventure grid position (0, 0)." });
    }
    const reachable = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    const distances = new Map<string, number>([[starts[0].id, 0]]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const route of floor.routes) {
        if (route.fromNodeId === current && !reachable.has(route.toNodeId)) {
          reachable.add(route.toNodeId);
          distances.set(route.toNodeId, (distances.get(current) ?? 0) + 1);
          queue.push(route.toNodeId);
        }
        if (!route.oneWay && route.toNodeId === current && !reachable.has(route.fromNodeId)) {
          reachable.add(route.fromNodeId);
          distances.set(route.fromNodeId, (distances.get(current) ?? 0) + 1);
          queue.push(route.fromNodeId);
        }
      }
    }
    for (const node of floor.nodes) {
      if (!reachable.has(node.id)) issues.push({ level: "error", message: prefix + "node “" + node.label + "” is unreachable from Start." });
    }
    if (bosses.length === 1 && !reachable.has(bosses[0].id)) {
      issues.push({ level: "error", message: prefix + "Boss must be reachable from Start." });
    }
  }
  return issues;
}

export function validateArmy(record: ArmyRecord, catalog: ArmyCatalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!nonEmpty(record.name)) issues.push({ level: "error", message: "Army name is required." });
  if (!nonEmpty(record.id)) issues.push({ level: "error", message: "Army ID is required." });
  const floor = Math.max(1, Number(record.previewFloor) || 1);
  const size = armyGridSize(catalog, floor, record.blessingIds);
  const placementIds = record.units.map(unit => unit.id);
  if (!uniqueValues(placementIds)) issues.push({ level: "error", message: "Army unit placement IDs must be unique." });
  for (const [index, unit] of record.units.entries()) {
    if (!resolveArmyLevel(catalog, unit.unitId)) {
      issues.push({ level: "error", message: "Army unit or building “" + unit.unitId + "” is not in the current game catalog." });
    }
    if (!canPlaceArmyLevel([], catalog, unit.unitId, unit.x, unit.y, size)) {
      issues.push({ level: "error", message: "Army unit placements must fit within the " + size.width + " × " + size.height + " grid for floor " + floor + "." });
    }
    if (record.units.slice(0, index).some(previous => armyFootprintsOverlap(catalog, unit, previous))) {
      issues.push({ level: "error", message: "Army unit and building footprints must not overlap." });
    }
    const unitSpellIds = unit.spellIds ?? [];
    if (!uniqueValues(unitSpellIds)) issues.push({ level: "error", message: "Spells assigned to each unit must not be duplicated." });
    if (unitSpellIds.some(id => !catalog.spells.some(spell => spell.id === id))) issues.push({ level: "error", message: "Choose unit spells from the current game catalog." });
  }
  if (!uniqueValues(record.spellIds)) issues.push({ level: "error", message: "Army spells must not be duplicated." });
  if (record.spellIds.some(id => !catalog.spells.some(spell => spell.id === id))) issues.push({ level: "error", message: "Choose spells from the current game catalog." });
  if (!uniqueValues(record.blessingIds)) issues.push({ level: "error", message: "Army blessings must not be duplicated." });
  const selectableBlessings = [...catalog.blessings, ...(catalog.curses ?? [])];
  if (record.blessingIds.some(id => !selectableBlessings.some(blessing => blessing.id === id))) issues.push({ level: "error", message: "Choose blessings or curses from the current game catalog." });
  for (const pick of record.cellBlessingPicks ?? []) {
    const ability = selectableBlessings.find(item => {
      const rootId = String(item.mechanics?.rootPersistentId ?? item.mechanics?.persistentId ?? item.id);
      return item.family === "cell" && rootId === pick.rootId && record.blessingIds.includes(item.id);
    });
    if (!ability) {
      issues.push({ level: "error", message: "Cell targeting can only be configured for an assigned Cell Blessing or Curse." });
      continue;
    }
    const mechanics = ability.mechanics ?? {};
    const rule = String(mechanics.rule ?? "None");
    const baneRule = String(mechanics.baneRule ?? "None");
    const grid = armyGridSize(catalog, floor, record.blessingIds);
    const validCells = (cells: Array<{ x: number; y: number }>) => cells.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.x >= 0 && cell.y >= 0 && cell.x < grid.width && cell.y < grid.height) &&
      new Set(cells.map(cell => cell.x + ":" + cell.y)).size === cells.length;
    if (rule === "PickedColumn" && (!Number.isInteger(pick.lane) || pick.lane < 0 || pick.lane >= grid.height)) {
      issues.push({ level: "error", message: "Choose a valid lane for the selected Cell Blessing." });
    }
    if (rule === "RandomCells" && (!validCells(pick.cells) || pick.cells.length !== Number(mechanics.cellCount ?? 1))) {
      issues.push({ level: "error", message: "Choose the configured number of cells for the selected Cell Blessing." });
    }
    if (baneRule === "RandomCells" && (!validCells(pick.baneCells) || pick.baneCells.length !== Number(mechanics.baneCellCount ?? 1))) {
      issues.push({ level: "error", message: "Choose the configured number of bane cells for the selected Cell Blessing." });
    }
    if ((pick.baneCells ?? []).some(bane => pick.cells.some(boon => bane.x === boon.x && bane.y === boon.y))) {
      issues.push({ level: "error", message: "Blessing and bane fields cannot overlap." });
    }
  }
  return issues;
}

