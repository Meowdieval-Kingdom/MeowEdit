import type { Workspace } from "./model";

/** A fresh workspace starts empty. Game content is opt-in through Import examples. */
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
