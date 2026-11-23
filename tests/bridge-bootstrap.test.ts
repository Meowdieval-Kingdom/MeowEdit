import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  appLoaded: 0,
  sessionUser: null as { id: string } | null,
  token: "jwt-token" as string | null,
  access: { authorized: true, canPublish: true, userId: "server-user" } as unknown,
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signOut: vi.fn(async () => undefined),
  mountApp: vi.fn(async () => undefined)
}));

vi.mock("@neondatabase/auth", () => ({
  createInternalNeonAuth: vi.fn(() => ({
    adapter: {
      getSession: (...args: unknown[]) => runtime.getSession(...args),
      signIn: { email: (...args: unknown[]) => runtime.signInEmail(...args) },
      signOut: runtime.signOut
    },
    getJWTToken: async () => runtime.token
  }))
}));

vi.mock("../src/content/app", () => {
  runtime.appLoaded += 1;
  return { mountApp: runtime.mountApp };
});

describe("Bridge bootstrap (structured-only)", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    runtime.sessionUser = null;
    runtime.token = "jwt-token";
    runtime.access = { authorized: true, canPublish: true, userId: "server-user" };
    runtime.getSession.mockReset().mockImplementation(async () => ({
      data: runtime.sessionUser ? { user: runtime.sessionUser } : null
    }));
    runtime.signInEmail.mockReset().mockImplementation(async () => ({ data: { user: { id: "signed-in-user" } } }));
    runtime.signOut.mockReset().mockImplementation(async () => undefined);
    runtime.mountApp.mockReset().mockImplementation(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => runtime.access })));
    vi.stubGlobal("location", { reload: vi.fn() });
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "https://auth.example.com");
    vi.stubEnv("VITE_GAME_API_BASE_URL", "https://api.example.com");
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
    expect(runtime.getSession).not.toHaveBeenCalled();
  });

  it("restores an authorized session and loads only the structured app", async () => {
    runtime.sessionUser = { id: "stale-client-id" };
    const before = runtime.appLoaded;
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(runtime.appLoaded).toBeGreaterThan(before));
    expect(document.querySelector("#bridge-signin")).not.toBeNull();
  });

  it("signs in with provisioned credentials", async () => {
    await import("../src/bridge-bootstrap");
    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = "author@example.com";
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = "secret";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(runtime.signInEmail).toHaveBeenCalledWith({ email: "author@example.com", password: "secret" }));
  });

  it("uses the editor's form components and keeps input after a failed sign-in", async () => {
    runtime.signInEmail.mockImplementation(async () => ({ error: { message: "Wrong password" } }));
    await import("../src/bridge-bootstrap");
    expect(document.querySelector(".bridge-gate .topbar .brand-mark")).not.toBeNull();
    expect(document.querySelector("#bridge-signin.card .field")).not.toBeNull();
    expect(document.querySelector('#bridge-signin button[type="submit"].button-primary')).not.toBeNull();

    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = "author@example.com";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("Wrong password"));
    expect(document.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe("author@example.com");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it("escapes error messages instead of rendering them as markup", async () => {
    runtime.signInEmail.mockImplementation(async () => ({ error: { message: "<img src=x onerror=alert(1)>" } }));
    await import("../src/bridge-bootstrap");
    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("<img src=x onerror=alert(1)>"));
    expect(document.querySelector(".bridge-error img")).toBeNull();
  });

  it("refuses unprovisioned accounts", async () => {
    runtime.sessionUser = { id: "outsider" };
    runtime.access = { authorized: false, canPublish: false };
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("not authorized"));
    const before = runtime.appLoaded;
    await Promise.resolve();
    expect(runtime.appLoaded).toBe(before);
  });

  it("reports expired sessions and missing tokens without loading drafts", async () => {
    runtime.sessionUser = { id: "expired" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "expired" }) })));
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("sign-in expired"));

    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    runtime.sessionUser = { id: "no-token" };
    runtime.token = null;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => runtime.access })));
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(document.querySelector(".bridge-error")?.textContent).toContain("valid sign-in token"));
  });

  it("ignores a session callback that resolves after a newer sign-in has mounted the editor", async () => {
    let resumeSession!: (value: unknown) => void;
    runtime.getSession.mockImplementationOnce(() => new Promise(resolve => { resumeSession = resolve; }));
    await import("../src/bridge-bootstrap");
    await vi.waitFor(() => expect(typeof resumeSession).toBe("function"));
    const form = document.querySelector<HTMLFormElement>("#bridge-signin")!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = "author@example.com";
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = "secret";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(runtime.mountApp).toHaveBeenCalledTimes(1));
    resumeSession({ data: { user: { id: "late-user" } } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(runtime.mountApp).toHaveBeenCalledTimes(1);
  });
});
