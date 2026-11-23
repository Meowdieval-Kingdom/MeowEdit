import type { RichState } from "./rich";
import { getBridgeUserId } from "../bridge-context";

export interface V2Session {
  view: "browser" | "wizard" | "set";
  focus: string;
  entry: { section: string; index: number } | null;
  rich: RichState | null;
  rawFields: boolean;
  step: number;
  help: boolean;
  savedAt: string | null;
  setId: string | null;
  returnTo: Array<{ section: string; index: number; step: number }>;
}

const DEFAULT: V2Session = {
  view: "browser", focus: "campaigns", entry: null, rich: null,
  rawFields: false, step: 0, help: false, savedAt: null, setId: null, returnTo: []
};

function key(): string {
  return "meowedit.v2.session." + (getBridgeUserId() ?? "local");
}

export function loadSession(): V2Session {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return { ...DEFAULT };
    const loaded = JSON.parse(raw) as Partial<V2Session>;
    return {
      ...DEFAULT, ...loaded,
      returnTo: Array.isArray(loaded.returnTo) ? loaded.returnTo : []
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
