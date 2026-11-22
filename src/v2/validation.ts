import {
  findAction, findCondition, isKnownTrigger, parameterErrors
} from "./registries";
import type { ContentSetV2Document, GameCapabilities, NamedRef } from "./types";
import { contentSetV2Schema } from "./zod";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
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

function localIds(set: ContentSetV2Document): Set<string> {
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
    ...capabilities.ids.spells,
    ...capabilities.ids.factions
  ]);
}

function enumIssue(value: unknown, allowed: readonly string[], path: string, label: string): ValidationIssue | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !allowed.includes(value))
    return { path, message: label + " must be one of: " + allowed.join(", ") };
  return null;
}

function pushEnum(issues: ValidationIssue[], value: unknown, allowed: readonly string[], path: string, label: string): void {
  const issue = enumIssue(value, allowed, path, label);
  if (issue) issues.push(issue);
}

function pushEnumList(issues: ValidationIssue[], values: readonly string[], allowed: readonly string[], path: string, label: string): void {
  values.forEach((value, index) => pushEnum(issues, value, allowed, path + "[" + index + "]", label));
}

/** Strict validation: schema shape, reference resolution, registries and capability limits. */
export function validateContentSet(value: unknown, capabilities: GameCapabilities): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = contentSetV2Schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      issues.push({ path: issue.path.join("."), message: issue.message });
    return { valid: false, issues };
  }
  const set = parsed.data as ContentSetV2Document;

  set.quests.forEach((quest, questIndex) => {
    pushEnum(issues, quest.objectiveKind, capabilities.enums.objectiveKind, "quests[" + questIndex + "].objectiveKind", "objectiveKind");
    pushEnum(issues, quest.rewardKind, capabilities.enums.rewardKind, "quests[" + questIndex + "].rewardKind", "rewardKind");
  });

  if (set.campaigns.length === 0)
    issues.push({ path: "campaigns", message: "A set must contain at least one campaign (§1)." });

  const local = localIds(set);
  const allowed = new Set([...local, ...capabilityIds(capabilities)]);

  const seenIds = new Map<string, string>();
  for (const [kind, id, path] of [
    ...set.quests.map(quest => ["quest", quest.id, "quests"] as const),
    ...set.armies.map(army => ["army", army.id, "armies"] as const),
    ...set.campaigns.map(campaign => ["campaign", campaign.id, "campaigns"] as const),
    ...set.dialogues.map(dialogue => ["dialogue", dialogue.sequenceId, "dialogues"] as const)
  ]) {
    if (seenIds.has(id)) issues.push({ path, message: "duplicate " + kind + " id '" + id + "'" });
    seenIds.set(id, kind);
  }

  walk(set, "", (node, path) => {
    if (isNamedRef(node) && !allowed.has(node.id))
      issues.push({ path: path + ".id", message: "unresolved reference '" + node.id + "'" });
  });

  for (const campaignId of set.set.campaignOrder)
    if (!set.campaigns.some(campaign => campaign.id === campaignId))
      issues.push({ path: "set.campaignOrder", message: "campaignOrder references unknown campaign '" + campaignId + "'" });

  set.campaigns.forEach((campaign, campaignIndex) => {
    const campaignPath = "campaigns[" + campaignIndex + "]";
    pushEnumList(issues, campaign.settings.shopPoolKinds, capabilities.enums.shopPoolKind, campaignPath + ".settings.shopPoolKinds", "shopPoolKind");
    campaign.floors.forEach((floor, floorIndex) => {
      const floorPath = campaignPath + ".floors[" + floorIndex + "]";
      pushEnum(issues, floor.mode, capabilities.enums.floorMode, floorPath + ".mode", "floorMode");
      pushEnumList(issues, floor.shopPoolKinds, capabilities.enums.shopPoolKind, floorPath + ".shopPoolKinds", "shopPoolKind");
      floor.nodes.forEach((node, nodeIndex) => {
        pushEnum(issues, node.kind, capabilities.enums.nodeKind, floorPath + ".nodes[" + nodeIndex + "].kind", "nodeKind");
        pushEnum(issues, node.rewardKind, capabilities.enums.rewardKind, floorPath + ".nodes[" + nodeIndex + "].rewardKind", "rewardKind");
        node.shopOffers.forEach((offer, offerIndex) => pushEnum(issues, offer.kind,
          capabilities.enums.shopOfferKind, floorPath + ".nodes[" + nodeIndex + "].shopOffers[" + offerIndex + "].kind", "shopOfferKind"));
      });
      if (floor.nodes.length > capabilities.limits.maxAuthoredNodesPerFloor)
        issues.push({
          path: floorPath + ".nodes",
          message: "floor has " + floor.nodes.length + " nodes; limit is " + capabilities.limits.maxAuthoredNodesPerFloor
        });
      for (const questRef of floor.questPoolIds)
        if (!set.quests.some(quest => quest.id === questRef.id))
          issues.push({ path: floorPath + ".questPoolIds", message: "unknown quest '" + questRef.id + "'" });
      const nodeIds = new Set(floor.nodes.map(node => node.id));
      for (const route of floor.routes) {
        if (!nodeIds.has(route.fromNodeId))
          issues.push({ path: floorPath + ".routes", message: "route source '" + route.fromNodeId + "' is not a node on this floor" });
        if (!nodeIds.has(route.toNodeId))
          issues.push({ path: floorPath + ".routes", message: "route target '" + route.toNodeId + "' is not a node on this floor" });
      }
    });
    campaign.events.forEach((event, eventIndex) => {
      const eventPath = campaignPath + ".events[" + eventIndex + "]";
      // `node-cleared` is internal-only for author pickers but is a known trigger in stored,
      // imported and v1-migrated content (§7.1), so validation must accept it.
      if (!isKnownTrigger(event.trigger))
        issues.push({ path: eventPath + ".trigger", message: "unknown trigger '" + event.trigger + "'" });
      for (const condition of event.conditions) {
        const entry = findCondition(condition.key);
        if (!entry) {
          issues.push({ path: eventPath + ".conditions", message: "unknown condition '" + condition.key + "'" });
          continue;
        }
        // §5.5 encodes a condition as a Parameter whose `key` is the condition kind;
        // §7.2 defines its value type (and enum/reference constraints).
        if (entry.parameters.length === 0) {
          if (condition.value !== null)
            issues.push({ path: eventPath + ".conditions", message: condition.key + ": parameterless conditions require value: null" });
          continue;
        }
        const descriptor = entry.parameters[0];
        const conditionValue = condition.value;
        for (const error of parameterErrors(entry, [{ key: descriptor.key, value: conditionValue }], capabilities.enums))
          issues.push({ path: eventPath + ".conditions", message: condition.key + ": " + error });
        if (descriptor.refKind === "blessing" && isNamedRef(conditionValue)
            && !capabilities.ids.blessings.includes(conditionValue.id))
          issues.push({ path: eventPath + ".conditions", message: condition.key + ": unknown blessing '" + conditionValue.id + "'" });
        if (descriptor.refKind === "quest" && isNamedRef(conditionValue)
            && !set.quests.some(quest => quest.id === conditionValue.id))
          issues.push({ path: eventPath + ".conditions", message: condition.key + ": unknown quest '" + conditionValue.id + "'" });
        if (condition.key === "choice-outcome" && typeof condition.value === "string"
            && !local.has(condition.value))
          issues.push({ path: eventPath + ".conditions", message: condition.key + ": unknown outcomeId '" + condition.value + "'" });
      }
      for (const action of event.actions) {
        const entry = findAction(action.kind);
        if (!entry) {
          issues.push({ path: eventPath + ".actions", message: "unknown action '" + action.kind + "'" });
          continue;
        }
        for (const error of parameterErrors(entry, action.parameters))
          issues.push({ path: eventPath + ".actions", message: action.kind + ": " + error });
      }
    });
  });

  set.dialogues.forEach((dialogue, dialogueIndex) => {
    const dialoguePath = "dialogues[" + dialogueIndex + "]";
    const nodeIds = new Set(dialogue.nodes.map(node => node.id));
    if (!nodeIds.has(dialogue.startNodeId))
      issues.push({ path: dialoguePath + ".startNodeId", message: "startNodeId is not a node in this dialogue" });
  });

  return { valid: issues.length === 0, issues };
}
