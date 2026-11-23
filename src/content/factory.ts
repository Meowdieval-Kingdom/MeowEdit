import type { ContentSetDocument, LocalizedText, NamedRef } from "./types";

export function localized(defaultText: string, locales: Record<string, string> = {}): LocalizedText {
  return { default: defaultText, locales };
}

export function namedRef(id: string, label?: string): NamedRef {
  return { id, label: localized(label ?? id) };
}

/** A minimal, schema-valid structured set with one campaign and no authored content. */
export function emptyContentSet(setId: string, name: string): ContentSetDocument {
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
