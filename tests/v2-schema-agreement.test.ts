import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { contentSetV2Schema, gameCapabilitiesSchema } from "../src/v2/zod";

const contractDirectory = path.resolve(process.cwd(), "contract/v2");
const schemaDirectory = path.join(contractDirectory, "schema");
const fixtureDirectory = path.join(contractDirectory, "fixtures");

function json(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const contentSchema = json(path.join(schemaDirectory, "content-set-v2.schema.json")) as object;
const capabilitiesSchema = json(path.join(schemaDirectory, "game-capabilities.schema.json")) as object;
const validateContentJson = ajv.compile(contentSchema);
const validateCapabilitiesJson = ajv.compile(capabilitiesSchema);

const validSet = json(path.join(fixtureDirectory, "valid-set.fixture.json"));
const capabilitiesFixture = json(path.join(fixtureDirectory, "capabilities.fixture.json"));
const generatedCapabilities = json(path.resolve(process.cwd(), "public/game-capabilities.json"));

/** True when both the JSON Schema and the zod schema accept the value. */
function agreed(value: unknown): { jsonSchema: boolean; zod: boolean } {
  return {
    jsonSchema: validateContentJson(value) === true,
    zod: contentSetV2Schema.safeParse(value).success
  };
}

describe("JSON Schema / zod agreement (§9.2)", () => {
  it("accepts the valid hand-authored set in both validators", () => {
    expect(agreed(validSet)).toEqual({ jsonSchema: true, zod: true });
  });

  it("accepts the generated capability manifest in both validators", () => {
    expect(validateCapabilitiesJson(generatedCapabilities)).toBe(true);
    expect(gameCapabilitiesSchema.safeParse(generatedCapabilities).success).toBe(true);
  });

  it("accepts the capability fixture in both validators", () => {
    expect(validateCapabilitiesJson(capabilitiesFixture)).toBe(true);
    expect(gameCapabilitiesSchema.safeParse(capabilitiesFixture).success).toBe(true);
  });

  it.each([
    "invalid-additional-key.json",
    "invalid-numeric-enum.json",
    "invalid-unknown-trigger.json",
    "invalid-unknown-action.json",
    "invalid-condition-key.json"
  ])("rejects %s in both validators", patchName => {
    const patch = json(path.join(fixtureDirectory, "patches", patchName)) as {
      op: "set" | "merge"; path: string; value: unknown
    };
    const candidate = structuredClone(validSet) as Record<string, unknown>;
    const parts = patch.path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let cursor = candidate;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
    const key = parts.at(-1)!;
    if (patch.op === "set") cursor[key] = patch.value;
    else cursor[key] = { ...(cursor[key] as object), ...(patch.value as object) };
    const result = agreed(candidate);
    expect(result).toEqual({ jsonSchema: false, zod: false });
  });
});
