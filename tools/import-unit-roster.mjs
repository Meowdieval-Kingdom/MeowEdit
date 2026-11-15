import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validMoods = new Set(["Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"]);

function readArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--input") options.input = args[++index];
    else if (key === "--portraits") options.portraits = args[++index];
    else if (key === "--help") options.help = true;
    else throw new Error("Unknown argument: " + key);
  }
  return options;
}

function slug(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function portraitSourcePath(inputRoot, relativePath) {
  const resolved = path.resolve(inputRoot, relativePath);
  if (!resolved.startsWith(inputRoot + path.sep)) {
    throw new Error("Portrait path must stay inside the supplied portrait folder: " + relativePath);
  }
  return resolved;
}

function usage() {
  return [
    "Update the MeowEdit static unit roster.",
    "",
    "Usage:",
    "  node tools/import-unit-roster.mjs --input <roster.json> [--portraits <folder>]",
    ""
  ].join("\n");
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.input) throw new Error("--input is required.\n\n" + usage());
  const inputPath = path.resolve(args.input);
  const source = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(source.units) || source.units.length === 0) {
    throw new Error("The roster JSON must contain a non-empty units array.");
  }

  const ids = new Set();
  const outputDir = path.join(repoRoot, "public", "avatars");
  if (args.portraits) await mkdir(outputDir, { recursive: true });

  const units = [];
  for (const entry of source.units) {
    if (!entry.id || !entry.displayName || !entry.faction) {
      throw new Error("Each unit needs id, displayName, and faction fields.");
    }
    if (ids.has(entry.id)) throw new Error("Duplicate unit ID: " + entry.id);
    ids.add(entry.id);
    const moods = Array.isArray(entry.moods) ? entry.moods : ["Normal"];
    for (const mood of moods) {
      if (!validMoods.has(mood)) throw new Error("Unsupported mood '" + mood + "' on " + entry.id);
    }

    const unit = {
      id: entry.id,
      displayName: entry.displayName,
      faction: entry.faction,
      moods
    };
    const moodPortraitFiles = entry.portraitFiles && typeof entry.portraitFiles === "object"
      ? entry.portraitFiles
      : {};
    const hasPortraitFiles = Boolean(entry.portraitFile) || Object.keys(moodPortraitFiles).length > 0;
    if (hasPortraitFiles && !args.portraits) {
      throw new Error("Portrait files are listed for " + entry.id + " but --portraits was not supplied.");
    }
    if (entry.portraitFile) {
      const inputRoot = path.resolve(args.portraits);
      const portraitSource = portraitSourcePath(inputRoot, entry.portraitFile);
      const portraitName = slug(entry.id) + ".png";
      await copyFile(portraitSource, path.join(outputDir, portraitName));
      unit.portrait = "./avatars/" + portraitName;
    } else if (entry.portrait) {
      unit.portrait = entry.portrait;
    }
    const portraitCaptures = {};
    for (const [mood, relativePath] of Object.entries(moodPortraitFiles)) {
      if (!validMoods.has(mood)) throw new Error("Unsupported portrait mood '" + mood + "' on " + entry.id);
      if (typeof relativePath !== "string" || !relativePath) {
        throw new Error("Portrait file for mood '" + mood + "' on " + entry.id + " must be a path.");
      }
      const inputRoot = path.resolve(args.portraits);
      const portraitSource = portraitSourcePath(inputRoot, relativePath);
      const portraitName = slug(entry.id) + "-" + slug(mood) + ".png";
      await copyFile(portraitSource, path.join(outputDir, portraitName));
      portraitCaptures[mood] = "./avatars/" + portraitName;
    }
    if (Object.keys(portraitCaptures).length > 0) unit.portraitCaptures = portraitCaptures;
    units.push(unit);
  }

  const manifest = {
    schemaVersion: 1,
    rosterVersion: source.rosterVersion || new Date().toISOString().slice(0, 10),
    source: source.source || "Imported Unity UnitCatalog export",
    units
  };
  const manifestPath = path.join(repoRoot, "public", "unit-roster.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stdout.write("Updated " + units.length + " unit entries in public/unit-roster.json.\n");
}

main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
