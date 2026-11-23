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

const QUEST_STEPS = ["Basics", "Objective", "Dialogue links", "Review"];

function questEditor(ctx: RichContext): string {
  const quest = ctx.draft.quests[ctx.rich.index];
  if (!quest) return "";
  const base = "quests[" + ctx.rich.index + "]";
  const step = ctx.rich.step;
  let body: string;
  if (step === 0) {
    body = '<div class="guided-fields">' +
      field("Title", base + ".title.default", quest.title.default) +
      field("ID", base + ".id", quest.id) +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      field("Description", base + ".description.default", quest.description.default) +
      "</div></details></div>";
  } else if (step === 1) {
    body = '<div class="guided-fields">' +
      field("Objective", base + ".objectiveKind", quest.objectiveKind ?? ctx.capabilities.enums.objectiveKind[0], "text", ctx.capabilities.enums.objectiveKind) +
      field("Reward", base + ".rewardKind", quest.rewardKind ?? ctx.capabilities.enums.rewardKind[0], "text", ctx.capabilities.enums.rewardKind) +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      field("Reward amount", base + ".rewardAmount", quest.rewardAmount ?? 0, "number") +
      ref("Item", base + ".itemId", quest.itemId) +
      "</div></details></div>";
  } else if (step === 2) {
    body = '<div class="guided-fields">' +
      ref("Offer dialogue", base + ".meowEdit.dialogueLinks.offer[0].id", quest.meowEdit.dialogueLinks.offer[0]) +
      ref("Active dialogue", base + ".meowEdit.dialogueLinks.active[0].id", quest.meowEdit.dialogueLinks.active[0]) +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      ref("Completion dialogue", base + ".meowEdit.dialogueLinks.completion[0].id", quest.meowEdit.dialogueLinks.completion[0]) +
      ref("Failure dialogue", base + ".meowEdit.dialogueLinks.failure[0].id", quest.meowEdit.dialogueLinks.failure[0]) +
      "</div></details></div>";
  } else {
    body = '<div class="card"><h3>' + escapeHtml(quest.title.default) + "</h3><p>" +
      "Objective: " + escapeHtml(quest.objectiveKind ?? "-") + " · Reward: " + escapeHtml(quest.rewardKind ?? "-") +
      " · Dialogue links: " + Object.values(quest.meowEdit.dialogueLinks).reduce((sum, list) => sum + list.length, 0) +
      "</p><p class=\"step-copy\">Use the Raw fields tab for timer, kill count, fetch items, battle targets and distance rules.</p></div>";
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
  const preview = node.segments.map(segment =>
    '<p class="dialogue-preview-line">' + escapeHtml(segment.text.default) + "</p>").join("");
  return '<p class="help-copy">Pick a moment on the left, write its lines and choices, then check the preview on the right.</p>' +
    '<div class="guided-actions">' + list + actionButton("add-dialogue-node", "") + "</div>" +
    '<div class="rich-columns"><section class="card"><h3>Node</h3>' +
    field("ID", nodeBase + ".id", node.id) +
    field("Headline", nodeBase + ".headline.default", node.headline.default) +
    '<h4>Speakers</h4>' + node.speakers.map((speaker, speakerIndex) => '<div class="v2-row">' +
      ref("Unit", nodeBase + ".speakers[" + speakerIndex + "].unitId", speaker.unitId, ctx.capabilities.ids.units) +
      field("Name", nodeBase + ".speakers[" + speakerIndex + "].displayName.default", speaker.displayName.default) +
      button("remove-speaker", "Remove", ' data-index="' + speakerIndex + '"') + "</div>").join("") +
    actionButton("add-speaker", "") +
    '<h4>Lines</h4>' + node.segments.map((segment, segmentIndex) => '<div class="v2-row">' +
      field("Text", nodeBase + ".segments[" + segmentIndex + "].text.default", segment.text.default) +
      button("remove-segment", "Remove", ' data-index="' + segmentIndex + '"') + "</div>").join("") +
    actionButton("add-segment", "") +
    '<h4>Choices</h4>' + node.actions.map((action, actionIndex) => '<div class="v2-row">' +
      field("Label", nodeBase + ".actions[" + actionIndex + "].label.default", action.label.default) +
      field("Target", nodeBase + ".actions[" + actionIndex + "].targetNodeId", action.targetNodeId) +
      field("Outcome", nodeBase + ".actions[" + actionIndex + "].meowEdit.decision.outcomeId", action.meowEdit.decision.outcomeId) +
      button("remove-dialogue-action", "Remove", ' data-index="' + actionIndex + '"') + "</div>").join("") +
    actionButton("add-dialogue-action", "") + "</section>" +
    '<section class="card dialogue-preview"><h3>Preview</h3>' +
    '<p class="eyebrow">' + escapeHtml(node.headline.default) + "</p>" + (preview || '<p class="step-copy">No lines yet.</p>') +
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
