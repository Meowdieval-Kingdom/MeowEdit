import "./app.css";
import {
  canDeleteSets, canPublish, getBridgeActions, getBridgeFetch, getBridgeUserId
} from "../bridge-context";
import {
  createSetRequest, isDraftConflict, publishRequest, saveDraftRequest
} from "./endpoints";
import { mountV2Editor } from "./editor";
import { emptyContentSet, localized, namedRef } from "./factory";
import { escapeHtml } from "./html";
import { packContentSet } from "./packer";
import { ACTIONS, TRIGGERS } from "./registries";
import type { ContentSetV2Document, GameCapabilities } from "./types";
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

interface PublishedExample {
  setId: string;
  packageId: string;
  contentHash: string;
  publishedAt?: string;
}

interface AppState {
  capabilities: GameCapabilities;
  sets: SetSummary[];
  examples: PublishedExample[];
  view: "browser" | "editor" | "advanced";
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
}

const STEP_TITLES = ["Set details", "Campaign", "Board character", "Content", "Review & publish"];
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
  } catch {
    state.status = "Local storage is full; the draft could not be cached.";
  }
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

  const exampleRows = state.examples.length ? state.examples.map(example =>
    '<div class="set-row"><div class="set-row-main"><strong>' + escapeHtml(example.setId) + "</strong>" +
    "<small>" + escapeHtml(example.packageId) + " · " + escapeHtml(example.publishedAt ?? "") + "</small></div>" +
    '<span class="set-badge published">Live</span>' +
    '<button type="button" class="button button-outline" data-view-example="' + escapeHtml(example.packageId) + '">View</button></div>'
  ).join("") : '<div class="set-empty">No published content is available yet.</div>';

  container.innerHTML = '<main class="editor-shell"><div class="topbar"><div class="topbar-context">' +
    '<span class="brand-mark">M</span><strong>MeowEdit</strong><span class="context-divider">/</span>' +
    '<span class="context-crumb">CONTENT SETS</span></div><div class="topbar-actions">' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main"><div class="editor-heading"><div><h1>Your content sets</h1>' +
    "<p>Create, rename, open and publish sets. Drafts stay private until you publish.</p></div>" +
    '<button type="button" class="button button-primary" data-new-set>+ New set</button></div>' +
    '<div class="set-list">' + rows + "</div>" +
    '<div class="editor-heading"><div><h2>Live examples</h2>' +
    "<p>Published sets from the game backend, ready to inspect.</p></div></div>" +
    '<div class="set-list">' + exampleRows + "</div>" +
    '<p class="guided-status" data-status>' + escapeHtml(state.status) + "</p></div></main>";

  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
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
    state.view = "editor";
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
  container.querySelectorAll<HTMLElement>("[data-view-example]").forEach(button => button.addEventListener("click", () => {
    void viewExample(container, state, button.dataset.viewExample!);
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

async function viewExample(container: HTMLElement, state: AppState, packageId: string): Promise<void> {
  try {
    const detail = await requestJson<{ files: Array<{ path: string; content: string }> }>(
      "/v1/content/campaigns/" + encodeURIComponent(packageId));
    const campaignsFile = detail.files.find(file => file.path === "campaigns/Campaigns.json");
    const campaigns = campaignsFile ? JSON.parse(campaignsFile.content) as { campaigns: Array<{ name?: { default?: string }; id: string }> } : null;
    const names = campaigns?.campaigns.map(item => item.name?.default || item.id).join(", ") || "No campaigns in this revision";
    window.alert("Published set " + packageId + "\nCampaigns: " + names);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "The published example could not be loaded.";
    flashStatus(container, state);
  }
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
  state.step = version > 0 ? 2 : 0;
  state.contentKind = null;
  state.view = "editor";
  state.validation = validateContentSet(state.draft, state.capabilities);
  renderEditor(container, state);
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
      : '<div class="validation-list"><ul>' + state.validation.issues.map(issue =>
        "<li>" + escapeHtml(issue.path + ": " + issue.message) + "</li>").join("") + "</ul></div>");
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
    '<button type="button" class="text-button" data-advanced>Detailed editor</button>' +
    '<button type="button" class="text-button" data-back-browser>Sets</button>' +
    '<button type="button" class="text-button" data-sign-out>Sign out</button></div></div>' +
    '<div class="editor-main"><div class="editor-heading"><div><h1>' + escapeHtml(STEP_TITLES[step]) + "</h1>" +
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
    state.view = "advanced";
    renderAdvanced(container, state);
  });
  container.querySelector<HTMLElement>("[data-back-browser]")?.addEventListener("click", () => {
    state.view = "browser";
    renderBrowser(container, state);
  });
  container.querySelector<HTMLElement>("[data-sign-out]")?.addEventListener("click", () => getBridgeActions()?.signOut());
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
  container.onchange = event => {
    const element = event.target as HTMLInputElement | HTMLSelectElement;
    const bind = element.dataset.v2Bind;
    if (!bind) return;
    if (bind === "draftTitle") state.draftTitle = element.value;
    else if (bind === "draftSecondary") state.draftSecondary = element.value;
    else setByPath(state.draft, bind, element.value);
    if (bind === "campaigns[0].id" && state.draft.campaigns[0]) {
      state.draft.set.campaignOrder = [state.draft.campaigns[0].id];
    }
    state.validation = validateContentSet(state.draft, state.capabilities);
    persistLocal(state);
    flashStatus(container, state);
  };
}

function renderAdvanced(container: HTMLElement, state: AppState): void {
  container.innerHTML = '<main class="editor-shell"><div id="advanced-host"></div></main>';
  const host = container.querySelector<HTMLElement>("#advanced-host")!;
  void mountV2Editor(host,
    () => {
      state.view = "editor";
      state.validation = validateContentSet(state.draft, state.capabilities);
      renderEditor(container, state);
    },
    {
      draft: state.draft,
      draftVersion: state.draftVersion,
      publishedPackageId: state.publishedPackageId,
      capabilities: state.capabilities
    },
    draftVersion => {
      state.draftVersion = draftVersion;
      persistLocal(state);
      void refreshSets(state);
    },
    packageId => {
      state.publishedPackageId = packageId;
      persistLocal(state);
      void refreshSets(state);
    });
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
  const capabilities = await loadCapabilities();
  const state: AppState = {
    capabilities, sets: [], examples: [], view: "browser", setId: "", draft: emptyContentSet("", ""),
    draftVersion: 0, step: 0, contentKind: null, draftTitle: "", draftSecondary: "",
    status: "", validation: { valid: false, issues: [] }
  };
  await refreshSets(state);
  try {
    const published = await requestJson<{ sets: PublishedExample[] }>("/v1/content/campaigns");
    state.examples = published.sets;
  } catch {
    state.examples = [];
  }
  renderBrowser(container, state);
}
