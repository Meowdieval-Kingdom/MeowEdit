import { dialogueActionsForNode, type ArmyRecord, type CampaignRecord, type DialogueRecord, type QuestRecord, type UnitRoster, type Workspace } from "./model";
import { createStoredZip, type ZipEntry } from "./zip";

const encoder = new TextEncoder();

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function safeName(value: string): string {
  return (value || "untitled").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function dialogueWithExtensions(record: DialogueRecord): object {
  return {
    ...record.sequence,
    nodes: record.sequence.nodes.map(node => {
      const {
        continueLabel: _continueLabel,
        continueTargetNodeId: _continueTargetNodeId,
        editorLabel: _editorLabel,
        editorPosition: _editorPosition,
        ...gameNode
      } = node;
      const isDefaultContinue = node.actions.length === 0;
      return {
        ...gameNode,
        actions: dialogueActionsForNode(record.sequence, node).map(action => {
          const meowEdit = {
            ...(action.decision ? { decision: action.decision } : {}),
            ...(isDefaultContinue ? { defaultContinue: true } : {})
          };
          return {
            label: action.label,
            targetNodeId: action.targetNodeId,
            ...(Object.keys(meowEdit).length > 0 ? { meowEdit } : {})
          };
        })
      };
    })
  };
}

function questWithExtension(record: QuestRecord): object {
  return {
    ...record.definition,
    meowEdit: record.extension
  };
}

function armyDocument(record: ArmyRecord): object {
  return {
    id: record.id,
    name: record.name,
    units: record.units.map(unit => ({ unitId: unit.unitId, x: unit.x, y: unit.y, spellIds: unit.spellIds ?? [] })),
    spellIds: record.spellIds,
    blessingIds: record.blessingIds,
    CellBlessingPicks: (record.cellBlessingPicks ?? []).map(pick => ({
      RootId: pick.rootId,
      Lane: pick.lane,
      Cells: pick.cells.map(cell => ({ x: cell.x, y: cell.y })),
      Locked: pick.locked,
      BaneCells: pick.baneCells.map(cell => ({ x: cell.x, y: cell.y }))
    }))
  };
}

function campaignDocument(record: CampaignRecord): object {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    questIds: record.questIds,
    floors: record.floors,
    settings: record.settings
  };
}

export function activeDialogueJson(record: DialogueRecord): string {
  return prettyJson(dialogueWithExtensions(record));
}

export function activeQuestJson(record: QuestRecord): string {
  return prettyJson({
    schemaVersion: 1,
    quests: [questWithExtension(record)]
  });
}

export function activeArmyJson(record: ArmyRecord): string {
  return prettyJson({ schemaVersion: 1, format: "meowedit-army", army: armyDocument(record) });
}

export function activeCampaignJson(record: CampaignRecord): string {
  return prettyJson({ schemaVersion: 1, format: "meowedit-campaign", campaign: campaignDocument(record) });
}

export function workspaceJson(workspace: Workspace): string {
  return prettyJson({
    format: "meowedit-workspace",
    schemaVersion: 1,
    quests: workspace.quests.map(record => ({
      ...questWithExtension(record),
      _meowEditWorkspace: {
        idAuto: record.idAuto === true,
        itemDisplayName: record.itemDisplayName ?? "",
        ...(record.isGameExample ? { isGameExample: true } : {})
      }
    })),
    armies: workspace.armies.map(record => ({
      ...armyDocument(record),
      _meowEditWorkspace: {
        idAuto: record.idAuto === true,
        previewFloor: record.previewFloor,
        units: record.units
      }
    })),
    campaigns: workspace.campaigns.map(record => ({
      ...campaignDocument(record),
      _meowEditWorkspace: { key: record.key, idAuto: record.idAuto === true, ...(record.designMode ? { designMode: record.designMode } : {}) }
    })),
    dialogues: workspace.dialogues.map(record => ({
      ...dialogueWithExtensions(record),
      _meowEditWorkspace: {
        sequenceIdAuto: record.sequenceIdAuto === true,
        ...(record.isGameExample ? { isGameExample: true } : {}),
        ...(record.exampleTitle ? { exampleTitle: record.exampleTitle } : {}),
        nodeNames: Object.fromEntries(record.sequence.nodes.flatMap(node =>
          node.editorLabel?.trim() ? [[node.id, node.editorLabel]] : []
        )),
        nodePositions: Object.fromEntries(record.sequence.nodes.flatMap(node =>
          node.editorPosition ? [[node.id, node.editorPosition]] : []
        ))
      }
    }))
  });
}

export function createPackageEntries(workspace: Workspace, roster: UnitRoster): ZipEntry[] {
  const root = "meowdieval-content";
  const questDefinitions = {
    schemaVersion: 1,
    quests: workspace.quests.map(questWithExtension)
  };
  const extensions = {
    schemaVersion: 1,
    quests: workspace.quests.map(record => ({
      questId: record.definition.id,
      ...record.extension
    })),
    armies: workspace.armies.map(armyDocument),
    dialogueDecisions: workspace.dialogues.flatMap(record =>
      record.sequence.nodes.flatMap(node =>
        node.actions.flatMap((action, index) => action.decision ? [{
          sequenceId: record.sequence.sequenceId,
          nodeId: node.id,
          actionIndex: index,
          ...action.decision
        }] : [])
      )
    )
  };
  const manifest = {
    format: "meowdieval-content-package",
    packageVersion: 1,
    editorVersion: "0.1.0",
    campaignsIncluded: workspace.campaigns.length > 0,
    campaignRuntimeSupported: false,
    files: {
      quests: "quests/Definitions.json",
      armies: "armies/ArmyConfigurations.json",
      ...(workspace.campaigns.length > 0 ? { campaigns: "campaigns/Campaigns.json" } : {}),
      dialogues: workspace.dialogues.map(record => "dialogues/" + safeName(record.sequence.sequenceId) + ".json"),
      extensions: "extensions/meowedit-v1.json"
    },
    rosterVersion: roster.rosterVersion
  };
  const files: ZipEntry[] = [
    { path: root + "/manifest.json", content: prettyJson(manifest) },
    { path: root + "/quests/Definitions.json", content: prettyJson(questDefinitions) },
    { path: root + "/extensions/meowedit-v1.json", content: prettyJson(extensions) },
    {
      path: root + "/README.txt",
      content: [
        "Meowdieval content package",
        "",
        "The quest and dialogue JSON files preserve the game’s current fields.",
        "Timer-project logic, kill counts, multiple fetch items, battle army references, and saved dialogue decisions use the versioned MeowEdit extension.",
        "The current game does not execute those extension fields yet; see docs/game-integration-handoff.md in the MeowEdit repository.",
        "Authored army configurations are stored as MeowEdit content and referenced from quest extensions; the current game runtime does not load them yet.",
        workspace.campaigns.length > 0
          ? "This package contains campaign boards, quest and dialogue content, and referenced army configurations. The current game still needs a campaign loader and start screen before the campaign can be played."
          : "This package contains quests, dialogues, and army configurations. It has no campaign definition.",
        ""
      ].join("\n")
    }
  ];
  for (const record of workspace.dialogues) {
    files.push({
      path: root + "/dialogues/" + safeName(record.sequence.sequenceId) + ".json",
      content: prettyJson(dialogueWithExtensions(record))
    });
  }
  files.push({ path: root + "/armies/ArmyConfigurations.json", content: prettyJson({ schemaVersion: 1, armies: workspace.armies.map(armyDocument) }) });
  if (workspace.campaigns.length > 0) {
    files.push({ path: root + "/campaigns/Campaigns.json", content: prettyJson({ schemaVersion: 1, campaigns: workspace.campaigns.map(campaignDocument) }) });
  }
  return files;
}

export function workspacePackage(workspace: Workspace, roster: UnitRoster): Blob {
  return createStoredZip(createPackageEntries(workspace, roster));
}

export function parseImportedJson(text: string): unknown {
  return JSON.parse(text);
}

export function decodeZipText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toZipFileBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function suggestedFilename(type: "dialogue" | "quest" | "army" | "campaign", id: string): string {
  return safeName(id) + (type === "dialogue" ? ".dialogue.json" : type === "quest" ? ".quest.json" : type === "army" ? ".army.json" : ".campaign.json");
}
