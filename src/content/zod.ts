import { z } from "zod";
import registry from "../../contract/content/registries.json";

/**
 * Strict zod schemas mirroring contract/content/schema/content-set.schema.json (§9.2).
 * Every enum below is derived from the single shared registry so this mirror
 * cannot silently drift from the JSON Schema or the backend validator.
 */
function contractEnum(values: readonly string[]): [string, ...string[]] {
  if (!values.length) throw new Error("The content contract registry contains an empty enum.");
  return values as [string, ...string[]];
}

const nodeKinds = contractEnum(registry.enums.nodeKind);
const objectiveKinds = contractEnum(registry.enums.objectiveKind);
const shopPoolKinds = contractEnum(registry.enums.shopPoolKind);
const floorModes = contractEnum(registry.enums.floorMode);
const rewardKinds = contractEnum(registry.enums.rewardKind);
const triggers = contractEnum([...registry.triggers, ...registry.internalTriggers]);
const conditions = contractEnum(registry.conditions.map(entry => entry.kind));
const actions = contractEnum(registry.actions.map(entry => entry.kind));

const jsonValue = z.union([
  z.string(), z.number(), z.boolean(), z.null(),
  z.array(z.unknown()), z.record(z.string(), z.unknown())
]);

export const localizedTextSchema = z.object({
  default: z.string(),
  locales: z.record(z.string(), z.string())
}).strict();

export const namedRefSchema = z.object({
  id: z.string().min(1),
  label: localizedTextSchema
}).strict();

export const parameterSchema = z.object({
  key: z.string().min(1),
  value: jsonValue
}).strict();

export const conditionParameterSchema = z.object({
  key: z.enum(conditions),
  value: jsonValue.optional()
}).strict();

export const setDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  setId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  name: localizedTextSchema,
  description: localizedTextSchema,
  displayOrder: z.number().int(),
  campaignOrder: z.array(z.string())
}).strict();

const completionEffectSchema = z.object({
  kind: z.string(),
  targetId: namedRefSchema,
  label: localizedTextSchema
}).strict();

const questTimerSchema = z.object({
  decisionId: namedRefSchema,
  payOutcomeId: namedRefSchema,
  waitOutcomeId: namedRefSchema,
  counterId: namedRefSchema,
  counterTarget: z.number().int(),
  counterLabel: localizedTextSchema,
  countEvent: z.string(),
  paymentResource: z.string(),
  paymentAmount: z.number().int().nonnegative(),
  paymentCompletesImmediately: z.boolean(),
  completionEffects: z.array(completionEffectSchema)
}).strict();

const meowEditQuestExtensionSchema = z.object({
  schemaVersion: z.literal(2),
  dialogueLinks: z.object({
    offer: z.array(namedRefSchema),
    active: z.array(namedRefSchema),
    completion: z.array(namedRefSchema),
    failure: z.array(namedRefSchema)
  }).strict(),
  logicKind: z.string(),
  timer: questTimerSchema,
  completionEffects: z.array(completionEffectSchema),
  fetchItems: z.array(z.object({
    id: z.string(),
    displayName: localizedTextSchema,
    count: z.number().int().positive()
  }).strict()),
  battleTargets: z.array(z.object({
    id: z.string(),
    label: localizedTextSchema,
    nodeKind: z.string(),
    floorOffset: z.number().int(),
    armyId: namedRefSchema
  }).strict()),
  killCount: z.object({ targetKind: z.string(), targetId: namedRefSchema, count: z.number().int().positive() }).strict(),
  minimumNodeDistances: z.array(z.object({
    id: z.string(), fromNodeKind: z.string(), toNodeKind: z.string(), minimumHops: z.number().int().nonnegative()
  }).strict())
}).strict();

export const questDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  title: localizedTextSchema,
  description: localizedTextSchema,
  sourceKind: z.string().optional(),
  sourceSlot: z.string().optional(),
  firstFloor: z.number().int().optional(),
  repeatEveryFloors: z.number().int().optional(),
  priority: z.number().int().optional(),
  objectiveKind: z.enum(objectiveKinds).optional(),
  targetNodeKind: z.string().optional(),
  targetFloorOffset: z.number().int().optional(),
  escortUnitId: namedRefSchema.optional(),
  itemId: namedRefSchema.optional(),
  speakerUnitId: namedRefSchema.optional(),
  speakerName: localizedTextSchema.optional(),
  offerText: localizedTextSchema.optional(),
  activeText: localizedTextSchema.optional(),
  acceptLabel: localizedTextSchema.optional(),
  declineLabel: localizedTextSchema.optional(),
  autoAccept: z.boolean().optional(),
  rewardKind: z.enum(rewardKinds).optional(),
  rewardAmount: z.number().int().optional(),
  rewardContentId: namedRefSchema.optional(),
  meowEdit: meowEditQuestExtensionSchema
}).strict();

export const armyDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  name: localizedTextSchema,
  units: z.array(z.object({
    unitId: namedRefSchema,
    x: z.number().int(),
    y: z.number().int(),
    spellIds: z.array(namedRefSchema)
  }).strict()),
  spellIds: z.array(namedRefSchema),
  blessingIds: z.array(namedRefSchema),
  CellBlessingPicks: z.array(z.object({
    RootId: namedRefSchema,
    Lane: z.string(),
    Cells: z.array(z.object({}).passthrough()),
    Locked: z.boolean(),
    BaneCells: z.array(z.object({}).passthrough())
  }).strict())
}).strict();

const campaignSettingsSchema = z.object({
  startingLives: z.number().int().positive(),
  startingSardines: z.number().int().nonnegative(),
  startingNodeCount: z.number().int().nonnegative(),
  playerFactionId: namedRefSchema,
  factionSelectionEnabled: z.boolean(),
  battleShopEnabled: z.boolean(),
  shopPoolKinds: z.array(z.enum(shopPoolKinds)),
  questNodeCountPerRandomFloor: z.number().int().nonnegative(),
  shopNodeCountPerRandomFloor: z.number().int().nonnegative(),
  nodeGrowthPerFloor: z.number().int().nonnegative(),
  continueWithGeneratedFloors: z.boolean(),
  blessingsEnabled: z.boolean(),
  restoreArmyAfterLoss: z.boolean(),
  sardinePayoutEnabled: z.boolean().optional(),
  sardinePayoutBase: z.number().int().nonnegative().optional(),
  sardinePayoutPerFloor: z.number().int().nonnegative().optional()
}).strict();

export const campaignDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  name: localizedTextSchema,
  description: localizedTextSchema,
  boardPreviewUnitId: namedRefSchema,
  questIds: z.array(namedRefSchema),
  floors: z.array(z.object({
    id: z.string().min(1),
    number: z.number().int().positive(),
    mode: z.enum(floorModes),
    questPoolMode: z.string(),
    questPoolIds: z.array(namedRefSchema),
    shopPoolMode: z.string(),
    shopPoolKinds: z.array(z.enum(shopPoolKinds)),
    shopLevel: z.number().int().min(1).max(4),
    randomSettings: z.object({
      nodeCount: z.number().int().nonnegative(),
      questNodeCount: z.number().int().nonnegative(),
      shopNodeCount: z.number().int().nonnegative()
    }).strict(),
    nodes: z.array(z.object({
      id: z.string().min(1),
      label: localizedTextSchema,
      kind: z.enum(nodeKinds),
      x: z.number().int(),
      y: z.number().int(),
      armyId: namedRefSchema,
      questId: namedRefSchema,
      enemyFactionId: namedRefSchema,
      rewardKind: z.enum(rewardKinds),
      rewardAmount: z.number().int(),
      rewardContentId: namedRefSchema,
      shopOfferMode: z.string(),
      shopOffers: z.array(z.object({
        kind: z.enum(shopPoolKinds), contentId: namedRefSchema, price: z.number().int().nonnegative()
      }).strict())
    }).strict()),
    routes: z.array(z.object({
      id: z.string().min(1), fromNodeId: z.string(), toNodeId: z.string(), oneWay: z.boolean()
    }).strict())
  }).strict()).min(1),
  events: z.array(z.object({
    id: z.string().min(1),
    trigger: z.enum(triggers),
    floorNumber: z.number().int().optional(),
    nodeId: z.string().optional(),
    conditions: z.array(conditionParameterSchema),
    actions: z.array(z.object({ kind: z.enum(actions), parameters: z.array(parameterSchema) }).strict()),
    oneShot: z.enum(["per-run", "per-node", "always"])
  }).strict()),
  settings: campaignSettingsSchema
}).strict();

export const dialogueDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  sequenceId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  startNodeId: z.string().min(1),
  pauseMode: z.string(),
  defaultCharactersPerSecond: z.number(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    headline: localizedTextSchema,
    textSpeed: z.number(),
    speakers: z.array(z.object({
      id: z.string(), unitId: namedRefSchema, displayName: localizedTextSchema, side: z.string(), mood: z.string()
    }).strict()),
    segments: z.array(z.object({ speakerIds: z.array(z.string()), text: localizedTextSchema }).strict()),
    actions: z.array(z.object({
      label: localizedTextSchema,
      targetNodeId: z.string(),
      meowEdit: z.object({
        decision: z.object({
          id: z.string(), label: localizedTextSchema, outcomeId: z.string(), outcomeLabel: localizedTextSchema
        }).strict(),
        defaultContinue: z.boolean()
      }).strict()
    }).strict())
  }).strict()).min(1)
}).strict();

export const contentSetSchema = z.object({
  schemaVersion: z.literal(2),
  set: setDocumentSchema,
  quests: z.array(questDocumentSchema),
  armies: z.array(armyDocumentSchema),
  campaigns: z.array(campaignDocumentSchema),
  dialogues: z.array(dialogueDocumentSchema)
}).strict();

const parameterDescriptorSchema = z.object({
  type: z.enum(["NamedRef", "NamedRef[]", "string", "int", "enum"]),
  values: z.array(z.string()).optional(),
  required: z.boolean().optional()
}).strict();

export const gameCapabilitiesSchema = z.object({
  appVersion: z.string(),
  buildNumber: z.number().int(),
  schemaVersions: z.array(z.literal(2)),
  triggers: z.array(z.string()),
  actions: z.array(z.string()),
  conditions: z.array(z.string()),
  parameters: z.record(z.string(), parameterDescriptorSchema),
  enums: z.object({
    nodeKind: z.array(z.string()),
    objectiveKind: z.array(z.string()),
    shopPoolKind: z.array(z.string()),
    floorMode: z.array(z.string()),
    rewardKind: z.array(z.string()),
    shopOfferKind: z.array(z.string()),
    faction: z.array(z.string())
  }).strict(),
  features: z.array(z.string()),
  limits: z.object({ maxAuthoredNodesPerFloor: z.number().int().positive() }).strict(),
  locales: z.array(z.string()),
  ids: z.object({
    units: z.array(z.string()),
    blessings: z.array(z.string()),
    curses: z.array(z.string()),
    spells: z.array(z.string()),
    factions: z.array(z.string())
  }).strict()
}).strict();
