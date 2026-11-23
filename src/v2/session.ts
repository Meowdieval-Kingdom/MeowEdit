import { getBridgeUserId } from "../bridge-context";

export interface V2Session {
  view: "browser" | "set";
  help: boolean;
  savedAt: string | null;
  setId: string | null;
}

const DEFAULT: V2Session = { view: "browser", help: false, savedAt: null, setId: null };

function key(): string {
  return "meowedit.v2.session." + (getBridgeUserId() ?? "local");
}

export function loadSession(): V2Session {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return { ...DEFAULT };
    const loaded = JSON.parse(raw) as Partial<V2Session>;
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

export function saveSession(session: V2Session): void {
  try {
    localStorage.setItem(key(), JSON.stringify(session));
  } catch {
    // Storage is full; the draft itself reports the failure.
  }
}
