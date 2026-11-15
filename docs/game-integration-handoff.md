# Game-side integration handoff

This is the follow-up plan for consuming MeowEdit-authored content in Meowdieval Kingdom. The editor repository intentionally does not modify or depend on the Unity project.

## Current state

- Dialogue JSON already supports nodes, left/right speakers, attributed text segments, and branching actions. The dialogue player does not persist a choice result.
- Adventure quest definitions are currently read from Resources/AdventureQuests/Definitions.json. The current DTO has Escort, Fetch, Battle, and ClearFloor objective values expressed as strings, fallback offer/active text, and rewards.
- Quest dialogue presentation currently uses the quest's text fields; authored sequence IDs are not yet connected to quest events.
- MeowEdit now exports version 1 campaign packages with floor-by-floor authored, random, or mixed Adventure boards, node routes, campaign Quest pools, per-floor random Quest pool overrides, run settings, and references to reusable Armies.
- MeowEdit now authors multi-item Fetch quests, KillCount objectives, multiple battle targets, army configurations, minimum node distances, dialogue decisions, and Timer project rules in versioned extension data. Existing runtime code ignores those extensions; authoring them does not make them playable by itself.

## Campaign package and standalone start flow

The editor can author and export campaigns, but the game still has no campaign catalog loader or standalone campaign start screen. Implement the runtime entry point before treating an exported campaign as playable:

1. Read `campaigns/Campaigns.json` from the MeowEdit ZIP/package manifest and validate campaign IDs, floor IDs/numbers, Quest/Army references, and the 30-node floor capacity. Preserve the current procedural Adventure path unchanged when no campaign is selected.
2. Add an Adventure campaign picker with name and description. Starting a campaign should initialize the run from its lives, Sardines, player faction, battle shop, and seeded map-generation settings, then persist the campaign ID and current floor in the run save.
3. Convert an authored floor's integer `Vector2Int`-style positions, node kinds, and routes into the existing `AdventureRunState` map. Start is `(0, 0)`; every route joins one of the eight neighboring cells; one-way routes retain direction. Validate that every node is reachable from Start and that the Boss sits beyond the Battle route.
4. For a mixed floor, keep every authored node and route fixed, then generate only the requested number and kinds of filler nodes into unoccupied neighboring cells. Add routes so each generated node is reachable without changing authored routes. If the constraints cannot be satisfied, report the floor and conflict rather than silently moving hand-authored nodes. Random floors continue to use `AdventureMapGenerator` with the floor's explicit totals.
5. For generated Quest nodes, select from the campaign pool or that floor's custom subset. For hand-placed Quest nodes, use the explicit Quest ID. Apply each Quest's floor eligibility and once-per-run/repeat rules before assignment.
6. Resolve Battle/Boss Army IDs through the package Army catalog and pass the chosen layout into the existing battle setup. Resolve faction and Reward content IDs against game catalogs; reject missing content during package validation.
7. After the last authored floor, either end the campaign or continue with generated floors according to `continueWithGeneratedFloors`, starting node count, and node growth settings.

The campaign JSON and package export are editor contracts only; the current game does not yet consume them. Mixed-floor filling needs focused generator tests around pinned positions, route locality, reachability, and cases where no valid placement remains.

## Deferred integration target: bridge repair

Bridge repair is a future game integration target only. It is not included in the editor's imported examples or starter workspace, and it is not playable until the behavior below exists in the game. The intended flow is:

1. The player accepts the quest and hears the bridge keeper's one-time choice dialogue.
2. Pay 15 Sardines now charges the player and finishes the repair immediately. The choice must be unavailable when the player cannot afford it.
3. Wait for three battles starts the repair timer. Any completed battle counts, whether it was won or lost. The Quest Log shows progress such as 0/3 battles.
4. When the timer completes, the game queues the bridge-repair event for the map return, plays its registered animation, and unlocks the already-authored locked route.
5. Both completion routes use the same idempotent completion handling, so the payment, reward, animation, and unlock cannot run twice after save/load.

When the feature is implemented, the editor can author the named pay-now and wait outcomes. The game should record the decision once for the run rather than exposing it as a plan field the player can repeatedly change.

## Implementation sequence

### 1. Add runtime data contracts and validation

- Add serializable DTOs for MeowEdit extension version 1: dialogue decision metadata, quest dialogue links, Timer project rules, progress counters, typed completion effects, multiple Fetch items, KillCount objectives, multiple battle targets, Army references/configurations, and minimum node-distance rules.
- Keep the existing quest and dialogue fields readable. Reject unsupported extension versions with a useful content error; do not silently treat a Timer objective as Battle.
- Validate unique IDs, decision references, dialogue node references, counter targets, costs, effect IDs, and quest-to-dialogue links when a package is loaded.
- Add a package loader that reads manifest.json, the current quest document, dialogue files, and extensions/meowedit-v1.json. Keep this behind Adventure content selection so the ordinary procedural Adventure flow still works.

### 2. Load reusable Army configurations

- Read Army configurations from the package and resolve unit, level, spell, and blessing IDs against game catalogs.
- Validate floor-sized grids, unique occupied cells, faction/catalog IDs, and references from quest battle targets.
- Pass the selected Army to the existing battle setup path for each configured Battle target.

### 3. Persist one-time dialogue decisions

- Extend the dialogue result or callback with the chosen action's decision ID and outcome ID.
- Store each decision once in run state and serialize it with existing Adventure save data.
- Pass the result back to the owning quest/system; keep the dialogue player responsible for presentation and choice reporting, not quest behavior.
- If content attempts to set the same decision again, reject or ignore it with a diagnostic instead of overwriting a player's earlier choice.

### 4. Add Timer project runtime state

- Track a project's started/completed state and counter value per quest instance in the Adventure run state.
- On the offer dialogue result, handle pay-now, wait, and any future outcomes explicitly.
- For payment, check Sardines before showing/enabling the option and charge exactly once. The pay-now route then enters the common completion path immediately.
- For waiting, subscribe to the battle-completed event and increment the configured counter for every finished battle. Persist after each increment.
- Surface progress in the Quest Log and give active/completed/failed projects the same focus and cleanup behavior as other quests.

### 5. Dispatch typed completion effects

- Add a small effect dispatcher for play-event, unlock-path, and unlock-shop-item.
- Resolve IDs through authored game catalogs, not arbitrary prefab or scene references in JSON.
- Queue map-only presentation until returning from battle. Run effects once, in stable order, and persist that they were applied.
- Make bridge-repair a registered event and bridge-shortcut a pre-authored locked path for the first playable integration.
- Leave new custom event IDs visible in validation and logs until a game-side handler is registered.

### 6. Link quest lifecycle to authored dialogues

- Replace the current text-only quest presenter lookup with an optional sequence ID for offer, active progress, completion, and failure.
- Fall back to offerText and activeText for old definitions or missing optional links.
- Keep dialogue result handling outside the reusable dialogue view; the quest owner consumes decision results and advances its own state.

### 7. Add the roster and dialogue portrait exporter

- Add a focused Unity Editor command that walks the same UnitCatalog used by the game and writes a versioned manifest of stable unit IDs, display names, factions, and supported moods.
- Reuse the existing unit preview/portrait capture path to export transparent portrait PNGs, preferably one per supported mood, without running the full trailer/store capture pipeline. MeowEdit composites these captures between the actual dialogue avatar frame layers.
- Write `portraitFile` for the fallback capture and `portraitFiles` for mood-specific captures; the MeowEdit importer turns those into local `portrait` and `portraitCaptures` entries. See [tools/README.md](../tools/README.md).
- In the MeowEdit repo, run node tools/import-unit-roster.mjs --input <export.json> --portraits <portrait-folder> to update the static roster and copy portraits under public/avatars/.
- Check in roster refreshes as explicit content updates; MeowEdit itself never scans the Unity checkout at runtime.

## Verification plan for the game repository

The game-side change should add focused EditMode and PlayMode coverage for:

- Reading old quest/dialogue files and new extension packages.
- A dialogue choice persisting one named outcome and refusing a second write.
- Pay-now: visible when affordable, disabled when not; cost charged once; bridge completed immediately.
- Wait: any completed battle increments once, a failed/won battle both count, progress survives reload, and completion occurs at the configured target.
- Completion event and path unlock happen once after return to the map, with no blocked map input.
- Missing dialogue/effect IDs produce a clear author error and use documented fallbacks where safe.
- The old procedural Adventure flow and existing quest types keep their current behavior.

Use the Unity project's documented CLI Coordinator workflow for those future tests. MeowEdit's browser app does not run Unity tests.
