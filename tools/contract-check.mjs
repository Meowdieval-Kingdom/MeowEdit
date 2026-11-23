import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const contractDirectory = path.join(projectDirectory, "contract", "v2");
const schemaDirectory = path.join(contractDirectory, "schema");
const fixturesDirectory = path.join(contractDirectory, "fixtures");
const expectedHashPath = path.join(contractDirectory, "schema.sha256");

const schemaFiles = [
  "content-set-v2.schema.json",
  "game-capabilities.schema.json"
].sort();

function loadJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error("Invalid JSON in " + path.relative(projectDirectory, file) + ": " + error.message);
  }
}

function assertStrict(schema, label) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema")
    throw new Error(label + " is not a draft 2020-12 schema.");
  const visit = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.properties && node.additionalProperties !== false)
      throw new Error(at + " object has properties but does not close additionalProperties.");
    for (const [key, value] of Object.entries(node)) visit(value, at + "." + key);
  };
  visit(schema, label);
}

const schemas = schemaFiles.map(name => {
  const file = path.join(schemaDirectory, name);
  if (!existsSync(file)) throw new Error("Missing schema: " + name);
  const schema = loadJson(file);
  assertStrict(schema, name);
  return { name, contents: readFileSync(file, "utf8") };
});

const registryPath = path.join(contractDirectory, "registries.json");
// Git checks these files out with platform line endings; normalize so the authority hash is stable.
const normalize = text => text.replace(/\r\n/g, "\n");
const registryContents = normalize(readFileSync(registryPath, "utf8"));
const canonicalContract = [
  ...schemas.map(schema => schema.name + "\n" + normalize(schema.contents)),
  "registries.json\n" + registryContents
].join("");
const schemaHash = createHash("sha256").update(canonicalContract, "utf8").digest("hex");
if (!existsSync(expectedHashPath)) {
  throw new Error("Missing contract/v2/schema.sha256. Generate it with: npm run contract:check -- --write-hash");
}
const expected = readFileSync(expectedHashPath, "utf8").trim();
if (expected !== schemaHash)
  throw new Error("Schema hash mismatch: expected " + expected + ", got " + schemaHash + ". Regenerate schema.sha256 when the contract changes.");

// The sibling Kingdom checkout is only available locally. CI verifies the
// checked-in schema.sha256 above and explicitly skips this cross-repo guard.
if (process.env.MEOWEDIT_SKIP_AUTHORITY_DOC === "1") {
  console.log("Authority doc cross-check skipped (MEOWEDIT_SKIP_AUTHORITY_DOC=1); schema.sha256 is still enforced.");
} else {
  const contractDocPath = path.resolve(projectDirectory, "..", "MeowdievalKingdom", "Docs", "WIP", "MeowEdit-Content-Contract-V2.md");
  if (!existsSync(contractDocPath))
    throw new Error("Could not find the authority contract doc at " + contractDocPath + ".");
  const authorityMatch = /\*\*Contract hash \(§9\.5\):\*\*\s*`([a-f0-9]{64})`/.exec(readFileSync(contractDocPath, "utf8"));
  if (!authorityMatch)
    throw new Error("The authority contract doc has no contract hash in its status header.");
  if (authorityMatch[1] !== schemaHash)
    throw new Error("Authority hash mismatch: doc says " + authorityMatch[1] + ", local contract hashes to " + schemaHash + ".");
}

const fixtureFiles = [
  ...readdirSync(fixturesDirectory).filter(name => name.endsWith(".json")).map(name => path.join(fixturesDirectory, name)),
  ...readdirSync(path.join(fixturesDirectory, "patches")).filter(name => name.endsWith(".json")).map(name => path.join(fixturesDirectory, "patches", name))
];
for (const file of fixtureFiles) loadJson(file);

const registries = loadJson(path.join(contractDirectory, "registries.json"));
if (registries.schemaVersion !== 2 || !Array.isArray(registries.triggers)
  || !Array.isArray(registries.conditions) || !Array.isArray(registries.actions))
  throw new Error("contract/v2/registries.json is incomplete.");

const capabilities = loadJson(path.join(projectDirectory, "public", "game-capabilities.json"));
if (capabilities.schemaVersions?.[0] !== 2)
  throw new Error("public/game-capabilities.json does not declare schema version 2.");

console.log("Contract check OK: " + schemas.length + " schemas (sha256 " + schemaHash.slice(0, 12) + "), "
  + fixtureFiles.length + " fixtures, " + registries.triggers.length + " triggers, "
  + registries.conditions.length + " conditions, " + registries.actions.length + " actions.");
