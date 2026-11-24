import { describe, expect, it } from "vitest";
import { EditorNavigationHistory, type RelatedEditorReturnContext } from "../src/editor/editor-navigation";

const campaignContext: RelatedEditorReturnContext = {
  parentType: "campaign", parentKey: "campaign-1", floorId: "floor-2", nodeId: "battle-2",
  target: "quest-pool", includeQuestInPool: true, parentStep: 2, returnLabel: "Willow Road"
};
const questContext: RelatedEditorReturnContext = {
  parentType: "quest", parentKey: "quest-1", target: "army", battleTargetId: "battle-1",
  parentStep: 1, returnLabel: "Lost Supplies"
};

describe("editor navigation history", () => {
  it("returns through nested linked editors in order", () => {
    const history = new EditorNavigationHistory();
    history.enter(campaignContext);
    history.enter(questContext);

    expect(history.current()).toBe(questContext);
    expect(history.returnToParent()).toBe(questContext);
    expect(history.current()).toBe(campaignContext);
    expect(history.returnToParent()).toBe(campaignContext);
    expect(history.current()).toBeNull();
  });

  it("clears stale parents when a new independent editor opens", () => {
    const history = new EditorNavigationHistory();
    history.enter(campaignContext);
    history.enter(null);

    expect(history.current()).toBeNull();
    expect(history.returnToParent()).toBeNull();
  });
});
