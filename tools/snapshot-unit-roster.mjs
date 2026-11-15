import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const defaultGameRoot = path.resolve(projectDirectory, "..", "MeowdievalKingdom");
const gameRootIndex = process.argv.indexOf("--game-root");
const gameRoot = path.resolve(gameRootIndex >= 0 ? process.argv[gameRootIndex + 1] ?? "" : defaultGameRoot);
const scriptableObjects = path.join(gameRoot, "Assets", "Meowdieval", "ScriptableObjects");
const factionDirectory = path.join(scriptableObjects, "Factions");
const unitDirectory = path.join(scriptableObjects, "UnitStats", "Resources");
const factionNames = ["Nobles", "Peasants", "HarborClaws", "CrystalCats", "WanderingTrader", "MagicCats", "Neutral"];
const moods = ["Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"];
const avatarDirectory = path.join(projectDirectory, "public", "avatars");

if (!existsSync(factionDirectory) || !existsSync(unitDirectory)) {
  throw new Error("Could not find the game faction and UnitStats resources under " + gameRoot + ". Use --game-root <MeowdievalKingdom path>.");
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function assetGuid(assetPath) {
  const metaPath = assetPath + ".meta";
  if (!existsSync(metaPath)) return "";
  return readFileSync(metaPath, "utf8").match(/^guid: ([a-f0-9]+)/m)?.[1] ?? "";
}

function field(content, name) {
  return content.match(new RegExp("^\\s*" + name + ":\\s*(.+?)\\s*$", "m"))?.[1] ?? "";
}

function portraitFor(unitId) {
  const filename = unitId.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") + ".png";
  return existsSync(path.join(avatarDirectory, filename)) ? "./avatars/" + filename : undefined;
}

const unitAssetsByGuid = new Map();
for (const assetPath of filesBelow(unitDirectory).filter(file => file.endsWith(".asset"))) {
  const guid = assetGuid(assetPath);
  if (guid) unitAssetsByGuid.set(guid, assetPath);
}

const units = [];
const seenUnitIds = new Set();
for (const factionPath of filesBelow(factionDirectory).filter(file => file.endsWith(".asset"))) {
  const factionSource = readFileSync(factionPath, "utf8");
  if (field(factionSource, "Playable") !== "1") continue;
  const factionDisplayName = field(factionSource, "FactionName");
  const factionNumber = Number(field(factionSource, "Faction"));
  const factionId = factionNames[factionNumber];
  if (!factionId || !factionDisplayName) {
    throw new Error("Could not resolve the faction identity in " + factionPath);
  }

  const section = factionSource.match(/_availableUnits:\s*([\s\S]*?)(?=\n\s*_[A-Za-z])/m)?.[1] ?? "";
  const rootUnitGuids = [...section.matchAll(/guid: ([a-f0-9]+)/g)].map(match => match[1]);
  for (const guid of rootUnitGuids) {
    const assetPath = unitAssetsByGuid.get(guid);
    if (!assetPath) throw new Error("Could not resolve UnitStats guid " + guid + " from " + factionPath);
    const unitSource = readFileSync(assetPath, "utf8");
    const unitName = field(unitSource, "UnitName");
    const unitType = field(unitSource, "Type");
    const unitFaction = Number(field(unitSource, "Faction"));
    if (!unitName) throw new Error("Could not find UnitName in " + assetPath);
    if (unitType !== "0") continue; // The Compendium has separate building entries; MeowEdit only needs characters.
    if (unitFaction !== factionNumber) {
      throw new Error(`Faction mismatch for ${unitName}: expected ${factionId}, found enum value ${unitFaction}.`);
    }
    const id = factionId + "/" + unitName + "/1";
    if (seenUnitIds.has(id)) continue;
    seenUnitIds.add(id);
    units.push({ id, displayName: unitName, faction: factionDisplayName, moods, portrait: portraitFor(id) });
  }
}

units.sort((left, right) => left.faction.localeCompare(right.faction) || left.displayName.localeCompare(right.displayName));
if (units.length === 0) throw new Error("No playable character units were found in the Compendium roots.");

const manifest = {
  schemaVersion: 1,
  rosterVersion: "game-catalog-snapshot",
  source: "Current playable UnitCatalog roots shown under Units in the Meowdieval Compendium; buildings excluded.",
  units
};
const outputPath = path.join(projectDirectory, "public", "unit-roster.json");
writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Wrote " + units.length + " playable Compendium character units to public/unit-roster.json (buildings excluded).");
