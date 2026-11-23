import { getBridgeUserId } from "../bridge-context";

export interface ContentSession {
  view: "browser" | "set";
  help: boolean;
  savedAt: string | null;
  setId: string | null;
}

const DEFAULT: ContentSession = { view: "browser", help: false, savedAt: null, setId: null };

function key(): string {
  return "meowedit.content.session." + (getBridgeUserId() ?? "local");
}

export function loadSession(): ContentSession {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return { ...DEFAULT };
    const loaded = JSON.parse(raw) as Partial<ContentSession>;
    return {
      view: loaded.view === "set" ? "set" : "browser",
      help: loaded.help === true,
      savedAt: typeof loaded.savedAt === "string" ? loaded.savedAt : null,
      setId: typeof loaded.setId === "string" ? loaded.setId : null
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
