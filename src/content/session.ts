import { getBridgeUserId } from "../bridge-context";

export interface LastEdited {
  workspace: string; // "__scratch__" or a setId
  section: "dialogues" | "quests" | "armies" | "missions";
  key: string;
  label: string;
}

export interface ContentSession {
  help: boolean;
  savedAt: string | null;
  setId: string | null;
  lastEdited: LastEdited | null;
}

const DEFAULT: ContentSession = { help: false, savedAt: null, setId: null, lastEdited: null };

function key(): string {
  return "meowedit.content.session." + (getBridgeUserId() ?? "local");
}

export function loadSession(): ContentSession {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return { ...DEFAULT };
    const loaded = JSON.parse(raw) as Partial<ContentSession>;
    const last = loaded.lastEdited;
    return {
      help: loaded.help === true,
      savedAt: typeof loaded.savedAt === "string" ? loaded.savedAt : null,
      setId: typeof loaded.setId === "string" ? loaded.setId : null,
      lastEdited: last && typeof last.workspace === "string" && typeof last.key === "string"
        && ["dialogues", "quests", "armies", "missions"].includes(last.section)
        ? last as LastEdited : null
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveSession(session: ContentSession): void {
  try {
    localStorage.setItem(key(), JSON.stringify(session));
  } catch {
    // Storage is full; the draft itself reports the failure.
  }
}
