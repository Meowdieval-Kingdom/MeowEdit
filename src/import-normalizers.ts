import { createKey, type ArmyRecord, type CampaignRecord } from "./model";

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
    blessingIds: Array.isArray(source.blessingIds) ? source.blessingIds.map(String) : []
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
    designMode: meta.designMode === "settings-only" || meta.designMode === "custom" || meta.designMode === "choose"
      ? meta.designMode
      : Array.isArray(raw.floors) && raw.floors.length > 0 && !(raw.questIds?.length) &&
        raw.floors.every((floor: Record<string, any>) => floor.mode === "random" && !(floor.nodes?.length) && !(floor.routes?.length) && Number(floor.randomSettings?.questNodeCount ?? 2) === 0) &&
        Number(raw.settings?.questNodeCountPerRandomFloor ?? 2) === 0 ? "settings-only" : "custom",
    questIds: Array.isArray(raw.questIds) ? raw.questIds.map(String) : [],
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
      playerFactionId: String(raw.settings?.playerFactionId ?? ""), battleShopEnabled: raw.settings?.battleShopEnabled !== false,
      shopPoolKinds: Array.isArray(raw.settings?.shopPoolKinds) ? raw.settings.shopPoolKinds.filter((kind: string) => ["Unit", "Blessing", "Research", "SpellUnlock"].includes(kind)) : ["Unit", "Blessing", "Research", "SpellUnlock"],
      questNodeCountPerRandomFloor: Number(raw.settings?.questNodeCountPerRandomFloor ?? 2),
      shopNodeCountPerRandomFloor: Number(raw.settings?.shopNodeCountPerRandomFloor ?? 3),
      nodeGrowthPerFloor: Number(raw.settings?.nodeGrowthPerFloor ?? 2),
      continueWithGeneratedFloors: raw.settings?.continueWithGeneratedFloors === true
    }
  };
}
