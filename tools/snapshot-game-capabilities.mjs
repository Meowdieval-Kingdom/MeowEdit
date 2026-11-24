import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const defaultGameRoot = path.resolve(projectDirectory, "..", "MeowdievalKingdom");
const gameRootIndex = process.argv.indexOf("--game-root");
const gameRoot = path.resolve(gameRootIndex >= 0 ? process.argv[gameRootIndex + 1] ?? "" : defaultGameRoot);
const outputIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] ?? "" : path.join(projectDirectory, "public", "game-capabilities.json"));

const registryPath = path.join(projectDirectory, "contract", "content", "registries.json");
const catalogPath = path.join(projectDirectory, "public", "army-catalog.json");
const rosterPath = path.join(projectDirectory, "public", "unit-roster.json");

function readJson(file) {
  if (!existsSync(file)) throw new Error("Could not find " + file + ". Generate it first (see tools/README.md).");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error("Could not parse " + file + ": " + error.message);
  }
}

// The canonical §7 vocabularies live in registries.json; generated artifacts supply only the ids.
const registries = readJson(registryPath);
const catalog = readJson(catalogPath);
const roster = readJson(rosterPath);

// §6: appVersion is Unity PlayerSettings.bundleVersion (Application.version). ProjectVersion.txt
// holds the Unity editor version and must never be used here.
function appVersionFor(root) {
  const settingsFile = path.join(root, "ProjectSettings", "ProjectSettings.asset");
  if (!existsSync(settingsFile))
    throw new Error("Could not find " + settingsFile + ". Use --game-root <MeowdievalKingdom path>.");
  const match = readFileSync(settingsFile, "utf8").match(/^\s*bundleVersion:\s*(\S+)\s*$/m);
  if (!match)
    throw new Error("ProjectSettings.asset has no bundleVersion; cannot generate appVersion.");
  return match[1];
}

const rawBuildNumber = (process.env.MEOWDIEVAL_BUILD_NUMBER ?? "").trim();
const buildNumber = /^\d+$/.test(rawBuildNumber) ? Number(rawBuildNumber) : 0;

const internalTriggers = new Set(registries.internalTriggers ?? []);
const triggers = [...new Set(registries.triggers ?? [])].filter(trigger => !internalTriggers.has(trigger));
const actions = (registries.actions ?? []).map(action => action.kind);
const conditions = (registries.conditions ?? []).map(condition => condition.kind);

// §6: parameters are descriptors { type, values?, required? } emitted from registries.json so
// enum allowed values travel with the manifest instead of being lost in a flat type map.
const parameters = {};
for (const entry of [...(registries.actions ?? []), ...(registries.conditions ?? [])]) {
  for (const parameter of entry.parameters ?? []) {
    const descriptor = { type: parameter.type };
    if (Array.isArray(parameter.values)) descriptor.values = parameter.values;
    if (parameter.enumRef && Array.isArray(registries.enums?.[parameter.enumRef]))
      descriptor.values = registries.enums[parameter.enumRef];
    if (parameter.required) descriptor.required = true;
    parameters[entry.kind + "." + parameter.key] = descriptor;
  }
}

const requiredFeatures = ["timed-quests", "decision-outcomes", "blessing-effects"];
const features = [...new Set([...requiredFeatures, ...(registries.features ?? [])])];

function idList(entries) {
  return (entries ?? []).map(entry => typeof entry === "string" ? entry : entry?.id)
    .filter(id => typeof id === "string" && id.length > 0);
}
function sortedIds(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const ids = {
  // Authored content references specific unit LEVELS (e.g. Peasants/Fighter/2),
  // not just catalog roots, so publish every resolved level ID as a valid unit id.
  units: sortedIds([
    ...idList(catalog.units),
    ...catalog.units.flatMap(unit => (unit.levels ?? []).map(level => level.id)),
    ...idList(roster.units)
  ]),
  blessings: sortedIds(idList(catalog.blessings)),
  curses: sortedIds(idList(catalog.curses)),
  spells: sortedIds(idList(catalog.spells)),
  factions: sortedIds(idList(catalog.factions))
};

const requiredEnums = ["nodeKind", "objectiveKind", "shopPoolKind", "floorMode", "rewardKind", "shopOfferKind", "faction"];
const enums = Object.fromEntries(requiredEnums.map(name => [name, registries.enums?.[name] ?? []]));

if (!triggers.length || !actions.length || !conditions.length || !Object.keys(parameters).length
    || Object.values(ids).some(list => !list.length)
    || Object.values(enums).some(list => !list.length)) {
  throw new Error("The capability snapshot is incomplete; registries and generated catalogs must be populated.");
}
if (triggers.some(trigger => internalTriggers.has(trigger))) {
  throw new Error("Internal-only trigger leaked into the author-facing capability manifest.");
}

const manifest = {
  appVersion: appVersionFor(gameRoot),
  buildNumber,
  schemaVersions: [registries.schemaVersion ?? 2],
  triggers,
  actions,
  conditions,
  parameters,
  enums,
  features,
  limits: { maxAuthoredNodesPerFloor: registries.limits?.maxAuthoredNodesPerFloor ?? 30 },
  locales: registries.locales ?? ["en", "de"],
  ids
};

writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${triggers.length} triggers, ${actions.length} actions, ${conditions.length} conditions, `
  + `${Object.keys(parameters).length} parameters, and ${Object.values(ids).reduce((sum, list) => sum + list.length, 0)} ids to ${outputPath}.`);
