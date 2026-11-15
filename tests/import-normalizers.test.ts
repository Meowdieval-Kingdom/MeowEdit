import { describe, expect, it } from "vitest";
import { normalizeArmy, normalizeCampaign } from "../src/import-normalizers";

describe("army and campaign import normalization", () => {
  it("upgrades old army files and preserves per-placement spell IDs", () => {
    let id = 0;
    const makeId = (prefix: string) => prefix + "-" + ++id;
    const oldArmy = normalizeArmy({ id: "old-army", units: [{ unitId: "Cats/Fighter/1" }, { unitId: "Cats/Archer/1", x: 2 }] }, makeId);
    expect(oldArmy).toMatchObject({ id: "old-army", previewFloor: 1, spellIds: [], blessingIds: [] });
    expect(oldArmy.units).toEqual([
      { id: "army-unit-2", unitId: "Cats/Fighter/1", x: 0, y: 0, spellIds: [] },
      { id: "army-unit-3", unitId: "Cats/Archer/1", x: 2, y: 0, spellIds: [] }
    ]);
    const modern = normalizeArmy({ id: "new", _meowEditWorkspace: { key: "existing", previewFloor: 5, units: [{ id: "p1", unitId: "Cats/Fighter/2", x: 1, y: 2, spellIds: ["fireball"] }] } }, makeId);
    expect(modern).toMatchObject({ key: "army-import-4", previewFloor: 5, units: [{ id: "p1", spellIds: ["fireball"] }] });
  });

  it("normalizes standalone campaign envelopes and fills missing board settings", () => {
    const campaign = normalizeCampaign({
      format: "meowedit-campaign", _meowEditWorkspace: { key: "local-key", idAuto: true },
      campaign: { id: "imported", floors: [{ mode: "mixed", nodes: [{ kind: "Shop", label: "Market", x: 2, y: -1 }], routes: [{ fromNodeId: "shop", toNodeId: "start" }] }], settings: { battleShopEnabled: false } }
    }, prefix => prefix + "-fixture");
    expect(campaign).toMatchObject({ key: "local-key", id: "imported", idAuto: true, name: "imported" });
    expect(campaign.floors[0]).toMatchObject({ id: "floor-import-fixture", number: 1, mode: "mixed", questPoolMode: "campaign", randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 } });
    expect(campaign.floors[0].nodes[0]).toMatchObject({ id: "node-import-fixture", label: "Market", kind: "Shop", x: 2, y: -1, rewardAmount: 10 });
    expect(campaign.floors[0].routes[0]).toMatchObject({ id: "route-import-fixture", fromNodeId: "shop", toNodeId: "start", oneWay: false });
    expect(campaign.settings).toMatchObject({ startingLives: 3, battleShopEnabled: false, continueWithGeneratedFloors: false });
  });

  it("recognizes randomizer-only campaign imports and defaults omitted lists safely", () => {
    const campaign = normalizeCampaign({
      id: "randomizer-run",
      floors: [{ mode: "random", randomSettings: { nodeCount: 14, questNodeCount: 0, shopNodeCount: 2 } }],
      settings: { questNodeCountPerRandomFloor: 0 }
    }, prefix => prefix + "-fixture");
    expect(campaign.designMode).toBe("settings-only");
    expect(campaign.questIds).toEqual([]);
    expect(campaign.floors[0]).toMatchObject({
      id: "floor-import-fixture", number: 1, questPoolMode: "campaign", questPoolIds: [],
      randomSettings: { nodeCount: 14, questNodeCount: 0, shopNodeCount: 2 }, nodes: [], routes: []
    });
    expect(campaign.settings).toMatchObject({ startingLives: 3, startingSardines: 10, questNodeCountPerRandomFloor: 0 });
  });
});
