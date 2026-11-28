/** MeowEdit Content Contract authoring types (§§2.1, 4, 5). Mirrors contract/content/schema/content-set.schema.json. */

export interface LocalizedText {
  default: string;
  locales: Record<string, string>;
}

export interface NamedRef {
  id: string;
  label: LocalizedText;
}

export interface Parameter {
  key: string;
  value: unknown;
}

export interface SetDocument {
  schemaVersion: 2;
  setId: string;
  name: LocalizedText;
  description: LocalizedText;
  displayOrder: number;
  kind: "missions" | "data";
  missionOrder: string[];
  minAppVersion?: string;
  requiredCapabilities?: string[];
}

export interface CompletionEffect {
  kind: string;
  targetId: NamedRef;
  label: LocalizedText;
}

export interface FetchItem {
  id: string;
  displayName: LocalizedText;
  count: number;
}

export interface BattleTarget {
  id: string;
  label: LocalizedText;
  nodeKind: string;
  floorOffset: number;
  armyId: NamedRef;
}

export interface KillCount {
  targetKind: string;
  targetId: NamedRef;
  count: number;
}

export interface DistanceRule {
  id: string;
  fromNodeKind: string;
  toNodeKind: string;
  minimumHops: number;
}

export interface QuestTimer {
  decisionId: NamedRef;
  payOutcomeId: NamedRef;
  waitOutcomeId: NamedRef;
  counterId: NamedRef;
  counterTarget: number;
  counterLabel: LocalizedText;
  countEvent: string;
  paymentResource: string;
  paymentAmount: number;
  paymentCompletesImmediately: boolean;
  payChoiceLabel?: LocalizedText;
  waitChoiceLabel?: LocalizedText;
  payTerminalText?: LocalizedText;
  waitTerminalText?: LocalizedText;
  completionEffects: CompletionEffect[];
}

export interface MeowEditQuestExtension {
  schemaVersion: 2;
  dialogueLinks: Record<"offer" | "active" | "completion" | "failure", NamedRef[]>;
  logicKind: string;
  timer: QuestTimer;
  completionEffects: CompletionEffect[];
  fetchItems: FetchItem[];
  battleTargets: BattleTarget[];
  killCount: KillCount;
  minimumNodeDistances: DistanceRule[];
}

export interface QuestDocument {
  schemaVersion: 2;
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  sourceKind?: string;
  sourceSlot?: string;
  firstFloor?: number;
  repeatEveryFloors?: number;
  priority?: number;
  objectiveKind?: string;
  targetNodeKind?: string;
  targetFloorOffset?: number;
  escortUnitId?: NamedRef;
  itemId?: NamedRef;
  speakerUnitId?: NamedRef;
  speakerName?: LocalizedText;
  offerText?: LocalizedText;
  activeText?: LocalizedText;
  acceptLabel?: LocalizedText;
  declineLabel?: LocalizedText;
  /** Skip the accept/decline choice and auto-accept after the offer dialogue. */
  autoAccept?: boolean;
  rewardKind?: string;
  rewardAmount?: number;
  rewardContentId?: NamedRef;
  /** Defaults for generated quest dialogue nodes. */
  speakerSpeed?: DialogueSpeedSetting;
  speakerFace?: string;
  speakerIdleAnim?: string;
  meowEdit: MeowEditQuestExtension;
}

export interface ArmyUnitPlacement {
  unitId: NamedRef;
  x: number;
  y: number;
  spellIds: NamedRef[];
}

export interface CellBlessingPick {
  RootId: NamedRef;
  Lane: string;
  Cells: object[];
  Locked: boolean;
  BaneCells: object[];
}

export interface ArmyDocument {
  schemaVersion: 2;
  id: string;
  name: LocalizedText;
  units: ArmyUnitPlacement[];
  spellIds: NamedRef[];
  blessingIds: NamedRef[];
  CellBlessingPicks: CellBlessingPick[];
}

export interface MissionSettings {
  startingLives: number;
  startingSardines: number;
  startingNodeCount: number;
  playerFactionId: NamedRef;
  factionSelectionEnabled: boolean;
  battleShopEnabled: boolean;
  shopPoolKinds: string[];
  questNodeCountPerRandomFloor: number;
  shopNodeCountPerRandomFloor: number;
  nodeGrowthPerFloor: number;
  continueWithGeneratedFloors: boolean;
  blessingsEnabled: boolean;
  restoreArmyAfterLoss: boolean;
  /** Master switch for generated Sardine rewards on map reward nodes. */
  sardinePayoutEnabled?: boolean;
  /** Base Sardines for a generated reward node; defaults to 10. */
  sardinePayoutBase?: number;
  /** Extra Sardines per floor for a generated reward node; defaults to 1. */
  sardinePayoutPerFloor?: number;
}

export interface ShopOffer {
  kind: string;
  contentId: NamedRef;
  price: number;
}

export interface MissionNode {
  id: string;
  label: LocalizedText;
  kind: string;
  x: number;
  y: number;
  armyId: NamedRef;
  questId: NamedRef;
  enemyFactionId: NamedRef;
  rewardKind: string;
  rewardAmount: number;
  rewardContentId: NamedRef;
  shopOfferMode: string;
  shopOffers: ShopOffer[];
}

export interface MissionRoute {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  oneWay: boolean;
}

export interface MissionFloor {
  id: string;
  number: number;
  mode: string;
  questPoolMode: string;
  questPoolIds: NamedRef[];
  shopPoolMode: string;
  shopPoolKinds: string[];
  shopLevel: number;
  randomSettings: { nodeCount: number; questNodeCount: number; shopNodeCount: number };
  nodes: MissionNode[];
  routes: MissionRoute[];
}

export interface MissionEventAction {
  kind: string;
  parameters: Parameter[];
}

export type EventOneShot = "per-run" | "per-node" | "always";

export interface MissionEvent {
  id: string;
  trigger: string;
  floorNumber?: number;
  nodeId?: string;
  conditions: Parameter[];
  actions: MissionEventAction[];
  oneShot: EventOneShot;
}

export interface MissionDocument {
  schemaVersion: 2;
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  boardPreviewUnitId: NamedRef;
  questIds: NamedRef[];
  floors: MissionFloor[];
  events: MissionEvent[];
  settings: MissionSettings;
}

export interface DialogueDecision {
  id: string;
  label: LocalizedText;
  outcomeId: string;
  outcomeLabel: LocalizedText;
}

/** Optional reveal-speed setting. Numeric cps wins over a named preset. */
export interface DialogueSpeedSetting {
  preset?: string;
  charactersPerSecond?: number;
  cadence?: unknown[];
}

export interface DialogueSpeaker {
  id: string;
  unitId: NamedRef;
  displayName: LocalizedText;
  side: string;
  mood: string;
  defaultSpeed?: DialogueSpeedSetting;
  defaultFace?: string;
  defaultIdleAnim?: string;
}

export interface DialogueSegment {
  speakerIds: string[];
  text: LocalizedText;
  speed?: DialogueSpeedSetting;
  face?: string;
  anim?: string;
  idleAnim?: string;
}

export interface DialogueAction {
  label: LocalizedText;
  targetNodeId: string;
  meowEdit: { decision: DialogueDecision; defaultContinue: boolean };
}

export interface DialogueNode {
  id: string;
  headline: LocalizedText;
  textSpeed: number;
  speakers: DialogueSpeaker[];
  segments: DialogueSegment[];
  actions: DialogueAction[];
}

export interface DialogueDocument {
  schemaVersion: 2;
  sequenceId: string;
  startNodeId: string;
  pauseMode: string;
  defaultCharactersPerSecond: number;
  nodes: DialogueNode[];
}

export interface ContentSetDocument {
  schemaVersion: 2;
  set: SetDocument;
  quests: QuestDocument[];
  armies: ArmyDocument[];
  missions: MissionDocument[];
  dialogues: DialogueDocument[];
}

export interface ParameterDescriptor {
  type: "NamedRef" | "NamedRef[]" | "string" | "int" | "enum";
  values?: string[];
  required?: boolean;
}

/** The generated capability manifest (§6). */
export interface GameCapabilities {
  appVersion: string;
  buildNumber: number;
  schemaVersions: number[];
  triggers: string[];
  actions: string[];
  conditions: string[];
  parameters: Record<string, ParameterDescriptor>;
  enums: {
    nodeKind: string[];
    objectiveKind: string[];
    shopPoolKind: string[];
    floorMode: string[];
    rewardKind: string[];
    shopOfferKind: string[];
    faction: string[];
  };
  features: string[];
  limits: { maxAuthoredNodesPerFloor: number };
  locales: string[];
  ids: { units: string[]; blessings: string[]; curses: string[]; spells: string[]; factions: string[] };
}
