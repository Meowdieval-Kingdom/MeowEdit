import type {
  FaceMood,
  DialogueAction,
  DialogueNode,
  DialogueRecord,
  ArmyCatalog,
  ArmyCatalogAbility,
  ArmyCatalogLevel,
  ArmyCatalogUnit,
  ArmyRecord,
  ArmyUnitPlacement,
  MissionFloor,
  MissionRecord,
  MissionNode,
  MissionRoute,
  MissionFloorMode,
  MissionShopOfferKind,
  AdventureNodeKind,
  QuestRecord,
  UnitRoster,
  Workspace
} from "./model";
import { dialogueActionsForNode, dialogueMomentName } from "./model";
import { armyFootprint, armyGridSize, resolveArmyLevel, type ArmyCatalogKind } from "./army-catalog";
import { canPublish, getBridgeUserId } from "../bridge-context";
import type { ValidationIssue } from "./validation";
import { validateMission, validateDialogue, validateQuest } from "./validation";

export type EditorMode = "guided" | "full";
export type ArmyAbilityFilters = Record<"spells" | "blessings" | "curses", "all" | "field">;
export type ArmyAbilityKind = "spells" | "blessings" | "curses";
export type ArmyAbilitySelections = Record<ArmyAbilityKind, string>;
const defaultArmyAbilityFilters: ArmyAbilityFilters = { spells: "all", blessings: "all", curses: "all" };
const defaultArmyAbilitySelections: ArmyAbilitySelections = { spells: "", blessings: "", curses: "" };

export interface RelatedEditorReturnState {
  parent: "Mission" | "Quest";
  label: string;
}

export interface MissionViewState {
  selectedFloorId: string | null;
  selectedNodeId: string | null;
  interactionMode: "select" | "add";
  nodeKind: AdventureNodeKind;
  addMenuOpen: boolean;
  pendingPlugFromId: string | null;
  selectedRouteId: string | null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function inputField(
  label: string,
  path: string,
  value: unknown,
  options: { type?: string; hint?: string; min?: number; max?: number; step?: number; placeholder?: string; rerender?: boolean; readOnly?: boolean } = {}
): string {
  const type = options.type ?? "text";
  const numericAttrs = type === "number"
    ? ' min="' + (options.min ?? 0) + '"' +
      (options.max === undefined ? "" : ' max="' + options.max + '"') +
      ' step="' + (options.step ?? 1) + '"'
    : "";
  return '<label class="field">' +
    '<span class="field-label">' + escapeHtml(label) + '</span>' +
    '<input type="' + type + '" data-bind="' + escapeHtml(path) + '"' +
    (options.readOnly ? ' readonly' : '') +
    numericAttrs +
    (options.rerender ? ' data-rerender="true"' : "") +
    (options.placeholder ? ' placeholder="' + escapeHtml(options.placeholder) + '"' : "") +
    ' value="' + escapeHtml(value) + '">' +
    (options.hint ? '<span class="field-hint help-copy">' + escapeHtml(options.hint) + '</span>' : "") +
    '</label>';
}

function textAreaField(label: string, path: string, value: unknown, hint = "", rows = 3): string {
  return '<label class="field">' +
    '<span class="field-label">' + escapeHtml(label) + '</span>' +
    '<textarea rows="' + rows + '" data-bind="' + escapeHtml(path) + '">' + escapeHtml(value) + '</textarea>' +
    (hint ? '<span class="field-hint help-copy">' + escapeHtml(hint) + '</span>' : "") +
    '</label>';
}

function selectField(
  label: string,
  path: string,
  value: string | number,
  options: Array<[string, string]>,
  hint = "",
  rerender = false,
  optionalNumber = false
): string {
  const optionMarkup = options.map(([optionValue, optionLabel]) =>
    '<option value="' + escapeHtml(optionValue) + '"' +
    (String(value) === optionValue ? " selected" : "") +
    '>' + escapeHtml(optionLabel) + '</option>'
  ).join("");
  return '<label class="field">' +
    '<span class="field-label">' + escapeHtml(label) + '</span>' +
    '<select data-bind="' + escapeHtml(path) + '"' +
    (typeof value === "number" ? ' data-number="true"' : "") +
    (optionalNumber ? ' data-optional-number="true"' : "") +
    (rerender ? ' data-rerender="true"' : "") + '>' + optionMarkup + '</select>' +
    (hint ? '<span class="field-hint help-copy">' + escapeHtml(hint) + '</span>' : "") +
    '</label>';
}

function pickerField(id: string, label: string, value: string | number, options: Array<[string, string, string?]>): string {
  const optionMarkup = options.map(([optionValue, optionLabel, title]) =>
    '<option value="' + escapeHtml(optionValue) + '"' + (String(value) === optionValue ? " selected" : "") +
    (title ? ' title="' + escapeHtml(title) + '"' : "") + '>' + escapeHtml(optionLabel) + '</option>'
  ).join("");
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><select id="' + escapeHtml(id) + '">' + optionMarkup + '</select></label>';
}

function toggleField(label: string, path: string, value: boolean, hint = ""): string {
  return '<label class="toggle-field">' +
    '<span><strong>' + escapeHtml(label) + '</strong>' +
    (hint ? '<small class="help-copy">' + escapeHtml(hint) + '</small>' : "") +
    '</span>' +
    '<input type="checkbox" data-bind="' + escapeHtml(path) + '"' + (value ? " checked" : "") + '>' +
    '<span class="toggle-track" aria-hidden="true"></span>' +
    '</label>';
}

function actionButton(action: string, label: string, className = "button button-quiet", extra = ""): string {
  return '<button type="button" class="' + className + '" data-action="' + action + '"' + extra + '>' + label + '</button>';
}

function emptyOption(options: Array<[string, string]>, value: string): Array<[string, string]> {
  return value && !options.some(([candidate]) => candidate === value)
    ? [[value, value + " (not in roster)"], ...options]
    : options;
}

function unitOptions(roster: UnitRoster): Array<[string, string]> {
  return roster.units.map(unit => [
    unit.id,
    unit.displayName + (unit.level ? " · Level " + unit.level : "") + " · " + unit.faction
  ]);
}

function unitPicker(label: string, path: string, value: string, roster: UnitRoster, hint = ""): string {
  const options: Array<[string, string]> = [["", "Narration · no character"], ...unitOptions(roster)];
  return selectField(label, path, value, emptyOption(options, value), hint, true);
}

function speakerNameField(
  label: string,
  path: string,
  value: string,
  unitId: string,
  roster: UnitRoster,
  lockedToRosterName = false
): string {
  const unit = roster.units.find(candidate => candidate.id === unitId);
  if (!lockedToRosterName || !unit) {
    return inputField(label, path, value, {
      placeholder: "Name shown in dialogue",
      hint: unit ? "Filled from the selected character; edit it if the dialogue uses another name." : "Choose a character to fill this name automatically."
    });
  }
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span>' +
    '<output class="field-output">' + escapeHtml(unit.displayName) + '</output>' +
    '<span class="field-hint help-copy">Filled from the selected character.</span></label>';
}

function selectedItem(workspace: Workspace): DialogueRecord | QuestRecord | ArmyRecord | MissionRecord | null {
  if (!workspace.selectedType || !workspace.selectedKey) return null;
  if (workspace.selectedType === "dialogue") return workspace.dialogues.find(item => item.key === workspace.selectedKey) ?? null;
  if (workspace.selectedType === "quest") return workspace.quests.find(item => item.key === workspace.selectedKey) ?? null;
  if (workspace.selectedType === "army") return workspace.armies.find(item => item.key === workspace.selectedKey) ?? null;
  return workspace.missions.find(item => item.key === workspace.selectedKey) ?? null;
}

function renderDocList(workspace: Workspace, type: "dialogue" | "quest"): string {
  const items = type === "dialogue" ? workspace.dialogues : workspace.quests;
  if (items.length === 0) {
    return '<p class="sidebar-empty">No ' + (type === "dialogue" ? "dialogues" : "quests") + ' yet.</p>';
  }
  return items.map(item => {
    const dialogue = type === "dialogue" ? item as DialogueRecord : null;
    const quest = type === "quest" ? item as QuestRecord : null;
    const startNode = dialogue?.sequence.nodes.find(node => node.id === dialogue.sequence.startNodeId);
    const label = dialogue
      ? (startNode ? dialogueMomentName(dialogue.sequence, startNode) : humanizeIdentifier(dialogue.sequence.sequenceId))
      : quest!.definition.title || quest!.definition.id;
    const subtitle = dialogue
      ? (dialogue.sequence.nodes.length + " nodes")
      : (quest!.definition.objectiveKind === "Timer" ? "Timer project" : quest!.definition.objectiveKind);
    const active = workspace.selectedType === type && workspace.selectedKey === item.key;
    return '<div class="doc-item-row">' +
      '<button type="button" class="doc-item' + (active ? " is-active" : "") + '" data-action="select-item" data-type="' + type + '" data-key="' + escapeHtml(item.key) + '">' +
      '<span class="doc-item-text"><strong>' + escapeHtml(label || "Untitled") + '</strong><small>' + escapeHtml(subtitle) + '</small></span>' +
      '</button>' +
      '<button type="button" class="doc-item-remove" data-action="delete-item" data-type="' + type + '" data-key="' + escapeHtml(item.key) + '" aria-label="Remove ' + type + ': ' + escapeHtml(label || "Untitled") + '" title="Remove ' + escapeHtml(label || "Untitled") + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 4.5v-1h4v1m-5.5 0 .6 8h5.8l.6-8M6.5 6.5v4.5m3-4.5v4.5"/></svg></button>' +
      '</div>';
  }).join("");
}


function renderContextSidebar(workspace: Workspace): string {
  const link = (section: string, key: string, label: string, depth: number) =>
    '<button type="button" class="context-item context-depth-' + depth + '" data-action="editor-switch-tab" data-section="' +
    escapeHtml(section) + '" data-key="' + escapeHtml(key) + '">' + escapeHtml(label) + '</button>';
  const missionItems = workspace.missions.map(mission => {
    const questLinks = mission.questIds.flatMap(id => {
      const quest = workspace.quests.find(item => item.definition.id === id);
      if (!quest) return [];
      const dialogues = Object.values(quest.extension.dialogueLinks ?? {}).flat().flatMap(ref => {
        const id = typeof ref === "string" ? ref : (ref as { id?: string })?.id;
        const dialogue = workspace.dialogues.find(item => item.sequence.sequenceId === id || item.key === id);
        return dialogue ? [link("dialogues", dialogue.key, dialogue.sequence.sequenceId || dialogue.key, 3)] : [];
      });
      return [link("quests", quest.key, quest.definition.title || quest.definition.id, 2), ...dialogues];
    });
    const armyIds = [
      ...mission.floors.flatMap(floor => floor.nodes.map(node => node.armyId).filter(Boolean)),
      ...mission.events.flatMap(event => event.actions.map(action => String(action.armyId ?? ""))).filter(Boolean)
    ];
    const armyLinks = [...new Set(armyIds)].flatMap(id => {
      const army = workspace.armies.find(item => item.id === id || item.key === id);
      return army ? [link("armies", army.key, army.name || army.id, 2)] : [];
    });
    return link("missions", mission.key, mission.name || mission.id, 1) + questLinks.join("") + armyLinks.join("");
  }).join("");
  const standalone = ([
    ...workspace.quests.filter(quest => !workspace.missions.some(mission => mission.questIds.includes(quest.definition.id)))
      .map(quest => link("quests", quest.key, quest.definition.title || quest.definition.id, 1)),
    ...workspace.dialogues.map(dialogue => link("dialogues", dialogue.key, dialogue.sequence.sequenceId || dialogue.key, 1)),
    ...workspace.armies.map(army => link("armies", army.key, army.name || army.id, 1))
  ]).join("");
  return '<aside class="context-sidebar"><div class="context-heading"><strong>Set context</strong>' +
    '<button type="button" class="icon-button" data-action="toggle-context" aria-label="Collapse context">×</button></div>' +
    '<div class="context-list">' + (missionItems || '<p class="sidebar-empty">No missions yet.</p>') +
    (standalone ? '<div class="context-divider">Other content</div>' + standalone : "") + '</div></aside>';
}

function renderContentPicker(workspace: Workspace): string {
  return '<dialog class="content-picker-dialog" id="content-picker-dialog"><header><div><h2>Open a draft</h2></div><button type="button" class="icon-button" data-action="close-content-picker" aria-label="Close draft picker">×</button></header>' +
    '<div class="content-picker-groups"><section><h3>Dialogues</h3>' + renderDocList(workspace, "dialogue") + '</section>' +
    '<section><h3>Quests</h3>' + renderDocList(workspace, "quest") + '</section>' +
    '<section><h3>Armies</h3>' + renderArmyDocList(workspace) + '</section>' +
    '<section><h3>Missions</h3>' + renderMissionDocList(workspace) + '</section></div></dialog>';
}

function renderMissionDocList(workspace: Workspace): string {
  if (workspace.missions.length === 0) return '<p class="sidebar-empty">No missions yet.</p>';
  return workspace.missions.map(mission => {
    const active = workspace.selectedType === "mission" && workspace.selectedKey === mission.key;
    const nodeCount = mission.floors.reduce((total, floor) => total + floor.nodes.length, 0);
    return '<div class="doc-item-row">' +
      '<button type="button" class="doc-item' + (active ? " is-active" : "") + '" data-action="select-item" data-type="mission" data-key="' + escapeHtml(mission.key) + '">' +
      '<span class="doc-item-text"><strong>' + escapeHtml(mission.name || mission.id || "Untitled mission") + '</strong><small>' + mission.floors.length + ' floors · ' + nodeCount + ' placed nodes</small></span>' +
      '</button>' +
      '<button type="button" class="doc-item-remove" data-action="delete-item" data-type="mission" data-key="' + escapeHtml(mission.key) + '" aria-label="Remove mission: ' + escapeHtml(mission.name || mission.id || "Untitled") + '" title="Remove mission">' + trashIcon() + '</button>' +
      '</div>';
  }).join("");
}

function renderArmyDocList(workspace: Workspace): string {
  if (workspace.armies.length === 0) return '<p class="sidebar-empty">No armies yet.</p>';
  return workspace.armies.map(army => {
    const active = workspace.selectedType === "army" && workspace.selectedKey === army.key;
    return '<div class="doc-item-row">' +
      '<button type="button" class="doc-item' + (active ? " is-active" : "") + '" data-action="select-item" data-type="army" data-key="' + escapeHtml(army.key) + '">' +
      '<span class="doc-item-text"><strong>' + escapeHtml(army.name || army.id || "Untitled army") + '</strong><small>' + army.units.length + ' units · ' + escapeHtml(army.id) + '</small></span>' +
      '</button>' +
      '<button type="button" class="doc-item-remove" data-action="delete-item" data-type="army" data-key="' + escapeHtml(army.key) + '" aria-label="Remove army: ' + escapeHtml(army.name || army.id || "Untitled") + '" title="Remove army">' + trashIcon() + '</button>' +
      '</div>';
  }).join("");
}

function trashIcon(): string {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 4.5v-1h4v1m-5.5 0 .6 8h5.8l.6-8M6.5 6.5v4.5m3-4.5v4.5"/></svg>';
}

function renderNodeChoices(
  action: DialogueAction,
  path: string,
  record: DialogueRecord
): string {
  const options: Array<[string, string]> = [["", "End dialogue · close this conversation"]];
  for (const candidate of record.sequence.nodes) {
    const label = candidate.id === record.sequence.startNodeId
      ? "Start · " + dialogueMomentName(record.sequence, candidate)
      : dialogueMomentName(record.sequence, candidate);
    options.push([candidate.id, label]);
  }
  return selectField("Next", path, action.targetNodeId, emptyOption(options, action.targetNodeId), "Choosing Start begins again at the dialogue entry. End dialogue closes this conversation.", true);
}

function renderDefaultContinue(node: DialogueNode, nodeIndex: number, record: DialogueRecord): string {
  const next = node.continueTargetNodeId !== undefined
    ? record.sequence.nodes.find(candidate => candidate.id === node.continueTargetNodeId)
    : record.sequence.nodes[nodeIndex + 1];
  const destination = next
    ? 'Moves to “' + dialogueMomentName(record.sequence, next) + '”.'
    : "Closes the conversation after this moment.";
  return '<div class="default-continue">' +
    '<div class="default-continue-heading"><span class="continue-mark">↳</span><span><strong>Continue button</strong><small class="help-copy">Always shown when this moment has no choices.</small></span></div>' +
    '<div class="form-grid two guided-fields">' +
    inputField("Button text", "nodes." + nodeIndex + ".continueLabel", node.continueLabel || "Continue", { placeholder: "Continue" }) +
    '<div class="continue-destination"><span class="field-label">When pressed</span><span>' + escapeHtml(destination) + '</span></div>' +
    '</div></div>';
}

function renderActionCard(
  action: DialogueAction,
  nodeIndex: number,
  actionIndex: number,
  record: DialogueRecord
): string {
  const path = "nodes." + nodeIndex + ".actions." + actionIndex;
  const decision = action.decision;
  return '<div class="action-card">' +
    '<div class="action-card-top"><span class="choice-index">' + String(actionIndex + 1).padStart(2, "0") + '</span><span>Choice label and destination</span>' +
    actionButton("remove-action", "×", "icon-button danger", ' data-node-index="' + nodeIndex + '" data-index="' + actionIndex + '" aria-label="Remove choice" title="Remove choice"') +
    '</div>' +
    '<div class="form-grid two">' +
    inputField("Button label", path + ".label", action.label, { placeholder: actionIndex === 0 ? "Continue" : "Choose…" }) +
    renderNodeChoices(action, path + ".targetNodeId", record) +
    '</div>' +
    (decision
      ? '<div class="decision-box"><div class="decision-heading"><span class="decision-icon">↳</span><strong>Save a one-time decision</strong>' +
        actionButton("toggle-decision", "Remove result", "text-button", ' data-node-index="' + nodeIndex + '" data-index="' + actionIndex + '" aria-label="Remove saved decision"') +
        '</div><div class="form-grid two">' +
    inputField("Decision ID", path + ".decision.id", decision.id, { placeholder: "decision-id" }) +
    inputField("Decision name", path + ".decision.label", decision.label, { placeholder: "Decision name" }) +
        inputField("Outcome ID", path + ".decision.outcomeId", decision.outcomeId, { placeholder: "pay-now" }) +
        inputField("Outcome name", path + ".decision.outcomeLabel", decision.outcomeLabel, { placeholder: "Pay now" }) +
        '</div><p class="field-hint help-copy">The game records this result once for the run. Another choice in the same dialogue can use the same decision ID with a different outcome.</p></div>'
      : actionButton("toggle-decision", "＋ Save a named result", "text-button", ' data-node-index="' + nodeIndex + '" data-index="' + actionIndex + '"')) +
    '</div>';
}

function renderSegment(
  node: DialogueNode,
  segmentIndex: number,
  nodeIndex: number
): string {
  const segment = node.segments[segmentIndex];
  const options: Array<[string, string]> = [["", "Narration"]];
  if (node.speakers.length === 1) {
    options.push([node.speakers[0].id, node.speakers[0].displayName || "Speaker"]);
  } else if (node.speakers.length === 2) {
    options.push([node.speakers[0].id, node.speakers[0].displayName || "Left speaker"]);
    options.push([node.speakers[1].id, node.speakers[1].displayName || "Right speaker"]);
    options.push([
      node.speakers[0].id + "," + node.speakers[1].id,
      (node.speakers[0].displayName || "Left") + " + " + (node.speakers[1].displayName || "Right") + " · unison"
    ]);
  }
  return '<div class="segment-row">' +
    '<div class="segment-row-heading"><span>' + String(segmentIndex + 1).padStart(2, "0") + '</span>' +
    actionButton("remove-segment", "Remove line", "text-button danger-text", ' data-node-index="' + nodeIndex + '" data-index="' + segmentIndex + '" aria-label="Remove text segment"') +
    '</div>' +
    '<div class="form-grid two segment-fields">' +
    selectField("Who speaks?", "nodes." + nodeIndex + ".segments." + segmentIndex + ".speakerIds", segment.speakerIds.join(","), options, "Select both speakers for a shared or interrupted line.", true) +
    textAreaField("Line", "nodes." + nodeIndex + ".segments." + segmentIndex + ".text", segment.text, "", 3) +
    '</div></div>';
}

function renderDialogueNodeEditor(
  record: DialogueRecord,
  node: DialogueNode,
  nodeIndex: number,
  roster: UnitRoster,
  step: number,
  workspace: Workspace
): string {
  if (step === -1) {
    return [0, 1, 2, 3, 4].map(sectionStep => renderDialogueNodeEditor(record, node, nodeIndex, roster, sectionStep, workspace)).join("");
  }

  const speakerMarkup = node.speakers.map((speaker, speakerIndex) => {
    const prefix = "nodes." + nodeIndex + ".speakers." + speakerIndex;
    return '<div class="speaker-row">' +
      '<div class="speaker-row-heading"><span class="speaker-side ' + speaker.side + '">' + (speaker.side === "left" ? "L" : "R") + '</span><strong>' + (speaker.side === "left" ? "Left speaker" : "Right speaker") + '</strong>' +
      actionButton("remove-speaker", "Remove", "text-button danger-text", ' data-node-index="' + nodeIndex + '" data-index="' + speakerIndex + '" aria-label="Remove speaker"') +
      '</div>' +
      '<div class="form-grid two speaker-fields">' +
      unitPicker("Character", prefix + ".unitId", speaker.unitId, roster, "Choose by character name; the UnitCatalog ID is stored for the game.") +
      speakerNameField("Display name", prefix + ".displayName", speaker.displayName, speaker.unitId, roster) +
      selectField("Portrait side", prefix + ".side", speaker.side, [["left", "Left"], ["right", "Right"]], "", true) +
      selectField("Mood", prefix + ".mood", speaker.mood, [
        ["Normal", "Normal"], ["Cute", "Cute"], ["Sleeping", "Sleeping"],
        ["Hurt", "Hurt"], ["Confused", "Confused"], ["Mad", "Mad"]
      ], "", true) +
      '</div></div>';
  }).join("");

  const actions = node.actions.length
    ? node.actions.map((action, actionIndex) => renderActionCard(action, nodeIndex, actionIndex, record)).join("")
    : renderDefaultContinue(node, nodeIndex, record);

  if (step === 0) {
    return '<div class="form-block" id="dialogue-sequence">' +
      '<div class="section-heading"><div><h2>Set up this conversation</h2></div></div>' +
      '<div class="form-grid two">' +
      inputField("Dialogue ID (system managed)", "sequenceId", record.sequence.sequenceId, { readOnly: true, hint: "Generated automatically; cannot be changed." }) +
      selectField("Dialogue opens at", "startNodeId", record.sequence.startNodeId, record.sequence.nodes.map(candidate => [candidate.id, candidate.id === record.sequence.startNodeId ? "Start · " + dialogueMomentName(record.sequence, candidate) : dialogueMomentName(record.sequence, candidate)] as [string, string]), "Playback begins here. Start is a role, not a reserved node ID.", true) +
      selectField("Gameplay", "pauseMode", record.sequence.pauseMode, [["pause", "Pause while dialogue plays"], ["continue", "Continue during dialogue"]]) +
      inputField("Default text speed", "defaultCharactersPerSecond", record.sequence.defaultCharactersPerSecond, { type: "number", min: 1, max: 200, hint: "Characters per second." }) +
      '</div></div>' +
      '<div class="form-block" id="dialogue-moment">' +
      '<div class="section-heading"><div><h2>Moment settings</h2></div></div>' +
      '<div class="form-grid three">' +
      inputField("Node ID", "nodes." + nodeIndex + ".id", node.id, { placeholder: "start" })
        .replace('data-bind="nodes.' + nodeIndex + '.id"', 'data-bind="nodes.' + nodeIndex + '.id" data-rerender="true"') +
      inputField("Moment name (optional)", "nodes." + nodeIndex + ".editorLabel", node.editorLabel ?? "", { placeholder: dialogueMomentName(record.sequence, node) }) +
      inputField("In-game headline", "nodes." + nodeIndex + ".headline", node.headline, { placeholder: "Shown above the dialogue text" }) +
      selectField("Text speed", "nodes." + nodeIndex + ".textSpeed", node.textSpeed, [["default", "Default"], ["fast", "Fast"], ["slow", "Slow"]], "Uses the sequence speed above.") +
      '</div></div>';
  }

  if (step === 1) {
    return '<div class="form-block" id="dialogue-speakers">' +
      '<div class="section-heading"><div><h2>Choose who appears</h2><p class="help-copy">Portraits are rendered by the game from the selected unit and mood.</p></div>' +
      (node.speakers.length < 2 ? actionButton("add-speaker", "＋ Add speaker", "button button-small", ' data-node-index="' + nodeIndex + '"') : '<span class="field-hint">Both portrait slots are in use.</span>') +
      '</div>' +
      (speakerMarkup || '<div class="soft-empty">No character portraits. This node will use narration layout.</div>') +
      '</div>';
  }

  if (step === 2) {
    return '<div class="form-block" id="dialogue-lines">' +
      '<div class="section-heading"><div><h2>Write the lines</h2><p class="help-copy">Segments appear together as one body of text. The game shifts the speaker headline and emphasis as each segment is read.</p></div>' +
      actionButton("add-segment", "＋ Add line", "button button-small", ' data-node-index="' + nodeIndex + '"') +
      '</div>' +
      (node.segments.length ? node.segments.map((_, index) => renderSegment(node, index, nodeIndex)).join("") : '<div class="soft-empty">Add a line to start this node.</div>') +
      '</div>';
  }

  if (step === 3) {
    return '<div class="form-block" id="dialogue-choices">' +
      '<div class="section-heading"><div><h2>Continue or branch</h2><p class="help-copy">Every moment has a Continue button. Add choices to replace it; choosing End dialogue closes the conversation.</p></div>' +
      actionButton("add-action", node.actions.length ? "＋ Add another choice" : "＋ Replace Continue with choices", "button button-small", ' data-node-index="' + nodeIndex + '"') +
      '</div>' + actions +
      '</div>';
  }

  return '<div class="form-block preview-step" id="dialogue-preview">' + renderDialoguePreview(record, workspace, roster) + '</div>';
}

function avatarMarkup(
  unitId: string,
  side: "left" | "right",
  roster: UnitRoster,
  mood: string
): string {
  const unit = roster.units.find(candidate => candidate.id === unitId);
  const portrait = unit?.portraitCaptures?.[mood as FaceMood] || unit?.portrait;
  return '<div class="game-avatar avatar-' + side + '" aria-hidden="true">' +
    '<img class="game-avatar-frame-back" src="./game-preview/shopframeback.png" alt="">' +
    '<span class="game-avatar-mask">' + (portrait
      ? '<img class="game-avatar-portrait" src="' + escapeHtml(portrait) + '" alt="">'
      : '<span class="game-avatar-empty"></span>') + '</span>' +
    '<img class="game-avatar-frame-front" src="./game-preview/shopframefront.png" alt="">' +
    '</div>';
}

function renderAdvancedSectionNav(sections: Array<{ id: string; label: string }>): string {
  return '<nav class="advanced-section-nav" aria-label="Jump to editor section">' +
    sections.map(section => '<button type="button" data-action="jump-section" data-section="' +
      escapeHtml(section.id) + '">' + escapeHtml(section.label) + '</button>').join("") +
    '</nav>';
}

function renderWorkflowFooter(steps: string[], activeStep: number, completeCopy = "Review complete · ready to export"): string {
  const previous = activeStep > 0
    ? actionButton("editor-back", "← Back", "button button-outline")
    : '<button type="button" class="button button-outline" disabled>← Back</button>';
  const next = activeStep < steps.length - 1
    ? actionButton("editor-next", "Next · " + escapeHtml(steps[activeStep + 1]) + " →", "button button-primary")
    : '<span class="workflow-complete">' + escapeHtml(completeCopy) + '</span>';
  return '<footer class="workflow-footer">' + previous +
    '<span>Step ' + (activeStep + 1) + ' of ' + steps.length + '</span>' + next +
    '</footer>';
}

function renderDialogueMap(activeNodeId: string, addAction = "guided-add-node"): string {
  return '<section class="guided-moment-map" aria-label="Dialogue map">' +
    '<div class="moment-map-heading"><span>Dialogue map</span><div class="moment-map-tools">' +
    '<span class="graph-plug-key" data-dialogue-graph-connect-status role="status" aria-live="polite"><i aria-hidden="true"></i><span data-dialogue-graph-connect-message>Drag or tap plugs to connect</span></span>' +
    actionButton("dialogue-graph-arrange", "↙ Compact", "graph-layout-button", ' aria-label="Compact layout" title="Compact layout"') +
    '<div class="graph-zoom-tools" aria-label="Map zoom controls">' +
    actionButton("dialogue-graph-zoom-out", "−", "graph-zoom-button", ' aria-label="Zoom out" title="Zoom out"') +
    actionButton("dialogue-graph-zoom-reset", "100%", "graph-zoom-button graph-zoom-reset", ' aria-label="Reset zoom" title="Reset zoom"') +
    actionButton("dialogue-graph-zoom-in", "+", "graph-zoom-button", ' aria-label="Zoom in" title="Zoom in"') +
    '</div>' + actionButton(addAction, "＋ Add moment", "text-button guided-add-moment") + '</div></div>' +
    '<div class="dialogue-node-graph" data-dialogue-node-graph data-active-node-id="' + escapeHtml(activeNodeId) + '" role="application" aria-label="Interactive dialogue node graph"></div>' +
    '<p class="dialogue-graph-hint help-copy">Drag a plug to connect, or tap a route plug then its destination. Drag empty space to pan.</p>' +
    '</section>';
}

function helpToggleButton(helpVisible: boolean): string {
  return actionButton("toggle-help", helpVisible ? "Hide help" : "Help", "text-button help-toggle",
    ' aria-pressed="' + String(helpVisible) + '" aria-label="' + (helpVisible ? "Hide help text" : "Show help text") + '" title="' + (helpVisible ? "Hide help text" : "Show help text") + '"');
}

function renderGuidedEditorHeader(context: string, title = "", returnState?: RelatedEditorReturnState, helpVisible = false): string {
  return '<header class="guided-editor-header"><span class="guided-focus-brand">' +
    escapeHtml(context) + '</span>' +
    (title ? '<span class="guided-header-title">' + escapeHtml(title) + '</span>' : "") +
    '<span class="guided-header-actions">' +
    (returnState ? actionButton("return-to-parent", "← " + escapeHtml(returnState.label), "button button-return", ' aria-label="Return to ' + escapeHtml(returnState.parent) + '" title="Return to ' + escapeHtml(returnState.parent) + '"') : "") +
    helpToggleButton(helpVisible) +
    actionButton("open-full-editor", "Advanced editor", "button button-mode-secondary") +
    '</span>' +
    '</header>';
}

export function renderDialoguePreview(
  record: DialogueRecord,
  workspace: Workspace,
  roster: UnitRoster
): string {
  const current = record.sequence.nodes.find(node => node.id === workspace.activeNodeId) ??
    record.sequence.nodes.find(node => node.id === record.sequence.startNodeId) ??
    record.sequence.nodes[0];
  if (!current) {
    return '<aside class="preview-panel" id="live-preview"><div class="preview-panel-head"><span class="eyebrow">DIALOGUE PREVIEW</span></div><div class="preview-empty">Add a node to see the dialogue preview.</div></aside>';
  }
  const speakers = current.speakers;
  const left = speakers.find(speaker => speaker.side === "left");
  const right = speakers.find(speaker => speaker.side === "right");
  const visibleLeft = left?.unitId ? left : undefined;
  const visibleRight = right?.unitId ? right : undefined;
  const layout = visibleLeft && visibleRight ? "two" : visibleLeft ? "left" : visibleRight ? "right" : "none";
  const firstSpeakerNames = (current.segments[0]?.speakerIds ?? [])
    .map(id => speakers.find(speaker => speaker.id === id)?.displayName || id)
    .filter(Boolean);
  const headline = current.headline || [...new Set(firstSpeakerNames)].join(" & ");
  const body = current.segments.map(segment => segment.text.trim()).filter(Boolean).join(" ");
  const actions = dialogueActionsForNode(record.sequence, current);
  const missingPortrait = [visibleLeft, visibleRight]
    .filter((speaker): speaker is NonNullable<typeof speaker> => Boolean(speaker))
    .some(speaker => {
      const unit = roster.units.find(candidate => candidate.id === speaker.unitId);
      return !unit?.portraitCaptures?.[speaker.mood as FaceMood] && !unit?.portrait;
    });
  const caption = missingPortrait
    ? "No captured portrait is registered for this character yet. Import a UnitAvatar portrait PNG into the roster to show it here."
    : "Panel geometry, fonts, parchment, and choice buttons use current game assets.";
  return '<aside class="preview-panel" id="live-preview">' +
    '<div class="preview-panel-head"><div><span class="eyebrow">DIALOGUE PREVIEW</span><strong>' + escapeHtml(dialogueMomentName(record.sequence, current)) + '</strong></div><button type="button" class="text-button" data-action="preview-reset">↺ Start over</button></div>' +
    '<div class="game-preview-scroll"><div class="game-screen" data-layout="' + layout + '">' +
    '<div class="game-dimmer"></div>' +
    '<section class="game-dialogue-panel" data-layout="' + layout + '">' +
    '<div class="game-panel-content">' +
    (visibleLeft ? avatarMarkup(visibleLeft.unitId, "left", roster, visibleLeft.mood) : "") +
    (visibleRight ? avatarMarkup(visibleRight.unitId, "right", roster, visibleRight.mood) : "") +
    '<h3 class="game-headline">' + escapeHtml(headline) + '</h3>' +
    '<p class="game-body">' + escapeHtml(body || " ") + '</p>' +
    '<div class="game-actions">' + actions.map(action =>
      '<button type="button" class="' + ((action.label || "Continue").length > 16 ? 'is-long-label' : '') + '" data-action="preview-choice" data-target="' + escapeHtml(action.targetNodeId) + '">' +
      escapeHtml(action.label || "Continue") +
      '</button>'
    ).join("") + '</div>' +
    '</div></section></div></div>' +
    '<p class="preview-note help-copy">' + escapeHtml(caption) + ' The dimmed background represents the current game scene, which Unity supplies at runtime.</p>' +
    '</aside>';
}

function renderDialogueEditor(
  record: DialogueRecord,
  workspace: Workspace,
  roster: UnitRoster,
  activeStep: number,
  mode: EditorMode,
  returnState?: RelatedEditorReturnState,
  helpVisible = false
): string {
  if (mode === "guided") return renderGuidedDialogueEditor(record, workspace, roster, activeStep, returnState, helpVisible);

  const nodeIndex = Math.max(0, record.sequence.nodes.findIndex(node => node.id === workspace.activeNodeId));
  const node = record.sequence.nodes[nodeIndex];
  const startNode = record.sequence.nodes.find(candidate => candidate.id === record.sequence.startNodeId);
  const displayTitle = startNode ? dialogueMomentName(record.sequence, startNode) : humanizeIdentifier(record.sequence.sequenceId) || "Dialogue";
  const issues = validateDialogue(record);
  const sections = [
    { id: "dialogue-sequence", label: "Sequence" }, { id: "dialogue-moment", label: "Moment" },
    { id: "dialogue-speakers", label: "Speakers" }, { id: "dialogue-lines", label: "Lines" },
    { id: "dialogue-choices", label: "Choices" }, { id: "dialogue-preview", label: "Preview" }
  ];
  return '<main class="workspace-main">' +
    '<div class="workspace-heading">' +
    '<div><h1>' + escapeHtml(displayTitle) + '</h1><p class="help-copy">Edit every field for this moment directly, or switch to Guided flow for focused writing.</p></div>' +
    '<div class="heading-status ' + (issues.some(issue => issue.level === "error") ? "has-errors" : "is-ready") + '">' + actionButton("open-guided-editor", "✦ Guided flow", "button button-mode-guided") + (issues.some(issue => issue.level === "error") ? '<span></span>Needs attention' : "") + '</div>' +
    '</div>' +
    renderDialogueMap(node?.id ?? "", "add-node") +
    (node ? renderAdvancedSectionNav(sections) + '<section class="advanced-editor-content" aria-label="Advanced dialogue fields">' +
      renderDialogueNodeEditor(record, node, nodeIndex, roster, -1, workspace) +
      '<div class="review-validation">' + renderIssues(issues) + '</div></section>' : '<div class="soft-empty">Choose or add a moment to edit its fields.</div>') +
    '</main>';
}

function renderGuidedDialogueEditor(
  record: DialogueRecord,
  workspace: Workspace,
  roster: UnitRoster,
  activeStep: number,
  returnState?: RelatedEditorReturnState,
  helpVisible = false
): string {
  const steps = ["Speaker", "Lines", "Choices", "Preview"];
  const step = Math.max(0, Math.min(steps.length - 1, activeStep));
  guidedFinalStepActive = step === steps.length - 1;
  const nodeIndex = Math.max(0, record.sequence.nodes.findIndex(node => node.id === workspace.activeNodeId));
  const node = record.sequence.nodes[nodeIndex];
  const isStartNode = node?.id === record.sequence.startNodeId;
  const startNode = record.sequence.nodes.find(candidate => candidate.id === record.sequence.startNodeId);
  const displayTitle = startNode ? dialogueMomentName(record.sequence, startNode) : humanizeIdentifier(record.sequence.sequenceId) || "Dialogue";
  const issues = validateDialogue(record);
  let screen = "";

  if (node && step === 0) {
    const speaker = node.speakers[0];
    const speakerPath = "nodes." + nodeIndex + ".speakers.0.unitId";
    const speakerFields = speaker
      ? '<div class="guided-speaker-fields">' +
        unitPicker("Character", speakerPath, speaker.unitId, roster, "Choose by character name.") +
        speakerNameField("Display name", "nodes." + nodeIndex + ".speakers.0.displayName", speaker.displayName, speaker.unitId, roster) +
        '<details class="guided-speaker-options"><summary>Speaker options</summary>' +
        selectField("Portrait side", "nodes." + nodeIndex + ".speakers.0.side", speaker.side, [["left", "Left"], ["right", "Right"]], "") +
        '</details>' +
        '</div>'
      : "";
    screen = '<div class="guided-intro help-copy"><p>Pick one character, or leave this as narration.</p></div>' +
      (speaker
        ? speakerFields.replace('data-bind="' + speakerPath + '"', 'data-bind="' + speakerPath + '" data-guided-autofocus') +
          (node.speakers.length > 1 ? '<p class="guided-note help-copy">A second speaker is already set up. Edit multiple speakers in the full editor.</p>' : "")
        : '<div class="guided-empty"><p class="help-copy">No character portrait is needed for this moment.</p>' + actionButton("add-speaker", "＋ Add a speaker", "button button-outline", ' data-node-index="' + nodeIndex + '"') + '</div>') +
      '<details class="guided-moment-name"><summary>Moment name (optional)</summary>' +
      inputField("Moment name", "nodes." + nodeIndex + ".editorLabel", node.editorLabel ?? "", {
        placeholder: dialogueMomentName(record.sequence, node),
        hint: "Leave empty to use the automatic Moment 1, Moment 2, and so on."
      }) + '</details>';
  } else if (node && step === 1) {
    const lines = node.segments.map((segment, index) =>
      '<div class="guided-line"><div class="guided-item-heading"><span>Line ' + (index + 1) + '</span>' +
      (index > 0 ? actionButton("remove-segment", "Remove", "text-button danger-text", ' data-node-index="' + nodeIndex + '" data-index="' + index + '" aria-label="Remove line"') : "") +
      '</div>' + textAreaField("What should the player read?", "nodes." + nodeIndex + ".segments." + index + ".text", segment.text, "", 3) + '</div>'
    ).join("");
    screen = '<div class="guided-intro help-copy"><p>Write the words for this moment. Add another line if the thought needs a pause.</p></div>' +
      (lines || '<div class="guided-empty"><p class="help-copy">Add a line to start.</p></div>') +
      actionButton("add-segment", "＋ Add another line", "text-button guided-add", ' data-node-index="' + nodeIndex + '"');
  } else if (node && step === 2) {
    const choices = node.actions.map((action, index) => {
      const path = "nodes." + nodeIndex + ".actions." + index;
      return '<div class="guided-choice"><div class="guided-item-heading"><span>Choice ' + (index + 1) + '</span>' +
        actionButton("remove-action", "Remove", "text-button danger-text", ' data-node-index="' + nodeIndex + '" data-index="' + index + '" aria-label="Remove choice"') +
        '</div><div class="form-grid two guided-fields">' +
        inputField("Button text", path + ".label", action.label, { placeholder: "Continue" }) +
        renderNodeChoices(action, path + ".targetNodeId", record) +
        '</div></div>';
    }).join("");
    screen = '<div class="guided-intro help-copy"><p>Every moment keeps a Continue button. Add choices when the player should pick a branch.</p></div>' +
      (choices || renderDefaultContinue(node, nodeIndex, record)) +
      actionButton("add-action", node.actions.length ? "＋ Add another choice" : "＋ Replace Continue with choices", "text-button guided-add", ' data-node-index="' + nodeIndex + '"');
  } else if (node && step === 3) {
    screen = '<div class="guided-intro help-copy"><p>Try each choice to check where the conversation goes.</p></div>' +
      renderDialoguePreview(record, workspace, roster) +
      '<div class="review-validation">' + renderIssues(issues) + '</div>' +
      '<div class="guided-end-actions">' +
      actionButton("guided-add-node", "＋ Add another moment", "button button-outline") +
      '</div>';
  } else {
    screen = '<div class="guided-empty"><p class="help-copy">Add a moment to start the conversation.</p>' + actionButton("guided-add-node", "＋ Add a moment", "button button-outline") + '</div>';
  }

  return '<main class="workspace-main guided-editor' + ([0, 1, 2].includes(step) ? ' is-writing' : '') + '">' +
    renderGuidedEditorHeader("Dialogue", displayTitle, returnState, helpVisible) +
    renderDialogueMap(node?.id ?? "") +
    '<section class="guided-step-screen" aria-labelledby="workflow-screen-title">' +
    '<div class="guided-step-heading"><span>Moment ' + String(nodeIndex + 1) + ' of ' + record.sequence.nodes.length + (isStartNode ? ' · Start node' : '') + '</span><h1 id="workflow-screen-title">' + steps[step] + '</h1></div>' +
    screen +
    '</section>' +
    '<p class="guided-keyboard-hint help-copy">Enter continues · Shift+Enter adds a line break</p>' +
    renderWorkflowFooter(steps, step, "Ready to export") +
    '</main>';
}

function renderEffects(
  effects: QuestRecord["extension"]["completionEffects"],
  path: string,
  actionData: string
): string {
  return effects.map((effect, index) =>
    '<div class="effect-row">' +
    '<span class="effect-index">' + String(index + 1).padStart(2, "0") + '</span>' +
    selectField("Effect", path + "." + index + ".kind", effect.kind, [
      ["play-event", "Play game event"],
      ["unlock-path", "Unlock node path"],
      ["unlock-shop-item", "Unlock shop item"]
    ], "", true) +
    inputField("Target ID", path + "." + index + ".targetId", effect.targetId, { placeholder: "game-content-id" }) +
    inputField("Author note", path + "." + index + ".label", effect.label, { placeholder: "What should happen?" }) +
    actionButton("remove-effect", "×", "icon-button danger", ' data-scope="' + actionData + '" data-index="' + index + '" aria-label="Remove effect"') +
    '</div>'
  ).join("");
}

function dialogueLinkField(
  label: string,
  path: string,
  currentId: string,
  workspace: Workspace,
  slot: keyof QuestRecord["extension"]["dialogueLinks"]
): string {
  const options: Array<[string, string]> = [["", "Not linked"]];
  for (const dialogue of workspace.dialogues) {
    options.push([dialogue.sequence.sequenceId, dialogue.sequence.sequenceId]);
  }
  const linked = workspace.dialogues.find(dialogue => dialogue.sequence.sequenceId === currentId);
  return '<div class="dialogue-link-field">' +
    selectField(label, path, currentId, emptyOption(options, currentId), "Links an authored dialogue sequence to this quest moment.", true) +
    '<div class="related-editor-actions">' +
    actionButton("create-quest-dialogue", "＋ Create dialogue", "text-button related-create", ' data-slot="' + slot + '"') +
    (linked ? actionButton("open-quest-dialogue", "Edit linked dialogue", "text-button related-open", ' data-slot="' + slot + '" data-dialogue-id="' + escapeHtml(currentId) + '"') : "") +
    '</div></div>';
}

export function renderLivePreview(workspace: Workspace, roster: UnitRoster): string {
  const item = selectedItem(workspace);
  if (!item) return "";
  return "sequence" in item ? renderDialoguePreview(item, workspace, roster) : "";
}

function reviewField(label: string, value: unknown): string {
  return '<div class="review-field"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value === 0 ? "0" : value || "—") + '</dd></div>';
}

function reviewList(label: string, values: string[]): string {
  return '<section class="review-list"><h4>' + escapeHtml(label) + '</h4>' +
    (values.length ? '<ul>' + values.map(value => '<li>' + escapeHtml(value) + '</li>').join("") + '</ul>' : '<p>None configured.</p>') +
    '</section>';
}

function questObjectiveSummary(record: QuestRecord): string {
  const quest = record.definition;
  const floor = quest.targetFloorOffset === 0 ? "same floor" : "floor +" + quest.targetFloorOffset;
  if (record.extension.logicKind === "timer-project") {
    const timer = record.extension.timer;
    return "Pay " + timer.paymentAmount + " " + timer.paymentResource + " " + (timer.paymentCompletesImmediately ? "to finish immediately" : "to start the project") + ", or wait for " + timer.counterTarget + " " + (timer.counterLabel || "completed battles").toLowerCase() + ".";
  }
  switch (quest.objectiveKind) {
    case "Escort": return "Escort " + (quest.escortUnitId || "the selected unit") + " to " + (quest.targetNodeKind || "the target node") + " (" + floor + ").";
    case "Fetch": return record.extension.fetchItems.length
      ? record.extension.fetchItems.map(item => item.count + " × " + (item.displayName || item.id || "unnamed item")).join(", ")
      : "No fetch items configured.";
    case "Battle": return record.extension.battleTargets.length
      ? record.extension.battleTargets.map(target => (target.label || target.nodeKind || "Battle") + " (" + (target.nodeKind || "Battle") + ", floor +" + target.floorOffset + (target.armyId ? ", Army " + target.armyId : "") + ")").join("; ")
      : "No battle targets configured.";
    case "ClearFloor": return "Clear " + (quest.targetFloorOffset === 0 ? "the current floor" : "floor +" + quest.targetFloorOffset) + ".";
    case "KillCount": {
      const target = record.extension.killCount;
      if (!target) return "No kill-count target configured.";
      const kind = target.targetKind === "building-faction" ? "buildings of faction" : target.targetKind === "faction" ? "units of faction" : "units";
      return "Defeat " + target.count + " " + kind + (target.targetId ? " " + target.targetId : "") + ".";
    }
    default: return "Complete the " + quest.objectiveKind + " objective.";
  }
}

function renderQuestReview(record: QuestRecord, workspace: Workspace, issues: ValidationIssue[]): string {
  const quest = record.definition;
  const timer = record.extension.logicKind === "timer-project";
  const objective = questObjectiveSummary(record);
  const dialogueSlots = [
    ["Offer", record.extension.dialogueLinks.offer], ["Progress", record.extension.dialogueLinks.active],
    ["Completion", record.extension.dialogueLinks.completion], ["Failure", record.extension.dialogueLinks.failure]
  ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, id]) => {
    const dialogue = workspace.dialogues.find(item => item.sequence.sequenceId === id);
    const startNode = dialogue?.sequence.nodes.find(node => node.id === dialogue.sequence.startNodeId);
    const displayName = dialogue && startNode ? dialogueMomentName(dialogue.sequence, startNode) : humanizeIdentifier(id);
    return label + ": " + displayName + (displayName === id ? "" : " (" + id + ")");
  });
  const effects = (timer ? record.extension.timer.completionEffects : record.extension.completionEffects)
    .map(effect => effect.label || effect.kind + (effect.targetId ? " · " + effect.targetId : ""));
  const distances = record.extension.minimumNodeDistances.map(rule => rule.fromNodeKind + " → " + rule.toNodeKind + ": at least " + rule.minimumHops + " map steps");
  return '<div class="review-layout">' +
    '<div class="review-block"><h3>' + escapeHtml(quest.title || "Untitled quest") + '</h3>' +
    '<dl class="review-fields">' +
    reviewField("Source", quest.sourceKind + (quest.sourceSlot >= 0 ? " · slot " + quest.sourceSlot : "")) +
    reviewField("Available", "Floor " + quest.firstFloor + (quest.repeatEveryFloors > 1 ? " · every " + quest.repeatEveryFloors + " floors" : "")) +
    reviewField("Objective", timer ? "Timer project" : quest.objectiveKind) +
    reviewField("Objective details", objective) +
    reviewField("Reward", quest.rewardAmount + " " + quest.rewardKind) +
    reviewField("Fallback text", quest.offerText || "No offer text") +
    '</dl>' +
    (quest.description ? '<p class="review-description">' + escapeHtml(quest.description) + '</p>' : '') +
    '</div>' +
    '<div class="review-block review-supporting-details">' + reviewList("Linked dialogues", dialogueSlots) + reviewList("Minimum map distances", distances) + reviewList("Completion effects", effects) + '</div>' +
    (timer ? '<p class="review-note help-copy">In game, the linked dialogue records the player’s pay-or-wait choice. Paying charges Sardines once; waiting counts the configured battle results until the project completes.</p>' : '') +
    '</div><div class="review-validation">' + renderIssues(issues) + '</div>';
}

function renderFetchItems(record: QuestRecord, advanced: boolean): string {
  const items = record.extension.fetchItems;
  const rows = items.map((item, index) => '<div class="fetch-item-row">' +
    inputField("Item " + (index + 1), "extension.fetchItems." + index + ".displayName", item.displayName, { placeholder: "Sealed letter" }) +
    inputField("Quantity", "extension.fetchItems." + index + ".count", item.count, { type: "number", min: 1, max: 999 }) +
    (advanced ? inputField("Item ID", "extension.fetchItems." + index + ".id", item.id, { placeholder: "sealed-letter" }) : "") +
    actionButton("remove-fetch-item", "×", "icon-button", ' data-index="' + index + '" aria-label="Remove item" title="Remove item"') +
    '</div>').join("");
  return '<div class="fetch-items-editor">' +
    (rows || '<p class="section-note help-copy">Add the items the player must collect.</p>') +
    actionButton("add-fetch-item", "＋ Add item", "button button-small") +
    '</div>';
}

function renderBattleTargets(record: QuestRecord, workspace: Workspace): string {
  const rows = record.extension.battleTargets.map((target, index) => '<section class="battle-target-row">' +
    '<header><div><span class="eyebrow">ENCOUNTER ' + String(index + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(target.label || "Battle " + (index + 1)) + '</strong></div>' +
    actionButton("remove-battle-target", "×", "icon-button", ' data-index="' + index + '" aria-label="Remove battle target" title="Remove battle target"') + '</header>' +
    '<div class="form-grid two">' +
    inputField("Battle label", "extension.battleTargets." + index + ".label", target.label || "Battle " + (index + 1), { placeholder: "North gate battle" }) +
    selectField("Node type", "extension.battleTargets." + index + ".nodeKind", target.nodeKind, [["Battle", "Battle"], ["Boss", "Boss"]], "", index === 0) +
    inputField("Floor offset", "extension.battleTargets." + index + ".floorOffset", target.floorOffset, { type: "number", min: 0, max: 99, hint: "0 means this floor." }) +
    selectField("Army configuration", "extension.battleTargets." + index + ".armyId", target.armyId, [["", "Random encounter"], ...workspace.armies.map(army => [army.id, army.name + " · " + army.id] as [string, string])], "Choose a reusable army, or leave it random.", true) +
    '</div><div class="related-editor-actions">' +
    actionButton("create-quest-battle-army", "＋ Create army", "text-button related-create", ' data-target-id="' + escapeHtml(target.id) + '"') +
    (target.armyId ? actionButton("open-quest-battle-army", "Edit linked army", "text-button related-open", ' data-target-id="' + escapeHtml(target.id) + '" data-army-id="' + escapeHtml(target.armyId) + '"') : "") +
    '</div>' +
    '</section>').join("");
  return '<div class="battle-targets-editor">' +
    (rows || '<p class="section-note help-copy">Add a battle node for this objective.</p>') +
    actionButton("add-battle-target", "＋ Add battle", "button button-small") +
    '</div>';
}

function killCountTargetOptions(record: QuestRecord, catalog: ArmyCatalog): Array<[string, string]> {
  const kind = record.extension.killCount?.targetKind ?? "unit";
  if (kind === "unit") {
    return catalog.units.map(unit => [unit.id, unit.name + " · " + unit.faction]);
  }
  return catalog.factions.map(faction => [faction.id, faction.name]);
}

function renderKillCountObjective(record: QuestRecord, catalog: ArmyCatalog): string {
  const objective = record.extension.killCount ?? { targetKind: "unit" as const, targetId: "", count: 1 };
  const kindOptions: Array<[string, string]> = [
    ["unit", "Units of a specific type"], ["faction", "Units of a faction"], ["building-faction", "Buildings of a faction"]
  ];
  return '<div class="kill-count-editor">' +
    selectField("Count what?", "extension.killCount.targetKind", objective.targetKind, kindOptions, "", true) +
    selectField(objective.targetKind === "unit" ? "Enemy unit" : "Faction", "extension.killCount.targetId", objective.targetId, emptyOption(killCountTargetOptions(record, catalog), objective.targetId), "Uses the current game catalog.", true) +
    inputField(objective.targetKind === "building-faction" ? "Buildings to destroy" : "Units to defeat", "extension.killCount.count", objective.count, { type: "number", min: 1, max: 999 }) +
    '</div>';
}

function renderMinimumDistances(record: QuestRecord, expanded = false): string {
  const nodeOptions: Array<[string, string]> = [
    ["QuestStart", "Quest start"], ["Battle", "Battle"], ["Boss", "Boss"], ["Reward", "Reward"], ["Shop", "Shop"], ["Custom", "Custom node"]
  ];
  const rules = record.extension.minimumNodeDistances.map((rule, index) => '<div class="minimum-distance-row">' +
    selectField("From", "extension.minimumNodeDistances." + index + ".fromNodeKind", rule.fromNodeKind, nodeOptions, "", true) +
    selectField("To", "extension.minimumNodeDistances." + index + ".toNodeKind", rule.toNodeKind, nodeOptions, "", true) +
    inputField("At least", "extension.minimumNodeDistances." + index + ".minimumHops", rule.minimumHops, { type: "number", min: 1, max: 99, hint: "Nodes between these points." }) +
    actionButton("remove-minimum-distance", "×", "icon-button", ' data-index="' + index + '" aria-label="Remove distance rule" title="Remove rule"') +
    '</div>').join("");
  return '<details class="advanced-rule-disclosure"' + (expanded ? " open" : "") + '><summary>' + (expanded ? "Minimum node spacing" : "Advanced · minimum node spacing") + '</summary><p class="help-copy">Set the shortest allowed distance along the quest route between node types.</p>' +
    (rules || '<p class="section-note">No minimum distances are required.</p>') +
    actionButton("add-minimum-distance", "＋ Add distance rule", "button button-small") + '</details>';
}

const armyStats: Array<[keyof NonNullable<ArmyCatalogLevel["stats"]>, string]> = [
  ["maxHealth", "Health"], ["maxMana", "Mana"], ["manaRegen", "Mana regen"], ["attackDamage", "Attack"],
  ["attackSpeed", "Attack speed"], ["attackRange", "Range"], ["minAttackRange", "Min. range"], ["critChance", "Critical chance"],
  ["spellPower", "Spell power"], ["armorResist", "Armor"], ["magicResist", "Magic resist"], ["movementSpeed", "Movement"]
];

function armyLevelMarkup(entity: ArmyCatalogUnit | undefined, level: ArmyCatalogLevel | undefined, kind: ArmyCatalogKind, portrait?: string): string {
  if (!entity || !level) return '<div class="army-preview-empty">Choose a unit or building to see its stats.</div>';
  const metrics = armyStats.map(([key, label]) => {
    const value = level.stats?.[key];
    return value === undefined ? "" : '<div><dt>' + label + '</dt><dd>' + escapeHtml(key === "critChance" ? Math.round(value * 100) + "%" : value) + '</dd></div>';
  }).join("");
  const footprint = level.footprint ?? { width: 1, height: 1 };
  const artwork = portrait
    ? '<img src="' + escapeHtml(portrait) + '" alt="' + escapeHtml(entity.name) + ' preview" loading="lazy">'
    : '<div class="army-preview-placeholder" aria-label="No captured preview for ' + escapeHtml(entity.name) + '"><span>' + escapeHtml(entity.name.slice(0, 1)) + '</span><small>Preview not captured</small></div>';
  return '<article class="army-stats-card"><header><div><span class="eyebrow">' + (kind === "buildings" ? "BUILDING" : "UNIT") + ' · LEVEL ' + level.level + '</span><h3>' + escapeHtml(entity.name) + '</h3><small>' + escapeHtml(entity.faction) + (level.tier ? ' · Tier ' + level.tier : "") + '</small></div><span class="army-footprint-badge">' + footprint.width + ' × ' + footprint.height + '</span></header>' +
    '<div class="army-stats-body"><figure class="army-stats-portrait">' + artwork + '</figure><div class="army-stats-details">' + (level.description ? '<p class="army-stat-description">' + escapeHtml(level.description) + '</p>' : "") + (metrics ? '<dl class="army-stat-grid">' + metrics + '</dl>' : "") + '</div></div></article>';
}

function armyLevelPreviewPath(entityId: string, level: ArmyCatalogLevel | undefined, kind: ArmyCatalogKind, roster: UnitRoster): string | undefined {
  if (level?.previewImage) return level.previewImage;
  const exact = roster.units.find(item => item.id === entityId)?.portrait;
  if (exact) return exact;
  const rootId = entityId.replace(/\/\d+$/, "/1");
  return kind === "units" ? roster.units.find(item => item.id === rootId)?.portrait : undefined;
}

export function renderArmyEntityPreview(catalog: ArmyCatalog, entityId: string, levelNumber: number, kind: ArmyCatalogKind, roster: UnitRoster = { schemaVersion: 1, rosterVersion: "", source: "", units: [] }): string {
  const entity = catalog[kind].find(item => item.id === entityId);
  const level = entity?.levels.find(item => item.level === levelNumber) ?? entity?.levels[0];
  return armyLevelMarkup(entity, level, kind, armyLevelPreviewPath(entityId, level, kind, roster));
}

export function renderArmyAbilityPreview(catalog: ArmyCatalog, abilityId: string, kind: "spells" | "blessings" | "curses"): string {
  const entries = kind === "spells" ? catalog.spells : kind === "curses" ? catalog.curses ?? [] : [...catalog.blessings, ...(catalog.curses ?? [])];
  const ability = entries.find(item => item.id === abilityId);
  if (!ability) return '<div class="army-preview-empty">Choose a ' + (kind === "spells" ? "spell" : kind === "curses" ? "curse" : "blessing") + ' to preview its effect.</div>';
  const details = [ability.level ? "Level " + ability.level : "", ability.tier ? "Tier " + ability.tier : "",
    ability.isAdventureOnly ? "Adventure only" : "",
    (ability.manaCost ?? 0) > 0 ? ability.manaCost + " mana" : "", (ability.coinCost ?? 0) > 0 ? ability.coinCost + " coins" : "",
    (ability.healthCost ?? 0) > 0 ? ability.healthCost + " health" : "", (ability.cooldown ?? 0) > 0 ? ability.cooldown + "s cooldown" : "",
    ability.maxTargets ? "Up to " + ability.maxTargets + " targets" : ""].filter(Boolean).join(" · ");
  const mechanics = ability.mechanics ?? {};
  const family = ability.family === "cell" ? "Field · " + battlefieldTargetSummary(ability) : ability.family === "grid" ? "Grid · " + String(mechanics.effect ?? "") : ability.family === "economy" ? "Economy" : "";
  const cellEffect = mechanics.effect && typeof mechanics.effect === "object" ? mechanics.effect as { name?: string; description?: string } : undefined;
  const baneEffect = mechanics.baneEffect && typeof mechanics.baneEffect === "object" ? mechanics.baneEffect as { name?: string; description?: string } : undefined;
  const effectDetails = ability.family === "cell" ? '<div class="army-cell-effect-summary"><strong>' + escapeHtml(family) + '</strong>' +
    (cellEffect?.description ? '<span>Effect · ' + escapeHtml(cellEffect.description) + '</span>' : "") +
    (baneEffect?.description ? '<span>Bane · ' + escapeHtml(baneEffect.description) + '</span>' : "") +
    (mechanics.rangedOnly === true ? '<span>Ranged units only</span>' : "") + '</div>' : "";
  const hasLanePicker = String(mechanics.rule) === "PickedColumn" || String(mechanics.baneRule) === "PickedColumn";
  const hasCellPicker = String(mechanics.rule) === "RandomCells" || String(mechanics.baneRule) === "RandomCells";
  const targetingAction = ability.family === "cell" && kind !== "spells" && (hasLanePicker || hasCellPicker)
    ? actionButton("add-configure-battlefield-effect", hasLanePicker ? "Choose lane" : "Choose fields", "button button-small army-ability-configure", ' data-ability-id="' + escapeHtml(ability.id) + '" data-kind="' + kind + '" aria-label="Add and choose affected ' + (hasLanePicker ? "lane" : "fields") + ' for ' + escapeHtml(ability.name) + '"')
    : "";
  return '<article class="army-ability-preview' + (ability.isCurse ? ' is-curse' : '') + '"><div class="army-ability-preview-heading"><strong>' + escapeHtml(ability.name) + (ability.isCurse ? ' <small>Curse</small>' : '') + '</strong>' + targetingAction + '</div>' + (details ? '<span>' + escapeHtml(details) + '</span>' : "") +
    '<p>' + escapeHtml(ability.description || "No effect description is available in the game catalog.") + '</p>' + effectDetails + '</article>';
}

function armyAbilityChip(catalog: ArmyCatalog, id: string, index: number, kind: "spell" | "blessing" | "curse" | "unit-spell"): string {
  const ability = (kind === "blessing" ? [...catalog.blessings, ...(catalog.curses ?? [])] : kind === "curse" ? catalog.curses ?? [] : catalog.spells).find(item => item.id === id);
  const action = kind === "blessing" || kind === "curse" ? "remove-army-blessing" : kind === "unit-spell" ? "remove-army-unit-spell" : "remove-army-spell";
  const area = ability ? battlefieldTargetSummary(ability) : null;
  const title = [ability?.description, ability?.tier ? "Tier " + ability.tier : "", ability?.level ? "Level " + ability.level : "",
    ability?.manaCost ? "Mana " + ability.manaCost : "", ability?.coinCost ? "Coins " + ability.coinCost : "",
    ability?.healthCost ? "Health " + ability.healthCost : "", ability?.cooldown ? "Cooldown " + ability.cooldown + "s" : "",
    ability?.maxTargets ? "Max targets " + ability.maxTargets : "", area ?? ""].filter(Boolean).join("\n");
  const name = escapeHtml(ability?.name ?? id);
  const label = '<button type="button" class="army-chip-select" data-action="' + (area ? "configure-battlefield-effect" : "select-army-ability") + '" data-kind="' + (kind === "spell" || kind === "unit-spell" ? "spells" : kind === "curse" ? "curses" : "blessings") + '" data-ability-id="' + escapeHtml(id) + '" aria-label="View or edit ' + name + (area ? ': ' + escapeHtml(area) : "") + '" title="' + escapeHtml(area ? "Configure battlefield fields" : "View ability details") + '"><span>' + name + '</span>' + (area ? '<small class="army-chip-area">' + escapeHtml(area) + '</small>' : '') + '</button>';
  return '<span class="army-chip" title="' + escapeHtml(title || "No effect description is available in the game catalog.") + '" tabindex="0">' + label +
    (ability?.level && ability.level > 1 ? ' <small>Lv ' + ability.level + '</small>' : "") +
    actionButton(action, "×", "chip-remove", ' data-index="' + index + '" aria-label="Remove ' + name + '"') + '</span>';
}

function renderArmyGrid(record: ArmyRecord, size: { width: number; height: number }, catalog: ArmyCatalog, roster: UnitRoster, selectedId: string | null): string {
  const visualWidth = Math.max(5, size.width, ...record.units.map(unit => unit.x + armyFootprint(catalog, unit.unitId).width));
  const visualHeight = Math.max(5, size.height, ...record.units.map(unit => unit.y + armyFootprint(catalog, unit.unitId).height));
  const cells = Array.from({ length: visualWidth * visualHeight }, (_, index) => {
    const x = index % visualWidth, y = Math.floor(index / visualWidth), active = x < size.width && y < size.height;
    const occupied = record.units.some(unit => { const fp = armyFootprint(catalog, unit.unitId); return x >= unit.x && x < unit.x + fp.width && y >= unit.y && y < unit.y + fp.height; });
    return '<button type="button" class="army-grid-cell' + (active ? " is-active" : " is-outside") + (occupied ? " is-covered" : "") + '" data-action="place-army-unit" data-army-cell data-x="' + x + '" data-y="' + y + '" style="grid-column:' + (x + 1) + ';grid-row:' + (y + 1) + '"' + (!active || occupied ? " disabled" : "") + ' aria-label="Grid cell ' + (x + 1) + ', ' + (y + 1) + '">' + (active && !occupied ? '<span class="army-cell-plus">+</span>' : active ? "" : '<span class="army-cell-lock">·</span>') + '</button>';
  }).join("");
  const tiles = record.units.map(unit => {
    const resolved = resolveArmyLevel(catalog, unit.unitId), fp = armyFootprint(catalog, unit.unitId);
    const portrait = armyLevelPreviewPath(unit.unitId, resolved?.level, resolved?.kind ?? "units", roster);
    const name = resolved?.entity.name ?? "Unknown unit";
    const title = (resolved ? name : "Unknown unit “" + unit.unitId + "” — choose a catalog unit")
      + (resolved?.kind === "buildings" ? " · Building" : "") + " · " + fp.width + " × " + fp.height
      + " · Cell " + (unit.x + 1) + ", " + (unit.y + 1);
    return '<button type="button" class="army-grid-placement' + (selectedId === unit.id ? " is-selected" : "")
      + (resolved ? "" : " is-invalid") + '" data-action="select-army-placement" data-placement-id="' + escapeHtml(unit.id)
      + '" data-army-placement style="grid-column:' + (unit.x + 1) + ' / span ' + fp.width + ';grid-row:' + (unit.y + 1) + ' / span ' + fp.height
      + '" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title + ". Drag to move or swap positions.") + '">'
      + (portrait ? '<img src="' + escapeHtml(portrait) + '" alt="">' : '<span class="army-unit-initial">?</span>')
      + '<strong>' + escapeHtml(name) + '</strong><small>' + (resolved
        ? (resolved.kind === "buildings" ? "Building · " : "") + 'Lv ' + (resolved.level.level ?? "?") + ' · ' + fp.width + '×' + fp.height
        : escapeHtml(unit.unitId) + ' · pick a unit') + '</small></button>';
  }).join("");
  return '<div class="army-grid" data-army-grid role="group" aria-label="Enemy battle grid" style="--army-grid-columns:' + visualWidth + ';--army-grid-rows:' + visualHeight + '">' + cells + tiles + '</div>';
}

function renderArmyPlacementList(record: ArmyRecord, catalog: ArmyCatalog, selectedId: string | null): string {
  const rows = record.units.map((unit, index) => {
    const resolved = resolveArmyLevel(catalog, unit.unitId), fp = armyFootprint(catalog, unit.unitId);
    return '<div class="army-unit-row' + (unit.id === selectedId ? " is-selected" : "") + (resolved ? "" : " is-invalid") + '"><button type="button" data-action="select-army-placement" data-placement-id="' + escapeHtml(unit.id) + '"><span>' + String(index + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(resolved?.entity.name ?? "Unknown unit") + '</strong><small>' + (resolved
      ? (resolved.kind === "buildings" ? "Building · " : "") + 'Lv ' + (resolved.level.level ?? "?") + ' · ' + fp.width + "×" + fp.height + ' · ' + (unit.x + 1) + ',' + (unit.y + 1)
      : escapeHtml(unit.unitId) + ' · pick a unit') + '</small></button>' +
      actionButton("remove-army-placement", "×", "icon-button", ' data-placement-id="' + escapeHtml(unit.id) + '" aria-label="Remove from army" title="Remove from army"') + '</div>';
  }).join("");
  return '<div class="army-unit-list"><h3>Army lineup <span>' + record.units.length + '</span></h3>' + (rows || '<p class="army-empty">No units or buildings added yet.</p>') + '</div>';
}

function renderArmyPicker(catalog: ArmyCatalog, kind: ArmyCatalogKind, placement: ArmyUnitPlacement | undefined, roster: UnitRoster): string {
  const picked = placement ? resolveArmyLevel(catalog, placement.unitId) : undefined;
  const actualKind = kind, entries = catalog[actualKind];
  const entity = entries.find(item => item.id === picked?.entity.id) ?? entries[0], levelNumber = picked?.level.level ?? entity?.levels[0]?.level ?? 1;
  const levels = entity?.levels.map(item => [String(item.level), "Level " + item.level] as [string, string]) ?? [];
  return '<section class="army-picker-section"><div class="army-catalog-tabs" role="group" aria-label="Catalog type">' +
    actionButton("army-catalog-kind", "Units", "army-catalog-tab" + (actualKind === "units" ? " is-active" : ""), ' data-kind="units" aria-pressed="' + (actualKind === "units") + '"') +
    actionButton("army-catalog-kind", "Buildings", "army-catalog-tab" + (actualKind === "buildings" ? " is-active" : ""), ' data-kind="buildings" aria-pressed="' + (actualKind === "buildings") + '"') + '</div>' +
    (entries.length ? '<div class="form-grid">' + pickerField("army-unit-picker", actualKind === "buildings" ? "Building" : "Unit", entity?.id ?? "", entries.map(item => [item.id, item.name + " · " + item.faction] as [string, string])) +
      pickerField("army-level-picker", "Level", levelNumber, levels) + '</div><div id="army-entity-preview">' + renderArmyEntityPreview(catalog, entity?.id ?? "", levelNumber, actualKind, roster) + '</div>' +
      '<div class="army-picker-actions">' + actionButton("add-selected-army-unit", "＋ Add to army", "button button-primary") + (placement ? actionButton("replace-army-placement", "Replace selected field", "button button-outline") : "") + '</div>' :
      '<p class="army-empty">No ' + actualKind + ' are present in the game catalog.</p>') + '</section>';
}

/** Spell mechanics can grant a named blessing; surface its description as a tooltip. */
function spellBlessingTooltip(catalog: ArmyCatalog, spell: ArmyCatalogAbility): string {
  const mechanics = spell.mechanics as { abilityData?: { abilityname?: string } } | undefined;
  const name = mechanics?.abilityData?.abilityname;
  if (!name) return "";
  const blessing = catalog.blessings.find(item => item.name === name || item.id === name);
  if (!blessing?.description) return "";
  return "Grants " + blessing.name + ": " + blessing.description.replace(/<[^>]+>/g, "");
}

function renderArmyAbilityPicker(catalog: ArmyCatalog, kind: "spells" | "blessings" | "curses", ids: string[], sourceIds: string[] = ids, filter: "all" | "field" = "all", selectedId = ""): string {
  const entries = kind === "spells" ? catalog.spells : kind === "curses" ? catalog.curses ?? [] : catalog.blessings;
  const assignedIds = ids.filter(id => entries.some(entry => entry.id === id));
  const chips = assignedIds.map(id => armyAbilityChip(catalog, id, sourceIds.indexOf(id), kind === "spells" ? "spell" : kind === "curses" ? "curse" : "blessing")).join("");
  const fieldEntries = entries.filter(item => battlefieldTargetSummary(item));
  const visibleEntries = filter === "field" ? fieldEntries : entries;
  const options = visibleEntries.map(item => [item.id, item.name + (item.level && item.level > 1 ? " · Level " + item.level : "") +
    (item.isAdventureOnly ? " · Adventure only" : "") + (battlefieldTargetSummary(item) ? " · " + (filter === "field" ? "" : "FIELD · ") + battlefieldTargetSummary(item) : "") + (ids.includes(item.id) ? " · In army" : ""),
    kind === "spells" ? spellBlessingTooltip(catalog, item) : ""] as [string, string, string]);
  const pickerId = kind === "spells" ? "army-spell-picker" : kind === "curses" ? "army-curse-picker" : "army-blessing-picker";
  const label = kind === "spells" ? "Spell" : kind === "curses" ? "Curse" : "Blessing";
  const action = kind === "spells" ? "add-army-spell" : kind === "curses" ? "add-army-curse" : "add-army-blessing";
  const previewId = kind === "spells" ? "army-spell-preview" : kind === "curses" ? "army-curse-preview" : "army-blessing-preview";
  const filters = fieldEntries.length ? '<div class="army-ability-filters" role="group" aria-label="Filter ' + label + ' list">' +
    actionButton("army-ability-filter", "All", "army-ability-filter" + (filter === "all" ? " is-active" : ""), ' data-kind="' + kind + '" data-filter="all" aria-pressed="' + (filter === "all") + ' aria-label="Show all ' + label.toLowerCase() + 's"') +
    actionButton("army-ability-filter", "Field effects · " + fieldEntries.length, "army-ability-filter" + (filter === "field" ? " is-active" : ""), ' data-kind="' + kind + '" data-filter="field" aria-pressed="' + (filter === "field") + ' aria-label="Show field-effect ' + label.toLowerCase() + 's"') +
    '</div>' : "";
  return '<div class="army-ability-picker">' + filters + '<div class="army-add-row">' + pickerField(pickerId, label, selectedId, [["", filter === "field" ? "Choose a field effect" : "Choose a " + label.toLowerCase()], ...options]) +
    actionButton(action, ids.includes(selectedId) ? "Added" : "Add", "button button-small", ids.includes(selectedId) ? " disabled" : "") + '</div><div id="' + previewId + '">' + renderArmyAbilityPreview(catalog, selectedId, kind) + '</div><div class="army-active-list" aria-label="Active ' + label.toLowerCase() + 's"><span class="army-active-list-label">In this army</span><div class="army-chips">' + (chips || '<p class="section-note">None added.</p>') + '</div></div></div>';
}

function renderArmyAbilityTabs(record: ArmyRecord, catalog: ArmyCatalog, selected: ArmyAbilityKind): string {
  const counts: Record<ArmyAbilityKind, number> = {
    spells: record.spellIds.filter(id => catalog.spells.some(item => item.id === id)).length,
    blessings: record.blessingIds.filter(id => catalog.blessings.some(item => item.id === id)).length,
    curses: record.blessingIds.filter(id => (catalog.curses ?? []).some(item => item.id === id)).length
  };
  const labels: Array<[ArmyAbilityKind, string]> = [["spells", "Spells"], ["blessings", "Blessings"], ["curses", "Curses"]];
  return '<div class="army-ability-tabs" role="group" aria-label="Army ability type">' + labels.map(([kind, label]) =>
    actionButton("army-ability-category", label + '<span>' + counts[kind] + '</span>', "army-ability-tab" + (selected === kind ? " is-active" : ""), ' aria-pressed="' + (selected === kind) + '" data-kind="' + kind + '"')
  ).join("") + '</div>';
}

function armyAbilityById(catalog: ArmyCatalog, id: string) {
  return [...catalog.blessings, ...(catalog.curses ?? [])].find(item => item.id === id);
}

function cellRuleLabel(rule: unknown): string {
  const labels: Record<string, string> = {
    None: "No cell region", FrontRow: "Front row", BackRow: "Back row", OuterColumns: "Outer columns",
    Corners: "Corner fields", Centre: "Center field", NoAdjacentAlly: "Fields with no adjacent ally",
    PickedColumn: "Selected lane", MovingCell: "Moving field", RandomCells: "Chosen fields"
  };
  return labels[String(rule)] ?? "Cell field";
}

function battlefieldTargetSummary(ability: ArmyCatalogAbility): string | null {
  if (ability.family !== "cell") return null;
  const mechanics = ability.mechanics ?? {};
  const describeRule = (rule: unknown, count: unknown) => String(rule) === "RandomCells"
    ? "Random fields ×" + Math.max(1, Number(count) || 1)
    : String(rule) === "PickedColumn" ? "Choose a lane" : cellRuleLabel(rule);
  const boon = describeRule(mechanics.rule, mechanics.cellCount);
  const baneRule = String(mechanics.baneRule ?? "None");
  return baneRule === "None" ? boon : boon + " · Bane: " + describeRule(baneRule, mechanics.baneCellCount);
}

function renderArmyCellTargetFocus(record: ArmyRecord, catalog: ArmyCatalog, roster: UnitRoster, abilityId: string, region: "boon" | "bane"): string {
  const ability = armyAbilityById(catalog, abilityId);
  if (!ability || ability.family !== "cell") return "";
  const mechanics = ability.mechanics ?? {};
  const size = armyGridSize(catalog, Math.max(1, record.previewFloor || 1), record.blessingIds);
  const rootId = String(mechanics.rootPersistentId ?? mechanics.persistentId ?? ability.id);
  const pick = record.cellBlessingPicks?.find(item => item.rootId === rootId) ?? { rootId, lane: -1, cells: [], locked: false, baneCells: [] };
  const rule = String(region === "boon" ? mechanics.rule ?? "None" : mechanics.baneRule ?? "None");
  const count = Number(region === "boon" ? mechanics.cellCount ?? 1 : mechanics.baneCellCount ?? 1);
  const isEditable = rule === "PickedColumn" || rule === "RandomCells";
  const targetCells = region === "boon" ? pick.cells : pick.baneCells;
  const selected = new Set(targetCells.map(cell => cell.x + "," + cell.y));
  const boonRule = String(mechanics.rule ?? "None"), baneRule = String(mechanics.baneRule ?? "None");
  const boonCells = new Set(pick.cells.map(cell => cell.x + "," + cell.y));
  const baneCells = new Set(pick.baneCells.map(cell => cell.x + "," + cell.y));
  const laneUnitNames = Array.from({ length: size.height }, (_, lane) => record.units
    .filter(unit => {
      const footprint = armyFootprint(catalog, unit.unitId);
      return lane >= unit.y && lane < unit.y + footprint.height;
    })
    .map(unit => resolveArmyLevel(catalog, unit.unitId)?.entity.name ?? unit.unitId));
  const isolatedCells = new Set<string>();
  for (const unit of record.units) {
    const footprint = armyFootprint(catalog, unit.unitId);
    const hasNeighbor = record.units.some(other => {
      if (other.id === unit.id) return false;
      const otherFootprint = armyFootprint(catalog, other.unitId);
      return other.x < unit.x + footprint.width + 1 && other.x + otherFootprint.width > unit.x - 1 &&
        other.y < unit.y + footprint.height + 1 && other.y + otherFootprint.height > unit.y - 1;
    });
    if (!hasNeighbor) {
      for (let x = unit.x; x < unit.x + footprint.width; x++)
        for (let y = unit.y; y < unit.y + footprint.height; y++) isolatedCells.add(x + "," + y);
    }
  }
  const contains = (cellRule: string, x: number, y: number, isBane: boolean) => {
    const key = x + "," + y;
    if (cellRule === "PickedColumn") return pick.lane >= 0 && y === pick.lane;
    if (cellRule === "RandomCells") return (isBane ? baneCells : boonCells).has(key);
    if (cellRule === "FrontRow") return x === size.width - 1;
    if (cellRule === "BackRow") return x === 0;
    if (cellRule === "OuterColumns") return y === 0 || y === size.height - 1;
    if (cellRule === "Corners") return (x === 0 || x === size.width - 1) && (y === 0 || y === size.height - 1);
    if (cellRule === "Centre") return (x === Math.floor((size.width - 1) / 2) || x === Math.ceil((size.width - 1) / 2)) &&
      (y === Math.floor((size.height - 1) / 2) || y === Math.ceil((size.height - 1) / 2));
    if (cellRule === "MovingCell") return x === 0 && y === 0;
    if (cellRule === "NoAdjacentAlly") return isolatedCells.has(key);
    return false;
  };
  const cells = Array.from({ length: size.width * size.height }, (_, index) => {
    const x = index % size.width, y = Math.floor(index / size.width), key = x + "," + y;
    const hasBoon = contains(boonRule, x, y, false), hasBane = contains(baneRule, x, y, true);
    const isSelected = selected.has(key);
    const laneSelected = rule === "PickedColumn" && pick.lane === y;
    const cellClass = 'army-cell-target' + (hasBoon ? ' is-boon' : '') + (hasBane ? ' is-bane' : '') +
      (isSelected ? ' is-current-target' : '') + (laneSelected ? ' is-lane-selected' : '');
    const content = hasBoon ? '<span>✦</span>' : hasBane ? '<span>⌁</span>' : '<small>' + (x + 1) + ',' + (y + 1) + '</small>';
    if (rule === "PickedColumn") {
      const unitNames = laneUnitNames[y];
      const details = unitNames.length ? "; affects " + unitNames.join(", ") : "; no units in this lane yet";
      const laneLabel = x === 0 ? ' data-lane-label="Lane ' + (y + 1) + '"' : '';
      return '<button type="button" class="' + cellClass + ' army-lane-cell" data-action="pick-cell-blessing-lane" data-y="' + y + '"' + laneLabel +
        ' tabindex="' + (x === 0 ? "0" : "-1") + '" style="grid-column:' + (x + 1) + ';grid-row:' + (y + 1) + '" aria-pressed="' + laneSelected +
        '" aria-label="Choose lane ' + (y + 1) + ' from field ' + (x + 1) + ', ' + (y + 1) + escapeHtml(details) + '" title="Choose lane ' + (y + 1) + escapeHtml(details) + '">' + content + '</button>';
    }
    const disabled = !isEditable || region === "bane" && rule === "RandomCells" && boonCells.has(key) && !isSelected ||
      rule === "RandomCells" && !isSelected && targetCells.length >= count;
    return '<button type="button" class="' + cellClass + '" data-action="toggle-cell-blessing-cell"' +
      ' data-x="' + x + '" data-y="' + y + '"' + (disabled ? ' disabled' : '') +
      ' aria-pressed="' + isSelected + '" aria-label="Field ' + (x + 1) + ', ' + (y + 1) +
      (hasBoon ? ", blessed" : "") + (hasBane ? ", cursed" : "") + '">' + content + '</button>';
  }).join("");
  const selectedLaneUnits = rule === "PickedColumn" && pick.lane >= 0 ? record.units.filter(unit => {
    const footprint = armyFootprint(catalog, unit.unitId);
    return pick.lane >= unit.y && pick.lane < unit.y + footprint.height;
  }) : [];
  const units = record.units.map(unit => {
    const resolved = resolveArmyLevel(catalog, unit.unitId);
    const footprint = armyFootprint(catalog, unit.unitId);
    const portrait = armyLevelPreviewPath(unit.unitId, resolved?.level, resolved?.kind ?? "units", roster);
    const name = resolved?.entity.name ?? unit.unitId;
    const inSelectedLane = boonRule === "PickedColumn" && selectedLaneUnits.some(candidate => candidate.id === unit.id);
    return '<div class="army-cell-target-unit' + (inSelectedLane ? ' is-in-selected-lane' : '') + '" style="grid-column:' + (unit.x + 1) + ' / span ' + footprint.width + ';grid-row:' + (unit.y + 1) + ' / span ' + footprint.height + '" title="' + escapeHtml(name + (inSelectedLane ? " · in selected lane" : "")) + '">' +
      (portrait ? '<img src="' + escapeHtml(portrait) + '" alt="">' : '<b>' + escapeHtml(name.slice(0, 1)) + '</b>') + '<small>' + escapeHtml(name) + '</small></div>';
  }).join("");
  const title = region === "boon" ? "Blessing field" : "Bane field";
  const required = rule === "PickedColumn" ? "Choose a lane. It runs from the rear edge toward the enemy." :
    rule === "RandomCells" ? "Choose " + count + (count === 1 ? " field." : " fields.") : rule === "MovingCell" ? "The highlighted field moves each round." :
    rule === "NoAdjacentAlly" ? "The game checks nearby allies at combat start." : "This area follows the selected game's cell rule.";
  const hasBane = baneRule !== "None";
  return '<div class="army-cell-focus-backdrop"><section class="army-cell-focus" role="dialog" aria-modal="true" aria-label="Configure battlefield fields">' +
    '<header><div><span class="eyebrow">' + (ability.isCurse ? "CURSE" : "CELL BLESSING") + '</span><h2>' + escapeHtml(ability.name) + '</h2></div>' +
    actionButton("close-cell-blessing-focus", "Done", "button button-primary") + '</header>' +
    '<div class="army-cell-focus-details"><div><strong>' + escapeHtml(cellRuleLabel(mechanics.rule)) + '</strong><span>' + escapeHtml(String(mechanics.effect && typeof mechanics.effect === "object" ? (mechanics.effect as { description?: string }).description ?? "" : "")) + '</span></div>' +
    (hasBane ? '<div><strong>' + escapeHtml(cellRuleLabel(mechanics.baneRule)) + '</strong><span>' + escapeHtml(String((mechanics.baneEffect as { description?: string } | undefined)?.description ?? "")) + '</span></div>' : '') + '</div>' +
    (hasBane ? '<div class="army-cell-region-tabs">' + actionButton("cell-blessing-region", "Blessing · " + escapeHtml(cellRuleLabel(mechanics.rule)), "button button-small" + (region === "boon" ? " is-active" : ""), ' data-region="boon"') +
      actionButton("cell-blessing-region", "Bane · " + escapeHtml(cellRuleLabel(mechanics.baneRule)), "button button-small" + (region === "bane" ? " is-active" : ""), ' data-region="bane"') + '</div>' : '<div class="army-cell-region-tabs"><strong>' + escapeHtml(title) + ' · ' + escapeHtml(cellRuleLabel(mechanics.rule)) + '</strong></div>') +
    '<p class="army-cell-instruction">' + escapeHtml(required) + ' <span>Enemy side →</span></p>' +
    '<div class="army-cell-target-grid" role="group" aria-label="Battlefield fields" style="--army-grid-columns:' + size.width + ';--army-grid-rows:' + size.height + '">' + cells + units + '</div>' +
    (rule === "PickedColumn" ? '<p class="section-note">' + (pick.lane >= 0 ? 'Lane ' + (pick.lane + 1) + ' selected · affects ' + selectedLaneUnits.length + (selectedLaneUnits.length === 1 ? ' lineup entry.' : ' lineup entries.') : 'Choose one lane. Each lane runs from the rear edge toward the enemy.') + '</p>' :
      isEditable ? '<p class="section-note">' + targetCells.length + ' of ' + count + ' selected</p>' : '') +
    '</section></div>';
}

function renderArmyEditor(record: ArmyRecord, catalog: ArmyCatalog, roster: UnitRoster, mode: EditorMode, selectedArmyPlacementId: string | null, activeStep: number, catalogKind: ArmyCatalogKind, helpVisible: boolean, returnState?: RelatedEditorReturnState, cellFocus?: { abilityId: string | null; region: "boon" | "bane" }, abilityFilters: ArmyAbilityFilters = defaultArmyAbilityFilters, abilityCategory: ArmyAbilityKind = "spells", abilitySelections: ArmyAbilitySelections = defaultArmyAbilitySelections): string {
  const floor = Math.max(1, Math.min(99, record.previewFloor || 1)), size = armyGridSize(catalog, floor, record.blessingIds);
  const selected = record.units.find(item => item.id === selectedArmyPlacementId), resolved = selected ? resolveArmyLevel(catalog, selected.unitId) : undefined;
  const actualKind = catalogKind;
  const list = renderArmyPlacementList(record, catalog, selectedArmyPlacementId), grid = renderArmyGrid(record, size, catalog, roster, selectedArmyPlacementId);
  const picker = renderArmyPicker(catalog, actualKind, selected, roster);
  const board = '<div class="army-board-column"><div class="army-board-heading"><div><h2>' + size.width + ' × ' + size.height + '</h2></div>' + inputField("Battle floor", "previewFloor", floor, { type: "number", min: 1, max: 99, rerender: true }) + '</div><p class="section-note help-copy">Select a field and click an open cell to move it. Drag onto another placement to swap positions.</p>' + grid + '</div>';
  const unitSpellIds = selected?.spellIds ?? [], unitSpells = unitSpellIds.map((id, index) => armyAbilityChip(catalog, id, index, "unit-spell")).join("");
  const unitSpellPanel = selected ? '<section class="army-unit-spells"><span class="eyebrow">SPELLS FOR THIS ' + (resolved?.kind === "buildings" ? "BUILDING" : "UNIT") + '</span><div class="army-add-row">' + pickerField("army-unit-spell-picker", "Spell", "", [["", "Choose a spell"], ...catalog.spells.map(item => [item.id, item.name, spellBlessingTooltip(catalog, item)] as [string, string, string])]) + actionButton("add-army-unit-spell", "Add", "button button-small") + '</div><div id="army-unit-spell-preview">' + renderArmyAbilityPreview(catalog, "", "spells") + '</div><div class="army-chips">' + (unitSpells || '<p class="section-note">No spells assigned.</p>') + '</div></section>' : '<p class="section-note help-copy">Select a lineup entry to edit its spells.</p>';
  const selectedStats = selected && resolved ? armyLevelMarkup(resolved.entity, resolved.level, resolved.kind, armyLevelPreviewPath(selected.unitId, resolved.level, resolved.kind, roster)) : '<div class="army-preview-empty">Select a unit or building to see full stats.</div>';
  const detail = selected ? selectedStats + unitSpellPanel : '<div class="army-preview-empty">Select a unit or building to see full stats and edit its spells.</div>';
  const spells = record.spellIds.map((id, index) => armyAbilityChip(catalog, id, index, "spell")).join("");
  const blessings = record.blessingIds.map((id, index) => armyAbilityChip(catalog, id, index, "blessing")).join("");
  const cellFocusOverlay = cellFocus?.abilityId ? renderArmyCellTargetFocus(record, catalog, roster, cellFocus.abilityId, cellFocus.region) : "";
  const perEntrySpellReview = record.units.map(placement => {
    const entry = resolveArmyLevel(catalog, placement.unitId);
    const name = entry?.entity.name || placement.unitId;
    const assigned = placement.spellIds.map(id => catalog.spells.find(spell => spell.id === id)?.name || id);
    return name + ": " + (assigned.length ? assigned.join(", ") : "no spells");
  });
  const steps = ["Name", "Choose units", "Arrange grid", "Army spells", "Blessings", "Curses", "Review"];
  if (mode === "guided") {
    const step = Math.max(0, Math.min(steps.length - 1, activeStep));
    guidedFinalStepActive = step === steps.length - 1;
    let screen = "";
    if (step === 0) screen = '<div class="army-name-focus"><label class="field"><span class="field-label">Army name</span><input data-bind="name" value="' + escapeHtml(record.name) + '" placeholder="Bridge guards" autocomplete="off"></label></div>';
    else if (step === 1) screen = '<div class="army-guided-units"><section class="army-focus-panel"><p class="section-note help-copy">Choose the lineup now; arrange the positions next.</p>' + picker + '</section><aside class="army-secondary-panel">' + list + (selected ? unitSpellPanel : '') + '</aside></div>';
    else if (step === 2) screen = '<div class="army-guided-position"><section class="army-position-focus">' + board + list + '</section><aside class="army-position-inspector">' + detail + '</aside></div>';
    else if (step >= 3 && step <= 5) {
      const abilityKind = step === 3 ? "spells" : step === 4 ? "blessings" : "curses";
      const entries = abilityKind === "spells" ? record.spellIds : record.blessingIds;
      screen = '<div class="army-guided-loadout"><section class="army-focus-panel">' + renderArmyAbilityPicker(catalog, abilityKind, entries, abilityKind === "spells" ? entries : record.blessingIds, abilityFilters[abilityKind], abilitySelections[abilityKind]) +
        '</section><div class="army-context-muted"><strong>Army setup</strong><span>' + record.units.length + ' lineup entries</span></div></div>';
    } else screen = '<section class="army-review"><dl><div><dt>Name</dt><dd>' + escapeHtml(record.name || "Untitled army") + '</dd></div><div><dt>Board</dt><dd>Floor ' + floor + ' · ' + size.width + ' × ' + size.height + '</dd></div><div><dt>Lineup</dt><dd>' + record.units.length + ' units and buildings</dd></div><div><dt>Army spells</dt><dd>' + record.spellIds.length + '</dd></div><div><dt>Blessings and curses</dt><dd>' + record.blessingIds.length + '</dd></div></dl>' + list + '<div class="army-review-effects"><span>Spells</span><div class="army-chips">' + (spells || "<small>None</small>") + '</div><span>Blessings / curses</span><div class="army-chips">' + (blessings || "<small>None</small>") + '</div></div>' + reviewList("Spells by lineup entry", perEntrySpellReview) + '</section>';
    return '<main class="workspace-main army-editor guided-editor' + (guidedContextUnmuted ? ' guided-context-unmuted' : '') + ' army-guided-step-' + step + '">' + renderGuidedEditorHeader("Army", record.name || "New army", returnState, helpVisible) + '<div class="army-guided-progress" role="progressbar" aria-label="Army setup" aria-valuemin="1" aria-valuemax="' + steps.length + '" aria-valuenow="' + (step + 1) + '"><span style="width:' + ((step + 1) / steps.length * 100) + '%"></span></div><section class="army-guided-screen"><div class="army-guided-heading"><span>Step ' + (step + 1) + ' of ' + steps.length + '</span><h1>' + steps[step] + '</h1></div>' + screen + '</section>' + renderWorkflowFooter(steps, step, "Ready to export") + '</main>' + cellFocusOverlay;
  }
  const activeAbilityIds = abilityCategory === "spells" ? record.spellIds : record.blessingIds;
  const armyAbilities = '<section class="army-wide-abilities" id="army-loadout"><div class="army-loadout-heading"><div><span class="eyebrow">LOADOUT</span><h2>Army abilities</h2></div>' +
    renderArmyAbilityTabs(record, catalog, abilityCategory) + '</div><div class="army-loadout-picker">' +
    renderArmyAbilityPicker(catalog, abilityCategory, activeAbilityIds, activeAbilityIds, abilityFilters[abilityCategory], abilitySelections[abilityCategory]) + '</div></section>';
  const advancedSections = [
    { id: "army-identity", label: "Basics" }, { id: "army-placement", label: "Formation" },
    { id: "army-lineup", label: "Lineup" }, { id: "army-loadout", label: "Loadout" }
  ];
  return '<main class="workspace-main army-editor full-army-editor"><div class="workspace-heading"><div><h1>' + escapeHtml(record.name || record.id || "Untitled army") + '</h1><p class="help-copy">Edit the complete lineup and loadout here, or switch to Guided flow to build it in focused steps.</p></div><div class="heading-status">' + actionButton("open-guided-editor", "✦ Guided flow", "button button-mode-guided") + '</div></div>' +
    renderAdvancedSectionNav(advancedSections) +
    '<section class="army-identity" id="army-identity"><label class="field"><span class="field-label">Army name</span><input data-bind="name" value="' + escapeHtml(record.name) + '" placeholder="Bridge guards"></label>' + inputField("Army ID (system managed)", "id", record.id, { readOnly: true, hint: "Generated automatically; referenced by quest nodes." }) + '</section>' +
    '<section class="army-layout" id="army-placement">' + board + '<aside class="army-pickers">' + picker + unitSpellPanel + '</aside></section>' +
    '<div class="army-compact-panels">' + armyAbilities + '<section class="army-roster-section" id="army-lineup"><div class="section-heading"><div><h2>Lineup</h2><p class="help-copy">Select a row to preview it in the formation and edit its spells.</p></div></div>' + list + '</section></div>' +
    '<section class="army-data-note help-copy"><strong>Game loading pending</strong><p>Authored Armies are included in exports; the game does not load them yet.</p></section></main>' + cellFocusOverlay;
}

const MISSION_SHOP_KIND_LABELS: Array<[MissionShopOfferKind, string]> = [
  ["Unit", "Units"], ["Blessing", "Blessings"], ["Research", "Research"], ["SpellUnlock", "Spell unlocks"]
];

function missionShopItemOptions(catalog: ArmyCatalog, kind: MissionShopOfferKind): Array<[string, string]> {
  if (kind === "Blessing") return catalog.blessings.map(item => [item.id, item.name]);
  if (kind === "SpellUnlock") return catalog.spells.map(item => [item.id, item.name]);
  return catalog.units.flatMap(unit => unit.levels.map(level => [level.id, unit.name + " · " + level.name] as [string, string]));
}

function missionShopPoolChips(kinds: MissionShopOfferKind[], scope: "mission" | "floor"): string {
  return '<div class="mission-shop-pools" role="group" aria-label="Available shop pools">' + MISSION_SHOP_KIND_LABELS.map(([kind, label]) => {
    const active = kinds.includes(kind);
    return '<button type="button" class="mission-shop-pool-chip' + (active ? " is-active" : "") + '" data-action="mission-toggle-shop-pool" data-scope="' + scope + '" data-kind="' + kind + '" aria-pressed="' + String(active) + '"><span>' + (active ? "✓" : "+") + '</span>' + label + '</button>';
  }).join("") + '</div>';
}

function renderMissionFloorReview(floor: MissionFloor, workspace: Workspace, mission: MissionRecord): string {
  const nodes = floor.mode === "random" ? [] : floor.nodes.map(node => {
      const quest = node.questId ? workspace.quests.find(item => item.definition.id === node.questId) : undefined;
      const army = node.armyId ? workspace.armies.find(item => item.id === node.armyId) : undefined;
      const reference = node.kind === "Quest" ? node.questId ? " · Quest " + (quest?.definition.title ? quest.definition.title + " (" + node.questId + ")" : node.questId) : " · Quest missing" :
        node.kind === "Battle" || node.kind === "Boss" ? node.armyId ? " · Army " + (army?.name ? army.name + " (" + node.armyId + ")" : node.armyId) : node.enemyFactionId ? " · " + node.enemyFactionId : "" :
      node.kind === "Reward" ? " · " + node.rewardAmount + " " + node.rewardKind + (node.rewardContentId ? " · " + node.rewardContentId : "") :
      node.kind === "Shop" && node.shopOfferMode === "exact" ? " · Exact stock: " + node.shopOffers.map(offer => offer.kind + " " + offer.contentId + " · " + offer.price + " Sardines").join(", ") : "";
    return (node.label || node.kind) + " · " + node.kind + reference;
  });
  const routes = floor.mode === "random" ? [] : floor.routes.map(route => {
    const from = floor.nodes.find(node => node.id === route.fromNodeId);
    const to = floor.nodes.find(node => node.id === route.toNodeId);
    return from && to ? (from.label || from.id) + (route.oneWay ? " → " : " ↔ ") + (to.label || to.id) : "Unresolved route";
  });
  const generation = floor.mode === "authored" ? "" : floor.randomSettings.nodeCount + " generated nodes · " + floor.randomSettings.questNodeCount + " Quest " + (floor.randomSettings.questNodeCount === 1 ? "node" : "nodes") + " · " + floor.randomSettings.shopNodeCount + " " + (floor.randomSettings.shopNodeCount === 1 ? "Shop" : "Shops");
  const pool = floor.mode === "authored" ? "" : floor.questPoolMode === "mission" ? "Quest pool: mission pool" : "Quest pool: " + (floor.questPoolIds.map(id => workspace.quests.find(quest => quest.definition.id === id)?.definition.title || id).join(", ") || "empty");
  const shopKinds = floor.shopPoolMode === "custom" ? floor.shopPoolKinds : mission.settings.shopPoolKinds;
  const shop = "Shop tier " + floor.shopLevel + " · " + (shopKinds.length ? shopKinds.map(kind => MISSION_SHOP_KIND_LABELS.find(([value]) => value === kind)?.[1] ?? kind).join(", ") : "no generated stock pools");
  const detail = [floor.mode === "random" ? "All nodes generated" : floor.mode === "mixed" ? "Mixed" : "Hand placed", ...(floor.mode === "random" ? [] : [floor.nodes.length + " placed nodes", floor.routes.length + " routes"]), generation, pool, shop].filter(Boolean).join(" · ");
  return '<section class="mission-floor-review"><h3>Floor ' + floor.number + ' · ' + (floor.mode === "random" ? "Random" : floor.mode === "mixed" ? "Mixed" : "Hand placed") + '</h3><p>' + escapeHtml(detail) + '</p>' +
    (nodes.length ? reviewList("Nodes", nodes) : "") + (routes.length ? reviewList("Routes", routes) : "") + '</section>';
}

const MISSION_EVENT_TRIGGER_LABELS: Array<[string, string]> = [
  ["mission-start", "Mission starts"],
  ["before-battle", "Before a battle"],
  ["after-battle", "After a battle"],
  ["node-cleared", "After a node is cleared"]
];

function missionEventSummary(event: MissionRecord["events"][number], mission: MissionRecord, workspace: Workspace): string {
  const trigger = MISSION_EVENT_TRIGGER_LABELS.find(([value]) => value === event.trigger)?.[1] ?? event.trigger;
  const floor = mission.floors.find(item => item.number === event.floorNumber);
  const node = floor?.nodes.find(item => item.id === event.nodeId);
  const target = event.trigger === "mission-start" ? "Mission start" :
    (floor ? "Floor " + floor.number : "All floors") + (node ? " · " + (node.label || node.kind) : " · All matching nodes");
  const action = event.actions.find(item => item.kind === "replace-player-army");
  const army = typeof action?.armyId === "string" ? workspace.armies.find(item => item.id === action.armyId) : undefined;
  return trigger + " · " + target + (action ? " · Player army: " + (army?.name ?? (action.armyId || "choose an army")) : " · No supported action");
}

function renderMissionEventEditor(event: MissionRecord["events"][number], eventIndex: number, mission: MissionRecord, workspace: Workspace, mode: EditorMode, focused: boolean): string {
  const path = (field: string) => "events." + eventIndex + "." + field;
  const eventIdAttribute = ' data-event-id="' + escapeHtml(event.id) + '"';
  const floorOptions: Array<[string, string]> = [["", "Every floor"], ...mission.floors.map(item => [String(item.number), "Floor " + item.number] as [string, string])];
  const floor = mission.floors.find(item => item.number === event.floorNumber);
  const eligibleNodes = floor ? floor.nodes.filter(node => event.trigger === "node-cleared"
    ? node.kind !== "Start"
    : (event.trigger === "before-battle" || event.trigger === "after-battle") && (node.kind === "Battle" || node.kind === "Boss")) : [];
  const targetFields = event.trigger === "mission-start" ? "" : '<div class="mission-event-target-fields">' +
    selectField("Floor", path("floorNumber"), event.floorNumber ?? "", floorOptions, "", true, true) +
    (floor ? selectField("Specific node", path("nodeId"), event.nodeId ?? "", [["", "All matching nodes"], ...eligibleNodes.map(node => [node.id, node.label + " · " + node.kind] as [string, string])], "", true) : "") +
    '</div>';
  const actionRows = event.actions.map((action, actionIndex) => {
    if (action.kind !== "replace-player-army") return '<div class="mission-event-unknown-action"><span>Unsupported action</span><code>' + escapeHtml(action.kind || "(missing kind)") + '</code></div>';
    const armyId = typeof action.armyId === "string" ? action.armyId : "";
    const army = workspace.armies.find(item => item.id === armyId);
    return '<div class="mission-event-action-row"><div class="mission-event-action-heading"><strong>Replace player army</strong>' +
      (event.actions.filter(item => item.kind === "replace-player-army").length > 1 ? actionButton("mission-remove-event-action", "Remove", "text-button danger-text", ' data-index="' + actionIndex + '"' + eventIdAttribute) : "") + '</div>' +
      selectField("Player army", path("actions." + actionIndex + ".armyId"), armyId, [["", "Choose an Army Editor army"], ...workspace.armies.map(item => [item.id, item.name + " · " + item.id] as [string, string])]) +
      '<div class="related-editor-actions">' + actionButton("create-mission-event-army", "＋ Create army", "text-button related-create", eventIdAttribute) +
      (army ? actionButton("open-mission-event-army", "Edit linked army", "text-button related-open", ' data-army-id="' + escapeHtml(army.id) + '"' + eventIdAttribute) : "") + '</div></div>';
  }).join("");
  const hasReplaceAction = event.actions.some(action => action.kind === "replace-player-army");
  const idField = mode === "full" ? inputField("Event ID", path("id"), event.id, { placeholder: "intro-army" }) :
    '<details class="advanced-rule-disclosure"><summary>Advanced · stable event ID</summary>' + inputField("Event ID", path("id"), event.id, { placeholder: "intro-army" }) + '</details>';
  return '<section class="mission-event-editor' + (focused ? " mission-event-focus" : "") + '" data-mission-event="' + escapeHtml(event.id) + '">' +
    '<div class="mission-event-editor-heading"><div><span class="eyebrow">EVENT ' + (eventIndex + 1) + '</span><h3>' + escapeHtml(MISSION_EVENT_TRIGGER_LABELS.find(([value]) => value === event.trigger)?.[1] ?? "Mission event") + '</h3></div>' +
    (focused ? actionButton("mission-events-back", "← Events", "button button-outline") : actionButton("mission-remove-event", "Remove", "icon-button danger-icon", eventIdAttribute + ' aria-label="Remove mission event" title="Remove mission event"')) + '</div>' +
    selectField("When", path("trigger"), event.trigger, MISSION_EVENT_TRIGGER_LABELS, "", true) + targetFields +
    '<section class="mission-event-actions"><div class="mission-event-section-heading"><h4>Actions</h4>' + (!hasReplaceAction ? actionButton("mission-add-event-action", "＋ Add action", "text-button related-create", eventIdAttribute) : "") + '</div>' +
    (actionRows || '<p class="mission-event-empty-action">Add an action to this event.</p>') + '</section>' + idField + '</section>';
}

function renderMissionEventsList(mission: MissionRecord, workspace: Workspace): string {
  const rows = mission.events.map(event => '<div class="mission-event-list-row"><button type="button" class="mission-event-list-main" data-action="mission-select-event" data-event-id="' + escapeHtml(event.id) + '"><strong>' + escapeHtml(MISSION_EVENT_TRIGGER_LABELS.find(([value]) => value === event.trigger)?.[1] ?? "Mission event") + '</strong><span>' + escapeHtml(missionEventSummary(event, mission, workspace)) + '</span></button>' +
    actionButton("mission-remove-event", "Remove", "icon-button danger-icon", ' data-event-id="' + escapeHtml(event.id) + '" aria-label="Remove mission event" title="Remove mission event"') + '</div>').join("");
  return '<section class="mission-event-list"><div class="mission-event-list-heading">' + actionButton("mission-add-event", "＋ Add event", "button button-outline") + '</div>' +
    (rows || '<p class="mission-event-empty">No mission events yet.</p>') + '</section>';
}

export interface QuestLibraryEntry {
  setId: string;
  id: string;
  title: string;
}

function renderMissionEditor(
  mission: MissionRecord,
  workspace: Workspace,
  catalog: ArmyCatalog,
  mode: EditorMode,
  viewState: MissionViewState,
  activeStep: number,
  helpVisible: boolean,
  returnState?: RelatedEditorReturnState,
  selectedMissionEventId: string | null = null,
  questLibrary: QuestLibraryEntry[] = []
): string {
  const floor = mission.floors.find(item => item.id === viewState.selectedFloorId) ?? mission.floors[0];
  const floorIndex = floor ? mission.floors.findIndex(item => item.id === floor.id) : -1;
  const selectedNode = floor?.nodes.find(node => node.id === viewState.selectedNodeId);
  const nodeIndex = selectedNode && floor ? floor.nodes.indexOf(selectedNode) : -1;
  const path = (field: string) => "floors." + floorIndex + ".nodes." + nodeIndex + "." + field;
  const allIssues = validateMission(mission, workspace, catalog);
  const errorCount = allIssues.filter(issue => issue.level === "error").length;
  const kindNames: AdventureNodeKind[] = ["Start", "Battle", "Reward", "Boss", "Quest", "Shop"];
  const floorTabs = mission.floors.map(item =>
    '<button type="button" class="mission-floor-tab' + (floor?.id === item.id ? " is-active" : "") + '" data-action="mission-select-floor" data-floor-id="' + escapeHtml(item.id) + '"><strong>Floor ' + item.number + '</strong><small>' + (item.mode === "authored" ? "Hand placed" : item.mode === "random" ? "Random" : "Mixed") + '</small></button>'
  ).join("");
  const startingSettings = '<section class="mission-settings-panel" id="mission-starting-run"><div class="mission-section-heading"><div><h2>Mission settings</h2></div></div>' +
    '<div class="form-grid two">' +
    selectField("Board preview unit", "boardPreviewUnitId", mission.boardPreviewUnitId ?? "", [
      ["", "Use selected faction hero"],
      ...catalog.units.flatMap(unit => unit.levels.map(level => [
        level.id,
        unit.name + " · Level " + level.level + " (" + unit.faction + ")"
      ] as [string, string]))
    ], "Shown as the player's character on the Adventure board. This does not change the starting Army.") +
    inputField("Starting lives", "settings.startingLives", mission.settings.startingLives, { type: "number", min: 1, max: 99 }) +
    inputField("Starting Sardines", "settings.startingSardines", mission.settings.startingSardines, { type: "number", min: 10, max: 50 }) +
    selectField(
      mission.settings.factionSelectionEnabled ? "Default player faction" : "Player faction used by this mission",
      "settings.playerFactionId",
      mission.settings.playerFactionId,
      [["", mission.settings.factionSelectionEnabled ? "Use game default" : "Choose a player faction"], ...catalog.factions.map(item => [item.id, item.name] as [string, string])]
    ) +
    '</div><label class="mission-check"><input type="checkbox" data-bind="settings.factionSelectionEnabled"' + (mission.settings.factionSelectionEnabled ? " checked" : "") + '><span>Allow faction selection</span></label>' +
    '<p class="help-copy">When disabled, the mission always uses its selected Player faction.</p>' +
    '<label class="mission-check"><input type="checkbox" data-bind="settings.battleShopEnabled"' + (mission.settings.battleShopEnabled ? " checked" : "") + '><span>Keep battle shop enabled</span></label>' +
    '<label class="mission-check"><input type="checkbox" data-bind="settings.sardinePayoutEnabled"' + (mission.settings.sardinePayoutEnabled ? " checked" : "") + '><span>Enable default Sardine payouts on generated rewards</span></label>' +
    (mission.settings.sardinePayoutEnabled ? '<div class="form-grid two">' +
      inputField("Sardine payout base", "settings.sardinePayoutBase", mission.settings.sardinePayoutBase, { type: "number", min: 0 }) +
      inputField("Extra Sardines per floor", "settings.sardinePayoutPerFloor", mission.settings.sardinePayoutPerFloor, { type: "number", min: 0 }) +
      '</div>' : '') + '</section>';
  const generatedFloorSettings = '<section class="mission-settings-panel" id="mission-progression"><div class="mission-section-heading"><div><h2>' + (mission.designMode === "settings-only" ? "Later generated floors" : "After these boards") + '</h2></div></div>' +
    '<label class="mission-check"><input type="checkbox" data-bind="settings.continueWithGeneratedFloors"' + (mission.settings.continueWithGeneratedFloors ? " checked" : "") + '><span>Continue with generated floors</span></label>' +
    (mission.settings.continueWithGeneratedFloors ? '<div class="form-grid two">' +
      inputField("Initial random node count", "settings.startingNodeCount", mission.settings.startingNodeCount, { type: "number", min: 12, max: 30, step: 2 }) +
      (mission.questIds.length || mission.settings.questNodeCountPerRandomFloor ? inputField("Generated quest nodes", "settings.questNodeCountPerRandomFloor", mission.settings.questNodeCountPerRandomFloor, { type: "number", min: 0, max: 4 }) : "") +
      inputField("Generated shop nodes", "settings.shopNodeCountPerRandomFloor", mission.settings.shopNodeCountPerRandomFloor, { type: "number", min: 0, max: 7 }) +
      inputField("Node growth per floor", "settings.nodeGrowthPerFloor", mission.settings.nodeGrowthPerFloor, { type: "number", min: 1, max: 10 }) +
      '</div>' : '<p class="mission-progression-note help-copy">Generated floor rules are available when the mission continues beyond these boards.</p>') + '</section>';
  const settings = startingSettings + generatedFloorSettings;
  const missionShopSettings = '<section class="mission-shop-pools-settings"><h2>Generated shop pools</h2><p>Choose the offers generated shops may draw.</p>' + missionShopPoolChips(mission.settings.shopPoolKinds, "mission") + '</section>';
  const floorShopSettings = floor ? '<section class="mission-shop-unlocks"><div class="mission-floor-tabs mission-shop-floor-tabs">' + floorTabs + '</div><div class="mission-shop-floor-fields">' +
    selectField("Floor " + floor.number + " shop tier", "floors." + floorIndex + ".shopLevel", floor.shopLevel, [["1", "Tier 1"], ["2", "Tier 2"], ["3", "Tier 3"], ["4", "Tier 4"]], "", true) +
    '<div class="mission-shop-floor-pool-mode"><span>Offer pools</span>' + actionButton("mission-toggle-floor-shop-mode", floor.shopPoolMode === "custom" ? "Use mission pools" : "Choose floor pools", "button button-small button-outline") + '</div>' +
    (floor.shopPoolMode === "custom" ? missionShopPoolChips(floor.shopPoolKinds, "floor") : '<p class="mission-shop-inherited">Uses: ' + escapeHtml((mission.settings.shopPoolKinds.length ? mission.settings.shopPoolKinds.map(kind => MISSION_SHOP_KIND_LABELS.find(([value]) => value === kind)?.[1] ?? kind).join(", ") : "no offer pools")) + '</p>') +
    '</div></section>' : '<div class="mission-empty-state">Add a floor to configure shop unlocks.</div>';
  const missionShopAdvanced = '<details id="mission-shops" class="mission-shop-advanced"><summary>Shop pools and floor unlocks</summary><div class="mission-shop-advanced-content">' + missionShopSettings + floorShopSettings + '</div></details>';

  let board = "";
  let randomControls = "";
  let selectedRoutes: MissionFloor["routes"] = [];
  let routes = "";
  let nodeProperties = "";
  if (floor) {
    const showQuestNodeCount = mission.questIds.length > 0 || floor.randomSettings.questNodeCount > 0;
    randomControls = floor.mode === "authored" ? "" : '<section class="mission-random-settings"><div><span class="eyebrow">' + (floor.mode === "random" ? "GENERATED BOARD" : "GENERATED ADDITIONS") + '</span><strong>' + (floor.mode === "random" ? "Set the floor shape" : "Fill the spaces around your hand-placed nodes") + '</strong><small class="help-copy">' + (floor.mode === "random" ? "Node count includes the Start and Boss nodes." : "Generated count is added to your authored nodes; Start and Boss remain hand placed.") + '</small></div><div class="form-grid three">' +
      inputField(floor.mode === "random" ? "Total nodes" : "Add generated nodes", "floors." + floorIndex + ".randomSettings.nodeCount", floor.randomSettings.nodeCount, { type: "number", min: floor.mode === "random" ? 12 : 0, max: floor.mode === "mixed" ? Math.max(0, 30 - floor.nodes.length) : 30, step: floor.mode === "random" ? 2 : 1, rerender: true }) +
      (showQuestNodeCount ? inputField("Quest nodes", "floors." + floorIndex + ".randomSettings.questNodeCount", floor.randomSettings.questNodeCount, { type: "number", min: 0, max: 4, rerender: true }) : "") +
      inputField("Shop nodes", "floors." + floorIndex + ".randomSettings.shopNodeCount", floor.randomSettings.shopNodeCount, { type: "number", min: 0, max: 7, rerender: true }) +
      '</div></section>';

    const mapCoordinates = floor.nodes.length ? floor.nodes : [{ x: 0, y: 0 }];
    const minX = Math.min(...mapCoordinates.map(node => node.x));
    const maxX = Math.max(...mapCoordinates.map(node => node.x));
    const minY = Math.min(...mapCoordinates.map(node => node.y));
    const maxY = Math.max(...mapCoordinates.map(node => node.y));
    const snap = 120;
    const offsetX = 120 - minX * snap;
    const offsetY = 100 - minY * snap;
    const canvasWidth = Math.max(720, (maxX - minX) * snap + 240);
    const canvasHeight = Math.max(420, (maxY - minY) * snap + 200);
    const routeLines = floor.routes.map(route => {
      const from = floor.nodes.find(node => node.id === route.fromNodeId);
      const to = floor.nodes.find(node => node.id === route.toNodeId);
      if (!from || !to) return "";
      const fromCenterX = offsetX + from.x * snap;
      const fromCenterY = offsetY + from.y * snap;
      const toCenterX = offsetX + to.x * snap;
      const toCenterY = offsetY + to.y * snap;
      const dx = toCenterX - fromCenterX;
      const dy = toCenterY - fromCenterY;
      const distance = Math.hypot(dx, dy) || 1;
      // Attach each end on the circle edge, angled toward the other node.
      const edge = 40;
      const x1 = fromCenterX + dx / distance * edge;
      const y1 = fromCenterY + dy / distance * edge;
      const x2 = toCenterX - dx / distance * edge;
      const y2 = toCenterY - dy / distance * edge;
      const fromName = from.label;
      const toName = to.label;
      const mapSteps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      const distanceText = String(mapSteps);
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - 5;
      return '<g class="mission-route-group"><path class="mission-route-line' + (route.oneWay ? " is-one-way" : "") + (viewState.selectedRouteId === route.id ? " is-selected" : "") + '" data-mission-route-id="' + escapeHtml(route.id) + '" role="button" tabindex="0" aria-label="Connection: ' + escapeHtml(fromName + (route.oneWay ? " to " : " with ") + toName + "; map distance " + distanceText + (mapSteps === 1 ? " step" : " steps")) + '" d="M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 + '"' + (route.oneWay ? ' marker-end="url(#mission-arrow)"' : "") + '/><text class="mission-route-distance" x="' + labelX + '" y="' + labelY + '" aria-hidden="true">' + distanceText + '</text></g>';
    }).join("");
    const selectedRoute = floor.routes.find(route => route.id === viewState.selectedRouteId);
    const selectedRouteFrom = selectedRoute && floor.nodes.find(node => node.id === selectedRoute.fromNodeId);
    const selectedRouteTo = selectedRoute && floor.nodes.find(node => node.id === selectedRoute.toNodeId);
    const selectedRouteX = selectedRouteFrom && selectedRouteTo ? offsetX + ((selectedRouteFrom.x + selectedRouteTo.x) / 2) * snap : 0;
    const selectedRouteY = selectedRouteFrom && selectedRouteTo ? offsetY + ((selectedRouteFrom.y + selectedRouteTo.y) / 2) * snap : 0;
    const selectedRouteRemove = selectedRoute && selectedRouteFrom && selectedRouteTo
      ? '<button type="button" class="mission-route-remove-float" style="left:' + selectedRouteX + 'px;top:' + selectedRouteY + 'px" data-action="mission-remove-route" data-route-id="' + escapeHtml(selectedRoute.id) + '" aria-label="Disconnect ' + escapeHtml(selectedRouteFrom.label + " and " + selectedRouteTo.label) + '" title="Disconnect">×</button>'
      : "";
    const pendingNode = floor.nodes.find(node => node.id === viewState.pendingPlugFromId);
    const pendingX = pendingNode ? offsetX + pendingNode.x * snap + 62 : 0;
    const pendingY = pendingNode ? offsetY + pendingNode.y * snap : 0;
    const pendingLine = '<line class="mission-route-draft" x1="' + pendingX + '" y1="' + pendingY + '" x2="' + pendingX + '" y2="' + pendingY + '"' + (pendingNode ? "" : " hidden") + '/>';
    const portPosition = (node: MissionNode, route?: MissionRoute): string => {
      if (!route) return "left:50%;top:50%;right:auto;";
      const otherId = route.fromNodeId === node.id ? route.toNodeId : route.fromNodeId;
      const other = floor.nodes.find(candidate => candidate.id === otherId);
      if (!other) return "left:50%;top:50%;right:auto;";
      const dx = other.x - node.x;
      const dy = other.y - node.y;
      const distance = Math.hypot(dx, dy) || 1;
      return "left:" + (34 + dx / distance * 34) + "px;top:" + (34 + dy / distance * 34) + "px;right:auto;transform:translate(-50%,-50%);";
    };
    const nodes = floor.nodes.map(node => {
      const nodeRoutes = floor.routes.filter(route => route.fromNodeId === node.id || route.toNodeId === node.id);
      const outputStyle = portPosition(node, nodeRoutes[0]);
      const inputStyle = portPosition(node, nodeRoutes[1] ?? nodeRoutes[0]);
      return '<div draggable="true" class="mission-node mission-node-' + node.kind.toLowerCase() + (selectedNode?.id === node.id ? " is-selected" : "") + (viewState.pendingPlugFromId === node.id ? " is-route-source" : "") + '" data-mission-node data-node-id="' + escapeHtml(node.id) + '" style="left:' + (offsetX + node.x * snap) + 'px;top:' + (offsetY + node.y * snap) + 'px">' +
      '<button type="button" class="mission-node-port mission-node-input" style="' + inputStyle + '" data-mission-port="input" data-node-id="' + escapeHtml(node.id) + '" aria-label="Connect into ' + escapeHtml(node.label) + '" title="Drop a connection here"></button>' +
      '<button type="button" class="mission-node-select" data-action="mission-node" data-node-id="' + escapeHtml(node.id) + '" aria-label="Edit ' + escapeHtml(node.kind + ": " + node.label + ", grid cell " + node.x + ", " + node.y) + '" title="Grid cell ' + node.x + ', ' + node.y + '"><span class="mission-node-symbol">' + ({ Start: "S", Battle: "⚔", Reward: "★", Boss: "B", Quest: "?", Shop: "$" } as Record<string, string>)[node.kind] + '</span><strong>' + escapeHtml(node.label) + '</strong><small>' + escapeHtml(node.kind) + ' · ' + node.x + ', ' + node.y + '</small></button>' +
      '<button type="button" class="mission-node-port mission-node-output" style="' + outputStyle + '" data-mission-port="output" data-node-id="' + escapeHtml(node.id) + '" aria-label="Drag from ' + escapeHtml(node.label) + ' to connect" title="Drag to another node’s input plug"></button></div>';
    }).join("");
    const addMenu = '<div class="mission-node-menu"' + (viewState.addMenuOpen ? '' : ' hidden') + ' aria-label="Choose node type">' + kindNames.map(kind => {
        const uniqueTaken = kind === "Start" || kind === "Boss" ? floor.nodes.some(node => node.kind === kind) : false;
        return '<button type="button" class="mission-add-kind' + (viewState.interactionMode === "add" && viewState.nodeKind === kind ? " is-active" : "") + '" data-action="mission-node-tool" data-kind="' + kind + '" title="Add ' + kind + ' node" aria-pressed="' + String(viewState.interactionMode === "add" && viewState.nodeKind === kind) + '"' + (uniqueTaken ? " disabled" : "") + '><b>' + ({ Start: "S", Battle: "⚔", Reward: "★", Boss: "B", Quest: "?", Shop: "$" } as Record<string, string>)[kind] + '</b>' + kind + '</button>';
      }).join("") + '</div>';
    const tools = floor.mode === "random" ? "" : '<div class="mission-board-tools"><button type="button" class="button button-outline mission-add-node-button" data-action="mission-toggle-add-menu" aria-expanded="' + String(viewState.addMenuOpen) + '">＋ Add node</button>' + addMenu + '</div>';
    const interactionHint = viewState.interactionMode === "add"
      ? "Click an empty map spot to place a " + viewState.nodeKind + " node."
      : "Drag plugs to connect. Click a node to edit, drag it to move, or click a line to disconnect.";
    const interactionStatus = '<div class="mission-map-status" data-mode="' + viewState.interactionMode + '" role="status" aria-live="polite"><span class="help-copy">' + escapeHtml(interactionHint) + '</span>' +
      (viewState.interactionMode === "add" ? actionButton("mission-select-mode", "Cancel placement", "text-button mission-cancel-action") : "") + '</div>';
    const nodeEvents = mission.events.filter(event => event.nodeId === selectedNode?.id && (!event.floorNumber || event.floorNumber === floor?.number));
    const nodeEventsMarkup = !selectedNode ? "" : '<div class="mission-node-events"><div class="mission-node-events-head"><strong>Events on this node · ' + nodeEvents.length + '</strong>' +
      actionButton("mission-add-node-event", "＋ Add event", "button button-small button-outline") + '</div>' +
      (nodeEvents.length ? nodeEvents.map(event => '<button type="button" class="mission-node-event-row" data-action="mission-open-event" data-event-id="' + escapeHtml(event.id) + '">' +
        escapeHtml(MISSION_EVENT_TRIGGER_LABELS.find(([value]) => value === event.trigger)?.[1] ?? "Mission event") + ' · ' +
        escapeHtml(missionEventSummary(event, mission, workspace)) + '</button>').join("") : '<p class="help-copy">No events on this node yet.</p>') + '</div>';
    nodeProperties = selectedNode ? '<div class="mission-node-inspector"><div class="mission-inspector-heading"><div><h3>' + escapeHtml(selectedNode.kind) + '</h3></div>' + actionButton("mission-remove-node", "Remove node", "text-button danger-text") + '</div>' +
      inputField("Node name", path("label"), selectedNode.label, { placeholder: selectedNode.kind + " node" }) + nodeEventsMarkup +
      ((selectedNode.kind === "Battle" || selectedNode.kind === "Boss") ? '<div class="form-grid two">' +
        selectField("Enemy army", path("armyId"), selectedNode.armyId, [["", "Use generated army"], ...workspace.armies.map(army => [army.id, army.name + " · " + army.units.length + " units"] as [string, string])], "Create detailed formations in Armies.") +
        selectField("Enemy faction", path("enemyFactionId"), selectedNode.enemyFactionId, [["", "Use army or game default"], ...catalog.factions.map(item => [item.id, item.name] as [string, string])]) +
        '</div><div class="related-editor-actions">' + actionButton("create-mission-army", "＋ Create army", "text-button related-create") +
        (selectedNode.armyId ? actionButton("open-mission-army", "Edit linked army", "text-button related-open", ' data-army-id="' + escapeHtml(selectedNode.armyId) + '"') : "") + '</div>' : "") +
      (selectedNode.kind === "Quest" ? selectField("Quest on this node", path("questId"), selectedNode.questId, [["", "Choose from mission quest pool"], ...mission.questIds.flatMap(id => {
        const quest = workspace.quests.find(item => item.definition.id === id);
        return quest ? [[id, quest.definition.title || id] as [string, string]] : [];
      })], mission.questIds.length ? "This assignment is fixed for the floor." : "Add quests to the mission pool below.") +
        '<div class="related-editor-actions">' + actionButton("create-mission-node-quest", "＋ Create quest", "text-button related-create") +
        (selectedNode.questId ? actionButton("open-mission-node-quest", "Edit linked quest", "text-button related-open", ' data-quest-id="' + escapeHtml(selectedNode.questId) + '"') : "") + '</div>' : "") +
      (selectedNode.kind === "Reward" ? '<div class="form-grid two">' +
        selectField("Reward", path("rewardKind"), selectedNode.rewardKind, [["Sardines", "Sardines"], ["ExtraLife", "Extra life"], ["Blessing", "Blessing"], ["UnitUnlock", "Unlock unit in shop"], ["UnitReward", "Unit reward"], ["ShopLevelUnlock", "Shop level unlock"], ["SpellUnlock", "Spell unlock"]]) +
        (selectedNode.rewardKind === "UnitUnlock" || selectedNode.rewardKind === "UnitReward"
          ? selectField("Unit", path("rewardContentId"), selectedNode.rewardContentId,
            [["", "Choose a unit level"], ...missionShopItemOptions(catalog, "Unit")],
            selectedNode.rewardKind === "UnitUnlock" ? "Unlocked in this run's battle shop." : "Added to the player's army for this run.")
          : inputField("Amount", path("rewardAmount"), selectedNode.rewardAmount, { type: "number", min: 0, max: 9999 }) +
            (selectedNode.rewardKind === "Blessing" || selectedNode.rewardKind === "SpellUnlock" ? inputField("Content ID", path("rewardContentId"), selectedNode.rewardContentId, { placeholder: "Catalog ID" }) : "")) +
        '</div>' : "") +
      (selectedNode.kind === "Shop" ? '<details class="mission-shop-node-settings"' + (mode === "guided" ? " open" : "") + '><summary>Shop stock · ' + (selectedNode.shopOfferMode === "exact" ? selectedNode.shopOffers.length + " exact offers" : "uses floor pools") + '</summary><div class="mission-shop-node-content">' +
        selectField("Stock", path("shopOfferMode"), selectedNode.shopOfferMode, [["generated", "Use pools unlocked on this floor"], ["exact", "Set exact items and prices"]], "", true) +
        (selectedNode.shopOfferMode === "exact" ? '<p class="mission-shop-note">Adventure map shops show three offers. Exact stock replaces the generated offers for this node.</p>' +
          '<div class="mission-shop-offer-list">' + selectedNode.shopOffers.map((offer, offerIndex) => {
            const offerPath = "shopOffers." + offerIndex;
            const itemOptions = missionShopItemOptions(catalog, offer.kind);
            return '<div class="mission-shop-offer-row"><div class="mission-shop-offer-fields">' +
              selectField("Pool", path(offerPath + ".kind"), offer.kind, MISSION_SHOP_KIND_LABELS, "", true) +
              selectField("Item", path(offerPath + ".contentId"), offer.contentId, [["", "Choose item"], ...itemOptions], "", true) +
              inputField("Price · Sardines", path(offerPath + ".price"), offer.price, { type: "number", min: 0, max: 9999 }) +
              '</div>' + actionButton("mission-remove-shop-offer", "×", "icon-button mission-remove-shop-offer", ' data-index="' + offerIndex + '" aria-label="Remove shop offer ' + (offerIndex + 1) + '" title="Remove offer"') + '</div>';
          }).join("") + '</div>' +
          actionButton("mission-add-shop-offer", "＋ Add offer", "button button-small button-outline", ' data-node-id="' + escapeHtml(selectedNode.id) + '"' + (selectedNode.shopOffers.length >= 3 ? " disabled" : "")) : "") +
        '</div></details>' : "") +
      (mode === "full" ? '<details class="mission-advanced-node" open><summary>Stable node ID</summary>' + inputField("Node ID", path("id"), selectedNode.id) + '</details>' : "") +
      '</div>' : '<div class="mission-node-inspector mission-inspector-empty"><p class="help-copy">Select a node on the board to edit it.</p></div>';
    selectedRoutes = selectedNode ? floor.routes.filter(route => route.fromNodeId === selectedNode.id || route.toNodeId === selectedNode.id) : [];
    routes = selectedRoutes.map(route => {
      const from = floor.nodes.find(node => node.id === route.fromNodeId);
      const to = floor.nodes.find(node => node.id === route.toNodeId);
      const routeDescription = (from?.label ?? "?") + (route.oneWay ? " to " : " linked with ") + (to?.label ?? "?");
      return '<li class="mission-route-row"><span>' + escapeHtml(from?.label ?? "?") + (route.oneWay ? " → " : " ↔ ") + escapeHtml(to?.label ?? "?") + '</span><div class="mission-route-actions">' +
        actionButton("mission-toggle-route-direction", route.oneWay ? "Make two-way" : "Make one-way", "text-button route-direction", ' data-route-id="' + escapeHtml(route.id) + '" aria-label="' + (route.oneWay ? "Make " + escapeHtml(routeDescription) + " two-way" : "Make " + escapeHtml(routeDescription) + " one-way") + '"') +
        actionButton("mission-remove-route", "Disconnect", "text-button route-disconnect", ' data-route-id="' + escapeHtml(route.id) + '" aria-label="Disconnect ' + escapeHtml(routeDescription) + '"') + '</div></li>';
    }).join("");
    const routeList = selectedNode
      ? '<section class="mission-route-list" aria-label="Selected node connections"><div class="mission-route-list-heading"><strong>Connections</strong><span>' + selectedRoutes.length + '</span></div>' + (routes ? '<ul>' + routes + '</ul>' : '<small>No routes connected to this node yet.</small>') + '</section>'
      : "";
    board = '<div class="mission-board-workspace" id="mission-map">' + (floor.mode === "random" ? '<div class="mission-random-preview"><div class="mission-random-mark">✧</div><div><strong>Floor ' + floor.number + ' is generated in game</strong><p class="help-copy">Its node totals and generated Quest/Shop counts are set in Floors.</p></div></div>' :
      '<div class="mission-board-layout"><section class="mission-board-column"><div class="mission-board-instructions"><div><h2>Place nodes and connect routes</h2></div><span class="mission-node-count">' + floor.nodes.length + (floor.mode === "mixed" ? ' + ' + floor.randomSettings.nodeCount + ' generated' : '') + ' / 30</span></div>' + tools +
      interactionStatus + '<div class="mission-canvas-scroll"><div class="mission-canvas' + (viewState.interactionMode === "add" ? " is-adding" : "") + '" data-mission-canvas data-offset-x="' + offsetX + '" data-offset-y="' + offsetY + '" data-snap="' + snap + '" style="width:' + canvasWidth + 'px;height:' + canvasHeight + 'px;--snap-bg-x:' + (offsetX % snap) + 'px;--snap-bg-y:' + (offsetY % snap) + 'px" role="group" aria-label="Adventure node graph canvas"><svg class="mission-route-layer" viewBox="0 0 ' + canvasWidth + ' ' + canvasHeight + '" aria-hidden="true"><defs><marker id="mission-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>' + routeLines + pendingLine + '</svg>' + nodes + selectedRouteRemove + '</div></div>' + (mode === "full" ? routeList : "") + '</section>' + (mode === "full" ? nodeProperties : "") + '</div>') + '</div>';
  }

  const floorModes = '<div class="mission-mode-switch" role="group" aria-label="Floor board mode">' +
    (["authored", "mixed", "random"] as MissionFloorMode[]).map(modeName => '<button type="button" data-action="mission-set-floor-mode" data-mode="' + modeName + '" class="' + (floor?.mode === modeName ? "is-active" : "") + '">' + (modeName === "authored" ? "Hand placed" : modeName === "random" ? "Random" : "Mixed") + '</button>').join("") + '</div>';
  const generatesQuestsOnFloor = !!floor && floor.mode !== "authored" && floor.randomSettings.questNodeCount > 0;
  const generatesQuestsLater = mission.settings.continueWithGeneratedFloors && mission.settings.questNodeCountPerRandomFloor > 0;
  const floorPoolDisclosure = floor && (generatesQuestsOnFloor || generatesQuestsLater) ? '<details class="mission-floor-pool"><summary>Random quest pool · ' + (floor.questPoolMode === "custom" ? "custom for this floor" : "using mission pool") + '</summary><div class="mission-floor-pool-content"><div><strong>Quest nodes on this floor</strong><p class="help-copy">' + (floor.questPoolMode === "custom" ? "Random Quest nodes will be chosen from this smaller list." : "Random Quest nodes can use any quest selected for the mission.") + '</p></div>' +
    actionButton("mission-toggle-floor-pool-mode", floor.questPoolMode === "custom" ? "Use mission pool" : "Choose a floor pool", "button button-small button-outline") +
    (floor.questPoolMode === "custom" ? (mission.questIds.length ? '<label class="mission-quest-filter"><span>Find a mission quest</span><input type="search" data-mission-quest-filter="floor" placeholder="Search by name"></label><div class="mission-floor-quest-options">' + mission.questIds.map(id => {
      const quest = workspace.quests.find(item => item.definition.id === id);
      const active = floor.questPoolIds.includes(id);
      return '<button type="button" class="mission-quest-chip' + (active ? " is-active" : "") + '" data-action="mission-toggle-floor-quest" data-quest-id="' + escapeHtml(id) + '"><i>' + (active ? "✓" : "+") + '</i><span><strong>' + escapeHtml(quest?.definition.title ?? id) + '</strong><small>' + escapeHtml(quest?.definition.objectiveKind ?? "Missing quest") + '</small></span></button>';
    }).join("") + '</div>' : '<small class="section-note">Add quests to the mission pool first.</small>') : "") +
    '</div></details>' : "";
  const poolRows = workspace.quests.map(quest => {
    const id = quest.definition.id;
    const active = mission.questIds.includes(id);
    return '<div class="mission-quest-row"><button type="button" class="mission-quest-chip' + (active ? " is-active" : "") + '" data-action="mission-toggle-quest" data-quest-id="' + escapeHtml(id) + '"><i>' + (active ? "✓" : "+") + '</i><span><strong>' + escapeHtml(quest.definition.title || id) + '</strong><small>' + escapeHtml(quest.definition.objectiveKind) + '</small></span></button>' +
      actionButton("open-mission-pool-quest", "Edit", "text-button related-open", ' data-quest-id="' + escapeHtml(id) + '"') + '</div>';
  }).join("");
  const libraryRows = questLibrary.length
    ? questLibrary.map(entry => {
      const already = workspace.quests.some(quest => quest.definition.id === entry.id);
      return '<button type="button" class="mission-quest-chip' + (already ? " is-active" : "") + '"' +
        (already ? " disabled" : ' data-action="import-set-quest" data-set-id="' + escapeHtml(entry.setId) + '" data-quest-id="' + escapeHtml(entry.id) + '"') +
        '><i>' + (already ? "✓" : "+") + '</i><span><strong>' + escapeHtml(entry.title || entry.id) + '</strong><small>' + escapeHtml(entry.setId) + '</small></span></button>';
    }).join("")
    : '<p class="section-note help-copy">No quests in other sets yet.</p>';
  const poolDisclosure = '<details class="mission-pool-panel" open><summary>Quest pool <span>' + mission.questIds.length + ' selected · ' + workspace.quests.length + ' available</span></summary>' +
    '<div class="mission-pool-actions">' + actionButton("create-mission-pool-quest", "＋ Create quest", "text-button related-create") + '</div>' +
    (workspace.quests.length ? '<div class="mission-quest-pool-list">' + poolRows + '</div>' : '<p class="section-note help-copy">Create a quest to add it to this mission.</p>') +
    '<details class="mission-quest-library"><summary>Add existing quests from other sets</summary><div class="mission-quest-pool-list">' + libraryRows + '</div></details>' +
    '</details>';
  const identity = '<section class="mission-identity" id="mission-basics">' + inputField("Mission name", "name", mission.name, { placeholder: "The Willow Road" }) +
    textAreaField("Short description", "description", mission.description, "Shown in the game mission picker once that screen is connected.", 2) +
    (mode === "full" ? inputField("Mission ID (system managed)", "id", mission.id, { readOnly: true }) : '<details class="advanced-rule-disclosure"><summary>Advanced · stable ID</summary>' + inputField("Mission ID (system managed)", "id", mission.id, { readOnly: true, hint: "Generated automatically; referenced by game saves." }) + '</details>') +
    '</section>';
  const guidedNameField = inputField("Mission name", "name", mission.name, { placeholder: "The Willow Road" })
    .replace('data-bind="name"', 'data-bind="name" data-guided-autofocus');
  const guidedIdentity = '<section class="mission-guided-name">' +
    guidedNameField +
    '<details class="mission-optional-description"><summary>Add a short description (optional)</summary>' +
    textAreaField("Mission description", "description", mission.description, "Shown in the game mission picker once that screen is connected.", 2) + '</details>' +
    '</section>';
  const missionIssues = errorCount ? '<span class="mission-validation-badge has-errors">' + errorCount + ' to fix</span>' : '<span class="mission-validation-badge">Draft checks pass</span>';
  const heading = mode === "guided"
    ? renderGuidedEditorHeader("Mission", mission.name || "Untitled mission", returnState, helpVisible)
    : '<div class="workspace-heading"><div><h1>' + escapeHtml(mission.name || "Untitled mission") + '</h1><p class="help-copy">Edit the complete mission here, or switch to Guided flow for focused floor-by-floor authoring.</p></div><div class="mission-heading-actions">' + missionIssues + actionButton("open-guided-editor", "✦ Guided flow", "button button-mode-guided") + '</div></div>';
  const profile = '<div class="mission-profile">' + identity + (mode === "full" ? settings : '<details class="mission-advanced-settings"><summary>Advanced · start and generation settings</summary>' + settings + '</details>') + '</div>';
  const isSettingsOnly = mission.designMode === "settings-only" && mission.floors.length > 0 && mission.floors.every(item => item.mode === "random" && item.nodes.length === 0 && item.routes.length === 0);
  const hasGeneratedQuestNodes = mission.floors.some(item => (item.mode === "random" || item.mode === "mixed") && item.randomSettings.questNodeCount > 0) || (mission.settings.continueWithGeneratedFloors && mission.settings.questNodeCountPerRandomFloor > 0);
  const hasQuestContent = mission.questIds.length > 0 || hasGeneratedQuestNodes || mission.floors.some(item => item.nodes.some(node => node.kind === "Quest"));
  const hasFloorPoolChoices = mission.questIds.length > 0 && (mission.floors.some(item => (item.mode === "random" || item.mode === "mixed") && item.randomSettings.questNodeCount > 0) || generatesQuestsLater);
  const hasShopContent = mission.settings.shopNodeCountPerRandomFloor > 0 || mission.floors.some(item => item.nodes.some(node => node.kind === "Shop") || (item.mode !== "authored" && item.randomSettings.shopNodeCount > 0));
  const hasAuthoredBoards = mission.floors.some(item => item.mode !== "random");
  const floorSetup = '<section class="mission-floor-section mission-floor-setup' + "" + '"><div class="mission-floor-heading"><div><h2>' + (isSettingsOnly ? "Set generated floor rules" : "Choose the boards") + '</h2><p class="help-copy">' + (isSettingsOnly ? "Every floor is generated from these settings. Switch a floor to Hand placed to author its map." : "Each floor can be hand placed, generated, or mixed.") + '</p></div><div class="mission-floor-actions">' +
    actionButton("mission-remove-floor", "Remove floor", "text-button danger-text", mission.floors.length > 1 ? "" : " disabled") +
    actionButton("mission-add-floor", "＋ Add floor", "button button-outline") + '</div></div>' +
    '<div class="mission-floor-tabs">' + (floorTabs || "") + '</div>' +
    (floor ? '<div class="mission-floor-mode-row"><span>Floor ' + floor.number + ' layout</span>' + floorModes + '</div>' + randomControls : '<div class="mission-empty-state"><strong>No floor boards yet</strong><p class="help-copy">Add a floor to start laying out the mission.</p></div>') +
    '</section>';
  const mapBoard = '<section class="mission-map-step" id="mission-map"><div class="mission-map-step-heading"><div><h2>Arrange the path</h2></div><p class="help-copy">Nodes snap to the grid and show coordinates. Route labels use the game’s 8-direction map steps.</p></div>' +
    (floor?.mode === "random" ? '<div class="mission-random-preview"><div class="mission-random-mark">✧</div><div><strong>This floor is generated in game</strong><p class="help-copy">Its layout settings are on the Floors step.</p></div></div>' : board) + '</section>';
  const boards = '<section class="mission-boards-full" id="mission-floors">' + floorSetup + (mode === "full" ? (floorPoolDisclosure ? floorPoolDisclosure.replace('<details class="mission-floor-pool">', '<details class="mission-floor-pool" open>') : "") + board : "") + '</section>';
  const eventEditors = mission.events.map((event, index) =>
    '<div class="mission-event-editor-store" data-event-editor-id="' + escapeHtml(event.id) + '" hidden>' +
    renderMissionEventEditor(event, index, mission, workspace, "full", false) + '</div>').join("");
  const missionEventsSection = '<details class="mission-events-section" id="mission-events"><summary>Mission events · ' + mission.events.length + '</summary>' +
    '<div class="mission-events-overview">' + renderMissionEventsList(mission, workspace) + eventEditors + '</div></details>';
  if (mode === "full") {
    const sections = [
      { id: "mission-basics", label: "Basics" }, { id: "mission-floors", label: "Floors" },
      { id: "mission-map", label: "Map" },
      { id: "mission-events", label: "Events" },
      { id: "mission-shops", label: "Shops" },
      { id: "mission-starting-run", label: "Mission settings" }, { id: "mission-progression", label: "Progression" }
    ];
    return '<main class="workspace-main mission-editor">' + heading + renderAdvancedSectionNav(sections) + profile + boards + missionEventsSection + missionShopAdvanced +
      '<div class="guided-end-actions">' + '</div>' +
      '</main>';
  }

  const steps = mission.designMode === "choose" ? ["Approach"] : isSettingsOnly
    ? ["Name", "Randomizer settings", ...(hasQuestContent ? ["Quests"] : []), ...(hasFloorPoolChoices ? ["Floor pools"] : []), ...(hasShopContent ? ["Shop pools", "Shop unlocks"] : []), "Mission settings", ...(mission.events.length ? ["Events"] : []), "Review"]
    : ["Name", "Floors", ...(hasAuthoredBoards ? ["Node"] : []), "Quests", ...(hasFloorPoolChoices ? ["Floor pools"] : []), ...(hasShopContent ? ["Shop pools", "Shop unlocks"] : []), "Mission settings", ...(mission.events.length ? ["Events"] : []), "Review"];
  const step = Math.max(0, Math.min(steps.length - 1, activeStep));
  const stepName = steps[step];
  guidedFinalStepActive = step === steps.length - 1;
  const focusedNodeStep = stepName === "Node";
  const progress = '<div class="mission-guided-progress" role="progressbar" aria-label="Mission setup" aria-valuemin="1" aria-valuemax="' + steps.length + '" aria-valuenow="' + (step + 1) + '"><span style="width:' + ((step + 1) / steps.length * 100) + '%"></span></div>';
  const missionQuestNames = mission.questIds.map(id => {
    const quest = workspace.quests.find(item => item.definition.id === id);
    return (quest?.definition.title || id) + (quest && quest.definition.title !== id ? " (" + id + ")" : "");
  });
  const floorReviews = mission.floors.map(item => renderMissionFloorReview(item, workspace, mission)).join("");
  const previewUnit = mission.boardPreviewUnitId
    ? catalog.units.flatMap(unit => unit.levels.map(level => ({ unit, level })))
      .find(item => item.level.id === mission.boardPreviewUnitId)
    : null;
  const boardPreviewSummary = !mission.boardPreviewUnitId
    ? "Selected faction hero"
    : previewUnit ? previewUnit.unit.name + " · Level " + previewUnit.level.level : mission.boardPreviewUnitId;
  const startingRunSummary = mission.settings.startingLives + " lives · " + mission.settings.startingSardines + " Sardines · " + (mission.settings.playerFactionId || "game default faction") + " · faction choice " + (mission.settings.factionSelectionEnabled ? "on" : "off") + " · battle shop " + (mission.settings.battleShopEnabled ? "on" : "off");
  const progressionSummary = (mission.settings.continueWithGeneratedFloors ? "continues with generated floors" : "ends after listed floors") + " · " + mission.settings.startingNodeCount + " initial nodes · " + mission.settings.questNodeCountPerRandomFloor + " Quest nodes · " + mission.settings.shopNodeCountPerRandomFloor + " Shops · +" + mission.settings.nodeGrowthPerFloor + " nodes per floor";
  const missionShopPoolSummary = mission.settings.shopPoolKinds.length ? mission.settings.shopPoolKinds.map(kind => MISSION_SHOP_KIND_LABELS.find(([value]) => value === kind)?.[1] ?? kind).join(", ") : "none";
  const reviewRows = [
    reviewField("Mission", mission.name || "Untitled mission"),
    reviewField("Setup", isSettingsOnly ? "Randomizer only" : "Authored mission"),
    reviewField("Floors", String(mission.floors.length)),
    reviewField("Board preview", boardPreviewSummary),
    reviewField("Mission settings", startingRunSummary),
    reviewField("Generated shop pools", missionShopPoolSummary),
    reviewField("Mission events", String(mission.events.length)),
    reviewField("Generated progression", progressionSummary)
  ].join("");
  const eventReview = '<section class="mission-event-review"><div class="mission-event-list-heading"><div><h2>Mission events</h2></div>' +
    (mission.events.length ? actionButton("mission-edit-events", "Edit events", "button button-outline") : actionButton("mission-add-event", "＋ Add event", "button button-outline")) + '</div>' +
    (mission.events.length ? reviewList("Configured events", mission.events.map(event => missionEventSummary(event, mission, workspace))) : '<p class="mission-event-empty">Optional · change run data at mission milestones.</p>') + '</section>';
  const review = '<section class="mission-review"><div class="mission-review-heading"><h1>Review your mission</h1><p class="help-copy">' + (isSettingsOnly ? "Check the randomizer and run settings before exporting." : "Check the board and quest references before exporting.") + '</p></div>' +
    '<dl class="mission-review-summary">' + reviewRows + '</dl>' + (mission.description ? '<p class="mission-review-description">' + escapeHtml(mission.description) + '</p>' : '') +
    '<div class="mission-floor-reviews">' + floorReviews + '</div>' +
    (hasQuestContent ? reviewList("Mission quest pool", missionQuestNames) : "") +
    eventReview +
    '<div class="mission-review-validation">' + renderIssues(allIssues) + '</div>' +
    '<div class="guided-end-actions">' + '</div></section>';
  let screen = "";
  if (stepName === "Approach") {
    screen = '<section class="mission-approach"><p class="mission-step-prompt help-copy">Choose what you want to design. You can switch editors later.</p>' +
      '<div class="mission-approach-options"><button type="button" class="mission-approach-option" data-action="mission-design-choice" data-mode="settings-only"><strong>Randomizer settings only</strong><span class="help-copy">Generated floors, starting rules, and progression. No authored map or mission quests.</span></button>' +
      '<button type="button" class="mission-approach-option" data-action="mission-design-choice" data-mode="custom"><strong>Custom mission</strong><span class="help-copy">Author maps, nodes, quests, and the rules that connect them.</span></button></div></section>';
  } else if (stepName === "Name") {
    screen = '<section class="mission-setup-step"><p class="mission-step-prompt help-copy">Name the mission so your team can find it.</p>' + guidedIdentity + '</section>';
  } else if (stepName === "Floors" || stepName === "Randomizer settings") {
    // One step for adding a floor: generation settings and/or the hand-placed map.
    screen = floorSetup + (floor?.mode !== "random" ? board : "");
    if (isSettingsOnly && mission.questIds.length === 0) {
      screen += '<details class="mission-optional-quest-content"><summary>Add optional authored quests</summary><p class="help-copy">Only needed if generated floors should include mission quests.</p>' + actionButton("create-mission-pool-quest", "＋ Create a quest", "text-button related-create") + '</details>';
    }
  } else if (stepName === "Node") {
    const map = floor && floor.mode !== "random" ? mapBoard : "";
    screen = selectedNode && floor
      ? '<div class="mission-node-layout">' + map +
        '<section class="mission-node-focus"><div class="mission-node-focus-heading"><div><h2>Floor ' + floor.number + ' · ' + escapeHtml(selectedNode.label) + '</h2></div>' +
        actionButton("mission-back-to-map", "×", "icon-button mission-node-close", ' aria-label="Close node details" title="Close node details"') + '</div>' +
        nodeProperties + '<details class="mission-focused-connections"><summary>Connections · ' + selectedRoutes.length + '</summary>' + (routes ? '<ul>' + routes + '</ul>' : '<p class="help-copy">No routes connect to this node yet. Draw them from the map.</p>') + '</details></section></div>'
      : '<div class="mission-node-layout">' + map + '<section class="mission-node-focus-empty"><p class="help-copy">Choose a node on the map to edit its contents.</p></section></div>';
  } else if (stepName === "Quests") {
    screen = '<div class="mission-quest-step"><p class="mission-step-prompt help-copy">Choose the quests that can appear in this mission.</p><label class="mission-quest-filter"><span>Find a quest</span><input type="search" data-mission-quest-filter="mission" placeholder="Search by name"></label>' + poolDisclosure + '</div>';
  } else if (stepName === "Floor pools") {
    screen = '<div class="mission-floor-pool-step"><p class="mission-step-prompt help-copy">Choose whether ' + (floor ? 'Floor ' + floor.number : 'this floor') + ' uses every mission quest or a smaller pool.</p>' +
      (floorPoolDisclosure ? floorPoolDisclosure.replace('<details class="mission-floor-pool">', '<details class="mission-floor-pool" open>') : "") + '</div>';
  } else if (stepName === "Shop pools") {
    screen = '<section class="mission-settings-step mission-shop-pools-step"><p class="mission-step-prompt help-copy">Choose what generated map shops can offer.</p>' + missionShopSettings + '</section>';
  } else if (stepName === "Shop unlocks") {
    screen = '<section class="mission-settings-step mission-shop-unlocks-step"><p class="mission-step-prompt help-copy">Set the shop tier and offer pools available on each floor.</p>' + floorShopSettings + '</section>';
  } else if (stepName === "Mission settings") {
    screen = '<section class="mission-settings-step"><p class="mission-step-prompt help-copy">Choose the board character, starting resources, faction, and what happens after these boards.</p>' + settings + '</section>';
  } else if (stepName === "Events") {
    const selectedEventIndex = mission.events.findIndex(event => event.id === selectedMissionEventId);
    screen = selectedEventIndex >= 0
      ? renderMissionEventEditor(mission.events[selectedEventIndex], selectedEventIndex, mission, workspace, mode, true)
      : renderMissionEventsList(mission, workspace);
  } else {
    screen = review;
  }
  return '<main class="workspace-main mission-editor guided-editor' + (guidedContextUnmuted ? ' guided-context-unmuted' : '') + (focusedNodeStep ? ' mission-node-focus-mode' : '') + ((stepName === "Shop pools" || stepName === "Shop unlocks") ? ' mission-shop-focus-mode' : '') + '">' + heading + (focusedNodeStep ? '' : progress) +
    '<section class="mission-guided-screen" aria-labelledby="mission-step-title"><div class="mission-guided-step-heading"><span>' + (stepName === "Approach" ? "Mission setup" : "Step " + (step + 1) + " of " + steps.length + " · Mission") + '</span><h1 id="mission-step-title">' + stepName + '</h1></div>' +
    screen + '</section>' + (stepName === "Approach" ? "" : focusedNodeStep ? '<footer class="mission-focus-footer"><span>Changes save as you type</span><div class="mission-focus-actions">' +
      actionButton("mission-back-to-map", "← Back to map", "button button-primary") +
      actionButton("editor-next", steps[step + 1] ? "Continue to " + steps[step + 1] + " →" : "Next", "button button-outline") +
      '</div></footer>' : renderWorkflowFooter(steps, step, "Mission ready · export when you are ready")) +
    '</main>';
}

function renderGuidedQuestEditor(
  record: QuestRecord,
  workspace: Workspace,
  roster: UnitRoster,
  catalog: ArmyCatalog,
  activeStep: number,
  helpVisible: boolean,
  returnState?: RelatedEditorReturnState
): string {
  const quest = record.definition;
  const timerMode = record.extension.logicKind === "timer-project";
  const steps = ["Basics", "Objective", "Quest giver", "Offer", "In progress", "Reward", "Review"];
  const step = Math.max(0, Math.min(steps.length - 1, activeStep));
  guidedFinalStepActive = step === steps.length - 1;
  const issues = validateQuest(record, workspace, catalog);
  const targetOptions: Array<[string, string]> = [
    ["Battle", "Battle"], ["Reward", "Reward"], ["Boss", "Boss"], ["Shop", "Shop"], ["Custom", "Custom event"]
  ];
  const objectiveOptions: Array<[string, string]> = [
    ["Escort", "Escort a unit"], ["Fetch", "Fetch items"], ["Battle", "Battle"], ["ClearFloor", "Clear the floor"], ["KillCount", "Defeat a number of enemies"]
  ];

  let screen = "";
  if (step === 0) {
    screen = '<div class="guided-intro help-copy"><p>Start with a title, a short log description, and how the player receives this quest.</p></div>' +
      '<div class="form-grid two guided-fields">' +
      inputField("Quest title", "definition.title", quest.title, { placeholder: "Repair the Broken Bridge" }) +
      selectField("Quest source", "definition.sourceKind", quest.sourceKind, [["QuestGiver", "Quest giver"], ["Letter", "Letter"], ["Item", "Item"]], "", true) +
      textAreaField("Quest log description", "definition.description", quest.description, "Shown while the player tracks the objective.", 3) +
      '</div>';
  } else if (step === 1) {
    if (timerMode) {
      screen = '<div class="guided-intro help-copy"><p>Choose the goal for this quest.</p></div>' +
        '<div class="guided-callout"><strong>Existing advanced objective</strong><p class="help-copy">Timer settings stay preserved. Edit them in Advanced.</p></div>';
    } else {
      const objectiveSpecific = quest.objectiveKind === "Escort"
        ? unitPicker("Unit to escort", "definition.escortUnitId", quest.escortUnitId, roster, "")
        : quest.objectiveKind === "Fetch"
          ? renderFetchItems(record, false)
          : quest.objectiveKind === "Battle"
            ? renderBattleTargets(record, workspace)
            : quest.objectiveKind === "KillCount"
              ? renderKillCountObjective(record, catalog)
              : '<div class="form-grid two">' +
            selectField("Target type", "definition.targetNodeKind", quest.targetNodeKind, emptyOption(targetOptions, quest.targetNodeKind), "", true) +
            inputField("Target floor offset", "definition.targetFloorOffset", quest.targetFloorOffset, { type: "number", min: 0, max: 99, hint: "0 means this floor." }) +
            '</div>';
      screen = '<div class="guided-intro help-copy"><p>Choose the goal. The form only asks for the details that goal needs.</p></div>' +
        selectField("Player objective", "definition.objectiveKind", quest.objectiveKind, objectiveOptions, "", true) +
        '<div class="guided-objective-details">' + objectiveSpecific + renderMinimumDistances(record) + '</div>';
    }
  } else if (step === 2) {
    screen = '<div class="guided-intro help-copy"><p>Choose who offers this quest. The name fills from the selected character and stays editable.</p></div>' +
      '<div class="form-grid two guided-fields">' +
      unitPicker("Quest giver character", "definition.speakerUnitId", quest.speakerUnitId, roster, "May be blank for a letter or narration-only source.") +
      speakerNameField("Speaker name", "definition.speakerName", quest.speakerName, quest.speakerUnitId, roster) +
      '</div>';
  } else if (step === 3) {
    screen = '<div class="guided-intro help-copy"><p>Write what the player hears when the quest is offered.</p></div>' +
      '<div class="guided-fields guided-writing-field">' + textAreaField("Offer text", "definition.offerText", quest.offerText, "Shown when this quest is offered.", 5) + '</div>';
  } else if (step === 4) {
    screen = '<div class="guided-intro help-copy"><p>Write the update the player sees while this quest is underway.</p></div>' +
      '<div class="guided-fields guided-writing-field">' + textAreaField("In-progress text", "definition.activeText", quest.activeText, "Shown while the quest is underway.", 5) + '</div>';
  } else if (step === 5) {
    screen = '<div class="guided-intro help-copy"><p>Choose what the player receives when the quest is complete.</p></div>' +
      '<div class="form-grid two guided-fields">' +
      selectField("Reward", "definition.rewardKind", quest.rewardKind, [["Sardines", "Sardines"], ["ExtraLife", "Extra life"], ["Blessing", "Blessing"]], "", true) +
      inputField("Amount", "definition.rewardAmount", quest.rewardAmount, { type: "number", min: 0, max: 9999 }) +
      '</div>';
  } else {
    screen = renderQuestReview(record, workspace, issues);
  }

  return '<main class="workspace-main guided-editor' + ([0, 2, 3, 4].includes(step) ? ' is-writing' : '') + '">' +
    renderGuidedEditorHeader("Quest", quest.title || "Untitled quest", returnState, helpVisible) +
    '<section class="guided-step-screen" aria-labelledby="workflow-screen-title">' +
    '<div class="guided-step-heading"><span>Step ' + (step + 1) + ' of ' + steps.length + '</span><h1 id="workflow-screen-title">' + steps[step] + '</h1></div>' +
    screen +
    '</section>' +
    (step === steps.length - 1
      ? '<div class="guided-end-actions quest-export-actions">' + '</div>'
      : "") +
    '<p class="guided-keyboard-hint help-copy">Enter continues · Shift+Enter adds a line break</p>' +
    renderWorkflowFooter(steps, step, "Ready to export") +
    '</main>';
}

function renderQuestEditor(
  record: QuestRecord,
  workspace: Workspace,
  roster: UnitRoster,
  catalog: ArmyCatalog,
  activeStep: number,
  mode: EditorMode,
  helpVisible: boolean,
  returnState?: RelatedEditorReturnState
): string {
  if (mode === "guided") return renderGuidedQuestEditor(record, workspace, roster, catalog, activeStep, helpVisible, returnState);

  const quest = record.definition;
  const extension = record.extension;
  const timerMode = extension.logicKind === "timer-project";
  const steps = ["Details", "Objective", "Story", "Reward", "Dialogue", "Progress", "Effects", "Review"];
  const issues = validateQuest(record, workspace, catalog);
  const targetOptions: Array<[string, string]> = [
    ["Battle", "Battle"], ["Reward", "Reward"], ["Boss", "Boss"], ["Shop", "Shop"], ["Custom", "Custom event"]
  ];
  const objectiveOptions: Array<[string, string]> = [
    ["Escort", "Escort a unit"], ["Fetch", "Fetch an item"], ["Battle", "Win a battle"],
    ["ClearFloor", "Clear the floor"], ["KillCount", "Defeat a number of enemies"], ["Timer", "Timer project"]
  ];
  const objectiveSpecific = quest.objectiveKind === "Escort"
    ? unitPicker("Unit to escort", "definition.escortUnitId", quest.escortUnitId, roster, "Uses a stable UnitCatalog ID.")
    : quest.objectiveKind === "Fetch"
      ? renderFetchItems(record, true)
      : quest.objectiveKind === "Battle"
        ? renderBattleTargets(record, workspace)
        : quest.objectiveKind === "KillCount"
          ? renderKillCountObjective(record, catalog)
          : '<div class="field-hint inline-hint help-copy">This objective targets a ' + escapeHtml(quest.targetNodeKind || "Battle") + ' node.</div>';
  const renderSection = (sectionStep: number): string => {
    let screen = "";
    if (sectionStep === 0) {
      screen = '<div class="form-block"><div class="section-heading"><div><h2>Give the quest an identity</h2></div></div>' +
      '<div class="form-grid two">' +
      inputField("Quest ID (system managed)", "definition.id", quest.id, { readOnly: true, hint: "Generated automatically; cannot be changed." }) +
      inputField("Quest title", "definition.title", quest.title, { placeholder: "A clear, short title" }) +
      textAreaField("Quest Log description", "definition.description", quest.description, "Shown while the player tracks the objective.", 3) +
      '</div></div><div class="form-block"><div class="section-heading"><div><h2>Where and when it appears</h2></div></div>' +
      '<div class="form-grid three">' +
      selectField("Quest source", "definition.sourceKind", quest.sourceKind, [["QuestGiver", "Quest giver"], ["Letter", "Letter"], ["Item", "Item"]], "", true) +
      selectField("Source slot", "definition.sourceSlot", quest.sourceSlot, [["-1", "Either slot"], ["0", "Slot 0"], ["1", "Slot 1"]], "Use Either unless the content needs a fixed map slot.", true) +
      inputField("First available floor", "definition.firstFloor", quest.firstFloor, { type: "number", min: 1, max: 99 }) +
      inputField("Repeat every floors", "definition.repeatEveryFloors", quest.repeatEveryFloors, { type: "number", min: 1, max: 99 }) +
      inputField("Priority", "definition.priority", quest.priority, { type: "number", min: 0, max: 999 }) +
      '</div></div>';
    } else if (sectionStep === 1) {
      screen = '<div class="form-block"><div class="section-heading"><div><h2>What should the player do?</h2></div></div>' +
      '<div class="form-grid two">' +
      selectField("Objective type", "definition.objectiveKind", quest.objectiveKind, objectiveOptions, "", true) +
      (quest.objectiveKind === "Timer"
        ? '<div class="field-hint inline-hint help-copy">A timer project lets the player choose an outcome, then tracks progress across battles.</div>'
        : objectiveSpecific) +
      (quest.objectiveKind !== "Timer" && quest.objectiveKind !== "Battle" && quest.objectiveKind !== "KillCount"
        ? selectField("Target node", "definition.targetNodeKind", quest.targetNodeKind, emptyOption(targetOptions, quest.targetNodeKind), "", true) +
          inputField("Target floor offset", "definition.targetFloorOffset", quest.targetFloorOffset, { type: "number", min: 0, max: 99, hint: "0 means this floor." })
        : "") +
      '</div>' + renderMinimumDistances(record, true) + '</div>';
    } else if (sectionStep === 2) {
      screen = '<div class="form-block"><div class="section-heading"><div><h2>Write the player-facing text</h2><p class="help-copy">Authored dialogues can replace these fallback fields.</p></div></div>' +
      '<div class="form-grid two">' +
      unitPicker("Speaker avatar ID", "definition.speakerUnitId", quest.speakerUnitId, roster, "May be blank for a letter or narration-only source.") +
      inputField("Speaker name", "definition.speakerName", quest.speakerName, { placeholder: "Village Elder" }) +
      textAreaField("Offer text", "definition.offerText", quest.offerText, "Shown when this quest is offered.", 3) +
      textAreaField("Active text", "definition.activeText", quest.activeText, "Shown while the quest is underway.", 3) +
      '<label class="mission-check"><input type="checkbox" data-bind="definition.autoAccept"' + (quest.autoAccept ? " checked" : "") + '><span>Auto-accept after the offer dialogue (no accept/decline choice)</span></label>' +
      (!quest.autoAccept ? inputField("Accept label", "definition.acceptLabel", quest.acceptLabel) +
        inputField("Decline label", "definition.declineLabel", quest.declineLabel) : "") +
      '</div></div>';
    } else if (sectionStep === 3) {
      screen = '<div class="form-block"><div class="section-heading"><div><h2>Choose the quest reward</h2></div></div>' +
      '<div class="form-grid three">' +
      selectField("Reward type", "definition.rewardKind", quest.rewardKind, [["Sardines", "Sardines"], ["ExtraLife", "Extra life"], ["Blessing", "Blessing"]], "", true) +
      inputField("Amount", "definition.rewardAmount", quest.rewardAmount, { type: "number", min: 0, max: 9999 }) +
      inputField("Reward content ID", "definition.rewardContentId", quest.rewardContentId, { placeholder: "Optional blessing ID" }) +
      '</div></div>';
    } else if (sectionStep === 4) {
      screen = '<div class="form-block"><div class="section-heading"><div><h2>Connect authored sequences</h2><p class="help-copy">The game does not read these links yet.</p></div></div>' +
      '<div class="form-grid two">' +
      dialogueLinkField("Offer", "extension.dialogueLinks.offer", extension.dialogueLinks.offer, workspace, "offer") +
      dialogueLinkField("Progress", "extension.dialogueLinks.active", extension.dialogueLinks.active, workspace, "active") +
      dialogueLinkField("Completion", "extension.dialogueLinks.completion", extension.dialogueLinks.completion, workspace, "completion") +
      dialogueLinkField("Failure", "extension.dialogueLinks.failure", extension.dialogueLinks.failure, workspace, "failure") +
      '</div></div>';
    } else if (sectionStep === 5) {
      screen = timerMode
      ? '<div class="form-block"><div class="section-heading"><div><h2>Set its progress rule</h2><p class="help-copy">Choose the decision outcomes and progress event that complete this project.</p></div></div>' +
        '<div class="form-grid two">' +
        inputField("Decision ID", "extension.timer.decisionId", extension.timer.decisionId, { placeholder: "project-decision", hint: "Matches the named result set by the offer dialogue." }) +
        inputField("Counter ID", "extension.timer.counterId", extension.timer.counterId, { placeholder: "completed-battles" }) +
        inputField("Pay outcome ID", "extension.timer.payOutcomeId", extension.timer.payOutcomeId, { placeholder: "pay-now" }) +
        inputField("Wait outcome ID", "extension.timer.waitOutcomeId", extension.timer.waitOutcomeId, { placeholder: "wait" }) +
        inputField("Progress label", "extension.timer.counterLabel", extension.timer.counterLabel, { placeholder: "Completed battles" }) +
        inputField("Battles to wait", "extension.timer.counterTarget", extension.timer.counterTarget, { type: "number", min: 1, max: 100 }) +
        selectField("Progress trigger", "extension.timer.countEvent", extension.timer.countEvent, [["any-battle-completed", "Any completed battle"], ["battle-won", "Battle victory only"]], "", true) +
        inputField("Payment resource", "extension.timer.paymentResource", extension.timer.paymentResource, { placeholder: "Sardines" }) +
        inputField("Payment amount", "extension.timer.paymentAmount", extension.timer.paymentAmount, { type: "number", min: 0, max: 9999 }) +
        '</div>' +
        toggleField("Payment finishes the project now", "extension.timer.paymentCompletesImmediately", extension.timer.paymentCompletesImmediately, "The game should disable this choice when the player cannot afford it.") +
        '</div>'
      : '<div class="form-block"><div class="section-heading"><div><h2>Handled by the objective</h2></div></div>' +
        '<p class="section-note help-copy">This quest uses the existing ' + escapeHtml(quest.objectiveKind) + ' objective. No additional counter or decision is configured.</p></div>';
    } else if (sectionStep === 6) {
      const effects = timerMode ? extension.timer.completionEffects : extension.completionEffects;
      const path = timerMode ? "extension.timer.completionEffects" : "extension.completionEffects";
      const scope = timerMode ? "timer" : "standard";
      screen = '<div class="form-block"><div class="section-heading"><div><h2>What changes when it is done?</h2><p class="help-copy">Use a route ID or shop item ID from this mission. Event IDs are recorded on the run for game systems to consume.</p></div>' +
      actionButton("add-effect", "＋ Add effect", "button button-small", ' data-scope="' + scope + '"') + '</div>' +
      (effects.length ? renderEffects(effects, path, scope) : '<div class="soft-empty">No additional effects. The normal quest reward still applies.</div>') +
      '</div>';
    } else {
      screen = renderQuestReview(record, workspace, issues);
    }
    return screen;
  };

  const sectionIds = ["details", "objective", "story", "reward", "dialogues", "progress", "effects", "review"];
  const sections = steps.map((label, index) => ({ id: "quest-" + sectionIds[index], label }));
  const advancedSections = steps.map((label, index) =>
    '<section class="advanced-editor-section" id="quest-' + sectionIds[index] + '" aria-label="' + escapeHtml(label) + '">' +
    renderSection(index) + '</section>'
  ).join("");

  return '<main class="workspace-main">' +
    '<div class="workspace-heading">' +
    '<div><h1>' + escapeHtml(quest.title || quest.id || "Untitled quest") + '</h1><p class="help-copy">Edit the complete quest in one view, or switch to Guided flow for focused authoring.</p></div>' +
    '<div class="heading-status ' + (issues.some(issue => issue.level === "error") ? "has-errors" : "is-ready") + '">' + actionButton("open-guided-editor", "✦ Guided flow", "button button-mode-guided") + (issues.some(issue => issue.level === "error") ? '<span></span>Needs attention' : "") + '</div>' +
    '</div>' +
    renderAdvancedSectionNav(sections) +
    '<div class="advanced-editor-content quest-advanced-content">' + advancedSections + '</div>' +
    '</main>';
}

function renderIssues(issues: ValidationIssue[]): string {
  const errors = issues.filter(issue => issue.level === "error").length;
  const warnings = issues.filter(issue => issue.level === "warning").length;
  return '<section class="validation-card" aria-live="polite">' +
    '<div class="validation-top"><div><h2>Validation</h2></div>' +
    '<div class="validation-counts">' + (errors ? '<span class="count count-error">' + errors + ' errors</span>' : '<span class="count count-ok">Ready</span>') +
    (warnings ? '<span class="count count-warning">' + warnings + (warnings === 1 ? ' note' : ' notes') + '</span>' : "") +
    '</div></div>' +
    (issues.length
      ? '<ul class="issue-list">' + issues.map(issue => '<li class="issue-' + issue.level + '"><span></span>' + escapeHtml(issue.message) + '</li>').join("") + '</ul>'
      : "") +
    '</section>';
}

export function renderValidationSummary(issues: ValidationIssue[]): string {
  return renderIssues(issues);
}

let scratchMode = false;
let guidedContextUnmuted = false;
export function setGuidedContextUnmuted(value: boolean): void { guidedContextUnmuted = value; }
let guidedFinalStepActive = true;
export function setScratchMode(value: boolean): void { scratchMode = value; }

export function renderApp(
  workspace: Workspace,
  roster: UnitRoster,
  catalog: ArmyCatalog,
  allIssues: ValidationIssue[],
  activeEditorStep = 0,
  editorMode: EditorMode = "guided",
  selectedArmyPlacementId: string | null = null,
  missionViewState: MissionViewState = { selectedFloorId: null, selectedNodeId: null, interactionMode: "select", nodeKind: "Battle", addMenuOpen: false, pendingPlugFromId: null, selectedRouteId: null },
  relatedReturnState?: RelatedEditorReturnState,
  armyCatalogKind: ArmyCatalogKind = "units",
  helpVisible = false,
  cellFocus?: { abilityId: string | null; region: "boon" | "bane" },
  abilityFilters: ArmyAbilityFilters = defaultArmyAbilityFilters,
  abilityCategory: ArmyAbilityKind = "spells",
  abilitySelections: ArmyAbilitySelections = defaultArmyAbilitySelections,
  selectedMissionEventId: string | null = null,
  publishAllowed = true,
  questLibrary: QuestLibraryEntry[] = [],
  editorTabs: Array<{ section: string; key: string; label: string }> = [],
  activeTabKey = "",
  canSave = true
): string {
  guidedFinalStepActive = editorMode === "full";
  const item = selectedItem(workspace);
  const guidedCompact = editorMode === "guided" && item !== null;
  const hasErrors = allIssues.some(issue => issue.level === "error");
  const bridgeUserId = getBridgeUserId();
  const toolbar = '<div class="topbar-actions">' +
    actionButton("toggle-context", "☰ Context", "text-button") +
    actionButton("open-content-picker", "Browse", "text-button", ' aria-haspopup="dialog"') +
    (relatedReturnState ? actionButton("return-to-parent", "← " + escapeHtml(relatedReturnState.label), "text-button return-to-parent", ' aria-label="Return to ' + escapeHtml(relatedReturnState.parent) + '" title="Return to ' + escapeHtml(relatedReturnState.parent) + '"') : "") +
    (bridgeUserId && publishAllowed && canPublish() ? actionButton("publish-package", "Publish", "button button-primary", publishAllowed ? "" : " disabled") : "") +
    (bridgeUserId ? actionButton("save-package", scratchMode ? "Save locally" : "Save to cloud", "button button-outline",
      canSave ? "" : " disabled title=\"No changes to save yet\"") : "") +
    (bridgeUserId && !scratchMode ? actionButton("exit-save", "Exit & save", "button button-outline") +
      actionButton("exit-discard", "Exit & discard", "text-button danger-text") : "") +
    (bridgeUserId ? actionButton("open-content-editor", scratchMode ? "← Dashboard" : "← Set", "text-button open-content-editor") : "") +
    (bridgeUserId ? actionButton("bridge-sign-out", "Sign out", "text-button bridge-sign-out") : "") +
    (item && !guidedCompact ? helpToggleButton(helpVisible) : "") +
    '</div>';
  let content: string;
  if (!item) {
    content = '<main class="workspace-main welcome-main">' +
      '<div class="welcome-hero"><h1>What are you making?</h1></div>' +
      '<div class="create-actions">' +
      '<button type="button" class="create-action" data-action="new-dialogue"><span class="create-action-mark">D</span><span><strong>Dialogue</strong></span><b aria-hidden="true">→</b></button>' +
      '<button type="button" class="create-action" data-action="new-quest"><span class="create-action-mark">Q</span><span><strong>Quest</strong></span><b aria-hidden="true">→</b></button>' +
      '<button type="button" class="create-action" data-action="new-army"><span class="create-action-mark">A</span><span><strong>Army</strong></span><b aria-hidden="true">→</b></button>' +
      '<button type="button" class="create-action" data-action="new-mission"><span class="create-action-mark">C</span><span><strong>Mission</strong></span><b aria-hidden="true">→</b></button>' +
      '</div>' +
      '</main>';
  } else if ("sequence" in item) {
    content = renderDialogueEditor(item, workspace, roster, activeEditorStep, editorMode, relatedReturnState, helpVisible);
  } else if ("definition" in item) {
    content = renderQuestEditor(item, workspace, roster, catalog, activeEditorStep, editorMode, helpVisible, relatedReturnState);
  } else if ("floors" in item) {
    content = renderMissionEditor(item, workspace, catalog, editorMode, missionViewState, activeEditorStep, helpVisible, relatedReturnState, selectedMissionEventId, questLibrary);
  } else {
    content = renderArmyEditor(item, catalog, roster, editorMode, selectedArmyPlacementId, activeEditorStep, armyCatalogKind, helpVisible, relatedReturnState, cellFocus, abilityFilters, abilityCategory, abilitySelections);
  }

  const tabStrip = editorTabs.length > 1
    ? '<div class="editor-tabs">' + editorTabs.map(tab =>
      '<button type="button" class="editor-tab' + (tab.key === activeTabKey ? " is-active" : "") +
      '" data-action="editor-switch-tab" data-section="' + escapeHtml(tab.section) + '" data-key="' + escapeHtml(tab.key) + '">' +
      escapeHtml(tab.label) + '</button>' +
      '<button type="button" class="editor-tab-close" data-action="editor-close-tab" data-key="' + escapeHtml(tab.key) +
      '" aria-label="Close ' + escapeHtml(tab.label) + '">×</button>').join("") + '</div>'
    : "";
  return '<div class="app-shell' + (guidedCompact ? ' guided-shell' : '') + (helpVisible ? ' help-visible' : '') + '">' +
    '<header class="topbar">' +
    '<div class="topbar-context"><span>' + (item && "sequence" in item ? "Dialogue" : item && "definition" in item ? "Quest" : item && "floors" in item ? "Mission" : item ? "Army" : "Start") + '</span>' +
    '<span class="save-indicator"><i></i><span id="save-status">All changes saved</span></span></div>' +
    toolbar +
    '</header>' +
    tabStrip +
    '<div class="app-layout">' +
    renderContextSidebar(workspace) +
    '<div class="stage-wrap">' + content +
    (item && (editorMode === "full" || guidedFinalStepActive) ? '<div class="editor-transfer-bar">' +
      (scratchMode ? actionButton("assign-to-set", "Assign to set", "button button-primary") : "") +
      actionButton("open-transfer", "Import / export JSON", "text-button transfer-button") + '</div>' : '') +
    '</div>' +
    '</div>' +
    '<div class="toast-region" id="toast-region" aria-live="polite"></div>' +
    '<dialog class="confirm-dialog transfer-dialog" id="transfer-dialog"><form method="dialog"><h2>Transfer content</h2>' +
    '<p class="section-note">Import or export this workspace as JSON or ZIP. Published sets are the normal way to move content between machines.</p>' +
    '<label class="field"><span class="field-label">Import JSON or ZIP</span><input id="transfer-file" type="file" accept=".json,.zip,application/json,application/zip"></label>' +
    '<div class="dialog-actions"><button value="cancel" class="button button-outline">Close</button>' +
    '<button type="button" class="button button-outline" data-action="export-active">Download JSON</button>' +
    '<button type="button" class="button button-primary" data-action="export-package">Export ZIP</button></div></form></dialog>' +
    renderContentPicker(workspace) +
    '<dialog class="confirm-dialog mission-event-dialog" id="mission-event-dialog"><form method="dialog"><h2>Mission event</h2><div id="mission-event-editor-host"></div><div class="dialog-actions"><button value="cancel" class="button button-outline">Close</button></div></form></dialog>' +
    '<dialog class="confirm-dialog" id="confirm-dialog"><form method="dialog"><h2>Remove this item?</h2><p>This only removes the local draft. Downloaded files are unchanged.</p><div class="dialog-actions"><button value="cancel" class="button button-outline">Keep it</button><button value="confirm" class="button button-danger" id="confirm-delete">Remove</button></div></form></dialog>' +
    (hasErrors ? '<div class="global-error-dot" title="Fix validation errors before treating this content as ready"></div>' : "") +
    '</div>';
}




