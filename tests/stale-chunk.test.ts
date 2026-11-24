import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStaleChunkReload, isModuleLoadFailure, reloadForStaleChunk } from "../src/stale-chunk";

describe("stale chunk recovery", () => {
  const assign = vi.fn();

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    sessionStorage.clear();
    assign.mockClear();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  it("recognizes module load failures but not ordinary errors", () => {
    expect(isModuleLoadFailure(new Error("Failed to fetch dynamically imported module: https://example.test/app.js"))).toBe(true);
    expect(isModuleLoadFailure(new Error("Importing a module script failed."))).toBe(true);
    expect(isModuleLoadFailure(new Error("network down"))).toBe(false);
  });

  it("reloads once, then stops until the flag is cleared", () => {
    const failure = new Error("Failed to fetch dynamically imported module: https://example.test/app.js");
    expect(reloadForStaleChunk(failure)).toBe(true);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    expect(reloadForStaleChunk(failure)).toBe(false);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    expect(reloadForStaleChunk(new Error("network down"))).toBe(false);
    expect(window.location.assign).toHaveBeenCalledTimes(1);

    clearStaleChunkReload();
    expect(reloadForStaleChunk(failure)).toBe(true);
    expect(window.location.assign).toHaveBeenCalledTimes(2);
  });
});
