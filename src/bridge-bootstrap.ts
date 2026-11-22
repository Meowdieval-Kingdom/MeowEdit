import "./bridge-gate.css";
import { createInternalNeonAuth } from "@neondatabase/auth";
import { createBridgePackagePayload, type BridgePackagePayload } from "./bridge-package";
import {
  BridgeHttpError, isBridgeConfigured, publishBridgePackage, requestEditorAccess, uploadBridgePackage
} from "./bridge-client";
import {
  canPublish, resetBridgeFetch, resetBridgeState, setBridgeFetch, setBridgeState,
  type BridgeActions, type BridgePublishRequest
} from "./bridge-context";
import { escapeHtml } from "./view";

type AuthUser = { id: string };
type AuthResult<T> = { data?: T | null; error?: { message?: string } | null };
type SessionEnvelope = { user?: AuthUser; session?: unknown } | null;
let signInHandler: (form: HTMLFormElement) => void | Promise<void> = () => undefined;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("MeowEdit app root is missing.");

const authUrl = import.meta.env.VITE_NEON_AUTH_BASE_URL?.trim() ?? "";
const apiUrl = (import.meta.env.VITE_GAME_API_BASE_URL?.trim() ?? "").replace(/\/+$/, "");

function renderGate(message: string, mode: "signin" | "config" = "signin"): void {
  app!.innerHTML = mode === "config"
    ? '<main class="bridge-gate"><section class="bridge-card"><span class="bridge-kicker">MEOWEDIT · TACTICS BRIDGE</span><h1>Editor sign-in is not configured</h1><p>Set the public Neon Auth URL and game API URL in the deployment environment, then rebuild the editor. No authoring workspace is loaded until authentication is available.</p></section></main>'
    : '<main class="bridge-gate"><form class="bridge-card" id="bridge-signin"><span class="bridge-kicker">MEOWEDIT · TACTICS BRIDGE</span><h1>Sign in to MeowEdit</h1><p>Use an account provisioned for the content studio. Sign-up is not offered here.</p><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p class="bridge-error" role="alert">' + escapeHtml(message) + '</p><button class="bridge-submit" type="submit">Sign in</button></form></main>';
  app!.querySelector<HTMLFormElement>("#bridge-signin")?.addEventListener("submit", event => {
    event.preventDefault();
    void signInHandler(event.currentTarget as HTMLFormElement);
  });
}

if (!isBridgeConfigured(authUrl, apiUrl)) {
  renderGate("", "config");
} else {
  const neonAuth = createInternalNeonAuth(authUrl);
  const auth = neonAuth.adapter;
  let pendingPublishRequest: BridgePublishRequest | null = null;
  renderGate("");
  void restoreSession();

  async function restoreSession(): Promise<void> {
    try {
      const result = await auth.getSession() as AuthResult<SessionEnvelope>;
      if (result.data?.user?.id) await authorize(result.data.user);
    } catch {
      renderGate("Your sign-in could not be restored. Please sign in again.");
    }
  }

  async function signIn(form: HTMLFormElement): Promise<void> {
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
    const email = new FormData(form).get("email");
    const password = new FormData(form).get("password");
    if (typeof email !== "string" || typeof password !== "string") return;
    if (submit) { submit.disabled = true; submit.textContent = "Signing in…"; }
    try {
      const result = await auth.signIn.email({ email: email.trim(), password }) as AuthResult<SessionEnvelope>;
      if (result.error) throw new Error(result.error.message || "Sign-in failed.");
      const session = result.data?.user ? result.data : (await auth.getSession() as AuthResult<SessionEnvelope>).data;
      if (!session?.user?.id) throw new Error("The sign-in succeeded but no user session was returned.");
      await authorize(session.user);
    } catch (error) {
      renderGate(error instanceof Error ? error.message : "Sign-in failed. Check the credentials and try again.");
    }
  }
  signInHandler = signIn;

  async function authorize(user: AuthUser): Promise<void> {
    const token = await neonAuth.getJWTToken();
    if (!token) {
      renderGate("A valid sign-in token could not be created. Please sign in again.");
      return;
    }
    let access;
    try {
      access = await requestEditorAccess(fetch, apiUrl, token);
    } catch (error) {
      if (error instanceof BridgeHttpError && error.status === 401) {
        renderGate("Your sign-in expired. Please sign in again.");
      } else {
        renderGate(error instanceof Error ? error.message : "The game Bridge could not authorize this editor session.");
      }
      return;
    }

    const actions: BridgeActions = {
      publish: request => {
        if (!canPublish()) {
          window.alert("This account can use MeowEdit but is not authorized to publish game content.");
          return;
        }
        openPublishDialog(request);
      },
      signOut: () => {
        void auth.signOut().finally(() => {
          resetBridgeFetch();
          resetBridgeState();
          window.location.reload();
        });
      }
    };
    // The server response is authoritative for identity; the cached session is only a fallback.
    setBridgeState({ userId: access.userId || user.id, canPublish: access.canPublish === true, actions });
    setBridgeFetch(async (path, init) => {
      const token = await neonAuth.getJWTToken();
      if (!token) throw new Error("Your sign-in expired. Sign out and sign in again.");
      return fetch(apiUrl + path, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: "Bearer " + token }
      });
    });
    await import("./main");
  }

  function openPublishDialog(request: BridgePublishRequest): void {
    pendingPublishRequest = request;
    let dialog = document.querySelector<HTMLDialogElement>("#bridge-publish-dialog");
    if (!dialog) {
      document.body.insertAdjacentHTML("beforeend",
        '<dialog class="bridge-publish-dialog" id="bridge-publish-dialog"><form method="dialog" id="bridge-publish-form"><span class="bridge-kicker">MEOWEDIT · TACTICS BRIDGE</span><h2>Publish campaign revision</h2><p>Upload an immutable package, then make it the latest revision for this campaign set. Existing runs remain pinned to their original package.</p><label>Campaign set ID<input name="campaignSetId" value="character-missions" pattern="[a-z0-9][a-z0-9._-]{0,63}" required></label><p class="bridge-publish-status" role="status"></p><div class="bridge-publish-actions"><button type="button" data-bridge-close>Cancel</button><button type="submit">Upload &amp; publish</button></div></form></dialog>');
      dialog = document.querySelector<HTMLDialogElement>("#bridge-publish-dialog")!;
      dialog.querySelector<HTMLButtonElement>("[data-bridge-close]")?.addEventListener("click", () => dialog?.close());
      dialog.querySelector<HTMLFormElement>("#bridge-publish-form")?.addEventListener("submit", event => {
        event.preventDefault();
        if (pendingPublishRequest) void publish(dialog!, pendingPublishRequest);
      });
    }
    const status = dialog.querySelector<HTMLElement>(".bridge-publish-status");
    if (status) status.textContent = "";
    dialog.showModal();
  }

  async function publish(dialog: HTMLDialogElement, request: BridgePublishRequest): Promise<void> {
    const form = dialog.querySelector<HTMLFormElement>("#bridge-publish-form")!;
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const status = form.querySelector<HTMLElement>(".bridge-publish-status")!;
    const campaignSetId = String(new FormData(form).get("campaignSetId") ?? "");
    submit.disabled = true;
    status.textContent = "Validating and uploading package…";
    try {
      const token = await neonAuth.getJWTToken();
      if (!token) throw new Error("Your sign-in expired. Sign out and sign in again.");
      const payload: BridgePackagePayload = await createBridgePackagePayload(campaignSetId, request.workspace, request.roster);
      const uploaded = await uploadBridgePackage(fetch, apiUrl, token, payload);
      if (uploaded.alreadyPublished) {
        status.textContent = "This exact revision is already published: " + uploaded.packageId + ". No new revision was created.";
        return;
      }
      status.textContent = "Package stored. Publishing revision…";
      await publishBridgePackage(fetch, apiUrl, token, uploaded.packageId);
      status.textContent = "Published " + uploaded.packageId + ". New game runs can download it; existing runs stay pinned.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Publishing failed.";
    } finally {
      submit.disabled = false;
    }
  }
}
