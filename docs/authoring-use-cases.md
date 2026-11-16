# MeowEdit authoring use cases

This document describes the author's end-to-end tasks across the Dialogue, Quest, Army, and Campaign editors. It is the workflow contract for the current static editor; the game-side loading and runtime behavior are tracked separately in [game integration handoff](./game-integration-handoff.md).

## Author personas and editing jobs

- **Focused author:** starts from a content type, writes or configures only the essentials, and wants unrelated controls out of view. Guided mode is the short, sequential path for this job.
- **Quick editor:** opens an existing entry to change one value, compare nearby settings, or make a correction. Advanced mode shows the complete record and has section links at the top so the author can jump straight to the relevant fields.
- **Systems author:** needs IDs, availability, progress rules, effects, routes, and extension fields. Advanced mode keeps these controls visible together; validation and export sit with the full record.
- **Campaign author:** can choose between generated settings only and a fully authored or mixed adventure. The campaign flow only exposes map, quest, and progression tasks that apply to the selected design.
- **Reviewer / integrator:** checks the authored content and references before export, and needs a readable summary of the actual configured values rather than just a pass/fail badge.
- **Teammate handing off work:** shares a JSON record or workspace ZIP. Drafts currently live in one browser's local storage; MeowEdit does not provide shared accounts, live collaboration, or conflict merging.

The core authoring jobs are distinct: create a new thing without manual identifiers, continue an existing draft, make a narrow edit without stepping through a wizard, build related content without losing the parent context, check the result, and export it for the game or another teammate.

## Workspace and examples

1. Open an empty workspace or choose **Import examples** to add the complete, currently usable game examples. Importing skips matching IDs instead of duplicating records.
2. Create a Dialogue, Quest, Army, or Campaign from the workspace. Existing entries can be selected, edited, exported, or removed from their list.
3. Drafts autosave in this browser. Import accepts supported JSON and MeowEdit ZIP packages; export downloads one selected JSON record or the workspace package.
4. Removing the imported examples reverses that explicit import and keeps user-authored records.

## Dialogue: write and branch a conversation

1. Create a dialogue. Its stable conversation ID is generated; the first moment defaults to **Moment 1** and may be renamed optionally.
2. Add or select a moment in the graph. The graph stays visible as structural context while the selected moment is edited below it.
3. Pick any Compendium character or any Army catalog unit/upgrade form for each speaker slot. Level labels distinguish upgrades in the picker while the game unit name fills in as the editable dialogue display name; buildings are not character choices. Choose left/right placement and a supported mood.
4. Write one or more text segments and attribute each segment to one or more speakers. Multiple speakers on a segment represent a shared/unison line.
5. A normal **Continue** action is always present when there are no explicit choices. Its visible label can be edited; authors do not configure whether a dialogue has a continue button. Add explicit choices only when the story needs a decision or branch.
6. Connect choices to moments, finish the dialogue, or close playback. Reserved destinations use consistent wording and explain their runtime effect. Connections can be inspected and rewired from the graph.
7. Preview the sequence in the game composition with the selected unit's captured portrait when available, step through its choices, and validate broken/missing destinations before exporting.
8. Switch between Guided and Advanced at any point. The selected dialogue and moment remain the same; Guided focuses the next writing task while Advanced exposes IDs, raw structure, and full controls.
9. In Advanced, assign named decision/outcome metadata and adjust stable node/action destinations. Guided is for narrative authoring and simple branches; decision-system fields are systems-author controls.

## Quest: configure an objective and its linked content

Guided segments this work into **Basics → Objective → Quest giver → Offer → In progress → Reward → Review**. Speaker selection and the two writing tasks each get their own screen; Advanced keeps the complete quest form together for quick corrections.

1. Create a quest and write its title, short description, and source.
2. Choose an objective. The form shows fields relevant to that objective rather than every field at once:
   - **Escort:** choose the escorted unit and its target.
   - **Fetch:** define one or more item requirements, each with a count.
   - **Battle:** define one or more battle targets, offsets, and optional Army references.
   - **Clear Floor:** define the target floor behavior.
   - **Kill Count:** specify a unit, faction, or faction's buildings and the count.
   - **Timer project:** define the player decision, counter/event rule, payment option, and completion effects.
3. Configure minimum node hops between relevant node types when placement constraints matter.
4. Optionally link offer, active, completion, and failure dialogue sequences. Create or edit a dialogue from the selected link and return to that same quest slot.
5. For a battle target, create or edit an Army in context and return to the same target. Add/remove targets without losing the quest draft.
6. Review concrete objective targets, reward, linked dialogue slots, spacing rules, completion effects, and any timer-project summary alongside validation, then export. Complex timer setup, dialogue links, and completion effects remain Advanced authoring fields; Guided review still reports what is configured. Fields beyond the current game schema are retained under the MeowEdit extension; an editor-exported extension is not playable until the game implements it.

## Army: build and revise a formation

1. Name the Army. The stable ID is generated automatically and stays in Advanced.
2. Choose entries from separate unit and building catalogs. Preview each level's description, combat stats, and grid footprint before adding it. Review a selected lineup entry in its own stats panel; replace or remove it here, and assign its per-entry spells.
3. Arrange the lineup on a separate battle-grid screen. The grid uses the selected floor size and each entry's full footprint. Select then click an open cell or drag an entry to move it; overlapping or out-of-bounds placements are rejected.
4. Add Army-wide spells, blessings, and curses on separate focused screens. Their current game descriptions, levels, costs, and curse-only status appear in the picker preview; unrelated Army context is dimmed while choosing.
5. When an assigned blessing or curse targets battle cells, open its focused battlefield view. Review the game's row/column rule and linked boon/bane effects; choose the lane for a picked-column effect or the exact fields for random-cell effects. Grid expansion blessings change the formation dimensions. Other cell rules preview their actual region and remain driven by the game's rule.
6. Review the lineup, Army-wide spells/blessings/curses, configured field targets, and each entry's assigned spells. Advanced remains available on each screen for stable IDs and the complete form. Save/export the Army for reuse by Quest targets or Campaign Battle/Boss nodes.

### Refresh game data

1. Run the local, git-ignored `tools/local/sync-game-data.ps1` against the sibling game checkout to compare units, spells, blessings, curses, and serialized mechanics with MeowEdit's checked-in snapshots.
2. Inspect new, removed, and changed catalog entries. Rerun with `-Detailed` to list changed IDs and fields, then rerun with `-Apply` to import reviewed snapshots. The helper stages its output outside the repo first and does not write the Unity project.

## Campaign: author a complete custom adventure

New campaigns first ask which job the author wants to do. **Randomizer settings only** skips authored maps, node editing, and campaign Quest setup until the author opts into Quest content. **Custom campaign** keeps the full authoring path.

### Set up the run

1. Create a Campaign and enter its name. The stable ID is generated automatically; manual ID overrides are available only in Advanced. Description remains optional.
2. Set up floors one at a time: add/select a floor, then choose authored, random, or mixed layout. Random node totals appear only when that floor mode uses them.
3. Use the Map step to place and connect the Adventure graph. A visible snap grid shows each node's coordinates and each route's distance in 8-direction map steps, including diagonal movement. Clicking a node or placing a new one opens a focused **Node** step; a compact, dimmed map stays above its active content form. Return to the map when done or continue to campaign quests.
4. Add reusable Quests to the campaign pool. A separate Floor pools step chooses whether random Quest nodes use the campaign pool or a narrower per-floor set.
5. Configure generated shops from the game's four offer pools—Units, Blessings, Research, and Spell unlocks—then set each floor's shop tier and inherited or restricted pools.
6. For a hand-placed Shop node, keep generated stock or switch to exactly three catalog items and set each Sardines price. The Node step focuses this form; Advanced keeps the same controls inside a collapsed Shop stock section.
7. Set player starting resources/faction, then set generated-floor counts and growth on their own steps. Advanced run settings and stable IDs remain available from Advanced mode.
8. Review every floor, its authored nodes and routes or generated counts, node Quest/Army/reward/shop references, campaign quest and shop pools, floor shop unlocks, starting run, progression rules, and validation; then export the campaign.

## Campaign: configure a randomizer without authored content

1. Create a Campaign and choose **Randomizer settings only**. The starter board becomes generated, campaign Quest counts are set to zero, and no authored nodes or Quest steps are shown.
2. Name the campaign, then set the generated node and Shop totals for each random floor. Add more floors; they start as generated floors too.
3. Choose the campaign-wide generated shop pools and set each floor's tier and pool overrides on separate focused screens.
4. Set starting lives, Sardines, faction, and battle shop rules on the separate Starting run screen.
5. Set whether generation continues and configure later floor growth on Progression. With continuation disabled, the detailed later-floor controls stay hidden.
6. Review every generated floor's node/Quest/Shop counts, shop tier and offer pools, starting run, progression rules, and validation; then export. The optional authored Quest disclosure stays closed unless generated Quest nodes are needed.
7. If the author changes a floor to Hand placed or Mixed, the workflow switches to the custom campaign path and exposes its map and node tasks.

### Build each floor

1. Add or select a floor. Choose **Authored**, **Random**, or **Mixed**:
   - **Authored** stores the complete hand-built node graph.
   - **Random** stores generator totals for nodes, Quest nodes, and Shops.
   - **Mixed** stores authored nodes/routes plus the desired generated filler counts.
2. For authored/mixed floors, use the Adventure-map coordinate canvas. It is an open node graph on a snap lattice, not a rectangular playable tile board. Coordinates align to the game's 8-direction map adjacency, including diagonals.
3. Add a node: choose its type, then click an empty snap position. The new node is selected and its inspector opens. Start and Boss are unique; Start remains at `(0, 0)`.
4. Move a node by dragging it. Occupied positions, the Start origin, and the supported map bounds are enforced with feedback. In Guided mode, clicking a node opens its focused Node step with the map dimmed above it. Remove it from that step; attached routes are removed with it.
5. Connect nodes by dragging a node's output plug to a neighboring node's input plug. Diagonal neighbors are allowed; new links are two-way by default. Click a route line to reveal its disconnect control, or open a connected node's **Connections** list to disconnect it or make it one-way. Invalid non-neighbor and duplicate routes produce feedback and do not add a route.
6. Configure the selected node in its focused Guided step (or the side inspector in Advanced):
   - **Battle/Boss:** choose a faction and optionally create/edit a reusable Army in context.
   - **Quest:** choose a Campaign quest or create one from this node. The newly created quest is added to the Campaign and assigned to this node on return.
   - **Reward:** choose a reward type, amount, and catalog content ID where applicable.
   - **Start/Shop:** edit the node label and graph position as needed.
7. Add reusable quests to the Campaign pool. For each floor, inherit the Campaign pool or choose a narrower custom subset for randomly assigned Quest nodes. Hand-assigned Quest nodes keep their specific Quest ID.
8. Repeat for later floors. Mixed floors retain authored placements and routes as fixed constraints while asking the game to generate filler; random floors contain no authored graph nodes.

### Validate and export

1. Review all floor modes and contents, generated node totals, quest pools, Army/Quest/reward references, starting run/progression settings, and validation issues.
2. Fix missing references, duplicate IDs/coordinates, unreachable nodes, invalid routes, and graph rules before export.
3. Export the Campaign JSON or a workspace ZIP containing campaign definitions plus referenced Quests, Armies, Dialogues, and a manifest.
4. The exported data is an editor/package contract. Starting a custom Campaign in Meowdieval Kingdom still needs the game-side loader, generator integration, and start flow in [game integration handoff](./game-integration-handoff.md).

## Context, modes, and recovery

- Guided and Advanced are available throughout content editing and edit the same draft. Guided hides stable IDs and detailed extension fields until needed. Advanced shows all fields for the selected record together; Dialogue and Army keep moment/placement-specific fields attached to the current selection. Every category has direct section links for quick edits.
- Opening a related Army, Quest, or Dialogue saves a return context. Returning restores the parent record, floor/node or quest target/link, and editor step. Nested paths such as Campaign → Quest → Army return through each parent in order.
- Browser drafts, selected editor mode, current step, selected Campaign floor/node or Army placement, and related-editor return paths persist across reloads in the same browser.
- Static guidance is hidden from the primary screens. Authors can toggle Help in Guided or Advanced to show field hints, workflow explanations, and interaction tips; the setting persists with the browser editor session.
- If a parent record is removed or its target no longer exists while a related editor is open, the return action cannot attach the child record; the author can still select another entry from the workspace.
- Validation and previews should be reachable from the content being authored rather than interrupting freeform text entry.

## Workflow-to-test map

| Authoring use case | Automated coverage |
| --- | --- |
| Dialogue moment, speaker, line, choice, decision, reserved Continue behavior | `tests/app.integration.test.ts`, `tests/dialogue-graph.test.ts`, `tests/view.test.ts` |
| Advanced quick edit: jump to any category's detailed fields without progressing a wizard | `tests/view.test.ts`, `tests/app.integration.test.ts` |
| Quest multi-item Fetch, Battle targets, Kill Count, minimum distance, dialogue/Army links | `tests/app.integration.test.ts`, `tests/validation.test.ts` |
| Army unit/building catalog, footprint collisions, guided steps, replacement, ability previews, and grid dragging | `tests/app.integration.test.ts`, `tests/army-domain.test.ts`, `tests/army-catalog.test.ts`, `tests/view.test.ts`, `tests/validation.test.ts` |
| Campaign randomizer-only path, custom/mixed/random floors, graph routes, focused node editing, node references, quest pools, shop pools, floor shop unlocks, exact shop prices, settings, review | `tests/app.integration.test.ts`, `tests/campaign-domain.test.ts`, `tests/validation.test.ts`, `tests/import-normalizers.test.ts`, `tests/view.test.ts` |
| Guided review details for Quest objectives/links/effects, Army per-entry spells, and every Campaign floor/settings | `tests/view.test.ts` |
| Direct plug connections, invalid/duplicate feedback, line and list disconnect, route direction, node movement, return context | `tests/app.integration.test.ts`, `tests/campaign-domain.test.ts`, `tests/editor-navigation.test.ts` |
| Examples, import/export, persistence, deletion and validation | `tests/app.integration.test.ts`, `tests/export-zip.test.ts`, `tests/import-normalizers.test.ts` |
| Restore editor mode, focused selection, and nested related-record return path after reload | `tests/editor-session.test.ts`, `tests/editor-navigation.test.ts`, `tests/app.integration.test.ts` |
| Toggle optional Help in Guided and Advanced and retain the preference | `tests/editor-session.test.ts`, `tests/view.test.ts`, `tests/app.integration.test.ts` |

Browser permissions, real filesystem download behavior, game execution of extension fields, and campaign runtime generation cannot be fully verified in jsdom. Package bytes/filenames are mocked in integration tests; game behavior has its own follow-up acceptance plan in the integration handoff.
