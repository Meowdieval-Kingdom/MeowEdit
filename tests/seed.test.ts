import { describe, expect, it } from "vitest";
import { createSeedWorkspace } from "../src/legacy/seed";

describe("new workspace seed", () => {
  it("starts clean with no imported game content", () => {
    expect(createSeedWorkspace()).toEqual({ schemaVersion: 1, dialogues: [], quests: [], armies: [], campaigns: [], selectedType: null, selectedKey: null, activeNodeId: null });
  });
});
