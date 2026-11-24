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
import { packContentSet } from "./packer";
import { loadSession, saveSession, type LastEdited } from "./session";
import { gameCapabilitiesSchema } from "./zod";
import type { ContentSetDocument, GameCapabilities } from "./types";
import { validateContentSet, type ValidationResult } from "./validation";
import {
  hasUnsyncedWorkspace, loadScratchWorkspace, loadWorkspace, markWorkspaceSynced,
  saveScratchWorkspace, SCRATCH_WORKSPACE
} from "../editor/workspace-store";
import { workspaceToDraft } from "../editor/convert";
import {
  activeArmyJson, activeCampaignJson, activeDialogueJson, activeQuestJson,
  parseImportedJson, decodeZipText
} from "../editor/export";
import { readStoredZip } from "../editor/zip";
import type { Workspace } from "../editor/model";

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
  lastEdited: LastEdited | null;
}

type DetailSection = "campaigns" | "quests" | "armies" | "dialogues";
const SECTION_LABELS: Record<DetailSection, string> = {
  campaigns: "Campaign", quests: "Quest", armies: "Army", dialogues: "Dialogue"
};
const SECTION_SINGULAR: Record<DetailSection, "campaign" | "quest" | "army" | "dialogue"> = {
  campaigns: "campaign", quests: "quest", armies: "army", dialogues: "dialogue"
};
const SECTIONS = Object.keys(SECTION_LABELS) as DetailSection[];

function localKey(): string {
  return "meowedit.v2.sets." + (getBridgeUserId() ?? "local");
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
    help: state.help, savedAt: state.savedAt, setId: state.setId || null, lastEdited: state.lastEdited
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

function continueCard(state: AppState): string {
  const last = state.lastEdited;
  if (!last) return "";
  const inScratch = last.workspace === SCRATCH_WORKSPACE;
  const exists = inScratch
    ? scratchRecords().some(record => record.section === last.section && record.key === last.key)
    : (() => {
      const draft = storage()[last.workspace]?.draft;
      if (!draft) return false;
      const items = draft[last.section] as unknown as Array<{ id?: string; sequenceId?: string }>;
      return items.some(item => (item.id ?? item.sequenceId) === last.key);
    })();
  if (!exists) return "";
  return '<div class="set-row continue-row"><div class="set-row-main"><strong>Continue editing: ' +
    escapeHtml(last.label) + "</strong><small>" + escapeHtml(SECTION_LABELS[last.section]) +
    " · " + (inScratch ? "local draft" : "set " + escapeHtml(last.workspace)) + "</small></div>" +
    '<button type="button" class="button button-primary" data-continue-edit="' +
    escapeHtml(last.workspace) + "|" + last.section + "|" + last.key + '">Continue editing</button></div>';
}

function renderBrowser(container: HTMLElement, state: AppState): void {
  state.view = "browser";
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
      ? '<button type="button" class="text-button danger-text" data-delete="' + escapeHtml(summary.setId) + '">Delete</button>'
      : "") +
    '<button type="button" class="button button-outline" data-open="' + escapeHtml(summary.setId) + '">Open</button></div>'
  ).join("") : '<div class="set-empty">No content sets yet. Create one below.</div>';
  const locals = scratchRecords();
  const localRows = locals.length ? locals.map(record =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(record.label) + "</strong><small>" +
    SECTION_LABELS[record.section] + "</small></div>" +
    '<button type="button" class="text-button" data-edit-local="' + record.section + "|" + escapeHtml(record.key) + '">Edit</button>' +
    '<button type="button" class="text-button" data-export-local="' + record.section + "|" + escapeHtml(record.key) + '">Export</button>' +
    '<button type="button" class="text-button danger-text" data-delete-local="' + record.section + "|" + escapeHtml(record.key) + '">Delete</button>' +
    '<button type="button" class="button button-outline" data-assign-local="' + record.section + "|" + escapeHtml(record.key) + '">Assign to set</button></div>'
  ).join("") : '<div class="set-empty">No local drafts yet. Create content below.</div>';

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">DASHBOARD</span></div><div class="topbar-actions">' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>Your dashboard</h1>' +
    "<p>Create content locally, then assign it to a set to upload it.</p></div>" +
    '<button type="button" class="button button-primary" data-new-set>+ New set</button></div>' +
    '<section class="set-group"><h2>Continue editing</h2>' + (continueCard(state) || '<div class="set-empty">Nothing in progress.</div>') + '</section>' +
    '<section class="set-group"><h2>Sets</h2><div class="set-list">' + rows + "</div></section>" +
    '<section class="set-group"><h2>Create new content</h2><div class="guided-actions">' +
    SECTIONS.map(section => '<button type="button" class="button button-outline" data-create="' + section + '">+ ' +
      SECTION_LABELS[section] + "</button>").join("") + "</div></section>" +
    '<section class="set-group"><h2>Local drafts (not in a set)</h2><div class="set-list">' + localRows + "</div>" +
    '<div class="guided-actions"><button type="button" class="button button-outline" data-import>Import JSON / ZIP</button></div></section>' +
    '<input id="dashboard-import-file" class="visually-hidden" type="file" accept=".json,.zip,application/json,application/zip">' +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";
  writeSession(state);

  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderBrowser(container, state);
  });
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
    void openLocal(container, state, buttonData(button.dataset.editLocal));
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
  return activeCampaignJson(item as never);
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
    key, id, idAuto: true, name, description: "", designMode: "custom", boardPreviewUnitId: "", questIds: [],
    floors: [], events: [], settings: {
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
  const id = nextSystemId(section);
  const name = SECTION_LABELS[section] + " " + id.split("-")[1];
  const workspace = loadScratchWorkspace();
  const record = createLocalRecord(section, id, name);
  (workspace[section] as unknown as Array<Record<string, unknown>>).push(record);
  workspace.selectedType = SECTION_SINGULAR[section];
  workspace.selectedKey = String(record.key);
  saveScratchWorkspace(workspace);
  await openEditor(container, state, {
    workspace: SCRATCH_WORKSPACE, section,
    index: (workspace[section] as unknown as unknown[]).length - 1,
    key: String(record.key), label: name, forceMode: "guided"
  });
}

async function openLocal(container: HTMLElement, state: AppState, input: { section: DetailSection; key: string }): Promise<void> {
  const workspace = loadScratchWorkspace();
  const index = (workspace[input.section] as unknown as Array<Record<string, unknown>>)
    .findIndex(item => item.key === input.key);
  if (index < 0) return;
  const item = localRecord(input.section, input.key)!;
  workspace.selectedType = SECTION_SINGULAR[input.section];
  workspace.selectedKey = input.key;
  saveScratchWorkspace(workspace);
  await openEditor(container, state, { workspace: SCRATCH_WORKSPACE, section: input.section, index, key: input.key, label: recordLabel(input.section, item) });
}

async function continueEditing(container: HTMLElement, state: AppState, input: { workspace: string; section: DetailSection; key: string }): Promise<void> {
  if (input.workspace === SCRATCH_WORKSPACE) {
    await openLocal(container, state, { section: input.section, key: input.key });
    return;
  }
  let draft = storage()[input.workspace]?.draft;
  if (!draft) {
    try {
      const loaded = await requestJson<{ draft: ContentSetDocument; draftVersion: number }>(
        "/v1/editor/campaign-sets/" + encodeURIComponent(input.workspace));
      draft = loaded.draft;
    } catch { return; }
  }
  const items = draft[input.section] as unknown as Array<{ id?: string; sequenceId?: string }>;
  const index = items.findIndex(item => (item.id ?? item.sequenceId) === input.key);
  if (index < 0) return;
  state.setId = input.workspace;
  state.draft = draft;
  state.draftVersion = storage()[input.workspace]?.draftVersion ?? 1;
  await openEditor(container, state, { workspace: input.workspace, section: input.section, index, key: input.key, label: entryLabel(draft, input.section, index) });
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
}

async function openEditor(container: HTMLElement, state: AppState, target: EditorTarget): Promise<void> {
  try {
    const { mountEditor } = await import("../editor/main");
    state.lastEdited = { workspace: target.workspace, section: target.section, key: target.key, label: target.label };
    syncSession(state);
    const scratch = target.workspace === SCRATCH_WORKSPACE;
    mountEditor({
      setId: scratch ? undefined : target.workspace,
      draft: scratch ? undefined : state.draft,
      capabilities: state.capabilities,
      selected: { section: target.section, index: target.index },
      forceMode: target.forceMode,
      onSave: () => saveDraft(state),
      onDraftChange: () => {
        if (!scratch) {
          state.validation = validateContentSet(state.draft, state.capabilities);
          persistLocal(state);
        }
      },
      onBack: () => (scratch ? renderBrowser(container, state) : renderSetView(container, state)),
      onPublish: () => publishDraft(state),
      canPublishEditor: () => state.validation.valid && canPublish(),
      onAssign: () => { void showAssignDialog(container, state, { section: target.section, key: target.key }); },
      onRecordChange: (section, key, label) => {
        state.lastEdited = { workspace: target.workspace, section: section as DetailSection, key, label };
        syncSession(state);
      }
    });
  } catch (error) {
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
  } else if (section === "campaigns") {
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
      deps.map(dep => '<label class="campaign-check"><input type="checkbox" checked data-dep="' +
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
        "/v1/editor/campaign-sets/" + encodeURIComponent(setId));
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
      version > 0 ? "/v1/editor/campaign-sets/" + encodeURIComponent(setId) : "/v1/editor/campaign-sets",
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
    '<button type="button" class="text-button" data-back-browser>Dashboard</button>' +
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
    const { mountEditor } = await import("../editor/main");
    mountEditor({
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
    help: session.help, savedAt: session.savedAt, lastEdited: session.lastEdited
  };
  await refreshSets(state);
  renderBrowser(container, state);
}


