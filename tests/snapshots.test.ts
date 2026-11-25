import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBridgeState } from "../src/bridge-context";
import { loadSession, saveSession } from "../src/content/session";
import { clearPublishedSnapshot, loadPublishedSnapshot, savePublishedSnapshot } from "../src/content/snapshots";
import { emptyContentSet } from "../src/content/factory";

describe("local change state", () => {
  beforeEach(() => {
    localStorage.clear();
    setBridgeState({ userId: "snap-user", canPublish: true, canDeleteSets: false, actions: { signOut: vi.fn() } });
  });
  afterEach(() => setBridgeState({ userId: "", canPublish: false, canDeleteSets: false, actions: { signOut: vi.fn() } }));

  it("stores and clears the published snapshot", () => {
    const draft = emptyContentSet("demo", "Demo");
    expect(loadPublishedSnapshot("demo")).toBeNull();
    savePublishedSnapshot("demo", draft);
    expect(loadPublishedSnapshot("demo")).toEqual(draft);
    clearPublishedSnapshot("demo");
    expect(loadPublishedSnapshot("demo")).toBeNull();
  });

  it("round-trips pending edits, unpublished sets and editor tabs", () => {
    const session = {
      help: true, savedAt: "now", setId: "demo",
      lastEdited: null,
      recent: [],
      pending: [{ setId: "demo", workspace: "demo", section: "missions" as const, key: "m1", label: "Mission" }],
      unpublished: ["demo"],
      tabs: { demo: [{ workspace: "demo", section: "missions" as const, key: "m1", label: "Mission", step: 2, mode: "full" as const }] }
    };
    saveSession(session);
    expect(loadSession()).toEqual(session);
  });
});
