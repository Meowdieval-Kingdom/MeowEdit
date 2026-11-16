# MeowEdit content format

MeowEdit keeps authored content as ordinary JSON. It does not use Unity asset references or a server database.

## Scope and compatibility

The editor handles dialogue sequences, quests, reusable Army configurations, and campaigns. The game currently reads the existing dialogue and quest fields, but does not load campaign packages or authored Army configurations, and does not execute MeowEdit-only extensions.

The checked-in **Import examples** library contains complete game dialogues and the currently supported quest objective types: Escort, Fetch, Battle, and ClearFloor. A new workspace is empty until the author imports those examples. Planned content such as the bridge-repair Timer quest is deliberately absent until the game-side behavior is implemented and usable.

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

The game-supported objective values are Escort, Fetch, Battle, and ClearFloor. Timer and KillCount are MeowEdit authoring types and need game-side implementation before they are playable.

## MeowEdit extensions

Future behavior is stored under `meowEdit` so the existing game fields remain intact. Older game readers can ignore unknown fields; they will not act on them until game integration is complete.

Quest extensions currently support:

- one or more Fetch item definitions;
- multiple Battle targets, each with a floor offset and an optional reference to a reusable Army ID;
- KillCount targets for an exact unit, units of a faction, or buildings of a faction;
- minimum hop distances between configured node kinds;
- offer, active, completion, and failure dialogue links;
- Timer project rules and typed completion effects.

Dialogue choice decisions store a named result alongside an action. The player-facing label and the game-side ID/outcome are authored independently; persistence and use of the result belong to the game runtime.

## Army configurations

An Army has a stable ID and contains grid placements, spell IDs, and blessing IDs. Unit IDs use the game's `Faction/UnitName/level` catalog values; building IDs use the same format and can be placed in the same formation. MeowEdit reads unit/building levels, combat stats, descriptions, prefab footprints, spell and blessing effect descriptions/costs, and floor grid sizes from `public/army-catalog.json`. Those snapshots support authoring previews and footprint-aware collision checks; the Army export continues to store the catalog ID and grid anchor for each entry.

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

Army configurations are included in workspace JSON and ZIP packages. Battle target references and army records are MeowEdit data until the game loads the package and resolves those IDs.

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
    "settings": {}
  }
}
```

The editor remembers whether the author chose the **Randomizer settings only** or **Custom campaign** guided path in workspace metadata; it is not part of the game campaign document.

Each floor independently uses `authored`, `random`, or `mixed` mode. Authored and mixed floors store hand-placed nodes and routes. Random floors store a total node count and generated Quest/Shop counts. Mixed floors preserve their authored nodes/routes and request an additional count of generated filler nodes. A floor may inherit the campaign quest pool or choose a smaller pool for randomly assigned Quest nodes; manually assigned Quest nodes name a specific campaign quest.

Node `x` and `y` are signed integer Adventure grid coordinates, matching the game's `Vector2Int` positions. Start is at `(0, 0)`. A route may join any of the eight neighboring cells, including diagonals, and `oneWay: true` preserves direction. Graph validation checks unique occupied coordinates, reachable nodes, and a Boss beyond the Battle path. The visual editor is an open node canvas with a dotted snap lattice; it does not constrain a floor to a fixed tile board.

Node types are Start, Battle, Reward, Boss, Quest, and Shop. Battle/Boss nodes can reference an Army ID and enemy faction. Quest nodes reference a campaign quest ID. Reward nodes specify a reward kind, amount, and optional catalog content ID. Shop nodes default to generated stock or can define exactly three offers, each with a current catalog ID and a Sardines price. Floor node IDs and Army/Quest IDs are stable references in the exported package.

Campaign settings include starting lives, Sardines, initial random-floor node count, random Quest/Shop counts, node growth, player faction, the battle shop toggle, and whether generated floors continue after authored boards end. Generated Adventure map shops can draw from Units, Blessings, Research (unit unlocks), and Spell unlocks. Campaign settings select the general pools; each floor can inherit them or restrict its pools and set its shop tier from 1 to 4. The current Adventure run starts at tier 1, raises the tier with floor progression up to tier 4, and also supports a Shop level unlock reward. Shop stock and floor pool overrides are authoring data; the game does not execute them until its campaign loader and start flow are implemented.

## ZIP package layout

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

Local drafts are stored in localStorage for the current browser profile. The app does not upload drafts. Import a MeowEdit JSON or ZIP to continue editing on another machine. Downloaded content is meant to be reviewed and copied into the game repository by the team.

## Avatar and army catalogs

`public/unit-roster.json` contains stable Compendium character IDs, display names, factions, supported moods, and portrait paths. At runtime the editor adds every level form from `public/army-catalog.json`'s `units` collection to dialogue and quest character pickers; its `buildings` collection is excluded. Level forms carry their own IDs and captured preview paths, while the selected unit name remains the dialogue display-name default. The Army catalog is generated from the game snapshot and also contains spells, blessings, and battle grid sizes. Refresh catalogs from the Unity checkout with the npm snapshot commands. The editor never scans the game checkout at runtime.
