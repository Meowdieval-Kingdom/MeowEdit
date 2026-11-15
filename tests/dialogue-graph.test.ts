import { describe, expect, it } from "vitest";
import { compactDialogueGraph } from "../src/dialogue-graph";
import { dialogueFixture } from "./fixtures";

describe("dialogue graph arrangement", () => {
  it("lays out connected moments in sequence and keeps explicit branches visible", () => {
    const record = dialogueFixture();
    record.sequence.nodes.push(
      { ...record.sequence.nodes[0], id: "left", headline: "Left", actions: [] },
      { ...record.sequence.nodes[0], id: "right", headline: "Right", actions: [] },
      { ...record.sequence.nodes[0], id: "end", headline: "End", actions: [] }
    );
    record.sequence.nodes[0].actions = [
      { label: "Left", targetNodeId: "left" },
      { label: "Right", targetNodeId: "right" }
    ];
    record.sequence.nodes[1].actions = [{ label: "Continue", targetNodeId: "end" }];
    record.sequence.nodes[2].actions = [{ label: "Continue", targetNodeId: "end" }];
    compactDialogueGraph(record, 1200);
    const [opening, left, right, end] = record.sequence.nodes;
    expect(opening.editorPosition).toMatchObject({ x: 40, y: 48 });
    expect(left.editorPosition?.x).toBeGreaterThan(opening.editorPosition!.x);
    expect(right.editorPosition?.y).toBeGreaterThan(left.editorPosition!.y);
    expect(end.editorPosition?.x).toBeGreaterThan(left.editorPosition!.x);
  });

  it("clears manually placed positions before compacting unreachable moments", () => {
    const record = dialogueFixture();
    record.sequence.nodes.push({ ...record.sequence.nodes[0], id: "unreachable", headline: "Unreachable", editorPosition: { x: 999, y: 999 } });
    compactDialogueGraph(record, 1200);
    expect(record.sequence.nodes[1].editorPosition).not.toEqual({ x: 999, y: 999 });
  });
});
