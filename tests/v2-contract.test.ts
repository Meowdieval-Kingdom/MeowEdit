import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSetRequest, publishRequest, saveDraftRequest, ENDPOINT_SCHEMA_VERSION
} from "../src/v2/endpoints";
import { packContentSet } from "../src/v2/packer";
import {
  ACTIONS, CONDITIONS, TRIGGERS, findAction, findCondition, isAuthorSelectableTrigger,
  isInternalTrigger, isKnownTrigger, parameterErrors
} from "../src/v2/registries";
import type { ContentSetV2Document, GameCapabilities } from "../src/v2/types";
import { validateContentSet } from "../src/v2/validation";

const fixtureDirectory = path.resolve(process.cwd(), "contract/v2/fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureDirectory, name), "utf8"));
}

const capabilities = fixture("capabilities.fixture.json") as GameCapabilities;
const validSet = fixture("valid-set.fixture.json") as ContentSetV2Document;

function resolvePath(root: unknown, dotted: string): { parent: Record<string, unknown>; key: string } {
  const parts = dotted.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cursor = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  return { parent: cursor, key: parts.at(-1)! };
}

function patched(patchName: string): unknown {
  const patch = JSON.parse(readFileSync(path.join(fixtureDirectory, "patches", patchName), "utf8")) as {
    op: "set" | "merge"; path: string; value: unknown
  };
  const result = structuredClone(validSet) as unknown;
  const { parent, key } = resolvePath(result, patch.path);
  if (patch.op === "set") parent[key] = patch.value;
  else parent[key] = { ...(parent[key] as object), ...(patch.value as object) };
  return result;
}

describe("v2 contract fixtures", () => {
  it("accepts the hand-authored valid set", () => {
    expect(validateContentSet(validSet, capabilities).valid).toBe(true);
  });

  it.each([
    ["invalid-additional-key.json", "Unrecognized key"],
    ["invalid-numeric-enum.json", "Invalid option"],
    ["invalid-broken-ref.json", "unresolved reference"],
    ["invalid-unknown-trigger.json", "Invalid option"],
    ["invalid-unknown-action.json", "Invalid option"],
    ["invalid-unknown-parameter.json", "unknown parameter key"],
    ["invalid-condition-key.json", "Invalid option"],
    ["invalid-condition-type.json", "wrong value type"],
    ["invalid-condition-enum.json", "enum(nodeKind)"],
    ["invalid-condition-null.json", "require value: null"]
  ])("rejects %s", (file, expected) => {
    const result = validateContentSet(patched(file), capabilities);
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join(" ")).toContain(expected);
  });

  it("enforces the authored-node limit from the capability manifest", () => {
    const limited: GameCapabilities = { ...capabilities, limits: { maxAuthoredNodesPerFloor: 1 } };
    const result = validateContentSet(validSet, limited);
    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.message.includes("limit is 1"))).toBe(true);
  });

  it("covers every registry trigger, condition and action parameter", () => {
    for (const trigger of TRIGGERS) expect(isKnownTrigger(trigger)).toBe(true);
    expect(isInternalTrigger("node-cleared")).toBe(true);
    expect(isKnownTrigger("node-cleared")).toBe(true);
    expect(isAuthorSelectableTrigger("node-cleared")).toBe(false);
    expect(isAuthorSelectableTrigger("campaign-start")).toBe(true);

    const internal = structuredClone(validSet) as ContentSetV2Document;
    internal.campaigns[0].events[0].trigger = "node-cleared";
    expect(validateContentSet(internal, capabilities).valid).toBe(true);

    for (const condition of CONDITIONS) {
      const valid = condition.parameters.map(parameter => ({
        key: parameter.key,
        value: parameter.type === "int" ? 1
          : parameter.type === "NamedRef" ? { id: "guards", label: { default: "Guards", locales: {} } }
            : parameter.type === "enum"
              ? capabilities.enums[parameter.enumRef as keyof typeof capabilities.enums][0]
              : "outcome-1"
      }));
      expect(parameterErrors(condition, valid, capabilities.enums)).toEqual([]);
      expect(parameterErrors(condition, [{ key: "bogus", value: "x" }], capabilities.enums)).toContain("unknown parameter key 'bogus'");
    }
    for (const action of ACTIONS) {
      const valid = action.parameters.map(parameter => ({
        key: parameter.key,
        value: parameter.type === "int" ? 1
          : parameter.type === "NamedRef" ? { id: "guards", label: { default: "Guards", locales: {} } }
            : parameter.type === "NamedRef[]" ? [{ id: "guards", label: { default: "Guards", locales: {} } }]
              : parameter.type === "enum" ? parameter.values?.[0] : "value"
      }));
      expect(parameterErrors(action, valid, capabilities.enums)).toEqual([]);
      expect(parameterErrors(action, [{ key: "bogus", value: "x" }], capabilities.enums)).toContain("unknown parameter key 'bogus'");
    }
  });

  it("includes after-battle as an author-selectable migration trigger", () => {
    expect(isKnownTrigger("after-battle")).toBe(true);
    expect(isAuthorSelectableTrigger("after-battle")).toBe(true);
    expect(TRIGGERS).toContain("after-battle");
    expect(TRIGGERS).toHaveLength(31);
    const generated = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/game-capabilities.json"), "utf8")) as GameCapabilities;
    expect(generated.triggers).toContain("after-battle");
    expect(generated.triggers).not.toContain("node-cleared");
  });

  it("compares all registry whitelists with exact ordinal casing", () => {
    expect(isKnownTrigger("CAMPAIGN-START")).toBe(false);
    expect(isKnownTrigger("campaign-start")).toBe(true);
    expect(findAction("Dialogue")).toBeUndefined();
    expect(findAction("dialogue")).toBeDefined();
    expect(findCondition("Floor-N")).toBeUndefined();
    expect(findCondition("floor-n")).toBeDefined();

    const wrongCase = structuredClone(validSet) as ContentSetV2Document;
    wrongCase.campaigns[0].events[0].trigger = "Campaign-Start";
    expect(validateContentSet(wrongCase, capabilities).valid).toBe(false);
  });

  it("generates the closed runtime file set and a stable canonical hash", async () => {
    const packed = await packContentSet(validSet, capabilities);
    expect(packed.files.map(file => file.path)).toEqual([
      "armies/ArmyConfigurations.json",
      "campaigns/Campaigns.json",
      "dialogues/elder-intro.json",
      "extensions/meowedit-v1.json",
      "manifest.json",
      "quests/Definitions.json",
      "set.json"
    ]);
    expect(packed.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(packed.packageId).toBe("test-set-" + packed.contentHash.slice(0, 16));
    expect(JSON.parse(packed.files.find(file => file.path === "manifest.json")!.content)).toMatchObject({
      format: "meowdieval-content-package", packageVersion: 2, setId: "test-set"
    });
    const again = await packContentSet(validSet, capabilities);
    expect(again.contentHash).toBe(packed.contentHash);
  });

  it("builds versioned endpoint payloads", () => {
    expect(createSetRequest("test-set", validSet)).toMatchObject({ schemaVersion: ENDPOINT_SCHEMA_VERSION, setId: "test-set" });
    expect(saveDraftRequest(2, validSet)).toMatchObject({ schemaVersion: 2, expectedDraftVersion: 2 });
    expect(publishRequest(3)).toEqual({ schemaVersion: 2, expectedDraftVersion: 3 });
  });

  it("keeps every checked-in invalid patch meaningful", () => {
    const patches = readdirSync(path.join(fixtureDirectory, "patches"));
    expect(patches.length).toBeGreaterThanOrEqual(7);
    for (const patch of patches) expect(validateContentSet(patched(patch), capabilities).valid).toBe(false);
  });
});
