import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const defaultGameRoot = path.resolve(projectDirectory, "..", "MeowdievalKingdom");
const gameRootIndex = process.argv.indexOf("--game-root");
const gameRoot = path.resolve(gameRootIndex >= 0 ? process.argv[gameRootIndex + 1] ?? "" : defaultGameRoot);
const outputIndex = process.argv.indexOf("--output");
const scriptableObjects = path.join(gameRoot, "Assets", "Meowdieval", "ScriptableObjects");
const factionDirectory = path.join(scriptableObjects, "Factions");
const unitDirectory = path.join(scriptableObjects, "UnitStats", "Resources");
const spellDirectory = path.join(scriptableObjects, "Spells");
const blessingDirectory = path.join(scriptableObjects, "Blessings");
const assetsDirectory = path.join(gameRoot, "Assets", "Meowdieval");
const scriptsDirectory = path.join(assetsDirectory, "Scripts", "Tactics");
const implementationDirectories = [
  "Spells", "MatchManagement/Blessings", "MatchManagement/Opponent", "Abilities", "Keywords", "AI"
];
const factionIds = ["Nobles", "Peasants", "HarborClaws", "CrystalCats", "WanderingTrader", "MagicCats", "Neutral"];
const factionLabels = new Map([
  ["Nobles", "Nobles"], ["Peasants", "Peasants"], ["HarborClaws", "Harbor Claws"],
  ["CrystalCats", "Crystal Cats"], ["WanderingTrader", "Wandering Trader"],
  ["MagicCats", "Arcane Academy"], ["Neutral", "Neutral"]
]);

for (const directory of [factionDirectory, unitDirectory, spellDirectory, blessingDirectory]) {
  if (!existsSync(directory)) {
    throw new Error("Could not find " + directory + ". Use --game-root <MeowdievalKingdom path>.");
  }
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function guidFor(assetPath) {
  const metaPath = assetPath + ".meta";
  if (!existsSync(metaPath)) return "";
  return readFileSync(metaPath, "utf8").match(/^guid: ([a-f0-9]+)/m)?.[1] ?? "";
}

function scalar(content, name) {
  const raw = content.match(new RegExp("^\\s*" + name + ":\\s*(.+?)\\s*$", "m"))?.[1] ?? "";
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\"/g, '"');
  return raw;
}

function yamlSection(content, name) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => new RegExp("^(\\s*)" + name + ":\\s*$").test(line));
  if (start < 0) return "";
  const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = start + 1;
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (!line.trim()) continue;
    if ((line.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
  }
  return lines.slice(start + 1, end).join("\n");
}

function yamlValue(content, name) {
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp("^(\\s*)" + name + ":\\s*(.*)$");
  const start = lines.findIndex(line => pattern.test(line));
  if (start < 0) return "";
  const match = lines[start].match(pattern);
  const indent = match?.[1].length ?? 0;
  const parts = [match?.[2] ?? ""];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if ((line.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
    parts.push(line.trim());
  }
  let raw = parts.join(" ").trim();
  if (raw.startsWith("'")) raw = raw.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
  else if (raw.startsWith('"')) raw = raw.replace(/^"/, "").replace(/"$/, "").replace(/\\\s+/g, "").replace(/\\"/g, '"');
  if (raw === "|" || raw === ">") return "";
  return raw;
}

function numberField(content, name) {
  const raw = yamlValue(content, name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function booleanField(content, name) {
  return ["1", "true"].includes(yamlValue(content, name).toLowerCase());
}

function serializedFields(content, indent) {
  const names = [...new Set(content.split(/\r?\n/)
    .map(line => line.match(new RegExp("^\\s{" + indent + "}(_[A-Za-z][A-Za-z0-9]*):"))?.[1])
    .filter(Boolean))];
  return Object.fromEntries(names.map(name => {
    const raw = yamlValue(content, name);
    const linked = raw.replace(/\{[^}]*guid: ([a-f0-9]{32})[^}]*\}/g, (_match, guid) => {
      const asset = assetsByGuid.get(guid);
      return asset ? "asset: " + scalar(readFileSync(asset, "utf8"), "m_Name") : "guid: " + guid;
    });
    const value = /^-?\d+(?:\.\d+)?$/.test(linked) ? Number(linked)
      : linked === "true" ? true : linked === "false" ? false : linked;
    return [name.replace(/^_/, "").replace(/[A-Z]/g, letter => letter.toLowerCase()), value];
  }));
}

const cellRules = ["None", "FrontRow", "BackRow", "OuterColumns", "Corners", "Centre", "NoAdjacentAlly", "PickedColumn", "MovingCell", "RandomCells"];
function enumName(values, raw) {
  const index = Number(raw);
  return Number.isInteger(index) ? values[index] ?? "Unknown" : "Unknown";
}

function linkedAbility(content, fieldName) {
  const guid = yamlValue(content, fieldName).match(/guid:\s*([a-f0-9]{32})/)?.[1];
  const assetPath = guid ? assetsByGuid.get(guid) : undefined;
  if (!assetPath) return undefined;
  const asset = readFileSync(assetPath, "utf8");
  const abilityData = yamlSection(asset, "AbilityData");
  return {
    id: scalar(asset, "m_Name"),
    name: yamlValue(abilityData, "_abilityName"),
    description: plainDescription(yamlValue(abilityData, "_description"))
  };
}

function rootPersistentId(content, visited = new Set()) {
  const currentPersistentId = yamlValue(content, "_persistentId");
  const parentGuid = yamlValue(content, "_supersedes").match(/guid:\s*([a-f0-9]{32})/)?.[1];
  if (!parentGuid || visited.has(parentGuid)) return currentPersistentId;
  visited.add(parentGuid);
  const parentPath = assetsByGuid.get(parentGuid);
  return parentPath ? rootPersistentId(readFileSync(parentPath, "utf8"), visited) : currentPersistentId;
}

function plainDescription(value) {
  return value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function previewImageFor(unitId) {
  const filename = unitId.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") + ".png";
  return existsSync(path.join(projectDirectory, "public", "avatars", filename))
    ? "./avatars/" + filename
    : undefined;
}

function referenceGuids(section) {
  return [...section.matchAll(/guid: ([a-f0-9]{32})/g)].map(match => match[1]);
}

const assetsByGuid = new Map();
for (const file of filesBelow(assetsDirectory).filter(file => file.endsWith(".asset") || file.endsWith(".prefab"))) {
  const guid = guidFor(file);
  if (guid) assetsByGuid.set(guid, file);
}

function prefabFootprint(guid, visited = new Set()) {
  if (!guid || visited.has(guid)) return { width: 1, height: 1 };
  visited.add(guid);
  const assetPath = assetsByGuid.get(guid);
  if (!assetPath || !assetPath.endsWith(".prefab")) return { width: 1, height: 1 };
  const source = readFileSync(assetPath, "utf8");
  const footprint = source.match(/_gridSize:\s*\{x:\s*(\d+),\s*y:\s*(\d+)\}/);
  if (footprint) return { width: Math.max(1, Number(footprint[1])), height: Math.max(1, Number(footprint[2])) };
  const parentGuid = source.match(/m_SourcePrefab:\s*\{[^}]*guid:\s*([a-f0-9]{32})/)?.[1];
  return parentGuid ? prefabFootprint(parentGuid, visited) : { width: 1, height: 1 };
}

const units = [];
const buildings = [];
const seen = new Set();
const factionsById = new Map();

function addUnit(assetPath, level, rootId, rootType, visited = new Set()) {
  const guid = guidFor(assetPath);
  if (!guid || visited.has(guid)) return;
  visited.add(guid);

  const source = readFileSync(assetPath, "utf8");
  const stats = source.match(/^  _unitStats:\s*([\s\S]*?)(?=^  _[A-Za-z])/m)?.[1] ?? source;
  const identity = yamlSection(stats, "Identity");
  const combat = yamlSection(stats, "Combat");
  const unitName = yamlValue(identity, "UnitName");
  const factionIndex = Number(yamlValue(identity, "Faction"));
  const factionId = factionIds[factionIndex];
  const type = yamlValue(identity, "Type") === "1" ? "building" : "unit";
  if (!unitName || !factionId) return;

  const id = factionId + "/" + unitName + "/" + level;
  const resolvedRootId = rootId ?? id;
  const resolvedRootType = rootType ?? type;
  const rootEntries = resolvedRootType === "unit" ? units : buildings;
  let entry = seen.has(resolvedRootId)
    ? rootEntries.find(candidate => candidate.id === resolvedRootId)
    : undefined;
  if (!entry) {
    entry = { id: resolvedRootId, name: unitName, factionId, faction: factionLabels.get(factionId) ?? factionId, levels: [] };
    rootEntries.push(entry);
    seen.add(resolvedRootId);
  }
  const prefabGuid = identity.match(/UnitPrefab:\s*\{[^}]*guid:\s*([a-f0-9]{32})/)?.[1];
  const statNames = ["MaxHealth", "MaxMana", "ManaRegen", "AttackDamage", "AttackSpeed", "AttackRange", "MinAttackRange", "CritChance", "SpellPower", "ArmorResist", "MagicResist", "MovementSpeed"];
  const statKeys = { MaxHealth: "maxHealth", MaxMana: "maxMana", ManaRegen: "manaRegen", AttackDamage: "attackDamage", AttackSpeed: "attackSpeed", AttackRange: "attackRange", MinAttackRange: "minAttackRange", CritChance: "critChance", SpellPower: "spellPower", ArmorResist: "armorResist", MagicResist: "magicResist", MovementSpeed: "movementSpeed" };
  const combatStats = Object.fromEntries(statNames.map(name => [statKeys[name], numberField(combat, name)]).filter(([, value]) => value !== undefined));
  entry.levels.push({
    id, name: unitName, level,
    description: plainDescription(yamlValue(identity, "Description")),
    tier: numberField(identity, "Tier"),
    previewImage: resolvedRootType === "unit" ? previewImageFor(id) : undefined,
    footprint: prefabFootprint(prefabGuid),
    stats: combatStats
  });

  const nextStatsGuid = stats.match(/NextLevelStats:\s*\{[^}]*guid: ([a-f0-9]{32})/)?.[1];
  const nextOptionsSection = stats.match(/NextLevelOptions:([\s\S]*?)(?=\n\s*Identity:|$)/)?.[1] ?? "";
  const nextGuids = [nextStatsGuid, ...referenceGuids(nextOptionsSection)].filter(Boolean);
  for (const nextGuid of new Set(nextGuids)) {
    const nextPath = assetsByGuid.get(nextGuid);
    if (!nextPath) continue;
    addUnit(nextPath, level + 1, resolvedRootId, resolvedRootType, new Set(visited));
  }
}

for (const factionPath of filesBelow(factionDirectory).filter(file => file.endsWith(".asset"))) {
  const source = readFileSync(factionPath, "utf8");
  const factionIndex = Number(scalar(source, "Faction"));
  const factionId = factionIds[factionIndex];
  const factionName = scalar(source, "FactionName");
  if (!factionId) continue;
  factionsById.set(factionId, factionName || factionLabels.get(factionId) || factionId);
  const available = source.match(/_availableUnits:\s*([\s\S]*?)(?=\n\s*_[A-Za-z])/m)?.[1] ?? "";
  for (const guid of referenceGuids(available)) {
    const assetPath = assetsByGuid.get(guid);
    if (!assetPath) throw new Error("Could not resolve unit root " + guid + " from " + factionPath);
    const root = readFileSync(assetPath, "utf8");
    const identity = root.match(/Identity:\s*([\s\S]*?)(?=\n\s*Combat:|$)/)?.[1] ?? root;
    const unitName = scalar(identity, "UnitName");
    if (!unitName) continue;
    const rootId = factionId + "/" + unitName + "/1";
    addUnit(assetPath, 1, rootId, null);
  }
}

function abilityEntries(directory, allowedGuids = null, include = () => true) {
  const entries = [];
  for (const file of filesBelow(directory).filter(file => file.endsWith(".asset"))) {
    const guid = guidFor(file);
    if (allowedGuids && !allowedGuids.has(guid)) continue;
    const content = readFileSync(file, "utf8");
    const id = scalar(content, "m_Name");
    const abilityData = yamlSection(content, "AbilityData");
    const name = yamlValue(abilityData, "_abilityName");
    const classIdentifier = scalar(content, "m_EditorClassIdentifier");
    if (!id || !name || !include(content, classIdentifier)) continue;
    const level = /\bIII\b/.test(id) ? 3 : /\bII\b/.test(id) ? 2 : 1;
    const isCell = classIdentifier.endsWith(".CellBlessing");
    const isEconomy = classIdentifier.endsWith(".EconomyBlessing");
    const isGridExpansion = classIdentifier.endsWith(".GridExpansionBlessing");
    const family = isCell ? "cell" : isEconomy ? "economy" : isGridExpansion ? "grid" : "stat";
    const mechanics = {
      class: classIdentifier.split(".").at(-1) ?? "",
      abilityData: serializedFields(abilityData, 4),
      assetData: serializedFields(content, 2),
      persistentId: yamlValue(content, "_persistentId"),
      rootPersistentId: rootPersistentId(content),
      isCurse: booleanField(content, "_isCurse"),
      isAdventureOnly: booleanField(content, "_adventureOnly") || (numberField(content, "_curseExtraLives") ?? 0) > 0
    };
    if (isGridExpansion) mechanics.effect = enumName(["None", "AddColumn", "AddRow"], yamlValue(content, "_effect"));
    if (isCell) {
      mechanics.rule = enumName(cellRules, yamlValue(content, "_rule"));
      mechanics.rangedOnly = booleanField(content, "_rangedOnly");
      mechanics.cellCount = numberField(content, "_cellCount") ?? 1;
      mechanics.effect = linkedAbility(content, "_effect");
      mechanics.baneRule = enumName(cellRules, yamlValue(content, "_baneRule"));
      mechanics.baneCellCount = numberField(content, "_baneCellCount") ?? 1;
      mechanics.baneEffect = linkedAbility(content, "_baneEffect");
    }
    entries.push({
      id, name, level, description: plainDescription(yamlValue(abilityData, "_description")),
      family,
      isCurse: mechanics.isCurse,
      isAdventureOnly: mechanics.isAdventureOnly,
      tier: numberField(content, "_tier"),
      manaCost: numberField(abilityData, "_manaCost"),
      coinCost: numberField(abilityData, "_coinCost"),
      healthCost: numberField(abilityData, "_healthCost"),
      cooldown: numberField(abilityData, "_cooldown"),
      maxTargets: numberField(content, "_maxTargets"),
      mechanics,
      sourceHash: createHash("sha256").update(content).digest("hex")
    });
  }
  return entries;
}

const spellEntries = abilityEntries(spellDirectory, null, (_content, classIdentifier) => classIdentifier.includes("Tactics.Spells."));
const blessingPoolPath = path.join(blessingDirectory, "BlessingPool.asset");
const blessingPool = readFileSync(blessingPoolPath, "utf8");
const blessingGuids = new Set(referenceGuids(blessingPool));
// Keep the Shop pool as a lookup source, and include every top-level authored blessing/curse.
// CellEffects are linked effects and stay nested under the Cell Blessing that uses them.
for (const file of readdirSync(blessingDirectory).filter(file => file.endsWith(".asset"))) {
  const guid = guidFor(path.join(blessingDirectory, file));
  if (guid) blessingGuids.add(guid);
}
const authoredBlessingEntries = abilityEntries(blessingDirectory, blessingGuids);
const blessingEntries = authoredBlessingEntries.filter(entry => !entry.isCurse);
const curseEntries = authoredBlessingEntries.filter(entry => entry.isCurse);

const implementationSources = implementationDirectories.flatMap(directory => {
  const absolute = path.join(scriptsDirectory, directory);
  return existsSync(absolute) ? filesBelow(absolute).filter(file => file.endsWith(".cs")).map(file => {
    const source = readFileSync(file, "utf8");
    const classes = [...source.matchAll(/\b(?:class|enum|struct|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]);
    return {
      id: path.relative(assetsDirectory, file).split(path.sep).join("/"),
      classes,
      sourceHash: createHash("sha256").update(source).digest("hex")
    };
  }) : [];
}).sort((left, right) => left.id.localeCompare(right.id));

const sortByName = (left, right) => left.name.localeCompare(right.name) || (left.level ?? 0) - (right.level ?? 0) || left.id.localeCompare(right.id);
for (const entry of [...units, ...buildings]) entry.levels.sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
units.sort(sortByName);
buildings.sort(sortByName);
spellEntries.sort(sortByName);
blessingEntries.sort(sortByName);
curseEntries.sort(sortByName);

if (units.length === 0 || spellEntries.length === 0 || blessingEntries.length === 0 || curseEntries.length === 0) {
  throw new Error("The game catalog snapshot is incomplete; units, spells, blessings, and curses must all be present.");
}

const catalog = {
  schemaVersion: 1,
  source: "Meowdieval Kingdom UnitCatalog roots, Spell assets, and top-level Blessing/Curses; generated from Unity YAML.",
  gridSizes: [
    { minFloor: 1, width: 3, height: 3 },
    { minFloor: 3, width: 4, height: 4 },
    { minFloor: 5, width: 5, height: 5 }
  ],
  factions: [...factionsById].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  units,
  buildings,
  spells: spellEntries,
  blessings: blessingEntries,
  curses: curseEntries,
  implementationSources
};

const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] ?? "" : path.join(projectDirectory, "public", "army-catalog.json"));
writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`Wrote ${units.length} unit roots, ${buildings.length} building roots, ${spellEntries.length} spells, ${blessingEntries.length} blessings, and ${curseEntries.length} curses to ${outputPath}.`);
