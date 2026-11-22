import { FEATURES } from "./registries";
import type { ContentSetV2Document, GameCapabilities } from "./types";

export interface PackedFile {
  path: string;
  content: string;
}

export interface RuntimePackage {
  manifest: Record<string, unknown>;
  files: PackedFile[];
  contentHash: string;
  packageId: string;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function extensionIndex(set: ContentSetV2Document): Record<string, unknown> {
  return {
    schemaVersion: 2,
    quests: set.quests.map(quest => ({ questId: quest.id, ...quest.meowEdit })),
    armies: set.armies.map(army => ({ id: army.id, name: army.name })),
    dialogueDecisions: set.dialogues.flatMap(dialogue => dialogue.nodes.flatMap(node =>
      node.actions.map((action, index) => ({
        sequenceId: dialogue.sequenceId,
        nodeId: node.id,
        actionIndex: index,
        ...action.meowEdit.decision
      }))))
  };
}

/** Ordinal UTF-8 byte comparison, as required by §3. */
function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** Generates the closed runtime file set (§2.2) and the canonical hash (§3). */
export async function packContentSet(
  set: ContentSetV2Document,
  capabilities: GameCapabilities
): Promise<RuntimePackage> {
  const dialoguePaths = set.dialogues.map(dialogue => "dialogues/" + dialogue.sequenceId + ".json");
  const manifest = {
    format: "meowdieval-content-package",
    packageVersion: 2,
    setId: set.set.setId,
    minAppVersion: capabilities.appVersion,
    requiredCapabilities: FEATURES,
    files: {
      quests: "quests/Definitions.json",
      armies: "armies/ArmyConfigurations.json",
      campaigns: "campaigns/Campaigns.json",
      extensions: "extensions/meowedit-v1.json",
      dialogues: dialoguePaths
    }
  };
  const files: PackedFile[] = [
    { path: "manifest.json", content: json(manifest) },
    { path: "quests/Definitions.json", content: json({ schemaVersion: 2, quests: set.quests }) },
    { path: "armies/ArmyConfigurations.json", content: json({ schemaVersion: 2, armies: set.armies }) },
    { path: "campaigns/Campaigns.json", content: json({ schemaVersion: 2, campaigns: set.campaigns }) },
    { path: "extensions/meowedit-v1.json", content: json(extensionIndex(set)) },
    { path: "set.json", content: json(set.set) },
    ...set.dialogues.map(dialogue => ({
      path: "dialogues/" + dialogue.sequenceId + ".json",
      content: json(dialogue)
    }))
  ].sort((left, right) => compareUtf8(left.path, right.path));

  const canonical = files.map(file => file.path + "\n" + file.content + "\n").join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    manifest,
    files,
    contentHash,
    packageId: set.set.setId + "-" + contentHash.slice(0, 16)
  };
}
