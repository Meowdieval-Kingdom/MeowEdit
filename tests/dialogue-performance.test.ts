import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";
import { draftToWorkspace, workspaceToDraft } from "../src/editor/convert";
import { parseDialogueTags, validateDialogueTags, validatePerformanceFields } from "../src/editor/performance";
import { renderApp } from "../src/editor/view";
import { validateDialogue } from "../src/editor/validation";
import { catalog, dialogueFixture, rosterFixture, workspaceFixture } from "./fixtures";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;

describe("dialogue performance", () => {
  it("strips inline tags and keeps their clean-text reveal positions", () => {
    const result = parseDialogueTags("Hello [face=Cute] there [anim=Win] friend [speed=45].");
    expect(result.clean).toBe("Hello  there  friend .");
    expect(result.tags.map(tag => [tag.kind, tag.value, tag.index])).toEqual([
      ["face", "Cute", 6],
      ["anim", "Win", 13],
      ["speed", "45", 21]
    ]);
  });

  it("validates tag names against the Kingdom animation catalog and face enum", () => {
    expect(validateDialogueTags("[anim=Win][idleanim=IdleVariant2][face=Mad][speed=fast]")).toEqual([]);
    expect(validateDialogueTags("[anim=celebrate1]")).toEqual([
      'Unknown animation "celebrate1". Use Attack, Ability, Win.'
    ]);
    expect(validateDialogueTags("[face=happy]")).toEqual([
      'Unknown face "happy". Use Normal, Cute, Sleeping, Hurt, Confused, Mad.'
    ]);
    expect(validatePerformanceFields({ anim: "Nope", idleAnim: "Nope", face: "Nope" })).toHaveLength(3);
  });

  it("reports invalid performance tags through dialogue validation", () => {
    const record = dialogueFixture();
    record.sequence.nodes[0].segments[0].text = "Hi [anim=Unknown].";
    const messages = validateDialogue(record).map(issue => issue.message);
    expect(messages.some(message => message.includes("Unknown animation"))).toBe(true);
  });

  it("round-trips per-speaker and per-line performance through the cloud boundary", () => {
    const draft = structuredClone(fixture);
    const node = draft.dialogues[0].nodes[0];
    node.speakers[0].defaultSpeed = { preset: "fast" };
    node.speakers[0].defaultFace = "Cute";
    node.speakers[0].defaultIdleAnim = "IdleVariant1";
    node.segments[0] = {
      ...node.segments[0],
      speed: { charactersPerSecond: 45 },
      face: "Mad",
      anim: "Win",
      idleAnim: "Walk"
    };
    draft.quests[0].speakerSpeed = { preset: "slow" };
    draft.quests[0].speakerFace = "Sleeping";
    draft.quests[0].speakerIdleAnim = "Idle";

    const workspace = draftToWorkspace(draft, caps);
    const target = structuredClone(fixture);
    workspaceToDraft(target, workspace, caps);

    const outNode = target.dialogues[0].nodes[0];
    expect(outNode.speakers[0].defaultSpeed).toEqual({ preset: "fast" });
    expect(outNode.speakers[0].defaultFace).toBe("Cute");
    expect(outNode.speakers[0].defaultIdleAnim).toBe("IdleVariant1");
    expect(outNode.segments[0].speed).toEqual({ charactersPerSecond: 45 });
    expect(outNode.segments[0].face).toBe("Mad");
    expect(outNode.segments[0].anim).toBe("Win");
    expect(outNode.segments[0].idleAnim).toBe("Walk");
    expect(target.quests[0].speakerSpeed).toEqual({ preset: "slow" });
    expect(target.quests[0].speakerFace).toBe("Sleeping");
    expect(target.quests[0].speakerIdleAnim).toBe("Idle");
  });

  it("exposes narrator and line performance controls in the advanced editor", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "dialogue";
    workspace.selectedKey = workspace.dialogues[0].key;
    const node = workspace.dialogues[0].sequence.nodes[0];
    node.speakers = [{ id: "elder", unitId: "", displayName: "Elder", side: "left", mood: "Normal" }];
    node.segments[0].speakerIds = ["elder"];
    const html = renderApp(workspace, rosterFixture, catalog, [], 0, "full");
    expect(html).toContain('data-bind="nodes.0.speakers.0.defaultSpeed.preset"');
    expect(html).toContain('data-bind="nodes.0.speakers.0.defaultIdleAnim"');
    expect(html).toContain('data-bind="nodes.0.segments.0.anim"');
    expect(html).toContain("[anim=Win]");
  });
});
