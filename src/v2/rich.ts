import type { ContentSetV2Document, GameCapabilities, NamedRef } from "./types";
import { findAbility, findLevel, type ArmyCatalogLite } from "./catalog";
import { TRIGGERS } from "./registries";
import { escapeHtml } from "./html";
import { boundInput, boundRef, boundSelect, labelled, options, smallButton } from "./fields";

export interface RichState {
  section: "campaigns" | "quests" | "armies" | "dialogues";
  index: number;
  step: number;
  nodeIndex: number;
  floorIndex: number;
  selectedUnit?: string;
  selectedAbility?: string;
  selectedNodeKind?: string;
  connectFrom?: string;
  connectAction?: number;
  zoom?: number;
  cellPickIndex?: number;
  selectedUnitSpell?: string;
  cellRegion?: "boon" | "bane";
  abilityFilter?: "all" | "field";
  approach?: "settings-only" | "custom";
}

export interface RichContext {
  draft: ContentSetV2Document;
  capabilities: GameCapabilities;
  catalog: ArmyCatalogLite;
  rich: RichState;
}

function field(label: string, bind: string, value: unknown, type = "text", values?: readonly string[]): string {
  return labelled(label, values
    ? boundSelect(bind, values, String(value ?? ""))
    : boundInput(bind, value, type));
}

function ref(label: string, bind: string, value: NamedRef | undefined, values?: readonly string[]): string {
  return labelled(label, boundRef(bind, value, values));
}

function button(action: string, label: string, dataset = ""): string {
  return smallButton("data-rich-action", action, label, dataset);
}

function actionButton(label: string, dataset: string, primary = false): string {
  return '<button type="button" class="button ' + (primary ? "button-primary" : "button-outline") + '" data-rich-action="' + label + '"' + dataset + ">" + escapeHtml(label.replace("-", " ")) + "</button>";
}

const QUEST_STEPS = ["Basics", "Objective", "Quest Giver", "Offer", "In Progress", "Reward", "Review"];

function text(label: string, bind: string, value: unknown): string {
  return field(label, bind, value, "number");
}

function textarea(label: string, bind: string, value: unknown): string {
  return labelled(label, '<textarea rows="5" data-v2-bind="' + escapeHtml(bind) + '">' +
    escapeHtml(String(value ?? "")) + "</textarea>");
}

function objectiveFields(ctx: RichContext, quest: NonNullable<ContentSetV2Document["quests"][number]>, base: string): string {
  const ext = base + ".meowEdit";
  const kind = quest.objectiveKind ?? ctx.capabilities.enums.objectiveKind[0];
  if (kind === "Fetch") return quest.meowEdit.fetchItems.map((item, index) => '<div class="v2-row">' +
    field("Item " + (index + 1), ext + ".fetchItems[" + index + "].displayName.default", item.displayName.default) +
    field("Count", ext + ".fetchItems[" + index + "].count", item.count, "number") +
    button("remove-fetch-item", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    button("add-fetch-item", "+ Item");
  if (kind === "Battle") return quest.meowEdit.battleTargets.map((target, index) => '<div class="v2-row">' +
    field("Battle label", ext + ".battleTargets[" + index + "].id", target.id) +
    field("Node type", ext + ".battleTargets[" + index + "].nodeKind", target.nodeKind, "text", ctx.capabilities.enums.nodeKind) +
    field("Floor offset", ext + ".battleTargets[" + index + "].floorOffset", target.floorOffset, "number") +
    ref("Army", ext + ".battleTargets[" + index + "].armyId", target.armyId) +
    button("create-battle-army", "Create Army", ' data-index="' + index + '"') +
    button("remove-battle-target", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    button("add-battle-target", "+ Target");
  if (kind === "KillCount") return '<div class="guided-fields">' +
    field("Count what", ext + ".killCount.targetKind", quest.meowEdit.killCount.targetKind, "text", ["unit", "faction", "buildings"]) +
    ref("Target", ext + ".killCount.targetId", quest.meowEdit.killCount.targetId) +
    field("Count", ext + ".killCount.count", quest.meowEdit.killCount.count, "number") + "</div>";
  if (kind === "Escort") return '<div class="guided-fields">' + ref("Escorted unit", base + ".escortUnitId", quest.escortUnitId, ctx.capabilities.ids.units) + "</div>";
  if (kind === "ClearFloor") return '<div class="guided-fields">' +
    field("Target node kind", base + ".targetNodeKind", quest.targetNodeKind ?? "Boss", "text", ctx.capabilities.enums.nodeKind) +
    field("Floor offset", base + ".targetFloorOffset", quest.targetFloorOffset ?? 0, "number") + "</div>";
  if (kind === "Timer") return '<div class="guided-fields">' +
    ref("Decision", ext + ".timer.decisionId", quest.meowEdit.timer.decisionId) +
    ref("Pay outcome", ext + ".timer.payOutcomeId", quest.meowEdit.timer.payOutcomeId) +
    ref("Wait outcome", ext + ".timer.waitOutcomeId", quest.meowEdit.timer.waitOutcomeId) +
    textarea("Count event", ext + ".timer.countEvent", quest.meowEdit.timer.countEvent) +
    field("Counter target", ext + ".timer.counterTarget", quest.meowEdit.timer.counterTarget, "number") +
    field("Payment amount", ext + ".timer.paymentAmount", quest.meowEdit.timer.paymentAmount, "number") +
    '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + ext + '.timer.paymentCompletesImmediately"' +
    (quest.meowEdit.timer.paymentCompletesImmediately ? " checked" : "") + '><span>Payment finishes the project immediately</span></label></div>';
  return "";
}

function questEditor(ctx: RichContext): string {
  const quest = ctx.draft.quests[ctx.rich.index];
  if (!quest) return "";
  const base = "quests[" + ctx.rich.index + "]";
  const ext = base + ".meowEdit";
  const step = ctx.rich.step;
  let body: string;
  if (step === 0) {
    body = '<div class="guided-fields">' +
      field("Quest title", base + ".title.default", quest.title.default) +
      field("ID", base + ".id", quest.id) +
      textarea("Quest log description", base + ".description.default", quest.description.default) +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      field("Source", base + ".sourceKind", quest.sourceKind ?? "QuestGiver", "text", ["QuestGiver", "Letter", "Item"]) +
      field("First floor", base + ".firstFloor", quest.firstFloor ?? 1, "number") +
      field("Repeat every", base + ".repeatEveryFloors", quest.repeatEveryFloors ?? 0, "number") +
      "</div></details></div>";
  } else if (step === 1) {
    body = '<div class="guided-fields">' +
      field("Player objective", base + ".objectiveKind", quest.objectiveKind ?? ctx.capabilities.enums.objectiveKind[0], "text", ctx.capabilities.enums.objectiveKind) +
      "</div><h4>Objective details</h4>" + objectiveFields(ctx, quest, base) +
      '<details class="guided-advanced"><summary>Advanced · minimum node spacing</summary><div class="form-grid">' +
      quest.meowEdit.minimumNodeDistances.map((rule, index) => '<div class="v2-row">' +
        field("From", ext + ".minimumNodeDistances[" + index + "].fromNodeKind", rule.fromNodeKind, "text", ctx.capabilities.enums.nodeKind) +
        field("To", ext + ".minimumNodeDistances[" + index + "].toNodeKind", rule.toNodeKind, "text", ctx.capabilities.enums.nodeKind) +
        field("At least", ext + ".minimumNodeDistances[" + index + "].minimumHops", rule.minimumHops, "number") +
        button("remove-distance", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
      button("add-distance", "+ Rule") + "</div></details>";
  } else if (step === 2) {
    body = '<div class="guided-fields">' +
      ref("Quest giver", base + ".speakerUnitId", quest.speakerUnitId, ctx.capabilities.ids.units) +
      field("Display name", base + ".speakerName.default", quest.speakerName?.default ?? "") + "</div>";
  } else if (step === 3) {
    body = '<div class="guided-fields">' + textarea("Offer text", base + ".offerText.default", quest.offerText?.default ?? "") + "</div>";
  } else if (step === 4) {
    body = '<div class="guided-fields">' + textarea("In-progress text", base + ".activeText.default", quest.activeText?.default ?? "") + "</div>";
  } else if (step === 5) {
    body = '<div class="guided-fields">' +
      field("Reward", base + ".rewardKind", quest.rewardKind ?? ctx.capabilities.enums.rewardKind[0], "text", ctx.capabilities.enums.rewardKind) +
      field("Amount", base + ".rewardAmount", quest.rewardAmount ?? 0, "number") +
      ref("Content ID", base + ".rewardContentId", quest.rewardContentId) + "</div>";
  } else {
    const links = Object.entries(quest.meowEdit.dialogueLinks).map(([slot, list]) =>
      slot + ": " + (list.map(item => item.id).join(", ") || "none")).join(" · ");
    const objectiveDetail = quest.objectiveKind === "Fetch"
      ? quest.meowEdit.fetchItems.map(item => item.displayName.default + " ×" + item.count).join(", ") || "no items"
      : quest.objectiveKind === "Battle"
        ? quest.meowEdit.battleTargets.map(target => target.id + " @floor " + target.floorOffset).join(", ") || "no targets"
        : quest.objectiveKind === "KillCount"
          ? quest.meowEdit.killCount.targetId.id + " ×" + quest.meowEdit.killCount.count
          : quest.objectiveKind === "Timer"
            ? "decision " + quest.meowEdit.timer.decisionId.id + " · counter " + quest.meowEdit.timer.counterTarget
            : quest.escortUnitId?.id || quest.targetNodeKind || "-";
    body = '<div class="card"><h3>' + escapeHtml(quest.title.default) + "</h3>" +
      "<p>Objective: " + escapeHtml(quest.objectiveKind ?? "-") + " · " + escapeHtml(objectiveDetail) + "</p>" +
      "<p>Reward: " + escapeHtml(quest.rewardKind ?? "-") + " ×" + String(quest.rewardAmount ?? 0) + "</p>" +
      "<p>Dialogue links · " + escapeHtml(links) + "</p>" +
      "<p>Minimum spacing rules: " + quest.meowEdit.minimumNodeDistances.length + " · Completion effects: " + quest.meowEdit.completionEffects.length + "</p>" +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      (["offer", "active", "completion", "failure"] as const).map(slot =>
        ref(slot + " dialogue", ext + ".dialogueLinks." + slot + "[0].id", quest.meowEdit.dialogueLinks[slot][0]) +
        button("create-dialogue-link", "Create Dialogue", ' data-slot="' + slot + '"')).join("") +
      quest.meowEdit.completionEffects.map((effect, index) => '<div class="v2-row">' +
        field("Effect", ext + ".completionEffects[" + index + "].kind", effect.kind, "text",
          ["play-event", "unlock-path", "unlock-shop-item"]) +
        ref("Target", ext + ".completionEffects[" + index + "].targetId", effect.targetId) +
        field("Note", ext + ".completionEffects[" + index + "].label.default", effect.label.default) +
        button("remove-effect", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
      button("add-effect", "+ Effect") + "</div></details></div>";
  }
  return '<p class="help-copy">Each step focuses on one decision. Optional fields stay folded; use Advanced for anything else.</p>' +
    '<div class="guided-progress">' + QUEST_STEPS.map((name, index) =>
    '<span class="' + (index < step ? "done" : index === step ? "current" : "") + '" title="' + escapeHtml(name) + '"></span>').join("") + "</div>" +
    '<h3>' + QUEST_STEPS[step] + '</h3><section class="guided-step">' + body +
    '<div class="guided-actions">' +
    (step > 0 ? actionButton("prev-step", ' data-direction="back"') : "") +
    (step < QUEST_STEPS.length - 1 ? actionButton("next-step", ' data-direction="next"', true) : "") +
    "</div></section>";
}

function dialogueGraph(ctx: RichContext, dialogue: NonNullable<ContentSetV2Document["dialogues"][number]>): string {
  const zoom = ctx.rich.zoom ?? 100;
  const position = (index: number) => ({ x: 20 + (index % 3) * 190, y: 20 + Math.floor(index / 3) * 110 });
  const lines = dialogue.nodes.flatMap((node, nodeIndex) => node.actions.map(action => {
    const target = dialogue.nodes.findIndex(item => item.id === action.targetNodeId);
    if (target < 0) return "";
    const from = position(nodeIndex);
    const to = position(target);
    return '<line x1="' + (from.x + 110) + '" y1="' + (from.y + 28) + '" x2="' + (to.x + 20) + '" y2="' + (to.y + 28) +
      '" stroke="#9d8965" stroke-width="2" marker-end="url(#v2-arrow)"/>';
  })).join("");
  const nodes = dialogue.nodes.map((node, index) => {
    const point = position(index);
    return '<button type="button" class="dialogue-graph-node' + (index === ctx.rich.nodeIndex ? " is-active" : "") +
      '" data-rich-action="select-node" data-index="' + index + '" style="left:' + point.x + 'px;top:' + point.y + 'px">' +
      "<strong>" + escapeHtml(node.headline.default || node.id) + "</strong><small>" +
      (node.actions.length ? node.actions.length + " choice(s)" : "Continue") + "</small></button>";
  }).join("");
  return '<div class="dialogue-graph-tools">' +
    '<span class="eyebrow">MOMENT MAP</span>' +
    button("zoom-out", "−") + button("zoom-reset", String(zoom) + "%") + button("zoom-in", "+") +
    button("add-dialogue-node", "+ Add moment") + "</div>" +
    '<div class="dialogue-graph"><div class="dialogue-graph-canvas" style="transform:scale(' + (zoom / 100) + ')">' +
    '<svg class="dialogue-graph-lines"><defs><marker id="v2-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#9d8965"/></marker></defs>' + lines + "</svg>" + nodes + "</div></div>";
}

function dialogueEditor(ctx: RichContext): string {
  const dialogue = ctx.draft.dialogues[ctx.rich.index];
  if (!dialogue) return "";
  const base = "dialogues[" + ctx.rich.index + "]";
  const nodeIndex = Math.min(ctx.rich.nodeIndex, dialogue.nodes.length - 1);
  const node = dialogue.nodes[nodeIndex];
  const nodeBase = base + ".nodes[" + nodeIndex + "]";
  const list = dialogue.nodes.map((item, index) =>
    '<button type="button" class="button button-small" data-rich-action="select-node" data-index="' + index + '">' +
    escapeHtml(item.headline.default || item.id) + "</button>").join("");
  const previewLines = node.segments.map(segment => {
    const speaker = node.speakers.find(item => segment.speakerIds.includes(item.id));
    return '<p class="dialogue-preview-line">' + (speaker ? '<strong>' + escapeHtml(speaker.displayName.default) + ':</strong> ' : "") +
      escapeHtml(segment.text.default) + "</p>";
  }).join("");
  const choices = node.actions.map(action =>
    '<button type="button" class="button button-small" data-rich-action="preview-choice" data-target="' +
    escapeHtml(action.targetNodeId) + '">' + escapeHtml(action.label.default) + "</button>").join("");
  const defaultContinue = node.actions.length === 0
    ? '<button type="button" class="button button-small" data-rich-action="preview-choice" data-target="">Continue</button>' : "";
  return '<p class="help-copy">Pick a moment on the left, write its lines and choices, then step through the preview on the right.</p>' +
    dialogueGraph(ctx, dialogue) +
    '<div class="guided-actions">' + list + "</div>" +
    '<div class="rich-columns"><section class="card"><h3>Node</h3>' +
    field("ID", nodeBase + ".id", node.id) +
    field("Headline", nodeBase + ".headline.default", node.headline.default) +
    field("Text speed", nodeBase + ".textSpeed", node.textSpeed, "number") +
    '<h4>Speakers</h4>' + node.speakers.map((speaker, speakerIndex) => '<div class="v2-row">' +
      ref("Unit", nodeBase + ".speakers[" + speakerIndex + "].unitId", speaker.unitId, ctx.capabilities.ids.units) +
      field("Name", nodeBase + ".speakers[" + speakerIndex + "].displayName.default", speaker.displayName.default) +
      field("Side", nodeBase + ".speakers[" + speakerIndex + "].side", speaker.side, "text", ["left", "right"]) +
      field("Mood", nodeBase + ".speakers[" + speakerIndex + "].mood", speaker.mood, "text", ["Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"]) +
      button("remove-speaker", "Remove", ' data-index="' + speakerIndex + '"') + "</div>").join("") +
    actionButton("add-speaker", "") +
    '<h4>Lines</h4>' + node.segments.map((segment, segmentIndex) => '<div class="v2-row">' +
      field("Text", nodeBase + ".segments[" + segmentIndex + "].text.default", segment.text.default) +
      button("remove-segment", "Remove", ' data-index="' + segmentIndex + '"') + "</div>").join("") +
    actionButton("add-segment", "") +
    '<h4>Choices</h4>' + node.actions.map((action, actionIndex) => '<div class="v2-row">' +
      field("Label", nodeBase + ".actions[" + actionIndex + "].label.default", action.label.default) +
      field("Target", nodeBase + ".actions[" + actionIndex + "].targetNodeId", action.targetNodeId, "text",
        ["", ...dialogue.nodes.map(item => item.id)]) +
      '<label class="field"><span class="field-label">Outcome ID</span><input data-v2-bind="' + nodeBase + ".actions[" + actionIndex +
      '].meowEdit.decision.outcomeId" value="' + escapeHtml(action.meowEdit.decision.outcomeId) + '"></label>' +
      '<label class="field"><span class="field-label">Decision ID</span><input data-v2-bind="' + nodeBase + ".actions[" + actionIndex +
      '].meowEdit.decision.id" value="' + escapeHtml(action.meowEdit.decision.id) + '"></label>' +
      '<label class="field"><span class="field-label">Decision label</span><input data-v2-bind="' + nodeBase + ".actions[" + actionIndex +
      '].meowEdit.decision.label.default" value="' + escapeHtml(action.meowEdit.decision.label.default) + '"></label>' +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + nodeBase + ".actions[" + actionIndex +
      '].meowEdit.defaultContinue"' + (action.meowEdit.defaultContinue ? " checked" : "") +
      '><span>Default continue</span></label>' +
      button("connect-choice", "Connect", ' data-index="' + actionIndex + '"') +
      button("remove-dialogue-action", "Remove", ' data-index="' + actionIndex + '"') + "</div>").join("") +
    actionButton("add-dialogue-action", "") + "</section>" +
    '<section class="card dialogue-preview"><div class="preview-panel-head"><span class="eyebrow">DIALOGUE PREVIEW</span>' +
    actionButton("preview-reset", "") + "</div>" +
    '<div class="game-screen">' + node.speakers.map(speaker =>
      '<img class="game-avatar avatar-' + escapeHtml(speaker.side) + '" src="' +
      escapeHtml("./avatars/" + speaker.unitId.id.replace(/[^a-zA-Z0-9_-]+/g, "-") + ".png") +
      '" alt="' + escapeHtml(speaker.displayName.default) + '">').join("") +
    '<div class="game-dialogue-panel"><p class="game-headline">' + escapeHtml(node.headline.default) + "</p>" +
    '<div class="game-body">' + (previewLines || '<p class="step-copy">No lines yet.</p>') + "</div></div></div>" +
    '<div class="guided-actions">' + choices + defaultContinue + "</div>" +
    '<p class="step-copy">Only the default locale is rendered here; other locales stay in the document.</p></section></div>';
}

function cellFocus(ctx: RichContext, army: NonNullable<ContentSetV2Document["armies"][number]>, base: string): string {
  const index = ctx.rich.cellPickIndex ?? 0;
  const pick = army.CellBlessingPicks[index];
  if (!pick) return "";
  const region = ctx.rich.cellRegion ?? "boon";
  const selected = region === "boon" ? pick.Cells : pick.BaneCells;
  const cells: string[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const active = selected.some(cell => (cell as { x?: number }).x === x && (cell as { y?: number }).y === y);
      cells.push('<button type="button" class="army-cell' + (active ? " filled" : "") +
        '" data-rich-action="toggle-cell-target" data-x="' + x + '" data-y="' + y + '">' +
        (active ? "●" : "·") + "</button>");
    }
  }
  return '<div class="cell-focus-backdrop"><div class="cell-focus" role="dialog" aria-modal="true">' +
    '<h3>Cell target · ' + escapeHtml(pick.RootId.id) + "</h3>" +
    '<p class="step-copy">Enemy side faces upward. Choose a lane or exact fields.</p>' +
    '<div class="guided-actions">' +
    '<button type="button" class="button button-small" data-rich-action="cell-region" data-region="boon">Blessing fields</button>' +
    '<button type="button" class="button button-small" data-rich-action="cell-region" data-region="bane">Bane fields</button></div>' +
    '<div class="guided-fields">' + field("Lane", base + ".CellBlessingPicks[" + index + "].Lane", pick.Lane, "number") +
    '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + base + ".CellBlessingPicks[" + index +
    '].Locked"' + (pick.Locked ? " checked" : "") + '><span>Locked</span></label></div>' +
    '<div class="army-grid" style="grid-template-columns:repeat(5,34px)">' + cells.join("") + "</div>" +
    '<div class="guided-actions">' + button("close-cell-focus", "Done") + "</div></div></div>";
}

function armyEditor(ctx: RichContext): string {
  const army = ctx.draft.armies[ctx.rich.index];
  if (!army) return "";
  const base = "armies[" + ctx.rich.index + "]";
  const units = ctx.capabilities.ids.units;
  const step = ctx.rich.step;
  const selected = ctx.rich.selectedUnit || units[0] || "";
  const level = findLevel(ctx.catalog, selected);
  const footprint = level?.footprint ?? { width: 1, height: 1 };
  let body: string;
  if (step === 0) {
    body = '<div class="guided-fields">' + field("Army name", base + ".name.default", army.name.default) +
      field("Army ID", base + ".id", army.id) + "</div>";
  } else if (step === 1) {
    body = '<div class="rich-columns"><section class="card"><h3>Catalog</h3>' +
      '<label class="field"><span class="field-label">Unit</span><select data-rich-select="unit">' + options(units, selected) + "</select></label>" +
      actionButton("add-army-unit", "") + "<h4>Lineup</h4>" +
      army.units.map((unit, index) => '<div class="v2-card"><div class="v2-row"><strong>' + escapeHtml(unit.unitId.id) + "</strong>" +
        button("remove-army-unit", "Remove", ' data-index="' + index + '"') + "</div>" +
        '<div class="v2-row"><select data-rich-select="unit-spell" data-index="' + index + '">' +
        options(ctx.capabilities.ids.spells, ctx.rich.selectedUnitSpell ?? "") + "</select>" +
        button("add-unit-spell", "Add spell", ' data-index="' + index + '"') + "</div>" +
        '<div class="guided-actions">' + unit.spellIds.map((spell, spellIndex) =>
          '<button type="button" class="button button-small" data-rich-action="remove-unit-spell" data-index="' +
          spellIndex + '" data-unit="' + index + '">' + escapeHtml(spell.id) + " ×</button>").join("") + "</div></div>").join("") +
      (army.units.length ? "" : '<p class="step-copy">No units yet.</p>') + "</section>" +
      '<section class="card army-stats-card"><h3>Preview</h3><p class="eyebrow">' + escapeHtml(selected) + "</p>" +
      '<p>' + escapeHtml(level?.description ?? "No catalog description available.") + "</p>" +
      '<p class="army-footprint-badge">' + footprint.width + " × " + footprint.height + "</p>" +
      '<dl class="army-stat-grid">' + Object.entries(level?.stats ?? {}).map(([key, value]) =>
        "<dt>" + escapeHtml(key) + "</dt><dd>" + escapeHtml(String(value ?? "-")) + "</dd>").join("") + "</dl></section></div>";
  } else if (step === 2) {
    const width = Math.max(5, ...army.units.map(unit => unit.x + 1));
    const height = Math.max(5, ...army.units.map(unit => unit.y + 1));
    const cells: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = army.units.findIndex(unit => unit.x === x && unit.y === y);
        cells.push('<button type="button" class="army-cell' + (index >= 0 ? " filled" : "") +
          '" data-rich-action="toggle-cell" data-x="' + x + '" data-y="' + y + '" title="' +
          escapeHtml(army.units[index]?.unitId.id ?? "empty") + '">' +
          escapeHtml(index >= 0 ? "●" : "·") + "</button>");
      }
    }
    body = '<p class="step-copy">Selected unit: ' + escapeHtml(selected) + " · footprint " + footprint.width + " × " + footprint.height + "</p>" +
      '<div class="army-grid" style="grid-template-columns:repeat(' + width + ',34px)">' + cells.join("") + "</div>";
  } else if (step === 3 || step === 4) {
    const kind = step === 3 ? "spellIds" : "blessingIds";
    const filter = ctx.rich.abilityFilter ?? "all";
    const ids = (step === 3 ? ctx.capabilities.ids.spells : ctx.capabilities.ids.blessings)
      .filter(id => filter === "all" || findAbility(ctx.catalog, id)?.family === "cell");
    body = '<div class="guided-actions">' +
      '<button type="button" class="button button-small" data-rich-action="ability-filter" data-filter="all">All' +
      (filter === "all" ? " ✓" : "") + "</button>" +
      '<button type="button" class="button button-small" data-rich-action="ability-filter" data-filter="field">Field effects' +
      (filter === "field" ? " ✓" : "") + "</button></div>" +
      '<div class="guided-fields"><label class="field"><span class="field-label">' +
      (step === 3 ? "Spell" : "Blessing") + '</span><select data-rich-select="ability">' + options(ids, ctx.rich.selectedAbility ?? "") + "</select></label>" +
      (step === 3 ? actionButton("add-spell", "") : actionButton("add-blessing", "")) + "</div>" +
      "<h4>Assigned</h4>" + army[kind].map((item, index) => '<div class="v2-row">' +
        "<strong>" + escapeHtml(item.id) + "</strong><span class=\"step-copy\">" +
        escapeHtml(findAbility(ctx.catalog, item.id)?.description ?? "") + "</span>" +
        (step === 4 ? button("configure-cells", "Configure cells", ' data-index="' + index + '"') : "") +
        button(step === 3 ? "remove-spell" : "remove-blessing", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
      '<p class="step-copy">Cell-target picks define blessing and bane fields on the battle board.</p>';
  } else {
    body = '<div class="card"><h3>' + escapeHtml(army.name.default) + "</h3>" +
      "<p>" + army.units.length + " lineup entries · " + army.spellIds.length + " spells · " + army.blessingIds.length + " blessings</p>" +
      "<p>Lineup: " + escapeHtml(army.units.map(unit => unit.unitId.id).join(", ") || "none") + "</p>" +
      "<p>Loadout: " + escapeHtml([...army.spellIds, ...army.blessingIds].map(item => item.id).join(", ") || "none") + "</p></div>";
  }
  const steps = ["Name", "Choose Units", "Arrange Grid", "Army Spells", "Blessings", "Review"];
  return '<p class="help-copy">Each step focuses on one part of the formation. Cell-target picks are in Advanced.</p>' +
    '<div class="guided-progress">' + steps.map((name, index) =>
      '<span class="' + (index < step ? "done" : index === step ? "current" : "") + '" title="' + escapeHtml(name) + '"></span>').join("") + "</div>" +
    '<h3>' + steps[step] + '</h3><section class="guided-step">' + body +
    '<div class="guided-actions">' +
    (step > 0 ? actionButton("prev-step", ' data-direction="back"') : "") +
    (step < steps.length - 1 ? actionButton("next-step", ' data-direction="next"', true) : "") +
    "</div></section>" + (ctx.rich.cellPickIndex !== undefined ? cellFocus(ctx, army, base) : "");
}

const CAMPAIGN_STEPS = ["Name", "Floors", "Map", "Node", "Quests", "Shops", "Starting Run", "Review"];

function campaignEditor(ctx: RichContext): string {
  const campaign = ctx.draft.campaigns[ctx.rich.index];
  if (!campaign) return "";
  const base = "campaigns[" + ctx.rich.index + "]";
  const step = ctx.rich.step;
  const floorIndex = Math.min(ctx.rich.floorIndex, campaign.floors.length - 1);
  const floor = campaign.floors[floorIndex];
  const floorBase = base + ".floors[" + floorIndex + "]";
  const floors = campaign.floors.map((item, index) =>
    '<button type="button" class="button button-small" data-rich-action="select-floor" data-index="' + index + '">Floor ' + item.number + "</button>").join("");
  let body: string;

  const steps = ctx.rich.approach === "settings-only"
    ? ["Name", "Floors", "Shops", "Starting Run", "Review"]
    : CAMPAIGN_STEPS;
  if (step === 0) {
    body = '<div class="guided-actions">' +
      '<button type="button" class="button button-small" data-rich-action="set-approach" data-approach="settings-only">' +
      (ctx.rich.approach === "settings-only" ? "✓ " : "") + "Randomizer settings only</button>" +
      '<button type="button" class="button button-small" data-rich-action="set-approach" data-approach="custom">' +
      (ctx.rich.approach !== "settings-only" ? "✓ " : "") + "Custom campaign</button></div>" +
      '<div class="guided-fields">' + field("Campaign name", base + ".name.default", campaign.name.default) +
      field("ID", base + ".id", campaign.id) +
      textarea("Description", base + ".description.default", campaign.description.default) + "</div>";
  } else if (step === 1) {
    body = '<div class="guided-actions">' + floors + actionButton("add-floor", "") +
      (campaign.floors.length > 1 ? button("remove-floor", "Remove floor", ' data-index="' + floorIndex + '"') : "") + "</div>" +
      '<div class="guided-fields">' +
      field("Layout", floorBase + ".mode", floor.mode, "text", ctx.capabilities.enums.floorMode) +
      field("Total nodes", floorBase + ".randomSettings.nodeCount", floor.randomSettings.nodeCount, "number") +
      field("Quest nodes", floorBase + ".randomSettings.questNodeCount", floor.randomSettings.questNodeCount, "number") +
      field("Shop nodes", floorBase + ".randomSettings.shopNodeCount", floor.randomSettings.shopNodeCount, "number") +
      field("Shop tier", floorBase + ".shopLevel", floor.shopLevel, "number") + "</div>";
  } else if (step === 2) {
    const cells: string[] = [];
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const index = floor.nodes.findIndex(node => node.x === x && node.y === y);
        const node = floor.nodes[index];
        cells.push('<button type="button" class="campaign-cell' + (node ? " filled" : "") +
          '" data-rich-action="toggle-node" data-x="' + x + '" data-y="' + y + '"' +
          (index >= 0 ? ' data-index="' + index + '"' : "") + ' title="' + escapeHtml(node?.id ?? "empty") + '">' +
          escapeHtml(node ? node.kind.slice(0, 1) : "·") + "</button>");
      }
    }
    const routes = floor.routes.map((route, index) => {
      const from = floor.nodes.find(node => node.id === route.fromNodeId);
      const to = floor.nodes.find(node => node.id === route.toNodeId);
      const distance = from && to ? Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) : 0;
      return '<div class="v2-row">' +
        "<strong>" + escapeHtml(route.fromNodeId + " → " + route.toNodeId) + " · " + distance + " step(s)</strong>" +
      '<button type="button" class="button button-small" data-rich-action="toggle-route-direction" data-index="' + index + '">' +
      (route.oneWay ? "One-way" : "Two-way") + "</button>" +
      button("remove-route", "Disconnect", ' data-index="' + index + '"') + "</div>";
    });
    body = '<p class="step-copy">Click an empty cell to add the selected node kind. Click a node to edit it. ' +
      'Use "Connect" on a node, then click a neighboring node to add a route.</p>' +
      '<div class="guided-fields"><label class="field"><span class="field-label">Node kind</span><select data-rich-select="node-kind">' +
      options(ctx.capabilities.enums.nodeKind, ctx.rich.selectedNodeKind ?? "Battle") + "</select></label></div>" +
      '<div class="campaign-grid">' + cells.join("") + "</div><h4>Connections</h4>" +
    (routes.length ? routes.join("") : '<p class="step-copy">No routes yet.</p>');
  } else if (step === 3) {
    const nodeIndex = Math.min(ctx.rich.nodeIndex, Math.max(0, floor.nodes.length - 1));
    const node = floor.nodes[nodeIndex];
    if (!node) body = '<p class="step-copy">Add a node in the Map step first.</p>';
    else {
      const nodeBase = floorBase + ".nodes[" + nodeIndex + "]";
      body = '<div class="guided-actions">' + floor.nodes.map((item, index) =>
        '<button type="button" class="button button-small" data-rich-action="select-node" data-index="' + index + '">' +
        escapeHtml(item.label.default || item.id) + "</button>").join("") + "</div>" +
        '<div class="guided-fields">' + field("Node name", nodeBase + ".label.default", node.label.default) +
        field("Kind", nodeBase + ".kind", node.kind, "text", ctx.capabilities.enums.nodeKind) +
        text("x", nodeBase + ".x", node.x) + text("y", nodeBase + ".y", node.y) +
        button("connect-node", "Connect from this node", ' data-index="' + nodeIndex + '"') +
        button("remove-node", "Remove node", ' data-index="' + nodeIndex + '"') + "</div>" +
        (node.kind === "Battle" || node.kind === "Boss"
          ? '<div class="guided-fields">' + ref("Enemy army", nodeBase + ".armyId", node.armyId) +
            button("create-node-army", "Create Army", ' data-node="' + nodeIndex + '"') +
            ref("Enemy faction", nodeBase + ".enemyFactionId", node.enemyFactionId, ctx.capabilities.ids.factions) + "</div>"
          : "") +
        (node.kind === "Quest"
          ? '<div class="guided-fields">' + ref("Quest", nodeBase + ".questId", node.questId,
            ctx.draft.quests.map(quest => quest.id)) +
            button("create-node-quest", "Create Quest", ' data-node="' + nodeIndex + '"') + "</div>"
          : "") +
        (node.kind === "Reward"
          ? '<div class="guided-fields">' + field("Reward", nodeBase + ".rewardKind", node.rewardKind, "text", ctx.capabilities.enums.rewardKind) +
            field("Amount", nodeBase + ".rewardAmount", node.rewardAmount, "number") +
            ref("Content", nodeBase + ".rewardContentId", node.rewardContentId) + "</div>"
          : "") +
        (node.kind === "Shop"
          ? '<div class="guided-fields">' + field("Stock mode", nodeBase + ".shopOfferMode", node.shopOfferMode, "text", ["generated", "exact"]) + "</div>" +
            node.shopOffers.map((offer, offerIndex) => '<div class="v2-row">' +
            field("Pool", nodeBase + ".shopOffers[" + offerIndex + "].kind", offer.kind, "text", ctx.capabilities.enums.shopOfferKind) +
            ref("Item", nodeBase + ".shopOffers[" + offerIndex + "].contentId", offer.contentId) +
            field("Price", nodeBase + ".shopOffers[" + offerIndex + "].price", offer.price, "number") +
            button("remove-offer", "Remove", ' data-index="' + offerIndex + '" data-node="' + nodeIndex + '"') + "</div>").join("") +
            (node.shopOffers.length < 3 ? button("add-offer", "+ Offer", ' data-index="' + nodeIndex + '"') : "")
          : "");
    }
  } else if (step === 4) {
    body = '<div class="guided-actions">' + ctx.draft.quests.map(quest =>
      '<button type="button" class="button button-small" data-rich-action="toggle-quest" data-id="' + escapeHtml(quest.id) + '">' +
      (campaign.questIds.some(ref => ref.id === quest.id) ? "✓ " : "+ ") + escapeHtml(quest.title.default) + "</button>").join("") +
      "</div>" + (ctx.draft.quests.length ? "" : '<p class="step-copy">Create quests in the Quests category first.</p>');
  } else if (step === 5) {
    body = '<div class="guided-fields"><h4>Campaign shop pools</h4>' +
      ctx.capabilities.enums.shopPoolKind.map((kind, index) =>
        '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + base + '.settings.shopPoolKinds[' + index + ']"' +
        (campaign.settings.shopPoolKinds.includes(kind) ? " checked" : "") + '><span>' + escapeHtml(kind) + "</span></label>").join("") +
      field("Floor shop tier", floorBase + ".shopLevel", floor.shopLevel, "number") + "</div>";
  } else if (step === 6) {
    const settings = base + ".settings";
    body = '<div class="guided-fields">' +
      ref("Board character", base + ".boardPreviewUnitId", campaign.boardPreviewUnitId, ctx.capabilities.ids.units) +
      field("Starting lives", settings + ".startingLives", campaign.settings.startingLives, "number") +
      field("Starting Sardines", settings + ".startingSardines", campaign.settings.startingSardines, "number") +
      ref("Player faction", settings + ".playerFactionId", campaign.settings.playerFactionId, ctx.capabilities.ids.factions) +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + settings + '.factionSelectionEnabled"' +
      (campaign.settings.factionSelectionEnabled ? " checked" : "") + '><span>Allow faction selection</span></label>' +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + settings + '.battleShopEnabled"' +
      (campaign.settings.battleShopEnabled ? " checked" : "") + '><span>Keep battle shop enabled</span></label>' +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + settings + '.continueWithGeneratedFloors"' +
      (campaign.settings.continueWithGeneratedFloors ? " checked" : "") + '><span>Continue with generated floors</span></label>' +
      field("Initial nodes", settings + ".startingNodeCount", campaign.settings.startingNodeCount, "number") +
      field("Nodes added per floor", settings + ".nodeGrowthPerFloor", campaign.settings.nodeGrowthPerFloor, "number") +
      field("Generated Quest nodes", settings + ".questNodeCountPerRandomFloor", campaign.settings.questNodeCountPerRandomFloor, "number") +
      field("Generated Shops", settings + ".shopNodeCountPerRandomFloor", campaign.settings.shopNodeCountPerRandomFloor, "number") +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + settings + '.blessingsEnabled"' +
      (campaign.settings.blessingsEnabled ? " checked" : "") + '><span>Blessings enabled</span></label>' +
      '<label class="campaign-check"><input type="checkbox" data-v2-bool="' + settings + '.restoreArmyAfterLoss"' +
      (campaign.settings.restoreArmyAfterLoss ? " checked" : "") + '><span>Restore army after loss</span></label></div>';
  } else {
    body = '<div class="card"><h3>' + escapeHtml(campaign.name.default) + "</h3>" +
      "<p>" + campaign.floors.length + " floors · " + campaign.floors.reduce((sum, item) => sum + item.nodes.length, 0) + " authored nodes · " +
      campaign.floors.reduce((sum, item) => sum + item.routes.length, 0) + " routes</p>" +
      "<p>Quest pool: " + escapeHtml(campaign.questIds.map(ref => ref.id).join(", ") || "none") + "</p>" +
      "<p>Starting run: " + campaign.settings.startingLives + " lives · " + campaign.settings.startingSardines +
      " Sardines · board character " + escapeHtml(campaign.boardPreviewUnitId.id) + "</p>" +
      "<p>Events: " + campaign.events.length + "</p>" +
      "<h4>Floors</h4>" + campaign.floors.map(item =>
        "Floor " + item.number + ": " + item.mode + " · " + item.nodes.length + " nodes · " + item.routes.length +
        " routes · tier " + item.shopLevel).join("<br>") +
      "<h4>Campaign events</h4>" + campaign.events.map((event, eventIndex) => '<div class="v2-row">' +
        field("ID", base + ".events[" + eventIndex + "].id", event.id) +
        field("Trigger", base + ".events[" + eventIndex + "].trigger", event.trigger, "text", TRIGGERS) +
        field("Floor", base + ".events[" + eventIndex + "].floorNumber", event.floorNumber ?? "", "number") +
        field("Node", base + ".events[" + eventIndex + "].nodeId", event.nodeId ?? "") +
        button("remove-event", "Remove", ' data-index="' + eventIndex + '"') + "</div>").join("") +
      button("add-event", "+ Event") +
      '<p class="step-copy">Conditions and action parameters are in Advanced. Save / Upload and Publish are in the set list.</p></div>';
  }

  return '<p class="help-copy">Campaign work is split by task. Only the relevant floor and map controls appear in each step.</p>' +
    '<div class="guided-progress">' + steps.map((name, index) =>
      '<span class="' + (index < step ? "done" : index === step ? "current" : "") + '" title="' + escapeHtml(name) + '"></span>').join("") + "</div>" +
    '<h3>' + steps[Math.min(step, steps.length - 1)] + '</h3><section class="guided-step">' + body +
    '<div class="guided-actions">' +
    (step > 0 ? actionButton("prev-step", ' data-direction="back"') : "") +
    (step < steps.length - 1 ? actionButton("next-step", ' data-direction="next"', true) : "") +
    "</div></section>";
}

export function renderRichEditor(ctx: RichContext): string {
  if (ctx.rich.section === "quests") return questEditor(ctx);
  if (ctx.rich.section === "dialogues") return dialogueEditor(ctx);
  if (ctx.rich.section === "armies") return armyEditor(ctx);
  return campaignEditor(ctx);
}

export function richItemLabel(draft: ContentSetV2Document, section: RichState["section"], index: number): string {
  if (section === "quests") return draft.quests[index]?.title.default || draft.quests[index]?.id || String(index);
  if (section === "armies") return draft.armies[index]?.name.default || draft.armies[index]?.id || String(index);
  if (section === "dialogues") return draft.dialogues[index]?.sequenceId || String(index);
  return draft.campaigns[index]?.name.default || draft.campaigns[index]?.id || String(index);
}
