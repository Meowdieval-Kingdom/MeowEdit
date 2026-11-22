import type {
  ContentSetV2Document, GameCapabilities, LocalizedText, NamedRef
} from "./types";
import { gameCapabilitiesSchema } from "./zod";

export function localized(defaultText: string, locales: Record<string, string> = {}): LocalizedText {
  return { default: defaultText, locales };
}

export function namedRef(id: string, label?: string): NamedRef {
  return { id, label: localized(label ?? id) };
}

export const EMPTY_REF = namedRef("", "");

/** A minimal, schema-valid v2 set with one campaign and no authored content. */
export function emptyContentSet(setId: string, name: string): ContentSetV2Document {
  return {
    schemaVersion: 2,
    set: {
      schemaVersion: 2,
      setId,
      name: localized(name),
      description: localized(""),
      displayOrder: 0,
      campaignOrder: []
    },
    quests: [],
    armies: [],
    campaigns: [],
    dialogues: []
  };
}

/** Loads and strictly validates the generated capability manifest (§6). */
export async function loadCapabilities(): Promise<GameCapabilities> {
  const response = await fetch("./game-capabilities.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("game-capabilities.json could not be loaded.");
  return gameCapabilitiesSchema.parse(await response.json());
}
