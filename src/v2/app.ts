import "./app.css";
import {
  canDeleteSets, canPublish, getBridgeActions, getBridgeFetch, getBridgeUserId
} from "../bridge-context";
import {
  createSetRequest, isDraftConflict, publishRequest, saveDraftRequest
} from "./endpoints";
import { DETAIL_SECTIONS, detailItemCount, renderDetailSection, type DetailSection } from "./details";
import { emptyContentSet, localized, namedRef } from "./factory";
import { escapeHtml } from "./html";
import { APP_VERSION } from "./version";
import { packContentSet } from "./packer";
import { loadArmyCatalog, type ArmyCatalogLite } from "./catalog";
import { loadSession, saveSession } from "./session";
import { renderRichEditor, richItemLabel, type RichState } from "./rich";
import { ACTIONS, CONDITIONS, TRIGGERS } from "./registries";
import type { CampaignEvent, ContentSetV2Document, GameCapabilities } from "./types";
import { validateContentSet, type ValidationResult } from "./validation";

interface SetSummary {
  setId: string;
  name?: string;
  draftVersion: number;
  publishedPackageId?: string;
  updatedAt?: string;
}

interface LocalRecord {
  draft: ContentSetV2Document;
  draftVersion: number;
  publishedPackageId?: string;
}

interface AppState {
  capabilities: GameCapabilities;
  catalog: ArmyCatalogLite;
  sets: SetSummary[];
  view: "browser" | "wizard" | "set";
  focus: DetailSection;
  entry: { section: DetailSection; index: number } | null;
  rich: RichState;
  rawFields: boolean;
  adding: boolean;
  addName: string;
  addId: string;
  setId: string;
  draft: ContentSetV2Document;
  draftVersion: number;
  publishedPackageId?: string;
  step: number;
  contentKind: "dialogue" | "quest" | "army" | "event" | null;
  draftTitle: string;
  draftSecondary: string;
  status: string;
  validation: ValidationResult;
  help: boolean;
  savedAt: string | null;
}

const STEP_TITLES = ["Set details", "Campaign", "Board character", "Content", "Review & publish"];
const SECTION_LABELS: Record<DetailSection, { singular: string; plural: string }> = {
  campaigns: { singular: "Campaign", plural: "Campaigns" },
  quests: { singular: "Quest", plural: "Quests" },
  armies: { singular: "Army", plural: "Armies" },
  dialogues: { singular: "Dialogue", plural: "Dialogues" }
};

const STEP_COPY = [
  "Give the content set a stable ID and a name shown in the game menu.",
  "Create the first campaign in this set. You can add more later.",
  "Pick the unit shown as the player's character on the Adventure board.",
  "Add the dialogues, quests, armies and events this mission needs.",
  "Check validation, then save the draft and publish when it is ready."
];
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

function syncSession(state: AppState): void {
  state.savedAt = new Date().toISOString();
  saveSession({
    view: state.view, focus: state.focus,
    entry: state.entry ? { section: state.entry.section, index: state.entry.index } : null,
    rich: { ...state.rich }, rawFields: state.rawFields, step: state.step,
    help: state.help, savedAt: state.savedAt, setId: state.setId || null
  });
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const request = getBridgeFetch();
  if (!request) throw new Error("The authenticated Bridge connection is unavailable.");
  const response = await request(path, init);
  const body = await response.json().catch(() => null) as T & { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "The request failed (" + response.status + ").");
  return body as T;
}

async function loadCapabilities(): Promise<GameCapabilities> {
  try {
    return await requestJson<GameCapabilities>("/v1/editor/capabilities");
  } catch {
    const response = await fetch("./game-capabilities.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("No capability manifest is available.");
    return await response.json() as GameCapabilities;
  }
}

function newCampaign(id: string, name: string, capabilities: GameCapabilities): ContentSetV2Document["campaigns"][number] {
  return {
    schemaVersion: 2, id, name: localized(name), description: localized(""),
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
      shopPoolKinds: [capabilities.enums.shopPoolKind[0]], questNodeCountPerRandomFloor: 2,
      shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2, continueWithGeneratedFloors: false,
      blessingsEnabled: true, restoreArmyAfterLoss: true
    }
  };
}

function field(label: string, bind: string, value: unknown, type = "text", options?: readonly string[]): string {
  const control = options
    ? '<select data-v2-bind="' + bind + '">' + options.map(item =>
      '<option value="' + escapeHtml(item) + '"' + (item === value ? " selected" : "") + ">" + escapeHtml(item) + "</option>").join("") + "</select>"
    : '<input type="' + type + '" data-v2-bind="' + bind + '" value="' + escapeHtml(String(value ?? "")) + '">';
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + "</span>" + control + "</label>";
}

function badge(summary: SetSummary, records: Record<string, LocalRecord>): string {
  if (summary.publishedPackageId)
    return '<span class="set-badge published">Published · ' + escapeHtml(summary.publishedPackageId.slice(-8)) + "</span>";
  if (summary.draftVersion > 0)
    return '<span class="set-badge draft">Draft v' + summary.draftVersion + "</span>";
  if (records[summary.setId])
    return '<span class="set-badge local">Local only</span>';
  return '<span class="set-badge">New</span>';
}

function renderBrowser(container: HTMLElement, state: AppState): void {
  const records = storage();
  const sets = [...state.sets];
  for (const [setId, record] of Object.entries(records))
    if (!sets.some(item => item.setId === setId))
      sets.push({
        setId,
        name: record.draft.set.name.default || setId,
        draftVersion: record.draftVersion,
        publishedPackageId: record.publishedPackageId
      });
  const rows = sets.length ? sets.map(summary =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(summary.name || summary.setId) + "</strong>" +
    "<small>" + escapeHtml(summary.setId) + "</small></div>" +
    '<div class="set-badges">' + badge(summary, records) + "</div>" +
    '<button type="button" class="text-button" data-rename="' + escapeHtml(summary.setId) + '">Rename</button>' +
    (canDeleteSets()
      ? '<button type="button" class="text-button danger-text" data-delete="' + escapeHtml(summary.setId) + '">Delete</button>'
      : "") +
    '<button type="button" class="button button-outline" data-open="' + escapeHtml(summary.setId) + '">Open</button></div>'
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

  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-new-set]")?.addEventListener("click", () => {
    const set = emptyContentSet("", "New content set");
    set.campaigns.push(newCampaign("campaign-1", "First campaign", state.capabilities));
    set.set.campaignOrder = [set.campaigns[0].id];
    state.setId = "";
    state.draft = set;
    state.draftVersion = 0;
    state.publishedPackageId = undefined;
    state.step = 0;
    state.contentKind = null;
    state.view = "wizard";
    renderEditor(container, state);
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
      const loaded = await requestJson<{ draft: ContentSetV2Document; draftVersion: number }>(
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
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
  if (!window.confirm("Delete content set '" + setId + "'? This cannot be undone.")) return;
  const records = storage();
  const version = records[setId]?.draftVersion ?? state.sets.find(item => item.setId === setId)?.draftVersion ?? 0;
  try {
    if (version > 0)
      await requestJson<{ deleted: boolean }>("/v1/editor/campaign-sets/" + encodeURIComponent(setId), { method: "DELETE" });
    delete records[setId];
    localStorage.setItem(localKey(), JSON.stringify(records));
    state.status = "Deleted " + setId + ".";
    await refreshSets(state);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Deletion failed. The set was not removed.";
  }
  renderBrowser(container, state);
}

async function openSet(container: HTMLElement, state: AppState, setId: string): Promise<void> {
  const records = storage();
  const local = records[setId];
  const summary = state.sets.find(item => item.setId === setId);
  let draft = local?.draft;
  let version = local?.draftVersion ?? 0;
  let published = local?.publishedPackageId ?? summary?.publishedPackageId;
  if (summary && summary.draftVersion > 0) {
    try {
      const loaded = await requestJson<{ draftVersion: number; draft: ContentSetV2Document }>(
        "/v1/editor/campaign-sets/" + encodeURIComponent(setId));
      draft = loaded.draft;
      version = loaded.draftVersion;
    } catch (error) {
      state.status = error instanceof Error ? error.message : "The draft could not be loaded.";
    }
  }
  state.setId = setId;
  if (!draft) {
    draft = emptyContentSet(setId, setId);
    draft.campaigns.push(newCampaign("campaign-1", "First campaign", state.capabilities));
    draft.set.campaignOrder = [draft.campaigns[0].id];
  }
  state.draft = draft;
  state.draft.set.setId = setId;
  state.draftVersion = version;
  state.publishedPackageId = published;
  state.contentKind = null;
  state.entry = null;
  state.adding = false;
  state.focus = "campaigns";
  const existing = version > 0 || draft.campaigns.length > 0 || draft.quests.length > 0
    || draft.armies.length > 0 || draft.dialogues.length > 0;
  state.view = existing ? "set" : "wizard";
  state.validation = validateContentSet(state.draft, state.capabilities);
  if (state.view === "set") renderSetView(container, state);
  else renderEditor(container, state);
}

function addContent(state: AppState): void {
  const campaign = state.draft.campaigns[0];
  if (!campaign) return;
  const title = state.draftTitle.trim() || "Untitled";
  if (state.contentKind === "dialogue") {
    const sequenceId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dialogue";
    state.draft.dialogues.push({
      schemaVersion: 2, sequenceId, startNodeId: "opening", pauseMode: "none", defaultCharactersPerSecond: 30,
      nodes: [{ id: "opening", headline: localized(title), textSpeed: 30, speakers: [],
        segments: [{ speakerIds: [], text: localized(state.draftSecondary || title) }], actions: [] }]
    });
  } else if (state.contentKind === "quest") {
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quest";
    state.draft.quests.push({
      schemaVersion: 2, id, title: localized(title), description: localized(state.draftSecondary),
      objectiveKind: state.capabilities.enums.objectiveKind[0],
      rewardKind: state.capabilities.enums.rewardKind[0], rewardAmount: 0,
      meowEdit: {
        schemaVersion: 2,
        dialogueLinks: { offer: [], active: [], completion: [], failure: [] }, logicKind: "none",
        timer: {
          decisionId: namedRef("decision-" + id), payOutcomeId: namedRef("outcome-" + id),
          waitOutcomeId: namedRef("outcome-" + id), counterId: namedRef("counter-" + id),
          counterTarget: 1, counterLabel: localized("Battles"), countEvent: "battle-won",
          paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: []
        },
        completionEffects: [], fetchItems: [], battleTargets: [],
        killCount: { targetKind: "unit", targetId: namedRef(state.capabilities.ids.units[0] ?? "unit"), count: 1 },
        minimumNodeDistances: []
      }
    });
  } else if (state.contentKind === "army") {
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "army";
    state.draft.armies.push({
      schemaVersion: 2, id, name: localized(title), units: [], spellIds: [], blessingIds: [], CellBlessingPicks: []
    });
  } else if (state.contentKind === "event") {
    campaign.events.push({
      id: "event-" + (campaign.events.length + 1),
      trigger: state.draftTitle || TRIGGERS[0],
      conditions: [], actions: [{ kind: ACTIONS[0].kind, parameters: ACTIONS[0].parameters.map(parameter => ({
        key: parameter.key,
        value: parameter.type === "int" ? 1 : parameter.type === "NamedRef[]" ? []
          : parameter.type === "NamedRef" ? namedRef(state.capabilities.ids.units[0] ?? "unit") : ""
      })) }],
      oneShot: (state.draftSecondary || "per-run") as "per-run" | "per-node" | "always"
    });
  }
  state.contentKind = null;
  state.draftTitle = "";
  state.draftSecondary = "";
  state.validation = validateContentSet(state.draft, state.capabilities);
  persistLocal(state);
}

function renderEditor(container: HTMLElement, state: AppState): void {
  const draft = state.draft;
  const campaign = draft.campaigns[0];
  const step = state.step;
  const fields: string[] = [];

  if (step === 0) {
    fields.push(field("Set ID", "set.setId", draft.set.setId));
    fields.push(field("Name shown in game", "set.name.default", draft.set.name.default));
  } else if (step === 1) {
    fields.push(field("Campaign ID", "campaigns[0].id", campaign?.id ?? ""));
    fields.push(field("Campaign name", "campaigns[0].name.default", campaign?.name.default ?? ""));
  } else if (step === 2) {
    fields.push(field("Board character", "campaigns[0].boardPreviewUnitId", campaign?.boardPreviewUnitId.id ?? "", "text", state.capabilities.ids.units));
  } else if (step === 3) {
    const kind = state.contentKind;
    fields.push('<div class="guided-actions">' +
      (["dialogue", "quest", "army", "event"] as const).map(item =>
        '<button type="button" class="button ' + (kind === item ? "button-primary" : "button-outline") + '" data-kind="' + item + '">' + item + "</button>").join("") + "</div>");
    if (kind === "event") {
      fields.push(field("Trigger", "draftTitle", state.draftTitle || TRIGGERS[0], "text", TRIGGERS));
      fields.push(field("One shot", "draftSecondary", state.draftSecondary || "per-run", "text", ["per-run", "per-node", "always"]));
    } else if (kind) {
      fields.push(field(kind === "dialogue" ? "Sequence title" : "Name", "draftTitle", state.draftTitle));
      fields.push(field(kind === "quest" ? "Description" : "First line", "draftSecondary", state.draftSecondary));
    }
    fields.push('<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      field("Set description", "set.description.default", draft.set.description.default) +
      field("Campaign description", "campaigns[0].description.default", campaign?.description.default ?? "") +
      "</div></details>");
  } else {
    fields.push(state.validation.valid
      ? '<p class="step-copy">Ready. Save uploads a private draft; Publish makes it available to players.</p>'
      : renderValidationPanel(state));
  }

  const progress = '<div class="guided-progress">' + STEP_TITLES.map((_, index) =>
    '<span class="' + (index < step ? "done" : index === step ? "current" : "") + '"></span>').join("") + "</div>";
  const contentList = step === 3 ? '<div class="guided-list">' +
    draft.dialogues.map(item => '<div class="guided-list-item"><span>Dialogue · ' + escapeHtml(item.sequenceId) + "</span></div>").join("") +
    draft.quests.map(item => '<div class="guided-list-item"><span>Quest · ' + escapeHtml(item.title.default) + "</span></div>").join("") +
    draft.armies.map(item => '<div class="guided-list-item"><span>Army · ' + escapeHtml(item.name.default) + "</span></div>").join("") +
    campaign?.events.map(item => '<div class="guided-list-item"><span>Event · ' + escapeHtml(item.trigger) + "</span></div>").join("") +
    "</div>" : "";

  const statusBadge = state.publishedPackageId ? '<span class="set-badge published">Published</span>'
    : state.draftVersion > 0 ? '<span class="set-badge draft">Draft v' + state.draftVersion + "</span>"
      : '<span class="set-badge local">Local only</span>';

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">' + escapeHtml(state.setId || "NEW SET") + "</span></div>" +
    '<div class="topbar-actions">' + statusBadge +
    '<button type="button" class="text-button" data-advanced>Advanced controls</button>' +
    '<button type="button" class="text-button" data-back-browser>Sets</button>' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '"><div class="editor-heading"><div><h1>' + escapeHtml(STEP_TITLES[step]) + "</h1>" +
    "<p>" + escapeHtml(STEP_COPY[step]) + "</p></div><span class=\"guided-step-count\">Step " + (step + 1) + " of " + STEP_TITLES.length + "</span></div>" +
    '<div class="guided">' + progress + '<section class="guided-step">' + fields.join("") + contentList +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p>" +
    '<div class="guided-actions">' +
    (step > 0 ? '<button type="button" class="button button-outline" data-prev>Back</button>' : "") +
    (step < STEP_TITLES.length - 1
      ? '<button type="button" class="button button-primary" data-next>Next</button>'
      : '<button type="button" class="button button-outline" data-save>Save / Upload</button>' +
        '<button type="button" class="button button-primary" data-publish' + (canPublish() && state.validation.valid ? "" : " disabled") + '>Publish</button>') +
    "</div></section></div></div></main>";

  container.querySelector<HTMLElement>("[data-advanced]")?.addEventListener("click", () => {
    state.view = "set";
    state.entry = null;
    renderSetView(container, state);
  });
  container.querySelector<HTMLElement>("[data-back-browser]")?.addEventListener("click", () => {
    state.view = "browser";
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
  container.querySelector<HTMLElement>("[data-toggle-help]")?.addEventListener("click", () => {
    state.help = !state.help;
    syncSession(state);
    renderEditor(container, state);
  });
  container.querySelector<HTMLElement>("[data-prev]")?.addEventListener("click", () => {
    state.step -= 1;
    state.status = "";
    renderEditor(container, state);
  });
  container.querySelector<HTMLElement>("[data-next]")?.addEventListener("click", () => {
    if (step === 3 && state.contentKind) addContent(state);
    state.step += 1;
    state.status = "";
    state.validation = validateContentSet(state.draft, state.capabilities);
    renderEditor(container, state);
  });
  container.querySelectorAll<HTMLElement>("[data-kind]").forEach(button => button.addEventListener("click", () => {
    state.contentKind = button.dataset.kind as AppState["contentKind"];
    state.draftTitle = "";
    state.draftSecondary = "";
    renderEditor(container, state);
  }));
  container.querySelector<HTMLElement>("[data-save]")?.addEventListener("click", () => { void saveDraft(container, state); });
  container.querySelector<HTMLElement>("[data-publish]")?.addEventListener("click", () => { void publishDraft(container, state); });
  container.querySelectorAll<HTMLElement>("[data-fix-ref]").forEach(button => button.addEventListener("click", () => {
    applySuggestedFix(state, button.dataset.fixRef!, button.dataset.suggestion!);
    renderEditor(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-fix-nav]").forEach(button => button.addEventListener("click", () => {
    state.view = "set";
    state.focus = button.dataset.fixNav as DetailSection;
    state.entry = { section: state.focus, index: Number(button.dataset.index) };
    renderSetView(container, state);
  }));
  container.onchange = event => {
    applyChange(state, event);
    flashStatus(container, state);
  };
}

function renderValidationPanel(state: AppState): string {
  const issues = state.validation.issues;
  if (!issues.length) return '<p class="step-copy">No contract issues. This set is ready to upload.</p>';
  const groups = new Map<string, typeof issues>();
  for (const issue of issues) {
    const key = issue.section ? issue.section.charAt(0).toUpperCase() + issue.section.slice(1) : "Set";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }
  const fixable = issues.filter(issue => issue.code === "unresolved-reference" && issue.suggestions?.length);
  const sections = [...groups].map(([name, items]) =>
    '<div class="validation-group"><h3>' + escapeHtml(name) + ' <span>(' + items.length + ')</span></h3>' +
    items.map(issue => '<div class="validation-issue ' + (issue.severity === "warning" ? "warning" : "") + '">' +
      '<div class="validation-issue-title">' + escapeHtml(issue.message) + '</div>' +
      (issue.hint ? '<div class="validation-issue-hint">' + escapeHtml(issue.hint) + '</div>' : "") +
      '<div class="validation-issue-actions">' +
      (issue.section && issue.entryIndex !== undefined
        ? '<button type="button" class="button button-small" data-fix-nav="' + escapeHtml(issue.section) + '" data-index="' + issue.entryIndex + '">Open entry</button>' : "") +
      (issue.suggestions ?? []).map(suggestion =>
        '<button type="button" class="button button-small" data-fix-ref="' + escapeHtml(issue.path) + '" data-suggestion="' + escapeHtml(suggestion) + '">Use ' + escapeHtml(suggestion) + '</button>').join("") +
      "</div></div>").join("") + "</div>").join("");
  return '<div class="validation-panel">' +
    '<div class="validation-top"><strong>' + issues.length + ' item' + (issues.length === 1 ? "" : "s") + ' to check</strong>' +
    (fixable.length ? '<button type="button" class="button button-small" data-fix-all>Apply ' + fixable.length + ' suggested fix' + (fixable.length === 1 ? "" : "es") + '</button>' : "") +
    "</div>" + sections + "</div>";
}

function applySuggestedFix(state: AppState, path: string, suggestion: string): void {
  const target = path.endsWith(".id") ? path.slice(0, -3) : path;
  setByPath(state.draft, target, path.endsWith(".id") ? namedRef(suggestion) : suggestion);
  state.validation = validateContentSet(state.draft, state.capabilities);
  persistLocal(state);
}

function entryLabel(draft: ContentSetV2Document, section: DetailSection, index: number): string {
  if (section === "campaigns") return draft.campaigns[index]?.name.default || draft.campaigns[index]?.id || String(index);
  if (section === "quests") return draft.quests[index]?.title.default || draft.quests[index]?.id || String(index);
  if (section === "armies") return draft.armies[index]?.name.default || draft.armies[index]?.id || String(index);
  return draft.dialogues[index]?.sequenceId || String(index);
}

function renderSetView(container: HTMLElement, state: AppState): void {
  const draft = state.draft;
  const focus = state.focus;
  const tabs = DETAIL_SECTIONS.map(section =>
    '<button type="button" class="button ' + (focus === section && !state.entry && !state.adding ? "button-primary" : "button-outline") +
    '" data-focus="' + section + '">' + SECTION_LABELS[section].plural + " (" + detailItemCount(draft, section) + ")</button>").join("");
  const topbar = '<div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">' + escapeHtml(state.setId) + "</span></div><div class=\"topbar-actions\">" +
    '<button type="button" class="text-button" data-back-browser>Sets</button>' +
    '<span class="version-tag">' + APP_VERSION + '</span>' +
    '<button type="button" class="text-button" data-toggle-help aria-pressed="' + state.help + '">' + (state.help ? "Hide help" : "Help") + '</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>';
  const heading = '<div class="editor-heading"><div><h1>' + escapeHtml(draft.set.name.default || state.setId) + "</h1>" +
    "<p>" + draft.campaigns.length + " campaigns · " + draft.quests.length + " quests · " +
    draft.armies.length + " armies · " + draft.dialogues.length + " dialogues</p></div></div>";

  let body: string;
  if (state.adding) {
    body = heading +
      '<section class="guided-step"><h2>Add ' + SECTION_LABELS[focus].singular + "</h2>" +
      '<p class="step-copy">Two fields to start. Everything else can be filled in later from the advanced view.</p>' +
      '<div class="guided-fields">' +
      '<label class="field"><span class="field-label">Name</span><input data-v2-add="name" value="' + escapeHtml(state.addName) + '"></label>' +
      '<label class="field"><span class="field-label">ID (optional)</span><input data-v2-add="id" value="' + escapeHtml(state.addId) + '" placeholder="generated if empty"></label>' +
      '<details class="guided-advanced"><summary>More options (not required)</summary><div class="form-grid">' +
      '<p class="step-copy">Quests default to the first objective/reward kind; campaigns start with one floor. Adjust these in the advanced view.</p>' +
      "</div></details></div>" +
      '<div class="guided-actions"><button type="button" class="button button-outline" data-add-cancel>Cancel</button>' +
      '<button type="button" class="button button-primary" data-add-create>Create ' + SECTION_LABELS[focus].singular + "</button></div></section>";
  } else if (state.entry) {
    const { section, index } = state.entry;
    body = heading +
      '<div class="guided-actions"><button type="button" class="button button-outline" data-entry-back>← Back to list</button>' +
      '<button type="button" class="button button-small" data-toggle-raw>' +
      (state.rawFields ? "Guided" : "Advanced") + "</button></div>" +
      '<section class="v2-details"><h2>Edit ' + SECTION_LABELS[section].singular + ': ' + escapeHtml(richItemLabel(draft, section, index)) + "</h2>" +
      '<p class="step-copy">Changes save locally as you type. Return to the list to upload or publish.</p>' +
      (state.rawFields
        ? renderDetailSection({ draft, capabilities: state.capabilities }, section, index)
        : renderRichEditor({ draft, capabilities: state.capabilities, catalog: state.catalog, rich: state.rich })) +
      "</section>";
  } else {
    const count = detailItemCount(draft, focus);
    const rows = Array.from({ length: count }, (_, index) =>
      '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(entryLabel(draft, focus, index)) + "</strong>" +
      "<small>" + escapeHtml(focus === "dialogues" ? draft.dialogues[index].sequenceId :
        focus === "campaigns" ? draft.campaigns[index].id :
          focus === "quests" ? draft.quests[index].id : draft.armies[index].id) + "</small></div>" +
      '<button type="button" class="text-button" data-entry-edit="' + index + '">Edit</button>' +
      '<button type="button" class="text-button danger-text" data-entry-remove="' + index + '">Remove</button></div>').join("");
    const validation = renderValidationPanel(state);
    body = heading +
      '<div class="guided-actions">' + tabs +
      '<button type="button" class="button button-primary" data-add="' + focus + '">+ Add ' + SECTION_LABELS[focus].singular + "</button></div>" +
      '<div class="set-list">' + (rows || '<div class="set-empty">No ' + focus + ' yet. Add one to get started.</div>') + "</div>" +
      '<section class="v2-validation"><h2>Validation</h2>' + validation + "</section>" +
      '<div class="guided-actions"><button type="button" class="button button-outline" data-save>Save / Upload</button>' +
      '<button type="button" class="button button-primary" data-publish' +
      (canPublish() && state.validation.valid ? "" : " disabled") + ">Publish</button></div>";
  }

  container.innerHTML = '<main class="editor-shell">' + topbar +
    '<div class="editor-main' + (state.help ? ' help-visible' : '') + '">' + body +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";

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
  container.querySelectorAll<HTMLElement>("[data-focus]").forEach(button => button.addEventListener("click", () => {
    state.focus = button.dataset.focus as DetailSection;
    state.entry = null;
    state.adding = false;
    renderSetView(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-entry-edit]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.entryEdit);
    state.entry = { section: focus, index };
    state.rich = { section: focus, index, step: 0, nodeIndex: 0, floorIndex: 0 };
    state.rawFields = false;
    renderSetView(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-entry-remove]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.entryRemove);
    if (!window.confirm("Remove this " + SECTION_LABELS[focus].singular + "?")) return;
    removeEntry(state, focus, index);
    renderSetView(container, state);
  }));
  container.querySelector<HTMLElement>("[data-entry-back]")?.addEventListener("click", () => {
    state.entry = null;
    renderSetView(container, state);
  });
  container.querySelector<HTMLElement>("[data-toggle-raw]")?.addEventListener("click", () => {
    state.rawFields = !state.rawFields;
    renderSetView(container, state);
  });
  wireRichActions(container, state);
  container.querySelector<HTMLElement>("[data-add]")?.addEventListener("click", () => {
    state.adding = true;
    state.addName = "";
    state.addId = "";
    renderSetView(container, state);
  });
  container.querySelector<HTMLElement>("[data-add-cancel]")?.addEventListener("click", () => {
    state.adding = false;
    renderSetView(container, state);
  });
  container.querySelector<HTMLElement>("[data-add-create]")?.addEventListener("click", () => {
    addItem(state, focus, state.addName || undefined, state.addId || undefined);
    state.adding = false;
    const index = detailItemCount(state.draft, focus) - 1;
    state.entry = { section: focus, index };
    state.rich = { section: focus, index, step: 1, nodeIndex: 0, floorIndex: 0 };
    state.rawFields = false;
    renderSetView(container, state);
  });
  container.querySelectorAll<HTMLInputElement>("[data-v2-add]").forEach(input => input.addEventListener("input", () => {
    if (input.dataset.v2Add === "name") state.addName = input.value;
    else state.addId = input.value;
  }));
  container.querySelector<HTMLElement>("[data-save]")?.addEventListener("click", () => { void saveDraft(container, state); });
  container.querySelector<HTMLElement>("[data-publish]")?.addEventListener("click", () => { void publishDraft(container, state); });
  container.querySelectorAll<HTMLElement>("[data-fix-ref]").forEach(button => button.addEventListener("click", () => {
    applySuggestedFix(state, button.dataset.fixRef!, button.dataset.suggestion!);
    renderSetView(container, state);
  }));
  container.querySelectorAll<HTMLElement>("[data-fix-nav]").forEach(button => button.addEventListener("click", () => {
    state.focus = button.dataset.fixNav as DetailSection;
    state.entry = { section: state.focus, index: Number(button.dataset.index) };
    renderSetView(container, state);
  }));
  container.querySelector<HTMLElement>("[data-fix-all]")?.addEventListener("click", () => {
    const before = state.validation.issues.length;
    for (const issue of [...state.validation.issues])
      if (issue.code === "unresolved-reference" && issue.suggestions?.length)
        applySuggestedFix(state, issue.path, issue.suggestions[0]);
    state.status = "Applied " + (before - state.validation.issues.length) + " suggested reference fix(es).";
    renderSetView(container, state);
  });
  wireDetailActions(container, state);
  container.onchange = event => {
    applyChange(state, event);
    flashStatus(container, state);
  };
}

function removeEntry(state: AppState, section: DetailSection, index: number): void {
  if (section === "campaigns") {
    const removed = state.draft.campaigns.splice(index, 1)[0];
    state.draft.set.campaignOrder = state.draft.set.campaignOrder.filter(id => id !== removed.id);
  } else if (section === "quests") state.draft.quests.splice(index, 1);
  else if (section === "armies") state.draft.armies.splice(index, 1);
  else state.draft.dialogues.splice(index, 1);
  state.validation = validateContentSet(state.draft, state.capabilities);
  persistLocal(state);
}

function addItem(state: AppState, section: DetailSection, name?: string, requestedId?: string): void {
  const capabilities = state.capabilities;
  const generated = (prefix: string) => prefix + "-" + (state.draft[section]?.length ?? 0) + 1;
  if (section === "campaigns") {
    const id = requestedId || generated("campaign");
    const campaign = newCampaign(id, name || id, capabilities);
    state.draft.campaigns.push(campaign);
    state.draft.set.campaignOrder.push(campaign.id);
  } else if (section === "quests") {
    const id = requestedId || generated("quest");
    state.draft.quests.push({
      schemaVersion: 2, id, title: localized(name || id), description: localized(""),
      objectiveKind: capabilities.enums.objectiveKind[0], rewardKind: capabilities.enums.rewardKind[0], rewardAmount: 0,
      meowEdit: {
        schemaVersion: 2, dialogueLinks: { offer: [], active: [], completion: [], failure: [] }, logicKind: "none",
        timer: {
          decisionId: namedRef("decision-" + id), payOutcomeId: namedRef("outcome-" + id),
          waitOutcomeId: namedRef("outcome-" + id), counterId: namedRef("counter-" + id),
          counterTarget: 1, counterLabel: localized("Battles"), countEvent: "battle-won",
          paymentResource: "sardines", paymentAmount: 0, paymentCompletesImmediately: false, completionEffects: []
        },
        completionEffects: [], fetchItems: [], battleTargets: [],
        killCount: { targetKind: "unit", targetId: namedRef(capabilities.ids.units[0] ?? "unit"), count: 1 },
        minimumNodeDistances: []
      }
    });
  } else if (section === "armies") {
    const id = requestedId || generated("army");
    state.draft.armies.push({ schemaVersion: 2, id, name: localized(name || id), units: [], spellIds: [], blessingIds: [], CellBlessingPicks: [] });
  } else {
    const id = requestedId || generated("dialogue");
    state.draft.dialogues.push({
      schemaVersion: 2, sequenceId: id, startNodeId: "opening", pauseMode: "none", defaultCharactersPerSecond: 30,
      nodes: [{ id: "opening", headline: localized(name || "Opening"), textSpeed: 30, speakers: [], segments: [], actions: [] }]
    });
  }
  state.validation = validateContentSet(state.draft, state.capabilities);
  persistLocal(state);
}

function wireDetailActions(container: HTMLElement, state: AppState): void {
  container.querySelectorAll<HTMLElement>("[data-detail-action]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.detailAction!;
    const index = Number(button.dataset.index ?? 0);
    const campaignIndex = Number(button.dataset.campaign ?? 0);
    const floorIndex = Number(button.dataset.floor ?? 0);
    const nodeIndex = Number(button.dataset.node ?? 0);
    const eventIndex = Number(button.dataset.event ?? 0);
    const questIndex = Number(button.dataset.quest ?? 0);
    const armyIndex = Number(button.dataset.army ?? 0);
    const dialogueIndex = Number(button.dataset.dialogue ?? 0);
    const campaign = state.draft.campaigns[campaignIndex];
    const floor = campaign?.floors[floorIndex];
    const node = floor?.nodes[nodeIndex];
    const event = campaign?.events[eventIndex];
    const quest = state.draft.quests[questIndex];
    const army = state.draft.armies[armyIndex];
    const dialogue = state.draft.dialogues[dialogueIndex];
    const dialogueNode = dialogue?.nodes[nodeIndex];
    const capabilities = state.capabilities;

    if (action === "add-node" && floor) floor.nodes.push({
      id: "node-" + (floor.nodes.length + 1), label: localized("Node"),
      kind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0], x: 0, y: 0,
      armyId: namedRef("army"), questId: namedRef("quest"), enemyFactionId: namedRef(capabilities.ids.factions[0] ?? "faction"),
      rewardKind: capabilities.enums.rewardKind[0], rewardAmount: 0,
      rewardContentId: namedRef("reward"), shopOfferMode: "generated", shopOffers: []
    });
    else if (action === "remove-node" && floor) floor.nodes.splice(index, 1);
    else if (action === "add-route" && floor) floor.routes.push({
      id: "route-" + (floor.routes.length + 1),
      fromNodeId: floor.nodes[0]?.id ?? "", toNodeId: floor.nodes.at(-1)?.id ?? "", oneWay: false
    });
    else if (action === "remove-route" && floor) floor.routes.splice(index, 1);
    else if (action === "add-offer" && node) node.shopOffers.push({
      kind: capabilities.enums.shopOfferKind[0], contentId: namedRef(capabilities.ids.units[0] ?? "unit"), price: 0
    });
    else if (action === "remove-offer" && node) node.shopOffers.splice(index, 1);
    else if (action === "add-event" && campaign) campaign.events.push(emptyEvent());
    else if (action === "remove-event" && campaign) campaign.events.splice(index, 1);
    else if (action === "add-condition" && event) event.conditions.push({ key: CONDITIONS[0].kind, value: null });
    else if (action === "remove-condition" && event) event.conditions.splice(index, 1);
    else if (action === "add-action" && event) event.actions.push({
      kind: ACTIONS[0].kind,
      parameters: ACTIONS[0].parameters.map(parameter => ({
        key: parameter.key,
        value: parameter.type === "int" ? 1 : parameter.type === "NamedRef[]" ? []
          : parameter.type === "NamedRef" ? namedRef(capabilities.ids.units[0] ?? "unit") : ""
      }))
    });
    else if (action === "remove-action" && event) event.actions.splice(index, 1);
    else if (action === "add-fetch-item" && quest) quest.meowEdit.fetchItems.push({ id: "item", displayName: localized("Item"), count: 1 });
    else if (action === "remove-fetch-item" && quest) quest.meowEdit.fetchItems.splice(index, 1);
    else if (action === "add-battle-target" && quest) quest.meowEdit.battleTargets.push({
      id: "target", label: localized("Target"), nodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0],
      floorOffset: 0, armyId: namedRef("army")
    });
    else if (action === "remove-battle-target" && quest) quest.meowEdit.battleTargets.splice(index, 1);
    else if (action === "add-distance" && quest) quest.meowEdit.minimumNodeDistances.push({
      id: "distance-" + (quest.meowEdit.minimumNodeDistances.length + 1),
      fromNodeKind: capabilities.enums.nodeKind[0], toNodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0],
      minimumHops: 1
    });
    else if (action === "remove-distance" && quest) quest.meowEdit.minimumNodeDistances.splice(index, 1);
    else if (action === "add-effect" && quest) quest.meowEdit.completionEffects.push({
      kind: "unlock", targetId: namedRef("target"), label: localized("Effect")
    });
    else if (action === "remove-effect" && quest) quest.meowEdit.completionEffects.splice(index, 1);
    else if (action === "add-unit" && army) army.units.push({ unitId: namedRef(capabilities.ids.units[0] ?? "unit"), x: 0, y: 0, spellIds: [] });
    else if (action === "remove-unit" && army) army.units.splice(index, 1);
    else if (action === "add-cell-pick" && army) army.CellBlessingPicks.push({
      RootId: namedRef(capabilities.ids.blessings[0] ?? "blessing"), Lane: "FrontRow", Cells: [], Locked: false, BaneCells: []
    });
    else if (action === "remove-cell-pick" && army) army.CellBlessingPicks.splice(index, 1);
    else if (action === "add-dialogue-node" && dialogue) dialogue.nodes.push({
      id: "node-" + (dialogue.nodes.length + 1), headline: localized("Node"), textSpeed: 30, speakers: [], segments: [], actions: []
    });
    else if (action === "remove-dialogue-node" && dialogue) dialogue.nodes.splice(index, 1);
    else if (action === "add-speaker" && dialogueNode) dialogueNode.speakers.push({
      id: "speaker-" + (dialogueNode.speakers.length + 1), unitId: namedRef(capabilities.ids.units[0] ?? "unit"),
      displayName: localized("Speaker"), side: "right", mood: "Normal"
    });
    else if (action === "remove-speaker" && dialogueNode) dialogueNode.speakers.splice(index, 1);
    else if (action === "add-segment" && dialogueNode) dialogueNode.segments.push({
      speakerIds: dialogueNode.speakers.map(speaker => speaker.id), text: localized("Text")
    });
    else if (action === "remove-segment" && dialogueNode) dialogueNode.segments.splice(index, 1);
    else if (action === "add-dialogue-action" && dialogueNode) dialogueNode.actions.push({
      label: localized("Continue"), targetNodeId: dialogueNode.id,
      meowEdit: { decision: { id: "decision", label: localized("Decision"), outcomeId: "outcome", outcomeLabel: localized("Outcome") }, defaultContinue: true }
    });
    else if (action === "remove-dialogue-action" && dialogueNode) dialogueNode.actions.splice(index, 1);
    else return;
    state.validation = validateContentSet(state.draft, state.capabilities);
    persistLocal(state);
    renderSetView(container, state);
  }));
}

function wireRichActions(container: HTMLElement, state: AppState): void {
  const rich = state.rich;
  const capabilities = state.capabilities;
  const draft = state.draft;
  const campaign = draft.campaigns[rich.index];
  const quest = draft.quests[rich.index];
  const army = draft.armies[rich.index];
  const dialogue = draft.dialogues[rich.index];
  const floor = campaign?.floors[rich.floorIndex];
  const dialogueNode = dialogue?.nodes[rich.nodeIndex];

  container.querySelectorAll<HTMLSelectElement>("[data-rich-select]").forEach(select => select.addEventListener("change", () => {
    if (select.dataset.richSelect === "ability") rich.selectedAbility = select.value;
    else if (select.dataset.richSelect === "node-kind") rich.selectedNodeKind = select.value;
    else rich.selectedUnit = select.value;
  }));
  container.querySelectorAll<HTMLElement>("[data-rich-action]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.richAction!;
    const index = Number(button.dataset.index ?? 0);
    const x = Number(button.dataset.x ?? 0);
    const y = Number(button.dataset.y ?? 0);

    if (action === "preview-reset") rich.nodeIndex = 0;
    else if (action === "preview-choice") {
      const target = dialogue?.nodes.findIndex(item => item.id === button.dataset.target) ?? -1;
      if (target >= 0) rich.nodeIndex = target;
      else return;
    }
    else if (action === "prev-step") rich.step = Math.max(0, rich.step - 1);
    else if (action === "next-step") rich.step = Math.min(7, rich.step + 1);
    else if (action === "select-node") rich.nodeIndex = index;
    else if (action === "select-floor") rich.floorIndex = index;
    else if (action === "add-dialogue-node" && dialogue) dialogue.nodes.push({
      id: "node-" + (dialogue.nodes.length + 1), headline: localized("New node"), textSpeed: 30,
      speakers: [], segments: [], actions: []
    });
    else if (action === "add-speaker" && dialogueNode) dialogueNode.speakers.push({
      id: "speaker-" + (dialogueNode.speakers.length + 1),
      unitId: namedRef(rich.selectedUnit || capabilities.ids.units[0] || "unit"),
      displayName: localized("Speaker"), side: "right", mood: "Normal"
    });
    else if (action === "remove-speaker" && dialogueNode) dialogueNode.speakers.splice(index, 1);
    else if (action === "add-segment" && dialogueNode) dialogueNode.segments.push({
      speakerIds: dialogueNode.speakers.map(speaker => speaker.id), text: localized("New line")
    });
    else if (action === "remove-segment" && dialogueNode) dialogueNode.segments.splice(index, 1);
    else if (action === "add-dialogue-action" && dialogueNode) dialogueNode.actions.push({
      label: localized("Continue"), targetNodeId: dialogueNode.id,
      meowEdit: { decision: { id: "decision", label: localized("Decision"), outcomeId: "outcome", outcomeLabel: localized("Outcome") }, defaultContinue: true }
    });
    else if (action === "remove-dialogue-action" && dialogueNode) dialogueNode.actions.splice(index, 1);
    else if (action === "add-army-unit" && army) army.units.push({
      unitId: namedRef(rich.selectedUnit || capabilities.ids.units[0] || "unit"), x: 0, y: 0, spellIds: []
    });
    else if (action === "remove-army-unit" && army) army.units.splice(index, 1);
    else if (action === "toggle-cell" && army) {
      const existing = army.units.findIndex(unit => unit.x === x && unit.y === y);
      if (existing >= 0) army.units.splice(existing, 1);
      else army.units.push({
        unitId: namedRef(rich.selectedUnit || capabilities.ids.units[0] || "unit"),
        x, y, spellIds: []
      });
    }
    else if (action === "add-spell" && army) army.spellIds.push(namedRef(rich.selectedAbility || (capabilities.ids.spells[0] ?? "spell")));
    else if (action === "remove-spell" && army) army.spellIds.splice(index, 1);
    else if (action === "add-blessing" && army) army.blessingIds.push(namedRef(rich.selectedAbility || (capabilities.ids.blessings[0] ?? "blessing")));
    else if (action === "remove-blessing" && army) army.blessingIds.splice(index, 1);
    else if (action === "add-floor" && campaign) campaign.floors.push({
      id: "floor-" + (campaign.floors.length + 1), number: campaign.floors.length + 1,
      mode: capabilities.enums.floorMode[0], questPoolMode: "campaign", questPoolIds: [],
      shopPoolMode: "campaign", shopPoolKinds: [capabilities.enums.shopPoolKind[0]], shopLevel: 1,
      randomSettings: { nodeCount: 12, questNodeCount: 2, shopNodeCount: 3 }, nodes: [], routes: []
    });
    else if (action === "remove-floor" && campaign && campaign.floors.length > 1) {
      campaign.floors.splice(rich.floorIndex, 1);
      rich.floorIndex = 0;
    }
    else if (action === "toggle-node" && floor) {
      const existing = floor.nodes.findIndex(node => node.x === x && node.y === y);
      const target = existing >= 0 ? floor.nodes[existing] : undefined;
      if (rich.connectFrom && target && rich.connectFrom !== target.id) {
        if (!floor.routes.some(route =>
          (route.fromNodeId === rich.connectFrom && route.toNodeId === target.id)
          || (route.fromNodeId === target.id && route.toNodeId === rich.connectFrom))) {
          floor.routes.push({
            id: "route-" + (floor.routes.length + 1),
            fromNodeId: rich.connectFrom, toNodeId: target.id, oneWay: false
          });
        }
        rich.connectFrom = undefined;
      } else if (target) {
        rich.nodeIndex = existing;
        rich.step = 3;
      } else {
        floor.nodes.push({
          id: "node-" + (floor.nodes.length + 1), label: localized("Node"),
          kind: rich.selectedNodeKind || (capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0]), x, y,
          armyId: namedRef("army"), questId: namedRef("quest"),
          enemyFactionId: namedRef(capabilities.ids.factions[0] ?? "faction"),
          rewardKind: capabilities.enums.rewardKind[0], rewardAmount: 0,
          rewardContentId: namedRef("reward"), shopOfferMode: "generated", shopOffers: []
        });
        rich.nodeIndex = floor.nodes.length - 1;
      }
    }
    else if (action === "connect-node") { rich.connectFrom = floor?.nodes[index]?.id; rich.step = 2; }
    else if (action === "toggle-route-direction" && floor) {
      const route = floor.routes[index];
      if (route) route.oneWay = !route.oneWay;
    }
    else if (action === "toggle-quest" && campaign && button.dataset.id) {
      const existing = campaign.questIds.findIndex(item => item.id === button.dataset.id);
      if (existing >= 0) campaign.questIds.splice(existing, 1);
      else campaign.questIds.push(namedRef(button.dataset.id));
    }
    else if (action === "remove-node" && floor) floor.nodes.splice(index, 1);
    else if (action === "remove-offer" && floor) {
      const shopNode = floor.nodes[Number(button.dataset.node ?? 0)];
      if (shopNode) shopNode.shopOffers.splice(index, 1);
    }
    else if (action === "add-offer" && floor) {
      const node = floor.nodes[index];
      if (node && node.shopOffers.length < 3) node.shopOffers.push({
        kind: capabilities.enums.shopOfferKind[0], contentId: namedRef(capabilities.ids.units[0] ?? "unit"), price: 0
      });
    }
    else if (action === "add-route" && floor) floor.routes.push({
      id: "route-" + (floor.routes.length + 1),
      fromNodeId: floor.nodes[0]?.id ?? "", toNodeId: floor.nodes.at(-1)?.id ?? "", oneWay: false
    });
    else if (action === "remove-route" && floor) floor.routes.splice(index, 1);
    else if (action === "add-event" && campaign) campaign.events.push({
      id: "event-" + (campaign.events.length + 1), trigger: TRIGGERS[0], conditions: [],
      actions: [{ kind: ACTIONS[0].kind, parameters: ACTIONS[0].parameters.map(parameter => ({
        key: parameter.key, value: parameter.type === "int" ? 1 : ""
      })) }], oneShot: "per-run"
    });
    else if (action === "remove-event" && campaign) campaign.events.splice(index, 1);
    else if (action === "add-fetch-item" && quest) quest.meowEdit.fetchItems.push({
      id: "item-" + (quest.meowEdit.fetchItems.length + 1), displayName: localized("Item"), count: 1
    });
    else if (action === "remove-fetch-item" && quest) quest.meowEdit.fetchItems.splice(index, 1);
    else if (action === "add-battle-target" && quest) quest.meowEdit.battleTargets.push({
      id: "target-" + (quest.meowEdit.battleTargets.length + 1), label: localized("Target"),
      nodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0], floorOffset: 0,
      armyId: namedRef(capabilities.ids.units[0] ?? "army")
    });
    else if (action === "remove-battle-target" && quest) quest.meowEdit.battleTargets.splice(index, 1);
    else if (action === "add-distance" && quest) quest.meowEdit.minimumNodeDistances.push({
      id: "distance-" + (quest.meowEdit.minimumNodeDistances.length + 1),
      fromNodeKind: capabilities.enums.nodeKind[0], toNodeKind: capabilities.enums.nodeKind[1] ?? capabilities.enums.nodeKind[0], minimumHops: 1
    });
    else if (action === "remove-distance" && quest) quest.meowEdit.minimumNodeDistances.splice(index, 1);
    else if (action === "add-effect" && quest) quest.meowEdit.completionEffects.push({
      kind: "unlock-path", targetId: namedRef("target"), label: localized("Effect")
    });
    else if (action === "remove-effect" && quest) quest.meowEdit.completionEffects.splice(index, 1);
    else return;
    state.validation = validateContentSet(draft, capabilities);
    persistLocal(state);
    renderSetView(container, state);
  }));
}

function applyChange(state: AppState, event: Event): void {
  const element = event.target as HTMLInputElement | HTMLSelectElement;
  const bind = element.dataset.v2Bind;
  const list = element.dataset.v2List;
  const refValue = element.dataset.v2Ref;
  const bool = element.dataset.v2Bool;
  const cells = element.dataset.v2Cells;
  const baneCells = element.dataset.v2BaneCells;
  const path = bind ?? list ?? refValue ?? bool ?? cells ?? baneCells;
  if (!path) return;
  let value: unknown = element.value;
  if (element instanceof HTMLInputElement && element.type === "number") value = Number(element.value);
  if (list) value = element.value.split(",").map(item => item.trim()).filter(Boolean).map(id => namedRef(id));
  if (refValue) value = namedRef(element.value);
  if (bool && element instanceof HTMLInputElement) value = element.checked;
  if (cells || baneCells) value = element.value.split(";").map(item => item.trim()).filter(Boolean).map(item => {
    const [x, y] = item.split(",").map(Number);
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  });
  if (path === "draftTitle") state.draftTitle = element.value;
  else if (path === "draftSecondary") state.draftSecondary = element.value;
  else setByPath(state.draft, path, value);
  if (path === "campaigns[0].id" && state.draft.campaigns[0]) state.draft.set.campaignOrder = [state.draft.campaigns[0].id];
  state.validation = validateContentSet(state.draft, state.capabilities);
  persistLocal(state);
}

function emptyEvent(): CampaignEvent {
  return {
    id: "event-" + Math.random().toString(36).slice(2, 8), trigger: TRIGGERS[0], conditions: [],
    actions: [{ kind: ACTIONS[0].kind, parameters: ACTIONS[0].parameters.map(parameter => ({
      key: parameter.key,
      value: parameter.type === "int" ? 1 : parameter.type === "NamedRef[]" ? []
        : parameter.type === "enum" ? parameter.values?.[0] ?? "" : ""
    })) }],
    oneShot: "per-run"
  };
}

function setByPath(root: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cursor = root as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (cursor[part] === undefined)
      cursor[part] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function flashStatus(container: HTMLElement, state: AppState): void {
  const element = container.querySelector<HTMLElement>("[data-status]");
  if (element) element.textContent = state.status;
}

function refreshBadge(container: HTMLElement, state: AppState): void {
  const badge = container.querySelector<HTMLElement>(".set-badge");
  if (!badge) return;
  badge.outerHTML = state.publishedPackageId
    ? '<span class="set-badge published">Published</span>'
    : state.draftVersion > 0
      ? '<span class="set-badge draft">Draft v' + state.draftVersion + "</span>"
      : '<span class="set-badge local">Local only</span>';
}

async function saveDraft(container: HTMLElement, state: AppState): Promise<void> {
  if (!state.validation.valid) {
    state.status = "Fix the validation issues before uploading.";
    flashStatus(container, state);
    return;
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
      flashStatus(container, state);
      return;
    }
    state.draftVersion = result.draftVersion;
    state.status = "Saved as private draft v" + result.draftVersion + ".";
    persistLocal(state);
    refreshBadge(container, state);
    await refreshSets(state);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Upload failed.";
  }
  flashStatus(container, state);
}

async function publishDraft(container: HTMLElement, state: AppState): Promise<void> {
  if (!canPublish() || !state.validation.valid) return;
  const confirmed = window.confirm(
    "Publishing resets tester progress. Saves with a different content hash will be deleted at the Adventure gate. Continue?"
  );
  if (!confirmed) {
    state.status = "Publish cancelled.";
    flashStatus(container, state);
    return;
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
    persistLocal(state);
    refreshBadge(container, state);
    await refreshSets(state);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Publish failed.";
  }
  flashStatus(container, state);
}

async function refreshSets(state: AppState): Promise<void> {
  try {
    const result = await requestJson<{ sets: SetSummary[] }>("/v1/editor/campaign-sets");
    state.sets = result.sets;
  } catch {
    // Keep the last known list; local drafts remain visible.
  }
}

/** Mounts the v2-only editor into the app root after authentication. */
export async function mountApp(container: HTMLElement): Promise<void> {
  const [capabilities, catalog] = await Promise.all([loadCapabilities(), loadArmyCatalog()]);
  const session = loadSession();
  const state: AppState = {
    capabilities, catalog, sets: [], view: "browser", focus: "campaigns", entry: null,
    rich: session.rich ?? { section: "campaigns", index: 0, step: 0, nodeIndex: 0, floorIndex: 0 },
    rawFields: session.rawFields,
    adding: false, addName: "", addId: "",
    setId: "", draft: emptyContentSet("", ""),
    draftVersion: 0, step: session.step, contentKind: null, draftTitle: "", draftSecondary: "",
    status: "", validation: { valid: false, issues: [] },
    help: session.help, savedAt: session.savedAt
  };
  state.focus = (["campaigns", "quests", "armies", "dialogues"] as const).includes(session.focus as DetailSection)
    ? session.focus as DetailSection : "campaigns";
  await refreshSets(state);
  renderBrowser(container, state);
  if (session.setId && state.sets.some(item => item.setId === session.setId))
    await openSet(container, state, session.setId);
}
