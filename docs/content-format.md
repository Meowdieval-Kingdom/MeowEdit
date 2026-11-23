# MeowEdit content format (v1 — historical)

> **SUPERSEDED — do not implement from this document.** The single source of truth for the v2
> content contract is `C:\Users\ekkii\Projects\MeowdievalKingdom\Docs\WIP\MeowEdit-Content-Contract-V2.md`.
> It defines the structured authoring records, the generated runtime package, strict validation,
> named values, the capability snapshot and the HTTP payloads. This file is retained only as
> evidence of the v1 format that the migration must convert.

MeowEdit keeps authored content as ordinary JSON. It does not use Unity asset references or a server database.

## Scope and compatibility

The editor handles dialogue sequences, quests, reusable Army configurations, and campaigns. Meowdieval Kingdom loads version 1 packages copied into its `Resources/AdventureContent` catalog. The package is validated against the game's runtime catalogs before any campaign is offered; invalid content is rejected as a whole.

There is no static example import. Published v2 sets live in the game backend and appear in the editor's **Your content sets** list with a Published badge.

## Current game fields

Dialogue sequences use the game's version 1 shape:

- `sequenceId`, `startNodeId`, `pauseMode`, and `defaultCharactersPerSecond`
- ordered nodes with `id`, optional `headline`, and `textSpeed`
- up to two speakers, each assigned to the left or right avatar slot
- attributed segments; multiple speaker IDs in one segment represent unison
- actions with a label and target node; an empty target ends playback

Quest definitions retain the game's existing fields such as source kind, objective kind, floor availability, objective-specific IDs, fallback text, and reward values. A normal quest document remains shaped like:

```json
{
  "schemaVersion": 1,
  "quests": []
}
```

The game-supported objective values are Escort, Fetch, Battle, ClearFloor, Timer, and KillCount. Fetch requirements may contain multiple item IDs and quantities. Battle quests may define sequential targets and authored Army references. Timer projects can record a pay-or-wait dialogue outcome, charge Sardines once, count configured battle results, and apply their supported completion effects. KillCount checks recorded battle statistics against a configured unit or faction target.

## MeowEdit extensions

Version 1 quest extensions are stored under `meowEdit` in quest definitions and repeated in the package extension index. The game merges and cross-checks those copies during package loading; conflicts or unsupported extension data reject the package rather than silently changing objective behavior.

Quest extensions currently support:

- one or more Fetch item definitions;
- multiple Battle targets, each with a floor offset and an optional reference to a reusable Army ID;
- KillCount targets for an exact unit, units of a faction, or buildings of a faction;
- minimum hop distances between configured node kinds;
- offer, active, completion, and failure dialogue links;
- Timer project rules and typed completion effects.

Dialogue choice decisions store a named result alongside an action. The player-facing label and the game-side ID/outcome are authored independently. The game returns the selected result to the owning quest and persists timer-project outcomes in the run save.

## Army configurations

An Army has a stable ID and contains grid placements, spell IDs, blessing/curse IDs, and optional cell-target selections. Unit IDs use the game's `Faction/UnitName/level` catalog values; building IDs use the same format and can be placed in the same formation. MeowEdit reads unit/building levels, combat stats, descriptions, footprints and spell/blessing metadata from `public/army-catalog-lite.json`, a trimmed companion generated from the full `public/army-catalog.json` snapshot. The lite file keeps authoring previews and footprint-aware collision checks cheap; the Army export continues to store the catalog ID and grid anchor for each entry.

```json
{
  "schemaVersion": 1,
  "format": "meowedit-army",
  "army": {
    "id": "forest-ambush",
    "name": "Forest Ambush",
    "units": [{ "unitId": "Peasants/Archer/2", "x": 1, "y": 0 }],
    "spellIds": [],
    "blessingIds": []
  }
}
```

Army configurations are included in workspace JSON and ZIP packages. Campaign Battle/Boss nodes and ordered Quest battle targets can refer to these stable Army IDs. On run creation the game resolves the placements against its unit catalog and builds the authored encounter roster.

## Campaigns and Adventure floor graphs

A campaign groups reusable quests, authored floor graphs, random-floor rules, and run settings. A single campaign export is shaped like:

```json
{
  "schemaVersion": 1,
  "format": "meowedit-campaign",
  "campaign": {
    "id": "willow-road",
    "name": "The Willow Road",
    "description": "A short example campaign.",
    "questIds": ["lost-supplies"],
    "floors": [],
    "events": [
      {
        "id": "campaign-opening-army",
        "trigger": "campaign-start",
        "actions": [{ "kind": "replace-player-army", "armyId": "trail-guard" }]
      },
      {
        "id": "boss-preparation",
        "trigger": "before-battle",
        "floorNumber": 2,
        "nodeId": "f2-boss",
        "actions": [{ "kind": "replace-player-army", "armyId": "boss-party" }]
      }
    ],
    "settings": {}
  }
}
```

The editor remembers whether the author chose the **Randomizer settings only** or **Custom campaign** guided path in workspace metadata; it is not part of the game campaign document.

Each floor independently uses `authored`, `random`, or `mixed` mode. Authored and mixed floors store hand-placed nodes and routes. Random floors store a total node count and generated Quest/Shop counts. Mixed floors preserve their authored nodes/routes and request an additional count of generated filler nodes. A floor may inherit the campaign quest pool or choose a smaller pool for randomly assigned Quest nodes; manually assigned Quest nodes name a specific campaign quest.

Node `x` and `y` are signed integer Adventure grid coordinates, matching the game's `Vector2Int` positions. Start is at `(0, 0)`. A route may join any of the eight neighboring cells, including diagonals, and `oneWay: true` preserves direction. Graph validation checks unique occupied coordinates, reachable nodes, and a Boss beyond the Battle path. The visual editor is an open node canvas with a dotted snap lattice; it does not constrain a floor to a fixed tile board.

Node types are Start, Battle, Reward, Boss, Quest, and Shop. Battle/Boss nodes can reference an Army ID and enemy faction. Quest nodes reference a campaign quest ID. Reward nodes specify a reward kind, amount, and optional catalog content ID. Shop nodes default to generated stock or can define exactly three offers, each with a current catalog ID and a Sardines price. Floor node IDs and Army/Quest IDs are stable references in the exported package.

Campaign events have a stable `id`, a trigger (`campaign-start`, `before-battle`, `after-battle`, or `node-cleared`), and an ordered `actions` array. The first editable action is `replace-player-army`; its `armyId` refers to an Army configuration's stable ID from the same workspace package. `campaign-start` events are global. Other triggers can optionally scope to a `floorNumber` and then a `nodeId`; omitting both applies the trigger to all matching nodes, while setting only the floor scopes it to that floor. Battle triggers may target Battle or Boss nodes, and `node-cleared` cannot target Start.

Campaigns may set an optional `boardPreviewUnitId` to choose the character displayed as the player's map piece. It must resolve to a unit level in the game's catalog; an empty value uses the selected faction's default hero. This is presentation-only and does not alter the starting Army. Campaign settings include `factionSelectionEnabled`; when false, the campaign must name `playerFactionId` and the game uses that faction without showing a chooser. Missing values default to enabled for older campaign data. Other settings include starting lives, Sardines, initial random-floor node count, random Quest/Shop counts, node growth, the battle shop toggle, and whether generated floors continue after authored boards end. Generated Adventure map shops can draw from Units, Blessings, Research (unit unlocks), and Spell unlocks. Campaign settings select the general pools; each floor can inherit them or restrict its pools and set its shop tier from 1 to 4. The current Adventure run starts at tier 1, raises the tier with floor progression up to tier 4, and also supports a Shop level unlock reward. Authored, random, and mixed floors, fixed routes, quest pools, exact three-item shop stock, and campaign progression are loaded by the game.

## v1 ZIP package layout (historical)

Published v2 sets use the same closed file set below, but they are produced by the backend
`packContentSetV2`, signed, and identified by a canonical SHA-256 content hash. They are never
downloaded and re-imported by MeowEdit. The v1 ZIP described here is retained only for migration
evidence.

The workspace ZIP contains:

```text
meowdieval-content/
  manifest.json
  README.txt
  quests/Definitions.json
  armies/ArmyConfigurations.json
  campaigns/Campaigns.json (when campaigns are present)
  dialogues/<sequence-id>.json
  extensions/meowedit-v1.json
```

The manifest lists included files. Campaign nodes refer to IDs in the quest and army documents. Game fields remain in quest and dialogue documents; the extension index provides a convenient collection of quest logic, armies, and dialogue decision mappings. A ZIP uses uncompressed entries so the browser can import its own packages without another ZIP library.

## Browser storage and sharing

Local drafts are stored in localStorage, scoped to the signed-in account. Drafts themselves are never uploaded. **Save / Upload** stores a version-guarded draft on the server; **Publish** creates an immutable, validated revision for authorized accounts. The game never receives editor drafts. JSON/ZIP import and static example import were removed in v2; published sets are the live reference.

## Avatar and army catalogs

`public/unit-roster.json` contains stable Compendium character IDs, display names, factions, supported moods, and portrait paths. At runtime the editor adds every level form from `public/army-catalog-lite.json`'s `units` collection to dialogue and quest character pickers; its `buildings` collection is excluded. Level forms carry their own IDs, while the selected unit name remains the dialogue display-name default. The full `public/army-catalog.json` snapshot retains spells, blessings, mechanics and source fingerprints for integration checks; the editor never downloads it. Refresh catalogs from the Unity checkout with the npm snapshot commands. The editor never scans the game checkout at runtime.
