import { describe, expect, it } from "vitest";
import { activeArmyJson, activeCampaignJson, activeDialogueJson, activeQuestJson, createPackageEntries, decodeZipText, parseImportedJson, suggestedFilename, toZipFileBytes, workspaceJson, workspacePackage } from "../src/export";
import { createStoredZip, readStoredZip } from "../src/zip";
import { armyFixture, campaignFixture, dialogueFixture, questFixture, rosterFixture, workspaceFixture } from "./fixtures";

describe("content export and ZIP packages", () => {
  it("exports unit spell assignments in the standalone army document", () => {
    const army = armyFixture();
    army.units[0].spellIds = ["fireball"];
    army.blessingIds = ["picked-column"];
    army.cellBlessingPicks = [{ rootId: "lane-root", lane: 2, cells: [], locked: true, baneCells: [] }];
    const parsed = JSON.parse(activeArmyJson(army));
    expect(parsed.army.units[0]).toEqual({ unitId: "Cats/Fighter/1", x: 0, y: 0, spellIds: ["fireball"] });
    expect(parsed.army.CellBlessingPicks).toEqual([{ RootId: "lane-root", Lane: 2, Cells: [], Locked: true, BaneCells: [] }]);
  });

  it("preserves workspace-only army fields and emits campaign files", () => {
    const workspace = workspaceFixture();
    workspace.armies[0].units[0].spellIds = ["shield"];
    const parsed = JSON.parse(workspaceJson(workspace));
    expect(parsed.armies[0]._meowEditWorkspace.units[0].spellIds).toEqual(["shield"]);
    expect(parsed.armies[0].units[0].spellIds).toEqual(["shield"]);
    const entries = createPackageEntries(workspace, rosterFixture);
    expect(entries.map(entry => entry.path)).toContain("meowdieval-content/campaigns/Campaigns.json");
    const armyEntry = entries.find(entry => entry.path.endsWith("ArmyConfigurations.json"));
    expect(JSON.parse(String(armyEntry?.content)).armies[0].units[0].spellIds).toEqual(["shield"]);
    const manifest = JSON.parse(String(entries.find(entry => entry.path.endsWith("manifest.json"))?.content));
    expect(manifest.campaignRuntimeSupported).toBe(false);
  });

  it("round trips stored archives and reports unsupported or damaged ZIP data", async () => {
    const archive = createStoredZip([{ path: "folder\\hello.txt", content: "world" }, { path: "binary.bin", content: new Uint8Array([0, 1, 255]) }]);
    const files = readStoredZip(new Uint8Array(await archive.arrayBuffer()));
    expect(new TextDecoder().decode(files.get("folder/hello.txt"))).toBe("world");
    expect([...files.get("binary.bin") ?? []]).toEqual([0, 1, 255]);
    expect(() => readStoredZip(new Uint8Array([1, 2, 3, 4]))).toThrow("not a MeowEdit stored archive");
    expect(() => readStoredZip(new Uint8Array())).toThrow("No files were found");
  });

  it("covers JSON parsing and stable export filenames", () => {
    expect(parseImportedJson('{"ok":true}')).toEqual({ ok: true });
    expect(() => parseImportedJson("{")).toThrow();
    expect(suggestedFilename("army", "Test Army!!")).toBe("Test-Army.army.json");
    expect(suggestedFilename("campaign", "one floor")).toBe("one-floor.campaign.json");
  });

  it("serializes each standalone content type and the complete ZIP package", async () => {
    expect(JSON.parse(activeDialogueJson(dialogueFixture())).sequenceId).toBe("test-dialogue");
    expect(JSON.parse(activeQuestJson(questFixture())).quests[0].id).toBe("test-quest");
    expect(JSON.parse(activeCampaignJson(campaignFixture())).campaign.id).toBe("test-campaign");
    const packageBlob = workspacePackage(workspaceFixture(), rosterFixture);
    const zipFiles = readStoredZip(new Uint8Array(await packageBlob.arrayBuffer()));
    expect(zipFiles.has("meowdieval-content/manifest.json")).toBe(true);
    expect(zipFiles.has("meowdieval-content/dialogues/test-dialogue.json")).toBe(true);
  });

  it("exports saved dialogue decisions without inventing an empty campaign file", () => {
    const workspace = workspaceFixture();
    workspace.campaigns = [];
    workspace.dialogues[0].sequence.nodes[0].actions = [{
      label: "Repair it",
      targetNodeId: "opening",
      decision: { id: "bridge-plan", label: "Bridge plan", outcomeId: "repair", outcomeLabel: "Repair the bridge" }
    }];
    const entries = createPackageEntries(workspace, rosterFixture);
    const manifest = JSON.parse(String(entries.find(entry => entry.path.endsWith("manifest.json"))?.content));
    const extensions = JSON.parse(String(entries.find(entry => entry.path.endsWith("meowedit-v1.json"))?.content));

    expect(manifest.campaignsIncluded).toBe(false);
    expect(manifest.files).not.toHaveProperty("campaigns");
    expect(entries.some(entry => entry.path.endsWith("/campaigns/Campaigns.json"))).toBe(false);
    expect(extensions.dialogueDecisions).toEqual([{
      sequenceId: "test-dialogue",
      nodeId: "opening",
      actionIndex: 0,
      id: "bridge-plan",
      label: "Bridge plan",
      outcomeId: "repair",
      outcomeLabel: "Repair the bridge"
    }]);
  });

  it("decodes UTF-8 ZIP text and rejects compressed or truncated entries", async () => {
    expect(decodeZipText(toZipFileBytes("meow ✓"))).toBe("meow ✓");
    const source = new Uint8Array(await createStoredZip([{ path: "a", content: "x" }]).arrayBuffer());
    const compressed = source.slice();
    new DataView(compressed.buffer).setUint16(8, 8, true);
    expect(() => readStoredZip(compressed)).toThrow("Only uncompressed");
    expect(() => readStoredZip(source.slice(0, 31))).toThrow("incomplete");
  });
});
