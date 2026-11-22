import type { ContentSetV2Document, GameCapabilities, NamedRef } from "./types";
import { escapeHtml } from "./html";
import { ACTIONS, CONDITIONS, TRIGGERS, findAction } from "./registries";

export interface DetailContext {
  draft: ContentSetV2Document;
  capabilities: GameCapabilities;
}

function options(values: readonly string[], selected: string): string {
  return values.map(value => '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + ">" + escapeHtml(value) + "</option>").join("");
}

function text(label: string, bind: string, value: unknown, type = "text"): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><input type="' + type +
    '" data-v2-bind="' + bind + '" value="' + escapeHtml(String(value ?? "")) + '"></label>';
}

function select(label: string, bind: string, values: readonly string[], selected: string): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><select data-v2-bind="' + bind + '">' +
    options(values, selected) + "</select></label>";
}

function ref(label: string, bind: string, value: NamedRef | undefined): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><input data-v2-ref="' + bind +
    '" value="' + escapeHtml(value?.id ?? "") + '" placeholder="id"></label>';
}

function refList(label: string, bind: string, values: NamedRef[] | undefined): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + '</span><input data-v2-list="' + bind +
    '" value="' + escapeHtml((values ?? []).map(item => item.id).join(", ")) + '" placeholder="ids, comma separated"></label>';
}

function button(action: string, label: string, dataset = ""): string {
  return '<button type="button" class="button button-small" data-detail-action="' + action + '"' + dataset + ">" + escapeHtml(label) + "</button>";
}

/** Inline advanced controls for one category. All actions are handled by the main app. */
export function renderDetailSection(ctx: DetailContext, section: string): string {
  const draft = ctx.draft;
  const capabilities = ctx.capabilities;
  if (section === "campaigns") {
    return draft.campaigns.map((campaign, index) => {
      const base = `campaigns[${index}]`;
      return '<div class="card"><h3>' + escapeHtml(campaign.name.default || campaign.id) + "</h3><div class=\"form-grid two\">" +
        text("id", base + ".id", campaign.id) + text("name", base + ".name.default", campaign.name.default) +
        text("description", base + ".description.default", campaign.description.default) +
        ref("boardPreviewUnitId", base + ".boardPreviewUnitId", campaign.boardPreviewUnitId) +
        refList("questIds", base + ".questIds", campaign.questIds) +
        select("mode", base + ".floors[0].mode", capabilities.enums.floorMode, campaign.floors[0]?.mode ?? capabilities.enums.floorMode[0]) +
        text("startingLives", base + ".settings.startingLives", campaign.settings.startingLives, "number") +
        text("startingSardines", base + ".settings.startingSardines", campaign.settings.startingSardines, "number") +
        ref("playerFactionId", base + ".settings.playerFactionId", campaign.settings.playerFactionId) +
        "</div>" + campaign.floors.map((floor, floorIndex) => {
          const floorBase = base + ".floors[" + floorIndex + "]";
          return '<h4>Floor ' + floor.number + "</h4>" +
            floor.nodes.map((node, nodeIndex) => '<div class="v2-card"><strong>' + escapeHtml(node.id) + "</strong><div class=\"form-grid two\">" +
              text("id", floorBase + ".nodes[" + nodeIndex + "].id", node.id) +
              select("kind", floorBase + ".nodes[" + nodeIndex + "].kind", capabilities.enums.nodeKind, node.kind) +
              text("label", floorBase + ".nodes[" + nodeIndex + "].label.default", node.label.default) +
              text("x", floorBase + ".nodes[" + nodeIndex + "].x", node.x, "number") +
              text("y", floorBase + ".nodes[" + nodeIndex + "].y", node.y, "number") +
              ref("armyId", floorBase + ".nodes[" + nodeIndex + "].armyId", node.armyId) +
              ref("questId", floorBase + ".nodes[" + nodeIndex + "].questId", node.questId) +
              ref("enemyFactionId", floorBase + ".nodes[" + nodeIndex + "].enemyFactionId", node.enemyFactionId) +
              select("rewardKind", floorBase + ".nodes[" + nodeIndex + "].rewardKind", capabilities.enums.rewardKind, node.rewardKind) +
              text("rewardAmount", floorBase + ".nodes[" + nodeIndex + "].rewardAmount", node.rewardAmount, "number") +
              "</div>" +
              node.shopOffers.map((offer, offerIndex) => '<div class="v2-row">' +
                select("kind", floorBase + ".nodes[" + nodeIndex + "].shopOffers[" + offerIndex + "].kind", capabilities.enums.shopOfferKind, offer.kind) +
                ref("contentId", floorBase + ".nodes[" + nodeIndex + "].shopOffers[" + offerIndex + "].contentId", offer.contentId) +
                text("price", floorBase + ".nodes[" + nodeIndex + "].shopOffers[" + offerIndex + "].price", offer.price, "number") +
                button("remove-offer", "Remove offer", ` data-campaign="${index}" data-floor="${floorIndex}" data-node="${nodeIndex}" data-index="${offerIndex}"`) + "</div>").join("") +
              button("add-offer", "+ Offer", ` data-campaign="${index}" data-floor="${floorIndex}" data-node="${nodeIndex}"`) +
              button("remove-node", "Remove node", ` data-campaign="${index}" data-floor="${floorIndex}" data-index="${nodeIndex}"`) + "</div>").join("") +
            button("add-node", "+ Node", ` data-campaign="${index}" data-floor="${floorIndex}"`) +
            floor.routes.map((route, routeIndex) => '<div class="v2-row">' +
              text("id", floorBase + ".routes[" + routeIndex + "].id", route.id) +
              text("from", floorBase + ".routes[" + routeIndex + "].fromNodeId", route.fromNodeId) +
              text("to", floorBase + ".routes[" + routeIndex + "].toNodeId", route.toNodeId) +
              button("remove-route", "Remove route", ` data-campaign="${index}" data-floor="${floorIndex}" data-index="${routeIndex}"`) + "</div>").join("") +
            button("add-route", "+ Route", ` data-campaign="${index}" data-floor="${floorIndex}"`);
        }).join("") +
        "<h4>Events</h4>" + campaign.events.map((event, eventIndex) => {
          const eventBase = base + ".events[" + eventIndex + "]";
          return '<div class="v2-card">' + text("id", eventBase + ".id", event.id) +
            select("trigger", eventBase + ".trigger", TRIGGERS, event.trigger) +
            select("oneShot", eventBase + ".oneShot", ["per-run", "per-node", "always"], event.oneShot) +
            "<h5>Conditions</h5>" + event.conditions.map((condition, conditionIndex) => '<div class="v2-row">' +
              select("condition", eventBase + ".conditions[" + conditionIndex + "].key", CONDITIONS.map(entry => entry.kind), condition.key) +
              text("value", eventBase + ".conditions[" + conditionIndex + "].value", String(condition.value ?? "")) +
              button("remove-condition", "Remove", ` data-campaign="${index}" data-event="${eventIndex}" data-index="${conditionIndex}"`) + "</div>").join("") +
            button("add-condition", "+ Condition", ` data-campaign="${index}" data-event="${eventIndex}"`) +
            "<h5>Actions</h5>" + event.actions.map((action, actionIndex) => {
              const registry = findAction(action.kind);
              return '<div class="v2-card"><select class="field" data-v2-bind="' + eventBase + ".actions[" + actionIndex + '].kind">' + options(ACTIONS.map(entry => entry.kind), action.kind) + "</select>" +
                (registry?.parameters ?? []).map(parameter => {
                  const path = eventBase + ".actions[" + actionIndex + "].parameters[" + parameter.key + "].value";
                  const current = action.parameters.find(item => item.key === parameter.key)?.value;
                  if (parameter.type === "enum") return select(parameter.key, path, parameter.values ?? [], String(current ?? ""));
                  if (parameter.type === "NamedRef") return ref(parameter.key, path, current as NamedRef | undefined);
                  if (parameter.type === "NamedRef[]") return refList(parameter.key, path, current as NamedRef[] | undefined);
                  return text(parameter.key, path, String(current ?? ""), parameter.type === "int" ? "number" : "text");
                }).join("") +
                button("remove-action", "Remove action", ` data-campaign="${index}" data-event="${eventIndex}" data-index="${actionIndex}"`) + "</div>";
            }).join("") + button("add-action", "+ Action", ` data-campaign="${index}" data-event="${eventIndex}"`) +
            button("remove-event", "Remove event", ` data-campaign="${index}" data-index="${eventIndex}"`) + "</div>";
        }).join("") + button("add-event", "+ Event", ` data-campaign="${index}"`) + "</div>";
    }).join("");
  }

  if (section === "quests") {
    return draft.quests.map((quest, index) => {
      const base = `quests[${index}]`;
      const ext = base + ".meowEdit";
      return '<div class="card"><h3>' + escapeHtml(quest.title.default || quest.id) + "</h3><div class=\"form-grid two\">" +
        text("id", base + ".id", quest.id) + text("title", base + ".title.default", quest.title.default) +
        text("description", base + ".description.default", quest.description.default) +
        select("objectiveKind", base + ".objectiveKind", capabilities.enums.objectiveKind, quest.objectiveKind ?? capabilities.enums.objectiveKind[0]) +
        select("rewardKind", base + ".rewardKind", capabilities.enums.rewardKind, quest.rewardKind ?? capabilities.enums.rewardKind[0]) +
        text("rewardAmount", base + ".rewardAmount", quest.rewardAmount ?? 0, "number") +
        ref("itemId", base + ".itemId", quest.itemId) + ref("speakerUnitId", base + ".speakerUnitId", quest.speakerUnitId) +
        text("logicKind", ext + ".logicKind", quest.meowEdit.logicKind) +
        refList("offer dialogue", ext + ".dialogueLinks.offer", quest.meowEdit.dialogueLinks.offer) +
        refList("active dialogue", ext + ".dialogueLinks.active", quest.meowEdit.dialogueLinks.active) +
        refList("completion dialogue", ext + ".dialogueLinks.completion", quest.meowEdit.dialogueLinks.completion) +
        refList("failure dialogue", ext + ".dialogueLinks.failure", quest.meowEdit.dialogueLinks.failure) +
        ref("timer decision", ext + ".timer.decisionId", quest.meowEdit.timer.decisionId) +
        ref("timer pay outcome", ext + ".timer.payOutcomeId", quest.meowEdit.timer.payOutcomeId) +
        ref("timer wait outcome", ext + ".timer.waitOutcomeId", quest.meowEdit.timer.waitOutcomeId) +
        ref("timer counter", ext + ".timer.counterId", quest.meowEdit.timer.counterId) +
        text("counterTarget", ext + ".timer.counterTarget", quest.meowEdit.timer.counterTarget, "number") +
        text("countEvent", ext + ".timer.countEvent", quest.meowEdit.timer.countEvent) +
        text("paymentResource", ext + ".timer.paymentResource", quest.meowEdit.timer.paymentResource) +
        text("paymentAmount", ext + ".timer.paymentAmount", quest.meowEdit.timer.paymentAmount, "number") +
        "</div><h4>Kill count</h4><div class=\"form-grid two\">" +
        text("targetKind", ext + ".killCount.targetKind", quest.meowEdit.killCount.targetKind) +
        ref("targetId", ext + ".killCount.targetId", quest.meowEdit.killCount.targetId) +
        text("count", ext + ".killCount.count", quest.meowEdit.killCount.count, "number") + "</div>" +
        "<h4>Fetch items</h4>" + quest.meowEdit.fetchItems.map((item, itemIndex) => '<div class="v2-row">' +
          text("id", ext + ".fetchItems[" + itemIndex + "].id", item.id) +
          text("displayName", ext + ".fetchItems[" + itemIndex + "].displayName.default", item.displayName.default) +
          text("count", ext + ".fetchItems[" + itemIndex + "].count", item.count, "number") +
          button("remove-fetch-item", "Remove", ` data-quest="${index}" data-index="${itemIndex}"`) + "</div>").join("") +
        button("add-fetch-item", "+ Item", ` data-quest="${index}"`) +
        "<h4>Battle targets</h4>" + quest.meowEdit.battleTargets.map((target, targetIndex) => '<div class="v2-row">' +
          text("id", ext + ".battleTargets[" + targetIndex + "].id", target.id) +
          select("nodeKind", ext + ".battleTargets[" + targetIndex + "].nodeKind", capabilities.enums.nodeKind, target.nodeKind) +
          text("floorOffset", ext + ".battleTargets[" + targetIndex + "].floorOffset", target.floorOffset, "number") +
          ref("armyId", ext + ".battleTargets[" + targetIndex + "].armyId", target.armyId) +
          button("remove-battle-target", "Remove", ` data-quest="${index}" data-index="${targetIndex}"`) + "</div>").join("") +
        button("add-battle-target", "+ Target", ` data-quest="${index}"`) +
        "<h4>Minimum node distances</h4>" + quest.meowEdit.minimumNodeDistances.map((rule, ruleIndex) => '<div class="v2-row">' +
          text("id", ext + ".minimumNodeDistances[" + ruleIndex + "].id", rule.id) +
          select("from", ext + ".minimumNodeDistances[" + ruleIndex + "].fromNodeKind", capabilities.enums.nodeKind, rule.fromNodeKind) +
          select("to", ext + ".minimumNodeDistances[" + ruleIndex + "].toNodeKind", capabilities.enums.nodeKind, rule.toNodeKind) +
          text("minimumHops", ext + ".minimumNodeDistances[" + ruleIndex + "].minimumHops", rule.minimumHops, "number") +
          button("remove-distance", "Remove", ` data-quest="${index}" data-index="${ruleIndex}"`) + "</div>").join("") +
        button("add-distance", "+ Rule", ` data-quest="${index}"`) +
        "<h4>Completion effects</h4>" + quest.meowEdit.completionEffects.map((effect, effectIndex) => '<div class="v2-row">' +
          text("kind", ext + ".completionEffects[" + effectIndex + "].kind", effect.kind) +
          ref("targetId", ext + ".completionEffects[" + effectIndex + "].targetId", effect.targetId) +
          button("remove-effect", "Remove", ` data-quest="${index}" data-index="${effectIndex}"`) + "</div>").join("") +
        button("add-effect", "+ Effect", ` data-quest="${index}"`) + "</div>";
    }).join("");
  }

  if (section === "armies") {
    return draft.armies.map((army, index) => {
      const base = `armies[${index}]`;
      return '<div class="card"><h3>' + escapeHtml(army.name.default || army.id) + "</h3><div class=\"form-grid two\">" +
        text("id", base + ".id", army.id) + text("name", base + ".name.default", army.name.default) +
        refList("spells", base + ".spellIds", army.spellIds) + refList("blessings", base + ".blessingIds", army.blessingIds) + "</div>" +
        "<h4>Units</h4>" + army.units.map((unit, unitIndex) => '<div class="v2-row">' +
          ref("unitId", base + ".units[" + unitIndex + "].unitId", unit.unitId) +
          text("x", base + ".units[" + unitIndex + "].x", unit.x, "number") +
          text("y", base + ".units[" + unitIndex + "].y", unit.y, "number") +
          refList("spells", base + ".units[" + unitIndex + "].spellIds", unit.spellIds) +
          button("remove-unit", "Remove", ` data-army="${index}" data-index="${unitIndex}"`) + "</div>").join("") +
        button("add-unit", "+ Unit", ` data-army="${index}"`) +
        "<h4>Cell blessing picks</h4>" + army.CellBlessingPicks.map((pick, pickIndex) => '<div class="v2-row">' +
          ref("RootId", base + ".CellBlessingPicks[" + pickIndex + "].RootId", pick.RootId) +
          text("Lane", base + ".CellBlessingPicks[" + pickIndex + "].Lane", pick.Lane) +
          '<label class="field"><span class="field-label">Locked</span><input type="checkbox" data-v2-bool="' + base + ".CellBlessingPicks[" + pickIndex + '].Locked"' + (pick.Locked ? " checked" : "") + "></label>" +
          '<label class="field"><span class="field-label">Cells (x,y; x,y)</span><input data-v2-cells="' + base + ".CellBlessingPicks[" + pickIndex + '].Cells" value="' + escapeHtml(pick.Cells.map(cell => `${(cell as { x?: number }).x ?? 0},${(cell as { y?: number }).y ?? 0}`).join("; ")) + '"></label>' +
          '<label class="field"><span class="field-label">BaneCells</span><input data-v2-bane-cells="' + base + ".CellBlessingPicks[" + pickIndex + '].BaneCells" value="' + escapeHtml(pick.BaneCells.map(cell => `${(cell as { x?: number }).x ?? 0},${(cell as { y?: number }).y ?? 0}`).join("; ")) + '"></label>' +
          button("remove-cell-pick", "Remove", ` data-army="${index}" data-index="${pickIndex}"`) + "</div>").join("") +
        button("add-cell-pick", "+ Pick", ` data-army="${index}"`) + "</div>";
    }).join("");
  }

  if (section === "dialogues") {
    return draft.dialogues.map((dialogue, dialogueIndex) => {
      const base = `dialogues[${dialogueIndex}]`;
      return '<div class="card"><h3>' + escapeHtml(dialogue.sequenceId) + "</h3><div class=\"form-grid two\">" +
        text("sequenceId", base + ".sequenceId", dialogue.sequenceId) +
        text("startNodeId", base + ".startNodeId", dialogue.startNodeId) +
        text("pauseMode", base + ".pauseMode", dialogue.pauseMode) +
        text("defaultCharactersPerSecond", base + ".defaultCharactersPerSecond", dialogue.defaultCharactersPerSecond, "number") + "</div>" +
        dialogue.nodes.map((node, nodeIndex) => {
          const nodeBase = base + ".nodes[" + nodeIndex + "]";
          return '<div class="v2-card"><strong>' + escapeHtml(node.id) + "</strong><div class=\"form-grid two\">" +
            text("id", nodeBase + ".id", node.id) + text("headline", nodeBase + ".headline.default", node.headline.default) +
            text("textSpeed", nodeBase + ".textSpeed", node.textSpeed, "number") + "</div>" +
            "<h5>Speakers</h5>" + node.speakers.map((speaker, speakerIndex) => '<div class="v2-row">' +
              text("id", nodeBase + ".speakers[" + speakerIndex + "].id", speaker.id) +
              ref("unitId", nodeBase + ".speakers[" + speakerIndex + "].unitId", speaker.unitId) +
              text("displayName", nodeBase + ".speakers[" + speakerIndex + "].displayName.default", speaker.displayName.default) +
              text("side", nodeBase + ".speakers[" + speakerIndex + "].side", speaker.side) +
              text("mood", nodeBase + ".speakers[" + speakerIndex + "].mood", speaker.mood) +
              button("remove-speaker", "Remove", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}" data-index="${speakerIndex}"`) + "</div>").join("") +
            button("add-speaker", "+ Speaker", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}"`) +
            "<h5>Segments</h5>" + node.segments.map((segment, segmentIndex) => '<div class="v2-row">' +
              '<input data-v2-list="' + nodeBase + ".segments[" + segmentIndex + '].speakerIds" value="' + escapeHtml(segment.speakerIds.join(", ")) + '">' +
              text("text", nodeBase + ".segments[" + segmentIndex + "].text.default", segment.text.default) +
              button("remove-segment", "Remove", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}" data-index="${segmentIndex}"`) + "</div>").join("") +
            button("add-segment", "+ Segment", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}"`) +
            "<h5>Actions</h5>" + node.actions.map((action, actionIndex) => '<div class="v2-row">' +
              text("label", nodeBase + ".actions[" + actionIndex + "].label.default", action.label.default) +
              text("targetNodeId", nodeBase + ".actions[" + actionIndex + "].targetNodeId", action.targetNodeId) +
              text("decisionId", nodeBase + ".actions[" + actionIndex + "].meowEdit.decision.id", action.meowEdit.decision.id) +
              text("outcomeId", nodeBase + ".actions[" + actionIndex + "].meowEdit.decision.outcomeId", action.meowEdit.decision.outcomeId) +
              '<label class="field"><span class="field-label">defaultContinue</span><input type="checkbox" data-v2-bool="' + nodeBase + ".actions[" + actionIndex + '].meowEdit.defaultContinue"' + (action.meowEdit.defaultContinue ? " checked" : "") + "></label>" +
              button("remove-dialogue-action", "Remove", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}" data-index="${actionIndex}"`) + "</div>").join("") +
            button("add-dialogue-action", "+ Action", ` data-dialogue="${dialogueIndex}" data-node="${nodeIndex}"`) +
            button("remove-dialogue-node", "Remove node", ` data-dialogue="${dialogueIndex}" data-index="${nodeIndex}"`) + "</div>";
        }).join("") + button("add-dialogue-node", "+ Node", ` data-dialogue="${dialogueIndex}"`) + "</div>";
    }).join("");
  }
  return "";
}

export function detailItemCount(draft: ContentSetV2Document, section: string): number {
  if (section === "campaigns") return draft.campaigns.length;
  if (section === "quests") return draft.quests.length;
  if (section === "armies") return draft.armies.length;
  return draft.dialogues.length;
}

export const DETAIL_SECTIONS = ["campaigns", "quests", "armies", "dialogues"] as const;
export type DetailSection = typeof DETAIL_SECTIONS[number];
