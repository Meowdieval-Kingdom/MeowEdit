import "./app.css";
import {
  canDeleteSets, canPublish, getBridgeActions, getBridgeFetch, getBridgeUserId
} from "../bridge-context";
import {
  createSetRequest, isDraftConflict, publishRequest, saveDraftRequest
} from "./endpoints";
import { emptyContentSet, namedRef } from "./factory";
import { escapeHtml } from "./html";
import { withDeadline } from "../request-timeout";
import { APP_VERSION } from "./version";
import { loadSession, saveSession, type EditorTabState, type LastEdited, type PendingEdit } from "./session";
import { loadPublishedSnapshot, savePublishedSnapshot } from "./snapshots";
import { gameCapabilitiesSchema } from "./zod";
import type { ContentSetDocument, GameCapabilities } from "./types";
import { validateContentSet, type ValidationResult } from "./validation";
import {
  clearWorkspace, hasUnsyncedWorkspace, loadScratchWorkspace, loadWorkspace, markWorkspaceSynced,
  saveScratchWorkspace, SCRATCH_WORKSPACE
} from "../editor/workspace-store";
import { draftToWorkspace, workspaceToDraft } from "../editor/convert";
import { createMissionFloor } from "../editor/mission-domain";
import {
  activeArmyJson, activeMissionJson, activeDialogueJson, activeQuestJson,
  parseImportedJson, decodeZipText
} from "../editor/export";
import { readStoredZip } from "../editor/zip";
import { reloadForStaleChunk } from "../stale-chunk";
import type { Workspace } from "../editor/model";

interface SetSummary {
  setId: string;
  name?: string;
  kind?: "missions" | "data";
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
  activeSection: DetailSection;
  setId: string;
  draft: ContentSetDocument;
  draftVersion: number;
  publishedPackageId?: string;
  status: string;
  validation: ValidationResult;
  help: boolean;
  savedAt: string | null;
  lastEdited: LastEdited | null;
  recent: LastEdited[];
  pending: PendingEdit[];
  unpublished: string[];
  tabs: Record<string, EditorTabState[]>;
  dashboardTab: "unsaved" | "unpublished" | "local" | "cloud";
  dirty: boolean;
  baseline: ContentSetDocument | null;
}

type DetailSection = "missions" | "quests" | "armies" | "dialogues";
const SECTION_LABELS: Record<DetailSection, string> = {
  missions: "Mission", quests: "Quest", armies: "Army", dialogues: "Dialogue"
};
const SECTION_SINGULAR: Record<DetailSection, "mission" | "quest" | "army" | "dialogue"> = {
  missions: "mission", quests: "quest", armies: "army", dialogues: "dialogue"
};
const SECTIONS = Object.keys(SECTION_LABELS) as DetailSection[];

/** Hash routes keep screens, records and guided steps usable with browser Back/Forward. */
type AppRoute =
  | { kind: "browser" }
  | { kind: "set"; setId: string }
  | { kind: "editor"; workspace: string; section?: DetailSection; key?: string; step?: number; mode?: "guided" | "full" };

let routeHash = "#/";
let restoringRoute = false;
let popStateBound = false;
let appContainer: HTMLElement | null = null;
let appState: AppState | null = null;
let activeEditorRoute: Extract<AppRoute, { kind: "editor" }> | null = null;
let editorMountPending = false;

function routeHashOf(route: AppRoute): string {
  if (route.kind === "browser") return "#/";
  if (route.kind === "set") return "#/set/" + encodeURIComponent(route.setId);
  const base = "#/edit/" + encodeURIComponent(route.workspace) +
    (route.section && route.key ? "/" + encodeURIComponent(route.section) + "/" + encodeURIComponent(route.key) : "");
  const query = new URLSearchParams();
  if (route.step !== undefined) query.set("step", String(route.step));
  if (route.mode) query.set("mode", route.mode);
  return query.toString() ? base + "?" + query.toString() : base;
}

function parseRouteHash(hash: string): AppRoute | null {
  const [path, queryString] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  let decoded: string[];
  try { decoded = parts.map(decodeURIComponent); } catch { return null; }
  const query = new URLSearchParams(queryString ?? "");
  const step = query.has("step") ? Number(query.get("step")) : undefined;
  const mode = query.get("mode");
  if (decoded.length === 0) return { kind: "browser" };
  if (decoded[0] === "set" && decoded[1]) return { kind: "set", setId: decoded[1] };
  if (decoded[0] === "edit" && decoded[1]) return {
    kind: "editor", workspace: decoded[1],
    section: decoded[2] as DetailSection | undefined,
    key: decoded[3],
    step: step !== undefined && Number.isFinite(step) ? Math.max(0, step) : undefined,
    mode: mode === "guided" || mode === "full" ? mode : undefined
  };
  return null;
}

/** Records a navigation. Restoration from popstate never pushes. */
function pushRoute(route: AppRoute): void {
  if (restoringRoute) return;
  const hash = routeHashOf(route);
  if (hash === routeHash) return;
  routeHash = hash;
  history.pushState(null, "", hash);
}

/** Adds step/mode to the entry just created for a freshly mounted editor. */
function replaceRoute(route: AppRoute): void {
  if (restoringRoute) return;
  const hash = routeHashOf(route);
  if (hash === routeHash) return;
  routeHash = hash;
  history.replaceState(null, "", hash);
}

function editorNavigation(route: Extract<AppRoute, { kind: "editor" }>, navigation: { step: number; mode: "guided" | "full" }): void {
  const withNav = { ...(activeEditorRoute ?? route), step: navigation.step, mode: navigation.mode };
  activeEditorRoute = withNav;
  if (editorMountPending) {
    editorMountPending = false;
    replaceRoute(withNav);
  } else pushRoute(withNav);
}

function localKey(): string {
  return "meowedit.v2.sets." + (getBridgeUserId() ?? "local");
}

function isCurrentDraft(value: unknown): value is ContentSetDocument {
  const draft = value as Partial<ContentSetDocument> | null;
  return !!draft && draft.schemaVersion === 2 && !!draft.set &&
    (draft.set.kind === "missions" || draft.set.kind === "data") &&
    Array.isArray(draft.quests) && Array.isArray(draft.armies) &&
    Array.isArray(draft.missions) && Array.isArray(draft.dialogues);
}

function rawStorage(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(localKey()) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Drop stale cached drafts once at startup so no reader has to guard against them. */
function pruneStaleDrafts(): void {
  const raw = rawStorage();
  let changed = false;
  for (const [setId, value] of Object.entries(raw)) {
    if (!isCurrentDraft((value as Partial<LocalRecord> | null)?.draft)) {
      delete raw[setId];
      changed = true;
    }
  }
  if (changed) localStorage.setItem(localKey(), JSON.stringify(raw));
}

function storage(): Record<string, LocalRecord> {
  return rawStorage() as Record<string, LocalRecord>;
}

function writeSession(state: AppState): void {
  saveSession({
    help: state.help, savedAt: state.savedAt, setId: state.setId || null,
    lastEdited: state.lastEdited, recent: state.recent,
    pending: state.pending, unpublished: state.unpublished, tabs: state.tabs
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
  let fromBridge = true;
  try {
    raw = await requestJson<unknown>("/v1/editor/capabilities");
  } catch {
    fromBridge = false;
    const response = await withDeadline(signal =>
      fetch("./game-capabilities.json", { cache: "no-cache", signal }), 10_000);
    if (!response.ok) throw new Error("No capability manifest is available.");
    raw = await response.json();
  }
  const parsed = gameCapabilitiesSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("The capability manifest is invalid: " + (parsed.error.issues[0]?.message ?? "unknown shape"));
  const capabilities = parsed.data;
  if (fromBridge) {
    // The Bridge can serve an older manifest that predates level-2 unit ids.
    // Union in the bundled catalog's ids so valid authored refs still resolve;
    // genuinely unknown ids are still rejected by validation.
    try {
      const bundledResponse = await withDeadline(signal =>
        fetch("./game-capabilities.json", { cache: "no-cache", signal }), 10_000);
      if (bundledResponse.ok) {
        const bundled = gameCapabilitiesSchema.safeParse(await bundledResponse.json());
        if (bundled.success) {
          const keys: Array<keyof GameCapabilities["ids"]> = ["units", "blessings", "curses", "spells", "factions"];
          for (const key of keys)
            capabilities.ids[key] = [...new Set([...capabilities.ids[key], ...bundled.data.ids[key]])];
        }
      }
    } catch {
      // Keep the authoritative Bridge ids when the bundled copy is unavailable.
    }
  }
  return capabilities;
}

function newMission(id: string, name: string, capabilities: GameCapabilities): ContentSetDocument["missions"][number] {
  return {
    schemaVersion: 2, id, name: { default: name, locales: {} }, description: { default: "", locales: {} },
    boardPreviewUnitId: namedRef(capabilities.ids.units[0] ?? "unknown-unit"),
    questIds: [],
    floors: [{
      id: "floor-1", number: 1, mode: capabilities.enums.floorMode[0], questPoolMode: "mission",
      questPoolIds: [], shopPoolMode: "mission", shopPoolKinds: [capabilities.enums.shopPoolKind[0]],
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

function scratchRecords(): Array<{ section: DetailSection; key: string; label: string }> {
  const workspace = loadScratchWorkspace();
  const records: Array<{ section: DetailSection; key: string; label: string }> = [];
  for (const section of SECTIONS) {
    const items = workspace[section] as unknown as Array<Record<string, unknown>>;
    for (const item of items) {
      const key = String(item.key ?? "");
      const label = section === "dialogues"
        ? String((item.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? key)
        : section === "quests"
          ? String((item.definition as { title?: string } | undefined)?.title ?? key)
          : String((item.name as string | undefined) ?? key);
      records.push({ section, key, label });
    }
  }
  return records;
}

function recordEdited(state: AppState, entry: LastEdited): void {
  state.lastEdited = entry;
  const id = (item: LastEdited) => item.workspace + "|" + item.section + "|" + item.key;
  state.recent = [entry, ...state.recent.filter(item => id(item) !== id(entry))].slice(0, 5);
}

function syncEditorTabs(state: AppState, setId: string, tabs: EditorTabState[]): void {
  // Keep the existing array identity: the mounted editor holds a reference to it and
  // must see tab additions/closures on its next render without being remounted.
  const existing = state.tabs[setId];
  const limited = tabs.slice(-20);
  if (existing) existing.splice(0, existing.length, ...limited);
  else state.tabs = { ...state.tabs, [setId]: limited };
  syncSession(state);
}

/** Removes a closed tab from the mounted editor chrome without navigating away. */
function removeTabFromChrome(container: HTMLElement, key: string): void {
  container.querySelectorAll<HTMLElement>('[data-action="editor-close-tab"], .editor-tab')
    .forEach(element => { if (element.dataset.key === key) element.remove(); });
}

async function openTabTarget(container: HTMLElement, state: AppState, setId: string, tab: EditorTabState): Promise<void> {
  if (setId === SCRATCH_WORKSPACE) {
    const workspace = loadScratchWorkspace();
    const index = (workspace[tab.section] as unknown as Array<{ key?: string }>).findIndex(item => item.key === tab.key);
    if (index < 0) return;
    await openEditor(container, state, { workspace: setId, section: tab.section, index, key: tab.key, label: tab.label, step: tab.step, mode: tab.mode });
    return;
  }
  const record = storage()[setId];
  const draft = record?.draft ?? state.draft;
  const items = draft[tab.section] as unknown as Array<{ id?: string; sequenceId?: string }>;
  const index = items.findIndex(item => (item.id ?? item.sequenceId) === tab.key);
  if (index < 0) return;
  state.setId = setId;
  state.draft = draft;
  state.draftVersion = record?.draftVersion ?? state.draftVersion;
  await openEditor(container, state, { workspace: setId, section: tab.section, index, key: tab.key, label: tab.label, step: tab.step, mode: tab.mode });
}

function addEditorTab(state: AppState, setId: string, tab: EditorTabState): void {
  const current = state.tabs[setId] ?? [];
  const index = current.findIndex(item => item.section === tab.section && item.key === tab.key);
  // An existing tab keeps its slot; only genuinely new records are appended.
  const next = index < 0 ? [...current, tab]
    : current.map((item, position) => position === index ? { ...item, ...tab } : item);
  syncEditorTabs(state, setId, next);
}

function updateActiveTab(state: AppState, setId: string, key: string, patch: Partial<EditorTabState>): void {
  const tabs = (state.tabs[setId] ?? []).map(item => item.key === key ? { ...item, ...patch } : item);
  syncEditorTabs(state, setId, tabs);
}

function discardRecord(state: AppState, setId: string, section: string, key: string): void {
  const draft = storage()[setId]?.draft;
  if (!draft) return;
  const sectionKey = section as DetailSection;
  const workspace = loadWorkspace(setId, draft, state.capabilities);
  const items = workspace[sectionKey] as unknown as Array<Record<string, unknown>>;
  const index = items.findIndex(item => item.key === key || item.id === key ||
    (item.sequence as { sequenceId?: string } | undefined)?.sequenceId === key);
  const savedRecords = draft[sectionKey] as unknown[];
  if (index >= 0 && savedRecords[index]) {
    const savedWorkspace = draftToWorkspace(draft, state.capabilities);
    items[index] = (savedWorkspace[sectionKey] as unknown[])[index] as never;
    saveWorkspaceForSet(setId, workspace);
  }
  state.pending = state.pending.filter(item =>
    !(item.setId === setId && item.section === section && item.key === key));
  syncSession(state);
}

function pendingKey(entry: PendingEdit): string {
  return entry.setId + "|" + entry.section + "|" + entry.key;
}

function markRecordEdited(state: AppState, workspaceId: string, section: string, key: string): void {
  const draftSection = section as DetailSection;
  const label = state.recent.find(item =>
    item.workspace === workspaceId && item.section === draftSection && item.key === key)?.label ?? key;
  const entry: PendingEdit = { setId: workspaceId, workspace: workspaceId, section: draftSection, key, label };
  state.pending = [...state.pending.filter(item =>
    !(item.setId === workspaceId && item.section === section && item.key === key)), entry];
  state.recent = [entry, ...state.recent.filter(item =>
    !(item.workspace === workspaceId && item.section === section && item.key === key))].slice(0, 5);
  state.lastEdited = entry;
  syncSession(state);
}

function markSetSaved(state: AppState, setId: string): void {
  state.pending = state.pending.filter(item => item.setId !== setId);
  if (!state.unpublished.includes(setId)) state.unpublished = [...state.unpublished, setId];
  syncSession(state);
}

function unpublishedCount(setId: string): number {
  const published = loadPublishedSnapshot(setId);
  const current = storage()[setId]?.draft;
  if (!published || !current) return 0;
  let count = 0;
  for (const section of SECTIONS) {
    const before = published[section] as unknown[];
    const after = current[section] as unknown[];
    for (let index = 0; index < Math.max(before.length, after.length); index++)
      if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) count += 1;
  }
  return count;
}

function markSetPublished(state: AppState, setId: string): void {
  state.pending = state.pending.filter(item => item.setId !== setId);
  state.unpublished = state.unpublished.filter(id => id !== setId);
  syncSession(state);
}

/** Rebuilds an authoring draft from the live published package (no browser-local snapshot). */
async function fetchPublishedAsDraft(state: AppState, setId: string): Promise<ContentSetDocument | null> {
  const packageId = state.sets.find(item => item.setId === setId)?.publishedPackageId
    ?? storage()[setId]?.publishedPackageId;
  if (!packageId) return null;
  const pkg = await requestJson<{ files: Array<{ path: string; content: string }> }>(
    "/v1/content/missions/" + encodeURIComponent(packageId));
  const files = new Map(pkg.files.map(file => [file.path, JSON.parse(file.content) as Record<string, unknown>]));
  const { schemaVersion: _schemaVersion, ...setDocument } = files.get("set.json") ?? {};
  const extension = files.get("extensions/meowedit-v1.json") as { quests?: unknown[] } | undefined;
  const quests = ((files.get("quests/Definitions.json") as { quests?: unknown[] } | undefined)?.quests ?? [])
    .map((quest, index) => ({ ...(quest as object), meowEdit: extension?.quests?.[index] ?? {} }));
  const draft = {
    schemaVersion: 2,
    set: setDocument,
    quests,
    armies: (files.get("armies/ArmyConfigurations.json") as { armies?: unknown[] } | undefined)?.armies ?? [],
    missions: (files.get("missions/Missions.json") as { missions?: unknown[] } | undefined)?.missions ?? [],
    dialogues: [...files.entries()]
      .filter(([path]) => path.startsWith("dialogues/") && path.endsWith(".json"))
      .map(([, value]) => structuredClone(value))
  } as unknown as ContentSetDocument;
  return validateContentSet(draft, state.capabilities).valid ? draft : null;
}

/** Replaces the set's local authoring state with a fresh cloud copy. */
async function resetSetFromCloud(container: HTMLElement, state: AppState, setId: string, published: boolean): Promise<boolean> {
  let draft: ContentSetDocument | null;
  if (published) draft = await fetchPublishedAsDraft(state, setId);
  else {
    const loaded = await requestJson<{ draft: ContentSetDocument }>(
      "/v1/editor/mission-sets/" + encodeURIComponent(setId));
    draft = loaded.draft;
  }
  if (!draft) return false;
  clearWorkspace(setId);
  state.pending = state.pending.filter(item => item.setId !== setId);
  state.tabs = { ...state.tabs, [setId]: [] };
  state.draft = structuredClone(draft);
  state.dirty = false;
  state.baseline = structuredClone(draft);
  state.validation = validateContentSet(state.draft, state.capabilities);
  syncSession(state);
  renderSetView(container, state);
  return true;
}

function recordExists(entry: LastEdited): boolean {
  if (entry.workspace === SCRATCH_WORKSPACE)
    return scratchRecords().some(record => record.section === entry.section && record.key === entry.key);
  const draft = storage()[entry.workspace]?.draft;
  if (!draft) return false;
  const items = draft[entry.section] as Array<{ id?: string; sequenceId?: string }>;
  return items.some(item => (item.id ?? item.sequenceId) === entry.key);
}


function renderBrowser(container: HTMLElement, state: AppState): void {
  pushRoute({ kind: "browser" });
  activeEditorRoute = null;
  state.view = "browser";
  const records = storage();
  const sets = [...state.sets];
  for (const [setId, record] of Object.entries(records))
    if (!sets.some(item => item.setId === setId))
      sets.push({
        setId, name: record.draft.set.name.default || setId, kind: record.draft.set.kind,
        draftVersion: record.draftVersion, publishedPackageId: record.publishedPackageId
      });
  const setRow = (summary: SetSummary) =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(summary.name || summary.setId) + "</strong></div>" +
    '<span class="set-badge">' + (summary.kind === "data" ? "Data" : "Missions") + "</span>" +
    badge(summary) +
    '<button type="button" class="text-button icon-button" data-export-set="' + escapeHtml(summary.setId) +
    '" title="Export set JSON" aria-label="Export ' + escapeHtml(summary.setId) + '">↧</button>' +
    '<button type="button" class="text-button icon-button" data-rename="' + escapeHtml(summary.setId) +
    '" title="Rename set" aria-label="Rename ' + escapeHtml(summary.setId) + '">✎</button>' +
    (canDeleteSets()
      ? '<button type="button" class="text-button icon-button danger-text" data-delete="' + escapeHtml(summary.setId) +
        '" title="Delete set" aria-label="Delete ' + escapeHtml(summary.setId) + '">✕</button>'
      : "") +
    '<button type="button" class="button button-outline" data-open="' + escapeHtml(summary.setId) + '">Open</button></div>';
  const setRows = (list: SetSummary[]) => list.length ? list.map(setRow).join("")
    : '<div class="set-empty">No sets yet.</div>';
  const needsAttention = state.sets.filter(summary => {
    const record = records[summary.setId];
    return !!record && validateContentSet(record.draft, state.capabilities).issues.length > 0;
  });
  const notifications = needsAttention.length
    ? '<section class="set-group notifications"><h2>Needs attention</h2>' + needsAttention.map(summary =>
      '<div class="set-row"><div class="set-row-main"><strong>⚠ ' + escapeHtml(summary.name || summary.setId) +
      "</strong><small>Validation issues — open the set to fix them</small></div>" +
      '<button type="button" class="button button-outline" data-open="' + escapeHtml(summary.setId) + '">Open</button></div>').join("") +
      "</section>"
    : "";
  const pending = state.pending.filter(recordExists);
  const unsavedRows = pending.length ? pending.map(entry =>
    '<div class="set-row"><input type="checkbox" class="row-select" data-pending="' + escapeHtml(pendingKey(entry)) + '">' +
    '<div class="set-row-main"><strong>' + escapeHtml(entry.label) + "</strong><small>" +
    SECTION_LABELS[entry.section] + " · " +
    (entry.setId === SCRATCH_WORKSPACE ? "local draft" : "set " + escapeHtml(entry.setId)) +
    '</small></div>' +
    (entry.setId === SCRATCH_WORKSPACE
      ? '<button type="button" class="button button-outline" data-assign-local="' + entry.section + "|" + escapeHtml(entry.key) + '">Assign to set</button>'
      : '<button type="button" class="text-button" data-save-pending="' + escapeHtml(pendingKey(entry)) + '">Save</button>' +
        '<button type="button" class="text-button danger-text" data-discard-pending="' + escapeHtml(pendingKey(entry)) + '">Discard</button>') +
    '<button type="button" class="button button-outline" data-continue-edit="' +
    escapeHtml(entry.workspace) + "|" + entry.section + "|" + escapeHtml(entry.key) + '">Continue</button></div>'
  ).join("") : '<div class="set-empty">No unsaved edits.</div>';
  const unpublishedRows = state.unpublished.length ? state.unpublished.map(setId => {
    const summary = sets.find(item => item.setId === setId);
    return '<div class="set-row"><input type="checkbox" class="row-select" data-unpublished="' + escapeHtml(setId) + '">' +
      '<div class="set-row-main"><strong>' + escapeHtml(summary?.name || setId) + "</strong><small>" +
      unpublishedCount(setId) + " changed record(s) saved but not published</small></div>" +
      '<button type="button" class="button button-outline" data-open="' + escapeHtml(setId) + '">Open</button>' +
      '<button type="button" class="button button-primary" data-publish-set="' + escapeHtml(setId) + '">Publish</button></div>';
  }).join("") : '<div class="set-empty">Nothing waiting to publish.</div>';
  const locals = scratchRecords();
  const localRows = locals.length ? locals.map(record =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(record.label) + "</strong><small>" +
    SECTION_LABELS[record.section] + "</small></div>" +
    '<button type="button" class="text-button" data-edit-local="' + record.section + "|" + escapeHtml(record.key) + '">Edit</button>' +
    '<button type="button" class="text-button" data-export-local="' + record.section + "|" + escapeHtml(record.key) + '">Export</button>' +
    '<button type="button" class="text-button danger-text" data-delete-local="' + record.section + "|" + escapeHtml(record.key) + '">Delete</button>' +
    '<button type="button" class="button button-outline" data-assign-local="' + record.section + "|" + escapeHtml(record.key) + '">Assign to set</button></div>'
  ).join("") : '<div class="set-empty">No local drafts yet. Create content below.</div>';
  const dashboardTabs = ([["unsaved", "Unsaved edits"], ["unpublished", "Ready to publish"], ["local", "Local"], ["cloud", "Cloud"]] as const).map(([id, label]) =>
    '<button type="button" class="button button-outline set-tab' + (state.dashboardTab === id ? " is-active" : "") +
    '" data-dashboard-tab="' + id + '" aria-pressed="' + (state.dashboardTab === id) + '">' + label + "</button>").join("");
  const panel = (id: AppState["dashboardTab"], content: string) =>
    '<div class="set-list dashboard-panel" data-dashboard-panel="' + id + '"' +
    (state.dashboardTab === id ? "" : " hidden") + ">" + content + "</div>";
  const tabContent = panel("unsaved", unsavedRows + '<div class="guided-actions"><button type="button" class="button button-outline" data-bulk-save>Save selected</button>' +
    '<button type="button" class="button button-outline danger-text" data-bulk-discard>Discard selected</button></div>') +
    panel("unpublished", unpublishedRows + '<div class="guided-actions"><button type="button" class="button button-primary" data-bulk-publish>Publish selected</button></div>') +
    panel("local", localRows + '<div class="guided-actions"><button type="button" class="button button-outline" data-import>Import JSON / ZIP</button></div>') +
    panel("cloud", setRows(sets));

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">DASHBOARD</span></div><div class="topbar-actions">' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>Your dashboard</h1>' +
    "<p>Create content locally, then assign it to a set to upload it.</p></div>" +
    '<button type="button" class="button button-primary" data-new-set>+ New set</button></div>' +
    notifications +
    '<section class="set-group"><h2>Create new content</h2><div class="guided-actions">' +
    SECTIONS.map(section => '<button type="button" class="button button-outline" data-create="' + section + '">+ ' +
      SECTION_LABELS[section] + "</button>").join("") + "</div></section>" +
    '<section class="set-group"><h2>Your content</h2><div class="guided-actions set-tabs">' + dashboardTabs + "</div>" +
    tabContent + "</section>" +
    '<input id="dashboard-import-file" class="visually-hidden" type="file" accept=".json,.zip,application/json,application/zip">' +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";
  writeSession(state);

  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderBrowser(container, state);
  });
  container.querySelectorAll<HTMLElement>("[data-dashboard-tab]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.dashboardTab as AppState["dashboardTab"];
    state.dashboardTab = id;
    container.querySelectorAll<HTMLElement>("[data-dashboard-tab]").forEach(tab =>
      tab.classList.toggle("is-active", tab === button));
    container.querySelectorAll<HTMLElement>("[data-dashboard-panel]").forEach(panel =>
      panel.hidden = panel.dataset.dashboardPanel !== id);
  }));
  const savePending = (keys: string[]) => {
    const entries = state.pending.filter(item => keys.includes(pendingKey(item)) && item.setId !== SCRATCH_WORKSPACE);
    const setIds = [...new Set(entries.map(item => item.setId))];
    if (!setIds.length) return;
    void (async () => {
      for (const setId of setIds) {
        const record = storage()[setId];
        if (!record) continue;
        state.setId = setId;
        state.draft = record.draft;
        state.draftVersion = record.draftVersion;
        await saveDraft(state);
      }
      renderBrowser(container, state);
      flashStatus(container, state);
    })();
  };
  container.querySelectorAll<HTMLElement>("[data-save-pending]").forEach(button => button.addEventListener("click", () =>
    savePending([button.dataset.savePending!])));
  container.querySelectorAll<HTMLElement>("[data-discard-pending]").forEach(button => button.addEventListener("click", () => {
    state.pending = state.pending.filter(item => pendingKey(item) !== button.dataset.discardPending);
    syncSession(state);
    renderBrowser(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-publish-set]").forEach(button => button.addEventListener("click", () => {
    const setId = button.dataset.publishSet!;
    const record = storage()[setId];
    if (!record) return;
    state.setId = setId;
    state.draft = record.draft;
    state.draftVersion = record.draftVersion;
    void publishDraft(state).then(() => {
      renderBrowser(container, state);
      flashStatus(container, state);
    });
  }));
  container.querySelector<HTMLElement>("[data-bulk-save]")?.addEventListener("click", () =>
    savePending([...container.querySelectorAll<HTMLInputElement>("[data-pending]:checked")].map(input => input.dataset.pending!)));
  container.querySelector<HTMLElement>("[data-bulk-discard]")?.addEventListener("click", () => {
    const keys = [...container.querySelectorAll<HTMLInputElement>("[data-pending]:checked")].map(input => input.dataset.pending!);
    state.pending = state.pending.filter(item => !keys.includes(pendingKey(item)));
    syncSession(state);
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-bulk-publish]")?.addEventListener("click", () => {
    const ids = [...container.querySelectorAll<HTMLInputElement>("[data-unpublished]:checked")].map(input => input.dataset.unpublished!);
    void (async () => {
      for (const setId of ids) {
        const record = storage()[setId];
        if (!record) continue;
        state.setId = setId;
        state.draft = record.draft;
        state.draftVersion = record.draftVersion;
        await publishDraft(state);
      }
      renderBrowser(container, state);
      flashStatus(container, state);
    })();
  });
  container.querySelectorAll<HTMLElement>("[data-export-set]").forEach(button => button.addEventListener("click", () => {
    const draft = records[button.dataset.exportSet!]?.draft;
    if (draft) downloadText(button.dataset.exportSet! + ".json", JSON.stringify(draft, null, 2));
  }));
  container.querySelector<HTMLElement>("[data-new-set]")?.addEventListener("click", () => { void createSet(container, state); });
  container.querySelectorAll<HTMLElement>("[data-open]").forEach(button => button.addEventListener("click", () => {
    void openSet(container, state, button.dataset.open!);
  }));
  container.querySelector<HTMLElement>("[data-continue-edit]")?.addEventListener("click", event => {
    const value = (event.currentTarget as HTMLElement).dataset.continueEdit ?? "";
    const [workspace, section, key] = value.split("|");
    void continueEditing(container, state, { workspace, section: section as DetailSection, key });
  });
  container.querySelectorAll<HTMLElement>("[data-rename]").forEach(button => button.addEventListener("click", () => {
    void renameSet(container, state, button.dataset.rename!);
  }));
  container.querySelectorAll<HTMLElement>("[data-delete]").forEach(button => button.addEventListener("click", () => {
    void deleteSet(container, state, button.dataset.delete!);
  }));
  container.querySelectorAll<HTMLElement>("[data-create]").forEach(button => button.addEventListener("click", () => {
    void createLocal(container, state, button.dataset.create as DetailSection);
  }));
  container.querySelectorAll<HTMLElement>("[data-edit-local]").forEach(button => button.addEventListener("click", () => {
    void openLocal(container, state, buttonData(button.dataset.editLocal), "full");
  }));
  container.querySelectorAll<HTMLElement>("[data-export-local]").forEach(button => button.addEventListener("click", () => {
    exportLocal(buttonData(button.dataset.exportLocal));
  }));
  container.querySelectorAll<HTMLElement>("[data-assign-local]").forEach(button => button.addEventListener("click", () => {
    void showAssignDialog(container, state, buttonData(button.dataset.assignLocal));
  }));
  container.querySelectorAll<HTMLElement>("[data-delete-local]").forEach(button => button.addEventListener("click", () => {
    deleteLocal(buttonData(button.dataset.deleteLocal));
    renderBrowser(container, state);
  }));
  container.querySelector<HTMLElement>("[data-import]")?.addEventListener("click", () => {
    container.querySelector<HTMLInputElement>("#dashboard-import-file")?.click();
  });
  container.querySelector<HTMLInputElement>("#dashboard-import-file")?.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) void importLocalFile(input.files[0]).then(() => renderBrowser(container, state));
  });
}

function buttonData(value?: string): { section: DetailSection; key: string } {
  const [section, key] = (value ?? "").split("|");
  return { section: section as DetailSection, key };
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
  draft.missions.push(newMission("mission-1", "First mission", state.capabilities));
  draft.set.missionOrder = [draft.missions[0].id];
  state.setId = id;
  state.draft = draft;
  state.draftVersion = 0;
  state.publishedPackageId = undefined;
  state.validation = validateContentSet(draft, state.capabilities);
  persistLocal(state);
  await refreshSets(state);
  await openSet(container, state, id);
}


function localRecord(section: DetailSection, key: string): Record<string, unknown> | undefined {
  const workspace = loadScratchWorkspace();
  const items = workspace[section] as unknown as Array<Record<string, unknown>>;
  return items.find(item => item.key === key);
}

function recordJson(section: DetailSection, key: string): string | null {
  const item = localRecord(section, key);
  if (!item) return null;
  if (section === "dialogues") return activeDialogueJson(item as never);
  if (section === "quests") return activeQuestJson(item as never);
  if (section === "armies") return activeArmyJson(item as never);
  return activeMissionJson(item as never);
}

function recordLabel(section: DetailSection, item: Record<string, unknown>): string {
  if (section === "dialogues")
    return String((item.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? item.key ?? "");
  if (section === "quests") return String((item.definition as { title?: string } | undefined)?.title ?? item.key ?? "");
  return String((item.name as string | undefined) ?? item.key ?? "");
}

function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportLocal(input: { section: DetailSection; key: string }): void {
  const json = recordJson(input.section, input.key);
  if (!json) return;
  downloadText(input.key.replace(/[^a-zA-Z0-9_-]+/g, "-") + ".json", json);
}

function deleteLocal(input: { section: DetailSection; key: string }): void {
  const workspace = loadScratchWorkspace();
  const items = workspace[input.section] as unknown as Array<Record<string, unknown>>;
  workspace[input.section] = items.filter(item => item.key !== input.key) as never;
  if (workspace.selectedKey === input.key) {
    workspace.selectedKey = null;
    workspace.selectedType = null;
  }
  saveScratchWorkspace(workspace);
}

function createLocalRecord(section: DetailSection, id: string, name: string): Record<string, unknown> {
  const stamp = Date.now().toString(36);
  const key = "local-" + stamp;
  if (section === "dialogues") return {
    key, sequenceIdAuto: true,
    sequence: { schemaVersion: 1, sequenceId: id, startNodeId: "opening", pauseMode: "pause",
      defaultCharactersPerSecond: 30, nodes: [{ id: "opening", headline: name, textSpeed: "default",
        speakers: [], segments: [], actions: [] }] }
  };
  if (section === "quests") return {
    key, idAuto: true, definition: {
      schemaVersion: 1, id, title: name, description: "", sourceKind: "QuestGiver", sourceSlot: -1,
      firstFloor: 1, repeatEveryFloors: 0, priority: 0, objectiveKind: "Fetch", targetNodeKind: "Reward",
      targetFloorOffset: 0, escortUnitId: "", itemId: "", speakerUnitId: "", speakerName: "",
      offerText: "", activeText: "", acceptLabel: "Accept", declineLabel: "Decline",
      rewardKind: "Sardines", rewardAmount: 0, rewardContentId: ""
    },
    extension: {
      schemaVersion: 1, dialogueLinks: { offer: "", active: "", completion: "", failure: "" },
      logicKind: "standard", timer: { decisionId: "", payOutcomeId: "pay-now", waitOutcomeId: "wait",
        counterId: "battle-count", counterTarget: 3, counterLabel: "Battles", countEvent: "any-battle-completed",
        paymentResource: "Sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: [] },
      completionEffects: [], fetchItems: [], battleTargets: [], killCount: null, minimumNodeDistances: []
    }
  };
  if (section === "armies") return { key, id, idAuto: true, name, previewFloor: 1, units: [], spellIds: [], blessingIds: [] };
  return {
    key, id, idAuto: true, name, description: "", boardPreviewUnitId: "", questIds: [],
    floors: [createMissionFloor(1, "authored")], events: [], settings: {
      startingLives: 3, startingSardines: 10, startingNodeCount: 12, playerFactionId: "",
      factionSelectionEnabled: true, battleShopEnabled: true, shopPoolKinds: ["Unit"],
      questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2,
      continueWithGeneratedFloors: false, sardinePayoutEnabled: true, sardinePayoutBase: 10, sardinePayoutPerFloor: 1
    }
  };
}

function nextSystemId(section: DetailSection): string {
  const prefix = SECTION_SINGULAR[section];
  let highest = 0;
  const consider = (id: unknown) => {
    const match = typeof id === "string" ? new RegExp("^" + prefix + "-(\\d+)$").exec(id) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  };
  const scratch = loadScratchWorkspace();
  for (const item of scratch[section] as unknown as Array<Record<string, unknown>>) {
    consider(item.id);
    consider((item.sequence as { sequenceId?: string } | undefined)?.sequenceId);
  }
  for (const record of Object.values(storage())) {
    for (const item of record.draft[section] as unknown as Array<Record<string, unknown>>) {
      consider(item.id);
      consider((item.sequenceId as string | undefined));
    }
  }
  return prefix + "-" + (highest + 1);
}

async function createLocal(container: HTMLElement, state: AppState, section: DetailSection): Promise<void> {
  try {
    await createLocalDraft(container, state, section);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "The new content could not be created.";
    showToast(state.status, "error");
    renderBrowser(container, state);
  }
}

async function createLocalDraft(container: HTMLElement, state: AppState, section: DetailSection): Promise<void> {
  const id = nextSystemId(section);
  const name = SECTION_LABELS[section] + " " + id.split("-")[1];
  const workspace = loadScratchWorkspace();
  const record = createLocalRecord(section, id, name);
  (workspace[section] as unknown as Array<Record<string, unknown>>).push(record);
  workspace.selectedType = SECTION_SINGULAR[section];
  workspace.selectedKey = String(record.key);
  if (section === "dialogues") {
    const sequence = record.sequence as { nodes?: Array<{ id: string }> };
    workspace.activeNodeId = sequence.nodes?.[0]?.id ?? null;
  }
  saveScratchWorkspace(workspace);
  await openEditor(container, state, {
    workspace: SCRATCH_WORKSPACE, section,
    index: (workspace[section] as unknown as unknown[]).length - 1,
    key: String(record.key), label: name, forceMode: "guided"
  });
}

async function openLocal(container: HTMLElement, state: AppState, input: { section: DetailSection; key: string; step?: number; mode?: "guided" | "full" }, forceMode?: "guided" | "full"): Promise<void> {
  const workspace = loadScratchWorkspace();
  const index = (workspace[input.section] as unknown as Array<Record<string, unknown>>)
    .findIndex(item => item.key === input.key);
  if (index < 0) return;
  const item = localRecord(input.section, input.key)!;
  workspace.selectedType = SECTION_SINGULAR[input.section];
  workspace.selectedKey = input.key;
  saveScratchWorkspace(workspace);
  await openEditor(container, state, { workspace: SCRATCH_WORKSPACE, section: input.section, index, key: input.key, label: recordLabel(input.section, item), forceMode, step: input.step, mode: input.mode });
}

async function continueEditing(container: HTMLElement, state: AppState, input: { workspace: string; section: DetailSection; key: string; step?: number; mode?: "guided" | "full" }): Promise<boolean> {
  if (input.workspace === SCRATCH_WORKSPACE) {
    const workspace = loadScratchWorkspace();
    const index = (workspace[input.section] as unknown as Array<{ key?: string }>).findIndex(item => item.key === input.key);
    if (index < 0) return false;
    await openLocal(container, state, { section: input.section, key: input.key, step: input.step, mode: input.mode });
    return true;
  }
  let draft = storage()[input.workspace]?.draft;
  if (!draft) {
    try {
      const loaded = await requestJson<{ draft: ContentSetDocument; draftVersion: number }>(
        "/v1/editor/mission-sets/" + encodeURIComponent(input.workspace));
      draft = loaded.draft;
    } catch { return false; }
  }
  const items = draft[input.section] as Array<{ id?: string; sequenceId?: string }>;
  const index = items.findIndex(item => (item.id ?? item.sequenceId) === input.key);
  if (index < 0) return false;
  state.setId = input.workspace;
  state.draft = draft;
  state.draftVersion = storage()[input.workspace]?.draftVersion ?? 1;
  await openEditor(container, state, { workspace: input.workspace, section: input.section, index, key: input.key, label: entryLabel(draft, input.section, index), step: input.step, mode: input.mode });
  return true;
}

async function importLocalFile(file: File): Promise<void> {
  let parsed: unknown;
  if (file.name.toLowerCase().endsWith(".zip")) {
    const entries = readStoredZip(new Uint8Array(await file.arrayBuffer()));
    const first = [...entries.values()].map(bytes => decodeZipText(bytes))[0];
    if (!first) throw new Error("The ZIP contains no content.");
    parsed = parseImportedJson(first);
  } else parsed = parseImportedJson(await file.text());
  const workspace = loadScratchWorkspace();
  const before = SECTIONS.reduce((sum, section) => sum + (workspace[section] as unknown as unknown[]).length, 0);
  // normalizers are intentionally not used here: imports must land in the editor's native shape.
  const record = parsed as Record<string, unknown>;
  for (const section of SECTIONS) {
    const list = record[section];
    if (Array.isArray(list)) {
      for (const item of list) {
        const withKey = { ...(item as Record<string, unknown>), key: (item as Record<string, unknown>).key ?? "local-" + Date.now().toString(36) };
        (workspace[section] as unknown as Array<Record<string, unknown>>).push(withKey);
      }
    }
  }
  const after = SECTIONS.reduce((sum, section) => sum + (workspace[section] as unknown as unknown[]).length, 0);
  saveScratchWorkspace(workspace);
  if (after === before) throw new Error("No supported content found in this file.");
}

interface EditorTarget {
  workspace: string;
  section: DetailSection;
  index: number;
  key: string;
  label: string;
  forceMode?: "guided" | "full";
  step?: number;
  mode?: "guided" | "full";
}

async function openEditor(container: HTMLElement, state: AppState, target: EditorTarget): Promise<void> {
  const route: Extract<AppRoute, { kind: "editor" }> = {
    kind: "editor", workspace: target.workspace, section: target.section, key: target.key,
    step: target.step, mode: target.mode
  };
  pushRoute(route);
  activeEditorRoute = route;
  editorMountPending = true;
  addEditorTab(state, target.workspace, {
    workspace: target.workspace, section: target.section, key: target.key, label: target.label,
    step: target.step, mode: target.mode ?? target.forceMode
  });
  try {
    const { mountEditor } = await import("../editor/main");
    recordEdited(state, { workspace: target.workspace, section: target.section, key: target.key, label: target.label });
    syncSession(state);
    const scratch = target.workspace === SCRATCH_WORKSPACE;
    mountEditor({
      setId: scratch ? undefined : target.workspace,
      draft: scratch ? undefined : state.draft,
      capabilities: state.capabilities,
      selected: { section: target.section, index: target.index },
      forceMode: target.forceMode,
      initialStep: target.step,
      initialMode: target.mode,
      onNavigation: navigation => editorNavigation(route, navigation),
      onSave: () => saveDraft(state),
      onDraftChange: () => {
        if (!scratch) {
          state.validation = validateContentSet(state.draft, state.capabilities);
          state.dirty = true;
          persistLocal(state);
        }
      },
      onBack: () => (scratch ? renderBrowser(container, state) : renderSetView(container, state)),
      onPublish: () => publishDraft(state),
      canPublishEditor: () => state.validation.valid && canPublish(),
      onAssign: () => { void showAssignDialog(container, state, { section: target.section, key: target.key }); },
      onRecordChange: (section, key, label) => {
        recordEdited(state, { workspace: target.workspace, section: section as DetailSection, key, label });
        activeEditorRoute = { kind: "editor", workspace: target.workspace, section: section as DetailSection, key };
        pushRoute(activeEditorRoute);
        syncSession(state);
      },
      onRecordEdited: (section, key) => markRecordEdited(state, target.workspace, section, key),
      onDiscardRecord: (section, key) => discardRecord(state, target.workspace, section, key),
      onExitDiscard: () => {
        void resetSetFromCloud(container, state, target.workspace, true).then(ok => {
          if (!ok) {
            state.status = "The published version could not be reloaded.";
            renderSetView(container, state);
          }
        });
      },
      tabs: state.tabs[target.workspace] ?? [],
      activeTabKey: target.key,
      onSwitchTab: (section, key, step, mode) => {
        updateActiveTab(state, target.workspace, target.key, { step, mode });
        void openTabTarget(container, state, target.workspace, {
          workspace: target.workspace, section: section as DetailSection, key, label: key, step, mode
        });
      },
      onCloseTab: key => {
        const tabs = state.tabs[target.workspace] ?? [];
        const index = tabs.findIndex(item => item.key === key);
        const remaining = tabs.filter(item => item.key !== key);
        syncEditorTabs(state, target.workspace, remaining);
        if (key !== target.key) {
          // Closing a background tab must leave the current record open.
          removeTabFromChrome(container, key);
          return;
        }
        if (remaining.length) {
          const neighbour = remaining[Math.min(Math.max(index - 1, 0), remaining.length - 1)];
          void openTabTarget(container, state, target.workspace, neighbour);
        } else if (scratch) renderBrowser(container, state);
        else renderSetView(container, state);
      },
      onTabState: (step, mode) => updateActiveTab(state, target.workspace, target.key, { step, mode })
    });
  } catch (error) {
    if (reloadForStaleChunk(error)) return;
    state.status = error instanceof Error ? error.message : "The editor could not be opened.";
    renderBrowser(container, state);
  }
}

function missingDependencies(workspace: Workspace, section: DetailSection, key: string): Array<{ section: DetailSection; key: string; label: string }> {
  const result: Array<{ section: DetailSection; key: string; label: string }> = [];
  const setRefs = new Set<string>();
  const add = (id: unknown) => { if (typeof id === "string" && id) setRefs.add(id); };
  const item = (workspace[section] as unknown as Array<Record<string, unknown>>).find(record => record.key === key);
  if (!item) return result;
  if (section === "quests") {
    const ext = (item.extension as { dialogueLinks?: Record<string, string> } | undefined)?.dialogueLinks ?? {};
    Object.values(ext).forEach(add);
    for (const target of ((item.extension as { battleTargets?: Array<{ armyId?: string }> } | undefined)?.battleTargets ?? [])) add(target.armyId);
  } else if (section === "missions") {
    add((item.boardPreviewUnitId as string | undefined));
    for (const questId of ((item.questIds as string[] | undefined) ?? [])) add(questId);
    for (const floor of ((item.floors as Array<{ nodes?: Array<{ armyId?: string; questId?: string }> }> | undefined) ?? []))
      for (const node of floor.nodes ?? []) { add(node.armyId); add(node.questId); }
    for (const event of ((item.events as Array<{ actions?: Array<Record<string, unknown>> }> | undefined) ?? []))
      for (const action of event.actions ?? []) { add(action.armyId); add(action.dialogueId); }
  }
  for (const candidate of SECTIONS) {
    if (candidate === section) continue;
    const list = workspace[candidate] as unknown as Array<Record<string, unknown>>;
    for (const record of list) {
      const id = candidate === "dialogues"
        ? String((record.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? "")
        : String((record.id as string | undefined) ?? "");
      if (id && setRefs.has(id))
        result.push({ section: candidate, key: String(record.key), label: recordLabel(candidate, record) });
    }
  }
  return result;
}

async function showAssignDialog(container: HTMLElement, state: AppState, input: { section: DetailSection; key: string }): Promise<void> {
  const scratch = loadScratchWorkspace();
  const item = localRecord(input.section, input.key);
  if (!item) return;
  const sets = [...state.sets];
  if (!sets.length) {
    showToast("Create a set first, then assign content to it.", "warning");
    return;
  }
  const deps = missingDependencies(scratch, input.section, input.key);
  const overlay = document.createElement("div");
  overlay.className = "assign-overlay";
  overlay.innerHTML = '<div class="assign-dialog card"><h2>Assign to set</h2>' +
    '<p class="step-copy">Assigning uploads the content into the set\'s private draft immediately.</p>' +
    '<label class="field"><span class="field-label">Target set</span><select data-assign-set>' +
    sets.map(set => '<option value="' + escapeHtml(set.setId) + '">' + escapeHtml(set.name || set.setId) + "</option>").join("") +
    "</select></label>" +
    (deps.length ? '<div class="assign-deps"><strong>Related content in this draft</strong>' +
      deps.map(dep => '<label class="mission-check"><input type="checkbox" checked data-dep="' +
        dep.section + "|" + escapeHtml(dep.key) + '"><span>' + escapeHtml(SECTION_LABELS[dep.section]) + ": " +
        escapeHtml(dep.label) + "</span></label>").join("") + "</div>" : "") +
    '<div class="assign-summary"></div>' +
    '<div class="dialog-actions"><button type="button" class="button button-outline" data-assign-cancel>Cancel</button>' +
    '<button type="button" class="button button-primary" data-assign-confirm>Assign and upload</button></div></div>';
  document.body.append(overlay);
  const select = overlay.querySelector<HTMLSelectElement>("[data-assign-set]")!;
  const summary = overlay.querySelector<HTMLElement>(".assign-summary")!;
  const updateSummary = () => {
    const target = storage()[select.value]?.draft;
    const items = target ? (target[input.section] as unknown as Array<Record<string, unknown>>) : [];
    const match = items.find(candidate => {
      const id = input.section === "dialogues"
        ? (candidate.sequence as { sequenceId?: string } | undefined)?.sequenceId : candidate.id;
      const localId = input.section === "dialogues"
        ? (item.sequence as { sequenceId?: string } | undefined)?.sequenceId : item.id;
      return id === localId;
    });
    summary.textContent = match
      ? "This set already has " + SECTION_LABELS[input.section].toLowerCase() + " '" + recordLabel(input.section, item) +
        "'. Assigning will replace it and upload the new draft immediately."
      : "Will add " + SECTION_LABELS[input.section].toLowerCase() + " '" + recordLabel(input.section, item) + "' to " + select.value + ".";
  };
  select.addEventListener("change", updateSummary);
  updateSummary();
  overlay.querySelector<HTMLElement>("[data-assign-cancel]")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector<HTMLElement>("[data-assign-confirm]")!.addEventListener("click", () => {
    void performAssign(container, state, input, select.value, overlay).then(() => overlay.remove());
  });
}

async function performAssign(
  container: HTMLElement, state: AppState, input: { section: DetailSection; key: string },
  setId: string, overlay: HTMLElement
): Promise<void> {
  const confirmButton = overlay.querySelector<HTMLElement>("[data-assign-confirm]")!;
  confirmButton.setAttribute("disabled", "true");
  confirmButton.textContent = "Uploading…";
  try {
    const scratch = loadScratchWorkspace();
    const selectedDeps = [...overlay.querySelectorAll<HTMLInputElement>("[data-dep]")].filter(input => input.checked)
      .map(input => buttonData(input.dataset.dep));
    const targetRecord = storage()[setId];
    let draft: ContentSetDocument;
    let version: number;
    if (targetRecord && targetRecord.draftVersion > 0) {
      const loaded = await requestJson<{ draft: ContentSetDocument; draftVersion: number }>(
        "/v1/editor/mission-sets/" + encodeURIComponent(setId));
      draft = loaded.draft;
      version = loaded.draftVersion;
    } else {
      draft = targetRecord?.draft ?? emptyContentSet(setId, setId);
      version = targetRecord?.draftVersion ?? 0;
    }
    const targetWorkspace = targetRecord ? loadWorkspace(setId, draft, state.capabilities) : null;
    const assignedLabel = recordLabel(input.section, localRecord(input.section, input.key) ?? {});
    const sourceItem = localRecord(input.section, input.key);
    const assignedId = input.section === "dialogues"
      ? String((sourceItem?.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? input.key)
      : String(sourceItem?.id ?? input.key);
    const records = [{ section: input.section, key: input.key }, ...selectedDeps];
    for (const record of records) {
      const source = (scratch[record.section] as unknown as Array<Record<string, unknown>>).find(item => item.key === record.key);
      if (!source) continue;
      const id = record.section === "dialogues"
        ? String((source.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? "")
        : String(source.id ?? "");
      if (!id) continue;
      const converted = source as unknown as ContentSetDocument[DetailSection][number];
      const list = draft[record.section] as unknown as Array<Record<string, unknown>>;
      const existing = list.findIndex(item => {
        const currentId = record.section === "dialogues"
          ? (item.sequenceId as string | undefined) : (item.id as string | undefined);
        return currentId === id;
      });
      if (existing >= 0) list[existing] = converted as never;
      else list.push(converted as never);
      if (targetWorkspace) {
        const wsList = targetWorkspace[record.section] as unknown as Array<Record<string, unknown>>;
        const wsIndex = wsList.findIndex(item => item.key === id);
        if (wsIndex >= 0) wsList[wsIndex] = source;
        else wsList.push(source);
      }
    }
    const result = await requestJson<{ draftVersion: number; currentVersion?: number; code?: string }>(
      version > 0 ? "/v1/editor/mission-sets/" + encodeURIComponent(setId) : "/v1/editor/mission-sets",
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(version > 0 ? saveDraftRequest(version, draft) : createSetRequest(setId, draft)) });
    if (isDraftConflict(result)) {
      state.status = "Draft conflict: the server is at version " + result.currentVersion + ". Retry or cancel.";
      showToast(state.status, "warning");
      confirmButton.removeAttribute("disabled");
      confirmButton.textContent = "Assign and upload";
      return;
    }
    for (const record of records)
      (scratch[record.section] as unknown as Array<Record<string, unknown>>) =
        (scratch[record.section] as unknown as Array<Record<string, unknown>>).filter(item => item.key !== record.key) as never;
    saveScratchWorkspace(scratch);
    if (targetWorkspace) saveWorkspaceForSet(setId, targetWorkspace);
    const recordsStore = storage();
    recordsStore[setId] = { draft, draftVersion: result.draftVersion, publishedPackageId: targetRecord?.publishedPackageId };
    localStorage.setItem(localKey(), JSON.stringify(recordsStore));
    markWorkspaceSynced(setId, result.draftVersion);
    state.setId = setId;
    state.draft = draft;
    state.draftVersion = result.draftVersion;
    state.validation = validateContentSet(draft, state.capabilities);
    await refreshSets(state);
    state.status = "Assigned and uploaded to " + setId + ".";
    const list = draft[input.section] as unknown as Array<Record<string, unknown>>;
    const index = Math.max(0, list.findIndex(item => {
      const currentId = input.section === "dialogues" ? item.sequenceId : item.id;
      return currentId === assignedId;
    }));
    await openEditor(container, state, { workspace: setId, section: input.section, index,
      key: assignedId, label: assignedLabel });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 0;
    state.status = status === 409 ? "Draft conflict: the set changed. Retry or cancel."
      : error instanceof Error ? error.message : "Assignment failed.";
    showToast(state.status, "error");
    confirmButton.removeAttribute("disabled");
    confirmButton.textContent = "Assign and upload";
  }
}

function saveWorkspaceForSet(setId: string, workspace: Workspace): void {
  try {
    localStorage.setItem("meowedit.workspace.v1." + (getBridgeUserId() ?? "local") + "." + setId, JSON.stringify(workspace));
  } catch { /* local cache is advisory */ }
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
        "/v1/editor/mission-sets/" + encodeURIComponent(setId));
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
        "/v1/editor/mission-sets/" + encodeURIComponent(setId), {
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
      await requestJson<{ deleted: boolean }>("/v1/editor/mission-sets/" + encodeURIComponent(setId), { method: "DELETE" });
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
        "/v1/editor/mission-sets/" + encodeURIComponent(setId));
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
    draft.missions.push(newMission("mission-1", "First mission", state.capabilities));
    draft.set.missionOrder = [draft.missions[0].id];
  }
  state.draft = draft;
  state.draft.set.setId = setId;
  state.draftVersion = version;
  state.publishedPackageId = published;
  state.view = "set";
  state.validation = validateContentSet(draft, state.capabilities);
  state.baseline = structuredClone(draft);
  state.dirty = false;
  renderSetView(container, state);
}

function changedCount(state: AppState): number {
  const baseline = state.baseline;
  if (!baseline) return 0;
  let count = 0;
  for (const section of SECTIONS) {
    const before = baseline[section];
    const after = state.draft[section];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++)
      if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) count += 1;
  }
  if (JSON.stringify(baseline.set) !== JSON.stringify(state.draft.set)) count += 1;
  return count;
}

function actionButtonRefreshCloud(): string {
  return '<button type="button" class="text-button" data-refresh-cloud' +
    ' title="Discard local edits and reload this set from the backend">Refresh from cloud</button>';
}

function renderSetView(container: HTMLElement, state: AppState): void {
  pushRoute({ kind: "set", setId: state.setId });
  activeEditorRoute = null;
  const draft = state.draft;
  const tabs = SECTIONS.map(section =>
    '<button type="button" class="button button-outline set-tab' +
    (section === state.activeSection ? " is-active" : "") + '" data-section="' + section +
    '" aria-pressed="' + (section === state.activeSection) + '">' +
    SECTION_LABELS[section] + " (" + entryCount(draft, section) + ")</button>").join("");
  const section = state.activeSection;
  const items = draft[section] as ContentSetDocument[DetailSection];
  const issues = state.validation.issues;
  const issueCount = (entrySection: string, entryIndex: number) =>
    issues.filter(issue => issue.section === entrySection && issue.entryIndex === entryIndex).length;
  const rows = '<div class="set-group"><h3>' + SECTION_LABELS[section] +
    '<button type="button" class="text-button" data-add-set-item="' + section + '">＋ Add ' +
    SECTION_LABELS[section] + "</button></h3>" +
    (items.length ? items.map((_, index) => {
      const count = issueCount(section, index);
      return '<div class="set-row"><div class="set-row-main"><strong>' +
        escapeHtml(entryLabel(draft, section, index)) + "</strong></div>" +
        (count ? '<span class="set-badge draft" title="' + count + ' validation issue(s)">⚠ ' + count + "</span>" : "") +
        '<button type="button" class="text-button icon-button" data-export-item="' + section + ":" + index +
        '" title="Export JSON" aria-label="Export ' + escapeHtml(entryLabel(draft, section, index)) + '">↧</button>' +
        '<button type="button" class="text-button" data-edit="' + section + ":" + index + '">Edit</button></div>';
    }).join("") : '<div class="set-empty">No ' + section + " yet.</div>") + "</div>";
  const validation = issues.length
    ? '<ul class="validation-issue-list">' + issues.slice(0, 8).map(issue =>
      '<li class="validation-issue"><span class="validation-issue-title">' + escapeHtml(issue.message) + "</span>" +
      (issue.section && issue.entryIndex !== undefined
        ? '<button type="button" class="text-button" data-fix-issue="' + issue.section + ":" + issue.entryIndex + '">Fix</button>'
        : "") + "</li>").join("") + "</ul>"
    : '<p class="step-copy">No validation issues. This set is ready to publish.</p>';

  const showError = /conflict|failed|fix the validation|could not|couldn't|error/i.test(state.status);
  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">' + escapeHtml(state.setId) + '</span></div><div class="topbar-actions">' +
    '<button type="button" class="text-button" data-back-browser>Dashboard</button>' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>' +
    escapeHtml(draft.set.name.default || state.setId) + "</h1><p>" +
    draft.missions.length + " missions · " + draft.quests.length + " quests · " +
    draft.armies.length + " armies · " + draft.dialogues.length + " dialogues</p></div></div>" +
    '<div class="guided-actions set-tabs">' + tabs + "</div>" + rows +
    '<section class="content-validation"><h2>Validation</h2>' + validation + "</section>" +
    '<div class="guided-actions">' +
    '<button type="button" class="button button-primary" data-save' + (state.dirty ? "" : " hidden") +
    ' title="Uploads your changes as a private draft for this set">Save draft · ' + changedCount(state) + " changed</button>" +
    '<button type="button" class="button button-outline" data-publish title="Publishes this set to players"' +
    (canPublish() && state.validation.valid ? "" : " disabled") + ">Publish</button>" +
    actionButtonRefreshCloud() +
    '<button type="button" class="text-button danger-text" data-discard-all' +
    (state.dirty || state.pending.some(item => item.setId === state.setId) || hasUnsyncedWorkspace(state.setId) ? "" : " disabled") +
    '>Discard all</button></div>' +
    (showError ? '<div class="status-banner" role="alert">' + escapeHtml(state.status) + "</div>" : "") +
    '<div class="guided-status" data-status hidden></div>' +
    '<dialog class="confirm-dialog" id="discard-dialog"><form method="dialog"><h2>Discard changes in this set?</h2>' +
    '<p>Local edits to ' + escapeHtml(state.setId) + ' will be reverted to the last saved draft.</p>' +
    '<label class="mission-check"><input type="checkbox" data-discard-unpublished><span>Also revert saved but unpublished changes</span></label>' +
    '<p class="field-hint help-copy">This restores the last published version and uploads it as a new draft.</p>' +
    '<div class="dialog-actions"><button value="cancel" class="button button-outline">Cancel</button>' +
    '<button value="confirm" class="button button-danger" id="discard-confirm">Discard</button></div></form></dialog>' +
    '</div></main>';
  writeSession(state);

  container.querySelector<HTMLElement>("[data-refresh-cloud]")?.addEventListener("click", () => {
    if (!window.confirm("Discard local edits and reload this set from the backend?")) return;
    const setId = state.setId;
    void resetSetFromCloud(container, state, setId, false).then(ok => {
      if (!ok) {
        state.status = "The saved draft could not be reloaded.";
        renderSetView(container, state);
      }
    });
  });
  container.querySelector<HTMLElement>("[data-discard-all]")?.addEventListener("click", () => {
    const dialog = document.querySelector<HTMLDialogElement>("#discard-dialog");
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  document.querySelector<HTMLDialogElement>("#discard-dialog")?.addEventListener("close", () => {
    void (async () => {
      const dialog = document.querySelector<HTMLDialogElement>("#discard-dialog");
      if (!dialog || dialog.returnValue !== "confirm") return;
      const setId = state.setId;
      state.pending = state.pending.filter(item => item.setId !== setId);
      const workspace = loadWorkspace(setId, state.draft, state.capabilities);
      saveWorkspaceForSet(setId, workspace);
      const revertPublished = document.querySelector<HTMLInputElement>("[data-discard-unpublished]")?.checked;
      if (revertPublished) {
        const published = await fetchPublishedAsDraft(state, setId);
        if (published) {
          state.draft = published;
          state.dirty = true;
          await saveDraft(state);
          markSetPublished(state, setId);
        }
      }
      syncSession(state);
      renderSetView(container, state);
    })();
  });
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
  container.querySelectorAll<HTMLElement>("[data-add-set-item]").forEach(button => button.addEventListener("click", () => {
    const section = button.dataset.addSetItem as DetailSection;
    const id = nextSystemId(section);
    const name = SECTION_LABELS[section] + " " + id.split("-")[1];
    const native = createLocalRecord(section, id, name);
    const temporaryDraft = structuredClone(state.draft);
    const temporaryWorkspace = { ...loadScratchWorkspace(), [section]: [native] } as never;
    workspaceToDraft(temporaryDraft, temporaryWorkspace, state.capabilities);
    const record = structuredClone(temporaryDraft[section].at(-1));
    const target = state.draft as unknown as Record<string, unknown>;
    if (!Array.isArray(target[section])) target[section] = [];
    (target[section] as unknown[]).push(record);
    if (section === "missions") state.draft.set.missionOrder.push(id);
    state.dirty = true;
    state.validation = validateContentSet(state.draft, state.capabilities);
    persistLocal(state);
    localStorage.removeItem("meowedit.workspace.v1." + (getBridgeUserId() ?? "local") + "." + state.setId);
    void openEditor(container, state, {
      workspace: state.setId, section, index: state.draft[section].length - 1,
      key: id, label: name, forceMode: "guided"
    });
  }));
  container.querySelectorAll<HTMLElement>("[data-section]").forEach(button => button.addEventListener("click", () => {
    state.activeSection = button.dataset.section as DetailSection;
    renderSetView(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-edit]").forEach(button => button.addEventListener("click", () => {
    const [section, index] = button.dataset.edit!.split(":");
    void openClassicEditor(container, state, { section: section as DetailSection, index: Number(index) }, "full");
  }));
  container.querySelectorAll<HTMLElement>("[data-export-item]").forEach(button => button.addEventListener("click", () => {
    exportLocal(buttonData(button.dataset.exportItem));
  }));
  container.querySelectorAll<HTMLElement>("[data-fix-issue]").forEach(button => button.addEventListener("click", () => {
    const [section, index] = button.dataset.fixIssue!.split(":");
    void openClassicEditor(container, state, { section: section as DetailSection, index: Number(index) }, "full");
  }));
  container.querySelector<HTMLElement>("[data-save]")?.addEventListener("click", () => {
    void saveDraft(state).then(() => {
      renderSetView(container, state);
      flashStatus(container, state);
    });
  });
  container.querySelector<HTMLElement>("[data-publish]")?.addEventListener("click", () => {
    void publishDraft(state).then(() => {
      if (state.publishedPackageId) {
        state.dirty = false;
        state.baseline = structuredClone(state.draft);
      }
      renderSetView(container, state);
      flashStatus(container, state);
    });
  });
}

function flashStatus(container: HTMLElement, state: AppState): void {
  const element = container.querySelector<HTMLElement>("[data-status]");
  if (element) element.textContent = state.status;
}

/** Opens the single classic editor, which owns both Guided and Full modes per category. */
async function openClassicEditor(container: HTMLElement, state: AppState, selected?: { section: string; index: number }, forceMode?: "guided" | "full"): Promise<void> {
  const route: Extract<AppRoute, { kind: "editor" }> = { kind: "editor", workspace: state.setId };
  if (selected) {
    const items = state.draft[selected.section as DetailSection] as Array<{ id?: string; sequenceId?: string }>;
    const record = items[selected.index];
    route.section = selected.section as DetailSection;
    route.key = record?.id ?? record?.sequenceId;
  }
  pushRoute(route);
  activeEditorRoute = route;
  editorMountPending = true;
  try {
    const { mountEditor } = await import("../editor/main");
    mountEditor({
      setId: state.setId,
      draft: state.draft,
      capabilities: state.capabilities,
      selected,
      forceMode,
      onNavigation: navigation => editorNavigation(route, navigation),
      onSave: () => saveDraft(state),
      onDraftChange: () => {
        state.validation = validateContentSet(state.draft, state.capabilities);
        state.dirty = true;
        persistLocal(state);
      },
      onRecordEdited: (section, key) => markRecordEdited(state, state.setId, section, key),
      onDiscardRecord: (section, key) => discardRecord(state, state.setId, section, key),
      onExitDiscard: () => {
        void resetSetFromCloud(container, state, state.setId, true).then(ok => {
          if (!ok) {
            state.status = "The published version could not be reloaded.";
            renderSetView(container, state);
          }
        });
      },
      tabs: state.tabs[state.setId] ?? [],
      activeTabKey: selected ? (state.draft[selected.section as DetailSection] as unknown as Array<{ id?: string; sequenceId?: string }>)[selected.index]?.id ?? "" : "",
      onSwitchTab: (section, key, step, mode) => {
        updateActiveTab(state, state.setId, key, { step, mode });
        void openTabTarget(container, state, state.setId, {
          workspace: state.setId, section: section as DetailSection, key, label: key, step, mode
        });
      },
      onCloseTab: key => {
        const tabs = state.tabs[state.setId] ?? [];
        const index = tabs.findIndex(item => item.key === key);
        const remaining = tabs.filter(item => item.key !== key);
        syncEditorTabs(state, state.setId, remaining);
        if (key !== route.key) {
          // Closing a background tab must leave the current record open.
          removeTabFromChrome(container, key);
          return;
        }
        if (remaining.length) {
          const neighbour = remaining[Math.min(Math.max(index - 1, 0), remaining.length - 1)];
          void openTabTarget(container, state, state.setId, neighbour);
        } else renderSetView(container, state);
      },
      onTabState: (step, mode) => {
        if (route.key) updateActiveTab(state, state.setId, route.key, { step, mode });
      },
      onBack: () => renderSetView(container, state),
      onPublish: () => publishDraft(state),
      canPublishEditor: () => state.validation.valid && canPublish()
    });
  } catch (error) {
    if (reloadForStaleChunk(error)) return;
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
      creating ? "/v1/editor/mission-sets" : "/v1/editor/mission-sets/" + encodeURIComponent(state.setId),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }
    );
    if (isDraftConflict(result)) {
      state.status = "Draft conflict: the server is at version " + result.currentVersion + ". Reopen the set to refresh.";
      return state.status;
    }
    state.draftVersion = result.draftVersion;
    state.status = "Saved changes to " + state.setId + " (v" + result.draftVersion + "). Publish to make them live for players.";
    markWorkspaceSynced(state.setId, state.draftVersion);
    markSetSaved(state, state.setId);
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
  if (state.pending.some(item => item.setId === state.setId)) {
    const saved = await saveDraft(state);
    if (!saved.startsWith("Saved changes")) return saved;
  }
  try {
    const result = await requestJson<{ packageId: string; contentHash?: string }>(
      "/v1/editor/mission-sets/" + encodeURIComponent(state.setId) + "/publish",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publishRequest(state.draftVersion)) }
    );
    state.publishedPackageId = result.packageId;
    savePublishedSnapshot(state.setId, state.draft);
    markSetPublished(state, state.setId);
    state.status = "Published " + result.packageId + "." +
      (result.contentHash && !result.contentHash.startsWith(result.packageId.split("-").at(-1) ?? "")
        ? " The editor's local copy differs from the server draft; reopen the set to compare."
        : "");
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
    const result = await requestJson<{ sets: SetSummary[] }>("/v1/editor/mission-sets");
    state.sets = result.sets;
  } catch {
    // Keep the last known list; local drafts remain visible.
  }
}

/** Replays a hash route after the user presses browser Back/Forward. */
async function restoreRoute(route: AppRoute): Promise<void> {
  const container = appContainer;
  const state = appState;
  if (!container || !state) return;
  restoringRoute = true;
  try {
    if (route.kind === "browser") {
      state.setId = "";
      state.view = "browser";
      renderBrowser(container, state);
    } else if (route.kind === "set") {
      await openSet(container, state, route.setId);
    } else if (activeEditorRoute && activeEditorRoute.workspace === route.workspace &&
      activeEditorRoute.section === route.section && activeEditorRoute.key === route.key) {
      // Same record: replay just the guided step/mode, keeping unsaved editor state.
      const { setEditorNavigation } = await import("../editor/main");
      setEditorNavigation(route.step ?? 0, route.mode ?? "guided");
    } else if (route.section && route.key) {
      const restored = await continueEditing(container, state, {
        workspace: route.workspace, section: route.section, key: route.key,
        step: route.step, mode: route.mode
      });
      if (!restored) {
        state.status = "That content is no longer available.";
        renderBrowser(container, state);
      }
    } else {
      if (state.setId !== route.workspace) await openSet(container, state, route.workspace);
      await openClassicEditor(container, state);
    }
  } finally {
    restoringRoute = false;
  }
}

/** Mounts the set manager into the app root after authentication. */
let appMounted = false;

export async function mountApp(container: HTMLElement): Promise<void> {
  // A fresh page load with an editor/set hash restores that screen. Re-mounts in
  // the same document (tests, sign-in rerenders) return to the dashboard.
  const initialRoute = appMounted ? null : parseRouteHash(location.hash);
  pruneStaleDrafts();
  const capabilities = await loadCapabilities();
  const session = loadSession();
  const state: AppState = {
    capabilities, sets: [], view: "browser", activeSection: "missions", setId: "", draft: emptyContentSet("", ""),
    draftVersion: 0, status: "", validation: { valid: false, issues: [] },
    help: session.help, savedAt: session.savedAt, lastEdited: session.lastEdited,
    recent: session.recent, pending: session.pending, unpublished: session.unpublished, tabs: session.tabs,
    dashboardTab: "unsaved", dirty: false, baseline: null
  };
  appContainer = container;
  appState = state;
  history.replaceState(null, "", location.hash || "#/");
  routeHash = location.hash || "#/";
  if (!popStateBound) {
    popStateBound = true;
    window.addEventListener("popstate", () => {
      routeHash = location.hash || "#/";
      const route = parseRouteHash(location.hash) ?? { kind: "browser" as const };
      void restoreRoute(route);
    });
  }
  await refreshSets(state);
  if (initialRoute && initialRoute.kind !== "browser") await restoreRoute(initialRoute);
  else renderBrowser(container, state);
  appMounted = true;
}


