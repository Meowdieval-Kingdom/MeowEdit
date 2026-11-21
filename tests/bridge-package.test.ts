import { describe, expect, it } from "vitest";
import { createBridgePackagePayload } from "../src/bridge-package";
import { campaignFixture, rosterFixture, workspaceFixture } from "./fixtures";

describe("MeowEdit–Tactics Bridge package payload", () => {
  it("uses safe relative package paths and a deterministic canonical content hash", async () => {
    const workspace = workspaceFixture();
    const first = await createBridgePackagePayload("character-missions", workspace, rosterFixture);
    const second = await createBridgePackagePayload("character-missions", workspace, rosterFixture);

    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.files.map(file => file.path)).toContain("campaigns/Campaigns.json");
    expect(first.files.every(file => !file.path.startsWith("/") && !file.path.includes(".."))).toBe(true);
    expect(first.files.every(file => file.path.endsWith(".json"))).toBe(true);
    expect(first.files.some(file => file.path.endsWith("README.txt"))).toBe(false);
    expect(JSON.parse(first.files.find(file => file.path === "campaigns/Campaigns.json")!.content)
      .campaigns[0].id).toBe("test-campaign");
  });

  it("requires a campaign and a safe stable campaign-set ID", async () => {
    const workspace = workspaceFixture();
    await expect(createBridgePackagePayload("Invalid Set", workspace, rosterFixture)).rejects.toThrow("Campaign set ID");
    workspace.campaigns = [];
    await expect(createBridgePackagePayload("character-missions", workspace, rosterFixture)).rejects.toThrow("at least one campaign");
  });

  it("includes the complete campaign editor workspace as one bridge package", async () => {
    const workspace = workspaceFixture();
    workspace.campaigns = [campaignFixture()];
    const payload = await createBridgePackagePayload("test-set", workspace, rosterFixture);
    const manifest = JSON.parse(payload.files.find(file => file.path === "manifest.json")!.content);
    expect(manifest.campaignsIncluded).toBe(true);
    expect(payload.files.map(file => file.path)).toEqual(expect.arrayContaining([
      "manifest.json", "quests/Definitions.json", "armies/ArmyConfigurations.json",
      "campaigns/Campaigns.json", "extensions/meowedit-v1.json"
    ]));
  });
});
