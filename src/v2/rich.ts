import type { ContentSetV2Document, GameCapabilities, NamedRef } from "./types";
import { escapeHtml } from "./html";
import { TRIGGERS } from "./registries";

export interface RichState {
  section: "campaigns" | "quests" | "armies" | "dialogues";
  index: number;
  step: number;
  nodeIndex: number;
  floorIndex: number;
  selectedUnit?: string;
}

export interface RichContext {
  draft: ContentSetV2Document;
  capabilities: GameCapabilities;
  rich: RichState;
}

function options(values: readonly string[], selected: string): string {
  return values.map(value => '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + ">" + escapeHtml(value) + "</option>").join("");
}

function field(label: string, bind: string, value: unknown, type = "text", values?: readonly string[]): string {
  const control = values
    ? '<select data-v2-bind="' + bind + '">' + options(values, String(value ?? "")) + "</select>"
    : '<input type="' + type + '" data-v2-bind="' + bind + '" value="' + escapeHtml(String(value ?? "")) + '">';
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + "</span>" + control + "</label>";
}

function ref(label: string, bind: string, value: NamedRef | undefined, values?: readonly string[]): string {
  const control = values
    ? '<select data-v2-ref="' + bind + '">' + options(values, value?.id ?? "") + "</select>"
    : '<input data-v2-ref="' + bind + '" value="' + escapeHtml(value?.id ?? "") + '" placeholder="id">';
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + "</span>" + control + "</label>";
}

function button(action: string, label: string, dataset = ""): string {
  return '<button type="button" class="button button-small" data-rich-action="' + action + '"' + dataset + ">" + escapeHtml(label) + "</button>";
}

function actionButton(label: string, dataset: string, primary = false): string {
  return '<button type="button" class="button ' + (primary ? "button-primary" : "button-outline") + '" data-rich-action="' + label + '"' + dataset + ">" + escapeHtml(label.replace("-", " ")) + "</button>";
}

const QUEST_STEPS = ["Basics", "Objective", "Quest giver", "Offer", "In progress", "Reward", "Review"];

function textarea(label: string, bind: string, value: unknown): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><textarea rows="5" data-v2-bind="' + bind + '">' + escapeHtml(String(value ?? "")) + "</textarea></label>";
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
    body = '<div class="card"><h3>' + escapeHtml(quest.title.default) + "</h3>" +
      "<p>Objective: " + escapeHtml(quest.objectiveKind ?? "-") + " · Reward: " + escapeHtml(quest.rewardKind ?? "-") + "</p>" +
      "<p>Dialogue links · " + escapeHtml(links) + "</p>" +
      "<p>Minimum spacing rules: " + quest.meowEdit.minimumNodeDistances.length + " · Completion effects: " + quest.meowEdit.completionEffects.length + "</p>" +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      (["offer", "active", "completion", "failure"] as const).map(slot =>
        ref(slot + " dialogue", ext + ".dialogueLinks." + slot + "[0].id", quest.meowEdit.dialogueLinks[slot][0])).join("") +
      quest.meowEdit.completionEffects.map((effect, index) => '<div class="v2-row">' +
        field("Effect", ext + ".completionEffects[" + index + "].kind", effect.kind) +
        ref("Target", ext + ".completionEffects[" + index + "].targetId", effect.targetId) +
        button("remove-effect", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
      button("add-effect", "+ Effect") + "</div></details></div>";
  }
  return '<p class="help-copy">Each step focuses on one decision. Optional fields stay folded; use Raw fields for anything else.</p>' +
    '<div class="guided-progress">' + QUEST_STEPS.map((name, index) =>
    '<span class="' + (index < step ? "done" : index === step ? "current" : "") + '" title="' + escapeHtml(name) + '"></span>').join("") + "</div>" +
    '<h3>' + QUEST_STEPS[step] + '</h3><section class="guided-step">' + body +
    '<div class="guided-actions">' +
    (step > 0 ? actionButton("prev-step", ' data-direction="back"') : "") +
    (step < QUEST_STEPS.length - 1 ? actionButton("next-step", ' data-direction="next"', true) : "") +
    "</div></section>";
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
    '<div class="guided-actions">' + list + actionButton("add-dialogue-node", "") + "</div>" +
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
      button("remove-dialogue-action", "Remove", ' data-index="' + actionIndex + '"') + "</div>").join("") +
    actionButton("add-dialogue-action", "") + "</section>" +
    '<section class="card dialogue-preview"><div class="preview-panel-head"><span class="eyebrow">DIALOGUE PREVIEW</span>' +
    actionButton("preview-reset", "") + "</div>" +
    '<p class="eyebrow">' + escapeHtml(node.headline.default) + "</p>" + (previewLines || '<p class="step-copy">No lines yet.</p>') +
    '<div class="guided-actions">' + choices + defaultContinue + "</div>" +
    '<p class="step-copy">Only the default locale is rendered here; other locales stay in the document.</p></section></div>';
}

function armyEditor(ctx: RichContext): string {
  const army = ctx.draft.armies[ctx.rich.index];
  if (!army) return "";
  const base = "armies[" + ctx.rich.index + "]";
  const units = ctx.capabilities.ids.units;
  const cells: string[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const unitIndex = army.units.findIndex(unit => unit.x === x && unit.y === y);
      const unit = army.units[unitIndex];
      cells.push('<button type="button" class="army-cell' + (unit ? " filled" : "") + '" data-rich-action="toggle-cell" data-x="' + x + '" data-y="' + y + '"' +
        (unitIndex >= 0 ? ' data-index="' + unitIndex + '"' : "") + ' title="' + escapeHtml(unit?.unitId.id ?? "empty") + '">' +
        escapeHtml(unit ? unit.unitId.id.split("/").slice(-2, -1)[0] ?? "·" : "·") + "</button>");
    }
  }
  return '<p class="help-copy">Choose a unit, then click a grid cell to place it. Click a filled cell to remove it.</p>' +
    '<div class="rich-columns"><section class="card"><h3>Formation</h3>' +
    '<p class="step-copy">Click a cell to place or remove the selected unit.</p>' +
    '<div class="army-grid">' + cells.join("") + "</div>" +
    '<div class="guided-fields">' +
    '<label class="field"><span class="field-label">Unit to place</span><select data-rich-select="unit">' +
    options(units, ctx.rich.selectedUnit ?? "") + "</select></label>" +
    field("Name", base + ".name.default", army.name.default) + "</div></section>" +
    '<section class="card"><h3>Abilities</h3>' +
    "<h4>Spells</h4>" + army.spellIds.map((spell, index) => '<div class="v2-row">' +
      ref("Spell", base + ".spellIds[" + index + "].id", spell, ctx.capabilities.ids.spells) +
      button("remove-spell", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    actionButton("add-spell", "") +
    "<h4>Blessings</h4>" + army.blessingIds.map((blessing, index) => '<div class="v2-row">' +
      ref("Blessing", base + ".blessingIds[" + index + "].id", blessing, ctx.capabilities.ids.blessings) +
      button("remove-blessing", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    actionButton("add-blessing", "") +
    '<p class="step-copy">Cell blessing picks are available in Raw fields.</p></section></div>';
}

function campaignEditor(ctx: RichContext): string {
  const campaign = ctx.draft.campaigns[ctx.rich.index];
  if (!campaign) return "";
  const base = "campaigns[" + ctx.rich.index + "]";
  const floorIndex = Math.min(ctx.rich.floorIndex, campaign.floors.length - 1);
  const floor = campaign.floors[floorIndex];
  const floorBase = base + ".floors[" + floorIndex + "]";
  const floors = campaign.floors.map((item, index) =>
    '<button type="button" class="button button-small" data-rich-action="select-floor" data-index="' + index + '">Floor ' + item.number + "</button>").join("");
  const nodeCells: string[] = [];
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const nodeIndex = floor.nodes.findIndex(node => node.x === x && node.y === y);
      const node = floor.nodes[nodeIndex];
      nodeCells.push('<button type="button" class="campaign-cell' + (node ? " filled" : "") + '" data-rich-action="toggle-node" data-x="' + x + '" data-y="' + y + '"' +
        (nodeIndex >= 0 ? ' data-index="' + nodeIndex + '"' : "") + ' title="' + escapeHtml(node?.id ?? "empty") + '">' +
        escapeHtml(node ? node.kind.slice(0, 1) : "·") + "</button>");
    }
  }
  return '<div class="guided-actions">' + floors + actionButton("add-floor", "") + "</div>" +
    '<div class="rich-columns"><section class="card"><h3>Floor ' + floor.number + '</h3>' +
    '<div class="campaign-grid">' + nodeCells.join("") + "</div>" +
    '<div class="guided-fields">' + field("Name", base + ".name.default", campaign.name.default) +
    field("Floor mode", floorBase + ".mode", floor.mode, "text", ctx.capabilities.enums.floorMode) +
    ref("Board character", base + ".boardPreviewUnitId", campaign.boardPreviewUnitId, ctx.capabilities.ids.units) + "</div>" +
    '<h4>Routes</h4>' + floor.routes.map((route, index) => '<div class="v2-row">' +
      field("From", floorBase + ".routes[" + index + "].fromNodeId", route.fromNodeId) +
      field("To", floorBase + ".routes[" + index + "].toNodeId", route.toNodeId) +
      button("remove-route", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    actionButton("add-route", "") + "</section>" +
    '<section class="card"><h3>Events</h3>' + campaign.events.map((event, index) => '<div class="v2-row">' +
      field("ID", base + ".events[" + index + "].id", event.id) +
      field("Trigger", base + ".events[" + index + "].trigger", event.trigger, "text", TRIGGERS) +
      button("remove-event", "Remove", ' data-index="' + index + '"') + "</div>").join("") +
    actionButton("add-event", "") +
    '<p class="step-copy">Conditions and action parameters are available in Raw fields.</p></section></div>';
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
