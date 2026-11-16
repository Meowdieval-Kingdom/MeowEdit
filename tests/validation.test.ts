import { describe, expect, it } from "vitest";
import { validateArmy, validateCampaign, validateDialogue, validateQuest, validateWorkspace } from "../src/validation";
import { armyFixture, campaignFixture, catalog, dialogueFixture, questFixture, workspaceFixture } from "./fixtures";

describe("content validation", () => {
  it("accepts catalog-backed army units and their individual spells", () => {
    const army = armyFixture();
    army.units[0].spellIds = ["fireball"];
    expect(validateArmy(army, catalog).filter(issue => issue.level === "error")).toEqual([]);
  });

  it("accepts building placements and validates their full footprint", () => {
    const army = armyFixture();
    army.units[0].x = 2;
    army.units.push({ id: "barricade-placement", unitId: "Cats/Barricade/1", x: 0, y: 0, spellIds: [] });
    expect(validateArmy(army, catalog).filter(issue => issue.level === "error")).toEqual([]);

    army.units[0].x = 1;
    expect(validateArmy(army, catalog).some(issue => issue.message === "Army unit and building footprints must not overlap.")).toBe(true);
    army.units[0].x = 2;
    army.units[1].x = 2;
    expect(validateArmy(army, catalog).some(issue => issue.message.includes("must fit within the 3 × 3 grid"))).toBe(true);
  });

  it("reports unit spell duplicates and unknown spells", () => {
    const army = armyFixture();
    army.units[0].spellIds = ["unknown", "unknown"];
    const messages = validateArmy(army, catalog).map(issue => issue.message);
    expect(messages).toContain("Spells assigned to each unit must not be duplicated.");
    expect(messages).toContain("Choose unit spells from the current game catalog.");
  });

  it("checks campaign floors and required starter graph structure", () => {
    const campaign = campaignFixture();
    expect(validateCampaign(campaign, workspaceFixture(), catalog).filter(issue => issue.level === "error")).toEqual([]);
    campaign.floors[0].routes = [];
    expect(validateCampaign(campaign, workspaceFixture(), catalog).some(issue => issue.message.includes("unreachable from Start"))).toBe(true);
  });

  it("validates exact campaign shop inventory against the game catalog and price rules", () => {
    const campaign = campaignFixture();
    const floor = campaign.floors[0];
    const shop = { ...floor.nodes[1], id: "market", label: "Market", kind: "Shop" as const, x: 2, y: 0,
      shopOfferMode: "exact" as const,
      shopOffers: [
        { kind: "Unit" as const, contentId: "Cats/Fighter/1", price: 15 },
        { kind: "Blessing" as const, contentId: "blessing", price: 9 },
        { kind: "SpellUnlock" as const, contentId: "fireball", price: 7 }
      ] };
    floor.nodes.push(shop);
    let messages = validateCampaign(campaign, workspaceFixture(), catalog).map(issue => issue.message);
    expect(messages.some(message => message.includes("exact shop") || message.includes("shop prices"))).toBe(false);

    shop.shopOffers[2].contentId = "missing-spell";
    shop.shopOffers[1].price = -1;
    shop.shopOffers.push({ kind: "Unit", contentId: "Cats/Fighter/2", price: 0 });
    floor.shopLevel = 5;
    messages = validateCampaign(campaign, workspaceFixture(), catalog).map(issue => issue.message);
    expect(messages.some(message => message.includes("exact shop “Market” needs exactly three offers"))).toBe(true);
    expect(messages.some(message => message.includes("unknown SpellUnlock item"))).toBe(true);
    expect(messages.some(message => message.includes("prices must be whole numbers"))).toBe(true);
    expect(messages.some(message => message.includes("shop tier must be a whole number from 1 to 4"))).toBe(true);
  });

  it("reports invalid dialogue targets and warns when a dialogue has no branch", () => {
    const dialogue = dialogueFixture();
    expect(validateDialogue(dialogue).some(issue => issue.level === "warning")).toBe(true);
    dialogue.sequence.nodes[0].actions = [{ label: "Continue", targetNodeId: "missing" }];
    expect(validateDialogue(dialogue).some(issue => issue.message.includes("missing node"))).toBe(true);
  });

  it("reports dialogue identity, speaker, text-speed, and decision errors", () => {
    const dialogue = dialogueFixture();
    dialogue.sequence.sequenceId = " ";
    dialogue.sequence.startNodeId = "missing-start";
    dialogue.sequence.defaultCharactersPerSecond = 0;
    const node = dialogue.sequence.nodes[0];
    node.id = "";
    node.speakers = [
      { id: "same", unitId: "Cats/Fighter/1", displayName: "A", side: "left", mood: "Normal" },
      { id: "same", unitId: "Cats/Fighter/1", displayName: "B", side: "left", mood: "Normal" },
      { id: "third", unitId: "Cats/Fighter/1", displayName: "C", side: "right", mood: "Normal" }
    ];
    node.segments = [{ speakerIds: ["missing-speaker"], text: "" }];
    node.actions = [{ label: "Broken decision", targetNodeId: "missing", decision: { id: " ", label: "Save", outcomeId: "", outcomeLabel: "" } }];

    const messages = validateDialogue(dialogue).map(issue => issue.message);
    expect(messages).toContain("Dialogue ID is required.");
    expect(messages).toContain("Every node needs an ID.");
    expect(messages).toContain("The start node must point to an existing node.");
    expect(messages).toContain("Text speed must be at least 1 character per second.");
    expect(messages).toContain("A dialogue node can use at most two avatar slots.");
    expect(messages).toContain("Use each avatar side only once in a node.");
    expect(messages).toContain("Speaker IDs must be unique within a node.");
    expect(messages).toContain("A text segment refers to a speaker that is not in this node.");
    expect(messages).toContain("A dialogue choice points to a missing node.");
    expect(messages).toContain("A saved decision needs both a decision ID and an outcome ID.");
    expect(messages).toContain("No branching choices yet. Add another choice to create a branch.");
  });

  it("validates battle targets and multiple fetch item extension entries", () => {
    const workspace = workspaceFixture();
    const quest = questFixture();
    expect(validateQuest(quest, workspace, catalog).filter(issue => issue.level === "error")).toEqual([]);
    quest.definition.objectiveKind = "Fetch";
    quest.extension.fetchItems = [
      { id: "herb", displayName: "Herb", count: 2 },
      { id: "ore", displayName: "Ore", count: 1 }
    ];
    const issues = validateQuest(quest, workspace, catalog);
    expect(issues.some(issue => issue.level === "warning" && issue.message.includes("one item ID"))).toBe(true);
  });

  it("covers quest-specific setup errors for each objective and timer progress", () => {
    const workspace = workspaceFixture();
    const quest = questFixture();
    quest.definition.objectiveKind = "Escort";
    expect(validateQuest(quest, workspace, catalog).some(issue => issue.message.includes("unit that needs escorting"))).toBe(true);
    quest.definition.objectiveKind = "Fetch";
    quest.definition.itemId = "";
    quest.extension.fetchItems = [];
    expect(validateQuest(quest, workspace, catalog).some(issue => issue.message.includes("at least one item"))).toBe(true);
    quest.definition.objectiveKind = "Battle";
    quest.extension.battleTargets = [];
    expect(validateQuest(quest, workspace, catalog).some(issue => issue.message.includes("battle target"))).toBe(true);
    quest.definition.objectiveKind = "KillCount";
    quest.extension.killCount = { targetKind: "unit", targetId: "missing", count: 0 };
    expect(validateQuest(quest, workspace, catalog).some(issue => issue.message.includes("target from the game unit catalog"))).toBe(true);
    quest.extension.logicKind = "timer-project";
    quest.extension.timer.decisionId = "";
    quest.extension.timer.counterTarget = 0;
    expect(validateQuest(quest, workspace, catalog).some(issue => issue.message.includes("decision ID"))).toBe(true);
  });

  it("reports unsupported quest settings, malformed fetch items, and incomplete timer effects", () => {
    const workspace = workspaceFixture();
    const quest = questFixture();
    Object.assign(quest.definition, {
      id: " ", title: " ", sourceKind: "Unknown", objectiveKind: "Unknown", rewardKind: "Unknown",
      firstFloor: 0, repeatEveryFloors: 0, rewardAmount: -1, sourceSlot: 2, targetNodeKind: ""
    });
    let messages = validateQuest(quest, workspace, catalog).map(issue => issue.message);
    expect(messages).toContain("Quest ID is required.");
    expect(messages).toContain("Quest title is required.");
    expect(messages).toContain("Choose a supported quest source.");
    expect(messages).toContain("Choose a supported objective type.");
    expect(messages).toContain("Choose a supported reward type.");
    expect(messages).toContain("First available floor must be 1 or higher.");
    expect(messages).toContain("Repeat interval must be 1 or higher.");
    expect(messages).toContain("Reward amount cannot be negative.");
    expect(messages).toContain("Source slot must be either Any, 0, or 1.");
    expect(messages).toContain("Choose the target node type.");

    quest.definition.objectiveKind = "Fetch";
    quest.definition.itemId = "";
    quest.extension.fetchItems = [
      { id: "duplicate", displayName: " ", count: 0 },
      { id: "duplicate", displayName: "Useful item", count: 1 }
    ];
    quest.extension.dialogueLinks.offer = "missing-dialogue";
    messages = validateQuest(quest, workspace, catalog).map(issue => issue.message);
    expect(messages).toContain("Fetched item IDs must be unique.");
    expect(messages).toContain("Each fetched item needs a name and generated ID.");
    expect(messages).toContain("Fetched item quantities must be at least 1.");
    expect(messages).toContain("The offer dialogue reference is missing.");

    quest.definition.objectiveKind = "Timer";
    quest.extension.logicKind = "timer-project";
    quest.extension.timer.decisionId = "project";
    quest.extension.timer.counterTarget = 2;
    quest.extension.timer.paymentAmount = 0;
    quest.extension.timer.completionEffects = [{ kind: "unlock-path", targetId: "", label: "Bridge" }];
    quest.extension.dialogueLinks.offer = "test-dialogue";
    messages = validateQuest(quest, workspace, catalog).map(issue => issue.message);
    expect(messages).toContain("Timer projects need the planned game-side handler before they can run in Adventure Mode.");
    expect(messages).toContain("Every completion effect needs a target ID.");
    expect(messages).toContain("The linked dialogue has no matching pay-now decision outcome.");
    expect(messages).toContain("The linked dialogue has no matching wait decision outcome.");
  });

  it("checks workspace-wide duplicate IDs and campaign node references", () => {
    const workspace = workspaceFixture();
    workspace.armies.push({ ...workspace.armies[0], key: "second-army" });
    workspace.campaigns[0].floors[0].nodes[1].armyId = "missing-army";
    const messages = validateWorkspace(workspace, catalog).map(issue => issue.message);
    expect(messages.some(message => message.includes("Army IDs must be unique"))).toBe(true);
    expect(messages.some(message => message.includes("missing Army configuration"))).toBe(true);
  });

  it("checks generated floor limits, custom quest pools, and dangling routes", () => {
    const campaign = campaignFixture();
    const floor = campaign.floors[0];
    floor.mode = "mixed";
    floor.randomSettings.nodeCount = 40;
    floor.questPoolMode = "custom";
    floor.questPoolIds = ["outside-pool"];
    floor.routes.push({ id: "bad", fromNodeId: "start", toNodeId: "missing", oneWay: false });
    const messages = validateCampaign(campaign, workspaceFixture(), catalog).map(issue => issue.message);
    expect(messages.some(message => message.includes("exceed the 30-node floor limit"))).toBe(true);
    expect(messages.some(message => message.includes("outside the campaign Quest pool"))).toBe(true);
    expect(messages.some(message => message.includes("no longer exists"))).toBe(true);
  });
});
