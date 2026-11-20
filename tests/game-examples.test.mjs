import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPackageEntries } from "../src/export";
import { normalizeArmy, normalizeCampaign, normalizeQuest } from "../src/import-normalizers";
import { validateWorkspace } from "../src/validation";

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

describe("bundled Meowdieval Kingdom examples", () => {
  it("normalize and validate the full playable content example", () => {
    const example = readJson("../public/game-examples.json");
    const catalog = readJson("../public/army-catalog.json");
    const dialogues = example.dialogues.map(sequence => ({
      key: sequence.sequenceId,
      sequence: {
        ...sequence,
        nodes: (sequence.nodes ?? []).map(node => ({
          ...node,
          speakers: node.speakers ?? [],
          segments: node.segments ?? [],
          actions: (node.actions ?? []).map(action => ({
            ...action,
            ...(action.meowEdit?.decision ? { decision: action.meowEdit.decision } : {})
          }))
        }))
      }
    }));
    const workspace = {
      schemaVersion: 1,
      dialogues,
      quests: example.quests.map(quest => normalizeQuest(quest)),
      armies: example.armies.map(army => normalizeArmy(army)),
      campaigns: example.campaigns.map(campaign => normalizeCampaign(campaign)),
      selectedType: null,
      selectedKey: null,
      activeNodeId: null
    };

    const errors = validateWorkspace(workspace, catalog).filter(issue => issue.level === "error");
    expect(errors, errors.map(issue => issue.message).join("\n")).toEqual([]);

    const entries = createPackageEntries(workspace, catalog);
    const jsonEntries = entries.filter(entry => entry.path.endsWith(".json"));
    const byPath = new Map(jsonEntries.map(entry => [entry.path, JSON.parse(String(entry.content))]));
    const manifest = byPath.get("meowdieval-content/manifest.json");
    const questFile = byPath.get("meowdieval-content/quests/Definitions.json");
    const armyFile = byPath.get("meowdieval-content/armies/ArmyConfigurations.json");
    const campaignFile = byPath.get("meowdieval-content/campaigns/Campaigns.json");
    const extensionFile = byPath.get("meowdieval-content/extensions/meowedit-v1.json");

    expect(manifest).toMatchObject({
      format: "meowdieval-content-package",
      packageVersion: 1,
      campaignsIncluded: true,
      campaignRuntimeSupported: true
    });
    expect(manifest.files).toMatchObject({
      quests: "quests/Definitions.json",
      armies: "armies/ArmyConfigurations.json",
      campaigns: "campaigns/Campaigns.json",
      extensions: "extensions/meowedit-v1.json"
    });
    expect(manifest.files.dialogues).toHaveLength(example.dialogues.length);
    expect(questFile.quests.map(quest => quest.objectiveKind).sort()).toEqual([
      "Battle", "ClearFloor", "Escort", "Fetch", "KillCount", "Timer"
    ]);
    expect(armyFile.armies.map(army => army.id)).toEqual(["road-guards"]);
    expect(campaignFile.campaigns[0].floors.map(floor => floor.mode)).toEqual([
      "authored", "random", "mixed"
    ]);
    expect(extensionFile.quests.find(quest => quest.questId === "fetch-sealed-letter").fetchItems)
      .toMatchObject([{ count: 2 }, { count: 1 }]);
    expect(extensionFile.quests.find(quest => quest.questId === "battle-bounty").battleTargets)
      .toHaveLength(2);
    expect(extensionFile.dialogueDecisions.length).toBeGreaterThan(0);
    for (const dialoguePath of manifest.files.dialogues) {
      expect(byPath.get("meowdieval-content/" + dialoguePath)).toBeDefined();
    }

    expect(workspace.quests.map(quest => quest.definition.objectiveKind).sort()).toEqual([
      "Battle", "ClearFloor", "Escort", "Fetch", "KillCount", "Timer"
    ]);
    expect(workspace.armies).toHaveLength(1);
    expect(workspace.campaigns[0].floors.map(floor => floor.mode)).toEqual(["authored", "random", "mixed"]);
    expect(workspace.quests.find(quest => quest.definition.id === "fetch-sealed-letter").extension.fetchItems)
      .toMatchObject([{ count: 2 }, { count: 1 }]);
    expect(workspace.quests.find(quest => quest.definition.id === "battle-bounty").extension.battleTargets)
      .toHaveLength(2);
    expect(workspace.quests.find(quest => quest.definition.id === "bridge-repair-project").extension.timer.completionEffects)
      .toHaveLength(3);
  });
});
