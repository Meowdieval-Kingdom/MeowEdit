import { describe, expect, it } from "vitest";
import { normalizeArmy, normalizeMission, normalizeQuest } from "../src/editor/import-normalizers";

describe("content import normalization", () => {
  it("upgrades old army files and preserves per-placement spell IDs", () => {
    let id = 0;
    const makeId = (prefix: string) => prefix + "-" + ++id;
    const oldArmy = normalizeArmy({ id: "old-army", units: [{ unitId: "Peasants/Fighter/1" }, { unitId: "Nobles/Royal Archer/1", x: 2 }] }, makeId);
    expect(oldArmy).toMatchObject({ id: "old-army", previewFloor: 1, spellIds: [], blessingIds: [] });
    expect(oldArmy.units).toEqual([
      { id: "army-unit-2", unitId: "Peasants/Fighter/1", x: 0, y: 0, spellIds: [] },
      { id: "army-unit-3", unitId: "Nobles/Royal Archer/1", x: 2, y: 0, spellIds: [] }
    ]);
    const modern = normalizeArmy({ id: "new", _meowEditWorkspace: { key: "existing", previewFloor: 5, units: [{ id: "p1", unitId: "Peasants/Fighter/2", x: 1, y: 2, spellIds: ["fireball"] }] } }, makeId);
    expect(modern).toMatchObject({ key: "army-import-4", previewFloor: 5, units: [{ id: "p1", spellIds: ["fireball"] }] });
  });

  it("preserves Unity cell blessing pick fields in imported army configurations", () => {
    const army = normalizeArmy({ id: "cell-army", blessingIds: ["Blessing - Moonpath [Cell]"], CellBlessingPicks: [
      { RootId: "root-id", Lane: 2, Cells: [{ x: 1, y: 2 }], Locked: true, BaneCells: [{ x: 0, y: 0 }] }
    ] });
    expect(army.cellBlessingPicks).toEqual([{ rootId: "root-id", lane: 2, cells: [{ x: 1, y: 2 }], locked: true, baneCells: [{ x: 0, y: 0 }] }]);
  });

  it("preserves current quest extension fields when importing package definitions", () => {
    const quest = normalizeQuest({
      id: "timer-project",
      title: "Repair the bridge",
      objectiveKind: "Timer",
      meowEdit: {
        logicKind: "timer-project",
        dialogueLinks: { offer: "repair-offer", active: "", completion: "", failure: "" },
        timer: {
          decisionId: "repair-choice", payOutcomeId: "pay-now", waitOutcomeId: "wait",
          counterId: "battle-count", counterTarget: 3, paymentAmount: 15,
          paymentResource: "Sardines", countEvent: "any-battle-completed",
          completionEffects: [{ kind: "unlock-path", targetId: "shortcut", label: "Open shortcut" }]
        }
      }
    });
    expect(quest.extension).toMatchObject({
      logicKind: "timer-project",
      dialogueLinks: { offer: "repair-offer" },
      timer: {
        decisionId: "repair-choice", counterTarget: 3, paymentAmount: 15,
        completionEffects: [{ kind: "unlock-path", targetId: "shortcut" }]
      }
    });
  });

  it("normalizes standalone mission envelopes and fills missing board settings", () => {
    const mission = normalizeMission({
      format: "meowedit-mission", _meowEditWorkspace: { key: "local-key", idAuto: true },
      mission: { id: "imported", boardPreviewUnitId: "Peasants/Fighter/1", floors: [{ mode: "mixed", nodes: [{ kind: "Shop", label: "Market", x: 2, y: -1 }], routes: [{ fromNodeId: "shop", toNodeId: "start" }] }], settings: { battleShopEnabled: false } }
    }, prefix => prefix + "-fixture");
    expect(mission).toMatchObject({ key: "local-key", id: "imported", idAuto: true, name: "imported", boardPreviewUnitId: "Peasants/Fighter/1" });
    expect(mission.floors[0]).toMatchObject({ id: "floor-import-fixture", number: 1, mode: "mixed", questPoolMode: "mission", shopPoolMode: "mission", shopLevel: 1, randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 } });
    expect(mission.floors[0].nodes[0]).toMatchObject({ id: "node-import-fixture", label: "Market", kind: "Shop", x: 2, y: -1, rewardAmount: 10, shopOfferMode: "generated", shopOffers: [] });
    expect(mission.floors[0].routes[0]).toMatchObject({ id: "route-import-fixture", fromNodeId: "shop", toNodeId: "start", oneWay: false });
    expect(mission.settings).toMatchObject({ startingLives: 3, factionSelectionEnabled: true, battleShopEnabled: false, shopPoolKinds: ["Unit", "Blessing", "Research", "SpellUnlock"], continueWithGeneratedFloors: false });
    expect(mission.events).toEqual([]);

    expect(normalizeMission({ id: "old-mission", floors: [], settings: {} }).boardPreviewUnitId).toBe("");
    expect(normalizeMission({ id: "fixed-faction", floors: [], settings: { factionSelectionEnabled: false, playerFactionId: "Peasants" } }).settings)
      .toMatchObject({ factionSelectionEnabled: false, playerFactionId: "Peasants" });
  });

  it("normalizes mission event scopes while preserving unknown action data", () => {
    const mission = normalizeMission({
      id: "event-import",
      events: [{
        id: "battle-lineup", trigger: "before-battle", floorNumber: "2", nodeId: "boss-two",
        actions: [
          { kind: "replace-player-army", armyId: "boss-party" },
          { kind: "grant-token", tokenId: "north-route", payload: { amount: 1 } }
        ]
      }],
      floors: [], settings: {}
    });
    expect(mission.events).toEqual([{
      id: "battle-lineup", trigger: "before-battle", floorNumber: 2, nodeId: "boss-two",
      actions: [
        { kind: "replace-player-army", armyId: "boss-party" },
        { kind: "grant-token", tokenId: "north-route", payload: { amount: 1 } }
      ]
    }]);
  });

  it("recognizes randomizer-only mission imports and defaults omitted lists safely", () => {
    const mission = normalizeMission({
      id: "randomizer-run",
      floors: [{ mode: "random", randomSettings: { nodeCount: 14, questNodeCount: 0, shopNodeCount: 2 } }],
      settings: { questNodeCountPerRandomFloor: 0 }
    }, prefix => prefix + "-fixture");
    expect(mission.designMode).toBe("settings-only");
    expect(mission.questIds).toEqual([]);
    expect(mission.floors[0]).toMatchObject({
      id: "floor-import-fixture", number: 1, questPoolMode: "mission", questPoolIds: [],
      randomSettings: { nodeCount: 14, questNodeCount: 0, shopNodeCount: 2 }, nodes: [], routes: []
    });
    expect(mission.settings).toMatchObject({ startingLives: 3, startingSardines: 10, questNodeCountPerRandomFloor: 0 });
  });
});
