import "../styles.css";
import "./integration.css";
import type Drawflow from "drawflow";
import {
  createKey,
  dialogueActionsForNode,
  dialogueMomentName,
  DEFAULT_QUEST,
  emptyQuestExtension,
  slugify,
  type ArmyCatalog,
  type ArmyRecord,
  type CampaignRecord,
  type CampaignFloor,
  type AdventureNodeKind as CampaignNodeKind,
  type CampaignFloorMode,
  type CompletionEffect,
  type DialogueNode,
  type DialogueRecord,
  type FaceMood,
  type QuestRecord,
  type UnitRoster
} from "./model";
import { createSeedWorkspace } from "./seed";
import { validateWorkspace } from "./validation";
import { compactDialogueGraph, mountDialogueGraph } from "./dialogue-graph";
import { addArmyUnit as addArmyUnitToArmy, addArmyUnitSpell, moveArmyUnit, replaceArmyUnit, removeArmyUnitSpell, type ArmyPlacementMove } from "./army-domain";
import { armyFootprint, armyFootprintsOverlap, armyGridSize, canPlaceArmyLevel, firstAvailableArmyCell, resolveArmyLevel, type ArmyCatalogKind } from "./army-catalog";
import { addCampaignNode, connectCampaignNodes, createCampaignFloor, moveCampaignNode, removeCampaignFloor, removeCampaignNode } from "./campaign-domain";
import { EditorNavigationHistory, type RelatedEditorReturnContext } from "./editor-navigation";
import { defaultEditorSession, loadEditorSession, saveEditorSession } from "./editor-session";
import { includeArmyUnitsInRoster } from "./roster";
import { getBridgeActions } from "../bridge-context";
import type { ContentSetDocument, GameCapabilities } from "../content/types";
import { workspaceToDraft } from "./convert";
import { loadScratchWorkspace, loadWorkspace, markWorkspaceDirty, saveScratchWorkspace, saveWorkspace as persistWorkspace } from "./workspace-store";
import {
  activeDialogueJson, activeArmyJson, activeCampaignJson, activeQuestJson,
  decodeZipText, parseImportedJson, suggestedFilename, workspacePackage
} from "./export";
import { readStoredZip } from "./zip";
import { normalizeArmy, normalizeCampaign, normalizeQuest } from "./import-normalizers";
import { escapeHtml, renderApp, renderLivePreview, renderValidationSummary, renderArmyEntityPreview, renderArmyAbilityPreview, setScratchMode, type ArmyAbilityFilters, type ArmyAbilityKind, type ArmyAbilitySelections, type EditorMode } from "./view";

const initialEditorSession = (() => {
  try { return loadEditorSession(localStorage); }
  catch { return defaultEditorSession(); }
})();
const ROSTER_FALLBACK: UnitRoster = {
  schemaVersion: 1,
  rosterVersion: "fallback",
  source: "Roster file could not be loaded.",
  units: []
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("MeowEdit app root is missing.");

export interface LegacyMountOptions {
  /** Undefined for the unassigned scratch workspace. */
  setId?: string;
  draft?: ContentSetDocument;
  capabilities: GameCapabilities;
  selected?: { section: string; index: number };
  onSave(): Promise<string>;
  onDraftChange(): void;
  onBack(): void;
  onPublish?(): Promise<string>;
  canPublishEditor?(): boolean;
  onAssign?(): void;
  onRecordChange?(section: string, key: string, label: string): void;
}

let mountOptions: LegacyMountOptions | null = null;
let mountGeneration = 0;
const isScratch = () => !mountOptions?.setId;

/**
 * Repairs stale catalog IDs (for example an old "Cats/Fighter/1" reference)
 * by matching unit name and level in the current game catalog.
 */
export function reconcileCatalogIds(workspaceToRepair: typeof workspace, catalog: ArmyCatalog): number {
  const levels = [...catalog.units, ...catalog.buildings].flatMap(entity =>
    entity.levels.map(level => ({ id: level.id, faction: entity.factionId, name: level.name || entity.name })));
  const known = new Set(levels.map(level => level.id));
  const resolve = (id: string): string => {
    if (!id || known.has(id)) return id;
    const parts = id.split("/");
    if (parts.length !== 3) return id;
    const [, name, level] = parts;
    const candidates = levels.filter(item => {
      const itemParts = item.id.split("/");
      return itemParts[1] === name && itemParts[2] === level;
    });
    if (!candidates.length) return id;
    return (candidates.find(item => item.faction === parts[0]) ?? candidates[0]).id;
  };
  let changed = 0;
  const repair = (value: string): string => {
    const next = resolve(value);
    if (next !== value) changed += 1;
    return next;
  };
  for (const army of workspaceToRepair.armies)
    for (const unit of army.units) unit.unitId = repair(unit.unitId);
  for (const campaign of workspaceToRepair.campaigns)
    campaign.boardPreviewUnitId = repair(campaign.boardPreviewUnitId ?? "");
  return changed;
}

/** Mounts the restored v1 editor on its native, per-set workspace. */
export function mountLegacyEditor(options: LegacyMountOptions): void {
  const generation = ++mountGeneration;
  mountOptions = options;
  workspace = options.setId && options.draft
    ? loadWorkspace(options.setId, options.draft, options.capabilities, options.selected)
    : loadScratchWorkspace();
  void Promise.all([loadRoster(), loadArmyCatalog()]).then(([loadedRoster, loadedCatalog]) => {
    if (generation !== mountGeneration) return;
    armyCatalog = loadedCatalog;
    roster = includeArmyUnitsInRoster(loadedRoster, loadedCatalog);
    const repaired = reconcileCatalogIds(workspace, loadedCatalog);
    if (repaired > 0) {
      if (options.setId) persistWorkspace(options.setId, workspace); else saveScratchWorkspace(workspace);
      showToast("Updated " + repaired + " outdated catalog reference" + (repaired === 1 ? "" : "s") + ".");
    }
    reportRecord();
    render();
  });
}

function reportRecord(): void {
  if (!mountOptions?.onRecordChange || !workspace.selectedType || !workspace.selectedKey) return;
  const singular = workspace.selectedType;
  const section = ({ dialogue: "dialogues", quest: "quests", army: "armies", campaign: "campaigns" } as const)[singular];
  const key = workspace.selectedKey;
  const collection = workspace[section] as unknown as Array<Record<string, unknown>>;
  const item = collection.find(record => record.key === key);
  if (!item) return;
  const label = singular === "dialogue"
    ? String((item.sequence as { nodes?: Array<{ headline?: string }>; sequenceId?: string } | undefined)?.nodes?.[0]?.headline
      ?? (item.sequence as { sequenceId?: string } | undefined)?.sequenceId ?? key)
    : singular === "quest"
      ? String((item.definition as { title?: string } | undefined)?.title ?? key)
      : String((item.name as string | undefined) ?? key);
  mountOptions.onRecordChange(section, key, label);
}

let workspace = createSeedWorkspace();
let roster = ROSTER_FALLBACK;
let armyCatalog: ArmyCatalog = {
  schemaVersion: 1,
  gridSizes: [{ minFloor: 1, width: 3, height: 3 }, { minFloor: 3, width: 4, height: 4 }, { minFloor: 5, width: 5, height: 5 }],
  units: [], buildings: [], factions: [], spells: [], blessings: [], curses: []
};
let activeEditorStep = initialEditorSession.activeEditorStep;
let editorMode: EditorMode = initialEditorSession.editorMode;
let helpVisible = initialEditorSession.helpVisible;
let sidebarCollapsed = initialEditorSession.sidebarCollapsed;
let guidedFocusAfterPath: string | null = null;
let guidedFocusExactPath: string | null = null;
let renderVersion = 0;
let activeDialogueGraph: Drawflow | null = null;
let deleteCandidate: { type: "dialogue" | "quest" | "army" | "campaign"; key: string } | null = null;
let selectedArmyPlacementId: string | null = initialEditorSession.selectedArmyPlacementId;
let selectedArmyBattlefieldEffectId: string | null = null;
let selectedArmyCellRegion: "boon" | "bane" = "boon";
let armyAbilityFilters: ArmyAbilityFilters = { spells: "all", blessings: "all", curses: "all" };
let armyAbilityCategory: ArmyAbilityKind = "spells";
let armyAbilitySelections: ArmyAbilitySelections = { spells: "", blessings: "", curses: "" };
let armyCatalogKind: ArmyCatalogKind = initialEditorSession.armyCatalogKind;
let armyDragDraft: { placementId: string; startX: number; startY: number; pointerId: number; dragging: boolean } | null = null;
let suppressArmyClick = false;
let selectedCampaignFloorId: string | null = initialEditorSession.selectedCampaignFloorId;
let selectedCampaignNodeId: string | null = initialEditorSession.selectedCampaignNodeId;
let selectedCampaignEventId: string | null = null;
let campaignInteractionMode: "select" | "add" = "select";
let campaignNodeKindDraft: CampaignNodeKind = "Battle";
let campaignAddMenuOpen = false;
let pendingCampaignPlugFromId: string | null = null;
let selectedCampaignRouteId: string | null = null;
const relatedReturnContexts = new EditorNavigationHistory();
relatedReturnContexts.restore(initialEditorSession.relatedReturnContexts);
let toastTimer: number | undefined;

async function loadRoster(): Promise<UnitRoster> {
  try {
    const response = await fetch("./unit-roster.json", { cache: "no-cache" });
    if (!response.ok) return ROSTER_FALLBACK;
    const parsed = await response.json() as UnitRoster;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.units)) return ROSTER_FALLBACK;
    return parsed;
  } catch {
    return ROSTER_FALLBACK;
  }
}

async function loadArmyCatalog(): Promise<ArmyCatalog> {
  try {
    const response = await fetch("./army-catalog.json", { cache: "no-cache" });
    if (!response.ok) return armyCatalog;
    const parsed = await response.json() as ArmyCatalog;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.units) || !Array.isArray(parsed.spells) || !Array.isArray(parsed.blessings)) return armyCatalog;
    if (!Array.isArray(parsed.curses)) parsed.curses = [];
    return parsed;
  } catch {
    return armyCatalog;
  }
}

function saveWorkspace(): void {
  if (!mountOptions) return;
  if (mountOptions.setId) {
    persistWorkspace(mountOptions.setId, workspace);
    markWorkspaceDirty(mountOptions.setId);
  } else saveScratchWorkspace(workspace);
  persistEditorSession();
  const status = document.querySelector<HTMLElement>("#save-status");
  if (status) status.textContent = "All changes saved";
}

/** The only structured conversion: at the cloud boundary, never during editing. */
function syncDraft(): void {
  if (!mountOptions?.setId || !mountOptions.draft) return;
  workspaceToDraft(mountOptions.draft, workspace, mountOptions.capabilities);
  mountOptions.onDraftChange();
}

function persistEditorSession(): void {
  try {
    saveEditorSession(localStorage, {
      activeEditorStep,
      editorMode,
      helpVisible,
      sidebarCollapsed,
      selectedArmyPlacementId,
      armyCatalogKind,
      selectedCampaignFloorId,
      selectedCampaignNodeId,
      relatedReturnContexts: relatedReturnContexts.snapshot()
    }, mountOptions?.setId);
  } catch {
    // Workspace persistence already reports storage failures; losing only navigation state is safe.
  }
}

function render(): void {
  const campaign = currentCampaign();
  if (campaign) {
    if (!campaign.floors.some(item => item.id === selectedCampaignFloorId)) selectedCampaignFloorId = campaign.floors[0]?.id ?? null;
    const floor = currentCampaignFloor(campaign);
    if (selectedCampaignNodeId && !floor?.nodes.some(node => node.id === selectedCampaignNodeId)) selectedCampaignNodeId = null;
    if (selectedCampaignNodeId === null && floor?.nodes.length) selectedCampaignNodeId = floor.nodes[0].id;
  }
  if (selectedArmyPlacementId && !currentArmy()?.units.some(unit => unit.id === selectedArmyPlacementId)) selectedArmyPlacementId = null;
  if (selectedArmyBattlefieldEffectId && !currentArmy()?.blessingIds.some(id => id === selectedArmyBattlefieldEffectId)) selectedArmyBattlefieldEffectId = null;
  persistEditorSession();
  const focusAfterPath = guidedFocusAfterPath;
  const focusExactPath = guidedFocusExactPath;
  guidedFocusAfterPath = null;
  guidedFocusExactPath = null;
  const currentRenderVersion = ++renderVersion;
  (activeDialogueGraph as unknown as { clear?: () => void } | null)?.clear?.();
  activeDialogueGraph = null;
  const issues = validateWorkspace(workspace, armyCatalog);
  const returnContext = relatedReturnContexts.current();
  setScratchMode(isScratch());
  root!.innerHTML = renderApp(workspace, roster, armyCatalog, issues, activeEditorStep, editorMode, selectedArmyPlacementId, {
    selectedFloorId: selectedCampaignFloorId,
    selectedNodeId: selectedCampaignNodeId,
    interactionMode: campaignInteractionMode,
    nodeKind: campaignNodeKindDraft,
    addMenuOpen: campaignAddMenuOpen,
    pendingPlugFromId: pendingCampaignPlugFromId,
    selectedRouteId: selectedCampaignRouteId
  }, returnContext ? {
    parent: returnContext.parentType === "campaign" ? "Campaign" : "Quest",
    label: returnContext.returnLabel
  } : undefined, armyCatalogKind, helpVisible, { abilityId: selectedArmyBattlefieldEffectId, region: selectedArmyCellRegion }, armyAbilityFilters, armyAbilityCategory, armyAbilitySelections, selectedCampaignEventId,
    (mountOptions?.canPublishEditor?.() ?? true) && !isScratch());
  const appLayout = root!.querySelector<HTMLElement>(".app-layout");
  appLayout?.classList.toggle("is-sidebar-collapsed", sidebarCollapsed);
  appLayout?.classList.toggle("is-sidebar-open", root!.querySelector<HTMLElement>(".sidebar")?.classList.contains("is-open") ?? false);
  const sidebarToggle = root!.querySelector<HTMLButtonElement>(".sidebar-collapse-button");
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    sidebarToggle.setAttribute("aria-label", sidebarCollapsed ? "Show sidebar" : "Collapse sidebar");
    sidebarToggle.title = sidebarCollapsed ? "Show sidebar" : "Collapse sidebar";
    sidebarToggle.textContent = sidebarCollapsed ? "›" : "‹";
  }
  const graphHost = root!.querySelector<HTMLElement>("[data-dialogue-node-graph]");
  const dialogue = currentDialogue();
  activeDialogueGraph = graphHost && dialogue
    ? mountDialogueGraph(graphHost, dialogue, workspace.activeNodeId ?? dialogue.sequence.startNodeId, {
      onRouteChange: (_nodeId, _routeIndex, _targetNodeId, redraw) => {
        saveWorkspace();
        if (redraw) window.setTimeout(render, 0);
        else refreshDerivedView();
      },
      onNodeMoved: () => { if (currentRenderVersion === renderVersion) saveWorkspace(); }
    })
    : null;
  document.querySelector<HTMLDialogElement>("#confirm-dialog")?.addEventListener("close", handleDeleteDialogClose);
  document.querySelector<HTMLDialogElement>("#transfer-dialog")?.addEventListener("close", () => {
    const picker = document.querySelector<HTMLInputElement>("#transfer-file");
    if (picker) picker.value = "";
  });
  if (editorMode === "guided") {
    window.requestAnimationFrame(() => {
      if (currentRenderVersion !== renderVersion || editorMode !== "guided") return;
      focusGuidedEditor(focusAfterPath, focusExactPath);
    });
  }
}

function guidedFields(): HTMLElement[] {
  return Array.from(root!.querySelectorAll<HTMLElement>(
    ".guided-editor input:not([type=hidden]), .guided-editor select, .guided-editor textarea"
  )).filter(field => field.getClientRects().length > 0 && !field.closest("details:not([open])"));
}

function focusGuidedEditor(afterPath: string | null = null, exactPath: string | null = null): void {
  const fields = guidedFields();
  let target: HTMLElement | undefined;
  if (exactPath) target = fields.find(field => field.dataset.bind === exactPath);
  if (!target && afterPath) {
    const currentIndex = fields.findIndex(field => field.dataset.bind === afterPath);
    if (currentIndex >= 0) target = fields[currentIndex + 1];
    if (!target) target = root!.querySelector<HTMLElement>('[data-action="editor-next"]') ?? undefined;
  }
  if (!target) target = root!.querySelector<HTMLElement>("[data-guided-autofocus]") ?? fields[0];
  if (!target) target = root!.querySelector<HTMLElement>(
    '[data-action="editor-next"], .guided-step-screen [data-action], .guided-title-footer [data-action], .guided-end-actions [data-action]'
  ) ?? undefined;
  target?.focus({ preventScroll: true });
}

function focusNextGuidedField(current: HTMLElement): void {
  const fields = guidedFields();
  const currentIndex = fields.indexOf(current);
  const next = currentIndex >= 0 ? fields[currentIndex + 1] : undefined;
  if (next) {
    next.focus({ preventScroll: true });
    return;
  }
  root!.querySelector<HTMLButtonElement>('[data-action="editor-next"]')?.click();
}

function prepareGuidedFocusAfterChange(element: HTMLSelectElement): void {
  const path = element.dataset.bind ?? null;
  if (!path) return;
  const dialogueSpeakerPath = path.match(/^nodes\.(\d+)\.speakers\.(\d+)\.unitId$/);
  if (dialogueSpeakerPath) {
    guidedFocusExactPath = "nodes." + dialogueSpeakerPath[1] + ".speakers." + dialogueSpeakerPath[2] + ".displayName";
    return;
  }
  if (path === "definition.speakerUnitId") {
    guidedFocusExactPath = "definition.speakerName";
    return;
  }
  guidedFocusAfterPath = path;
}

function slugBase(value: string, fallback: string): string {
  return slugify(value) || fallback;
}

function uniqueId(value: string, existing: string[], fallback: string): string {
  const base = slugBase(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function currentDialogue(): DialogueRecord | null {
  return workspace.selectedType === "dialogue"
    ? workspace.dialogues.find(item => item.key === workspace.selectedKey) ?? null
    : null;
}

function currentQuest(): QuestRecord | null {
  return workspace.selectedType === "quest"
    ? workspace.quests.find(item => item.key === workspace.selectedKey) ?? null
    : null;
}

function currentArmy(): ArmyRecord | null {
  return workspace.selectedType === "army"
    ? workspace.armies.find(item => item.key === workspace.selectedKey) ?? null
    : null;
}

function currentCampaign(): CampaignRecord | null {
  return workspace.selectedType === "campaign"
    ? workspace.campaigns.find(item => item.key === workspace.selectedKey) ?? null
    : null;
}

function currentCampaignFloor(campaign = currentCampaign()): CampaignFloor | null {
  if (!campaign) return null;
  return campaign.floors.find(floor => floor.id === selectedCampaignFloorId) ?? campaign.floors[0] ?? null;
}

function setValue(target: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (next === null || typeof next !== "object") return;
    cursor = next as Record<string, unknown>;
  }
  const finalKey = parts[parts.length - 1];
  if (finalKey === "speakerIds" && typeof value === "string") {
    cursor[finalKey] = value ? value.split(",").filter(Boolean) : [];
    return;
  }
  cursor[finalKey] = value;
}

function selectedDocument(): object | null {
  return currentDialogue()?.sequence ?? currentQuest() ?? currentArmy() ?? currentCampaign() ?? null;
}

function fieldValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (element instanceof HTMLInputElement && element.type === "checkbox") return element.checked;
  if (element instanceof HTMLInputElement && element.type === "number") return element.value === "" ? 0 : Number(element.value);
  if (element instanceof HTMLSelectElement && element.dataset.optionalNumber === "true") return element.value === "" ? undefined : Number(element.value);
  if (element instanceof HTMLSelectElement && element.dataset.number === "true") return Number(element.value);
  return element.value;
}

function reconcileCampaignEventTarget(event: CampaignRecord["events"][number], campaign: CampaignRecord): void {
  if (event.trigger === "campaign-start") {
    delete event.floorNumber;
    delete event.nodeId;
    return;
  }
  if (!event.nodeId) { delete event.nodeId; return; }
  if (event.floorNumber === undefined) { delete event.nodeId; return; }
  const floor = campaign.floors.find(item => item.number === event.floorNumber);
  const node = floor?.nodes.find(item => item.id === event.nodeId);
  const isBattleTrigger = event.trigger === "before-battle" || event.trigger === "after-battle";
  if (!node || isBattleTrigger && node.kind !== "Battle" && node.kind !== "Boss" ||
      event.trigger === "node-cleared" && node.kind === "Start") delete event.nodeId;
}

function bindField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  const path = element.dataset.bind;
  const documentValue = selectedDocument();
  if (!path || !documentValue) return;
  const value = fieldValue(element);
  const dialogue = currentDialogue();
  const previousSequenceId = dialogue?.sequence.sequenceId;
  const automaticSequenceId = dialogue?.sequenceIdAuto && path === "nodes.0.editorLabel" && typeof value === "string"
    ? uniqueId(value, workspace.dialogues.filter(item => item.key !== dialogue.key).map(item => item.sequence.sequenceId), "new-dialogue")
    : undefined;
  const nodeIdMatch = path.match(/^nodes\.(\d+)\.id$/);
  const previousNodeId = nodeIdMatch && dialogue
    ? dialogue.sequence.nodes[Number(nodeIdMatch[1])]?.id
    : undefined;
  const unitPathMatch = path.match(/^nodes\.(\d+)\.speakers\.(\d+)\.unitId$/);
  const speakerBeforeUnitChange = dialogue && unitPathMatch
    ? dialogue.sequence.nodes[Number(unitPathMatch[1])]?.speakers[Number(unitPathMatch[2])]
    : undefined;
  const previousSpeakerUnitId = speakerBeforeUnitChange?.unitId;
  const previousSpeakerDisplayName = speakerBeforeUnitChange?.displayName ?? "";
  const previousRosterName = roster.units.find(unit => unit.id === previousSpeakerUnitId)?.displayName;
  const shouldFollowRosterName = !previousSpeakerDisplayName || previousSpeakerDisplayName === previousRosterName;
  setValue(documentValue, path, value);
  const shopOfferKindPath = path.match(/^floors\.(\d+)\.nodes\.(\d+)\.shopOffers\.(\d+)\.kind$/);
  const campaignDocument = currentCampaign();
  const eventTriggerPath = path.match(/^events\.(\d+)\.trigger$/);
  const eventFloorPath = path.match(/^events\.(\d+)\.floorNumber$/);
  const eventTargetIndex = eventTriggerPath ? Number(eventTriggerPath[1]) : eventFloorPath ? Number(eventFloorPath[1]) : -1;
  if (campaignDocument && eventTargetIndex >= 0) {
    const campaignEvent = campaignDocument.events[eventTargetIndex];
    if (campaignEvent) reconcileCampaignEventTarget(campaignEvent, campaignDocument);
  }
  const eventNodePath = path.match(/^events\.(\d+)\.nodeId$/);
  if (campaignDocument && eventNodePath) {
    const campaignEvent = campaignDocument.events[Number(eventNodePath[1])];
    if (campaignEvent) reconcileCampaignEventTarget(campaignEvent, campaignDocument);
  }
  if (shopOfferKindPath && campaignDocument) {
    const offer = campaignDocument.floors[Number(shopOfferKindPath[1])]?.nodes[Number(shopOfferKindPath[2])]?.shopOffers[Number(shopOfferKindPath[3])];
    if (offer) offer.contentId = "";
  }
  if (dialogue && path === "sequenceId") dialogue.sequenceIdAuto = false;
  if (dialogue && automaticSequenceId) dialogue.sequence.sequenceId = automaticSequenceId;
  if (dialogue && ((path === "sequenceId" && typeof value === "string") || automaticSequenceId)) {
    const nextSequenceId = automaticSequenceId || String(value);
    for (const quest of workspace.quests) {
      for (const link of Object.keys(quest.extension.dialogueLinks) as Array<keyof QuestRecord["extension"]["dialogueLinks"]>) {
        if (quest.extension.dialogueLinks[link] === previousSequenceId) {
          quest.extension.dialogueLinks[link] = nextSequenceId;
        }
      }
    }
  }
  if (dialogue && unitPathMatch) {
    const speaker = dialogue.sequence.nodes[Number(unitPathMatch[1])]?.speakers[Number(unitPathMatch[2])];
    if (speaker) {
      const selectedUnit = roster.units.find(unit => unit.id === String(value));
      if (selectedUnit && shouldFollowRosterName) speaker.displayName = selectedUnit.displayName;
      else if (!value && shouldFollowRosterName) speaker.displayName = "";
    }
  }
  if (dialogue && nodeIdMatch && previousNodeId && typeof value === "string" && value !== previousNodeId) {
    if (dialogue.sequence.startNodeId === previousNodeId) dialogue.sequence.startNodeId = value;
    if (workspace.activeNodeId === previousNodeId) workspace.activeNodeId = value;
    for (const node of dialogue.sequence.nodes) {
      if (node.continueTargetNodeId === previousNodeId) node.continueTargetNodeId = value;
      for (const action of node.actions) {
        if (action.targetNodeId === previousNodeId) action.targetNodeId = value;
      }
    }
  }
  const army = currentArmy();
  if (army && path === "name") {
    if (army.idAuto && typeof value === "string") {
      army.id = uniqueId(value, workspace.armies.filter(item => item.key !== army.key).map(item => item.id), "army");
    }
  }
  if (army && path === "id") army.idAuto = false;
  const campaign = currentCampaign();
  if (campaign && path === "name" && campaign.idAuto && typeof value === "string") {
    campaign.id = uniqueId(value, workspace.campaigns.filter(item => item.key !== campaign.key).map(item => item.id), "campaign");
  }
  if (campaign && path === "id") campaign.idAuto = false;
  const quest = currentQuest();
  if (quest && path === "definition.id") quest.idAuto = false;
  if (quest && quest.idAuto && path === "definition.title" && typeof value === "string") {
    quest.definition.id = uniqueId(value, workspace.quests.filter(item => item.key !== quest.key).map(item => item.definition.id), "new-adventure-quest");
  }
  if (quest && path === "definition.speakerUnitId") {
    const selectedUnit = roster.units.find(unit => unit.id === String(value));
    quest.definition.speakerName = selectedUnit?.displayName ?? (value ? quest.definition.speakerName : "");
  }
  const fetchItemPath = path.match(/^extension\.fetchItems\.(\d+)\.displayName$/);
  if (quest && fetchItemPath && typeof value === "string") {
    const fetchItem = quest.extension.fetchItems[Number(fetchItemPath[1])];
    if (fetchItem) {
      fetchItem.id = slugify(value);
      if (Number(fetchItemPath[1]) === 0) quest.definition.itemId = fetchItem.id;
    }
  }
  const battleTargetPath = path.match(/^extension\.battleTargets\.(\d+)\.(nodeKind|floorOffset)$/);
  if (quest && battleTargetPath && Number(battleTargetPath[1]) === 0) {
    if (battleTargetPath[2] === "nodeKind") quest.definition.targetNodeKind = String(value);
    else quest.definition.targetFloorOffset = Number(value);
  }
  if (quest && path === "definition.objectiveKind") {
    quest.extension.logicKind = value === "Timer" ? "timer-project" : "standard";
    if (value === "Battle" && quest.extension.battleTargets.length === 0) {
      quest.extension.battleTargets.push({ id: "battle-1", label: "Battle 1", nodeKind: quest.definition.targetNodeKind || "Battle", floorOffset: quest.definition.targetFloorOffset || 0, armyId: "" });
    }
    if (value === "KillCount" && !quest.extension.killCount) {
      quest.extension.killCount = { targetKind: "unit", targetId: "", count: 1 };
    }
  }
  if (quest && path === "extension.logicKind") {
    if (value === "timer-project") quest.definition.objectiveKind = "Timer";
    else if (quest.definition.objectiveKind === "Timer") quest.definition.objectiveKind = "Battle";
  }
  if (quest && path === "extension.killCount.targetKind" && quest.extension.killCount) quest.extension.killCount.targetId = "";
  saveWorkspace();
  refreshDerivedView();
}

function addDialogue(returnContext: RelatedEditorReturnContext | null = null): void {
  relatedReturnContexts.enter(returnContext);
  const id = uniqueId("new-dialogue", workspace.dialogues.map(item => item.sequence.sequenceId), "new-dialogue");
  const key = createKey("dialogue");
  const record: DialogueRecord = {
    key,
    sequenceIdAuto: true,
    sequence: {
      schemaVersion: 1,
      sequenceId: id,
      startNodeId: "opening",
      pauseMode: "pause",
      defaultCharactersPerSecond: 34,
      nodes: [{
        id: "opening",
        headline: "",
        textSpeed: "default",
        speakers: [],
        segments: [{ speakerIds: [], text: "" }],
        actions: []
      }]
    }
  };
  workspace.dialogues.push(record);
  workspace.selectedType = "dialogue";
  workspace.selectedKey = key;
  workspace.activeNodeId = "opening";
  activeEditorStep = 0;
  saveWorkspace();
  render();
}

function addQuest(returnContext: RelatedEditorReturnContext | null = null): void {
  relatedReturnContexts.enter(returnContext);
  const existing = workspace.quests.map(item => item.definition.id);
  const id = uniqueId("new-adventure-quest", existing, "new-adventure-quest");
  const key = createKey("quest");
  const record: QuestRecord = {
    key,
    idAuto: true,
    definition: { ...DEFAULT_QUEST, id, title: "New Adventure Quest" },
    extension: emptyQuestExtension()
  };
  record.extension.battleTargets.push({ id: "battle-1", label: "Battle 1", nodeKind: "Battle", floorOffset: 0, armyId: "" });
  workspace.quests.push(record);
  workspace.selectedType = "quest";
  workspace.selectedKey = key;
  workspace.activeNodeId = null;
  activeEditorStep = 0;
  saveWorkspace();
  render();
}

function addArmy(returnContext: RelatedEditorReturnContext | null = null): void {
  relatedReturnContexts.enter(returnContext);
  const key = createKey("army");
  const name = "Army " + (workspace.armies.length + 1);
  const id = uniqueId(name, workspace.armies.map(item => item.id), "army");
  workspace.armies.push({ key, id, idAuto: true, name, previewFloor: 1, units: [], spellIds: [], blessingIds: [] });
  workspace.selectedType = "army";
  workspace.selectedKey = key;
  workspace.activeNodeId = null;
  selectedArmyPlacementId = null;
  armyCatalogKind = "units";
  activeEditorStep = 0;
  saveWorkspace();
  render();
}

function newCampaignFloor(number: number, mode: CampaignFloorMode = "authored"): CampaignFloor {
  return createCampaignFloor(number, mode);
}

function addCampaignEvent(): void {
  const campaign = currentCampaign();
  if (!campaign) return;
  campaign.events ??= [];
  const eventNumber = campaign.events.length + 1;
  const event = {
    id: uniqueId("event-" + eventNumber, campaign.events.map(item => item.id), "campaign-event"),
    trigger: "campaign-start" as const,
    actions: [{ kind: "replace-player-army", armyId: "" }]
  };
  campaign.events.push(event);
  selectedCampaignEventId = event.id;
  saveWorkspace();
  render();
}

function addCampaign(): void {
  relatedReturnContexts.clear();
  selectedCampaignEventId = null;
  const name = "New Campaign";
  const id = uniqueId(name, workspace.campaigns.map(item => item.id), "campaign");
  const key = createKey("campaign");
  const campaign: CampaignRecord = {
    key, id, idAuto: true, name, description: "", boardPreviewUnitId: "", designMode: "choose", questIds: [], events: [],
    floors: [newCampaignFloor(1)],
    settings: {
      startingLives: 3, startingSardines: 10, startingNodeCount: 12, playerFactionId: "",
      factionSelectionEnabled: true, battleShopEnabled: true,
      sardinePayoutEnabled: true, sardinePayoutBase: 10, sardinePayoutPerFloor: 1,
      shopPoolKinds: ["Unit", "Blessing", "Research", "SpellUnlock"],
      questNodeCountPerRandomFloor: 2, shopNodeCountPerRandomFloor: 3, nodeGrowthPerFloor: 2,
      continueWithGeneratedFloors: false
    }
  };
  workspace.campaigns.push(campaign);
  workspace.selectedType = "campaign";
  workspace.selectedKey = key;
  workspace.activeNodeId = null;
  selectedCampaignFloorId = campaign.floors[0].id;
  selectedCampaignNodeId = campaign.floors[0].nodes[0]?.id ?? null;
  campaignInteractionMode = "select";
  campaignAddMenuOpen = false;
  pendingCampaignPlugFromId = null;
  selectedCampaignRouteId = null;
  activeEditorStep = 0;
  saveWorkspace();
  render();
}

function addCampaignFloor(): void {
  const campaign = currentCampaign();
  if (!campaign) return;
  const number = campaign.floors.reduce((max, floor) => Math.max(max, floor.number), 0) + 1;
  const floor = newCampaignFloor(number, campaign.designMode === "settings-only" ? "random" : "authored");
  if (campaign.designMode === "settings-only") floor.randomSettings.questNodeCount = 0;
  campaign.floors.push(floor);
  selectedCampaignFloorId = floor.id;
  selectedCampaignNodeId = floor.nodes[0]?.id ?? null;
  campaignAddMenuOpen = false;
  campaignInteractionMode = "select";
  pendingCampaignPlugFromId = null;
  selectedCampaignRouteId = null;
  activeEditorStep = 1;
  saveWorkspace();
  render();
}

function campaignRelatedContext(target: "army" | "quest-node" | "quest-pool", includeQuestInPool = false): RelatedEditorReturnContext | null {
  const campaign = currentCampaign();
  const floor = currentCampaignFloor(campaign);
  if (!campaign || !floor) return null;
  return {
    parentType: "campaign", parentKey: campaign.key, floorId: floor.id,
    nodeId: selectedCampaignNodeId, target, includeQuestInPool, parentStep: activeEditorStep,
    returnLabel: campaign.name || "Campaign"
  };
}

function campaignEventArmyContext(eventId: string): RelatedEditorReturnContext | null {
  const campaign = currentCampaign();
  const floor = currentCampaignFloor(campaign);
  if (!campaign || !floor || !campaign.events.some(item => item.id === eventId)) return null;
  return {
    parentType: "campaign", parentKey: campaign.key, floorId: floor.id,
    nodeId: selectedCampaignNodeId, target: "event-army", eventId, parentStep: activeEditorStep,
    returnLabel: campaign.name || "Campaign"
  };
}

function questRelatedContext(target: "army", battleTargetId: string): RelatedEditorReturnContext | null {
  const quest = currentQuest();
  return quest ? { parentType: "quest", parentKey: quest.key, target, battleTargetId, parentStep: activeEditorStep, returnLabel: quest.definition.title || "Quest" } : null;
}

function questDialogueContext(dialogueSlot: keyof QuestRecord["extension"]["dialogueLinks"]): RelatedEditorReturnContext | null {
  const quest = currentQuest();
  return quest ? { parentType: "quest", parentKey: quest.key, target: "dialogue", dialogueSlot, parentStep: activeEditorStep, returnLabel: quest.definition.title || "Quest" } : null;
}

function openRelatedRecord(type: "army" | "quest" | "dialogue", key: string, context: RelatedEditorReturnContext | null): void {
  const record = type === "army" ? workspace.armies.find(item => item.key === key)
    : type === "quest" ? workspace.quests.find(item => item.key === key)
      : workspace.dialogues.find(item => item.key === key);
  if (!record) return;
  relatedReturnContexts.enter(context);
  workspace.selectedType = type;
  workspace.selectedKey = record.key;
  workspace.activeNodeId = type === "dialogue" ? (record as DialogueRecord).sequence.startNodeId : null;
  selectedArmyPlacementId = null;
  activeEditorStep = 0;
  saveWorkspace();
  render();
}

function returnToRelatedParent(): void {
  const context = relatedReturnContexts.current();
  if (!context) return;
  if (context.parentType === "campaign") {
    const campaign = workspace.campaigns.find(item => item.key === context.parentKey);
    if (!campaign) return;
    const floor = campaign.floors.find(item => item.id === context.floorId) ?? campaign.floors[0];
    const node = floor?.nodes.find(item => item.id === context.nodeId);
    if (context.target === "army") {
      const army = currentArmy();
      if (node && army) node.armyId = army.id;
    } else if (context.target === "event-army") {
      const army = currentArmy();
      const campaignEvent = campaign.events.find(item => item.id === context.eventId);
      const action = campaignEvent?.actions.find(item => item.kind === "replace-player-army");
      if (army && action) action.armyId = army.id;
    } else {
      const quest = currentQuest();
      const shouldIncludeQuest = context.target === "quest-node" || context.includeQuestInPool;
      if (quest && shouldIncludeQuest && !campaign.questIds.includes(quest.definition.id)) campaign.questIds.push(quest.definition.id);
      if (context.target === "quest-node" && node && quest) node.questId = quest.definition.id;
    }
    workspace.selectedType = "campaign";
    workspace.selectedKey = campaign.key;
    workspace.activeNodeId = null;
    selectedCampaignFloorId = floor?.id ?? null;
    selectedCampaignNodeId = node?.id ?? context.nodeId;
    selectedCampaignEventId = context.target === "event-army" ? context.eventId ?? null : null;
  } else {
    const quest = workspace.quests.find(item => item.key === context.parentKey);
    if (!quest) return;
    if (context.target === "army") {
      const army = currentArmy();
      const battle = quest.extension.battleTargets.find(item => item.id === context.battleTargetId);
      if (army && battle) battle.armyId = army.id;
    } else {
      const dialogue = currentDialogue();
      if (dialogue) quest.extension.dialogueLinks[context.dialogueSlot] = dialogue.sequence.sequenceId;
    }
    workspace.selectedType = "quest";
    workspace.selectedKey = quest.key;
    workspace.activeNodeId = null;
  }
  activeEditorStep = context.parentStep;
  selectedArmyPlacementId = null;
  relatedReturnContexts.returnToParent();
  saveWorkspace();
  render();
}

function addCampaignNodeAt(x: number, y: number): void {
  const campaign = currentCampaign();
  const floor = currentCampaignFloor(campaign);
  if (!campaign || !floor || floor.mode === "random" || floor.nodes.some(node => node.x === x && node.y === y)) return;
  if (Math.abs(x) > 30 || Math.abs(y) > 30) { showToast("Place nodes within 30 map steps of the Start.", "warning"); return; }
  const result = addCampaignNode(floor, campaignNodeKindDraft, x, y);
  if (!result.ok) { showToast(result.message, "warning"); return; }
  selectedCampaignNodeId = result.node.id;
  campaignInteractionMode = "select";
  campaignAddMenuOpen = false;
  selectedCampaignRouteId = null;
  if (editorMode === "guided") activeEditorStep = 3;
  saveWorkspace();
  render();
}

function handleCampaignCell(x: number, y: number): void {
  if (campaignInteractionMode === "add") { addCampaignNodeAt(x, y); return; }
}

function moveCampaignNodeTo(nodeId: string, x: number, y: number): void {
  const floor = currentCampaignFloor();
  if (!floor) return;
  const error = moveCampaignNode(floor, nodeId, x, y);
  if (error) { showToast(error, "warning"); return; }
  selectedCampaignNodeId = nodeId;
  campaignInteractionMode = "select";
  selectedCampaignRouteId = null;
  saveWorkspace(); render();
}

function selectCampaignNode(nodeId: string): void {
  const floor = currentCampaignFloor();
  const node = floor?.nodes.find(item => item.id === nodeId);
  if (!floor || !node) return;
  selectedCampaignNodeId = nodeId;
  selectedCampaignRouteId = null;
  campaignInteractionMode = "select";
  if (editorMode === "guided" && activeEditorStep === 2) activeEditorStep = 3;
  render();
}

function connectCampaignPlugs(fromNodeId: string, toNodeId: string): void {
  const floor = currentCampaignFloor();
  if (!floor || fromNodeId === toNodeId) return;
  const result = connectCampaignNodes(floor, fromNodeId, toNodeId, false);
  if (result === "not-neighbors") {
    showToast("Drop on a neighboring node. Diagonal connections are allowed.", "warning");
    return;
  }
  if (result === "exists") {
    showToast("These nodes are already connected.", "warning");
    return;
  }
  selectedCampaignNodeId = toNodeId;
  selectedCampaignRouteId = null;
  saveWorkspace();
  render();
  showToast("Nodes connected. Select the line to disconnect it or open a node for route options.");
}

function updateCampaignPlugDraft(clientX: number, clientY: number): void {
  if (!pendingCampaignPlugFromId) return;
  const canvas = root?.querySelector<HTMLElement>("[data-campaign-canvas]");
  const line = root?.querySelector<SVGLineElement>(".campaign-route-draft");
  const source = Array.from(root?.querySelectorAll<HTMLElement>('[data-campaign-port="output"]') ?? [])
    .find(port => port.dataset.nodeId === pendingCampaignPlugFromId);
  if (!canvas || !line || !source) return;
  const canvasRect = canvas.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  line.removeAttribute("hidden");
  line.setAttribute("x1", String(sourceRect.left + sourceRect.width / 2 - canvasRect.left));
  line.setAttribute("y1", String(sourceRect.top + sourceRect.height / 2 - canvasRect.top));
  line.setAttribute("x2", String(clientX - canvasRect.left));
  line.setAttribute("y2", String(clientY - canvasRect.top));
}

function clearCampaignPlugDraft(): void {
  root?.querySelector<SVGLineElement>(".campaign-route-draft")?.setAttribute("hidden", "");
  root?.querySelector<HTMLElement>(".campaign-node.is-route-source")?.classList.remove("is-route-source");
}

function armyCellAtPoint(clientX: number, clientY: number): { x: number; y: number } | undefined {
  const cells = root?.querySelectorAll<HTMLButtonElement>("[data-army-cell]");
  if (!cells) return undefined;
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    }
  }
  return undefined;
}

function canApplyArmyMoves(army: ArmyRecord, moves: readonly ArmyPlacementMove[], grid: { width: number; height: number }): boolean {
  const movingIds = new Set(moves.map(move => move.placement.id));
  const stationary = army.units.filter(unit => !movingIds.has(unit.id));
  const proposed = moves.map(move => ({ id: move.placement.id, unitId: move.placement.unitId, x: move.x, y: move.y }));
  for (const move of proposed) {
    if (!canPlaceArmyLevel(stationary, armyCatalog, move.unitId, move.x, move.y, grid)) return false;
  }
  for (let index = 0; index < proposed.length; index++) {
    for (let other = index + 1; other < proposed.length; other++) {
      if (armyFootprintsOverlap(armyCatalog, proposed[index], proposed[other])) return false;
    }
  }
  return true;
}

function armyPlacementAtCell(x: number, y: number, exceptId?: string): ArmyRecord["units"][number] | undefined {
  const army = currentArmy();
  return army?.units.find(unit => {
    if (unit.id === exceptId) return false;
    const footprint = armyFootprint(armyCatalog, unit.unitId);
    return x >= unit.x && x < unit.x + footprint.width && y >= unit.y && y < unit.y + footprint.height;
  });
}

function moveArmyPlacementTo(placementId: string, x: number, y: number): boolean {
  const army = currentArmy();
  const selected = army?.units.find(unit => unit.id === placementId);
  if (!army || !selected) return false;
  const grid = armyGridSize(armyCatalog, army.previewFloor, army.blessingIds);
  const occupant = armyPlacementAtCell(x, y, selected.id);
  const destination = occupant ? { x: occupant.x, y: occupant.y } : { x, y };
  const moved = moveArmyUnit(army, selected.id, destination.x, destination.y, moves => canApplyArmyMoves(army, moves, grid));
  if (!moved) {
    showToast("That space is occupied or too small for this footprint.", "warning");
    return false;
  }
  selectedArmyPlacementId = selected.id;
  saveWorkspace();
  render();
  return true;
}

function addArmyUnitAt(x: number, y: number, unitId: string): void {
  const army = currentArmy();
  if (!army || !unitId) return;
  const grid = armyGridSize(armyCatalog, army.previewFloor, army.blessingIds);
  if (selectedArmyPlacementId) {
    const selected = army.units.find(unit => unit.id === selectedArmyPlacementId);
    if (selected) {
      const moved = moveArmyUnit(army, selected.id, x, y, moves => canApplyArmyMoves(army, moves, grid));
      if (!moved) {
        showToast("That space is occupied or too small for this footprint.", "warning");
        return;
      }
      saveWorkspace();
      render();
      return;
    }
  }
  if (!canPlaceArmyLevel(army.units, armyCatalog, unitId, x, y, grid)) {
    showToast("That space is occupied or too small for this footprint.", "warning");
    return;
  }
  const id = createKey("army-unit");
  if (!addArmyUnitToArmy(army, { id, unitId, x, y, spellIds: [] }, () => true)) return;
  selectedArmyPlacementId = id;
  const resolved = resolveArmyLevel(armyCatalog, unitId);
  if (resolved) armyCatalogKind = resolved.kind;
  saveWorkspace();
  render();
}

function selectedArmyPickerLevelId(): string | null {
  const unitPicker = root!.querySelector<HTMLSelectElement>("#army-unit-picker");
  const levelPicker = root!.querySelector<HTMLSelectElement>("#army-level-picker");
  const entity = armyCatalog[armyCatalogKind].find(item => item.id === unitPicker?.value);
  return entity?.levels.find(level => level.level === Number(levelPicker?.value))?.id ?? null;
}

function addSelectedArmyUnit(): void {
  const army = currentArmy();
  const unitId = selectedArmyPickerLevelId();
  if (!army || !unitId) return;
  const grid = armyGridSize(armyCatalog, army.previewFloor, army.blessingIds);
  const cell = firstAvailableArmyCell(army.units, armyCatalog, unitId, grid);
  if (!cell) {
    showToast("There is no open space large enough for this entry on the current grid.", "warning");
    return;
  }
  const id = createKey("army-unit");
  if (!addArmyUnitToArmy(army, { id, unitId, ...cell, spellIds: [] }, () => true)) return;
  selectedArmyPlacementId = id;
  saveWorkspace();
  render();
}

function replaceSelectedArmyUnit(): void {
  const army = currentArmy();
  const selected = army?.units.find(unit => unit.id === selectedArmyPlacementId);
  const unitPicker = root!.querySelector<HTMLSelectElement>("#army-unit-picker");
  const levelPicker = root!.querySelector<HTMLSelectElement>("#army-level-picker");
  const variant = armyCatalog[armyCatalogKind].find(item => item.id === unitPicker?.value)?.levels.find(level => level.level === Number(levelPicker?.value));
  if (!army || !selected || !variant) return;
  const grid = armyGridSize(armyCatalog, army.previewFloor, army.blessingIds);
  const replaced = replaceArmyUnit(army, selected.id, variant.id, (placement, candidateId) =>
    canPlaceArmyLevel(army.units, armyCatalog, candidateId, placement.x, placement.y, grid, placement.id));
  if (!replaced) {
    showToast("That entry will not fit in this position. Move it or choose a smaller entry first.", "warning");
    return;
  }
  const resolved = resolveArmyLevel(armyCatalog, variant.id);
  if (resolved) armyCatalogKind = resolved.kind;
  saveWorkspace();
  render();
}

function addSelectedArmyUnitSpell(): void {
  const army = currentArmy();
  const picker = root!.querySelector<HTMLSelectElement>("#army-unit-spell-picker");
  if (!army || !selectedArmyPlacementId || !picker?.value) return;
  if (!addArmyUnitSpell(army, selectedArmyPlacementId, picker.value, armyCatalog.spells.map(spell => spell.id))) return;
  saveWorkspace();
  render();
}

function addArmyAbility(kind: "spell" | "blessing" | "curse"): void {
  const army = currentArmy();
  const pickerId = kind === "spell" ? "army-spell-picker" : kind === "curse" ? "army-curse-picker" : "army-blessing-picker";
  const picker = root!.querySelector<HTMLSelectElement>("#" + pickerId);
  const id = picker?.value ?? "";
  const catalog = kind === "spell" ? armyCatalog.spells : kind === "curse" ? armyCatalog.curses ?? [] : armyCatalog.blessings;
  const list = kind === "spell" ? army?.spellIds : army?.blessingIds;
  if (!army || !id || !catalog.some(item => item.id === id) || !list) return;
  armyAbilitySelections[kind === "spell" ? "spells" : kind === "curse" ? "curses" : "blessings"] = id;
  if (list.includes(id)) return;
  list.push(id);
  if (kind !== "spell") focusArmyBattlefieldEffect(id);
  saveWorkspace();
  render();
}

function addAndConfigureArmyBattlefieldEffect(id: string, kind: "blessings" | "curses"): void {
  const army = currentArmy();
  const catalog = kind === "curses" ? armyCatalog.curses ?? [] : armyCatalog.blessings;
  const ability = catalog.find(item => item.id === id);
  if (!army || ability?.family !== "cell") return;
  armyAbilitySelections[kind] = id;
  if (!army.blessingIds.includes(id)) army.blessingIds.push(id);
  if (!focusArmyBattlefieldEffect(id)) return;
  saveWorkspace();
  render();
}

function focusArmyBattlefieldEffect(id: string): boolean {
  const army = currentArmy();
  const ability = armyCatalog.blessings.concat(armyCatalog.curses ?? []).find(item => item.id === id);
  if (!army || ability?.family !== "cell") return false;
  selectedArmyBattlefieldEffectId = id;
  selectedArmyCellRegion = "boon";
  const rootId = String(ability.mechanics?.rootPersistentId ?? ability.mechanics?.persistentId ?? id);
  army.cellBlessingPicks ??= [];
  if (!army.cellBlessingPicks.some(pick => pick.rootId === rootId)) army.cellBlessingPicks.push({ rootId, lane: -1, cells: [], locked: false, baneCells: [] });
  return true;
}

function syncArmyLevelPicker(unitBaseId: string): void {
  const picker = root!.querySelector<HTMLSelectElement>("#army-level-picker");
  const unit = armyCatalog[armyCatalogKind].find(item => item.id === unitBaseId);
  if (!picker || !unit) return;
  const previous = picker.value;
  picker.replaceChildren(...unit.levels.map(level => {
    const option = document.createElement("option");
    option.value = String(level.level);
    option.textContent = "Level " + level.level + (level.name !== unit.name ? " · " + level.name : "");
    return option;
  }));
  picker.value = unit.levels.some(level => String(level.level) === previous) ? previous : String(unit.levels[0]?.level ?? 1);
  updateArmyEntityPreview();
}

function updateArmyEntityPreview(): void {
  const preview = root!.querySelector<HTMLElement>("#army-entity-preview");
  const unitPicker = root!.querySelector<HTMLSelectElement>("#army-unit-picker");
  const levelPicker = root!.querySelector<HTMLSelectElement>("#army-level-picker");
  if (!preview || !unitPicker || !levelPicker) return;
  preview.innerHTML = renderArmyEntityPreview(armyCatalog, unitPicker.value, Number(levelPicker.value), armyCatalogKind, roster);
}

function updateArmyAbilityPreview(pickerId: string, kind: ArmyAbilityKind, previewId = "army-ability-preview"): void {
  const picker = root!.querySelector<HTMLSelectElement>("#" + pickerId);
  const preview = root!.querySelector<HTMLElement>("#" + previewId);
  if (picker && preview) {
    armyAbilitySelections[kind] = picker.value;
    preview.innerHTML = renderArmyAbilityPreview(armyCatalog, picker.value, kind);
  }
}

function addNode(): void {
  const record = currentDialogue();
  if (!record) return;
  const ids = record.sequence.nodes.map(node => node.id);
  const id = uniqueId("node-" + (ids.length + 1), ids, "node");
  const node: DialogueNode = {
    id,
    headline: "",
    textSpeed: "default",
    speakers: [],
    segments: [{ speakerIds: [], text: "" }],
    actions: []
  };
  record.sequence.nodes.push(node);
  if (record.sequence.nodes.length === 1) record.sequence.startNodeId = id;
  workspace.activeNodeId = id;
  saveWorkspace();
  render();
}

function addSpeaker(nodeIndex: number): void {
  const record = currentDialogue();
  const node = record?.sequence.nodes[nodeIndex];
  if (!node || node.speakers.length >= 2) return;
  const side = node.speakers.some(speaker => speaker.side === "left") ? "right" : "left";
  const speakerId = uniqueId("speaker-" + (node.speakers.length + 1), node.speakers.map(speaker => speaker.id), "speaker");
  node.speakers.push({
    id: speakerId,
    unitId: "",
    displayName: "",
    side,
    mood: "Normal" as FaceMood
  });
  saveWorkspace();
  render();
}

function addSegment(nodeIndex: number): void {
  const node = currentDialogue()?.sequence.nodes[nodeIndex];
  if (!node) return;
  node.segments.push({ speakerIds: node.speakers[0] ? [node.speakers[0].id] : [], text: "" });
  saveWorkspace();
  render();
}

function addAction(nodeIndex: number): void {
  const record = currentDialogue();
  const node = record?.sequence.nodes[nodeIndex];
  if (!record || !node) return;
  const nextNode = record.sequence.nodes[nodeIndex + 1];
  node.actions.push({
    label: "Choose…",
    targetNodeId: nextNode?.id ?? ""
  });
  saveWorkspace();
  render();
}

function toggleDecision(nodeIndex: number, actionIndex: number): void {
  const node = currentDialogue()?.sequence.nodes[nodeIndex];
  const action = node?.actions[actionIndex];
  if (!action) return;
  if (action.decision) {
    delete action.decision;
  } else {
    action.decision = {
      id: slugBase("decision-" + (node?.id ?? "choice"), "decision"),
      label: "Named decision",
      outcomeId: slugBase("option-" + (actionIndex + 1), "option"),
      outcomeLabel: action.label || "Choice " + (actionIndex + 1)
    };
  }
  saveWorkspace();
  render();
}

function addEffect(scope: string): void {
  const quest = currentQuest();
  if (!quest) return;
  const effect: CompletionEffect = {
    kind: scope === "standard" ? "unlock-path" : "play-event",
    targetId: "",
    label: ""
  };
  if (scope === "timer") quest.extension.timer.completionEffects.push(effect);
  else quest.extension.completionEffects.push(effect);
  saveWorkspace();
  render();
}

function handleDeleteDialogClose(event: Event): void {
  const dialog = event.currentTarget as HTMLDialogElement;
  if (dialog.returnValue === "confirm" && deleteCandidate) {
    const itemType = deleteCandidate.type;
    const key = deleteCandidate.key;
    const selectionWasRemoved = workspace.selectedType === itemType && workspace.selectedKey === key;
    if (itemType === "dialogue") {
      const removedDialogue = workspace.dialogues.find(item => item.key === key);
      workspace.dialogues = workspace.dialogues.filter(item => item.key !== key);
      if (removedDialogue) {
        for (const quest of workspace.quests) {
          for (const link of Object.keys(quest.extension.dialogueLinks) as Array<keyof QuestRecord["extension"]["dialogueLinks"]>) {
            if (quest.extension.dialogueLinks[link] === removedDialogue.sequence.sequenceId) {
              quest.extension.dialogueLinks[link] = "";
            }
          }
        }
      }
    } else if (itemType === "quest") {
      const removedQuest = workspace.quests.find(item => item.key === key);
      workspace.quests = workspace.quests.filter(item => item.key !== key);
      if (removedQuest) {
        for (const campaign of workspace.campaigns) {
          campaign.questIds = campaign.questIds.filter(id => id !== removedQuest.definition.id);
          for (const floor of campaign.floors) {
            floor.questPoolIds = floor.questPoolIds.filter(id => id !== removedQuest.definition.id);
            for (const node of floor.nodes) if (node.questId === removedQuest.definition.id) node.questId = "";
          }
        }
      }
    } else if (itemType === "army") {
      const removedArmy = workspace.armies.find(item => item.key === key);
      workspace.armies = workspace.armies.filter(item => item.key !== key);
      if (removedArmy) {
        for (const quest of workspace.quests) {
          for (const battle of quest.extension.battleTargets) {
            if (battle.armyId === removedArmy.id) battle.armyId = "";
          }
        }
        for (const campaign of workspace.campaigns) for (const floor of campaign.floors) for (const node of floor.nodes) {
          if (node.armyId === removedArmy.id) node.armyId = "";
        }
        for (const campaign of workspace.campaigns) for (const event of campaign.events) for (const action of event.actions) {
          if (action.kind === "replace-player-army" && action.armyId === removedArmy.id) action.armyId = "";
        }
      }
    } else {
      workspace.campaigns = workspace.campaigns.filter(item => item.key !== key);
    }
    if (selectionWasRemoved) {
      const sameTypeItems = itemType === "dialogue" ? workspace.dialogues : itemType === "quest" ? workspace.quests : itemType === "army" ? workspace.armies : workspace.campaigns;
      const candidates = [
        { type: "dialogue" as const, item: workspace.dialogues[0] },
        { type: "quest" as const, item: workspace.quests[0] },
        { type: "army" as const, item: workspace.armies[0] },
        { type: "campaign" as const, item: workspace.campaigns[0] }
      ].filter(candidate => candidate.type !== itemType && candidate.item);
      const nextSameType = sameTypeItems[0];
      if (nextSameType) {
        workspace.selectedType = itemType;
        workspace.selectedKey = nextSameType.key;
        workspace.activeNodeId = itemType === "dialogue" ? (nextSameType as DialogueRecord).sequence.startNodeId : null;
        if (itemType === "campaign") {
          const campaign = nextSameType as CampaignRecord;
          selectedCampaignFloorId = campaign.floors[0]?.id ?? null;
          selectedCampaignNodeId = campaign.floors[0]?.nodes[0]?.id ?? null;
        }
      } else if (candidates[0]?.item) {
        const next = candidates[0];
        workspace.selectedType = next.type;
        workspace.selectedKey = next.item.key;
        workspace.activeNodeId = next.type === "dialogue" ? (next.item as DialogueRecord).sequence.startNodeId : null;
        if (next.type === "campaign") {
          const campaign = next.item as CampaignRecord;
          selectedCampaignFloorId = campaign.floors[0]?.id ?? null;
          selectedCampaignNodeId = campaign.floors[0]?.nodes[0]?.id ?? null;
        }
      } else {
        workspace.selectedType = null;
        workspace.selectedKey = null;
        workspace.activeNodeId = null;
      }
      activeEditorStep = 0;
    }
    saveWorkspace();
    render();
    showToast("Local draft removed.");
  }
  deleteCandidate = null;
}

function refreshDerivedView(): void {
  const item = currentDialogue() ?? currentQuest() ?? currentArmy() ?? currentCampaign();
  if (!item) return;
  const dialogue = currentDialogue();
  if (dialogue) {
    for (const element of document.querySelectorAll<HTMLElement>("[data-node-title]")) {
      const index = dialogue.sequence.nodes.findIndex(candidate => candidate.id === element.dataset.nodeTitle);
      const node = dialogue.sequence.nodes[index];
      if (node) element.textContent = dialogueMomentName(dialogue.sequence, node);
    }
    for (const element of document.querySelectorAll<HTMLElement>("[data-route-target]")) {
      const index = dialogue.sequence.nodes.findIndex(candidate => candidate.id === element.dataset.routeTarget);
      const target = dialogue.sequence.nodes[index];
      if (target) element.textContent = (target.id === dialogue.sequence.startNodeId ? "Start · " : "") + dialogueMomentName(dialogue.sequence, target);
    }
    for (const element of document.querySelectorAll<HTMLElement>("[data-route-label-node][data-route-label-index]")) {
      const node = dialogue.sequence.nodes.find(candidate => candidate.id === element.dataset.routeLabelNode);
      const routeIndex = Number(element.dataset.routeLabelIndex);
      const route = node ? dialogueActionsForNode(dialogue.sequence, node)[routeIndex] : undefined;
      if (route) element.textContent = route.label || "Continue";
    }
    const activeIndex = dialogue.sequence.nodes.findIndex(candidate => candidate.id === workspace.activeNodeId);
    const activeNode = dialogue.sequence.nodes[activeIndex];
    const titleHeading = document.querySelector<HTMLElement>("#guided-title-heading");
    if (titleHeading && activeNode) titleHeading.textContent = dialogueMomentName(dialogue.sequence, activeNode);
  }
  const dialogueStart = "sequence" in item
    ? item.sequence.nodes.find(node => node.id === item.sequence.startNodeId) ?? item.sequence.nodes[0]
    : undefined;
  const title = "sequence" in item
    ? (dialogueStart ? dialogueMomentName(item.sequence, dialogueStart) : "Dialogue")
    : "definition" in item ? item.definition.title || item.definition.id || "Untitled quest" : item.name || item.id || "Untitled army";
  const heading = document.querySelector<HTMLElement>(".workspace-heading h1");
  if (heading) heading.textContent = title;
  const compactHeaderTitle = document.querySelector<HTMLElement>(".guided-header-title");
  if (compactHeaderTitle) compactHeaderTitle.textContent = title;
  const activeLabel = document.querySelector<HTMLElement>(".doc-item.is-active .doc-item-text strong");
  if (activeLabel) activeLabel.textContent = title;
  const preview = document.querySelector<HTMLElement>(".preview-panel");
  if (preview) preview.outerHTML = renderLivePreview(workspace, roster);

  const issues = validateWorkspace(workspace, armyCatalog);
  const validation = document.querySelector<HTMLElement>(".validation-card");
  if (validation) validation.outerHTML = renderValidationSummary(issues);
  const hasErrors = issues.some(issue => issue.level === "error");
  const status = document.querySelector<HTMLElement>(".heading-status");
  if (status) {
    status.className = "heading-status " + (hasErrors ? "has-errors" : "is-ready");
    status.innerHTML = hasErrors ? '<span></span>Needs attention' : "";
  }
  const errorDot = document.querySelector<HTMLElement>(".global-error-dot");
  if (hasErrors && !errorDot) {
    const dot = document.createElement("div");
    dot.className = "global-error-dot";
    dot.title = "Fix validation errors before treating this content as ready";
    root!.append(dot);
  } else if (!hasErrors && errorDot) {
    errorDot.remove();
  }
}

function showToast(message: string, tone: "success" | "warning" | "error" = "success"): void {
  const region = document.querySelector<HTMLElement>("#toast-region");
  if (!region) return;
  region.innerHTML = '<div class="toast toast-' + tone + '"><span class="toast-mark">' + (tone === "success" ? "✓" : "!") + '</span><span>' + escapeHtml(message) + '</span></div>';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    const toast = region.querySelector(".toast");
    toast?.classList.add("is-leaving");
    window.setTimeout(() => { region.innerHTML = ""; }, 250);
  }, 3200);
}

function download(filename: string, content: Blob | string, mime = "application/json"): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportActive(): void {
  const dialogue = currentDialogue();
  if (dialogue) {
    download(suggestedFilename("dialogue", dialogue.sequence.sequenceId), activeDialogueJson(dialogue));
    showToast("Dialogue JSON downloaded.");
    return;
  }
  const quest = currentQuest();
  if (quest) {
    download(suggestedFilename("quest", quest.definition.id), activeQuestJson(quest));
    showToast("Quest JSON downloaded.");
    return;
  }
  const army = currentArmy();
  if (army) {
    download(suggestedFilename("army", army.id), activeArmyJson(army));
    showToast("Army JSON downloaded.");
    return;
  }
  const campaign = currentCampaign();
  if (campaign) {
    download(suggestedFilename("campaign", campaign.id), activeCampaignJson(campaign));
    showToast("Campaign JSON downloaded.");
  }
}

function exportPackage(): void {
  const filename = "meowdieval-content-" + new Date().toISOString().slice(0, 10) + ".zip";
  download(filename, workspacePackage(workspace, roster), "application/zip");
  showToast("Campaign content package downloaded.");
}

function importedDefaultContinue(rawNode: Record<string, any>, index: number, nodes: Array<Record<string, any>>): Record<string, any> | undefined {
  const actions = Array.isArray(rawNode.actions) ? rawNode.actions as Array<Record<string, any>> : [];
  const marked = actions.find(action => action.meowEdit?.defaultContinue === true);
  if (marked) return marked;
  if (actions.length !== 1) return undefined;
  const action = actions[0];
  const label = String(action.label ?? "Continue").trim() || "Continue";
  if (label !== "Continue" || action.decision || action.meowEdit?.decision) return undefined;
  const nextId = String(nodes[index + 1]?.id ?? "");
  return String(action.targetNodeId ?? "") === nextId ? action : undefined;
}

function normalizeDialogue(value: unknown): DialogueRecord {
  const source = value as Record<string, any>;
  const workspaceMeta = source._meowEditWorkspace ?? {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const sequence = {
    schemaVersion: 1 as const,
    sequenceId: String(source.sequenceId ?? "imported-dialogue"),
    startNodeId: String(source.startNodeId ?? nodes[0]?.id ?? ""),
    pauseMode: source.pauseMode === "continue" ? "continue" as const : "pause" as const,
    defaultCharactersPerSecond: Number(source.defaultCharactersPerSecond ?? 34),
    nodes: nodes.map((rawNode: Record<string, any>, nodeIndex: number) => {
      const defaultContinue = importedDefaultContinue(rawNode, nodeIndex, nodes);
      return {
      id: String(rawNode.id ?? "node"),
      headline: String(rawNode.headline ?? ""),
      ...(workspaceMeta.nodeNames?.[String(rawNode.id)] ? { editorLabel: String(workspaceMeta.nodeNames[String(rawNode.id)]) } : {}),
      ...(workspaceMeta.nodePositions?.[String(rawNode.id)] && typeof workspaceMeta.nodePositions[String(rawNode.id)] === "object"
        ? { editorPosition: {
          x: Number(workspaceMeta.nodePositions[String(rawNode.id)].x ?? 0),
          y: Number(workspaceMeta.nodePositions[String(rawNode.id)].y ?? 0),
          reverse: workspaceMeta.nodePositions[String(rawNode.id)].reverse === true
        } }
        : {}),
      textSpeed: String(rawNode.textSpeed ?? "default"),
      speakers: Array.isArray(rawNode.speakers) ? rawNode.speakers.map((speaker: Record<string, any>, index: number) => ({
        id: String(speaker.id ?? "speaker-" + (index + 1)),
        unitId: String(speaker.unitId ?? ""),
        displayName: String(speaker.displayName ?? ""),
        side: speaker.side === "right" ? "right" as const : "left" as const,
        mood: String(speaker.mood ?? "Normal")
      })) : [],
      segments: Array.isArray(rawNode.segments) ? rawNode.segments.map((segment: Record<string, any>) => ({
        speakerIds: Array.isArray(segment.speakerIds) ? segment.speakerIds.map(String) : [],
        text: String(segment.text ?? "")
      })) : [],
      ...(defaultContinue
        ? {
          continueLabel: String(defaultContinue.label ?? "Continue"),
          continueTargetNodeId: String(defaultContinue.targetNodeId ?? "")
        }
        : rawNode.continueLabel ? { continueLabel: String(rawNode.continueLabel) } : {}),
      actions: Array.isArray(rawNode.actions) ? rawNode.actions.filter((action: Record<string, any>) => action !== defaultContinue).map((action: Record<string, any>, index: number) => {
        const decision = action.meowEdit?.decision ?? action.decision;
        return {
          label: String(action.label ?? "Continue"),
          targetNodeId: String(action.targetNodeId ?? ""),
          ...(decision ? { decision: {
            id: String(decision.id ?? ""),
            label: String(decision.label ?? ""),
            outcomeId: String(decision.outcomeId ?? ""),
            outcomeLabel: String(decision.outcomeLabel ?? action.label ?? "Choice " + (index + 1))
          } } : {})
        };
      }) : []
      };
    })
  };
  return {
    key: createKey("dialogue-import"),
    sequenceIdAuto: workspaceMeta.sequenceIdAuto === true,
    sequence
  };
}

function mergeDialogue(record: DialogueRecord): void {
  const index = workspace.dialogues.findIndex(item => item.sequence.sequenceId === record.sequence.sequenceId);
  if (index >= 0) workspace.dialogues[index] = { ...record, key: workspace.dialogues[index].key };
  else workspace.dialogues.push(record);
  workspace.selectedType = "dialogue";
  workspace.selectedKey = index >= 0 ? workspace.dialogues[index].key : record.key;
  workspace.activeNodeId = record.sequence.startNodeId;
  activeEditorStep = 0;
}

function mergeQuest(record: QuestRecord): void {
  const index = workspace.quests.findIndex(item => item.definition.id === record.definition.id);
  if (index >= 0) workspace.quests[index] = { ...record, key: workspace.quests[index].key };
  else workspace.quests.push(record);
  workspace.selectedType = "quest";
  workspace.selectedKey = index >= 0 ? workspace.quests[index].key : record.key;
  workspace.activeNodeId = null;
  activeEditorStep = 0;
}

function mergeArmy(record: ArmyRecord): void {
  const index = workspace.armies.findIndex(item => item.id === record.id);
  if (index >= 0) workspace.armies[index] = { ...record, key: workspace.armies[index].key };
  else workspace.armies.push(record);
  workspace.selectedType = "army";
  workspace.selectedKey = index >= 0 ? workspace.armies[index].key : record.key;
  workspace.activeNodeId = null;
  activeEditorStep = 0;
}

function mergeCampaign(record: CampaignRecord): void {
  const index = workspace.campaigns.findIndex(item => item.id === record.id);
  if (index >= 0) workspace.campaigns[index] = { ...record, key: workspace.campaigns[index].key };
  else workspace.campaigns.push(record);
  workspace.selectedType = "campaign";
  workspace.selectedKey = index >= 0 ? workspace.campaigns[index].key : record.key;
  workspace.activeNodeId = null;
  selectedCampaignFloorId = (index >= 0 ? workspace.campaigns[index] : record).floors[0]?.id ?? null;
  selectedCampaignNodeId = (index >= 0 ? workspace.campaigns[index] : record).floors[0]?.nodes[0]?.id ?? null;
  activeEditorStep = 0;
}

function importJsonObject(value: unknown): number {
  if (!value || typeof value !== "object") throw new Error("This file does not contain a MeowEdit content document.");
  const source = value as Record<string, any>;
  let imported = 0;
  if (source.format === "meowedit-workspace") {
    for (const raw of source.dialogues ?? []) {
      const record = normalizeDialogue(raw);
      mergeDialogue(record);
      imported += 1;
    }
    for (const raw of source.quests ?? []) {
      const record = normalizeQuest(raw);
      mergeQuest(record);
      imported += 1;
    }
    for (const raw of source.armies ?? []) {
      mergeArmy(normalizeArmy(raw));
      imported += 1;
    }
    for (const raw of source.campaigns ?? []) {
      mergeCampaign(normalizeCampaign(raw));
      imported += 1;
    }
    return imported;
  }
  if ((source.format === "meowedit-campaign" || source.format === "meowdieval-campaign") && source.campaign) {
    mergeCampaign(normalizeCampaign(source));
    return 1;
  }
  if (source.format === "meowedit-army" && source.army) {
    mergeArmy(normalizeArmy(source.army));
    return 1;
  }
  if (Array.isArray(source.quests)) {
    for (const raw of source.quests) {
      mergeQuest(normalizeQuest(raw));
      imported += 1;
    }
    return imported;
  }
  if (Array.isArray(source.nodes) && source.sequenceId) {
    mergeDialogue(normalizeDialogue(source));
    return 1;
  }
  throw new Error("Choose a MeowEdit workspace, an Adventure quest JSON, or a dialogue sequence JSON.");
}

function importZip(bytes: Uint8Array): number {
  const files = readStoredZip(bytes);
  let imported = 0;
  for (const [path, data] of files) {
    if (/\/armies\/ArmyConfigurations\.json$/i.test(path)) {
      const source = parseImportedJson(decodeZipText(data)) as Record<string, any>;
      for (const raw of source.armies ?? []) {
        mergeArmy(normalizeArmy(raw));
        imported += 1;
      }
    }
  }
  for (const [path, data] of files) {
    if (/\/campaigns\/Campaigns\.json$/i.test(path)) {
      const source = parseImportedJson(decodeZipText(data)) as Record<string, any>;
      for (const raw of source.campaigns ?? []) { mergeCampaign(normalizeCampaign(raw)); imported += 1; }
    }
  }
  for (const [path, data] of files) {
    if (/\/quests\/Definitions\.json$/i.test(path)) {
      imported += importJsonObject(parseImportedJson(decodeZipText(data)));
    }
  }
  for (const [path, data] of files) {
    if (/\/dialogues\/[^/]+\.json$/i.test(path)) {
      imported += importJsonObject(parseImportedJson(decodeZipText(data)));
    }
  }
  if (imported === 0) throw new Error("No quest or dialogue JSON files were found in this package.");
  return imported;
}

async function importFile(file: File): Promise<void> {
  try {
    let imported: number;
    if (file.name.toLowerCase().endsWith(".zip")) {
      imported = importZip(new Uint8Array(await file.arrayBuffer()));
    } else {
      imported = importJsonObject(parseImportedJson(await file.text()));
    }
    saveWorkspace();
    render();
    showToast("Imported " + imported + " content item" + (imported === 1 ? "" : "s") + ".");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not import this file.", "error");
  } finally {
    const picker = document.querySelector<HTMLInputElement>("#import-file");
    if (picker) picker.value = "";
  }
}

function setMobileSidebarOpen(open: boolean): void {
  const sidebar = root!.querySelector<HTMLElement>(".sidebar");
  const appLayout = root!.querySelector<HTMLElement>(".app-layout");
  const toggle = root!.querySelector<HTMLButtonElement>(".mobile-brand");
  sidebar?.classList.toggle("is-open", open);
  appLayout?.classList.toggle("is-sidebar-open", open);
  if (toggle) {
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    toggle.title = open ? "Close navigation menu" : "Open navigation menu";
    const chevron = toggle.querySelector<HTMLElement>(".mobile-menu-chevron");
    if (chevron) chevron.textContent = open ? "‹" : "›";
  }
}

function onAction(button: HTMLButtonElement): void {
  const action = button.dataset.action;
  switch (action) {
    case "army-ability-filter": {
      const kind = button.dataset.kind;
      const filter = button.dataset.filter;
      if ((kind === "spells" || kind === "blessings" || kind === "curses") && (filter === "all" || filter === "field")) {
        armyAbilityFilters[kind] = filter;
        render();
      }
      return;
    }
    case "army-ability-category": {
      const kind = button.dataset.kind;
      if (kind === "spells" || kind === "blessings" || kind === "curses") {
        armyAbilityCategory = kind;
        render();
      }
      return;
    }
    case "toggle-help":
      helpVisible = !helpVisible;
      persistEditorSession();
      render();
      return;
    case "new-dialogue": addDialogue(); return;
    case "new-quest": addQuest(); return;
    case "new-army": addArmy(); return;
    case "new-campaign": addCampaign(); return;
    case "return-to-parent": returnToRelatedParent(); return;
    case "create-campaign-army": {
      const context = campaignRelatedContext("army");
      if (context) addArmy(context);
      return;
    }
    case "open-campaign-army": {
      const army = workspace.armies.find(item => item.id === button.dataset.armyId);
      const context = campaignRelatedContext("army");
      if (army && context) openRelatedRecord("army", army.key, context);
      return;
    }
    case "create-campaign-event-army": {
      const eventId = button.dataset.eventId ?? selectedCampaignEventId ?? "";
      const context = campaignEventArmyContext(eventId);
      if (context) addArmy(context);
      return;
    }
    case "open-campaign-event-army": {
      const eventId = button.dataset.eventId ?? selectedCampaignEventId ?? "";
      const army = workspace.armies.find(item => item.id === button.dataset.armyId);
      const context = campaignEventArmyContext(eventId);
      if (army && context) {
        selectedCampaignEventId = eventId;
        openRelatedRecord("army", army.key, context);
      }
      return;
    }
    case "create-campaign-node-quest": {
      const context = campaignRelatedContext("quest-node");
      if (context) addQuest(context);
      return;
    }
    case "open-campaign-node-quest": {
      const quest = workspace.quests.find(item => item.definition.id === button.dataset.questId);
      const context = campaignRelatedContext("quest-node");
      if (quest && context) openRelatedRecord("quest", quest.key, context);
      return;
    }
    case "open-campaign-pool-quest": {
      const quest = workspace.quests.find(item => item.definition.id === button.dataset.questId);
      const context = campaignRelatedContext("quest-pool");
      if (quest && context) openRelatedRecord("quest", quest.key, context);
      return;
    }
    case "create-campaign-pool-quest": {
      const context = campaignRelatedContext("quest-pool", true);
      if (context) addQuest(context);
      return;
    }
    case "create-quest-battle-army": {
      const context = questRelatedContext("army", button.dataset.targetId ?? "");
      if (context) addArmy(context);
      return;
    }
    case "open-quest-battle-army": {
      const army = workspace.armies.find(item => item.id === button.dataset.armyId);
      const context = questRelatedContext("army", button.dataset.targetId ?? "");
      if (army && context) openRelatedRecord("army", army.key, context);
      return;
    }
    case "create-quest-dialogue": {
      const slot = button.dataset.slot as keyof QuestRecord["extension"]["dialogueLinks"];
      if (["offer", "active", "completion", "failure"].includes(slot)) {
        const context = questDialogueContext(slot);
        if (context) addDialogue(context);
      }
      return;
    }
    case "open-quest-dialogue": {
      const dialogue = workspace.dialogues.find(item => item.sequence.sequenceId === button.dataset.dialogueId);
      const slot = button.dataset.slot as keyof QuestRecord["extension"]["dialogueLinks"];
      if (dialogue && ["offer", "active", "completion", "failure"].includes(slot)) {
        const context = questDialogueContext(slot);
        if (context) openRelatedRecord("dialogue", dialogue.key, context);
      }
      return;
    }
    case "close-sidebar":
      setMobileSidebarOpen(false);
      return;
    case "select-item": {
      const picker = document.querySelector<HTMLDialogElement>("#content-picker-dialog");
      if (picker?.open) {
        if (typeof picker.close === "function") picker.close();
        else picker.removeAttribute("open");
      }
      const type = button.dataset.type === "dialogue" ? "dialogue" : button.dataset.type === "army" ? "army" : button.dataset.type === "campaign" ? "campaign" : "quest";
      const key = button.dataset.key ?? null;
      if (type !== workspace.selectedType || key !== workspace.selectedKey) activeEditorStep = 0;
      relatedReturnContexts.clear();
      workspace.selectedType = type;
      workspace.selectedKey = key;
      workspace.activeNodeId = type === "dialogue"
        ? workspace.dialogues.find(item => item.key === key)?.sequence.startNodeId ?? null
        : null;
      if (type === "campaign") {
        const campaign = workspace.campaigns.find(item => item.key === key);
        selectedCampaignFloorId = campaign?.floors[0]?.id ?? null;
        selectedCampaignNodeId = campaign?.floors[0]?.nodes[0]?.id ?? null;
        campaignInteractionMode = "select";
        campaignAddMenuOpen = false;
        pendingCampaignPlugFromId = null;
        selectedCampaignRouteId = null;
      }
      selectedArmyPlacementId = null;
      armyCatalogKind = "units";
      saveWorkspace();
      render();
      return;
    }
    case "delete-item": {
      const type = button.dataset.type === "dialogue" ? "dialogue" : button.dataset.type === "army" ? "army" : button.dataset.type === "campaign" ? "campaign" : "quest";
      const key = button.dataset.key ?? "";
      const exists = type === "dialogue"
        ? workspace.dialogues.some(item => item.key === key)
        : type === "quest" ? workspace.quests.some(item => item.key === key) : type === "army" ? workspace.armies.some(item => item.key === key) : workspace.campaigns.some(item => item.key === key);
      if (!exists) return;
      deleteCandidate = { type, key };
      document.querySelector<HTMLDialogElement>("#confirm-dialog")?.showModal();
      return;
    }
    case "select-node":
      workspace.activeNodeId = button.dataset.nodeId ?? null;
      render();
      return;
    case "select-editor-step":
      activeEditorStep = Math.max(0, Number(button.dataset.step ?? 0));
      if (currentCampaign()) selectedCampaignEventId = null;
      render();
      return;
    case "campaign-add-floor": addCampaignFloor(); return;
    case "campaign-add-event": addCampaignEvent(); return;
    case "campaign-edit-events": {
      const campaign = currentCampaign();
      if (!campaign?.events.length) return;
      selectedCampaignEventId = null;
      if (editorMode === "guided") activeEditorStep = Math.max(0, activeEditorStep - 1);
      render(); return;
    }
    case "campaign-select-event": {
      const event = currentCampaign()?.events.find(item => item.id === button.dataset.eventId);
      if (!event) return;
      selectedCampaignEventId = event.id;
      render(); return;
    }
    case "campaign-events-back": selectedCampaignEventId = null; render(); return;
    case "campaign-remove-event": {
      const campaign = currentCampaign();
      const index = campaign?.events.findIndex(item => item.id === button.dataset.eventId) ?? -1;
      if (!campaign || index < 0) return;
      campaign.events.splice(index, 1);
      if (selectedCampaignEventId === button.dataset.eventId) selectedCampaignEventId = null;
      saveWorkspace(); render(); return;
    }
    case "campaign-add-event-action": {
      const event = currentCampaign()?.events.find(item => item.id === (button.dataset.eventId ?? selectedCampaignEventId));
      if (!event || event.actions.some(item => item.kind === "replace-player-army")) return;
      event.actions.push({ kind: "replace-player-army", armyId: "" });
      saveWorkspace(); render(); return;
    }
    case "campaign-remove-event-action": {
      const event = currentCampaign()?.events.find(item => item.id === (button.dataset.eventId ?? selectedCampaignEventId));
      const index = Number(button.dataset.index);
      if (!event || !Number.isInteger(index) || index < 0 || index >= event.actions.length || event.actions[index].kind !== "replace-player-army") return;
      event.actions.splice(index, 1);
      saveWorkspace(); render(); return;
    }
    case "campaign-design-choice": {
      const campaign = currentCampaign();
      const choice = button.dataset.mode;
      if (!campaign || campaign.designMode !== "choose" || (choice !== "settings-only" && choice !== "custom")) return;
      campaign.designMode = choice;
      if (choice === "settings-only") {
        campaign.questIds = [];
        campaign.settings.questNodeCountPerRandomFloor = 0;
        campaign.settings.continueWithGeneratedFloors = true;
        for (const floor of campaign.floors) {
          floor.mode = "random";
          floor.nodes = [];
          floor.routes = [];
          floor.randomSettings.questNodeCount = 0;
          floor.questPoolMode = "campaign";
          floor.questPoolIds = [];
        }
        selectedCampaignNodeId = null;
        campaignInteractionMode = "select";
        campaignAddMenuOpen = false;
        pendingCampaignPlugFromId = null;
        selectedCampaignRouteId = null;
      }
      activeEditorStep = 0;
      saveWorkspace();
      render();
      return;
    }
    case "campaign-remove-floor": {
      const campaign = currentCampaign();
      const floor = currentCampaignFloor(campaign);
      if (!campaign || !floor || campaign.floors.length <= 1) return;
      if (!window.confirm("Remove Floor " + floor.number + " and all its nodes and routes?")) return;
      removeCampaignFloor(campaign, floor.id);
      selectedCampaignFloorId = campaign.floors[0]?.id ?? null;
      selectedCampaignNodeId = campaign.floors[0]?.nodes[0]?.id ?? null;
      campaignInteractionMode = "select"; campaignAddMenuOpen = false; pendingCampaignPlugFromId = null; selectedCampaignRouteId = null;
      saveWorkspace(); render(); showToast("Floor removed."); return;
    }
    case "campaign-select-floor": {
      const floor = currentCampaign()?.floors.find(item => item.id === button.dataset.floorId);
      if (!floor) return;
      selectedCampaignFloorId = floor.id;
      selectedCampaignNodeId = floor.nodes[0]?.id ?? null;
      campaignInteractionMode = "select"; campaignAddMenuOpen = false; pendingCampaignPlugFromId = null; selectedCampaignRouteId = null;
      saveWorkspace(); render(); return;
    }
    case "campaign-set-floor-mode": {
      const floor = currentCampaignFloor();
      const campaign = currentCampaign();
      const mode = button.dataset.mode as CampaignFloorMode;
      if (!floor || !["authored", "random", "mixed"].includes(mode)) return;
      if (mode !== "random" && campaign?.designMode === "settings-only") campaign.designMode = "custom";
      if (mode !== "random" && floor.mode === "random" && floor.nodes.length === 0) {
        const replacement = newCampaignFloor(floor.number, mode);
        floor.nodes = replacement.nodes; floor.routes = replacement.routes;
      }
      floor.mode = mode; campaignInteractionMode = "select"; campaignAddMenuOpen = false; pendingCampaignPlugFromId = null; selectedCampaignRouteId = null;
      saveWorkspace(); render(); return;
    }
    case "campaign-toggle-floor-pool-mode": {
      const campaign = currentCampaign();
      const floor = currentCampaignFloor(campaign);
      if (!campaign || !floor) return;
      if (floor.questPoolMode === "custom") {
        floor.questPoolMode = "campaign";
        floor.questPoolIds = [];
      } else {
        floor.questPoolMode = "custom";
        floor.questPoolIds = [...campaign.questIds];
      }
      saveWorkspace(); render(); return;
    }
    case "campaign-toggle-floor-quest": {
      const campaign = currentCampaign();
      const floor = currentCampaignFloor(campaign);
      const questId = button.dataset.questId ?? "";
      if (!campaign || !floor || !questId || !campaign.questIds.includes(questId)) return;
      floor.questPoolIds = floor.questPoolIds.includes(questId)
        ? floor.questPoolIds.filter(id => id !== questId)
        : [...floor.questPoolIds, questId];
      saveWorkspace(); render(); return;
    }
    case "campaign-toggle-shop-pool": {
      const campaign = currentCampaign();
      const floor = currentCampaignFloor(campaign);
      const kind = button.dataset.kind as CampaignRecord["settings"]["shopPoolKinds"][number];
      if (!campaign || !["Unit", "Blessing", "Research", "SpellUnlock"].includes(kind)) return;
      const pools = button.dataset.scope === "floor" && floor ? floor.shopPoolKinds : campaign.settings.shopPoolKinds;
      const next = pools.includes(kind) ? pools.filter(item => item !== kind) : [...pools, kind];
      if (button.dataset.scope === "floor" && floor) floor.shopPoolKinds = next;
      else campaign.settings.shopPoolKinds = next;
      saveWorkspace(); render(); return;
    }
    case "campaign-toggle-floor-shop-mode": {
      const campaign = currentCampaign();
      const floor = currentCampaignFloor(campaign);
      if (!campaign || !floor) return;
      if (floor.shopPoolMode === "custom") {
        floor.shopPoolMode = "campaign";
        floor.shopPoolKinds = [];
      } else {
        floor.shopPoolMode = "custom";
        floor.shopPoolKinds = [...campaign.settings.shopPoolKinds];
      }
      saveWorkspace(); render(); return;
    }
    case "campaign-add-shop-offer": {
      const nodeId = button.dataset.nodeId ?? selectedCampaignNodeId;
      const node = currentCampaignFloor()?.nodes.find(item => item.id === nodeId);
      if (!node || node.kind !== "Shop" || node.shopOffers.length >= 3) return;
      node.shopOffers.push({ kind: "Unit", contentId: "", price: 0 });
      node.shopOfferMode = "exact";
      saveWorkspace(); render(); return;
    }
    case "campaign-remove-shop-offer": {
      const node = currentCampaignFloor()?.nodes.find(item => item.id === selectedCampaignNodeId);
      const index = Number(button.dataset.index);
      if (!node || node.kind !== "Shop" || !Number.isInteger(index) || index < 0 || index >= node.shopOffers.length) return;
      node.shopOffers.splice(index, 1);
      saveWorkspace(); render(); return;
    }
    case "campaign-node-tool": {
      const kind = button.dataset.kind as CampaignNodeKind;
      if (!["Start", "Battle", "Reward", "Boss", "Quest", "Shop"].includes(kind)) return;
      if (campaignInteractionMode === "add" && campaignNodeKindDraft === kind) {
        campaignInteractionMode = "select";
      } else {
        campaignNodeKindDraft = kind;
        campaignInteractionMode = "add";
      }
      campaignAddMenuOpen = false;
      pendingCampaignPlugFromId = null;
      selectedCampaignRouteId = null;
      render(); return;
    }
    case "campaign-toggle-add-menu":
      campaignAddMenuOpen = !campaignAddMenuOpen;
      campaignInteractionMode = "select";
      render(); return;
    case "campaign-select-mode":
      campaignInteractionMode = "select";
      campaignAddMenuOpen = false;
      pendingCampaignPlugFromId = null;
      render(); return;
    case "campaign-toggle-route-direction": {
      const floor = currentCampaignFloor();
      const route = floor?.routes.find(item => item.id === button.dataset.routeId);
      if (!route) return;
      route.oneWay = !route.oneWay;
      selectedCampaignRouteId = route.id;
      saveWorkspace(); render(); return;
    }
    case "campaign-cell": handleCampaignCell(Number(button.dataset.x), Number(button.dataset.y)); return;
    case "campaign-node": selectCampaignNode(button.dataset.nodeId ?? ""); return;
    case "campaign-remove-node": {
      const floor = currentCampaignFloor();
      if (!floor || !selectedCampaignNodeId) return;
      removeCampaignNode(floor, selectedCampaignNodeId);
      selectedCampaignNodeId = floor.nodes[0]?.id ?? null; campaignInteractionMode = "select";
      if (editorMode === "guided") activeEditorStep = 2;
      saveWorkspace(); render(); return;
    }
    case "campaign-back-to-map":
      activeEditorStep = 2;
      campaignInteractionMode = "select";
      campaignAddMenuOpen = false;
      pendingCampaignPlugFromId = null;
      render();
      return;
    case "campaign-remove-route": {
      const floor = currentCampaignFloor();
      if (!floor) return;
      floor.routes = floor.routes.filter(route => route.id !== button.dataset.routeId);
      selectedCampaignRouteId = null;
      saveWorkspace(); render(); return;
    }
    case "campaign-toggle-quest": {
      const campaign = currentCampaign();
      const questId = button.dataset.questId ?? "";
      if (!campaign || !questId) return;
      if (campaign.questIds.includes(questId)) {
        campaign.questIds = campaign.questIds.filter(id => id !== questId);
        for (const floor of campaign.floors) {
          floor.questPoolIds = floor.questPoolIds.filter(id => id !== questId);
          for (const node of floor.nodes) if (node.questId === questId) node.questId = "";
        }
      } else campaign.questIds.push(questId);
      saveWorkspace(); render(); return;
    }
    case "editor-back":
      if (currentCampaign() && root!.querySelector(".campaign-event-focus")) selectedCampaignEventId = null;
      activeEditorStep = Math.max(0, activeEditorStep - 1);
      render();
      return;
    case "editor-next":
      if (currentCampaign() && root!.querySelector(".campaign-event-focus")) selectedCampaignEventId = null;
      activeEditorStep = currentArmy() ? Math.min(activeEditorStep + 1, 5) : activeEditorStep + 1;
      render();
      return;
    case "open-full-editor":
      editorMode = "full";
      if (currentQuest()) activeEditorStep = activeEditorStep >= 4 ? 7 : Math.min(activeEditorStep, 3);
      else if (currentCampaign()) activeEditorStep = Math.min(activeEditorStep, 12);
      else if (currentArmy()) activeEditorStep = Math.min(activeEditorStep, 5);
      else activeEditorStep = Math.min(activeEditorStep, 4);
      render();
      return;
    case "open-guided-editor":
      editorMode = "guided";
      activeEditorStep = currentQuest() ? (activeEditorStep >= 4 ? 4 : Math.min(activeEditorStep, 3)) : Math.min(activeEditorStep, 4);
      if (currentCampaign()) activeEditorStep = Math.min(activeEditorStep, 12);
      if (currentArmy()) activeEditorStep = Math.min(activeEditorStep, 5);
      render();
      return;
    case "guided-add-node":
      activeEditorStep = 0;
      addNode();
      return;
    case "dialogue-graph-zoom-in": activeDialogueGraph?.zoom_in(); return;
    case "dialogue-graph-zoom-out": activeDialogueGraph?.zoom_out(); return;
    case "dialogue-graph-zoom-reset": activeDialogueGraph?.zoom_reset(); return;
    case "dialogue-graph-arrange": {
      const dialogue = currentDialogue();
      if (!dialogue) return;
      compactDialogueGraph(dialogue, root!.querySelector<HTMLElement>("[data-dialogue-node-graph]")?.clientWidth ?? 0);
      saveWorkspace();
      render();
      return;
    }
    case "add-node": addNode(); return;
    case "add-speaker": addSpeaker(Number(button.dataset.nodeIndex)); return;
    case "add-segment": addSegment(Number(button.dataset.nodeIndex)); return;
    case "add-action": addAction(Number(button.dataset.nodeIndex)); return;
    case "toggle-decision": toggleDecision(Number(button.dataset.nodeIndex), Number(button.dataset.index)); return;
    case "remove-speaker": {
      const nodeIndex = Number(button.dataset.nodeIndex);
      const speakerIndex = Number(button.dataset.index);
      const node = currentDialogue()?.sequence.nodes[nodeIndex];
      if (!node) return;
      const [removed] = node.speakers.splice(speakerIndex, 1);
      for (const segment of node.segments) segment.speakerIds = segment.speakerIds.filter(id => id !== removed?.id);
      saveWorkspace();
      render();
      return;
    }
    case "remove-segment": {
      const node = currentDialogue()?.sequence.nodes[Number(button.dataset.nodeIndex)];
      node?.segments.splice(Number(button.dataset.index), 1);
      saveWorkspace();
      render();
      return;
    }
    case "remove-action": {
      const node = currentDialogue()?.sequence.nodes[Number(button.dataset.nodeIndex)];
      node?.actions.splice(Number(button.dataset.index), 1);
      saveWorkspace();
      render();
      return;
    }
    case "remove-effect": {
      const quest = currentQuest();
      if (!quest) return;
      if (button.dataset.scope === "timer") quest.extension.timer.completionEffects.splice(Number(button.dataset.index), 1);
      else quest.extension.completionEffects.splice(Number(button.dataset.index), 1);
      saveWorkspace();
      render();
      return;
    }
    case "add-effect": addEffect(button.dataset.scope ?? "standard"); return;
    case "add-fetch-item": {
      const quest = currentQuest();
      if (!quest) return;
      const index = quest.extension.fetchItems.length + 1;
      quest.extension.fetchItems.push({ id: "item-" + index, displayName: "", count: 1 });
      saveWorkspace(); render(); return;
    }
    case "remove-fetch-item": {
      const quest = currentQuest();
      if (!quest) return;
      quest.extension.fetchItems.splice(Number(button.dataset.index), 1);
      quest.definition.itemId = quest.extension.fetchItems[0]?.id ?? "";
      saveWorkspace(); render(); return;
    }
    case "add-battle-target": {
      const quest = currentQuest();
      if (!quest) return;
      const index = quest.extension.battleTargets.length + 1;
      quest.extension.battleTargets.push({ id: uniqueId("battle-" + index, quest.extension.battleTargets.map(item => item.id), "battle"), label: "Battle " + index, nodeKind: "Battle", floorOffset: 0, armyId: "" });
      saveWorkspace(); render(); return;
    }
    case "remove-battle-target": {
      const quest = currentQuest();
      if (!quest) return;
      quest.extension.battleTargets.splice(Number(button.dataset.index), 1);
      if (Number(button.dataset.index) === 0 && quest.extension.battleTargets[0]) {
        quest.definition.targetNodeKind = quest.extension.battleTargets[0].nodeKind;
        quest.definition.targetFloorOffset = quest.extension.battleTargets[0].floorOffset;
      }
      saveWorkspace(); render(); return;
    }
    case "add-minimum-distance": {
      const quest = currentQuest();
      if (!quest) return;
      quest.extension.minimumNodeDistances.push({ id: createKey("distance-rule"), fromNodeKind: "QuestStart", toNodeKind: "Battle", minimumHops: 1 });
      saveWorkspace(); render(); return;
    }
    case "remove-minimum-distance": {
      const quest = currentQuest();
      if (!quest) return;
      quest.extension.minimumNodeDistances.splice(Number(button.dataset.index), 1);
      saveWorkspace(); render(); return;
    }
    case "place-army-unit": {
      const army = currentArmy();
      if (!army) return;
      const x = Number(button.dataset.x); const y = Number(button.dataset.y);
      addArmyUnitAt(x, y, selectedArmyPickerLevelId() ?? ""); return;
    }
    case "select-army-placement": {
      selectedArmyPlacementId = button.dataset.placementId ?? null;
      const selected = currentArmy()?.units.find(unit => unit.id === selectedArmyPlacementId);
      const resolved = selected ? resolveArmyLevel(armyCatalog, selected.unitId) : undefined;
      if (resolved) armyCatalogKind = resolved.kind;
      render(); return;
    }
    case "army-catalog-kind": {
      const kind = button.dataset.kind;
      if (kind === "units" || kind === "buildings") { armyCatalogKind = kind; render(); }
      return;
    }
    case "add-selected-army-unit": addSelectedArmyUnit(); return;
    case "replace-army-placement": replaceSelectedArmyUnit(); return;
    case "remove-army-placement": {
      const army = currentArmy();
      if (!army) return;
      const id = button.dataset.placementId ?? "";
      army.units = army.units.filter(unit => unit.id !== id);
      if (selectedArmyPlacementId === id) selectedArmyPlacementId = null;
      saveWorkspace(); render(); return;
    }
    case "add-army-spell": addArmyAbility("spell"); return;
    case "add-army-blessing": addArmyAbility("blessing"); return;
    case "add-army-curse": addArmyAbility("curse"); return;
    case "add-configure-battlefield-effect": {
      const id = button.dataset.abilityId ?? "";
      const kind = button.dataset.kind;
      if (kind === "blessings" || kind === "curses") addAndConfigureArmyBattlefieldEffect(id, kind);
      return;
    }
    case "select-army-ability": {
      const id = button.dataset.abilityId ?? "";
      const kind = button.dataset.kind;
      const army = currentArmy();
      const activeIds = kind === "spells" ? army?.spellIds : army?.blessingIds;
      if (!army || !id || !activeIds?.includes(id) || (kind !== "spells" && kind !== "blessings" && kind !== "curses")) return;
      armyAbilityCategory = kind;
      armyAbilitySelections[kind] = id;
      render();
      return;
    }
    case "add-army-unit-spell": addSelectedArmyUnitSpell(); return;
    case "remove-army-unit-spell": {
      const army = currentArmy();
      if (!army || !selectedArmyPlacementId || !removeArmyUnitSpell(army, selectedArmyPlacementId, Number(button.dataset.index))) return;
      saveWorkspace(); render(); return;
    }
    case "remove-army-spell": {
      const army = currentArmy(); if (!army) return;
      army.spellIds.splice(Number(button.dataset.index), 1); saveWorkspace(); render(); return;
    }
    case "remove-army-blessing": {
      const army = currentArmy(); if (!army) return;
      const [removedId] = army.blessingIds.splice(Number(button.dataset.index), 1);
      const allBlessings = armyCatalog.blessings.concat(armyCatalog.curses ?? []);
      const removed = allBlessings.find(item => item.id === removedId);
      const rootId = String(removed?.mechanics?.rootPersistentId ?? removed?.mechanics?.persistentId ?? removedId);
      if (!army.blessingIds.some(id => {
        const ability = allBlessings.find(item => item.id === id);
        return String(ability?.mechanics?.rootPersistentId ?? ability?.mechanics?.persistentId ?? id) === rootId;
      })) army.cellBlessingPicks = (army.cellBlessingPicks ?? []).filter(pick => pick.rootId !== rootId);
      if (selectedArmyBattlefieldEffectId === removedId) selectedArmyBattlefieldEffectId = null;
      saveWorkspace(); render(); return;
    }
    case "configure-battlefield-effect": {
      const army = currentArmy();
      const id = button.dataset.abilityId ?? "";
      if (!army?.blessingIds.includes(id)) return;
      if (button.dataset.kind === "blessings" || button.dataset.kind === "curses") {
        armyAbilityCategory = button.dataset.kind;
        armyAbilitySelections[button.dataset.kind] = id;
      }
      if (focusArmyBattlefieldEffect(id)) { render(); }
      return;
    }
    case "close-cell-blessing-focus": selectedArmyBattlefieldEffectId = null; render(); return;
    case "cell-blessing-region": {
      const region = button.dataset.region;
      if (region === "boon" || region === "bane") { selectedArmyCellRegion = region; render(); }
      return;
    }
    case "pick-cell-blessing-lane":
    case "toggle-cell-blessing-cell": {
      const army = currentArmy();
      const ability = armyCatalog.blessings.concat(armyCatalog.curses ?? []).find(item => item.id === selectedArmyBattlefieldEffectId);
      if (!army || !ability || ability.family !== "cell") return;
      const mechanics = ability.mechanics ?? {};
      const rootId = String(mechanics.rootPersistentId ?? mechanics.persistentId ?? ability.id);
      army.cellBlessingPicks ??= [];
      let pick = army.cellBlessingPicks.find(item => item.rootId === rootId);
      if (!pick) { pick = { rootId, lane: -1, cells: [], locked: false, baneCells: [] }; army.cellBlessingPicks.push(pick); }
      if (button.dataset.action === "pick-cell-blessing-lane") {
        pick.lane = Number(button.dataset.y);
        pick.locked = true;
        pick.cells = [];
      } else {
        const field = selectedArmyCellRegion === "boon" ? "cells" : "baneCells";
        const cells = pick[field];
        const x = Number(button.dataset.x), y = Number(button.dataset.y);
        const index = cells.findIndex(cell => cell.x === x && cell.y === y);
        if (index >= 0) cells.splice(index, 1);
        else {
          const capacity = Number(selectedArmyCellRegion === "boon" ? mechanics.cellCount ?? 1 : mechanics.baneCellCount ?? 1);
          if (cells.length >= capacity) { showToast("This effect targets " + capacity + (capacity === 1 ? " field." : " fields."), "warning"); return; }
          if (selectedArmyCellRegion === "bane" && pick.cells.some(cell => cell.x === x && cell.y === y)) { showToast("The blessing and bane fields cannot overlap.", "warning"); return; }
          cells.push({ x, y });
        }
        const boonReady = String(mechanics.rule) !== "RandomCells" || pick.cells.length === Number(mechanics.cellCount ?? 1);
        const baneReady = String(mechanics.baneRule) !== "RandomCells" || pick.baneCells.length === Number(mechanics.baneCellCount ?? 1);
        pick.locked = boonReady && baneReady;
      }
      saveWorkspace(); render(); return;
    }
    case "preview-choice": {
      const target = button.dataset.target ?? "";
      if (target) {
        workspace.activeNodeId = target;
        render();
      } else {
        showToast("End dialogue closes this conversation.");
      }
      return;
    }
    case "preview-reset": {
      const record = currentDialogue();
      if (record) {
        workspace.activeNodeId = record.sequence.startNodeId;
        render();
      }
      return;
    }
    case "save-package":
      saveWorkspace();
      if (isScratch()) {
        const status = document.querySelector<HTMLElement>("#save-status");
        if (status) status.textContent = "Saved locally";
        return;
      }
      syncDraft();
      void Promise.resolve(mountOptions?.onSave()).then(message => {
        const status = document.querySelector<HTMLElement>("#save-status");
        if (status && message) status.textContent = message;
      });
      return;
    case "publish-package":
      saveWorkspace();
      syncDraft();
      void Promise.resolve(mountOptions?.onPublish?.()).then(message => {
        const status = document.querySelector<HTMLElement>("#save-status");
        if (status && message) status.textContent = message;
      });
      return;
    case "open-content-editor":
      saveWorkspace();
      syncDraft();
      mountOptions?.onBack();
      return;
    case "assign-to-set":
      saveWorkspace();
      mountOptions?.onAssign?.();
      return;
    case "open-transfer": document.querySelector<HTMLDialogElement>("#transfer-dialog")?.showModal(); return;
    case "export-active": exportActive(); return;
    case "export-package": exportPackage(); return;
    case "bridge-sign-out":
      getBridgeActions()?.signOut();
      return;
    case "open-content-picker": {
      const picker = document.querySelector<HTMLDialogElement>("#content-picker-dialog");
      if (picker && typeof picker.showModal === "function") picker.showModal();
      else picker?.setAttribute("open", "");
      return;
    }
    case "close-content-picker": {
      const picker = document.querySelector<HTMLDialogElement>("#content-picker-dialog");
      if (picker && typeof picker.close === "function") picker.close();
      else picker?.removeAttribute("open");
      return;
    }
    case "delete-active": {
      const dialogue = currentDialogue();
      const quest = currentQuest();
      const army = currentArmy();
      const campaign = currentCampaign();
      deleteCandidate = dialogue ? { type: "dialogue", key: dialogue.key } :
        quest ? { type: "quest", key: quest.key } : army ? { type: "army", key: army.key } : campaign ? { type: "campaign", key: campaign.key } : null;
      document.querySelector<HTMLDialogElement>("#confirm-dialog")?.showModal();
      return;
    }
    case "toggle-sidebar": {
      if (window.innerWidth <= 900) {
        const sidebar = root!.querySelector<HTMLElement>(".sidebar");
        setMobileSidebarOpen(!(sidebar?.classList.contains("is-open") ?? false));
      } else {
        sidebarCollapsed = !sidebarCollapsed;
        root!.querySelector<HTMLElement>(".app-layout")?.classList.toggle("is-sidebar-collapsed", sidebarCollapsed);
        const sidebarToggle = root!.querySelector<HTMLButtonElement>(".sidebar-collapse-button");
        if (sidebarToggle) {
          sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
          sidebarToggle.setAttribute("aria-label", sidebarCollapsed ? "Show sidebar" : "Collapse sidebar");
          sidebarToggle.title = sidebarCollapsed ? "Show sidebar" : "Collapse sidebar";
          sidebarToggle.textContent = sidebarCollapsed ? "›" : "‹";
        }
      }
      persistEditorSession();
      return;
    }
  }
}

root.addEventListener("input", event => {
  const element = event.target;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element instanceof HTMLInputElement && element.dataset.campaignQuestFilter) {
      const query = element.value.trim().toLocaleLowerCase();
      const selector = element.dataset.campaignQuestFilter === "floor"
        ? ".campaign-floor-quest-options .campaign-quest-chip"
        : ".campaign-quest-pool-list .campaign-quest-row";
      root!.querySelectorAll<HTMLElement>(selector).forEach(row => {
        row.hidden = !row.textContent!.toLocaleLowerCase().includes(query);
      });
      return;
    }
    bindField(element);
  }
});

root.addEventListener("keydown", event => {
  if (editorMode !== "guided" || event.key !== "Enter" || event.isComposing || event.shiftKey) return;
  const element = event.target;
  if (element instanceof HTMLTextAreaElement) {
    event.preventDefault();
    focusNextGuidedField(element);
    return;
  }
  if (!(element instanceof HTMLInputElement) || ["checkbox", "radio", "file", "button", "submit"].includes(element.type)) return;
  event.preventDefault();
  focusNextGuidedField(element);
});

root.addEventListener("change", event => {
  const element = event.target;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
  if (element instanceof HTMLSelectElement && element.id === "army-unit-picker") {
    syncArmyLevelPicker(element.value);
    return;
  }
  if (element instanceof HTMLSelectElement && element.id === "army-level-picker") { updateArmyEntityPreview(); return; }
  if (element instanceof HTMLSelectElement && element.id === "army-spell-picker") { updateArmyAbilityPreview(element.id, "spells", "army-spell-preview"); return; }
  if (element instanceof HTMLSelectElement && element.id === "army-blessing-picker") { updateArmyAbilityPreview(element.id, "blessings", "army-blessing-preview"); return; }
  if (element instanceof HTMLSelectElement && element.id === "army-curse-picker") { updateArmyAbilityPreview(element.id, "curses", "army-curse-preview"); return; }
  if (element instanceof HTMLSelectElement && element.id === "army-unit-spell-picker") { updateArmyAbilityPreview(element.id, "spells", "army-unit-spell-preview"); return; }
  bindField(element);
  if (element.dataset.rerender === "true" || element instanceof HTMLInputElement && element.type === "checkbox") {
    if (editorMode === "guided" && element instanceof HTMLSelectElement) prepareGuidedFocusAfterChange(element);
    render();
  } else if (editorMode === "guided" && element instanceof HTMLSelectElement) {
    focusNextGuidedField(element);
  }
});

root.addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (suppressArmyClick && target.closest("[data-army-placement]")) {
    suppressArmyClick = false;
    event.preventDefault();
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-action]");
  if (button) { onAction(button); return; }
  if (target.closest("[data-campaign-port]")) return;
  const route = target.closest<SVGElement>("[data-campaign-route-id]");
  if (route) {
    selectedCampaignRouteId = route.getAttribute("data-campaign-route-id");
    render();
    return;
  }
  const canvas = target.closest<HTMLElement>("[data-campaign-canvas]");
  if (!canvas || campaignInteractionMode !== "add") return;
  const rect = canvas.getBoundingClientRect();
  const snap = Number(canvas.dataset.snap ?? 146);
  const x = Math.round((event.clientX - rect.left - Number(canvas.dataset.offsetX ?? 0)) / snap);
  const y = Math.round((event.clientY - rect.top - Number(canvas.dataset.offsetY ?? 0)) / snap);
  handleCampaignCell(x, y);
});

root.addEventListener("pointerdown", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const armyPlacement = target.closest<HTMLElement>("[data-army-placement]");
  if (armyPlacement && event.button === 0 && armyPlacement.dataset.placementId) {
    armyDragDraft = { placementId: armyPlacement.dataset.placementId, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, dragging: false };
  }
  const port = target.closest<HTMLElement>('[data-campaign-port="output"]');
  if (!port || campaignInteractionMode === "add") return;
  pendingCampaignPlugFromId = port.dataset.nodeId ?? null;
  if (!pendingCampaignPlugFromId) return;
  selectedCampaignRouteId = null;
  port.closest<HTMLElement>("[data-campaign-node]")?.classList.add("is-route-source");
  event.preventDefault();
  updateCampaignPlugDraft(event.clientX, event.clientY);
});

root.addEventListener("pointermove", event => {
  if (armyDragDraft && armyDragDraft.pointerId === event.pointerId) {
    if (!armyDragDraft.dragging && Math.hypot(event.clientX - armyDragDraft.startX, event.clientY - armyDragDraft.startY) > 6) {
      armyDragDraft.dragging = true;
      root!.querySelector("[data-army-grid]")?.classList.add("is-army-dragging");
    }
    if (armyDragDraft.dragging) {
      root!.querySelectorAll(".army-grid-cell.is-drop-target").forEach(cell => cell.classList.remove("is-drop-target"));
      root!.querySelectorAll(".army-grid-placement.is-swap-target").forEach(placement => placement.classList.remove("is-swap-target"));
      const cell = armyCellAtPoint(event.clientX, event.clientY);
      if (cell) {
        const occupant = armyPlacementAtCell(cell.x, cell.y, armyDragDraft.placementId);
        if (occupant) {
          Array.from(root!.querySelectorAll<HTMLElement>("[data-army-placement]")).find(placement => placement.dataset.placementId === occupant.id)?.classList.add("is-swap-target");
        } else {
          root!.querySelector<HTMLElement>('[data-army-cell][data-x="' + cell.x + '"][data-y="' + cell.y + '"]')?.classList.add("is-drop-target");
        }
      }
    }
  }
  if (pendingCampaignPlugFromId) updateCampaignPlugDraft(event.clientX, event.clientY);
});

document.addEventListener("pointerup", event => {
  const armyDraft = armyDragDraft;
  if (armyDraft && armyDraft.pointerId === event.pointerId) {
    armyDragDraft = null;
    root!.querySelector("[data-army-grid]")?.classList.remove("is-army-dragging");
    root!.querySelectorAll(".army-grid-cell.is-drop-target").forEach(cell => cell.classList.remove("is-drop-target"));
    root!.querySelectorAll(".army-grid-placement.is-swap-target").forEach(placement => placement.classList.remove("is-swap-target"));
    if (armyDraft.dragging) {
      suppressArmyClick = true;
      window.setTimeout(() => { suppressArmyClick = false; }, 0);
      const cell = armyCellAtPoint(event.clientX, event.clientY);
      if (cell) moveArmyPlacementTo(armyDraft.placementId, cell.x, cell.y);
    }
  }
  const fromNodeId = pendingCampaignPlugFromId;
  if (!fromNodeId) return;
  const target = event.target;
  const port = target instanceof Element ? target.closest<HTMLElement>('[data-campaign-port="input"]') : null;
  const toNodeId = port?.dataset.nodeId ?? null;
  pendingCampaignPlugFromId = null;
  clearCampaignPlugDraft();
  if (!toNodeId) return;
  if (fromNodeId === toNodeId) {
    showToast("Drop the plug on a different node.", "warning");
    return;
  }
  connectCampaignPlugs(fromNodeId, toNodeId);
});

root.addEventListener("keydown", event => {
  const target = event.target;
  if (!(target instanceof Element) || !target.matches("[data-campaign-route-id]") || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  selectedCampaignRouteId = target.getAttribute("data-campaign-route-id");
  render();
});

root.addEventListener("dragstart", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-campaign-port]")) { event.preventDefault(); return; }
  const node = target.closest<HTMLElement>("[data-campaign-node]");
  if (!node || !event.dataTransfer) return;
  event.dataTransfer.setData("text/plain", node.dataset.nodeId ?? "");
  event.dataTransfer.effectAllowed = "move";
});

root.addEventListener("dragover", event => {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest("[data-campaign-canvas]")) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

root.addEventListener("drop", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const canvas = target.closest<HTMLElement>("[data-campaign-canvas]");
  const nodeId = event.dataTransfer?.getData("text/plain");
  if (!canvas || !nodeId) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const snap = Number(canvas.dataset.snap ?? 146);
  const x = Math.round((event.clientX - rect.left - Number(canvas.dataset.offsetX ?? 0)) / snap);
  const y = Math.round((event.clientY - rect.top - Number(canvas.dataset.offsetY ?? 0)) / snap);
  moveCampaignNodeTo(nodeId, x, y);
});

root.addEventListener("change", event => {
  const element = event.target;
  if (element instanceof HTMLInputElement && element.id === "transfer-file" && element.files?.[0]) {
    void importFile(element.files[0]);
  }
});

window.addEventListener("beforeunload", () => { saveWorkspace(); persistEditorSession(); });


