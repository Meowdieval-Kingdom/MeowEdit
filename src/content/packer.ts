import type { ContentSetDocument } from "./types";

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

/** Must match the backend packer (functions/content.ts) and Tactics byte for byte. */
export const DEFAULT_MIN_APP_VERSION = "0.2.2";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function extensionIndex(set: ContentSetDocument): Record<string, unknown> {
  return {
    schemaVersion: 2,
    quests: set.quests.map(quest => quest.meowEdit),
    armies: set.armies,
    dialogueDecisions: set.quests.flatMap(quest =>
      (quest.meowEdit as { dialogueDecisions?: unknown[] }).dialogueDecisions ?? [])
  };
}

/**
 * Generates the closed runtime file set and the canonical hash.
 * `capabilities` is accepted for call-site compatibility; the backend derives these
 * values from the set document, so only set-level fields may affect the hash.
 */
export async function packContentSet(
  set: ContentSetDocument,
  _capabilities?: unknown
): Promise<RuntimePackage> {
  const setDocument = set.set as ContentSetDocument["set"] & {
    minAppVersion?: string;
    requiredCapabilities?: string[];
  };
  const minAppVersion = typeof setDocument.minAppVersion === "string"
    ? setDocument.minAppVersion : DEFAULT_MIN_APP_VERSION;
  const requiredCapabilities = Array.isArray(setDocument.requiredCapabilities)
    ? setDocument.requiredCapabilities.filter((value): value is string => typeof value === "string") : [];
  const manifest = {
    format: "meowdieval-content-package",
    packageVersion: 2,
    setId: set.set.setId,
    minAppVersion,
    requiredCapabilities,
    files: {
      set: "set.json",
      quests: "quests/Definitions.json",
      armies: "armies/ArmyConfigurations.json",
      campaigns: "campaigns/Campaigns.json",
      extensions: "extensions/meowedit-v1.json",
      dialogues: set.dialogues.map(dialogue => "dialogues/" + dialogue.sequenceId + ".json")
    }
  };
  const byPath: Record<string, string> = {
    "set.json": json({ schemaVersion: 2, ...(set.set as unknown as Record<string, unknown>) }),
    "quests/Definitions.json": json({ schemaVersion: 2, quests: set.quests }),
    "armies/ArmyConfigurations.json": json({ schemaVersion: 2, armies: set.armies }),
    "campaigns/Campaigns.json": json({ schemaVersion: 2, campaigns: set.campaigns }),
    "extensions/meowedit-v1.json": json(extensionIndex(set)),
    "manifest.json": json(manifest)
  };
  for (const dialogue of set.dialogues)
    byPath["dialogues/" + dialogue.sequenceId + ".json"] = json(dialogue);

  const paths = Object.keys(byPath).sort();
  const canonical = paths.map(path => path + "\n" + byPath[path] + "\n").join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    manifest,
    files: paths.map(path => ({ path, content: byPath[path] })),
    contentHash,
    packageId: set.set.setId + "-" + contentHash.slice(0, 16)
  };
}
