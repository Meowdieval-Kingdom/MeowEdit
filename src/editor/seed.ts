import type { Workspace } from "./model";

/** A fresh workspace starts empty; content is authored locally per set. */
export function createSeedWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    dialogues: [],
    quests: [],
    armies: [],
    campaigns: [],
    selectedType: null,
    selectedKey: null,
    activeNodeId: null
  };
}
