import { createKey, type AdventureNodeKind, type CampaignFloor, type CampaignFloorMode, type CampaignNode, type CampaignRecord } from "./model";

type IdFactory = (prefix: string) => string;

export function createCampaignFloor(number: number, mode: CampaignFloorMode = "authored", idFactory: IdFactory = createKey): CampaignFloor {
  const floor: CampaignFloor = {
    id: idFactory("floor"), number, mode,
    questPoolMode: "campaign", questPoolIds: [],
    shopPoolMode: "campaign", shopPoolKinds: [], shopLevel: Math.min(number, 4),
    randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 },
    nodes: [], routes: []
  };
  if (mode !== "random") {
    const start: CampaignNode = { id: "start", label: "Start", kind: "Start", x: 0, y: 0, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] };
    const battleA: CampaignNode = { id: "battle-a-" + number, label: "Battle 1", kind: "Battle", x: -1, y: 1, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] };
    const battleB: CampaignNode = { id: "battle-b-" + number, label: "Battle 2", kind: "Battle", x: 1, y: 1, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] };
    const boss: CampaignNode = { id: "f" + number + "-boss", label: "Boss", kind: "Boss", x: 0, y: 2, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] };
    floor.nodes = [start, battleA, battleB, boss];
    floor.routes = [
      { id: idFactory("route"), fromNodeId: start.id, toNodeId: battleA.id, oneWay: false },
      { id: idFactory("route"), fromNodeId: start.id, toNodeId: battleB.id, oneWay: false },
      { id: idFactory("route"), fromNodeId: battleA.id, toNodeId: boss.id, oneWay: false },
      { id: idFactory("route"), fromNodeId: battleB.id, toNodeId: boss.id, oneWay: false }
    ];
  }
  return floor;
}

function uniqueNodeId(value: string, existing: string[], fallback: string): string {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = base + "-" + suffix++;
  return candidate;
}

export type CampaignNodeAddResult = { ok: true; node: CampaignNode } | { ok: false; message: string };

export function addCampaignNode(floor: CampaignFloor, kind: AdventureNodeKind, x: number, y: number): CampaignNodeAddResult {
  if (floor.mode === "random") return { ok: false, message: "Random floors do not contain authored nodes." };
  if (kind === "Start" && floor.nodes.some(node => node.kind === "Start")) return { ok: false, message: "This floor already has a Start node." };
  if (kind === "Boss" && floor.nodes.some(node => node.kind === "Boss")) return { ok: false, message: "This floor already has a Boss node." };
  if (kind === "Start") { x = 0; y = 0; }
  if (floor.nodes.some(node => node.x === x && node.y === y)) {
    return { ok: false, message: kind === "Start" ? "Move the node at (0, 0) first; Start must use that position." : "That map coordinate is occupied." };
  }
  const number = floor.nodes.filter(node => node.kind === kind).length + 1;
  const ids = floor.nodes.map(node => node.id);
  const id = kind === "Start" ? "start" : kind === "Boss" ? "f" + floor.number + "-boss" : uniqueNodeId(kind.toLowerCase() + "-" + number, ids, kind.toLowerCase());
  const node: CampaignNode = {
    id,
    label: kind === "Start" ? "Start" : kind === "Boss" ? "Boss" : kind + " " + number,
    kind, x, y, armyId: "", questId: "", enemyFactionId: "",
    rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: []
  };
  floor.nodes.push(node);
  return { ok: true, node };
}

export function moveCampaignNode(floor: CampaignFloor, nodeId: string, x: number, y: number): string | null {
  const node = floor.nodes.find(item => item.id === nodeId);
  if (!node) return "Campaign node was not found.";
  if (Math.abs(x) > 30 || Math.abs(y) > 30) return "Place nodes within 30 map steps of the Start.";
  if (floor.nodes.some(item => item.id !== nodeId && item.x === x && item.y === y)) return "That map coordinate is occupied.";
  if (node.kind === "Start" && (x !== 0 || y !== 0)) return "Start stays at the game map origin (0, 0).";
  node.x = x;
  node.y = y;
  return null;
}

export type CampaignRouteResult = "added" | "exists" | "same-node" | "not-neighbors";

export function connectCampaignNodes(floor: CampaignFloor, from: string, to: string, oneWay: boolean, idFactory: IdFactory = createKey): CampaignRouteResult {
  if (from === to) return "same-node";
  const fromNode = floor.nodes.find(node => node.id === from);
  const toNode = floor.nodes.find(node => node.id === to);
  if (!fromNode || !toNode || Math.max(Math.abs(fromNode.x - toNode.x), Math.abs(fromNode.y - toNode.y)) !== 1) return "not-neighbors";
  const exists = floor.routes.some(route => route.oneWay === oneWay && (oneWay
    ? route.fromNodeId === from && route.toNodeId === to
    : [route.fromNodeId, route.toNodeId].sort().join("|") === [from, to].sort().join("|")));
  if (exists) return "exists";
  floor.routes.push({ id: idFactory("route"), fromNodeId: from, toNodeId: to, oneWay });
  return "added";
}

export function removeCampaignNode(floor: CampaignFloor, nodeId: string): boolean {
  const oldLength = floor.nodes.length;
  floor.nodes = floor.nodes.filter(node => node.id !== nodeId);
  if (floor.nodes.length === oldLength) return false;
  floor.routes = floor.routes.filter(route => route.fromNodeId !== nodeId && route.toNodeId !== nodeId);
  return true;
}

export function removeCampaignFloor(campaign: CampaignRecord, floorId: string): boolean {
  if (campaign.floors.length <= 1 || !campaign.floors.some(floor => floor.id === floorId)) return false;
  campaign.floors = campaign.floors.filter(floor => floor.id !== floorId);
  campaign.floors.forEach((floor, index) => {
    const previousNumber = floor.number;
    floor.number = index + 1;
    const boss = floor.nodes.find(node => node.kind === "Boss");
    if (!boss || boss.id !== "f" + previousNumber + "-boss") return;
    const oldId = boss.id;
    boss.id = "f" + floor.number + "-boss";
    for (const route of floor.routes) {
      if (route.fromNodeId === oldId) route.fromNodeId = boss.id;
      if (route.toNodeId === oldId) route.toNodeId = boss.id;
    }
  });
  return true;
}
