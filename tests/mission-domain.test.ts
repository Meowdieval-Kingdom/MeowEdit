import { describe, expect, it } from "vitest";
import { addMissionNode, connectMissionNodes, createMissionFloor, moveMissionNode, removeMissionFloor, removeMissionNode } from "../src/editor/mission-domain";
import { missionFixture } from "./fixtures";

describe("mission board operations", () => {
  it("creates authored and random floors with the expected starter content", () => {
    const authored = createMissionFloor(2, "authored", prefix => prefix + "-test");
    expect(authored.nodes.map(node => node.kind)).toEqual(["Start", "Battle", "Battle", "Boss"]);
    expect(authored.routes).toHaveLength(4);
    expect(authored.id).toBe("floor-test");
    const random = createMissionFloor(3, "random", prefix => prefix + "-test");
    expect(random.nodes).toEqual([]);
    expect(random.routes).toEqual([]);
  });

  it("adds correctly named nodes and enforces unique Start, Boss, and coordinates", () => {
    const floor = createMissionFloor(1, "random", prefix => prefix + "-test");
    floor.mode = "authored";
    const start = addMissionNode(floor, "Start", 4, 4);
    expect(start).toMatchObject({ ok: true, node: { id: "start", x: 0, y: 0 } });
    expect(addMissionNode(floor, "Start", 2, 2)).toMatchObject({ ok: false, message: expect.stringContaining("already has a Start") });
    expect(addMissionNode(floor, "Battle", 1, 0)).toMatchObject({ ok: true, node: { id: "battle-1", label: "Battle 1" } });
    expect(addMissionNode(floor, "Battle", 1, 0)).toMatchObject({ ok: false, message: "That map coordinate is occupied." });
    expect(addMissionNode(floor, "Boss", 0, 1)).toMatchObject({ ok: true, node: { id: "f1-boss" } });
    expect(addMissionNode(floor, "Boss", 2, 2)).toMatchObject({ ok: false, message: expect.stringContaining("already has a Boss") });
    floor.mode = "random";
    expect(addMissionNode(floor, "Shop", 2, 2).ok).toBe(false);
  });

  it("avoids IDs already present on imported nodes and protects the Start cell", () => {
    const floor = createMissionFloor(1, "random", prefix => prefix + "-test");
    floor.mode = "authored";
    floor.nodes.push({ id: "imported-start", label: "Old node", kind: "Reward", x: 0, y: 0, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] });
    expect(addMissionNode(floor, "Start", 2, 2)).toMatchObject({ ok: false, message: "Move the node at (0, 0) first; Start must use that position." });
    floor.nodes.push({ id: "battle-1", label: "Imported", kind: "Reward", x: 2, y: 0, armyId: "", questId: "", enemyFactionId: "", rewardKind: "Sardines", rewardAmount: 10, rewardContentId: "", shopOfferMode: "generated", shopOffers: [] });
    expect(addMissionNode(floor, "Battle", 1, 0)).toMatchObject({ ok: true, node: { id: "battle-1-2" } });
  });

  it("moves nodes while enforcing map bounds, occupancy, and the fixed Start position", () => {
    const floor = createMissionFloor(1, "authored", prefix => prefix + "-test");
    expect(moveMissionNode(floor, "missing", 0, 0)).toContain("not found");
    expect(moveMissionNode(floor, "battle-a-1", 31, 0)).toContain("30 map steps");
    expect(moveMissionNode(floor, "battle-a-1", 1, 1)).toContain("occupied");
    expect(moveMissionNode(floor, "start", 1, 0)).toContain("Start stays");
    expect(moveMissionNode(floor, "battle-a-1", -2, 0)).toContain("stretch a route");
    expect(moveMissionNode(floor, "battle-a-1", 0, 1)).toBeNull();
    expect(floor.nodes.find(node => node.id === "battle-a-1")?.y).toBe(1);
  });

  it("connects neighboring nodes and avoids duplicate routes", () => {
    const floor = createMissionFloor(1, "authored", prefix => prefix + "-route");
    expect(connectMissionNodes(floor, "start", "start", false)).toBe("same-node");
    expect(connectMissionNodes(floor, "start", "f1-boss", false)).toBe("not-neighbors");
    expect(connectMissionNodes(floor, "start", "battle-a-1", false)).toBe("exists");
    expect(connectMissionNodes(floor, "battle-a-1", "start", false)).toBe("exists");
    expect(connectMissionNodes(floor, "battle-a-1", "start", true, prefix => prefix + "-route")).toBe("added");
    expect(connectMissionNodes(floor, "battle-a-1", "start", true, prefix => prefix + "-route")).toBe("exists");
    expect(floor.routes.at(-1)).toMatchObject({ id: "route-route", oneWay: true });
  });

  it("removes nodes with their routes and renumbers floors without breaking boss links", () => {
    const floor = createMissionFloor(1, "authored", prefix => prefix + "-test");
    expect(removeMissionNode(floor, "absent")).toBe(false);
    expect(removeMissionNode(floor, "battle-a-1")).toBe(true);
    expect(floor.nodes.some(node => node.id === "battle-a-1")).toBe(false);
    expect(floor.routes.some(route => route.fromNodeId === "battle-a-1" || route.toNodeId === "battle-a-1")).toBe(false);

    const mission = missionFixture();
    const second = createMissionFloor(2, "authored", prefix => prefix + "-2");
    const randomThird = createMissionFloor(3, "random", prefix => prefix + "-3");
    mission.floors.push(second, randomThird);
    expect(removeMissionFloor(mission, "missing")).toBe(false);
    expect(removeMissionFloor(mission, mission.floors[0].id)).toBe(true);
    expect(mission.floors).toHaveLength(2);
    expect(mission.floors[0].number).toBe(1);
    expect(mission.floors[0].nodes.find(node => node.kind === "Boss")?.id).toBe("f1-boss");
    expect(mission.floors[0].routes.every(route => route.fromNodeId !== "f2-boss" && route.toNodeId !== "f2-boss")).toBe(true);
    expect(mission.floors[1].number).toBe(2);
    expect(removeMissionFloor(mission, randomThird.id)).toBe(true);
    expect(removeMissionFloor(mission, second.id)).toBe(false);
  });
});
