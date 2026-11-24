import {
  findAction, findCondition, isKnownTrigger, parameterErrors
} from "./registries";
import type { ContentSetDocument, GameCapabilities, NamedRef } from "./types";
import { contentSetSchema } from "./zod";

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
  severity?: "error" | "warning";
  hint?: string;
  suggestions?: string[];
  section?: string;
  entryIndex?: number;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const FIELD_LABELS: Record<string, string> = {
  itemId: "Item", speakerUnitId: "Speaker unit", escortUnitId: "Escort unit",
  rewardContentId: "Reward", boardPreviewUnitId: "Board character",
  playerFactionId: "Player faction", armyId: "Army", questId: "Quest",
  enemyFactionId: "Enemy faction", targetId: "Target", contentId: "Content",
  unitId: "Unit", decisionId: "Decision", payOutcomeId: "Pay outcome",
  waitOutcomeId: "Wait outcome", counterId: "Counter", RootId: "Blessing",
  outcomeId: "Choice outcome", fromNodeId: "Route from", toNodeId: "Route to",
  trigger: "Trigger", oneShot: "Repeat mode", kind: "Kind", mode: "Floor mode",
  objectiveKind: "Objective", rewardKind: "Reward kind", shopPoolKinds: "Shop pools",
  shopOffers: "Shop offers", startNodeId: "Start node", sequenceId: "Sequence ID"
};

function humanize(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase());
}

function entryName(set: ContentSetDocument, section: string, index: number): string {
  if (section === "quests") return set.quests[index]?.title.default || set.quests[index]?.id || String(index);
  if (section === "armies") return set.armies[index]?.name.default || set.armies[index]?.id || String(index);
  if (section === "campaigns") return set.campaigns[index]?.name.default || set.campaigns[index]?.id || String(index);
  if (section === "dialogues") return set.dialogues[index]?.sequenceId || String(index);
  return String(index);
}

function describePath(set: ContentSetDocument, path: string): { label: string; section?: string; entryIndex?: number; field?: string } {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  const section = ["campaigns", "quests", "armies", "dialogues"].includes(segments[0]) ? segments[0] : undefined;
  const entryIndex = section && /^\d+$/.test(segments[1] ?? "") ? Number(segments[1]) : undefined;
  const rest = segments.slice(entryIndex === undefined ? 1 : 2).filter(part => !/^\d+$/.test(part));
  const field = humanize(rest.at(-1) === "id" ? rest.at(-2) ?? "id" : rest.at(-1) ?? segments.at(-1) ?? "value");
  if (section && entryIndex !== undefined) return { label: humanize(section.slice(0, -1)) + ' "' + entryName(set, section, entryIndex) + '" → ' + field, section, entryIndex, field };
  return { label: field, section, field };
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3);
}

function similarIds(id: string, candidates: Set<string>): string[] {
  const parts = tokens(id);
  if (!parts.length) return [];
  return [...candidates]
    .map(candidate => {
      const candidateTokens = tokens(candidate);
      const score = parts.filter(part => candidateTokens.includes(part)).length;
      return { candidate, score };
    })
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.length - right.candidate.length)
    .slice(0, 3)
    .map(entry => entry.candidate);
}

function referenceIssue(
  set: ContentSetDocument, allowed: Set<string>,
  path: string, id: string
): ValidationIssue {
  const label = id || "(empty)";
  const suggestions = similarIds(id, allowed);
  const description = describePath(set, path);
  const suggestionText = suggestions.length
    ? " Possible matches: " + suggestions.join(", ") + "."
    : " Pick an ID from this set or from the game catalog.";
  return {
    path,
    code: "unresolved-reference",
    severity: "error",
    message: description.label + ': "' + label + '" is an unresolved reference.',
    hint: "This points to an item that does not exist in the set or the game catalog." + suggestionText,
    suggestions,
    section: description.section,
    entryIndex: description.entryIndex,
    field: description.field
  };
}

function isNamedRef(value: unknown): value is NamedRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.label || typeof candidate.label !== "object") return false;
  const label = candidate.label as Record<string, unknown>;
  return typeof label.default === "string" && !!label.locales && typeof label.locales === "object";
}

function walk(value: unknown, path: string, visit: (node: unknown, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, path + "[" + index + "]", visit));
    return;
  }
  if (value && typeof value === "object") {
    visit(value, path);
    for (const [key, item] of Object.entries(value)) walk(item, path ? path + "." + key : key, visit);
  }
}

function localIds(set: ContentSetDocument): Set<string> {
  const ids = new Set<string>();
  set.quests.forEach(quest => {
    ids.add(quest.id);
    const timer = quest.meowEdit.timer;
    [timer.decisionId, timer.payOutcomeId, timer.waitOutcomeId, timer.counterId]
      .forEach(ref => ids.add(ref.id));
  });
  set.armies.forEach(army => ids.add(army.id));
  set.campaigns.forEach(campaign => ids.add(campaign.id));
  set.dialogues.forEach(dialogue => {
    ids.add(dialogue.sequenceId);
    dialogue.nodes.forEach(node => {
      ids.add(node.id);
      node.speakers.forEach(speaker => ids.add(speaker.id));
      node.actions.forEach(action => {
        ids.add(action.meowEdit.decision.id);
        ids.add(action.meowEdit.decision.outcomeId);
      });
    });
  });
  set.campaigns.forEach(campaign => campaign.floors.forEach(floor => {
    floor.nodes.forEach(node => ids.add(node.id));
    floor.routes.forEach(route => ids.add(route.id));
  }));
  return ids;
}

function capabilityIds(capabilities: GameCapabilities): Set<string> {
  return new Set([
    ...capabilities.ids.units,
    ...capabilities.ids.blessings,
    ...capabilities.ids.curses,
    ...capabilities.ids.spells,
    ...capabilities.ids.factions
  ]);
}

function enumIssue(value: unknown, allowed: readonly string[], path: string, label: string): ValidationIssue | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !allowed.includes(value))
    return {
      path, code: "unknown-enum", message: label + ' "' + String(value ?? "") + '" is not a supported value.',
      hint: "Choose one of: " + allowed.join(", ") + ".", suggestions: [...allowed]
    };
  return null;
}

function pushEnum(issues: ValidationIssue[], value: unknown, allowed: readonly string[], path: string, label: string): void {
  const issue = enumIssue(value, allowed, path, label);
  if (issue) issues.push(issue);
}

function pushEnumList(issues: ValidationIssue[], values: readonly string[], allowed: readonly string[], path: string, label: string): void {
  values.forEach((value, index) => pushEnum(issues, value, allowed, path + "[" + index + "]", label));
}

/** Strict validation with friendly, actionable messages. */
export function validateContentSet(value: unknown, capabilities: GameCapabilities): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = contentSetSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const description = describePath({ ...(value as ContentSetDocument), quests: [], armies: [], campaigns: [], dialogues: [] }, issue.path.join("."));
      issues.push({
        path: issue.path.join("."),
        code: "schema",
        message: description.label + ": " + issue.message,
        hint: "This field has the wrong shape or type. Check the value shown in the editor.",
        section: description.section
      });
    }
    return { valid: false, issues };
  }
  const set = parsed.data as ContentSetDocument;

  set.quests.forEach((quest, questIndex) => {
    pushEnum(issues, quest.objectiveKind, capabilities.enums.objectiveKind, "quests[" + questIndex + "].objectiveKind", "Objective");
    pushEnum(issues, quest.rewardKind, capabilities.enums.rewardKind, "quests[" + questIndex + "].rewardKind", "Reward kind");
  });

  // Dialogue-only sets are valid (tutorial dialogue collections do not need a campaign).
  if (set.campaigns.length === 0 && set.dialogues.length === 0
    && set.quests.length === 0 && set.armies.length === 0)
    issues.push({
      path: "campaigns", code: "empty-set", severity: "warning",
      message: "This set is empty.",
      hint: "Add a campaign, quest, army or dialogue to this set."
    });

  const local = localIds(set);
  const allowed = new Set([...local, ...capabilityIds(capabilities)]);

  const seenIds = new Map<string, string>();
  for (const [kind, id, path] of [
    ...set.quests.map(quest => ["quest", quest.id, "quests"] as const),
    ...set.armies.map(army => ["army", army.id, "armies"] as const),
    ...set.campaigns.map(campaign => ["campaign", campaign.id, "campaigns"] as const),
    ...set.dialogues.map(dialogue => ["dialogue", dialogue.sequenceId, "dialogues"] as const)
  ]) {
    if (seenIds.has(id)) issues.push({
      path, code: "duplicate-id", message: 'Duplicate ' + kind + ' ID "' + id + '".',
      hint: "Every item needs its own ID. Rename one of them."
    });
    seenIds.set(id, kind);
  }

  walk(set, "", (node, path) => {
    if (!isNamedRef(node) || allowed.has(node.id)) return;
    // Fetch item IDs are authored free-form labels; the game never resolves them against a catalog.
    if (path.endsWith(".itemId")) return;
    // Runtime sentinels are mapped to empties/choices by AdventureContentRuntimeAdapter; they are not references.
    if (node.id === "none" || (path.endsWith(".rewardContentId") && node.id.toLowerCase() === "choice")) return;
    issues.push(referenceIssue(set, allowed, path + ".id", node.id));
  });

  for (const campaignId of set.set.campaignOrder)
    if (!set.campaigns.some(campaign => campaign.id === campaignId))
      issues.push(referenceIssue(set, allowed, "set.campaignOrder", campaignId));

  set.campaigns.forEach((campaign, campaignIndex) => {
    const campaignPath = "campaigns[" + campaignIndex + "]";
    pushEnumList(issues, campaign.settings.shopPoolKinds, capabilities.enums.shopPoolKind, campaignPath + ".settings.shopPoolKinds", "Shop pool");
    campaign.floors.forEach((floor, floorIndex) => {
      const floorPath = campaignPath + ".floors[" + floorIndex + "]";
      pushEnum(issues, floor.mode, capabilities.enums.floorMode, floorPath + ".mode", "Floor mode");
      pushEnumList(issues, floor.shopPoolKinds, capabilities.enums.shopPoolKind, floorPath + ".shopPoolKinds", "Shop pool");
      floor.nodes.forEach((node, nodeIndex) => {
        pushEnum(issues, node.kind, capabilities.enums.nodeKind, floorPath + ".nodes[" + nodeIndex + "].kind", "Node kind");
        pushEnum(issues, node.rewardKind, capabilities.enums.rewardKind, floorPath + ".nodes[" + nodeIndex + "].rewardKind", "Reward kind");
        node.shopOffers.forEach((offer, offerIndex) => pushEnum(issues, offer.kind,
          capabilities.enums.shopOfferKind, floorPath + ".nodes[" + nodeIndex + "].shopOffers[" + offerIndex + "].kind", "Offer kind"));
      });
      if (floor.nodes.length > capabilities.limits.maxAuthoredNodesPerFloor)
        issues.push({
          path: floorPath + ".nodes", code: "node-limit",
          message: 'Campaign "' + campaign.name.default + '" floor ' + floor.number + ' has ' + floor.nodes.length +
            ' nodes, but the game supports ' + capabilities.limits.maxAuthoredNodesPerFloor + '.',
          hint: "Remove nodes from this floor or move some to another floor.",
          section: "campaigns", entryIndex: campaignIndex
        });
      for (const questRef of floor.questPoolIds)
        if (!set.quests.some(quest => quest.id === questRef.id))
          issues.push(referenceIssue(set, allowed, floorPath + ".questPoolIds", questRef.id));
      const nodeIds = new Set(floor.nodes.map(node => node.id));
      const coordinates = new Map<string, string>();
      for (const node of floor.nodes) {
        const key = node.x + "," + node.y;
        if (coordinates.has(key))
          issues.push({
            path: floorPath + ".nodes", code: "duplicate-coordinate",
            message: 'Campaign "' + campaign.name.default + '" floor ' + floor.number + ' has two nodes at (' + key + ').',
            hint: "Move one of them to another map cell.",
            section: "campaigns", entryIndex: campaignIndex
          });
        coordinates.set(key, node.id);
      }
      const starts = floor.nodes.filter(node => node.kind === "Start");
      const bosses = floor.nodes.filter(node => node.kind === "Boss");
      if (starts.length !== 1)
        issues.push({
          path: floorPath + ".nodes", code: "start-count",
          message: 'Campaign "' + campaign.name.default + '" floor ' + floor.number + ' has ' + starts.length + ' Start nodes.',
          hint: "Every authored floor needs exactly one Start node.",
          section: "campaigns", entryIndex: campaignIndex
        });
      else if ((starts[0].x !== 0 || starts[0].y !== 0))
        issues.push({
          path: floorPath + ".nodes", code: "start-position",
          message: 'Start node on floor ' + floor.number + ' must be at (0,0).',
          hint: "Move the Start node to the board origin.",
          section: "campaigns", entryIndex: campaignIndex
        });
      if (bosses.length > 1)
        issues.push({
          path: floorPath + ".nodes", code: "boss-count",
          message: 'Floor ' + floor.number + ' has ' + bosses.length + ' Boss nodes.',
          hint: "A floor supports at most one Boss node.",
          section: "campaigns", entryIndex: campaignIndex
        });
      const routeKeys = new Set<string>();
      for (const route of floor.routes) {
        const key = [route.fromNodeId, route.toNodeId].sort().join("|");
        if (routeKeys.has(key))
          issues.push({
            path: floorPath + ".routes", code: "duplicate-route",
            message: 'Floor ' + floor.number + ' repeats a route between the same two nodes.',
            hint: "Remove one of the duplicate connections.", section: "campaigns", entryIndex: campaignIndex
          });
        routeKeys.add(key);
      }
      if (bosses.length && !floor.nodes.some(node => node.kind === "Battle"))
        issues.push({
          path: floorPath + ".nodes", code: "boss-without-battle",
          message: 'Floor ' + floor.number + ' has a Boss but no Battle node.',
          hint: "Add a Battle before the Boss so the encounter has a warm-up fight.",
          section: "campaigns", entryIndex: campaignIndex
        });
      for (const route of floor.routes) {
        const from = floor.nodes.find(node => node.id === route.fromNodeId);
        const to = floor.nodes.find(node => node.id === route.toNodeId);
        if (from && to && (Math.abs(from.x - to.x) > 1 || Math.abs(from.y - to.y) > 1 || (from.x === to.x && from.y === to.y)))
          issues.push({
            path: floorPath + ".routes", code: "route-not-adjacent",
            message: 'Route "' + route.id + '" connects distant nodes on floor ' + floor.number + '.',
            hint: "Routes may only connect neighboring cells; diagonals are allowed.",
            section: "campaigns", entryIndex: campaignIndex
          });
      }
      if (starts.length === 1 && floor.nodes.length > 1) {
        const reached = new Set<string>([starts[0].id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const route of floor.routes) {
            if (reached.has(route.fromNodeId) && !reached.has(route.toNodeId)) {
              reached.add(route.toNodeId);
              changed = true;
            }
            if (!route.oneWay && reached.has(route.toNodeId) && !reached.has(route.fromNodeId)) {
              reached.add(route.fromNodeId);
              changed = true;
            }
          }
        }
        const unreachable = floor.nodes.filter(node => !reached.has(node.id));
        if (unreachable.length)
          issues.push({
            path: floorPath + ".routes", code: "unreachable-nodes",
            message: floor.nodes.length - unreachable.length + " of " + floor.nodes.length + " nodes on floor " + floor.number + " are reachable from Start.",
            hint: "Connect these nodes with routes: " + unreachable.map(node => node.label.default || node.id).join(", ") + ".",
            section: "campaigns", entryIndex: campaignIndex
          });
      }
      for (const node of floor.nodes) {
        if (node.shopOfferMode === "exact" && node.shopOffers.length !== 3)
          issues.push({
            path: floorPath + ".nodes", code: "exact-shop-offers",
            message: 'Shop node "' + node.label.default + '" expects exactly three offers but has ' + node.shopOffers.length + '.',
            hint: "Adventure shops show three items. Add or remove offers until there are three.",
            section: "campaigns", entryIndex: campaignIndex
          });
      }
      const randomSettings = floor.randomSettings;
      if (randomSettings.nodeCount % 2 !== 0 || randomSettings.nodeCount < 12 || randomSettings.nodeCount > 30)
        issues.push({
          path: floorPath + ".randomSettings.nodeCount", code: "random-node-count",
          message: "Floor " + floor.number + " uses " + randomSettings.nodeCount + " random nodes.",
          hint: "Use an even number between 12 and 30.",
          section: "campaigns", entryIndex: campaignIndex
        });
      for (const route of floor.routes) {
        if (!nodeIds.has(route.fromNodeId))
          issues.push({
            path: floorPath + ".routes", code: "broken-route",
            message: 'Route "' + route.id + '" starts at "' + route.fromNodeId + '", which is not a node on floor ' + floor.number + '.',
            hint: "Choose an existing node on this floor as the route start.",
            section: "campaigns", entryIndex: campaignIndex
          });
        if (!nodeIds.has(route.toNodeId))
          issues.push({
            path: floorPath + ".routes", code: "broken-route",
            message: 'Route "' + route.id + '" ends at "' + route.toNodeId + '", which is not a node on floor ' + floor.number + '.',
            hint: "Choose an existing node on this floor as the route target.",
            section: "campaigns", entryIndex: campaignIndex
          });
      }
    });
    campaign.events.forEach((event, eventIndex) => {
      const eventPath = campaignPath + ".events[" + eventIndex + "]";
      if (!isKnownTrigger(event.trigger))
        issues.push({
          path: eventPath + ".trigger", code: "unknown-trigger",
          message: 'Event "' + event.id + '" uses trigger "' + event.trigger + '", which is not supported.',
          hint: "Choose a trigger from the list in the advanced view.",
          section: "campaigns", entryIndex: campaignIndex
        });
      for (const condition of event.conditions) {
        const entry = findCondition(condition.key);
        if (!entry) {
          issues.push({
            path: eventPath + ".conditions", code: "unknown-condition",
            message: 'Event "' + event.id + '" uses unknown condition "' + condition.key + '".',
            hint: "Choose a condition from the list in the advanced view.",
            section: "campaigns", entryIndex: campaignIndex
          });
          continue;
        }
        if (entry.parameters.length === 0) {
          if (condition.value !== null)
            issues.push({
              path: eventPath + ".conditions", code: "condition-value",
              message: 'Condition "' + condition.key + '" takes no value.',
              hint: "Set its value to null in the advanced view.",
              section: "campaigns", entryIndex: campaignIndex
            });
          continue;
        }
        const descriptor = entry.parameters[0];
        const conditionValue = condition.value;
        for (const error of parameterErrors(entry, [{ key: descriptor.key, value: conditionValue }], capabilities.enums))
          issues.push({
            path: eventPath + ".conditions", code: "condition-parameter",
            message: 'Condition "' + condition.key + '": ' + error + '.',
            hint: "Check the condition value in the advanced view.",
            section: "campaigns", entryIndex: campaignIndex
          });
        if (descriptor.refKind === "blessing" && isNamedRef(conditionValue)
            && !capabilities.ids.blessings.includes(conditionValue.id))
          issues.push(referenceIssue(set, allowed, eventPath + ".conditions", conditionValue.id));
        if (descriptor.refKind === "quest" && isNamedRef(conditionValue)
            && !set.quests.some(quest => quest.id === conditionValue.id))
          issues.push(referenceIssue(set, allowed, eventPath + ".conditions", conditionValue.id));
        if (condition.key === "choice-outcome" && typeof condition.value === "string"
            && !local.has(condition.value))
          issues.push(referenceIssue(set, allowed, eventPath + ".conditions", condition.value));
      }
      for (const action of event.actions) {
        const entry = findAction(action.kind);
        if (!entry) {
          issues.push({
            path: eventPath + ".actions", code: "unknown-action",
            message: 'Event "' + event.id + '" uses unknown action "' + action.kind + '".',
            hint: "Choose an action from the list in the advanced view.",
            section: "campaigns", entryIndex: campaignIndex
          });
          continue;
        }
        for (const error of parameterErrors(entry, action.parameters, capabilities.enums))
          issues.push({
            path: eventPath + ".actions", code: "action-parameter",
            message: 'Action "' + action.kind + '": ' + error + '.',
            hint: "Check the action parameters in the advanced view.",
            section: "campaigns", entryIndex: campaignIndex
          });
      }
    });
  });

  set.dialogues.forEach((dialogue, dialogueIndex) => {
    const nodeIds = new Set(dialogue.nodes.map(node => node.id));
    if (nodeIds.size !== dialogue.nodes.length)
      issues.push({
        path: "dialogues[" + dialogueIndex + "].nodes", code: "duplicate-node-id",
        message: 'Dialogue "' + dialogue.sequenceId + '" repeats a node ID.',
        hint: "Every moment needs its own ID.", section: "dialogues", entryIndex: dialogueIndex
      });
    dialogue.nodes.forEach((node, nodeIndex) => {
      if (!node.headline.default.trim())
        issues.push({
          path: "dialogues[" + dialogueIndex + "].nodes[" + nodeIndex + "].headline", code: "missing-headline",
          message: 'Moment "' + node.id + '" has no headline.',
          hint: "Give the moment a name so authors can recognise it.", section: "dialogues", entryIndex: dialogueIndex
        });
      node.actions.forEach(action => {
        if (action.targetNodeId && !nodeIds.has(action.targetNodeId))
          issues.push({
            path: "dialogues[" + dialogueIndex + "].nodes[" + nodeIndex + "].actions", code: "broken-choice-target",
            message: 'Choice "' + action.label.default + '" in "' + dialogue.sequenceId + '" points at "' + action.targetNodeId + '".',
            hint: "Choose an existing moment or leave the target empty to end the dialogue.",
            section: "dialogues", entryIndex: dialogueIndex
          });
      });
    });
    if (!nodeIds.has(dialogue.startNodeId))
      issues.push({
        path: "dialogues[" + dialogueIndex + "].startNodeId", code: "broken-start-node",
        message: 'Dialogue "' + dialogue.sequenceId + '" starts at "' + dialogue.startNodeId + '", which is not one of its nodes.',
        hint: "Choose a start node from the dialogue's node list.",
        section: "dialogues", entryIndex: dialogueIndex
      });
  });

  return {
    valid: !issues.some(issue => (issue.severity ?? "error") === "error"),
    issues
  };
}
