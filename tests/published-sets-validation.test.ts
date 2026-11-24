import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";
import { validateContentSet } from "../src/content/validation";
import { localized, namedRef } from "../src/content/factory";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;

describe("published-set validation rules", () => {
  it("does not flag a quest and its offer dialogue for sharing an id", () => {
    const set: ContentSetDocument = {
      schemaVersion: 2,
      set: { schemaVersion: 2, setId: "unit-missions", name: localized("Unit Missions"),
        description: localized(""), displayOrder: 0, kind: "missions", missionOrder: [] },
      quests: [{ schemaVersion: 2, id: "fighter-introduction", title: localized("Intro"), description: localized(""), meowEdit: {
        schemaVersion: 2, dialogueLinks: { offer: [namedRef("fighter-introduction")], active: [], completion: [], failure: [] },
        logicKind: "standard", timer: { decisionId: namedRef("none"), payOutcomeId: namedRef("none"), waitOutcomeId: namedRef("none"),
          counterId: namedRef("none"), counterTarget: 1, counterLabel: localized(""), countEvent: "battle-won",
          paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: [] },
        completionEffects: [], fetchItems: [], battleTargets: [],
        killCount: { targetKind: "unit", targetId: namedRef(caps.ids.units[0]), count: 1 }, minimumNodeDistances: []
      } }],
      armies: [], missions: [],
      dialogues: [{ schemaVersion: 2, sequenceId: "fighter-introduction", startNodeId: "opening", pauseMode: "pause",
        defaultCharactersPerSecond: 30, nodes: [{ id: "opening", headline: localized("Elder"), textSpeed: 30,
          speakers: [], segments: [], actions: [] }] }]
    };
    const issues = validateContentSet(set, caps).issues;
    expect(issues.map(issue => issue.message)).toEqual([]);
  });

  it("accepts level-2 unit ids from the army catalog but still rejects unknown ids", () => {
    const draft: ContentSetDocument = {
      schemaVersion: 2,
      set: { schemaVersion: 2, setId: "unit-missions", name: localized("Unit Missions"),
        description: localized(""), displayOrder: 0, kind: "missions", missionOrder: [] },
      quests: [], missions: [],
      armies: [{ schemaVersion: 2, id: "guarded", name: localized("Guarded Formation"),
        units: [{ unitId: namedRef("Peasants/Tomeowto Thrower/2"), x: 0, y: 0, spellIds: [] }],
        spellIds: [], blessingIds: [], CellBlessingPicks: [] } as never],
      dialogues: [{ schemaVersion: 2, sequenceId: "fighter-training", startNodeId: "opening", pauseMode: "pause",
        defaultCharactersPerSecond: 30, nodes: [{ id: "opening", headline: localized("Fighter"), textSpeed: 30,
          speakers: [{ id: "fighter", unitId: namedRef("Peasants/Fighter/2"), displayName: localized("Fighter"), side: "left", mood: "Normal" }],
          segments: [{ speakerIds: ["fighter"], text: localized("Ready.") }], actions: [] }] }]
    };
    const unresolved = validateContentSet(draft, caps).issues.filter(issue => issue.code === "unresolved-reference");
    expect(unresolved.map(issue => issue.message)).toEqual([]);

    draft.dialogues[0].nodes[0].speakers[0].unitId = namedRef("Peasants/Fighter/9");
    const broken = validateContentSet(draft, caps).issues.filter(issue => issue.code === "unresolved-reference");
    expect(broken.some(issue => issue.message.includes("Peasants/Fighter/9"))).toBe(true);
  });

  it("does not require a dialogue headline when a speaker supplies it", () => {
    const set: ContentSetDocument = {
      schemaVersion: 2,
      set: { schemaVersion: 2, setId: "tutorial-dialogues", name: localized("Tutorial"), description: localized(""),
        displayOrder: 0, kind: "missions", missionOrder: [] },
      quests: [], armies: [], missions: [],
      dialogues: [{ schemaVersion: 2, sequenceId: "tutorial", startNodeId: "greeting", pauseMode: "pause",
        defaultCharactersPerSecond: 30, nodes: [{ id: "greeting", headline: localized(""), textSpeed: 30,
          speakers: [{ id: "elder", unitId: namedRef(caps.ids.units[0]), displayName: localized("Village Elder"),
            side: "left", mood: "Normal" }], segments: [], actions: [] }] }]
    };
    expect(validateContentSet(set, caps).issues.map(issue => issue.message)).toEqual([]);
  });

  it("still flags duplicate dialogue records within the dialogues section", () => {
    const set: ContentSetDocument = {
      schemaVersion: 2,
      set: { schemaVersion: 2, setId: "dups", name: localized("Dups"), description: localized(""), displayOrder: 0, kind: "missions", missionOrder: [] },
      quests: [], armies: [], missions: [],
      dialogues: [0, 1].map(() => ({ schemaVersion: 2 as const, sequenceId: "same", startNodeId: "n", pauseMode: "pause",
        defaultCharactersPerSecond: 30, nodes: [{ id: "n", headline: localized("H"), textSpeed: 30,
          speakers: [], segments: [], actions: [] }] }))
    };
    expect(validateContentSet(set, caps).issues.some(issue => issue.code === "duplicate-id")).toBe(true);
  });
});
