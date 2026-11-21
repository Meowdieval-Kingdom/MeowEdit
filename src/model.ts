export type SourceKind = "QuestGiver" | "Letter" | "Item";
export type ObjectiveKind = "Escort" | "Fetch" | "Battle" | "ClearFloor" | "Timer" | "KillCount";
export type RewardKind = "Sardines" | "ExtraLife" | "Blessing";
export type TextSpeed = "default" | "fast" | "slow";
export type FaceMood = "Normal" | "Cute" | "Sleeping" | "Hurt" | "Confused" | "Mad";

export interface DialogueSpeaker {
  id: string;
  unitId: string;
  displayName: string;
  side: "left" | "right";
  mood: FaceMood | string;
}

export interface DialogueSegment {
  speakerIds: string[];
  text: string;
}

export interface DialogueDecision {
  id: string;
  label: string;
  outcomeId: string;
  outcomeLabel: string;
}

export interface DialogueAction {
  label: string;
  targetNodeId: string;
  decision?: DialogueDecision;
}

export interface DialogueNode {
  id: string;
  headline: string;
  /** Workspace-only editor name. Runtime headline remains the in-game speaker label. */
  editorLabel?: string;
  /** Workspace-only position used by the guided dialogue graph. */
  editorPosition?: { x: number; y: number; reverse?: boolean };
  textSpeed: TextSpeed | string;
  speakers: DialogueSpeaker[];
  segments: DialogueSegment[];
  /** Label for the guaranteed single Continue button when no explicit choices exist. */
  continueLabel?: string;
  /** Workspace-only explicit destination for the implicit Continue route. */
  continueTargetNodeId?: string;
  actions: DialogueAction[];
}

export interface DialogueSequence {
  schemaVersion: 1;
  sequenceId: string;
  startNodeId: string;
  pauseMode: "pause" | "continue";
  defaultCharactersPerSecond: number;
  nodes: DialogueNode[];
}

export interface AdventureQuestDefinition {
  id: string;
  title: string;
  description: string;
  sourceKind: SourceKind | string;
  sourceSlot: number;
  firstFloor: number;
  repeatEveryFloors: number;
  priority: number;
  objectiveKind: ObjectiveKind | string;
  targetNodeKind: string;
  targetFloorOffset: number;
  escortUnitId: string;
  itemId: string;
  speakerUnitId: string;
  speakerName: string;
  offerText: string;
  activeText: string;
  acceptLabel: string;
  declineLabel: string;
  rewardKind: RewardKind | string;
  rewardAmount: number;
  rewardContentId: string;
}

export type CompletionEffectKind = "play-event" | "unlock-path" | "unlock-shop-item";

export interface CompletionEffect {
  kind: CompletionEffectKind;
  targetId: string;
  label: string;
}

export interface DialogueLinks {
  offer: string;
  active: string;
  completion: string;
  failure: string;
}

export interface TimerQuestLogic {
  decisionId: string;
  payOutcomeId: string;
  waitOutcomeId: string;
  counterId: string;
  counterTarget: number;
  counterLabel: string;
  countEvent: "any-battle-completed" | "battle-won";
  paymentResource: "Sardines";
  paymentAmount: number;
  paymentCompletesImmediately: boolean;
  completionEffects: CompletionEffect[];
}

export interface QuestExtension {
  schemaVersion: 1;
  dialogueLinks: DialogueLinks;
  logicKind: "standard" | "timer-project";
  timer: TimerQuestLogic;
  completionEffects: CompletionEffect[];
  fetchItems: FetchItem[];
  battleTargets: BattleTarget[];
  killCount: KillCountObjective | null;
  minimumNodeDistances: MinimumNodeDistanceRule[];
}

export interface FetchItem {
  id: string;
  displayName: string;
  count: number;
}

export interface BattleTarget {
  id: string;
  label: string;
  nodeKind: string;
  floorOffset: number;
  armyId: string;
}

export type KillCountTargetKind = "unit" | "faction" | "building-faction";

export interface KillCountObjective {
  targetKind: KillCountTargetKind;
  targetId: string;
  count: number;
}

export interface MinimumNodeDistanceRule {
  id: string;
  fromNodeKind: string;
  toNodeKind: string;
  minimumHops: number;
}

export interface ArmyUnitPlacement {
  id: string;
  unitId: string;
  x: number;
  y: number;
  spellIds: string[];
}

export interface ArmyCellBlessingPick {
  rootId: string;
  lane: number;
  cells: Array<{ x: number; y: number }>;
  locked: boolean;
  baneCells: Array<{ x: number; y: number }>;
}

export interface ArmyRecord {
  key: string;
  isGameExample?: boolean;
  id: string;
  idAuto?: boolean;
  name: string;
  previewFloor: number;
  units: ArmyUnitPlacement[];
  spellIds: string[];
  blessingIds: string[];
  cellBlessingPicks?: ArmyCellBlessingPick[];
}

export type AdventureNodeKind = "Start" | "Battle" | "Reward" | "Boss" | "Quest" | "Shop";
export type CampaignFloorMode = "authored" | "random" | "mixed";
export type CampaignRewardKind = "Sardines" | "ExtraLife" | "Blessing" | "UnitUnlock" | "ShopLevelUnlock" | "SpellUnlock";
export type CampaignShopOfferKind = "Unit" | "Blessing" | "Research" | "SpellUnlock";

export interface CampaignShopOffer {
  kind: CampaignShopOfferKind;
  contentId: string;
  price: number;
}

export interface CampaignNode {
  id: string;
  label: string;
  kind: AdventureNodeKind;
  x: number;
  y: number;
  armyId: string;
  questId: string;
  enemyFactionId: string;
  rewardKind: CampaignRewardKind;
  rewardAmount: number;
  rewardContentId: string;
  shopOfferMode: "generated" | "exact";
  shopOffers: CampaignShopOffer[];
}

export interface CampaignRoute {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  oneWay: boolean;
}

export interface CampaignRandomFloorSettings {
  nodeCount: number;
  questNodeCount: number;
  shopNodeCount: number;
}

export interface CampaignFloor {
  id: string;
  number: number;
  mode: CampaignFloorMode;
  questPoolMode: "campaign" | "custom";
  questPoolIds: string[];
  /** Pools available to generated shops on this floor, or inherited from campaign settings. */
  shopPoolMode: "campaign" | "custom";
  shopPoolKinds: CampaignShopOfferKind[];
  /** Adventure shop tier available on this floor; capped by game progression at tier 4. */
  shopLevel: number;
  randomSettings: CampaignRandomFloorSettings;
  /** Integer Adventure-map coordinates. Neighbouring nodes use the game's 8-direction grid. */
  nodes: CampaignNode[];
  routes: CampaignRoute[];
}

export interface CampaignSettings {
  startingLives: number;
  startingSardines: number;
  startingNodeCount: number;
  playerFactionId: string;
  /** Whether the player chooses a faction when starting this campaign. */
  factionSelectionEnabled: boolean;
  battleShopEnabled: boolean;
  /** Offer categories used by generated Adventure map shops. */
  shopPoolKinds: CampaignShopOfferKind[];
  questNodeCountPerRandomFloor: number;
  shopNodeCountPerRandomFloor: number;
  nodeGrowthPerFloor: number;
  continueWithGeneratedFloors: boolean;
}

export type CampaignEventTrigger = "campaign-start" | "before-battle" | "after-battle" | "node-cleared";

/** Unknown action fields are retained so the campaign action list can grow without losing imported data. */
export interface CampaignEventAction {
  kind: string;
  [field: string]: unknown;
}

export interface ReplacePlayerArmyCampaignEventAction extends CampaignEventAction {
  kind: "replace-player-army";
  armyId: string;
}

export interface CampaignEvent {
  id: string;
  trigger: CampaignEventTrigger;
  /** Omit to apply a node/battle trigger to matching nodes on every floor. */
  floorNumber?: number;
  /** Omit to apply a node/battle trigger to all matching nodes on the selected floor scope. */
  nodeId?: string;
  actions: CampaignEventAction[];
}

export interface CampaignRecord {
  key: string;
  isGameExample?: boolean;
  id: string;
  idAuto?: boolean;
  name: string;
  description: string;
  /** Optional unit shown as the player's character on the Adventure board; empty uses the faction hero. */
  boardPreviewUnitId?: string;
  /** Guided entry path; editor metadata and omitted from game exports. */
  designMode?: "choose" | "settings-only" | "custom";
  /** Selected reusable quest definitions available to Quest nodes in this campaign. */
  questIds: string[];
  floors: CampaignFloor[];
  events: CampaignEvent[];
  settings: CampaignSettings;
}

export interface ArmyCatalogLevel {
  id: string;
  name: string;
  level: number;
  description?: string;
  tier?: number;
  previewImage?: string;
  footprint?: { width: number; height: number };
  stats?: ArmyCatalogCombatStats;
}

export interface ArmyCatalogCombatStats {
  maxHealth?: number;
  maxMana?: number;
  manaRegen?: number;
  attackDamage?: number;
  attackSpeed?: number;
  attackRange?: number;
  minAttackRange?: number;
  critChance?: number;
  spellPower?: number;
  armorResist?: number;
  magicResist?: number;
  movementSpeed?: number;
}

export interface ArmyCatalogUnit {
  id: string;
  name: string;
  factionId: string;
  faction: string;
  levels: ArmyCatalogLevel[];
}

export interface ArmyCatalogAbility {
  id: string;
  name: string;
  level?: number;
  description?: string;
  tier?: number;
  manaCost?: number;
  coinCost?: number;
  healthCost?: number;
  cooldown?: number;
  maxTargets?: number;
  family?: "stat" | "cell" | "economy" | "grid";
  isCurse?: boolean;
  isAdventureOnly?: boolean;
  mechanics?: Record<string, unknown>;
  sourceHash?: string;
}

export interface ArmyCatalog {
  schemaVersion: 1;
  gridSizes: Array<{ minFloor: number; width: number; height: number }>;
  units: ArmyCatalogUnit[];
  buildings: ArmyCatalogUnit[];
  factions: Array<{ id: string; name: string }>;
  spells: ArmyCatalogAbility[];
  blessings: ArmyCatalogAbility[];
  curses?: ArmyCatalogAbility[];
  implementationSources?: Array<{ id: string; classes: string[]; sourceHash: string }>;
}

export interface QuestRecord {
  key: string;
  isGameExample?: boolean;
  idAuto?: boolean;
  itemDisplayName?: string;
  definition: AdventureQuestDefinition;
  extension: QuestExtension;
}

export interface DialogueRecord {
  key: string;
  isGameExample?: boolean;
  /** Workspace-only semantic title for cataloguing bundled game examples. */
  exampleTitle?: string;
  sequenceIdAuto?: boolean;
  sequence: DialogueSequence;
}

export interface Workspace {
  schemaVersion: 1;
  dialogues: DialogueRecord[];
  quests: QuestRecord[];
  armies: ArmyRecord[];
  campaigns: CampaignRecord[];
  selectedType: "dialogue" | "quest" | "army" | "campaign" | null;
  selectedKey: string | null;
  activeNodeId: string | null;
}

export interface UnitRosterEntry {
  id: string;
  displayName: string;
  faction: string;
  /** Army catalog progression level; used to distinguish character forms in pickers. */
  level?: number;
  portrait?: string;
  portraitCaptures?: Partial<Record<FaceMood, string>>;
  moods: FaceMood[];
}

export interface UnitRoster {
  schemaVersion: 1;
  rosterVersion: string;
  source: string;
  units: UnitRosterEntry[];
}

export const DEFAULT_MOODS: FaceMood[] = [
  "Normal",
  "Cute",
  "Sleeping",
  "Hurt",
  "Confused",
  "Mad"
];

export const DEFAULT_QUEST: AdventureQuestDefinition = {
  id: "",
  title: "",
  description: "",
  sourceKind: "QuestGiver",
  sourceSlot: -1,
  firstFloor: 1,
  repeatEveryFloors: 1,
  priority: 0,
  objectiveKind: "Battle",
  targetNodeKind: "Battle",
  targetFloorOffset: 0,
  escortUnitId: "",
  itemId: "",
  speakerUnitId: "",
  speakerName: "",
  offerText: "",
  activeText: "",
  acceptLabel: "Accept",
  declineLabel: "Decline",
  rewardKind: "Sardines",
  rewardAmount: 10,
  rewardContentId: ""
};

export function createKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return prefix + "-" + random;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function dialogueActionsForNode(sequence: DialogueSequence, node: DialogueNode): DialogueAction[] {
  if (node.actions.length > 0) return node.actions;
  const index = sequence.nodes.indexOf(node);
  return [{
    label: node.continueLabel?.trim() || "Continue",
    targetNodeId: node.continueTargetNodeId ?? sequence.nodes[index + 1]?.id ?? ""
  }];
}

export function dialogueMomentName(sequence: DialogueSequence, node: DialogueNode): string {
  const customName = node.editorLabel?.trim();
  if (customName) return customName;
  const index = sequence.nodes.indexOf(node);
  return "Moment " + (index >= 0 ? index + 1 : 1);
}

export function emptyTimerLogic(): TimerQuestLogic {
  return {
    decisionId: "",
    payOutcomeId: "pay-now",
    waitOutcomeId: "wait",
    counterId: "battle-count",
    counterTarget: 3,
    counterLabel: "Completed battles",
    countEvent: "any-battle-completed",
    paymentResource: "Sardines",
    paymentAmount: 15,
    paymentCompletesImmediately: true,
    completionEffects: []
  };
}

export function emptyQuestExtension(): QuestExtension {
  return {
    schemaVersion: 1,
    dialogueLinks: { offer: "", active: "", completion: "", failure: "" },
    logicKind: "standard",
    timer: emptyTimerLogic(),
    completionEffects: [],
    fetchItems: [],
    battleTargets: [],
    killCount: null,
    minimumNodeDistances: []
  };
}
