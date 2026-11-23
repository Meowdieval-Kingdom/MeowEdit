import "./styles.css";
import "./bridge-gate.css";
import { createInternalNeonAuth } from "@neondatabase/auth";
import {
  resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState, type BridgeActions
} from "./bridge-context";
import { escapeHtml } from "./content/html";
import { NETWORK_TIMEOUT_MS, withDeadline } from "./request-timeout";
import { APP_VERSION } from "./content/version";

type AuthUser = { id: string };
type AuthResult<T> = { data?: T | null; error?: { message?: string } | null };
type SessionEnvelope = { user?: AuthUser; session?: unknown } | null;
let signInHandler: (form: HTMLFormElement) => void | Promise<void> = () => undefined;
/** Invalidates in-flight authorization callbacks when a newer attempt starts or the user signs out. */
let authGeneration = 0;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("MeowEdit app root is missing.");

const authUrl = import.meta.env.VITE_NEON_AUTH_BASE_URL?.trim() ?? "";
const apiUrl = (import.meta.env.VITE_GAME_API_BASE_URL?.trim() ?? "").replace(/\/+$/, "");

function gateTopbar(): string {
  return '<div class="topbar"><div class="topbar-context"><span class="brand-mark">M</span><strong>MeowEdit</strong>' +
    '<span class="context-divider">/</span><span class="context-crumb">' + APP_VERSION + '</span></div></div>';
}

function renderGate(message: string, mode: "signin" | "config" = "signin"): void {
  app!.innerHTML = '<main class="bridge-gate">' + gateTopbar() + (mode === "config"
    ? '<section class="bridge-panel"><div class="card bridge-card"><span class="eyebrow">MeowEdit content studio</span><h1>Editor sign-in is not configured</h1><p class="bridge-copy">Set the public Neon Auth URL and game API URL in the deployment environment, then rebuild the editor. No authoring workspace is loaded until authentication is available.</p></div></section>'
    : '<section class="bridge-panel"><form class="card bridge-card" id="bridge-signin"><span class="eyebrow">MeowEdit content studio</span>' +
      '<h1>Sign in to MeowEdit</h1><p class="bridge-copy">Use an account provisioned for the content studio. Sign-up is not offered here.</p>' +
      '<div class="form-grid"><label class="field"><span class="field-label">Email</span><input name="email" type="email" autocomplete="username" required></label>' +
      '<label class="field"><span class="field-label">Password</span><input name="password" type="password" autocomplete="current-password" required></label></div>' +
      '<p class="bridge-error" role="alert">' + escapeHtml(message) + '</p>' +
      '<div class="dialog-actions"><button class="button button-primary" type="submit">Sign in</button></div></form></section>') + '</main>';
  app!.querySelector<HTMLFormElement>("#bridge-signin")?.addEventListener("submit", event => {
    event.preventDefault();
    void signInHandler(event.currentTarget as HTMLFormElement);
  });
}

/** Updates the error in place so a failed attempt keeps the entered email and re-enables submit. */
function showGateError(message: string): void {
  const error = app!.querySelector<HTMLElement>(".bridge-error");
  if (!error) {
    renderGate(message);
    return;
  }
  error.textContent = message;
  const submit = app!.querySelector<HTMLButtonElement>('#bridge-signin button[type="submit"]');
  if (submit) {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isBridgeConfigured(): boolean {
  const https = /^https:\/\//i;
  return https.test(authUrl)
    && (https.test(apiUrl) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(apiUrl));
}

if (!isBridgeConfigured()) {
  renderGate("", "config");
} else {
  const neonAuth = createInternalNeonAuth(authUrl);
  const auth = neonAuth.adapter;
  renderGate("");
  void restoreSession();

  async function restoreSession(): Promise<void> {
    const generation = ++authGeneration;
    try {
      const result = await withTimeout(
        auth.getSession() as Promise<AuthResult<SessionEnvelope>>,
        15_000,
        "Session restore timed out. Please try signing in again."
      );
      if (generation !== authGeneration) return;
      if (result.data?.user?.id) await authorize(result.data.user, generation);
    } catch {
      if (generation !== authGeneration) return;
      showGateError("Your sign-in could not be restored. Please sign in again.");
    }
  }

  async function signIn(form: HTMLFormElement): Promise<void> {
    const generation = ++authGeneration;
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
    const email = new FormData(form).get("email");
    const password = new FormData(form).get("password");
    if (typeof email !== "string" || typeof password !== "string") return;
    if (submit) { submit.disabled = true; submit.textContent = "Signing in…"; }
    try {
      const result = await withTimeout(
        auth.signIn.email({ email: email.trim(), password }) as Promise<AuthResult<SessionEnvelope>>,
        15_000,
        "Sign-in timed out. Check your connection and try again."
      );
      if (generation !== authGeneration) return;
      if (result.error) throw new Error(result.error.message || "Sign-in failed.");
      const session = result.data?.user ? result.data
        : (await withTimeout(
          auth.getSession() as Promise<AuthResult<SessionEnvelope>>,
          15_000,
          "Session lookup timed out. Please try again."
        )).data;
      if (generation !== authGeneration) return;
      if (!session?.user?.id) throw new Error("The sign-in succeeded but no user session was returned.");
      if (submit) submit.textContent = "Authorizing…";
      await authorize(session.user, generation);
    } catch (error) {
      if (generation !== authGeneration) return;
      showGateError(error instanceof Error ? error.message : "Sign-in failed. Check the credentials and try again.");
    }
  }
  signInHandler = signIn;

  async function authorize(user: AuthUser, generation: number): Promise<void> {
    if (generation !== authGeneration) return;
    let token: string | null;
    try {
      token = await withTimeout(neonAuth.getJWTToken(), 15_000, "Token request timed out. Please try again.");
    } catch (error) {
      if (generation !== authGeneration) return;
      showGateError(error instanceof Error ? error.message : "Token request failed.");
      return;
    }
    if (generation !== authGeneration) return;
    if (!token) {
      showGateError("A valid sign-in token could not be created. Please sign in again.");
      return;
    }
    let response: Response;
    try {
      response = await withDeadline(signal => fetch(apiUrl + "/v1/editor/access", {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        signal
      }), 15_000, null, "The game Bridge did not respond in time.");
    } catch {
      if (generation !== authGeneration) return;
      showGateError("The game Bridge could not be reached. Check the connection and try again.");
      return;
    }
    if (generation !== authGeneration) return;
    if (!response.ok) {
      showGateError(response.status === 401
        ? "Your sign-in expired. Please sign in again."
        : "The game Bridge could not authorize this editor session.");
      return;
    }
    const access = await response.json().catch(() => null) as {
      authorized?: boolean; canPublish?: boolean; canDeleteSets?: boolean; userId?: string; error?: string
    } | null;
    if (generation !== authGeneration) return;
    if (!access?.authorized) {
      showGateError(access?.error || "This account is not authorized to open MeowEdit.");
      return;
    }

    const actions: BridgeActions = {
      signOut: () => {
        authGeneration++;
        void auth.signOut().finally(() => {
          resetBridgeFetch();
          resetBridgeState();
          window.location.reload();
        });
      }
    };
    setBridgeState({
      userId: access.userId || user.id,
      canPublish: access.canPublish === true,
      canDeleteSets: access.canDeleteSets === true,
      actions
    });
    setBridgeFetch(async (path, init) => {
      const freshToken = await withTimeout(neonAuth.getJWTToken(), 15_000, "Token request timed out.");
      if (!freshToken) throw new Error("Your sign-in expired. Sign out and sign in again.");
      return withDeadline(signal => fetch(apiUrl + path, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: "Bearer " + freshToken },
        signal
      }), NETWORK_TIMEOUT_MS, init?.signal);
    });
    const submit = app!.querySelector<HTMLButtonElement>('#bridge-signin button[type="submit"]');
    if (submit) submit.textContent = "Loading editor…";
    try {
      const editor = await withTimeout(import("./content/app"), 15_000, "The editor bundle could not be loaded in time.");
      if (generation !== authGeneration) return;
      await withTimeout(editor.mountApp(app!), 20_000, "The editor did not finish loading in time.");
    } catch (error) {
      if (generation !== authGeneration) return;
      showGateError(error instanceof Error ? error.message : "The editor could not be loaded.");
    }
  }
}
