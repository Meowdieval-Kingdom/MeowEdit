import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rosterFixture, workspaceFixture } from "./fixtures";

const publishRequest = () => ({ workspace: workspaceFixture(), roster: rosterFixture });

const auth = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
  token: "jwt-token" as string | null,
  access: { authorized: true, canPublish: true, userId: "server-user" } as unknown,
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signOut: vi.fn(async () => undefined)
}));

vi.mock("@neondatabase/auth", () => ({
  createInternalNeonAuth: vi.fn(() => ({
    adapter: {
      getSession: (...args: unknown[]) => auth.getSession(...args),
      signIn: { email: (...args: unknown[]) => auth.signInEmail(...args) },
      signOut: auth.signOut
    },
    getJWTToken: async () => auth.token
  }))
}));

vi.mock("../src/main", () => ({}));

describe("Bridge bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    auth.sessionUser = null;
    auth.token = "jwt-token";
    auth.access = { authorized: true, canPublish: true, userId: "server-user" };
    auth.getSession.mockReset().mockImplementation(async () => ({
      data: auth.sessionUser ? { user: auth.sessionUser } : null
    }));
    auth.signInEmail.mockReset().mockImplementation(async () => ({ data: { user: { id: "signed-in-user" } } }));
    auth.signOut.mockReset().mockImplementation(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => auth.access })));
    vi.stubGlobal("alert", vi.fn());
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "https://auth.example.com");
    vi.stubEnv("VITE_GAME_API_BASE_URL", "https://api.example.com");
    if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = () => undefined;
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = () => undefined;
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => undefined);
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a configuration gate and never loads the editor when URLs are missing", async () => {
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "");
    vi.stubEnv("VITE_GAME_API_BASE_URL", "");
    await import("../src/bridge-bootstrap");
    expect(document.querySelector(".bridge-gate")?.textContent).toContain("not configured");
    expect(document.querySelector("#bridge-signin")).toBeNull();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("restores an authorized session and uses the server-canonical user ID", async () => {
    auth.sessionUser = { id: "stale-client-id" };
    await import("../src/bridge-bootstrap");
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeUserId()).toBe("server-user"));
    expect(context.canPublish()).toBe(true);
    expect(context.getBridgeActions()).not.toBeNull();
  });

  it("signs in with provisioned credentials before loading drafts", async () => {
    await import("../src/bridge-bootstrap");
    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = "author@example.com";
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = "secret";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeUserId()).toBe("server-user"));
    expect(auth.signInEmail).toHaveBeenCalledWith({ email: "author@example.com", password: "secret" });
  });

  it("escapes error messages instead of rendering them as markup", async () => {
    auth.signInEmail.mockImplementation(async () => ({ error: { message: "<img src=x onerror=alert(1)>" } }));
    await import("../src/bridge-bootstrap");
    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("<img src=x onerror=alert(1)>"));
    expect(document.querySelector(".bridge-error img")).toBeNull();
  });

  it("refuses unprovisioned accounts and expired sessions", async () => {
    auth.sessionUser = { id: "outsider" };
    auth.access = { authorized: false, canPublish: false };
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("not authorized"));
    const context = await import("../src/bridge-context");
    expect(context.getBridgeUserId()).toBeNull();
  });

  it("reports an expired session and a missing token without loading drafts", async () => {
    auth.sessionUser = { id: "expired" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "expired" }) })));
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("sign-in expired"));

    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    auth.sessionUser = { id: "no-token" };
    auth.token = null;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => auth.access })));
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("valid sign-in token"));
  });

  it("uploads and publishes a package only after the hashes match", async () => {
    auth.sessionUser = { id: "author" };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/editor/access")) return { ok: true, status: 200, json: async () => auth.access };
      if (url.endsWith("/v1/editor/packages")) {
        const payload = JSON.parse(String(init?.body)) as { contentHash: string };
        return { ok: true, status: 200, json: async () => ({ packageId: "pkg-1", contentHash: payload.contentHash }) };
      }
      return { ok: true, status: 200, json: async () => ({ published: true }) };
    }));
    await import("../src/bridge-bootstrap");
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeActions()).not.toBeNull());
    context.getBridgeActions()!.publish(publishRequest());

    const dialog = document.querySelector<HTMLDialogElement>("#bridge-publish-dialog")!;
    expect(dialog).not.toBeNull();
    dialog.querySelector<HTMLFormElement>("#bridge-publish-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector(".bridge-publish-status")?.textContent).toContain("Published pkg-1"));
    expect(calls.some(call => call.url.endsWith("/v1/editor/packages/pkg-1/publish"))).toBe(true);
  });

  it("stops publishing when the server returns a different hash", async () => {
    auth.sessionUser = { id: "author" };
    let publishCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/editor/access")) return { ok: true, status: 200, json: async () => auth.access };
      if (url.endsWith("/v1/editor/packages")) {
        expect(String(init?.body)).toContain("contentHash");
        return { ok: true, status: 200, json: async () => ({ packageId: "pkg-1", contentHash: "tampered" }) };
      }
      publishCalls += 1;
      return { ok: true, status: 200, json: async () => ({ published: true }) };
    }));
    await import("../src/bridge-bootstrap");
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeActions()).not.toBeNull());
    context.getBridgeActions()!.publish(publishRequest());
    const dialog = document.querySelector<HTMLDialogElement>("#bridge-publish-dialog")!;
    dialog.querySelector<HTMLFormElement>("#bridge-publish-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector(".bridge-publish-status")?.textContent).toContain("hash did not match"));
    expect(publishCalls).toBe(0);
  });

  it("does not open the publish dialog for author-only accounts", async () => {
    auth.sessionUser = { id: "author" };
    auth.access = { authorized: true, canPublish: false };
    await import("../src/bridge-bootstrap");
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeActions()).not.toBeNull());
    context.getBridgeActions()!.publish(publishRequest());
    expect(window.alert).toHaveBeenCalled();
    expect(document.querySelector("#bridge-publish-dialog")).toBeNull();
  });

  it("clears the bridge identity on sign out", async () => {
    auth.sessionUser = { id: "author" };
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    await import("../src/bridge-bootstrap");
    const context = await import("../src/bridge-context");
    await vi.waitFor(() => expect(context.getBridgeUserId()).not.toBeNull());
    context.getBridgeActions()!.signOut();
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(context.getBridgeUserId()).toBeNull();
  });
});
