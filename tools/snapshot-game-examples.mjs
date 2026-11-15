import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const defaultGameRoot = path.resolve(projectDirectory, "..", "MeowdievalKingdom");
const gameRootIndex = process.argv.indexOf("--game-root");
const gameRoot = path.resolve(gameRootIndex >= 0 ? process.argv[gameRootIndex + 1] ?? "" : defaultGameRoot);
const dialogueRelativePath = path.join("Assets", "Meowdieval", "Resources", "DialogueSequences");
const questRelativePath = path.join("Assets", "Meowdieval", "Resources", "AdventureQuests", "Definitions.json");
const dialogueDirectory = path.join(gameRoot, dialogueRelativePath);
const questFile = path.join(gameRoot, questRelativePath);

if (!existsSync(dialogueDirectory) || !existsSync(questFile)) {
  throw new Error("Could not find the game dialogue and quest files under " + gameRoot + ". Use --game-root <MeowdievalKingdom path>.");
}

const dialogueFiles = readdirSync(dialogueDirectory)
  .filter(file => file.toLowerCase().endsWith(".json"))
  .sort((left, right) => left.localeCompare(right));
const exampleTitles = {
  "adventure-mode-welcome": "Tutorial Adventure Mode",
  "battle-shop-basics": "Tutorial Battle Shop",
  "compendium-welcome": "Tutorial Compendium",
  "endless-mode-welcome": "Tutorial Endless Mode",
  "first-battle-hero": "Tutorial First Battle",
  "first-blessing": "Tutorial First Blessing",
  "first-building": "Tutorial First Building",
  "first-spell": "Tutorial First Spell",
  "main-menu-welcome": "Tutorial Main Menu",
  "ranked-mode-welcome": "Tutorial Ranked Mode",
  "village-council-example": "Village Council Example"
};
const dialogues = dialogueFiles.map(file => {
  const dialogue = JSON.parse(readFileSync(path.join(dialogueDirectory, file), "utf8"));
  if (!dialogue.sequenceId || !dialogue.startNodeId || !Array.isArray(dialogue.nodes) || dialogue.nodes.length === 0) {
    throw new Error("A game dialogue example is incomplete: " + file);
  }
  return { ...dialogue, exampleTitle: exampleTitles[dialogue.sequenceId] ?? dialogue.sequenceId };
});
const questDocument = JSON.parse(readFileSync(questFile, "utf8"));

if (!Array.isArray(questDocument.quests)) {
  throw new Error("The game quest definitions file does not contain a quests array.");
}

const supportedObjectives = new Set(["Escort", "Fetch", "Battle", "ClearFloor"]);
const quests = questDocument.quests.filter(quest => {
  if (!quest?.id || !quest?.title || !supportedObjectives.has(quest.objectiveKind)) return false;
  if (quest.objectiveKind === "Escort" && !quest.escortUnitId) return false;
  if (quest.objectiveKind === "Fetch" && !quest.itemId) return false;
  if ((quest.objectiveKind === "Battle" || quest.objectiveKind === "ClearFloor") && !quest.targetNodeKind) return false;
  return true;
});

const snapshot = {
  format: "meowedit-game-examples",
  schemaVersion: 1,
  sourceProject: "MeowdievalKingdom",
  sourceFiles: {
    dialogues: "Assets/Meowdieval/Resources/DialogueSequences",
    quests: "Assets/Meowdieval/Resources/AdventureQuests/Definitions.json"
  },
  dialogues,
  quests
};

const outputPath = path.join(projectDirectory, "public", "game-examples.json");
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log("Wrote " + dialogues.length + " complete game dialogues and " + quests.length + " runtime-supported quest examples to public/game-examples.json.");
