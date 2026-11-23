import {
  createKey,
  DEFAULT_QUEST,
  emptyTimerLogic,
  type ArmyRecord,
  type CampaignRecord,
  type AdventureQuestDefinition,
  type KillCountTargetKind,
  type QuestRecord
} from "./model";

type IdFactory = (prefix: string) => string;

export function normalizeArmy(value: unknown, idFactory: IdFactory = createKey): ArmyRecord {
  const source = value as Record<string, any>;
  const workspaceMeta = source._meowEditWorkspace ?? {};
  const unitSource = Array.isArray(workspaceMeta.units) ? workspaceMeta.units : Array.isArray(source.units) ? source.units : [];
  return {
    key: idFactory("army-import"),
      id: String(source.id ?? "imported-army"),
    idAuto: workspaceMeta.idAuto === true,
    name: String(source.name ?? source.id ?? "Imported army"),
    previewFloor: Number(workspaceMeta.previewFloor ?? 1),
    units: unitSource.map((unit: Record<string, any>, index: number) => ({
      id: String(unit.id ?? idFactory("army-unit")), unitId: String(unit.unitId ?? ""), x: Number(unit.x ?? index % 3), y: Number(unit.y ?? Math.floor(index / 3)),
      spellIds: Array.isArray(unit.spellIds) ? unit.spellIds.map(String) : []
    })),
    spellIds: Array.isArray(source.spellIds) ? source.spellIds.map(String) : [],
    blessingIds: Array.isArray(source.blessingIds) ? source.blessingIds.map(String) : [],
    cellBlessingPicks: Array.isArray(source.cellBlessingPicks ?? source.CellBlessingPicks) ? (source.cellBlessingPicks ?? source.CellBlessingPicks).map((pick: Record<string, any>) => ({
      rootId: String(pick.rootId ?? pick.RootId ?? ""),
      lane: Number(pick.lane ?? pick.Lane ?? -1),
      cells: Array.isArray(pick.cells ?? pick.Cells) ? (pick.cells ?? pick.Cells).map((cell: Record<string, any>) => ({ x: Number(cell.x ?? cell.X ?? 0), y: Number(cell.y ?? cell.Y ?? 0) })) : [],
      locked: Boolean(pick.locked ?? pick.Locked),
      baneCells: Array.isArray(pick.baneCells ?? pick.BaneCells) ? (pick.baneCells ?? pick.BaneCells).map((cell: Record<string, any>) => ({ x: Number(cell.x ?? cell.X ?? 0), y: Number(cell.y ?? cell.Y ?? 0) })) : []
    })) : []
  };
}

export function normalizeQuest(value: unknown, idFactory: IdFactory = createKey): QuestRecord {
  const source = value as Record<string, any>;
  const workspaceMeta = source._meowEditWorkspace ?? {};
  const definitionSource = source.definition ?? source;
  const extensionSource = source.meowEdit ?? source.extension ?? {};
  const timerSource = extensionSource.timer ?? {};
  const definition: AdventureQuestDefinition = {
    ...DEFAULT_QUEST,
    ...definitionSource,
    id: String(definitionSource.id ?? "imported-quest"),
    title: String(definitionSource.title ?? ""),
    sourceSlot: Number(definitionSource.sourceSlot ?? -1),
    firstFloor: Number(definitionSource.firstFloor ?? 1),
    repeatEveryFloors: Number(definitionSource.repeatEveryFloors ?? 1),
    priority: Number(definitionSource.priority ?? 0),
    targetFloorOffset: Number(definitionSource.targetFloorOffset ?? 0),
    rewardAmount: Number(definitionSource.rewardAmount ?? 0)
  };
  const fetchItems = Array.isArray(extensionSource.fetchItems)
    ? extensionSource.fetchItems.map((item: Record<string, any>) => ({
      id: String(item.id ?? ""), displayName: String(item.displayName ?? ""), count: Number(item.count ?? 1)
    }))
    : definition.objectiveKind === "Fetch" && definition.itemId
      ? [{ id: String(definition.itemId), displayName: definition.itemId.replace(/[-_]+/g, " "), count: 1 }]
      : [];
  const battleTargets = Array.isArray(extensionSource.battleTargets)
    ? extensionSource.battleTargets.map((target: Record<string, any>, index: number) => ({
      id: String(target.id ?? "battle-" + (index + 1)), label: String(target.label ?? "Battle " + (index + 1)),
      nodeKind: String(target.nodeKind ?? definition.targetNodeKind), floorOffset: Number(target.floorOffset ?? definition.targetFloorOffset), armyId: String(target.armyId ?? "")
    }))
    : definition.objectiveKind === "Battle"
      ? [{ id: "battle-1", label: "Battle 1", nodeKind: definition.targetNodeKind || "Battle", floorOffset: definition.targetFloorOffset, armyId: "" }]
      : [];
  const timer = {
    ...emptyTimerLogic(),
    ...timerSource,
    counterTarget: Number(timerSource.counterTarget ?? 3),
    paymentAmount: Number(timerSource.paymentAmount ?? 15),
    completionEffects: Array.isArray(timerSource.completionEffects) ? timerSource.completionEffects : emptyTimerLogic().completionEffects
  };
  return {
    key: idFactory("quest-import"),
    idAuto: workspaceMeta.idAuto === true,
      definition,
    extension: {
      schemaVersion: 1,
      dialogueLinks: {
        offer: String(extensionSource.dialogueLinks?.offer ?? ""),
        active: String(extensionSource.dialogueLinks?.active ?? ""),
        completion: String(extensionSource.dialogueLinks?.completion ?? ""),
        failure: String(extensionSource.dialogueLinks?.failure ?? "")
      },
      logicKind: extensionSource.logicKind === "timer-project" ? "timer-project" : "standard",
      timer,
      completionEffects: Array.isArray(extensionSource.completionEffects) ? extensionSource.completionEffects : [],
      fetchItems,
      battleTargets,
      killCount: extensionSource.killCount ? {
        targetKind: String(extensionSource.killCount.targetKind ?? "unit") as KillCountTargetKind,
        targetId: String(extensionSource.killCount.targetId ?? ""),
        count: Number(extensionSource.killCount.count ?? 1)
      } : null,
      minimumNodeDistances: Array.isArray(extensionSource.minimumNodeDistances) ? extensionSource.minimumNodeDistances.map((rule: Record<string, any>, index: number) => ({
        id: String(rule.id ?? "distance-" + (index + 1)), fromNodeKind: String(rule.fromNodeKind ?? "QuestStart"), toNodeKind: String(rule.toNodeKind ?? "Battle"), minimumHops: Number(rule.minimumHops ?? 1)
      })) : []
    }
  };
}

export function normalizeCampaign(value: unknown, idFactory: IdFactory = createKey): CampaignRecord {
  const source = value as Record<string, any>;
  const meta = source._meowEditWorkspace ?? {};
  const raw = source.campaign ?? source;
  return {
    key: String(meta.key ?? idFactory("campaign-import")),
      id: String(raw.id ?? "imported-campaign"), idAuto: meta.idAuto === true,
    name: String(raw.name ?? raw.id ?? "Imported campaign"),
    description: String(raw.description ?? ""),
    boardPreviewUnitId: String(raw.boardPreviewUnitId ?? ""),
    designMode: meta.designMode === "settings-only" || meta.designMode === "custom" || meta.designMode === "choose"
      ? meta.designMode
      : Array.isArray(raw.floors) && raw.floors.length > 0 && !(raw.questIds?.length) &&
        raw.floors.every((floor: Record<string, any>) => floor.mode === "random" && !(floor.nodes?.length) && !(floor.routes?.length) && Number(floor.randomSettings?.questNodeCount ?? 2) === 0) &&
        Number(raw.settings?.questNodeCountPerRandomFloor ?? 2) === 0 ? "settings-only" : "custom",
    questIds: Array.isArray(raw.questIds) ? raw.questIds.map(String) : [],
    events: Array.isArray(raw.events) ? raw.events
      .filter((event: unknown) => !!event && typeof event === "object" && !Array.isArray(event))
      .map((event: Record<string, any>) => ({
        ...event,
        id: String(event.id ?? idFactory("campaign-event-import")),
        trigger: String(event.trigger ?? "campaign-start") as CampaignRecord["events"][number]["trigger"],
        ...(event.floorNumber !== undefined && event.floorNumber !== null ? { floorNumber: Number(event.floorNumber) } : {}),
        ...(event.nodeId !== undefined && event.nodeId !== null && event.nodeId !== "" ? { nodeId: String(event.nodeId) } : {}),
        actions: Array.isArray(event.actions) ? event.actions
          .filter((action: unknown) => !!action && typeof action === "object" && !Array.isArray(action))
          .map((action: Record<string, unknown>) => ({ ...action, kind: String(action.kind ?? "") })) : []
      })) : [],
    floors: Array.isArray(raw.floors) ? raw.floors.map((floor: Record<string, any>, index: number) => ({
      id: String(floor.id ?? idFactory("floor-import")), number: Number(floor.number ?? index + 1),
      mode: floor.mode === "random" || floor.mode === "mixed" ? floor.mode : "authored",
      randomSettings: {
        nodeCount: Number(floor.randomSettings?.nodeCount ?? 12),
        questNodeCount: Number(floor.randomSettings?.questNodeCount ?? 2),
        shopNodeCount: Number(floor.randomSettings?.shopNodeCount ?? 3)
      },
      questPoolMode: floor.questPoolMode === "custom" ? "custom" : "campaign",
      questPoolIds: Array.isArray(floor.questPoolIds) ? floor.questPoolIds.map(String) : [],
      shopPoolMode: floor.shopPoolMode === "custom" ? "custom" : "campaign",
      shopPoolKinds: Array.isArray(floor.shopPoolKinds) ? floor.shopPoolKinds.filter((kind: string) => ["Unit", "Blessing", "Research", "SpellUnlock"].includes(kind)) : [],
      shopLevel: Number(floor.shopLevel ?? Math.min(Number(floor.number ?? index + 1), 4)),
      nodes: Array.isArray(floor.nodes) ? floor.nodes.map((node: Record<string, any>, nodeIndex: number) => ({
        id: String(node.id ?? idFactory("node-import")), label: String(node.label ?? "Node " + (nodeIndex + 1)),
        kind: String(node.kind ?? "Battle") as CampaignRecord["floors"][number]["nodes"][number]["kind"],
        x: Number(node.x ?? 0), y: Number(node.y ?? 0),
        armyId: String(node.armyId ?? ""), questId: String(node.questId ?? ""), enemyFactionId: String(node.enemyFactionId ?? ""),
        rewardKind: String(node.rewardKind ?? "Sardines") as CampaignRecord["floors"][number]["nodes"][number]["rewardKind"],
        rewardAmount: Number(node.rewardAmount ?? 10), rewardContentId: String(node.rewardContentId ?? ""),
        shopOfferMode: node.shopOfferMode === "exact" ? "exact" : "generated",
        shopOffers: Array.isArray(node.shopOffers) ? node.shopOffers.map((offer: Record<string, any>) => ({
          kind: ["Unit", "Blessing", "Research", "SpellUnlock"].includes(String(offer.kind)) ? offer.kind : "Unit",
          contentId: String(offer.contentId ?? ""), price: Number(offer.price ?? 0)
        })) : []
      })) : [],
      routes: Array.isArray(floor.routes) ? floor.routes.map((route: Record<string, any>) => ({
        id: String(route.id ?? idFactory("route-import")), fromNodeId: String(route.fromNodeId ?? ""),
        toNodeId: String(route.toNodeId ?? ""), oneWay: route.oneWay === true
      })) : []
    })) : [],
    settings: {
      startingLives: Number(raw.settings?.startingLives ?? 3), startingSardines: Number(raw.settings?.startingSardines ?? 10),
      startingNodeCount: Number(raw.settings?.startingNodeCount ?? 12),
      playerFactionId: String(raw.settings?.playerFactionId ?? ""),
      factionSelectionEnabled: raw.settings?.factionSelectionEnabled !== false,
      battleShopEnabled: raw.settings?.battleShopEnabled !== false,
      shopPoolKinds: Array.isArray(raw.settings?.shopPoolKinds) ? raw.settings.shopPoolKinds.filter((kind: string) => ["Unit", "Blessing", "Research", "SpellUnlock"].includes(kind)) : ["Unit", "Blessing", "Research", "SpellUnlock"],
      questNodeCountPerRandomFloor: Number(raw.settings?.questNodeCountPerRandomFloor ?? 2),
      shopNodeCountPerRandomFloor: Number(raw.settings?.shopNodeCountPerRandomFloor ?? 3),
      nodeGrowthPerFloor: Number(raw.settings?.nodeGrowthPerFloor ?? 2),
      continueWithGeneratedFloors: raw.settings?.continueWithGeneratedFloors === true
    }
  };
}
