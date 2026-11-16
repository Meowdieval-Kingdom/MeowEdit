import { describe, expect, it } from "vitest";
import type { UnitRoster } from "../src/model";
import { includeArmyUnitsInRoster } from "../src/roster";
import { escapeHtml, renderApp, renderArmyAbilityPreview, renderArmyEntityPreview, renderDialoguePreview, renderLivePreview, renderValidationSummary } from "../src/view";
import { catalog, dialogueFixture, rosterFixture, workspaceFixture } from "./fixtures";

describe("editor rendering", () => {
  it("escapes content before putting it into HTML", () => {
    expect(escapeHtml(`<script a="b">'&`)).toBe("&lt;script a=&quot;b&quot;&gt;&#39;&amp;");
  });

  it("renders replacement and selected-unit spell controls for the current field", () => {
    const workspace = workspaceFixture();
    workspace.armies[0].units[0].spellIds = ["fireball"];
    const html = renderApp(workspace, rosterFixture, catalog, [], 0, "full", "placement-1");
    expect(html).toContain("Replace selected field");
    expect(html).toContain('data-action="replace-army-placement"');
    expect(html).toContain('id="army-unit-spell-picker"');
    expect(html).toContain("SPELLS FOR THIS UNIT");
    expect(html).toContain("Fireball");
    expect(html).toContain('aria-label="Jump to editor section"');
    expect(html).toContain('href="#army-lineup"');
  });

  it("keeps Army Guided tasks separate and previews unit, building, and ability data", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "army";
    workspace.selectedKey = workspace.armies[0].key;

    const name = renderApp(workspace, rosterFixture, catalog, [], 0, "guided");
    expect(name).toContain("Army name");
    expect(name).not.toContain("army-unit-picker");
    expect(name).not.toContain("data-army-grid");

    const units = renderApp(workspace, rosterFixture, catalog, [], 1, "guided");
    expect(units).toContain("Choose units");
    expect(units).not.toContain("data-army-grid");
    expect(units).toContain('aria-label="Catalog type"');
    expect(units).toContain("Units");
    expect(units).toContain("Buildings");
    expect(units).toContain("Health");
    expect(units).toContain("A sturdy test fighter.");
    expect(units).toContain('src="./avatars/Cats-Fighter-1.png"');
    expect(units).toContain("army-stats-portrait");
    expect(units.match(/class="army-stats-card"/g)).toHaveLength(1);

    const position = renderApp(workspace, rosterFixture, catalog, [], 2, "guided", "placement-1");
    expect(position).toContain("data-army-grid");
    expect(position).toContain("Drag to move");
    expect(position).toContain("data-army-placement");
    expect(position).toContain('src="./avatars/Cats-Fighter-1.png"');
    expect(position.match(/class="army-stats-card"/g)).toHaveLength(1);

    const advanced = renderApp(workspace, rosterFixture, catalog, [], 2, "full", "placement-1");
    expect(advanced.match(/class="army-stats-card"/g)).toHaveLength(1);

    const building = renderArmyEntityPreview(catalog, "Cats/Barricade/1", 1, "buildings");
    expect(building).toContain("BUILDING · LEVEL 1");
    expect(building).toContain("2 × 1");
    expect(building).toContain("A broad defensive structure.");

    const effect = renderArmyAbilityPreview(catalog, "fireball", "spells");
    expect(effect).toContain("Deals fire damage to nearby enemies.");
    expect(effect).toContain("5 mana");
  });

  it("keeps the sidebar compact and moves transfer actions out of the top bar", () => {
    const html = renderApp(workspaceFixture(), rosterFixture, catalog, [], 0, "full");
    const sidebar = html.split('<aside class="sidebar">')[1].split("</aside>")[0];
    const topbar = html.split('<header class="topbar">')[1].split("</header>")[0];

    expect(sidebar).not.toContain("doc-item");
    expect(sidebar).not.toContain("AUTHORING WORKSPACE");
    expect(sidebar).toContain('data-action="open-content-picker"');
    expect(sidebar).toContain('data-action="open-import"');
    expect(sidebar).toContain('data-action="export-package"');
    expect(topbar).not.toContain('data-action="open-import"');
    expect(topbar).not.toContain('data-action="export-active"');
    expect(topbar).not.toContain('data-action="export-package"');
    expect(topbar).not.toContain('data-action="delete-active"');
    expect(topbar).not.toContain('data-action="delete-item"');
    expect(html).toContain('class="content-picker-dialog"');
    expect(html).toContain('data-action="delete-item"');
  });

  it("shows ability previews, separates curses, and focuses selected cell targets", () => {
    const workspace = workspaceFixture();
    const army = workspace.armies[0];
    army.spellIds = ["fireball"];
    army.blessingIds = ["blessing"];
    workspace.selectedType = "army";
    workspace.selectedKey = army.key;

    const spells = renderApp(workspace, rosterFixture, catalog, [], 3, "guided");
    expect(spells).toContain('class="army-context-muted"');
    expect(spells).toContain('title="Deals fire damage to nearby enemies.');
    expect(spells).toContain('id="army-spell-preview"');
    const blessings = renderApp(workspace, rosterFixture, catalog, [], 4, "guided");
    expect(blessings).toContain('id="army-blessing-preview"');
    expect(blessings).toContain("Boosts armor for the battle.");

    army.blessingIds.push("picked-column", "cell-curse");
    const focusedBlessing = renderApp(workspace, rosterFixture, catalog, [], 4, "guided");
    expect(focusedBlessing).toContain('data-action="configure-battlefield-effect"');
    expect(focusedBlessing).toContain('class="army-chip-area">Choose a lane</small>');
    expect(focusedBlessing).toContain("FIELD · Choose a lane");
    const curses = renderApp(workspace, rosterFixture, catalog, [], 5, "guided");
    expect(curses).toContain('id="army-curse-preview"');
    expect(curses).toContain("Cracked Front");
    expect(curses).toContain("Curse");
    expect(curses).toContain("FIELD · Back row · Bane: Front row");

    const cellFocus = renderApp(workspace, rosterFixture, catalog, [], 4, "guided", null, undefined, undefined, "units", false,
      { abilityId: "picked-column", region: "boon" });
    expect(cellFocus).toContain('role="dialog" aria-modal="true" aria-label="Configure battlefield fields"');
    expect(cellFocus).toContain("Enemy side →");
    expect(cellFocus).toContain('data-action="pick-cell-blessing-lane"');
    expect(cellFocus).toContain("Attack Speed +10%.");
  });

  it("renders empty-workspace actions and validation summaries", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = null;
    workspace.selectedKey = null;
    expect(renderApp(workspace, rosterFixture, catalog, []).toLowerCase()).toContain("what are you making?");
    expect(renderValidationSummary([{ level: "error", message: "Fix <field>" }])).toContain("Fix &lt;field&gt;");
  });

  it("keeps optional help out of the default view and exposes it in either editor mode", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "dialogue";
    workspace.selectedKey = workspace.dialogues[0].key;

    const guided = renderApp(workspace, rosterFixture, catalog, [], 1, "guided");
    expect(guided).toContain('class="guided-intro help-copy"');
    expect(guided).toContain('data-action="toggle-help"');
    expect(guided).toContain('aria-pressed="false"');
    expect(guided).not.toContain("Draft saved");
    expect(guided.match(/data-action="toggle-help"/g)).toHaveLength(1);

    const guidedHelp = renderApp(workspace, rosterFixture, catalog, [], 1, "guided", null, undefined, undefined, "units", true);
    expect(guidedHelp).toContain('class="app-shell guided-shell help-visible"');
    expect(guidedHelp).toContain('aria-pressed="true"');
    expect(guidedHelp).toContain("Hide help");

    const advancedHelp = renderApp(workspace, rosterFixture, catalog, [], 1, "full", null, undefined, undefined, "units", true);
    expect(advancedHelp).toContain('class="app-shell help-visible"');
    expect(advancedHelp).toContain('class="help-copy"');

    const campaignWorkspace = workspaceFixture();
    campaignWorkspace.selectedType = "campaign";
    campaignWorkspace.selectedKey = campaignWorkspace.campaigns[0].key;
    campaignWorkspace.campaigns[0].designMode = "choose";
    const campaignStart = renderApp(campaignWorkspace, rosterFixture, catalog, [], 0, "guided");
    expect(campaignStart).toContain('class="campaign-step-prompt help-copy"');
    expect(campaignStart).toContain('<span class="help-copy">Generated floors, starting rules, and progression.');
    expect(campaignStart).not.toContain('<span>Generated floors, starting rules, and progression.');

    const armyWorkspace = workspaceFixture();
    armyWorkspace.selectedType = "army";
    armyWorkspace.selectedKey = armyWorkspace.armies[0].key;
    expect(renderApp(armyWorkspace, rosterFixture, catalog, [], 0, "full")).toContain('class="army-data-note help-copy"');
  });

  it("keeps Dialogue Guided sequential and shows all advanced fields for quick edits", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "dialogue";
    workspace.selectedKey = workspace.dialogues[0].key;
    for (let step = 0; step < 5; step++) {
      const guided = renderApp(workspace, rosterFixture, catalog, [], step, "guided");
      expect(guided).toContain("Dialogue map");
    }
    const advanced = renderApp(workspace, rosterFixture, catalog, [], 0, "full");
    for (const section of ["dialogue-sequence", "dialogue-moment", "dialogue-speakers", "dialogue-lines", "dialogue-choices", "dialogue-preview"]) {
      expect(advanced).toContain('id="' + section + '"');
      expect(advanced).toContain('href="#' + section + '"');
    }
    expect(advanced).toContain('data-bind="sequenceId"');
    expect(advanced).toContain('data-bind="nodes.0.segments.0.text"');
    expect(advanced).not.toContain("DIALOGUE · ADVANCED");
    const record = dialogueFixture();
    record.sequence.nodes[0].headline = "<Opening>";
    const previewWorkspace = { ...workspace, activeNodeId: "opening" };
    const preview = renderDialoguePreview(record, previewWorkspace, rosterFixture);
    expect(preview).toContain("&lt;Opening&gt;");
    expect(preview).toContain("data-layout=\"none\"");
    expect(renderLivePreview(previewWorkspace, rosterFixture)).toContain("DIALOGUE PREVIEW");
  });

  it("keeps Quest Guided sequential and exposes all advanced sections together", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "quest";
    workspace.selectedKey = workspace.quests[0].key;
    for (let step = 0; step < 7; step++) expect(renderApp(workspace, rosterFixture, catalog, [], step, "guided")).toContain("Step " + (step + 1) + " of 7");
    const speaker = renderApp(workspace, rosterFixture, catalog, [], 2, "guided");
    expect(speaker).toContain("Quest giver character");
    expect(speaker).not.toContain('data-bind="definition.offerText"');
    const offer = renderApp(workspace, rosterFixture, catalog, [], 3, "guided");
    expect(offer).toContain('data-bind="definition.offerText"');
    expect(offer).not.toContain('data-bind="definition.activeText"');
    const inProgress = renderApp(workspace, rosterFixture, catalog, [], 4, "guided");
    expect(inProgress).toContain('data-bind="definition.activeText"');
    expect(inProgress).not.toContain('data-bind="definition.offerText"');
    const advanced = renderApp(workspace, rosterFixture, catalog, [], 0, "full");
    for (const section of ["details", "objective", "story", "reward", "dialogues", "progress", "effects", "review"]) {
      expect(advanced).toContain('id="quest-' + section + '"');
      expect(advanced).toContain('href="#quest-' + section + '"');
    }
    expect(advanced).toContain('data-bind="extension.dialogueLinks.offer"');
    expect(advanced).toContain('data-bind="definition.id"');
    expect(advanced).toContain('class="advanced-rule-disclosure" open');
    expect(advanced).not.toContain("QUEST · ADVANCED");
    for (const objectiveKind of ["Escort", "Fetch", "KillCount", "ClearFloor", "Timer"] as const) {
      workspace.quests[0].definition.objectiveKind = objectiveKind;
      expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full")).toContain("What should the player do?");
    }
  });

  it("shows configured Quest targets, linked dialogues, spacing rules, and effects in Guided review", () => {
    const workspace = workspaceFixture();
    const quest = workspace.quests[0];
    quest.definition.objectiveKind = "Fetch";
    quest.extension.fetchItems = [{ id: "sealed-letter", displayName: "Sealed letter", count: 2 }];
    quest.extension.dialogueLinks = { offer: "test-dialogue", active: "progress-sequence", completion: "done-sequence", failure: "failure-sequence" };
    quest.extension.minimumNodeDistances = [{ id: "distance-1", fromNodeKind: "Quest", toNodeKind: "Reward", minimumHops: 3 }];
    quest.extension.completionEffects = [{ kind: "unlock-path", targetId: "north-route", label: "Open the north route" }];
    workspace.selectedType = "quest";
    workspace.selectedKey = quest.key;

    const html = renderApp(workspace, rosterFixture, catalog, [], 6, "guided");
    expect(html).not.toContain("What the player experiences");
    expect(html).not.toContain("Follow the configured objective.");
    expect(html).toContain("2 × Sealed letter");
    expect(html).toContain("Offer: Moment 1 (test-dialogue)");
    expect(html).toContain("Progress: Progress Sequence (progress-sequence)");
    expect(html).toContain("Completion: Done Sequence (done-sequence)");
    expect(html).toContain("Failure: Failure Sequence (failure-sequence)");
    expect(html).toContain("Quest → Reward: at least 3 map steps");
    expect(html).toContain("Open the north route");
  });

  it("summarizes each supported Quest objective in Guided review", () => {
    const workspace = workspaceFixture();
    const quest = workspace.quests[0];
    workspace.selectedType = "quest";
    workspace.selectedKey = quest.key;
    const renderSummary = () => renderApp(workspace, rosterFixture, catalog, [], 6, "guided");

    quest.definition.objectiveKind = "Escort";
    quest.definition.escortUnitId = "Cats/Fighter/1";
    quest.definition.targetNodeKind = "Reward";
    quest.definition.targetFloorOffset = 1;
    expect(renderSummary()).toContain("Escort Cats/Fighter/1 to Reward (floor +1).");

    quest.definition.objectiveKind = "Battle";
    quest.extension.battleTargets = [{ id: "battle-one", label: "Bandit camp", nodeKind: "Battle", floorOffset: 1, armyId: "bandit-army" }];
    expect(renderSummary()).toContain("Bandit camp (Battle, floor +1, Army bandit-army)");

    quest.definition.objectiveKind = "ClearFloor";
    quest.definition.targetFloorOffset = 2;
    expect(renderSummary()).toContain("Clear floor +2.");

    quest.definition.objectiveKind = "KillCount";
    quest.extension.killCount = { targetKind: "building-faction", targetId: "Critters", count: 4 };
    expect(renderSummary()).toContain("Defeat 4 buildings of faction Critters.");

    quest.definition.objectiveKind = "Timer";
    quest.extension.logicKind = "timer-project";
    quest.extension.timer.paymentAmount = 15;
    quest.extension.timer.paymentResource = "Sardines";
    quest.extension.timer.paymentCompletesImmediately = true;
    quest.extension.timer.counterTarget = 3;
    quest.extension.timer.counterLabel = "Completed battles";
    expect(renderSummary()).toContain("Pay 15 Sardines to finish immediately, or wait for 3 completed battles.");
  });

  it("shows per-unit and per-building spell assignments in Army Guided review", () => {
    const workspace = workspaceFixture();
    const army = workspace.armies[0];
    army.units[0].spellIds = ["fireball"];
    army.units.push({ id: "barricade-placement", unitId: "Cats/Barricade/1", x: 1, y: 0, spellIds: ["shield"] });
    workspace.selectedType = "army";
    workspace.selectedKey = army.key;

    const html = renderApp(workspace, rosterFixture, catalog, [], 6, "guided");
    expect(html).toContain("Spells by lineup entry");
    expect(html).toContain("Fighter: Fireball");
    expect(html).toContain("Barricade: Shield");
  });

  it("renders campaign editor variants and floor map states", () => {
    const workspace = workspaceFixture();
    workspace.selectedType = "campaign";
    workspace.selectedKey = workspace.campaigns[0].key;
    const view = { selectedFloorId: workspace.campaigns[0].floors[0].id, selectedNodeId: "start", interactionMode: "select" as const, nodeKind: "Battle" as const, addMenuOpen: false, pendingPlugFromId: null, selectedRouteId: null };
    const advanced = renderApp(workspace, rosterFixture, catalog, [], 0, "full", null, view);
    expect(advanced).not.toContain("ADVENTURE NODE MAP");
    for (const section of ["campaign-basics", "campaign-floors", "campaign-map", "campaign-quests", "campaign-shops", "campaign-starting-run", "campaign-progression"]) {
      expect(advanced).toContain('id="' + section + '"');
      expect(advanced).toContain('href="#' + section + '"');
    }
    expect(advanced).not.toContain("CAMPAIGN · ADVANCED");
    expect(advanced).toContain('details class="campaign-advanced-node" open');
    expect(advanced).toContain('class="campaign-floor-pool" open');
    const nameStep = renderApp(workspace, rosterFixture, catalog, [], 0, "guided", null, view);
    expect(nameStep).toContain("Step 1 of 10");
    expect(nameStep).toContain('data-bind="name"');
    expect(nameStep).not.toContain('data-campaign-canvas');
    expect(nameStep).not.toContain('class="campaign-settings-panel"');
    expect(renderApp(workspace, rosterFixture, catalog, [], 1, "guided", null, view)).toContain("Choose the boards");
    const mapStep = renderApp(workspace, rosterFixture, catalog, [], 2, "guided", null, view);
    expect(mapStep).toContain("Arrange the path");
    expect(mapStep).toContain('data-campaign-port="output"');
    expect(mapStep).toContain('data-action="campaign-toggle-add-menu"');
    expect(mapStep).toContain('class="campaign-route-distance"');
    expect(mapStep).toContain("map distance 1 step");
    expect(mapStep).toContain("grid cell 0, 0");
    expect(mapStep).not.toContain('data-action="campaign-connect-mode"');
    const nodeStep = renderApp(workspace, rosterFixture, catalog, [], 3, "guided", null, view);
    expect(nodeStep).toContain("Step 4 of 10");
    expect(nodeStep).toContain('data-action="campaign-back-to-map"');
    expect(nodeStep).toContain('class="campaign-map-step campaign-context-map"');
    expect(nodeStep).toContain('data-campaign-canvas');
    expect(renderApp(workspace, rosterFixture, catalog, [], 4, "guided", null, view)).toContain("Find a quest");
    expect(renderApp(workspace, rosterFixture, catalog, [], 9, "guided", null, view)).toContain("Review your campaign");
    workspace.campaigns[0].floors[0].mode = "random";
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full", null, view)).toContain("GENERATED BOARD");
  });

  it("reviews every Campaign floor, authored reference, quest pool, and run setting", () => {
    const workspace = workspaceFixture();
    const campaign = workspace.campaigns[0];
    const randomFloor = {
      ...campaign.floors[0], id: "floor-two", number: 2, mode: "random" as const,
      nodes: [], routes: [], randomSettings: { nodeCount: 18, questNodeCount: 2, shopNodeCount: 4 }
    };
    const mixedFloor = {
      ...campaign.floors[0], id: "floor-three", number: 3, mode: "mixed" as const,
      randomSettings: { nodeCount: 2, questNodeCount: 1, shopNodeCount: 1 }
    };
    campaign.floors.push(randomFloor, mixedFloor);
    campaign.questIds = [workspace.quests[0].definition.id];
    campaign.settings.startingLives = 5;
    campaign.settings.startingSardines = 42;
    campaign.settings.playerFactionId = "Cats";
    campaign.settings.continueWithGeneratedFloors = true;
    campaign.settings.nodeGrowthPerFloor = 3;
    workspace.armies[0].id = "bridge-guards";
    workspace.armies[0].name = "Bridge Guards";
    campaign.floors[0].nodes[1].armyId = "bridge-guards";
    workspace.selectedType = "campaign";
    workspace.selectedKey = campaign.key;
    const view = { selectedFloorId: campaign.floors[0].id, selectedNodeId: "start", interactionMode: "select" as const, nodeKind: "Battle" as const, addMenuOpen: false, pendingPlugFromId: null, selectedRouteId: null };

    const html = renderApp(workspace, rosterFixture, catalog, [], 10, "guided", null, view);
    expect(html).toContain("Floor 1 · Hand placed");
    expect(html).toContain("Floor 2 · Random");
    expect(html).toContain("Floor 3 · Mixed");
    expect(html).toContain("18 generated nodes · 2 Quest nodes · 4 Shops");
    expect(html).toContain("Mixed · 4 placed nodes · 4 routes · 2 generated nodes · 1 Quest node · 1 Shop");
    expect(html).toContain("Battle 1 · Battle · Army Bridge Guards (bridge-guards)");
    expect(html).toContain("Start ↔ Battle 1");
    expect(html).toContain("Test Quest (test-quest)");
    expect(html).toContain("5 lives · 42 Sardines · Cats");
    expect(html).toContain("continues with generated floors");
    expect(html).not.toContain("Current floor");
  });

  it("keeps manual stable IDs out of every guided editor", () => {
    const workspace = workspaceFixture();

    workspace.selectedType = "dialogue";
    workspace.selectedKey = workspace.dialogues[0].key;
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "guided")).not.toContain('data-bind="sequenceId"');
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full")).toContain('data-bind="sequenceId"');

    workspace.selectedType = "quest";
    workspace.selectedKey = workspace.quests[0].key;
    const guidedQuest = renderApp(workspace, rosterFixture, catalog, [], 0, "guided");
    expect(guidedQuest).not.toContain('data-bind="definition.id"');
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "guided")).not.toContain("Stable ID");
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full")).toContain('data-bind="definition.id"');

    workspace.selectedType = "army";
    workspace.selectedKey = workspace.armies[0].key;
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "guided")).not.toContain('data-bind="id"');
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full")).toContain('data-bind="id"');

    workspace.selectedType = "campaign";
    workspace.selectedKey = workspace.campaigns[0].key;
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "guided")).not.toContain('data-bind="id"');
    expect(renderApp(workspace, rosterFixture, catalog, [], 0, "full")).toContain('data-bind="id"');
  });

  it("puts generated board controls in a focused guided settings surface", () => {
    const workspace = workspaceFixture();
    const campaign = workspace.campaigns[0];
    campaign.designMode = "settings-only";
    campaign.floors[0].mode = "random";
    campaign.floors[0].nodes = [];
    campaign.floors[0].routes = [];
    workspace.selectedType = "campaign";
    workspace.selectedKey = campaign.key;

    const html = renderApp(workspace, rosterFixture, catalog, [], 1, "guided");
    expect(html).toContain("campaign-randomizer-focus");
    expect(html).toContain('class="campaign-random-settings"');
    expect(html).toContain("Total nodes");
  });

  it("keeps the campaign validation badge separate from the Guided mode button", () => {
    const workspace = workspaceFixture();
    const campaign = workspace.campaigns[0];
    campaign.floors[0].nodes[0].x = 1;
    workspace.selectedType = "campaign";
    workspace.selectedKey = campaign.key;

    const html = renderApp(workspace, rosterFixture, catalog, [], 0, "full");
    const actions = html.match(/<div class="campaign-heading-actions">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(actions).toContain('class="campaign-validation-badge has-errors"');
    expect(actions).toMatch(/\d+ to fix/);
    expect(actions).toContain('data-action="open-guided-editor"');
  });

  it("renders contextual return actions and linked-content shortcuts", () => {
    const workspace = workspaceFixture();
    const campaign = workspace.campaigns[0];
    workspace.selectedType = "campaign";
    workspace.selectedKey = campaign.key;
    const view = { selectedFloorId: campaign.floors[0].id, selectedNodeId: "battle-a-1", interactionMode: "select" as const, nodeKind: "Battle" as const, addMenuOpen: false, pendingPlugFromId: null, selectedRouteId: null };
    const returnState = { parent: "Campaign" as const, label: campaign.name };
    const campaignHtml = renderApp(workspace, rosterFixture, catalog, [], 3, "guided", null, view, returnState);
    expect(campaignHtml).toContain('data-action="return-to-parent"');
    expect(campaignHtml).toContain('data-action="create-campaign-army"');

    workspace.selectedType = "quest";
    workspace.selectedKey = workspace.quests[0].key;
    const questHtml = renderApp(workspace, rosterFixture, catalog, [], 4, "full", null, view, { parent: "Quest", label: "Test Quest" });
    expect(questHtml).toContain('data-action="create-quest-dialogue"');
    expect(questHtml).toContain('data-slot="offer"');
    expect(questHtml).toContain('data-action="return-to-parent"');
  });

  it("renders captured character portraits and falls back for an empty dialogue", () => {
    const record = dialogueFixture();
    record.sequence.nodes[0].speakers = [{ id: "speaker", unitId: "Cats/Fighter/1", displayName: "Fighter", side: "left", mood: "Normal" }];
    record.sequence.nodes[0].segments[0].speakerIds = ["speaker"];
    const roster: UnitRoster = { ...rosterFixture, units: [{ id: "Cats/Fighter/1", displayName: "Fighter", faction: "Cats", portrait: "/fighter.png", moods: ["Normal"] }] };
    const previewHtml = renderDialoguePreview(record, { ...workspaceFixture(), activeNodeId: null }, roster);
    expect(previewHtml).toContain("/fighter.png");
    expect(previewHtml).toContain('src="./game-preview/shopframeback.png"');
    expect(previewHtml).toContain('src="./game-preview/shopframefront.png"');

    record.sequence.nodes[0].speakers[0] = { id: "speaker", unitId: "Neutral/Stray/1", displayName: "Stray", side: "left", mood: "Normal" };
    const armyRoster = includeArmyUnitsInRoster(rosterFixture, {
      ...catalog,
      units: [...catalog.units, {
        id: "Neutral/Stray/1", name: "Stray", factionId: "Neutral", faction: "Neutral",
        levels: [{ id: "Neutral/Stray/1", name: "Stray", level: 1, previewImage: "./avatars/Neutral-Stray-1.png" }]
      }]
    });
    expect(renderDialoguePreview(record, { ...workspaceFixture(), activeNodeId: null }, armyRoster)).toContain('src="./avatars/Neutral-Stray-1.png"');

    record.sequence.nodes = [];
    expect(renderDialoguePreview(record, { ...workspaceFixture(), activeNodeId: null }, roster)).toContain("Add a node to see the dialogue preview");
  });
});
