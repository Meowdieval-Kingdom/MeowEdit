import { describe, expect, it } from "vitest";
import { addCampaignNode, connectCampaignNodes, createCampaignFloor, moveCampaignNode, removeCampaignFloor, removeCampaignNode } from "../src/legacy/campaign-domain";
import { campaignFixture } from "./fixtures";

describe("campaign board operations", () => {
  it("creates authored and random floors with the expected starter content", () => {
    const authored = createCampaignFloor(2, "authored", prefix => prefix + "-test");
    expect(authored.nodes.map(node => node.kind)).toEqual(["Start", "Battle", "Battle", "Boss"]);
    expect(authored.routes).toHaveLength(4);
    expect(authored.id).toBe("floor-test");
    const random = createCampaignFloor(3, "random", prefix => prefix + "-test");
    expect(random.nodes).toEqual([]);
    expect(random.routes).toEqual([]);
  });

  it("adds correctly named nodes and enforces unique Start, Boss, and coordinates", () => {
    const floor = createCampaignFloor(1, "random", prefix => prefix + "-test");
    floor.mode = "authored";
    const start = addCampaignNode(floor, "Start", 4, 4);
    expect(start).toMatchObject({ ok: true, node: { id: "start", x: 0, y: 0 } });
    expect(addCampaignNode(floor, "Start", 2, 2)).toMatchObject({ ok: false, message: expect.stringContaining("already has a Start") });
    expect(addCampaignNode(floor, "Battle", 1, 0)).toMatchObject({ ok: true, node: { id: "battle-1", label: "Battle 1" } });
    expect(addCampaignNode(floor, "Battle", 1, 0)).toMatchObject({ ok: false, message: "That map coordinate is occupied." });
    expect(addCampaignNode(floor, "Boss", 0, 1)).toMatchObject({ ok: true, node: { id: "f1-boss" } });
    expect(addCampaignNode(floor, "Boss", 2, 2)).toMatchObject({ ok: false, message: expect.stringContaining("already has a Boss") });
    floor.mode = "random";
    expect(addCampaignNode(floor, "Shop", 2, 2).ok).toBe(false);
  });

  it("avoids IDs already present on imported nodes and protects the Start cell", () => {
    const floor = createCampaignFloor(1, "random", prefix => prefix + "-test");
    floor.mode = "authored";
    floor.nodes.push({ id: "imported-start", label: "Old node", kind: "Reward", x: 0, y: 0, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] });
    expect(addCampaignNode(floor, "Start", 2, 2)).toMatchObject({ ok: false, message: "Move the node at (0, 0) first; Start must use that position." });
    floor.nodes.push({ id: "battle-1", label: "Imported", kind: "Reward", x: 2, y: 0, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] });
    expect(addCampaignNode(floor, "Battle", 1, 0)).toMatchObject({ ok: true, node: { id: "battle-1-2" } });
  });

  it("moves nodes while enforcing map bounds, occupancy, and the fixed Start position", () => {
    const floor = createCampaignFloor(1, "authored", prefix => prefix + "-test");
    expect(moveCampaignNode(floor, "missing", 0, 0)).toContain("not found");
    expect(moveCampaignNode(floor, "battle-a-1", 31, 0)).toContain("30 map steps");
    expect(moveCampaignNode(floor, "battle-a-1", 1, 1)).toContain("occupied");
    expect(moveCampaignNode(floor, "start", 1, 0)).toContain("Start stays");
    expect(moveCampaignNode(floor, "battle-a-1", -2, 0)).toBeNull();
    expect(floor.nodes.find(node => node.id === "battle-a-1")?.x).toBe(-2);
  });

  it("connects neighboring nodes and avoids duplicate routes", () => {
    const floor = createCampaignFloor(1, "authored", prefix => prefix + "-route");
    expect(connectCampaignNodes(floor, "start", "start", false)).toBe("same-node");
    expect(connectCampaignNodes(floor, "start", "f1-boss", false)).toBe("not-neighbors");
    expect(connectCampaignNodes(floor, "start", "battle-a-1", false)).toBe("exists");
    expect(connectCampaignNodes(floor, "battle-a-1", "start", false)).toBe("exists");
    expect(connectCampaignNodes(floor, "battle-a-1", "start", true, prefix => prefix + "-route")).toBe("added");
    expect(connectCampaignNodes(floor, "battle-a-1", "start", true, prefix => prefix + "-route")).toBe("exists");
    expect(floor.routes.at(-1)).toMatchObject({ id: "route-route", oneWay: true });
  });

  it("removes nodes with their routes and renumbers floors without breaking boss links", () => {
    const floor = createCampaignFloor(1, "authored", prefix => prefix + "-test");
    expect(removeCampaignNode(floor, "absent")).toBe(false);
    expect(removeCampaignNode(floor, "battle-a-1")).toBe(true);
    expect(floor.nodes.some(node => node.id === "battle-a-1")).toBe(false);
    expect(floor.routes.some(route => route.fromNodeId === "battle-a-1" || route.toNodeId === "battle-a-1")).toBe(false);

    const campaign = campaignFixture();
    const second = createCampaignFloor(2, "authored", prefix => prefix + "-2");
    const randomThird = createCampaignFloor(3, "random", prefix => prefix + "-3");
    campaign.floors.push(second, randomThird);
    expect(removeCampaignFloor(campaign, "missing")).toBe(false);
    expect(removeCampaignFloor(campaign, campaign.floors[0].id)).toBe(true);
    expect(campaign.floors).toHaveLength(2);
    expect(campaign.floors[0].number).toBe(1);
    expect(campaign.floors[0].nodes.find(node => node.kind === "Boss")?.id).toBe("f1-boss");
    expect(campaign.floors[0].routes.every(route => route.fromNodeId !== "f2-boss" && route.toNodeId !== "f2-boss")).toBe(true);
    expect(campaign.floors[1].number).toBe(2);
    expect(removeCampaignFloor(campaign, randomThird.id)).toBe(true);
    expect(removeCampaignFloor(campaign, second.id)).toBe(false);
  });
});
