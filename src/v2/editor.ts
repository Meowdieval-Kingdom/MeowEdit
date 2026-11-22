import { canPublish, getBridgeFetch, getBridgeUserId } from "../bridge-context";
import { escapeHtml } from "../view";
import {
  createSetRequest, isDraftConflict, publishRequest, saveDraftRequest, type DraftConflictResponse
} from "./endpoints";
import { emptyContentSet, loadCapabilities, localized, namedRef } from "./factory";
import { packContentSet } from "./packer";
import { ACTIONS, CONDITIONS, TRIGGERS, findAction } from "./registries";
import type {
  CampaignDocument, CampaignEvent, ContentSetV2Document, GameCapabilities, NamedRef
} from "./types";
import { validateContentSet, type ValidationResult } from "./validation";

type SectionKind = "campaign" | "quest" | "army" | "dialogue";

interface EditorState {
  draft: ContentSetV2Document;
  capabilities: GameCapabilities;
  draftVersion: number;
  section: SectionKind;
  sectionIndex: number;
  floorIndex: number;
  eventIndex: number;
  status: string;
  validation: ValidationResult;
}

const STORAGE_PREFIX = "meowedit.v2.draft.";
const SECTIONS: SectionKind[] = ["campaign", "quest", "army", "dialogue"];

function storageKey(): string {
  return STORAGE_PREFIX + (getBridgeUserId() ?? "local");
}

function parsePath(path: string): string[] {
  return path.replace(/\[([^\]]+)\]/g, ".$1").split(".").filter(Boolean);
}

function setByPath(root: unknown, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cursor = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const key = /^\d+$/.test(part) ? Number(part) : part;
    if (cursor[key] === undefined) cursor[key] = /^\d+$/.test(part) ? [] : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts.at(-1)!;
  cursor[/^\d+$/.test(last) ? Number(last) : last] = value;
}

function options(values: readonly string[], selected: string): string {
  return values.map(value => '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + ">" + escapeHtml(value) + "</option>").join("");
}

function text(label: string, bind: string, value: unknown, type = "text"): string {
  return '<label>' + escapeHtml(label) + '<input type="' + type + '" data-v2-bind="' + bind + '" value="' + escapeHtml(String(value ?? "")) + '"></label>';
}

function select(label: string, bind: string, values: readonly string[], selected: string): string {
  return '<label>' + escapeHtml(label) + '<select data-v2-bind="' + bind + '">' + options(values, selected) + "</select></label>";
}

function ref(label: string, bind: string, value: NamedRef | undefined): string {
  return '<label>' + escapeHtml(label) + '<input data-v2-ref="' + bind + '" value="' + escapeHtml(value?.id ?? "") + '" placeholder="id"></label>';
}

function refList(label: string, bind: string, values: NamedRef[] | undefined): string {
  return '<label>' + escapeHtml(label) + '<input data-v2-list="' + bind + '" value="' + escapeHtml((values ?? []).map(item => item.id).join(", ")) + '" placeholder="ids, comma separated"></label>';
}

function button(action: string, label: string, dataset = ""): string {
  return '<button type="button" data-v2-action="' + action + '"' + dataset + ">" + escapeHtml(label) + "</button>";
}

function firstUnit(capabilities: GameCapabilities): NamedRef {
  return namedRef(capabilities.ids.units[0] ?? "unknown-unit");
}
function firstFaction(capabilities: GameCapabilities): NamedRef {
  return namedRef(capabilities.ids.factions[0] ?? "unknown-faction");
}

function newCampaign(id: string, name: string, capabilities: GameCapabilities): CampaignDocument {
  return {
    schemaVersion: 2, id, name: localized(name), description: localized(""),
    boardPreviewUnitId: firstUnit(capabilities), questIds: [],
    floors: [{
      id: "floor-1", number: 1, mode: capabilities.enums.floorMode[0], questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: [capabilities.enums.shopPoolKind[0]], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 }, nodes: [], routes: []
    }],
    events: [],
    settings: {
      startingLives: 3, startingSardines: 10, startingNodeCount: 12,
      playerFactionId: firstFaction(capabilities), factionSelectionEnabled: true, battleShopEnabled: true,
      shopPoolKinds: [capabilities.enums.shopPoolKind[0]], questNodeCountPerRandomFloor: 2,
      shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
      blessingsEnabled: true, restoreArmyAfterLoss: true
    }
  };
}

function emptyEvent(): CampaignEvent {
  const actionEntry = ACTIONS[0];
  return {
    id: "event-" + Math.random().toString(36).slice(2, 8),
    trigger: TRIGGERS[0], conditions: [],
    actions: [{ kind: actionEntry.kind, parameters: actionEntry.parameters.map(parameter => ({
      key: parameter.key,
      value: parameter.type === "int" ? 1 : parameter.type === "NamedRef[]" ? []
        : parameter.type === "enum" ? parameter.values?.[0] ?? "" : ""
    })) }],
    oneShot: "per-run"
  };
}

function autosave(state: EditorState): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state.draft));
  } catch {
    state.status = "Local autosave failed (storage is full).";
  }
}

function flash(container: HTMLElement, state: EditorState): void {
  const status = container.querySelector<HTMLElement>("[data-v2-status]");
  if (status) status.textContent = state.status;
}

function campaignEditor(state: EditorState): string {
  const index = state.sectionIndex;
  const draft = state.draft;
  const campaign = draft.campaigns[index];
  if (!campaign) return "<p>No campaign selected.</p>";
  const base = "campaigns[" + index + "]";
  const floor = campaign.floors[state.floorIndex];
  const floorBase = base + ".floors[" + state.floorIndex + "]";
  const event = campaign.events[state.eventIndex];
  const eventBase = base + ".events[" + state.eventIndex + "]";
  const capabilities = state.capabilities;

  const nodes = floor ? floor.nodes.map((node, nodeIndex) => {
    const nodeBase = floorBase + ".nodes[" + nodeIndex + "]";
    return '<div class="v2-card"><h5>' + escapeHtml(node.id) + "</h5>" +
      text("id", nodeBase + ".id", node.id) +
      select("kind", nodeBase + ".kind", capabilities.enums.nodeKind, node.kind) +
      text("label", nodeBase + ".label.default", node.label.default) +
      text("x", nodeBase + ".x", node.x, "number") + text("y", nodeBase + ".y", node.y, "number") +
      ref("armyId", nodeBase + ".armyId", node.armyId) +
      ref("questId", nodeBase + ".questId", node.questId) +
      ref("enemyFactionId", nodeBase + ".enemyFactionId", node.enemyFactionId) +
      select("rewardKind", nodeBase + ".rewardKind", capabilities.enums.rewardKind, node.rewardKind) +
      text("rewardAmount", nodeBase + ".rewardAmount", node.rewardAmount, "number") +
      "<h6>Shop offers</h6>" + node.shopOffers.map((offer, offerIndex) => '<div class="v2-row">' +
        select("kind", nodeBase + ".shopOffers[" + offerIndex + "].kind", capabilities.enums.shopOfferKind, offer.kind) +
        ref("contentId", nodeBase + ".shopOffers[" + offerIndex + "].contentId", offer.contentId) +
        text("price", nodeBase + ".shopOffers[" + offerIndex + "].price", offer.price, "number") +
        button("remove-offer", "Remove", ' data-node="' + nodeIndex + '" data-index="' + offerIndex + '"') + "</div>").join("") +
      button("add-offer", "+ Add offer", ' data-node="' + nodeIndex + '"') +
      button("remove-node", "Remove node", ' data-index="' + nodeIndex + '"') + "</div>";
  }).join("") : "";

  const routes = floor ? floor.routes.map((route, routeIndex) => {
    const routeBase = floorBase + ".routes[" + routeIndex + "]";
    return '<div class="v2-card">' + text("id", routeBase + ".id", route.id) +
      text("fromNodeId", routeBase + ".fromNodeId", route.fromNodeId) +
      text("toNodeId", routeBase + ".toNodeId", route.toNodeId) +
      '<label>oneWay<input type="checkbox" data-v2-bool="' + routeBase + '.oneWay"' + (route.oneWay ? " checked" : "") + "></label>" +
      button("remove-route", "Remove route", ' data-index="' + routeIndex + '"') + "</div>";
  }).join("") : "";

  const events = campaign.events.map((item, eventIndex) =>
    button("select-event", item.trigger, ' data-index="' + eventIndex + '"')
  ).join("");

  const conditions = event ? event.conditions.map((condition, conditionIndex) => {
    const conditionBase = eventBase + ".conditions[" + conditionIndex + "]";
    return '<div class="v2-row"><select data-v2-bind="' + conditionBase + '.key">' + options(CONDITIONS.map(entry => entry.kind), condition.key) + "</select>" +
      '<input data-v2-bind="' + conditionBase + '.value" value="' + escapeHtml(String(condition.value ?? "")) + '" placeholder="value">' +
      button("remove-condition", "Remove", ' data-index="' + conditionIndex + '"') + "</div>";
  }).join("") : "";

  const actions = event ? event.actions.map((action, actionIndex) => {
    const registry = findAction(action.kind);
    const parameters = (registry?.parameters ?? []).map(parameter => {
      const parameterPath = eventBase + ".actions[" + actionIndex + "].parameters[" + parameter.key + "].value";
      const current = action.parameters.find(item => item.key === parameter.key)?.value;
      let control: string;
      if (parameter.type === "enum")
        control = '<select data-v2-bind="' + parameterPath + '">' + options(parameter.values ?? [], String(current ?? "")) + "</select>";
      else if (parameter.type === "NamedRef[]")
        control = '<input data-v2-list="' + parameterPath + '" value="' + escapeHtml((Array.isArray(current) ? current : []).map(item => (item as NamedRef).id).join(", ")) + '">';
      else if (parameter.type === "NamedRef")
        control = '<input data-v2-ref="' + parameterPath + '" value="' + escapeHtml((current as NamedRef | undefined)?.id ?? "") + '">';
      else
        control = '<input data-v2-bind="' + parameterPath + '" type="' + (parameter.type === "int" ? "number" : "text") + '" value="' + escapeHtml(String(current ?? "")) + '">';
      return "<label>" + escapeHtml(parameter.key) + " <small>" + escapeHtml(parameter.type) + "</small>" + control + "</label>";
    }).join("");
    return '<div class="v2-card"><select data-v2-bind="' + eventBase + ".actions[" + actionIndex + '].kind">' + options(ACTIONS.map(entry => entry.kind), action.kind) + "</select>" +
      parameters + button("remove-action", "Remove action", ' data-index="' + actionIndex + '"') + "</div>";
  }).join("") : "";

  return "<section><h2>Campaign</h2>" +
    text("id", base + ".id", campaign.id) + text("name", base + ".name.default", campaign.name.default) +
    text("description", base + ".description.default", campaign.description.default) +
    ref("boardPreviewUnitId", base + ".boardPreviewUnitId", campaign.boardPreviewUnitId) +
    refList("questIds", base + ".questIds", campaign.questIds) +
    select("floorMode", floorBase + ".mode", capabilities.enums.floorMode, floor?.mode ?? capabilities.enums.floorMode[0]) +
    "</section><section><h2>Floors</h2>" +
    campaign.floors.map((item, floorIndex) => button("select-floor", "Floor " + item.number, ' data-index="' + floorIndex + '"')).join("") +
    button("add-floor", "+ Add floor") +
    (floor ? "<h3>Nodes</h3>" + nodes + button("add-node", "+ Add node") + "<h3>Routes</h3>" + routes + button("add-route", "+ Add route") : "") +
    "</section><section><h2>Events</h2>" + events + button("add-event", "+ Add event") +
    (event ? "<h3>Event</h3>" + text("id", eventBase + ".id", event.id) +
      select("trigger", eventBase + ".trigger", TRIGGERS, event.trigger) +
      select("oneShot", eventBase + ".oneShot", ["per-run", "per-node", "always"], event.oneShot) +
      "<h4>Conditions</h4>" + conditions + button("add-condition", "+ Add condition") +
      "<h4>Actions</h4>" + actions + button("add-action", "+ Add action") : "") +
    "</section>";
}

function questEditor(state: EditorState): string {
  const index = state.sectionIndex;
  const draft = state.draft;
  const quest = draft.quests[index];
  if (!quest) return "<p>No quest selected.</p>";
  const base = "quests[" + index + "]";
  const capabilities = state.capabilities;
  const extension = base + ".meowEdit";
  return "<section><h2>Quest</h2>" + text("id", base + ".id", quest.id) +
    text("title", base + ".title.default", quest.title.default) +
    text("description", base + ".description.default", quest.description.default) +
    select("objectiveKind", base + ".objectiveKind", capabilities.enums.objectiveKind, quest.objectiveKind ?? capabilities.enums.objectiveKind[0]) +
    select("rewardKind", base + ".rewardKind", capabilities.enums.rewardKind, quest.rewardKind ?? capabilities.enums.rewardKind[0]) +
    text("rewardAmount", base + ".rewardAmount", quest.rewardAmount ?? 0, "number") +
    ref("itemId", base + ".itemId", quest.itemId) + ref("speakerUnitId", base + ".speakerUnitId", quest.speakerUnitId) +
    text("speakerName", base + ".speakerName.default", quest.speakerName?.default ?? "") +
    "</section><section><h2>MeowEdit extension</h2>" +
    text("logicKind", extension + ".logicKind", quest.meowEdit.logicKind) +
    refList("offer dialogue", extension + ".dialogueLinks.offer", quest.meowEdit.dialogueLinks.offer) +
    refList("active dialogue", extension + ".dialogueLinks.active", quest.meowEdit.dialogueLinks.active) +
    refList("completion dialogue", extension + ".dialogueLinks.completion", quest.meowEdit.dialogueLinks.completion) +
    refList("failure dialogue", extension + ".dialogueLinks.failure", quest.meowEdit.dialogueLinks.failure) +
    "<h3>Timer</h3>" +
    ref("decisionId", extension + ".timer.decisionId", quest.meowEdit.timer.decisionId) +
    ref("payOutcomeId", extension + ".timer.payOutcomeId", quest.meowEdit.timer.payOutcomeId) +
    ref("waitOutcomeId", extension + ".timer.waitOutcomeId", quest.meowEdit.timer.waitOutcomeId) +
    ref("counterId", extension + ".timer.counterId", quest.meowEdit.timer.counterId) +
    text("counterTarget", extension + ".timer.counterTarget", quest.meowEdit.timer.counterTarget, "number") +
    text("countEvent", extension + ".timer.countEvent", quest.meowEdit.timer.countEvent) +
    text("paymentResource", extension + ".timer.paymentResource", quest.meowEdit.timer.paymentResource) +
    text("paymentAmount", extension + ".timer.paymentAmount", quest.meowEdit.timer.paymentAmount, "number") +
    "</section><section><h2>Fetch items</h2>" +
    quest.meowEdit.fetchItems.map((item, itemIndex) => '<div class="v2-card">' +
      text("id", extension + ".fetchItems[" + itemIndex + "].id", item.id) +
      text("displayName", extension + ".fetchItems[" + itemIndex + "].displayName.default", item.displayName.default) +
      text("count", extension + ".fetchItems[" + itemIndex + "].count", item.count, "number") +
      button("remove-fetch-item", "Remove", ' data-index="' + itemIndex + '"') + "</div>").join("") +
    button("add-fetch-item", "+ Add fetch item") + "</section><section><h2>Battle targets</h2>" +
    quest.meowEdit.battleTargets.map((target, targetIndex) => '<div class="v2-card">' +
      text("id", extension + ".battleTargets[" + targetIndex + "].id", target.id) +
      select("nodeKind", extension + ".battleTargets[" + targetIndex + "].nodeKind", capabilities.enums.nodeKind, target.nodeKind) +
      text("floorOffset", extension + ".battleTargets[" + targetIndex + "].floorOffset", target.floorOffset, "number") +
      ref("armyId", extension + ".battleTargets[" + targetIndex + "].armyId", target.armyId) +
      button("remove-battle-target", "Remove", ' data-index="' + targetIndex + '"') + "</div>").join("") +
    button("add-battle-target", "+ Add battle target") +
    "</section><section><h2>Completion effects</h2>" +
    quest.meowEdit.completionEffects.map((effect, effectIndex) => '<div class="v2-card">' +
      text("kind", extension + ".completionEffects[" + effectIndex + "].kind", effect.kind) +
      ref("targetId", extension + ".completionEffects[" + effectIndex + "].targetId", effect.targetId) +
      button("remove-effect", "Remove", ' data-index="' + effectIndex + '"') + "</div>").join("") +
    button("add-effect", "+ Add effect") + "</section><section><h2>Kill count</h2>" +
    text("targetKind", extension + ".killCount.targetKind", quest.meowEdit.killCount.targetKind) +
    ref("targetId", extension + ".killCount.targetId", quest.meowEdit.killCount.targetId) +
    text("count", extension + ".killCount.count", quest.meowEdit.killCount.count, "number") +
    "</section><section><h2>Minimum node distances</h2>" +
    quest.meowEdit.minimumNodeDistances.map((rule, ruleIndex) => '<div class="v2-card">' +
      text("id", extension + ".minimumNodeDistances[" + ruleIndex + "].id", rule.id) +
      select("fromNodeKind", extension + ".minimumNodeDistances[" + ruleIndex + "].fromNodeKind", capabilities.enums.nodeKind, rule.fromNodeKind) +
      select("toNodeKind", extension + ".minimumNodeDistances[" + ruleIndex + "].toNodeKind", capabilities.enums.nodeKind, rule.toNodeKind) +
      text("minimumHops", extension + ".minimumNodeDistances[" + ruleIndex + "].minimumHops", rule.minimumHops, "number") +
      button("remove-distance", "Remove", ' data-index="' + ruleIndex + '"') + "</div>").join("") +
    button("add-distance", "+ Add distance rule") + "</section>";
}

function armyEditor(state: EditorState): string {
  const index = state.sectionIndex;
  const army = state.draft.armies[index];
  if (!army) return "<p>No army selected.</p>";
  const base = "armies[" + index + "]";
  return "<section><h2>Army</h2>" + text("id", base + ".id", army.id) +
    text("name", base + ".name.default", army.name.default) +
    refList("spellIds", base + ".spellIds", army.spellIds) +
    refList("blessingIds", base + ".blessingIds", army.blessingIds) +
    "</section><section><h2>Units</h2>" +
    army.units.map((unit, unitIndex) => '<div class="v2-card">' +
      ref("unitId", base + ".units[" + unitIndex + "].unitId", unit.unitId) +
      text("x", base + ".units[" + unitIndex + "].x", unit.x, "number") +
      text("y", base + ".units[" + unitIndex + "].y", unit.y, "number") +
      refList("spellIds", base + ".units[" + unitIndex + "].spellIds", unit.spellIds) +
      button("remove-unit", "Remove", ' data-index="' + unitIndex + '"') + "</div>").join("") +
    button("add-unit", "+ Add unit") + "</section><section><h2>Cell blessing picks</h2>" +
    army.CellBlessingPicks.map((pick, pickIndex) => '<div class="v2-card">' +
      ref("RootId", base + ".CellBlessingPicks[" + pickIndex + "].RootId", pick.RootId) +
      text("Lane", base + ".CellBlessingPicks[" + pickIndex + "].Lane", pick.Lane) +
      '<label>Locked<input type="checkbox" data-v2-bool="' + base + ".CellBlessingPicks[" + pickIndex + '].Locked"' + (pick.Locked ? " checked" : "") + "></label>" +
      '<label>Cells (x,y; x,y)<input data-v2-cells="' + base + ".CellBlessingPicks[" + pickIndex + '].Cells" value="' +
      escapeHtml(pick.Cells.map(cell => String((cell as { x?: number }).x ?? 0) + "," + String((cell as { y?: number }).y ?? 0)).join("; ")) + '"></label>' +
      '<label>BaneCells (x,y; x,y)<input data-v2-bane-cells="' + base + ".CellBlessingPicks[" + pickIndex + '].BaneCells" value="' +
      escapeHtml(pick.BaneCells.map(cell => String((cell as { x?: number }).x ?? 0) + "," + String((cell as { y?: number }).y ?? 0)).join("; ")) + '"></label>' +
      button("remove-cell-pick", "Remove", ' data-index="' + pickIndex + '"') + "</div>").join("") +
    button("add-cell-pick", "+ Add cell blessing pick") + "</section>";
}

function dialogueEditor(state: EditorState): string {
  const index = state.sectionIndex;
  const dialogue = state.draft.dialogues[index];
  if (!dialogue) return "<p>No dialogue selected.</p>";
  const base = "dialogues[" + index + "]";
  const nodes = dialogue.nodes.map((node, nodeIndex) => {
    const nodeBase = base + ".nodes[" + nodeIndex + "]";
    return '<div class="v2-card"><h4>' + escapeHtml(node.id) + "</h4>" +
      text("id", nodeBase + ".id", node.id) + text("headline", nodeBase + ".headline.default", node.headline.default) +
      text("textSpeed", nodeBase + ".textSpeed", node.textSpeed, "number") +
      "<h5>Speakers</h5>" + node.speakers.map((speaker, speakerIndex) => '<div class="v2-row">' +
        text("id", nodeBase + ".speakers[" + speakerIndex + "].id", speaker.id) +
        ref("unitId", nodeBase + ".speakers[" + speakerIndex + "].unitId", speaker.unitId) +
        text("displayName", nodeBase + ".speakers[" + speakerIndex + "].displayName.default", speaker.displayName.default) +
        text("side", nodeBase + ".speakers[" + speakerIndex + "].side", speaker.side) +
        text("mood", nodeBase + ".speakers[" + speakerIndex + "].mood", speaker.mood) +
        button("remove-speaker", "Remove", ' data-node="' + nodeIndex + '" data-index="' + speakerIndex + '"') + "</div>").join("") +
      button("add-speaker", "+ Add speaker", ' data-node="' + nodeIndex + '"') +
      "<h5>Segments</h5>" + node.segments.map((segment, segmentIndex) => '<div class="v2-row">' +
        '<input data-v2-list="' + nodeBase + ".segments[" + segmentIndex + '].speakerIds" value="' + escapeHtml(segment.speakerIds.join(", ")) + '">' +
        text("text", nodeBase + ".segments[" + segmentIndex + "].text.default", segment.text.default) +
        button("remove-segment", "Remove", ' data-node="' + nodeIndex + '" data-index="' + segmentIndex + '"') + "</div>").join("") +
      button("add-segment", "+ Add segment", ' data-node="' + nodeIndex + '"') +
      "<h5>Actions</h5>" + node.actions.map((action, actionIndex) => '<div class="v2-row">' +
        text("label", nodeBase + ".actions[" + actionIndex + "].label.default", action.label.default) +
        text("targetNodeId", nodeBase + ".actions[" + actionIndex + "].targetNodeId", action.targetNodeId) +
        text("decisionId", nodeBase + ".actions[" + actionIndex + "].meowEdit.decision.id", action.meowEdit.decision.id) +
        text("outcomeId", nodeBase + ".actions[" + actionIndex + "].meowEdit.decision.outcomeId", action.meowEdit.decision.outcomeId) +
        '<label>defaultContinue<input type="checkbox" data-v2-bool="' + nodeBase + ".actions[" + actionIndex + '].meowEdit.defaultContinue"' +
        (action.meowEdit.defaultContinue ? " checked" : "") + "></label>" +
        button("remove-dialogue-action", "Remove", ' data-node="' + nodeIndex + '" data-index="' + actionIndex + '"') + "</div>").join("") +
      button("add-dialogue-action", "+ Add action", ' data-node="' + nodeIndex + '"') +
      button("remove-dialogue-node", "Remove node", ' data-index="' + nodeIndex + '"') + "</div>";
  }).join("");
  return "<section><h2>Dialogue</h2>" + text("sequenceId", base + ".sequenceId", dialogue.sequenceId) +
    text("startNodeId", base + ".startNodeId", dialogue.startNodeId) +
    text("pauseMode", base + ".pauseMode", dialogue.pauseMode) +
    text("defaultCharactersPerSecond", base + ".defaultCharactersPerSecond", dialogue.defaultCharactersPerSecond, "number") +
    "</section><section><h2>Nodes</h2>" + nodes + button("add-dialogue-node", "+ Add node") + "</section>";
}

function render(container: HTMLElement, state: EditorState): void {
  const draft = state.draft;
  const nav = SECTIONS.map(section => {
    const items = section === "campaign" ? draft.campaigns : section === "quest" ? draft.quests
      : section === "army" ? draft.armies : draft.dialogues;
    return "<h3>" + escapeHtml(section + "s") + "</h3>" + items.map((item, index) => {
      const label = "id" in item ? String(item.id) : "sequenceId" in item ? String(item.sequenceId) : String(index);
      return button("select-" + section, label, ' data-index="' + index + '"');
    }).join("") + button("add-" + section, "+ Add " + section);
  }).join("");
  const sectionHtml = state.section === "campaign" ? campaignEditor(state)
    : state.section === "quest" ? questEditor(state)
      : state.section === "army" ? armyEditor(state) : dialogueEditor(state);
  const canUpload = !!getBridgeFetch();
  const canDoPublish = canUpload && canPublish();
  const issues = state.validation.issues;

  container.innerHTML = '<div class="v2-editor"><header class="v2-header"><button type="button" data-v2-action="back">← Back to editor</button><h1>Content Set v2</h1><span data-v2-status>' + escapeHtml(state.status) + "</span></header>" +
    '<div class="v2-body"><aside class="v2-nav">' + text("setId", "set.setId", draft.set.setId) +
    text("Set name", "set.name.default", draft.set.name.default) + nav + "</aside><main class=\"v2-main\">" + sectionHtml +
    '<section class="v2-validation"><h2>Validation</h2>' + (issues.length
      ? "<ul>" + issues.map(issue => "<li>" + escapeHtml(issue.path + ": " + issue.message) + "</li>").join("") + "</ul>"
      : "<p>No contract issues.</p>") + "</section>" +
    '<footer class="v2-actions">' + button("save-local", "Autosave now") +
    '<button type="button" data-v2-action="save-upload"' + (canUpload ? "" : " disabled") + ">Save / Upload</button>" +
    '<button type="button" data-v2-action="publish"' + (canDoPublish && state.validation.valid ? "" : " disabled") + ">Publish</button>" +
    "</footer></main></div></div>";
}

function revalidate(container: HTMLElement, state: EditorState): void {
  state.validation = validateContentSet(state.draft, state.capabilities);
  render(container, state);
}

async function saveUpload(container: HTMLElement, state: EditorState): Promise<void> {
  const request = getBridgeFetch();
  if (!request) return;
  if (!state.validation.valid) {
    state.status = "Fix the contract issues before uploading.";
    flash(container, state);
    return;
  }
  try {
    const response = state.draftVersion === 0
      ? await request("/v1/editor/campaign-sets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createSetRequest(state.draft.set.setId, state.draft))
      })
      : await request("/v1/editor/campaign-sets/" + encodeURIComponent(state.draft.set.setId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveDraftRequest(state.draftVersion, state.draft))
      });
    const body = await response.json().catch(() => null) as { draftVersion?: number; currentVersion?: number; code?: string; error?: string } | null;
    if (isDraftConflict(body as DraftConflictResponse)) {
      state.status = "Draft conflict: server is at version " + (body as DraftConflictResponse).currentVersion + ".";
      flash(container, state);
      return;
    }
    if (!response.ok || typeof body?.draftVersion !== "number") {
      state.status = body?.error ?? "Upload failed.";
      flash(container, state);
      return;
    }
    state.draftVersion = body.draftVersion;
    state.status = "Draft saved as version " + state.draftVersion + ".";
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Upload failed.";
  }
  flash(container, state);
}

async function publish(container: HTMLElement, state: EditorState): Promise<void> {
  const request = getBridgeFetch();
  if (!request || !state.validation.valid) return;
  const confirmed = window.confirm(
    "Publishing makes this revision available to all players and resets tester progress. " +
    "Existing saves with a different content hash will be deleted at the Adventure gate. Continue?"
  );
  if (!confirmed) {
    state.status = "Publish cancelled.";
    flash(container, state);
    return;
  }
  try {
    const response = await request("/v1/editor/campaign-sets/" + encodeURIComponent(state.draft.set.setId) + "/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(publishRequest(state.draftVersion))
    });
    const body = await response.json().catch(() => null) as { packageId?: string; contentHash?: string; error?: string } | null;
    if (!response.ok || !body?.packageId) {
      state.status = body?.error ?? "Publish failed.";
      flash(container, state);
      return;
    }
    const packed = await packContentSet(state.draft, state.capabilities);
    state.status = "Published " + body.packageId + (body.contentHash === packed.contentHash ? " (hash verified)" : " (HASH MISMATCH)") + ".";
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Publish failed.";
  }
  flash(container, state);
}

/** Mounts the structured v2 editor into `container`. */
export async function mountV2Editor(container: HTMLElement, onBack: () => void): Promise<void> {
  const capabilities = await loadCapabilities();
  let draft: ContentSetV2Document;
  try {
    draft = JSON.parse(localStorage.getItem(storageKey()) ?? "") as ContentSetV2Document;
  } catch {
    draft = emptyContentSet("character-missions", "Character Missions");
    draft.campaigns.push(newCampaign("character-missions", "Character Missions", capabilities));
    draft.set.campaignOrder = [draft.campaigns[0].id];
  }
  const state: EditorState = {
    draft, capabilities, draftVersion: 0, section: "campaign", sectionIndex: 0,
    floorIndex: 0, eventIndex: 0, status: "Local draft autosaved in this browser.",
    validation: validateContentSet(draft, capabilities)
  };

  const handleClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-v2-action]");
    if (!button) return;
    const action = button.dataset.v2Action ?? "";
    const index = Number(button.dataset.index ?? 0);
    const nodeIndex = Number(button.dataset.node ?? 0);
    const campaign = state.section === "campaign" ? state.draft.campaigns[state.sectionIndex] : undefined;
    const floor = campaign?.floors[state.floorIndex];
    const node = floor?.nodes[nodeIndex];
    const eventEntry = campaign?.events[state.eventIndex];
    const dialogue = state.section === "dialogue" ? state.draft.dialogues[state.sectionIndex] : undefined;
    const dialogueNode = dialogue?.nodes[nodeIndex];
    const quest = state.section === "quest" ? state.draft.quests[state.sectionIndex] : undefined;
    const army = state.section === "army" ? state.draft.armies[state.sectionIndex] : undefined;

    if (action === "back") { onBack(); return; }
    if (action === "save-local") { autosave(state); state.status = "Saved locally."; flash(container, state); return; }
    if (action === "save-upload") { void saveUpload(container, state); return; }
    if (action === "publish") { void publish(container, state); return; }

    for (const section of SECTIONS) {
      if (action === "select-" + section) { state.section = section; state.sectionIndex = index; state.floorIndex = 0; state.eventIndex = 0; }
      if (action === "add-" + section) {
        state.section = section;
        if (section === "campaign") {
          const id = "campaign-" + (state.draft.campaigns.length + 1);
          state.draft.campaigns.push(newCampaign(id, id, capabilities));
          state.draft.set.campaignOrder.push(id);
        } else if (section === "quest") {
          const id = "quest-" + (state.draft.quests.length + 1);
          state.draft.quests.push({
            schemaVersion: 2, id, title: localized(id), description: localized(""),
            objectiveKind: capabilities.enums.objectiveKind[0], rewardKind: capabilities.enums.rewardKind[0], rewardAmount: 0,
            meowEdit: {
              schemaVersion: 2,
              dialogueLinks: { offer: [], active: [], completion: [], failure: [] }, logicKind: "none",
              timer: {
                decisionId: namedRef("decision-" + id), payOutcomeId: namedRef("outcome-" + id),
                waitOutcomeId: namedRef("outcome-" + id), counterId: namedRef("counter-" + id),
                counterTarget: 1, counterLabel: localized("Battles"), countEvent: "battle-won",
                paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: []
              },
              completionEffects: [], fetchItems: [], battleTargets: [],
              killCount: { targetKind: "unit", targetId: firstUnit(capabilities), count: 1 }, minimumNodeDistances: []
            }
          });
        } else if (section === "army") {
          const id = "army-" + (state.draft.armies.length + 1);
          state.draft.armies.push({ schemaVersion: 2, id, name: localized(id), units: [], spellIds: [], blessingIds: [], CellBlessingPicks: [] });
        } else {
          const id = "dialogue-" + (state.draft.dialogues.length + 1);
          state.draft.dialogues.push({
            schemaVersion: 2, sequenceId: id, startNodeId: "opening", pauseMode: "none", defaultCharactersPerSecond: 30,
            nodes: [{ id: "opening", headline: localized("Opening"), textSpeed: 30, speakers: [], segments: [], actions: [] }]
          });
        }
        state.sectionIndex = section === "campaign" ? state.draft.campaigns.length - 1
          : section === "quest" ? state.draft.quests.length - 1
            : section === "army" ? state.draft.armies.length - 1
              : state.draft.dialogues.length - 1;
        state.floorIndex = 0;
        state.eventIndex = 0;
      }
    }

    if (action === "add-floor" && campaign) campaign.floors.push({
      id: "floor-" + (campaign.floors.length + 1), number: campaign.floors.length + 1,
      mode: capabilities.enums.floorMode[0], questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: [capabilities.enums.shopPoolKind[0]], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 }, nodes: [], routes: []
    });
    if (action === "select-floor") state.floorIndex = index;
    if (action === "add-node" && floor) floor.nodes.push({
      id: "node-" + (floor.nodes.length + 1), label: localized("Node"), kind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0],
      x: 0, y: 0, armyId: namedRef("army"), questId: namedRef("quest"), enemyFactionId: firstFaction(capabilities),
      rewardKind: capabilities.enums.rewardKind[0], rewardAmount: 0,
      rewardContentId: namedRef("reward"), shopOfferMode: "generated", shopOffers: []
    });
    if (action === "remove-node" && floor) floor.nodes.splice(index, 1);
    if (action === "add-offer" && node) node.shopOffers.push({
      kind: capabilities.enums.shopOfferKind[0], contentId: firstUnit(capabilities), price: 0
    });
    if (action === "remove-offer" && node) node.shopOffers.splice(index, 1);
    if (action === "add-route" && floor) floor.routes.push({
      id: "route-" + (floor.routes.length + 1),
      fromNodeId: floor.nodes[0]?.id ?? "", toNodeId: floor.nodes.at(-1)?.id ?? "", oneWay: false
    });
    if (action === "remove-route" && floor) floor.routes.splice(index, 1);
    if (action === "add-event" && campaign) { campaign.events.push(emptyEvent()); state.eventIndex = campaign.events.length - 1; }
    if (action === "add-condition" && eventEntry) eventEntry.conditions.push({ key: CONDITIONS[0].kind, value: null });
    if (action === "remove-condition" && eventEntry) eventEntry.conditions.splice(index, 1);
    if (action === "add-action" && eventEntry) {
      const actionEntry = ACTIONS[0];
      eventEntry.actions.push({ kind: actionEntry.kind, parameters: actionEntry.parameters.map(parameter => ({
        key: parameter.key, value: parameter.type === "int" ? 1 : parameter.type === "NamedRef[]" ? []
          : parameter.type === "enum" ? parameter.values?.[0] ?? "" : ""
      })) });
    }
    if (action === "remove-action" && eventEntry) eventEntry.actions.splice(index, 1);
    if (action === "add-unit" && army) army.units.push({ unitId: firstUnit(capabilities), x: 0, y: 0, spellIds: [] });
    if (action === "remove-unit" && army) army.units.splice(index, 1);
    if (action === "add-cell-pick" && army) army.CellBlessingPicks.push({
      RootId: namedRef(capabilities.ids.blessings[0] ?? "blessing"), Lane: "FrontRow",
      Cells: [], Locked: false, BaneCells: []
    });
    if (action === "remove-cell-pick" && army) army.CellBlessingPicks.splice(index, 1);
    if (action === "add-fetch-item" && quest) quest.meowEdit.fetchItems.push({ id: "item", displayName: localized("Item"), count: 1 });
    if (action === "remove-fetch-item" && quest) quest.meowEdit.fetchItems.splice(index, 1);
    if (action === "add-battle-target" && quest) quest.meowEdit.battleTargets.push({
      id: "target", label: localized("Target"), nodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0],
      floorOffset: 0, armyId: namedRef("army")
    });
    if (action === "remove-battle-target" && quest) quest.meowEdit.battleTargets.splice(index, 1);
    if (action === "add-effect" && quest) quest.meowEdit.completionEffects.push({
      kind: "unlock", targetId: namedRef("target"), label: localized("Effect")
    });
    if (action === "remove-effect" && quest) quest.meowEdit.completionEffects.splice(index, 1);
    if (action === "add-distance" && quest) quest.meowEdit.minimumNodeDistances.push({
      id: "distance-" + (quest.meowEdit.minimumNodeDistances.length + 1),
      fromNodeKind: capabilities.enums.nodeKind[0],
      toNodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0],
      minimumHops: 1
    });
    if (action === "remove-distance" && quest) quest.meowEdit.minimumNodeDistances.splice(index, 1);
    if (action === "add-dialogue-node" && dialogue) dialogue.nodes.push({
      id: "node-" + (dialogue.nodes.length + 1), headline: localized("Node"), textSpeed: 30, speakers: [], segments: [], actions: []
    });
    if (action === "remove-dialogue-node" && dialogue) dialogue.nodes.splice(index, 1);
    if (action === "add-speaker" && dialogueNode) dialogueNode.speakers.push({
      id: "speaker-" + (dialogueNode.speakers.length + 1), unitId: firstUnit(capabilities),
      displayName: localized("Speaker"), side: "right", mood: "Normal"
    });
    if (action === "remove-speaker" && dialogueNode) dialogueNode.speakers.splice(index, 1);
    if (action === "add-segment" && dialogueNode) dialogueNode.segments.push({
      speakerIds: dialogueNode.speakers.map(speaker => speaker.id), text: localized("Text")
    });
    if (action === "remove-segment" && dialogueNode) dialogueNode.segments.splice(index, 1);
    if (action === "add-dialogue-action" && dialogueNode) dialogueNode.actions.push({
      label: localized("Continue"), targetNodeId: dialogueNode.id,
      meowEdit: { decision: { id: "decision", label: localized("Decision"), outcomeId: "outcome", outcomeLabel: localized("Outcome") }, defaultContinue: true }
    });
    if (action === "remove-dialogue-action" && dialogueNode) dialogueNode.actions.splice(index, 1);

    autosave(state);
    revalidate(container, state);
  };

  const handleChange = (event: Event) => {
    const element = event.target as HTMLInputElement | HTMLSelectElement;
    const bind = element.dataset.v2Bind;
    const list = element.dataset.v2List;
    const refValue = element.dataset.v2Ref;
    const bool = element.dataset.v2Bool;
    const cells = element.dataset.v2Cells;
    const baneCells = element.dataset.v2BaneCells;
    const path = bind ?? list ?? refValue ?? bool ?? cells ?? baneCells;
    if (!path) return;
    let value: unknown = element.value;
    if (element instanceof HTMLInputElement && element.type === "number") value = Number(element.value);
    if (list) value = element.value.split(",").map(item => item.trim()).filter(Boolean).map(id => namedRef(id));
    if (refValue) value = namedRef(element.value);
    if (bool && element instanceof HTMLInputElement) value = element.checked;
    if (cells || baneCells) {
      value = element.value.split(";").map(item => item.trim()).filter(Boolean).map(item => {
        const [x, y] = item.split(",").map(Number);
        return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
      });
    }
    setByPath(state.draft, path, value);
    autosave(state);
    revalidate(container, state);
  };

  container.addEventListener("click", handleClick);
  container.addEventListener("change", handleChange);
  container.addEventListener("input", event => {
    const element = event.target as HTMLInputElement;
    if (element.dataset.v2Bind) autosave(state);
  });
  render(container, state);
}
