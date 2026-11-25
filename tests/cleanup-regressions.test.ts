import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentSetDocument, GameCapabilities } from "../src/content/types";
import { validateContentSet } from "../src/content/validation";
import { draftToWorkspace, workspaceToDraft } from "../src/editor/convert";
import { renderApp } from "../src/editor/view";
import { catalog, dialogueFixture, workspaceFixture } from "./fixtures";

const caps = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "contract/content/fixtures/valid-set.fixture.json"), "utf8")) as ContentSetDocument;

describe("cleanup regressions", () => {
  it("keeps a draft valid after an editor round-trip", () => {
    expect(validateContentSet(fixture, caps).valid).toBe(true);
    const workspace = draftToWorkspace(fixture, caps);
    workspaceToDraft(fixture, workspace, caps);
    const result = validateContentSet(fixture, caps);
    expect(result.issues.map(issue => issue.message)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("escapes related-return labels from authored names", () => {
    const html = renderApp(workspaceFixture(), { schemaVersion: 1, rosterVersion: "test", source: "", units: [] },
      catalog, [], 0, "guided", null, undefined,
      { parent: "Mission", label: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("accepts curse references in cloud validation", () => {
    const draft = JSON.parse(JSON.stringify(fixture)) as ContentSetDocument;
    draft.quests = [];
    draft.dialogues = [];
    draft.missions = [];
    draft.set.missionOrder = [];
    draft.armies = [{
      schemaVersion: 2, id: "army", name: { default: "Army", locales: {} }, units: [],
      spellIds: [], blessingIds: [{ id: caps.ids.curses[0], label: { default: "Curse", locales: {} } }],
      CellBlessingPicks: []
    }];
    const issues = validateContentSet(draft, caps).issues;
    expect(issues.some(issue => issue.code === "unresolved-reference")).toBe(false);
  });

  it("preserves mission event conditions and oneShot through conversion", () => {
    const draft = JSON.parse(JSON.stringify(fixture)) as ContentSetDocument;
    const workspace = draftToWorkspace(draft, caps);
    workspaceToDraft(draft, workspace, caps);
    expect(draft.missions[0].events[0].conditions).toEqual(fixture.missions[0].events[0].conditions);
    expect(draft.missions[0].events[0].oneShot).toBe(fixture.missions[0].events[0].oneShot);
  });

  it("rejects unsafe dialogue IDs", () => {
    const draft = JSON.parse(JSON.stringify(fixture)) as ContentSetDocument;
    draft.dialogues[0].sequenceId = "../escape";
    const result = validateContentSet(draft, caps);
    expect(result.issues.some(issue => issue.code === "schema")).toBe(true);
  });

  it("previews multi-line moments one line at a time", () => {
    const record = dialogueFixture();
    record.sequence.nodes[0].segments = [
      { speakerIds: [], text: "First sentence." },
      { speakerIds: [], text: "Second sentence." }
    ];
    const workspace = workspaceFixture();
    workspace.dialogues = [record];
    workspace.activeNodeId = "opening";
    const html = renderApp({ ...workspace, selectedType: "dialogue", selectedKey: record.key },
      { schemaVersion: 1, rosterVersion: "test", source: "", units: [] }, catalog, [], 0, "full");
    const previewBody = html.match(/<p class="game-body">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(previewBody).toContain("First sentence.");
    expect(previewBody).not.toContain("Second sentence.");
    expect(html).toContain('data-action="preview-next-line"');
    expect(html).toContain("Line 1 of 2");
  });
});
