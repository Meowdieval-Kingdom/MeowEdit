/** A cached page can reference a hashed chunk that a newer deploy removed. */
const RELOAD_KEY = "meowedit.stale-chunk-reload";

export function isModuleLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}

/** Reload once so the browser picks up the current index and asset hashes. */
export function reloadForStaleChunk(error: unknown): boolean {
  if (!isModuleLoadFailure(error)) return false;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return false;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("meowedit_refresh", String(Date.now()));
  window.location.assign(url.toString());
  return true;
}

export function clearStaleChunkReload(): void {
  try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage is optional */ }
}
