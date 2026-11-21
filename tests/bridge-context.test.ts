import { afterEach, describe, expect, it } from "vitest";
import { canPublish, getBridgeActions, getBridgeUserId, resetBridgeState, setBridgeState } from "../src/bridge-context";

describe("Bridge context", () => {
  afterEach(() => resetBridgeState());

  it("starts empty so the editor renders no bridge-only controls", () => {
    expect(getBridgeUserId()).toBeNull();
    expect(canPublish()).toBe(false);
    expect(getBridgeActions()).toBeNull();
  });

  it("stores the server-authorized identity and actions until reset", () => {
    const actions = { publish: () => undefined, signOut: () => undefined };
    setBridgeState({ userId: "author-1", canPublish: true, actions });
    expect(getBridgeUserId()).toBe("author-1");
    expect(canPublish()).toBe(true);
    expect(getBridgeActions()).toBe(actions);

    resetBridgeState();
    expect(getBridgeUserId()).toBeNull();
    expect(canPublish()).toBe(false);
    expect(getBridgeActions()).toBeNull();
  });
});
