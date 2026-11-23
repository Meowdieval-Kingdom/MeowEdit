import "./app.css";
import {
  canDeleteSets, canPublish, getBridgeActions, getBridgeFetch, getBridgeUserId
} from "../bridge-context";
import {
  createSetRequest, isDraftConflict, publishRequest, saveDraftRequest,
  type ContentRevisionListResponse, type RepointRequest
} from "./endpoints";
import { emptyContentSet, namedRef } from "./factory";
import { escapeHtml } from "./html";
import { withDeadline } from "../request-timeout";
import { APP_VERSION } from "./version";
import { packContentSet } from "./packer";
import { loadSession, saveSession } from "./session";
import { gameCapabilitiesSchema } from "./zod";
import type { ContentSetDocument, GameCapabilities } from "./types";
import { validateContentSet, type ValidationResult } from "./validation";
import { hasUnsyncedWorkspace, loadWorkspace, markWorkspaceSynced } from "../legacy/workspace-store";
import { workspaceToDraft } from "../legacy/convert";

interface SetSummary {
  setId: string;
  name?: string;
  draftVersion: number;
  publishedPackageId?: string;
  updatedAt?: string;
}

interface LocalRecord {
  draft: ContentSetDocument;
  draftVersion: number;
  publishedPackageId?: string;
}

interface AppState {
  capabilities: GameCapabilities;
  sets: SetSummary[];
  view: "browser" | "set";
  setId: string;
  draft: ContentSetDocument;
  draftVersion: number;
  publishedPackageId?: string;
  status: string;
  validation: ValidationResult;
  help: boolean;
  savedAt: string | null;
}

type DetailSection = "campaigns" | "quests" | "armies" | "dialogues";
const SECTION_LABELS: Record<DetailSection, string> = {
  campaigns: "Campaign", quests: "Quest", armies: "Army", dialogues: "Dialogue"
};
const SECTIONS = Object.keys(SECTION_LABELS) as DetailSection[];

function localKey(): string {
  return "meowedit.content.sets." + (getBridgeUserId() ?? "local");
}

function storage(): Record<string, LocalRecord> {
  try {
    return JSON.parse(localStorage.getItem(localKey()) ?? "{}") as Record<string, LocalRecord>;
  } catch {
    return {};
  }
}

function writeSession(state: AppState): void {
  saveSession({
    view: state.view, help: state.help, savedAt: state.savedAt, setId: state.setId || null
  });
}

function syncSession(state: AppState): void {
  state.savedAt = new Date().toISOString();
  writeSession(state);
}

function persistLocal(state: AppState): void {
  const records = storage();
  records[state.setId] = {
    draft: state.draft,
    draftVersion: state.draftVersion,
    publishedPackageId: state.publishedPackageId
  };
  try {
    localStorage.setItem(localKey(), JSON.stringify(records));
    syncSession(state);
  } catch {
    state.status = "Local storage is full; the draft could not be cached.";
    showToast("Local storage is full. Changes may not be saved.", "warning");
  }
}

function showToast(message: string, kind: "success" | "warning" | "error" = "success"): void {
  let region = document.querySelector<HTMLElement>("#toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const toast = document.createElement("div");
  toast.className = "toast" + (kind === "success" ? "" : " toast-" + kind);
  toast.innerHTML = '<span class="toast-mark">' + (kind === "success" ? "✓" : "!") + "</span><span>" + escapeHtml(message) + "</span>";
  region.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/** Carries the HTTP status so callers can distinguish an unsupported route from a real failure. */
class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "RequestError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const request = getBridgeFetch();
  if (!request) throw new Error("The authenticated Bridge connection is unavailable.");
  const { response, body } = await withDeadline(async signal => {
    const result = await request(path, { ...init, signal });
    return { response: result, body: await result.json().catch(() => null) as (T & { error?: string }) | null };
  }, undefined, init?.signal);
  if (!response.ok) throw new RequestError(body?.error ?? "The request failed (" + response.status + ").", response.status, body);
  return body as T;
}

async function loadCapabilities(): Promise<GameCapabilities> {
  let raw: unknown;
  try {
    raw = await requestJson<unknown>("/v1/editor/capabilities");
  } catch {
    const response = await withDeadline(signal =>
      fetch("./game-capabilities.json", { cache: "no-cache", signal }), 10_000);
    if (!response.ok) throw new Error("No capability manifest is available.");
    raw = await response.json();
  }
  const parsed = gameCapabilitiesSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("The capability manifest is invalid: " + (parsed.error.issues[0]?.message ?? "unknown shape"));
  return parsed.data;
}

function newCampaign(id: string, name: string, capabilities: GameCapabilities): ContentSetDocument["campaigns"][number] {
  return {
    schemaVersion: 2, id, name: { default: name, locales: {} }, description: { default: "", locales: {} },
    boardPreviewUnitId: namedRef(capabilities.ids.units[0] ?? "unknown-unit"),
    questIds: [],
    floors: [{
      id: "floor-1", number: 1, mode: capabilities.enums.floorMode[0], questPoolMode: "campaign",
      questPoolIds: [], shopPoolMode: "campaign", shopPoolKinds: [capabilities.enums.shopPoolKind[0]],
      shopLevel: 1, randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 },
      nodes: [], routes: []
    }],
    events: [],
    settings: {
      startingLives: 3, startingSardines: 10, startingNodeCount: 12,
      playerFactionId: namedRef(capabilities.ids.factions[0] ?? "unknown-faction"),
      factionSelectionEnabled: true, battleShopEnabled: true,
      shopPoolKinds: [capabilities.enums.shopPoolKind[0]],
      questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3,
      nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
      blessingsEnabled: true, restoreArmyAfterLoss: true,
      sardinePayoutEnabled: true, sardinePayoutBase: 10, sardinePayoutPerFloor: 1
    }
  };
}

function badge(summary: SetSummary): string {
  if (summary.publishedPackageId) return '<span class="set-badge published">Published</span>';
  if (summary.draftVersion > 0) return '<span class="set-badge draft">Draft v' + summary.draftVersion + "</span>";
  return '<span class="set-badge local">Local only</span>';
}

function entryCount(draft: ContentSetDocument, section: DetailSection): number {
  return draft[section].length;
}

function entryLabel(draft: ContentSetDocument, section: DetailSection, index: number): string {
  const item = draft[section][index] as unknown as Record<string, unknown> | undefined;
  if (!item) return "(missing)";
  if (section === "dialogues") return String((item.sequenceId as string) ?? "");
  const name = item.name ?? item.title;
  return String((name as { default?: string } | undefined)?.default ?? item.id ?? "");
}

function renderBrowser(container: HTMLElement, state: AppState): void {
  const records = storage();
  const sets = [...state.sets];
  for (const [setId, record] of Object.entries(records))
    if (!sets.some(item => item.setId === setId))
      sets.push({
        setId, name: record.draft.set.name.default || setId,
        draftVersion: record.draftVersion, publishedPackageId: record.publishedPackageId
      });
  const rows = sets.length ? sets.map(summary =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(summary.name || summary.setId) + "</strong>" +
    "<small>" + escapeHtml(summary.setId) + "</small></div>" +
    badge(summary) +
    '<button type="button" class="text-button" data-rename="' + escapeHtml(summary.setId) + '">Rename</button>' +
    (canDeleteSets()
      ? '<button type="button" class="text-button danger-text" data-delete="' + escapeHtml(summary.setId) + '">'
        + (summary.publishedPackageId ? "Unpublish" : "Delete") + '</button>'
        + (summary.publishedPackageId
          ? '<button type="button" class="text-button" data-revisions="' + escapeHtml(summary.setId) + '">Revisions</button>'
          : "")
      : "") +
    '<button type="button" class="button button-outline" data-open="' + escapeHtml(summary.setId) + '">Open</button></div>' +
    '<div class="set-revisions" data-revision-panel="' + escapeHtml(summary.setId) + '" hidden></div>'
  ).join("") : '<div class="set-empty">No content sets yet. Create one to start authoring.</div>';

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">CONTENT SETS</span></div><div class="topbar-actions">' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>Your content sets</h1>' +
    "<p>Create, rename, open and publish sets. Drafts stay private until you publish.</p></div>" +
    '<button type="button" class="button button-primary" data-new-set>+ New set</button></div>' +
    '<div class="set-list">' + rows + "</div>" +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";
  writeSession(state);

  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-new-set]")?.addEventListener("click", () => {
    void createSet(container, state);
  });
  container.querySelectorAll<HTMLElement>("[data-open]").forEach(button => button.addEventListener("click", () => {
    void openSet(container, state, button.dataset.open!);
  }));
  container.querySelectorAll<HTMLElement>("[data-rename]").forEach(button => button.addEventListener("click", () => {
    void renameSet(container, state, button.dataset.rename!);
  }));
  container.querySelectorAll<HTMLElement>("[data-delete]").forEach(button => button.addEventListener("click", () => {
    void deleteSet(container, state, button.dataset.delete!);
  }));
  container.querySelectorAll<HTMLElement>("[data-revisions]").forEach(button => button.addEventListener("click", () => {
    void showRevisions(container, state, button.dataset.revisions!);
  }));
}

async function createSet(container: HTMLElement, state: AppState): Promise<void> {
  const id = window.prompt("Content set ID (lowercase letters, numbers, -, _, .):")?.trim().toLowerCase() ?? "";
  if (!id || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    state.status = "Enter a valid set ID.";
    renderBrowser(container, state);
    return;
  }
  const name = window.prompt("Set name:", id)?.trim() || id;
  const draft = emptyContentSet(id, name);
  draft.campaigns.push(newCampaign("campaign-1", "First campaign", state.capabilities));
  draft.set.campaignOrder = [draft.campaigns[0].id];
  state.setId = id;
  state.draft = draft;
  state.draftVersion = 0;
  state.publishedPackageId = undefined;
  state.validation = validateContentSet(draft, state.capabilities);
  persistLocal(state);
  await refreshSets(state);
  await openSet(container, state, id);
}

async function renameSet(container: HTMLElement, state: AppState, setId: string): Promise<void> {
  const records = storage();
  const summary = state.sets.find(item => item.setId === setId);
  const current = records[setId]?.draft.set.name.default || summary?.name || setId;
  const name = window.prompt("New name for " + setId + ":", current)?.trim();
  if (!name) return;
  let draft = records[setId]?.draft;
  let version = records[setId]?.draftVersion ?? 0;
  if (summary && summary.draftVersion > 0) {
    try {
      const loaded = await requestJson<{ draft: ContentSetDocument; draftVersion: number }>(
        "/v1/editor/campaign-sets/" + encodeURIComponent(setId));
      draft = loaded.draft;
      version = loaded.draftVersion;
    } catch (error) {
      state.status = error instanceof Error ? error.message : "The draft could not be loaded.";
      renderBrowser(container, state);
      return;
    }
  }
  if (!draft) {
    state.status = "This set has no draft to rename.";
    renderBrowser(container, state);
    return;
  }
  draft.set.name.default = name;
  try {
    if (version > 0) {
      const result = await requestJson<{ draftVersion: number }>(
        "/v1/editor/campaign-sets/" + encodeURIComponent(setId), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saveDraftRequest(version, draft))
        });
      version = result.draftVersion;
    }
    records[setId] = { draft, draftVersion: version, publishedPackageId: summary?.publishedPackageId };
    localStorage.setItem(localKey(), JSON.stringify(records));
    state.status = "Renamed to " + name + ".";
    await refreshSets(state);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Rename failed.";
  }
  renderBrowser(container, state);
}

async function showRevisions(container: HTMLElement, state: AppState, setId: string): Promise<void> {
  if (!canDeleteSets()) return;
  const panel = container.querySelector<HTMLElement>('[data-revision-panel="' + CSS.escape(setId) + '"]');
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  try {
    const result = await requestJson<ContentRevisionListResponse>(
      "/v1/editor/campaign-sets/" + encodeURIComponent(setId) + "/revisions");
    const revisions = result.revisions;
    panel.innerHTML = revisions.length
      ? '<div class="revision-list">' + revisions.map(revision =>
          '<div class="revision-row"><code>' + escapeHtml(revision.packageId) + "</code>"
          + "<small>" + escapeHtml(revision.publishedAt) + (revision.isCurrent ? " — current" : "") + "</small>"
          + (revision.isCurrent ? "" :
            '<button type="button" class="text-button" data-repoint="'
            + escapeHtml(setId) + '" data-package="' + escapeHtml(revision.packageId)
            + '">Restore</button>')
          + "</div>").join("") + "</div>"
      : '<p>No published revisions for this set.</p>';
    panel.hidden = false;
    panel.querySelectorAll<HTMLElement>("[data-repoint]").forEach(button =>
      button.addEventListener("click", () => void repointSet(container, state,
        button.dataset.repoint!, button.dataset.package!)));
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Could not load revisions.";
    renderBrowser(container, state);
  }
}

async function repointSet(container: HTMLElement, state: AppState, setId: string, packageId: string): Promise<void> {
  if (!canDeleteSets()) return;
  if (!window.confirm("Restore revision " + packageId + "? Players will receive it on next refresh.")) return;
  const request: RepointRequest = { schemaVersion: 2, packageId };
  try {
    await requestJson("/v1/editor/campaign-sets/" + encodeURIComponent(setId) + "/repoint",
      { method: "POST", body: JSON.stringify(request) });
    state.status = "Restored " + packageId + ".";
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Restore failed.";
  }
  await refreshSets(state);
  renderBrowser(container, state);
}

async function deleteSet(container: HTMLElement, state: AppState, setId: string): Promise<void> {
  if (!canDeleteSets()) return;
  const summary = state.sets.find(item => item.setId === setId);
  if (summary?.publishedPackageId) {
    if (!window.confirm("Unpublish content set '" + setId + "'? Players will stop receiving it; revisions are kept and can be restored.")) return;
  } else if (!window.confirm("Delete draft content set '" + setId + "'? This cannot be undone.")) return;
  const records = storage();
  const version = records[setId]?.draftVersion ?? state.sets.find(item => item.setId === setId)?.draftVersion ?? 0;
  try {
    if (version > 0)
      await requestJson<{ deleted: boolean }>("/v1/editor/campaign-sets/" + encodeURIComponent(setId), { method: "DELETE" });
  } catch (error) {
    state.status = error instanceof Error ? error.message : "The request failed; nothing was removed.";
    renderBrowser(container, state);
    return;
  }
  if (summary?.publishedPackageId) {
    state.status = state.status || "Unpublished " + setId + "; revisions are kept and can be restored.";
  } else {
    delete records[setId];
    try {
      localStorage.setItem(localKey(), JSON.stringify(records));
    } catch {
      state.status = "Deleted " + setId + " on the server; the local cache could not be updated.";
    }
    if (!state.status) state.status = "Deleted " + setId + ".";
  }
  await refreshSets(state);
  renderBrowser(container, state);
}

async function openSet(container: HTMLElement, state: AppState, setId: string): Promise<void> {
  const records = storage();
  const local = records[setId];
  const summary = state.sets.find(item => item.setId === setId);
  let draft: ContentSetDocument | undefined;
  let version = local?.draftVersion ?? 0;
  const published = local?.publishedPackageId ?? summary?.publishedPackageId;
  if ((summary?.draftVersion ?? local?.draftVersion ?? 0) > 0) {
    try {
      const loaded = await requestJson<{ draftVersion: number; draft: ContentSetDocument }>(
        "/v1/editor/campaign-sets/" + encodeURIComponent(setId));
      draft = loaded.draft;
      version = loaded.draftVersion;
    } catch (error) {
      state.status = error instanceof Error
        ? "The saved draft could not be loaded: " + error.message
        : "The saved draft could not be loaded. The local copy was not opened.";
      showToast("Could not load the saved draft. The local copy was not opened.", "error");
      renderBrowser(container, state);
      return;
    }
  } else {
    draft = local?.draft;
  }
  state.setId = setId;
  if (draft && hasUnsyncedWorkspace(setId)) {
    try {
      const workspace = loadWorkspace(setId, draft, state.capabilities);
      workspaceToDraft(draft, workspace, state.capabilities);
      markWorkspaceSynced(setId, version);
      localStorage.setItem(localKey(), JSON.stringify({
        ...storage(), [setId]: { draft, draftVersion: version, publishedPackageId: published }
      }));
      showToast("Restored unsaved editor changes into this set.");
    } catch {
      // If reconciliation fails, the cloud draft remains authoritative.
    }
  }
  if (!draft) {
    draft = emptyContentSet(setId, setId);
    draft.campaigns.push(newCampaign("campaign-1", "First campaign", state.capabilities));
    draft.set.campaignOrder = [draft.campaigns[0].id];
  }
  state.draft = draft;
  state.draft.set.setId = setId;
  state.draftVersion = version;
  state.publishedPackageId = published;
  state.view = "set";
  state.validation = validateContentSet(draft, state.capabilities);
  renderSetView(container, state);
}

function renderSetView(container: HTMLElement, state: AppState): void {
  const draft = state.draft;
  const tabs = SECTIONS.map(section =>
    '<button type="button" class="button button-outline" data-section="' + section + '">' +
    SECTION_LABELS[section] + " (" + entryCount(draft, section) + ")</button>").join("");
  const rows = SECTIONS.map(section => {
    const items = draft[section];
    return '<div class="set-group"><h3>' + SECTION_LABELS[section] + "</h3>" +
      (items.length ? items.map((_, index) =>
        '<div class="set-row"><div class="set-row-main"><strong>' +
        escapeHtml(entryLabel(draft, section, index)) + "</strong></div>" +
        '<button type="button" class="text-button" data-edit="' + section + ":" + index + '">Edit</button></div>').join("")
        : '<div class="set-empty">No ' + section + " yet.</div>") + "</div>";
  }).join("");
  const issues = state.validation.issues;
  const validation = issues.length
    ? '<ul class="validation-issue-list">' + issues.slice(0, 8).map(issue =>
      '<li class="validation-issue"><span class="validation-issue-title">' + escapeHtml(issue.message) + "</span></li>").join("") + "</ul>"
    : '<p class="step-copy">No validation issues. This set is ready to save and publish.</p>';

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">' + escapeHtml(state.setId) + '</span></div><div class="topbar-actions">' +
    '<button type="button" class="text-button" data-back-browser>Sets</button>' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>' +
    escapeHtml(draft.set.name.default || state.setId) + "</h1><p>" +
    draft.campaigns.length + " campaigns · " + draft.quests.length + " quests · " +
    draft.armies.length + " armies · " + draft.dialogues.length + " dialogues</p></div>" +
    '<button type="button" class="button button-primary" data-open-editor>Open editor</button></div>' +
    '<div class="guided-actions">' + tabs + "</div>" + rows +
    '<section class="content-validation"><h2>Validation</h2>' + validation + "</section>" +
    '<div class="guided-actions"><button type="button" class="button button-outline" data-save>Save / Upload</button>' +
    '<button type="button" class="button button-primary" data-publish' +
    (canPublish() && state.validation.valid ? "" : " disabled") + ">Publish</button></div>" +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";
  writeSession(state);

  container.querySelector<HTMLElement>("[data-back-browser]")?.addEventListener("click", () => {
    state.view = "browser";
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderSetView(container, state);
  });
  container.querySelector<HTMLElement>("[data-open-editor]")?.addEventListener("click", () => {
    void openClassicEditor(container, state);
  });
  container.querySelectorAll<HTMLElement>("[data-edit]").forEach(button => button.addEventListener("click", () => {
    const [section, index] = button.dataset.edit!.split(":");
    void openClassicEditor(container, state, { section: section as DetailSection, index: Number(index) });
  }));
  container.querySelector<HTMLElement>("[data-save]")?.addEventListener("click", () => { void saveDraft(state).then(() => flashStatus(container, state)); });
  container.querySelector<HTMLElement>("[data-publish]")?.addEventListener("click", () => { void publishDraft(state).then(() => flashStatus(container, state)); });
}

function flashStatus(container: HTMLElement, state: AppState): void {
  const element = container.querySelector<HTMLElement>("[data-status]");
  if (element) element.textContent = state.status;
}

/** Opens the single classic editor, which owns both Guided and Full modes per category. */
async function openClassicEditor(container: HTMLElement, state: AppState, selected?: { section: string; index: number }): Promise<void> {
  try {
    const { mountLegacyEditor } = await import("../legacy/main");
    mountLegacyEditor({
      setId: state.setId,
      draft: state.draft,
      capabilities: state.capabilities,
      selected,
      onSave: () => saveDraft(state),
      onDraftChange: () => {
        state.validation = validateContentSet(state.draft, state.capabilities);
        persistLocal(state);
      },
      onBack: () => renderSetView(container, state),
      onPublish: () => publishDraft(state),
      canPublishEditor: () => state.validation.valid && canPublish()
    });
  } catch (error) {
    state.status = error instanceof Error ? error.message : "The editor could not be opened.";
    renderSetView(container, state);
  }
}

async function saveDraft(state: AppState): Promise<string> {
  if (!state.validation.valid) {
    state.status = "Fix the validation issues before uploading.";
    return state.status;
  }
  try {
    const creating = state.draftVersion === 0;
    const request = creating
      ? createSetRequest(state.setId, state.draft)
      : saveDraftRequest(state.draftVersion, state.draft);
    const result = await requestJson<{ draftVersion: number; currentVersion?: number; code?: string }>(
      creating ? "/v1/editor/campaign-sets" : "/v1/editor/campaign-sets/" + encodeURIComponent(state.setId),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }
    );
    if (isDraftConflict(result)) {
      state.status = "Draft conflict: the server is at version " + result.currentVersion + ". Reopen the set to refresh.";
      return state.status;
    }
    state.draftVersion = result.draftVersion;
    state.status = "Saved as private draft v" + result.draftVersion + ".";
    markWorkspaceSynced(state.setId, state.draftVersion);
    persistLocal(state);
    await refreshSets(state);
    return state.status;
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) {
      const conflict = error.body as { currentVersion?: number } | undefined;
      state.status = "Draft conflict: the server is at version " + (conflict?.currentVersion ?? "?") + ". Reopen the set to refresh.";
    } else {
      state.status = error instanceof Error ? error.message : "Upload failed.";
    }
    return state.status;
  }
}

async function publishDraft(state: AppState): Promise<string> {
  if (!canPublish() || !state.validation.valid) return state.status;
  const confirmed = window.confirm(
    "Publishing resets tester progress. Saves with a different content hash will be deleted at the Adventure gate. Continue?"
  );
  if (!confirmed) {
    state.status = "Publish cancelled.";
    return state.status;
  }
  try {
    const result = await requestJson<{ packageId: string; contentHash?: string }>(
      "/v1/editor/campaign-sets/" + encodeURIComponent(state.setId) + "/publish",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publishRequest(state.draftVersion)) }
    );
    const packed = await packContentSet(state.draft, state.capabilities);
    state.publishedPackageId = result.packageId;
    state.status = "Published " + result.packageId +
      (result.contentHash === packed.contentHash ? " (hash verified)" : " (HASH MISMATCH)") + ".";
    markWorkspaceSynced(state.setId, state.draftVersion);
    persistLocal(state);
    await refreshSets(state);
    return state.status;
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) {
      state.status = "Draft conflict: reload the set before publishing.";
    } else {
      state.status = error instanceof Error ? error.message : "Publish failed.";
    }
    return state.status;
  }
}

async function refreshSets(state: AppState): Promise<void> {
  try {
    const result = await requestJson<{ sets: SetSummary[] }>("/v1/editor/campaign-sets");
    state.sets = result.sets;
  } catch {
    // Keep the last known list; local drafts remain visible.
  }
}

/** Mounts the set manager into the app root after authentication. */
export async function mountApp(container: HTMLElement): Promise<void> {
  const capabilities = await loadCapabilities();
  const session = loadSession();
  const state: AppState = {
    capabilities, sets: [], view: "browser", setId: "", draft: emptyContentSet("", ""),
    draftVersion: 0, status: "", validation: { valid: false, issues: [] },
    help: session.help, savedAt: session.savedAt
  };
  await refreshSets(state);
  renderBrowser(container, state);
  if (session.view !== "browser" && session.setId && state.sets.some(item => item.setId === session.setId))
    await openSet(container, state, session.setId);
}
