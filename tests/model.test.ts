import { describe, expect, it } from "vitest";
import { dialogueActionsForNode, dialogueMomentName, emptyQuestExtension, emptyTimerLogic, slugify } from "../src/legacy/model";
import { dialogueFixture } from "./fixtures";

describe("shared content model helpers", () => {
  it("generates a default Continue route when a moment has no explicit actions", () => {
    const record = dialogueFixture();
    expect(dialogueActionsForNode(record.sequence, record.sequence.nodes[0])).toEqual([{ label: "Continue", targetNodeId: "" }]);
    record.sequence.nodes[0].continueLabel = "Next";
    record.sequence.nodes.push({ ...record.sequence.nodes[0], id: "second", headline: "Second" });
    expect(dialogueActionsForNode(record.sequence, record.sequence.nodes[0])).toEqual([{ label: "Next", targetNodeId: "second" }]);
  });

  it("uses semantic moment defaults while preserving optional custom labels", () => {
    const record = dialogueFixture();
    record.sequence.nodes.push({ ...record.sequence.nodes[0], id: "second", headline: "Second", editorLabel: "  Arrival  " });
    expect(dialogueMomentName(record.sequence, record.sequence.nodes[0])).toBe("Moment 1");
    expect(dialogueMomentName(record.sequence, record.sequence.nodes[1])).toBe("Arrival");
    expect(dialogueMomentName(record.sequence, { ...record.sequence.nodes[0], id: "missing" })).toBe("Moment 1");
  });

  it("provides fresh quest extension defaults and stable slugging", () => {
    const first = emptyQuestExtension();
    const second = emptyQuestExtension();
    first.fetchItems.push({ id: "one", displayName: "One", count: 1 });
    expect(second.fetchItems).toEqual([]);
    expect(emptyTimerLogic().counterTarget).toBe(3);
    expect(slugify("Élder's Great Quest!")).toBe("elder-s-great-quest");
  });
});
