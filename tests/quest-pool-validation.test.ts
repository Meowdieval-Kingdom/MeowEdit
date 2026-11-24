import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";
import { validateContentSet } from "../src/content/validation";
import { localized, namedRef } from "../src/content/factory";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;

const SENTINELS = ["none", "choice", "NONE", "Choice"];

function questPoolSet(): ContentSetDocument {
  return {
    schemaVersion: 2,
    set: { schemaVersion: 2, setId: "adventure-default-questpool", name: localized("Adventure Default Quest Pool"),
      description: localized(""), displayOrder: 0, kind: "missions", missionOrder: [] },
    quests: [
      { schemaVersion: 2, id: "fetch-sealed-letter", title: localized("The Sealed Letter"), description: localized(""),
        objectiveKind: "Fetch", itemId: namedRef("sealed-letter"), speakerUnitId: namedRef("Peasants/Village Elder/1"),
        rewardKind: "Sardines", rewardAmount: 10, meowEdit: {
          schemaVersion: 2, dialogueLinks: { offer: [], active: [], completion: [], failure: [] },
          logicKind: "standard", timer: {
            decisionId: namedRef("decision"), payOutcomeId: namedRef("pay"), waitOutcomeId: namedRef("wait"),
            counterId: namedRef("counter"), counterTarget: 1, counterLabel: localized(""), countEvent: "battle-won",
            paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: []
          }, completionEffects: [], fetchItems: [], battleTargets: [],
          killCount: { targetKind: "unit", targetId: namedRef("Peasants/Fighter/1"), count: 1 }, minimumNodeDistances: []
        } },
      { schemaVersion: 2, id: "floor-blessing-letter", title: localized("A Blessing for the Floor"), description: localized(""),
        objectiveKind: "ClearFloor", itemId: namedRef("blessing-letter"), rewardKind: "Blessing", rewardAmount: 1,
        rewardContentId: namedRef("choice"), meowEdit: {
          schemaVersion: 2, dialogueLinks: { offer: [], active: [], completion: [], failure: [] },
          logicKind: "standard", timer: {
            decisionId: namedRef("decision"), payOutcomeId: namedRef("pay"), waitOutcomeId: namedRef("wait"),
            counterId: namedRef("counter"), counterTarget: 1, counterLabel: localized(""), countEvent: "battle-won",
            paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: []
          }, completionEffects: [], fetchItems: [], battleTargets: [],
          killCount: { targetKind: "unit", targetId: namedRef("Peasants/Fighter/1"), count: 1 }, minimumNodeDistances: []
        } }
    ],
    armies: [], missions: [], dialogues: []
  };
}

describe("data-only quest pool validation", () => {
  it("accepts authored fetch item IDs, the choice reward sentinel and a quest-only set", () => {
    const result = validateContentSet(questPoolSet(), caps);
    expect(result.issues.map(issue => issue.message)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still flags genuinely unresolved catalog and local references", () => {
    const draft = questPoolSet();
    draft.quests[0].speakerUnitId = namedRef("no-such-unit");
    const result = validateContentSet(draft, caps);
    expect(result.issues.some(issue => issue.code === "unresolved-reference"
      && issue.message.includes("Speaker unit"))).toBe(true);
  });

  it("treats runtime sentinels as non-references everywhere", () => {
    for (const sentinel of SENTINELS) {
      const draft = questPoolSet();
      draft.quests[0].meowEdit.timer.decisionId = namedRef(sentinel);
      const result = validateContentSet(draft, caps);
      expect(result.issues.some(issue => issue.code === "unresolved-reference"
        && issue.message.includes(sentinel))).toBe(false);
    }
  });

  it("still flags an actually empty set", () => {
    const draft = questPoolSet();
    draft.quests = [];
    expect(validateContentSet(draft, caps).issues.some(issue => issue.code === "empty-set")).toBe(true);
  });
});
