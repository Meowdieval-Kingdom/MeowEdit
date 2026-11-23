import { localized, namedRef } from "../v2/factory";
import type {
  CampaignEvent,
  ContentSetV2Document,
  DialogueDecision,
  GameCapabilities
} from "../v2/types";
import {
  emptyQuestExtension,
  type AdventureQuestDefinition,
  type ArmyRecord,
  type CampaignRecord,
  type DialogueNode,
  type DialogueRecord,
  type QuestRecord,
  type Workspace
} from "./model";

/**
 * One-way conversion at the cloud boundary only. The editor itself uses native
 * v1 records, so Drawflow positions, editor labels and placement IDs stay intact.
 */

const text = (value: { default?: string } | undefined): string => value?.default ?? "";
const ref = (value: { id?: string } | undefined): string => value?.id ?? "";

function decisionOf(decision: DialogueDecision | undefined): import("./model").DialogueDecision | undefined {
  if (!decision || !decision.id && !decision.outcomeId) return undefined;
  return {
    id: decision.id,
    label: text(decision.label),
    outcomeId: decision.outcomeId,
    outcomeLabel: text(decision.outcomeLabel)
  };
}

function fallbackDecision(id: string): DialogueDecision {
  return { id, label: localized(""), outcomeId: "", outcomeLabel: localized("") };
}

function speedToV1(value: number): string {
  return value >= 60 ? "fast" : value <= 20 ? "slow" : "default";
}

function speedToV2(value: string, base: number): number {
  return value === "fast" ? base * 1.5 : value === "slow" ? base * 0.5 : base;
}

/** Converts the authoritative v2 draft into the shape the restored v1 screens render. */
export function draftToWorkspace(
  draft: ContentSetV2Document,
  capabilities: GameCapabilities,
  selected?: { section: string; index: number }
): Workspace {
  const dialogues: DialogueRecord[] = draft.dialogues.map(doc => {
    return {
      key: doc.sequenceId,
      sequence: {
        schemaVersion: 1,
        sequenceId: doc.sequenceId,
        startNodeId: doc.startNodeId,
        pauseMode: doc.pauseMode === "continue" ? "continue" : "pause",
        defaultCharactersPerSecond: doc.defaultCharactersPerSecond,
        nodes: doc.nodes.map(node => {
          const implicit = node.actions.length === 1 && node.actions[0].meowEdit?.defaultContinue === true;
          return {
            id: node.id,
            headline: text(node.headline),
            continueLabel: implicit ? text(node.actions[0].label) : undefined,
            continueTargetNodeId: implicit ? node.actions[0].targetNodeId : undefined,
            textSpeed: speedToV1(node.textSpeed),
            speakers: node.speakers.map(speaker => ({
              id: speaker.id, unitId: ref(speaker.unitId), displayName: text(speaker.displayName),
              side: speaker.side === "right" ? "right" as const : "left" as const, mood: speaker.mood
            })),
            segments: node.segments.map(segment => ({
              speakerIds: [...segment.speakerIds], text: text(segment.text)
            })),
            actions: implicit ? [] : node.actions.map(action => {
              const decision = decisionOf(action.meowEdit?.decision);
              return {
                label: text(action.label), targetNodeId: action.targetNodeId,
                ...(decision ? { decision } : {})
              };
            })
          } satisfies DialogueNode;
        })
      }
    };
  });

  const quests: QuestRecord[] = draft.quests.map(doc => {
    const ext = doc.meowEdit ?? emptyQuestExtension();
    const definition: AdventureQuestDefinition = {
      id: doc.id, title: text(doc.title), description: text(doc.description),
      sourceKind: doc.sourceKind ?? "QuestGiver", sourceSlot: Number(doc.sourceSlot ?? -1),
      firstFloor: doc.firstFloor ?? 1, repeatEveryFloors: doc.repeatEveryFloors ?? 0,
      priority: doc.priority ?? 0, objectiveKind: doc.objectiveKind ?? capabilities.enums.objectiveKind[0] ?? "Fetch",
      targetNodeKind: doc.targetNodeKind ?? "", targetFloorOffset: doc.targetFloorOffset ?? 0,
      escortUnitId: ref(doc.escortUnitId), itemId: ref(doc.itemId),
      speakerUnitId: ref(doc.speakerUnitId), speakerName: text(doc.speakerName),
      offerText: text(doc.offerText), activeText: text(doc.activeText),
      acceptLabel: text(doc.acceptLabel), declineLabel: text(doc.declineLabel),
      rewardKind: doc.rewardKind ?? capabilities.enums.rewardKind[0] ?? "Sardines",
      rewardAmount: doc.rewardAmount ?? 0, rewardContentId: ref(doc.rewardContentId)
    };
    return {
      key: doc.id, definition,
      extension: {
        schemaVersion: 1,
        dialogueLinks: {
          offer: ref(ext.dialogueLinks?.offer?.[0]), active: ref(ext.dialogueLinks?.active?.[0]),
          completion: ref(ext.dialogueLinks?.completion?.[0]), failure: ref(ext.dialogueLinks?.failure?.[0])
        },
        logicKind: ext.logicKind === "timer-project" ? "timer-project" : "standard",
        timer: {
          decisionId: ref(ext.timer?.decisionId), payOutcomeId: ref(ext.timer?.payOutcomeId),
          waitOutcomeId: ref(ext.timer?.waitOutcomeId), counterId: ref(ext.timer?.counterId),
          counterTarget: ext.timer?.counterTarget ?? 3, counterLabel: text(ext.timer?.counterLabel),
          countEvent: ext.timer?.countEvent === "battle-won" ? "battle-won" : "any-battle-completed",
          paymentResource: "Sardines", paymentAmount: ext.timer?.paymentAmount ?? 0,
          paymentCompletesImmediately: ext.timer?.paymentCompletesImmediately === true,
          completionEffects: (ext.timer?.completionEffects ?? []).map(effect => ({
            kind: effect.kind as "play-event" | "unlock-path" | "unlock-shop-item",
            targetId: ref(effect.targetId), label: text(effect.label)
          }))
        },
        completionEffects: (ext.completionEffects ?? []).map(effect => ({
          kind: effect.kind as "play-event" | "unlock-path" | "unlock-shop-item",
          targetId: ref(effect.targetId), label: text(effect.label)
        })),
        fetchItems: (ext.fetchItems ?? []).map(item => ({
          id: item.id, displayName: text(item.displayName), count: item.count
        })),
        battleTargets: (ext.battleTargets ?? []).map(target => ({
          id: target.id, label: text(target.label), nodeKind: target.nodeKind,
          floorOffset: target.floorOffset, armyId: ref(target.armyId)
        })),
        killCount: ext.killCount ? {
          targetKind: ext.killCount.targetKind as "unit" | "faction" | "building-faction",
          targetId: ref(ext.killCount.targetId), count: ext.killCount.count
        } : null,
        minimumNodeDistances: (ext.minimumNodeDistances ?? []).map(rule => ({
          id: rule.id, fromNodeKind: rule.fromNodeKind, toNodeKind: rule.toNodeKind,
          minimumHops: rule.minimumHops
        }))
      }
    };
  });

  const armies: ArmyRecord[] = draft.armies.map(doc => {
    return {
      key: doc.id, id: doc.id, name: text(doc.name), previewFloor: 1,
      units: doc.units.map((unit, index) => ({
        id: `placement-${index}`, unitId: ref(unit.unitId),
        x: unit.x, y: unit.y, spellIds: unit.spellIds.map(item => item.id)
      })),
      spellIds: doc.spellIds.map(item => item.id),
      blessingIds: doc.blessingIds.map(item => item.id),
      cellBlessingPicks: (doc.CellBlessingPicks ?? []).map(pick => ({
        rootId: ref(pick.RootId), lane: Number(pick.Lane),
        cells: pick.Cells as Array<{ x: number; y: number }>, locked: pick.Locked,
        baneCells: pick.BaneCells as Array<{ x: number; y: number }>
      }))
    };
  });

  const campaigns: CampaignRecord[] = draft.campaigns.map(doc => ({
    key: doc.id, id: doc.id, name: text(doc.name), description: text(doc.description),
    boardPreviewUnitId: ref(doc.boardPreviewUnitId),
    designMode: "choose",
    questIds: doc.questIds.map(item => item.id),
    floors: doc.floors.map(floor => ({
      id: floor.id, number: floor.number, mode: floor.mode as CampaignRecord["floors"][number]["mode"],
      questPoolMode: floor.questPoolMode as "campaign" | "custom", questPoolIds: floor.questPoolIds.map(item => item.id),
      shopPoolMode: floor.shopPoolMode as "campaign" | "custom", shopPoolKinds: [...floor.shopPoolKinds] as CampaignRecord["floors"][number]["shopPoolKinds"],
      shopLevel: floor.shopLevel, randomSettings: { ...floor.randomSettings },
      nodes: floor.nodes.map(node => ({
        id: node.id, label: text(node.label), kind: node.kind as CampaignRecord["floors"][number]["nodes"][number]["kind"],
        x: node.x, y: node.y, armyId: ref(node.armyId), questId: ref(node.questId),
        enemyFactionId: ref(node.enemyFactionId), rewardKind: node.rewardKind as CampaignRecord["floors"][number]["nodes"][number]["rewardKind"],
        rewardAmount: node.rewardAmount, rewardContentId: ref(node.rewardContentId),
        shopOfferMode: node.shopOfferMode === "exact" ? "exact" : "generated",
        shopOffers: node.shopOffers.map(offer => ({ kind: offer.kind as "Unit", contentId: ref(offer.contentId), price: offer.price }))
      })),
      routes: floor.routes.map(route => ({ id: route.id, fromNodeId: route.fromNodeId, toNodeId: route.toNodeId, oneWay: route.oneWay }))
    })),
    events: doc.events.map(event => ({
      id: event.id, trigger: event.trigger as CampaignRecord["events"][number]["trigger"],
      ...(event.floorNumber !== undefined ? { floorNumber: event.floorNumber } : {}),
      ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      actions: event.actions.map(action => ({
        kind: action.kind,
        ...Object.fromEntries(action.parameters.map(parameter => {
          const key = parameter.key === "army" ? "armyId" : parameter.key;
          const value = parameter.value && typeof parameter.value === "object" && "id" in parameter.value
            ? String((parameter.value as { id: unknown }).id ?? "") : parameter.value;
          return [key, value];
        }))
      }))
    })),
    settings: {
      startingLives: doc.settings.startingLives, startingSardines: doc.settings.startingSardines,
      startingNodeCount: doc.settings.startingNodeCount, playerFactionId: ref(doc.settings.playerFactionId),
      factionSelectionEnabled: doc.settings.factionSelectionEnabled, battleShopEnabled: doc.settings.battleShopEnabled,
      shopPoolKinds: [...doc.settings.shopPoolKinds] as CampaignRecord["settings"]["shopPoolKinds"],
      questNodeCountPerRandomFloor: doc.settings.questNodeCountPerRandomFloor,
      shopNodeCountPerRandomFloor: doc.settings.shopNodeCountPerRandomFloor,
      nodeGrowthPerFloor: doc.settings.nodeGrowthPerFloor,
      continueWithGeneratedFloors: doc.settings.continueWithGeneratedFloors
    }
  }));

  const sections: Array<{ section: string; key?: string; type: Workspace["selectedType"] }> = [
    { section: "dialogues", key: selected?.section === "dialogues" ? dialogues[selected.index]?.key : undefined, type: "dialogue" },
    { section: "quests", key: selected?.section === "quests" ? quests[selected.index]?.key : undefined, type: "quest" },
    { section: "armies", key: selected?.section === "armies" ? armies[selected.index]?.key : undefined, type: "army" },
    { section: "campaigns", key: selected?.section === "campaigns" ? campaigns[selected.index]?.key : undefined, type: "campaign" }
  ];
  const chosen = sections.find(item => item.key);
  const first = dialogues[0] ?? quests[0] ?? armies[0] ?? campaigns[0];
  const firstType: Workspace["selectedType"] = dialogues.length ? "dialogue" : quests.length ? "quest"
    : armies.length ? "army" : campaigns.length ? "campaign" : null;
  const type = chosen?.type ?? firstType;
  const key = chosen?.key ?? first?.key ?? null;
  const activeNodeId = type === "dialogue"
    ? dialogues.find(item => item.key === key)?.sequence.startNodeId ?? null : null;
  return {
    schemaVersion: 1, dialogues, quests, armies, campaigns,
    selectedType: type, selectedKey: key, activeNodeId
  };
}

/** Writes all v1 screen edits back into the authoritative v2 draft, preserving v2-only fields. */
export function workspaceToDraft(
  draft: ContentSetV2Document,
  workspace: Workspace,
  capabilities: GameCapabilities
): void {
  draft.dialogues = workspace.dialogues.map(record => {
    const sequence = record.sequence;
    const nodes = sequence.nodes.map(node => {
      const implicit = !node.actions.length;
      const actions = (implicit
        ? [{ label: node.continueLabel?.trim() || "Continue", targetNodeId: node.continueTargetNodeId ?? "", decision: undefined }]
        : node.actions).map(action => ({
        label: localized(action.label), targetNodeId: action.targetNodeId,
        meowEdit: {
          decision: action.decision
            ? {
              id: action.decision.id, label: localized(action.decision.label),
              outcomeId: action.decision.outcomeId, outcomeLabel: localized(action.decision.outcomeLabel)
            }
            : fallbackDecision(action.label || "continue"),
          defaultContinue: implicit
        }
      }));
      return {
        id: node.id, headline: localized(node.headline),
        textSpeed: speedToV2(String(node.textSpeed), sequence.defaultCharactersPerSecond),
        speakers: node.speakers.map(speaker => ({
          id: speaker.id, unitId: namedRef(speaker.unitId), displayName: localized(speaker.displayName),
          side: speaker.side === "right" ? "right" : "left", mood: speaker.mood
        })),
        segments: node.segments.map(segment => ({
          speakerIds: [...segment.speakerIds], text: localized(segment.text)
        })),
        actions
      };
    });
    return {
      schemaVersion: 2, sequenceId: sequence.sequenceId, startNodeId: sequence.startNodeId,
      pauseMode: sequence.pauseMode, defaultCharactersPerSecond: sequence.defaultCharactersPerSecond, nodes
    } as ContentSetV2Document["dialogues"][number] & Record<string, unknown> as ContentSetV2Document["dialogues"][number];
  });

  draft.quests = workspace.quests.map(record => {
    const definition = record.definition;
    const ext = record.extension;
    const links = (value: string) => value ? [namedRef(value)] : [];
    return {
      schemaVersion: 2, id: definition.id, title: localized(definition.title),
      description: localized(definition.description), sourceKind: definition.sourceKind,
      sourceSlot: String(definition.sourceSlot ?? -1), firstFloor: definition.firstFloor,
      repeatEveryFloors: definition.repeatEveryFloors, priority: definition.priority,
      objectiveKind: definition.objectiveKind, targetNodeKind: definition.targetNodeKind,
      targetFloorOffset: definition.targetFloorOffset, escortUnitId: namedRef(definition.escortUnitId),
      itemId: namedRef(definition.itemId), speakerUnitId: namedRef(definition.speakerUnitId),
      speakerName: localized(definition.speakerName), offerText: localized(definition.offerText),
      activeText: localized(definition.activeText), acceptLabel: localized(definition.acceptLabel),
      declineLabel: localized(definition.declineLabel), rewardKind: definition.rewardKind,
      rewardAmount: definition.rewardAmount, rewardContentId: namedRef(definition.rewardContentId),
      meowEdit: {
        schemaVersion: 2,
        dialogueLinks: {
          offer: links(ext.dialogueLinks.offer), active: links(ext.dialogueLinks.active),
          completion: links(ext.dialogueLinks.completion), failure: links(ext.dialogueLinks.failure)
        },
        logicKind: ext.logicKind,
        timer: {
          decisionId: namedRef(ext.timer.decisionId), payOutcomeId: namedRef(ext.timer.payOutcomeId),
          waitOutcomeId: namedRef(ext.timer.waitOutcomeId), counterId: namedRef(ext.timer.counterId),
          counterTarget: ext.timer.counterTarget, counterLabel: localized(ext.timer.counterLabel),
          countEvent: ext.timer.countEvent, paymentResource: "sardines",
          paymentAmount: ext.timer.paymentAmount, paymentCompletesImmediately: ext.timer.paymentCompletesImmediately,
          completionEffects: ext.timer.completionEffects.map(effect => ({
            kind: effect.kind, targetId: namedRef(effect.targetId), label: localized(effect.label)
          }))
        },
        completionEffects: ext.completionEffects.map(effect => ({
          kind: effect.kind, targetId: namedRef(effect.targetId), label: localized(effect.label)
        })),
        fetchItems: ext.fetchItems.map(item => ({
          id: item.id, displayName: localized(item.displayName), count: item.count
        })),
        battleTargets: ext.battleTargets.map(target => ({
          id: target.id, label: localized(target.label), nodeKind: target.nodeKind,
          floorOffset: target.floorOffset, armyId: namedRef(target.armyId)
        })),
        killCount: ext.killCount ? {
          targetKind: ext.killCount.targetKind, targetId: namedRef(ext.killCount.targetId), count: ext.killCount.count
        } : { targetKind: "unit", targetId: namedRef(capabilities.ids.units[0] ?? "unit"), count: 1 },
        minimumNodeDistances: ext.minimumNodeDistances.map(rule => ({
          id: rule.id, fromNodeKind: rule.fromNodeKind, toNodeKind: rule.toNodeKind, minimumHops: rule.minimumHops
        }))
      }
    } as ContentSetV2Document["quests"][number];
  });

  draft.armies = workspace.armies.map(record => {
    return {
      schemaVersion: 2, id: record.id, name: localized(record.name),
      units: record.units.map(unit => ({
        unitId: namedRef(unit.unitId), x: unit.x, y: unit.y,
        spellIds: unit.spellIds.map(id => namedRef(id))
      })),
      spellIds: record.spellIds.map(id => namedRef(id)),
      blessingIds: record.blessingIds.map(id => namedRef(id)),
      CellBlessingPicks: (record.cellBlessingPicks ?? []).map(pick => ({
        RootId: namedRef(pick.rootId), Lane: String(pick.lane),
        Cells: pick.cells as object[], Locked: pick.locked, BaneCells: pick.baneCells as object[]
      }))
    } as ContentSetV2Document["armies"][number];
  });

  const oldCampaigns = new Map(draft.campaigns.map(doc => [doc.id, doc]));
  draft.campaigns = workspace.campaigns.map(record => {
    const events: CampaignEvent[] = record.events.map(event => ({
      id: event.id, trigger: event.trigger,
      ...(event.floorNumber !== undefined ? { floorNumber: event.floorNumber } : {}),
      ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      conditions: [], oneShot: "per-run" as const,
      actions: event.actions.map(action => ({
        kind: action.kind,
        parameters: Object.entries(action)
          .filter(([key]) => key !== "kind")
          .map(([key, value]) => key === "armyId"
            ? { key: "army", value: namedRef(String(value ?? "")) }
            : { key, value })
      }))
    }));
    return {
      schemaVersion: 2, id: record.id, name: localized(record.name), description: localized(record.description),
      boardPreviewUnitId: namedRef(record.boardPreviewUnitId ?? ""),
      questIds: record.questIds.map(id => namedRef(id)),
      floors: record.floors.map(floor => ({
        id: floor.id, number: floor.number, mode: floor.mode,
        questPoolMode: floor.questPoolMode, questPoolIds: floor.questPoolIds.map(id => namedRef(id)),
        shopPoolMode: floor.shopPoolMode, shopPoolKinds: [...floor.shopPoolKinds], shopLevel: floor.shopLevel,
        randomSettings: { ...floor.randomSettings },
        nodes: floor.nodes.map(node => ({
          id: node.id, label: localized(node.label), kind: node.kind, x: node.x, y: node.y,
          armyId: namedRef(node.armyId), questId: namedRef(node.questId),
          enemyFactionId: namedRef(node.enemyFactionId), rewardKind: node.rewardKind,
          rewardAmount: node.rewardAmount, rewardContentId: namedRef(node.rewardContentId),
          shopOfferMode: node.shopOfferMode,
          shopOffers: node.shopOffers.map(offer => ({
            kind: offer.kind, contentId: namedRef(offer.contentId), price: offer.price
          }))
        })),
        routes: floor.routes.map(route => ({ ...route }))
      })),
      events,
      settings: {
        startingLives: record.settings.startingLives, startingSardines: record.settings.startingSardines,
        startingNodeCount: record.settings.startingNodeCount,
        playerFactionId: namedRef(record.settings.playerFactionId),
        factionSelectionEnabled: record.settings.factionSelectionEnabled,
        battleShopEnabled: record.settings.battleShopEnabled,
        shopPoolKinds: [...record.settings.shopPoolKinds],
        questNodeCountPerRandomFloor: record.settings.questNodeCountPerRandomFloor,
        shopNodeCountPerRandomFloor: record.settings.shopNodeCountPerRandomFloor,
        nodeGrowthPerFloor: record.settings.nodeGrowthPerFloor,
        continueWithGeneratedFloors: record.settings.continueWithGeneratedFloors,
        blessingsEnabled: oldCampaigns.get(record.key)?.settings.blessingsEnabled ?? true,
        restoreArmyAfterLoss: oldCampaigns.get(record.key)?.settings.restoreArmyAfterLoss ?? true
      }
    } as ContentSetV2Document["campaigns"][number];
  });
}
