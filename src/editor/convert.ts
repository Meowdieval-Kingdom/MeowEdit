import { localized, namedRef } from "../content/factory";
import type {
  MissionEvent,
  ContentSetDocument,
  DialogueDecision,
  DialogueSpeedSetting,
  GameCapabilities
} from "../content/types";
import {
  emptyQuestExtension,
  type AdventureQuestDefinition,
  type ArmyRecord,
  type MissionRecord,
  type DialogueNode,
  type DialogueRecord,
  type QuestRecord,
  type Workspace
} from "./model";

/**
 * One-way conversion at the cloud boundary only. The editor itself uses native
 * editor records, so Drawflow positions, editor labels and placement IDs stay intact.
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

function toContentSpeed(value: string, base: number): number {
  return value === "fast" ? base * 1.5 : value === "slow" ? base * 0.5 : base;
}

function speedFromDoc(value: DialogueSpeedSetting | undefined): DialogueSpeedSetting | undefined {
  if (!value) return undefined;
  return {
    ...(typeof value.preset === "string" ? { preset: value.preset } : {}),
    ...(typeof value.charactersPerSecond === "number" ? { charactersPerSecond: value.charactersPerSecond } : {}),
    ...(Array.isArray(value.cadence) ? { cadence: structuredClone(value.cadence) } : {})
  };
}

function speedToDoc(value: DialogueSpeedSetting | undefined): DialogueSpeedSetting | undefined {
  if (!value) return undefined;
  return {
    ...(typeof value.preset === "string" && value.preset ? { preset: value.preset } : {}),
    ...(typeof value.charactersPerSecond === "number" && value.charactersPerSecond > 0
      ? { charactersPerSecond: value.charactersPerSecond } : {}),
    ...(Array.isArray(value.cadence) ? { cadence: structuredClone(value.cadence) } : {})
  };
}

/** Converts the authoritative structured draft into the shape the editor screens render. */
export function draftToWorkspace(
  draft: ContentSetDocument,
  capabilities: GameCapabilities,
  selected?: { section: string; index: number }
): Workspace {
  const dialogues: DialogueRecord[] = draft.dialogues.map(doc => {
    return {
      key: doc.sequenceId, sequenceIdAuto: true,
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
            originalTextSpeed: node.textSpeed,
            speakers: node.speakers.map(speaker => ({
              id: speaker.id, unitId: ref(speaker.unitId), displayName: text(speaker.displayName),
              side: speaker.side === "right" ? "right" as const : "left" as const, mood: speaker.mood,
              ...(speedFromDoc(speaker.defaultSpeed) ? { defaultSpeed: speedFromDoc(speaker.defaultSpeed) } : {}),
              ...(speaker.defaultFace ? { defaultFace: speaker.defaultFace } : {}),
              ...(speaker.defaultIdleAnim ? { defaultIdleAnim: speaker.defaultIdleAnim } : {})
            })),
            segments: node.segments.map(segment => ({
              speakerIds: [...segment.speakerIds], text: text(segment.text),
              ...(speedFromDoc(segment.speed) ? { speed: speedFromDoc(segment.speed) } : {}),
              ...(segment.face ? { face: segment.face } : {}),
              ...(segment.anim ? { anim: segment.anim } : {}),
              ...(segment.idleAnim ? { idleAnim: segment.idleAnim } : {})
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
      autoAccept: doc.autoAccept === true,
      rewardKind: doc.rewardKind ?? capabilities.enums.rewardKind[0] ?? "Sardines",
      rewardAmount: doc.rewardAmount ?? 0, rewardContentId: ref(doc.rewardContentId),
      ...(speedFromDoc(doc.speakerSpeed) ? { speakerSpeed: speedFromDoc(doc.speakerSpeed) } : {}),
      ...(doc.speakerFace ? { speakerFace: doc.speakerFace } : {}),
      ...(doc.speakerIdleAnim ? { speakerIdleAnim: doc.speakerIdleAnim } : {})
    };
    return {
      key: doc.id, idAuto: true, definition,
      extraDialogueLinks: {
        offer: (ext.dialogueLinks?.offer ?? []).map(item => item.id).filter(Boolean),
        active: (ext.dialogueLinks?.active ?? []).map(item => item.id).filter(Boolean),
        completion: (ext.dialogueLinks?.completion ?? []).map(item => item.id).filter(Boolean),
        failure: (ext.dialogueLinks?.failure ?? []).map(item => item.id).filter(Boolean)
      },
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
      key: doc.id, id: doc.id, idAuto: true, name: text(doc.name), previewFloor: 1,
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

  const missions: MissionRecord[] = draft.missions.map(doc => ({
    key: doc.id, id: doc.id, idAuto: true, name: text(doc.name), description: text(doc.description),
    boardPreviewUnitId: ref(doc.boardPreviewUnitId),
    questIds: doc.questIds.map(item => item.id),
    floors: doc.floors.map(floor => ({
      id: floor.id, number: floor.number, mode: floor.mode as MissionRecord["floors"][number]["mode"],
      questPoolMode: floor.questPoolMode as "mission" | "custom", questPoolIds: floor.questPoolIds.map(item => item.id),
      shopPoolMode: floor.shopPoolMode as "mission" | "custom", shopPoolKinds: [...floor.shopPoolKinds] as MissionRecord["floors"][number]["shopPoolKinds"],
      shopLevel: floor.shopLevel, randomSettings: { ...floor.randomSettings },
      nodes: floor.nodes.map(node => ({
        id: node.id, label: text(node.label), kind: node.kind as MissionRecord["floors"][number]["nodes"][number]["kind"],
        x: node.x, y: node.y, armyId: ref(node.armyId), questId: ref(node.questId),
        enemyFactionId: ref(node.enemyFactionId), rewardKind: node.rewardKind as MissionRecord["floors"][number]["nodes"][number]["rewardKind"],
        rewardAmount: node.rewardAmount, rewardContentId: ref(node.rewardContentId),
        shopOfferMode: node.shopOfferMode === "exact" ? "exact" : "generated",
        shopOffers: node.shopOffers.map(offer => ({ kind: offer.kind as "Unit", contentId: ref(offer.contentId), price: offer.price }))
      })),
      routes: floor.routes.map(route => ({ id: route.id, fromNodeId: route.fromNodeId, toNodeId: route.toNodeId, oneWay: route.oneWay }))
    })),
    events: doc.events.map(event => ({
      id: event.id, trigger: event.trigger as MissionRecord["events"][number]["trigger"],
      ...(event.floorNumber !== undefined ? { floorNumber: event.floorNumber } : {}),
      ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      conditions: event.conditions?.map(condition => ({ ...condition })) ?? [],
      oneShot: event.oneShot,
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
      shopPoolKinds: [...doc.settings.shopPoolKinds] as MissionRecord["settings"]["shopPoolKinds"],
      questNodeCountPerRandomFloor: doc.settings.questNodeCountPerRandomFloor,
      shopNodeCountPerRandomFloor: doc.settings.shopNodeCountPerRandomFloor,
      nodeGrowthPerFloor: doc.settings.nodeGrowthPerFloor,
      continueWithGeneratedFloors: doc.settings.continueWithGeneratedFloors,
      sardinePayoutEnabled: doc.settings.sardinePayoutEnabled ?? true,
      sardinePayoutBase: doc.settings.sardinePayoutBase ?? 10,
      sardinePayoutPerFloor: doc.settings.sardinePayoutPerFloor ?? 1
    }
  }));

  const sections: Array<{ section: string; key?: string; type: Workspace["selectedType"] }> = [
    { section: "dialogues", key: selected?.section === "dialogues" ? dialogues[selected.index]?.key : undefined, type: "dialogue" },
    { section: "quests", key: selected?.section === "quests" ? quests[selected.index]?.key : undefined, type: "quest" },
    { section: "armies", key: selected?.section === "armies" ? armies[selected.index]?.key : undefined, type: "army" },
    { section: "missions", key: selected?.section === "missions" ? missions[selected.index]?.key : undefined, type: "mission" }
  ];
  const chosen = sections.find(item => item.key);
  const first = dialogues[0] ?? quests[0] ?? armies[0] ?? missions[0];
  const firstType: Workspace["selectedType"] = dialogues.length ? "dialogue" : quests.length ? "quest"
    : armies.length ? "army" : missions.length ? "mission" : null;
  const type = chosen?.type ?? firstType;
  const key = chosen?.key ?? first?.key ?? null;
  const activeNodeId = type === "dialogue"
    ? dialogues.find(item => item.key === key)?.sequence.startNodeId ?? null : null;
  return {
    schemaVersion: 1, dialogues, quests, armies, missions,
    selectedType: type, selectedKey: key, activeNodeId
  };
}

/** Writes all editor screen edits back into the authoritative structured draft, preserving structured-only fields. */
export function workspaceToDraft(
  draft: ContentSetDocument,
  workspace: Workspace,
  capabilities: GameCapabilities
): void {
  const firstUnit = capabilities.ids.units[0] ?? "unit";
  const firstFaction = capabilities.ids.factions[0] ?? "faction";
  const firstSpell = capabilities.ids.spells[0] ?? "spell";
  const firstBlessing = capabilities.ids.blessings[0] ?? "blessing";
  const firstArmy = workspace.armies[0]?.id ?? firstUnit;
  const firstQuest = workspace.quests[0]?.definition.id ?? firstArmy;
  const refTo = (id: string, fallback: string) => namedRef(id || fallback);
  const optional = (id: string) => id ? namedRef(id) : undefined;
  draft.dialogues = workspace.dialogues.map(record => {
    const sequence = record.sequence;
    const nodes = sequence.nodes.map(node => {
      const implicit = !node.actions.length;
      const actions = (implicit
        ? [{ label: node.continueLabel?.trim() || "Continue", targetNodeId: node.continueTargetNodeId ?? "", decision: undefined }]
        : node.actions).map(action => ({
        label: localized(action.label), targetNodeId: action.targetNodeId,
        meowEdit: {
          decision: action.decision && action.decision.id
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
        textSpeed: node.originalTextSpeed ?? toContentSpeed(String(node.textSpeed), sequence.defaultCharactersPerSecond),
        speakers: node.speakers.map(speaker => ({
          id: speaker.id, unitId: refTo(speaker.unitId, firstUnit), displayName: localized(speaker.displayName),
          side: speaker.side === "right" ? "right" : "left", mood: speaker.mood,
          ...(speedToDoc(speaker.defaultSpeed) ? { defaultSpeed: speedToDoc(speaker.defaultSpeed) } : {}),
          ...(speaker.defaultFace ? { defaultFace: speaker.defaultFace } : {}),
          ...(speaker.defaultIdleAnim ? { defaultIdleAnim: speaker.defaultIdleAnim } : {})
        })),
        segments: node.segments.map(segment => ({
          speakerIds: [...segment.speakerIds], text: localized(segment.text),
          ...(speedToDoc(segment.speed) ? { speed: speedToDoc(segment.speed) } : {}),
          ...(segment.face ? { face: segment.face } : {}),
          ...(segment.anim ? { anim: segment.anim } : {}),
          ...(segment.idleAnim ? { idleAnim: segment.idleAnim } : {})
        })),
        actions
      };
    });
    return {
      schemaVersion: 2, sequenceId: sequence.sequenceId, startNodeId: sequence.startNodeId,
      pauseMode: sequence.pauseMode, defaultCharactersPerSecond: sequence.defaultCharactersPerSecond, nodes
    } as ContentSetDocument["dialogues"][number] & Record<string, unknown> as ContentSetDocument["dialogues"][number];
  });

  draft.quests = workspace.quests.map(record => {
    const definition = record.definition;
    const ext = record.extension;
    const links = (slot: "offer" | "active" | "completion" | "failure", value: string) => {
      const ids = [...(record.extraDialogueLinks?.[slot] ?? []), ...(value ? [value] : [])]
        .filter((id, index, all) => id && all.indexOf(id) === index);
      return ids.map(id => namedRef(id));
    };
    return {
      schemaVersion: 2, id: definition.id, title: localized(definition.title),
      description: localized(definition.description), sourceKind: definition.sourceKind,
      sourceSlot: String(definition.sourceSlot ?? -1), firstFloor: definition.firstFloor,
      repeatEveryFloors: definition.repeatEveryFloors, priority: definition.priority,
      objectiveKind: definition.objectiveKind, targetNodeKind: definition.targetNodeKind,
      targetFloorOffset: definition.targetFloorOffset,
      ...(optional(definition.escortUnitId) ? { escortUnitId: optional(definition.escortUnitId) } : {}),
      ...(optional(definition.itemId) ? { itemId: optional(definition.itemId) } : {}),
      ...(optional(definition.speakerUnitId) ? { speakerUnitId: optional(definition.speakerUnitId) } : {}),
      speakerName: localized(definition.speakerName), offerText: localized(definition.offerText),
      activeText: localized(definition.activeText), acceptLabel: localized(definition.acceptLabel),
      declineLabel: localized(definition.declineLabel), autoAccept: definition.autoAccept,
      rewardKind: definition.rewardKind,
      rewardAmount: definition.rewardAmount,
      ...(optional(definition.rewardContentId) ? { rewardContentId: optional(definition.rewardContentId) } : {}),
      ...(speedToDoc(definition.speakerSpeed) ? { speakerSpeed: speedToDoc(definition.speakerSpeed) } : {}),
      ...(definition.speakerFace ? { speakerFace: definition.speakerFace } : {}),
      ...(definition.speakerIdleAnim ? { speakerIdleAnim: definition.speakerIdleAnim } : {}),
      meowEdit: {
        schemaVersion: 2,
        dialogueLinks: {
          offer: links("offer", ext.dialogueLinks.offer), active: links("active", ext.dialogueLinks.active),
          completion: links("completion", ext.dialogueLinks.completion), failure: links("failure", ext.dialogueLinks.failure)
        },
        logicKind: ext.logicKind,
        timer: {
          decisionId: refTo(ext.timer.decisionId, `decision-${definition.id}`),
          payOutcomeId: refTo(ext.timer.payOutcomeId, `outcome-pay-${definition.id}`),
          waitOutcomeId: refTo(ext.timer.waitOutcomeId, `outcome-wait-${definition.id}`),
          counterId: refTo(ext.timer.counterId, `counter-${definition.id}`),
          counterTarget: ext.timer.counterTarget, counterLabel: localized(ext.timer.counterLabel),
          countEvent: ext.timer.countEvent, paymentResource: "sardines",
          paymentAmount: ext.timer.paymentAmount, paymentCompletesImmediately: ext.timer.paymentCompletesImmediately,
          completionEffects: ext.timer.completionEffects.map(effect => ({
            kind: effect.kind, targetId: refTo(effect.targetId, firstQuest), label: localized(effect.label)
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
          floorOffset: target.floorOffset, armyId: refTo(target.armyId, firstArmy)
        })),
        killCount: ext.killCount ? {
          targetKind: ext.killCount.targetKind, targetId: refTo(ext.killCount.targetId, firstUnit), count: ext.killCount.count
        } : { targetKind: "unit", targetId: namedRef(capabilities.ids.units[0] ?? "unit"), count: 1 },
        minimumNodeDistances: ext.minimumNodeDistances.map(rule => ({
          id: rule.id, fromNodeKind: rule.fromNodeKind, toNodeKind: rule.toNodeKind, minimumHops: rule.minimumHops
        }))
      }
    } as ContentSetDocument["quests"][number];
  });

  draft.armies = workspace.armies.map(record => {
    return {
      schemaVersion: 2, id: record.id, name: localized(record.name),
      units: record.units.map(unit => ({
        unitId: refTo(unit.unitId, firstUnit), x: unit.x, y: unit.y,
        spellIds: unit.spellIds.map(id => refTo(id, firstSpell))
      })),
      spellIds: record.spellIds.map(id => refTo(id, firstSpell)),
      blessingIds: record.blessingIds.map(id => refTo(id, firstBlessing)),
      CellBlessingPicks: (record.cellBlessingPicks ?? []).map(pick => ({
        RootId: refTo(pick.rootId, firstBlessing), Lane: String(pick.lane),
        Cells: pick.cells as object[], Locked: pick.locked, BaneCells: pick.baneCells as object[]
      }))
    } as ContentSetDocument["armies"][number];
  });

  const oldMissions = new Map(draft.missions.map(doc => [doc.id, doc]));
  draft.missions = workspace.missions.map(record => {
    const events: MissionEvent[] = record.events.map(event => ({
      id: event.id, trigger: event.trigger,
      ...(event.floorNumber !== undefined ? { floorNumber: event.floorNumber } : {}),
      ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      conditions: (event.conditions ?? []).map(condition => ({
        key: condition.key, value: condition.value ?? null
      })),
      oneShot: (event.oneShot as MissionEvent["oneShot"]) ?? "per-run",
      actions: event.actions.map(action => ({
        kind: action.kind,
        parameters: Object.entries(action)
          .filter(([key]) => key !== "kind")
          .map(([key, value]) => key === "armyId"
            ? { key: "army", value: refTo(String(value ?? ""), firstArmy) }
            : { key, value })
      }))
    }));
    return {
      schemaVersion: 2, id: record.id, name: localized(record.name), description: localized(record.description),
      boardPreviewUnitId: refTo(record.boardPreviewUnitId ?? "", firstUnit),
      questIds: record.questIds.map(id => refTo(id, firstQuest)),
      floors: record.floors.map(floor => ({
        id: floor.id, number: floor.number, mode: floor.mode,
        questPoolMode: floor.questPoolMode, questPoolIds: floor.questPoolIds.map(id => refTo(id, firstQuest)),
        shopPoolMode: floor.shopPoolMode, shopPoolKinds: [...floor.shopPoolKinds], shopLevel: floor.shopLevel,
        randomSettings: { ...floor.randomSettings },
        nodes: floor.nodes.map(node => ({
          id: node.id, label: localized(node.label), kind: node.kind, x: node.x, y: node.y,
          armyId: refTo(node.armyId, firstArmy), questId: refTo(node.questId, firstQuest),
          enemyFactionId: refTo(node.enemyFactionId, firstFaction), rewardKind: node.rewardKind,
          rewardAmount: node.rewardAmount, rewardContentId: refTo(node.rewardContentId, firstQuest),
          shopOfferMode: node.shopOfferMode,
          shopOffers: node.shopOffers.map(offer => ({
            kind: offer.kind, contentId: refTo(offer.contentId, firstQuest), price: offer.price
          }))
        })),
        routes: floor.routes.map(route => ({ ...route }))
      })),
      events,
      settings: {
        startingLives: record.settings.startingLives, startingSardines: record.settings.startingSardines,
        startingNodeCount: record.settings.startingNodeCount,
        playerFactionId: refTo(record.settings.playerFactionId, firstFaction),
        factionSelectionEnabled: record.settings.factionSelectionEnabled,
        battleShopEnabled: record.settings.battleShopEnabled,
        shopPoolKinds: [...record.settings.shopPoolKinds],
        questNodeCountPerRandomFloor: record.settings.questNodeCountPerRandomFloor,
        shopNodeCountPerRandomFloor: record.settings.shopNodeCountPerRandomFloor,
        nodeGrowthPerFloor: record.settings.nodeGrowthPerFloor,
        continueWithGeneratedFloors: record.settings.continueWithGeneratedFloors,
        sardinePayoutEnabled: record.settings.sardinePayoutEnabled,
        sardinePayoutBase: record.settings.sardinePayoutBase,
        sardinePayoutPerFloor: record.settings.sardinePayoutPerFloor,
        blessingsEnabled: oldMissions.get(record.key)?.settings.blessingsEnabled ?? true,
        restoreArmyAfterLoss: oldMissions.get(record.key)?.settings.restoreArmyAfterLoss ?? true
      }
    } as ContentSetDocument["missions"][number];
  });
}
