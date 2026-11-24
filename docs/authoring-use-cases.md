# MeowEdit authoring use cases (definitive)

This is the single authoring checklist. It merges the workflow overview with the structured set-based layout. For each job it records the **Guided path** (focused, 1–2 inputs per step), the **Advanced path** (all fields, section jumps, stable IDs), and the **current implementation status** against the structured screens. `docs/content-contract-structured.md`-style field rules live in the contract doc; this file is about *how an author gets work done*.

Status legend: **[done]** works in the current build · **[partial]** data/field exists but the UX is degraded · **[missing]** not built yet.

## 1. Where work happens in structured

- **Content sets** browser: create / rename / open / (admin-gated) delete a set. Badges show Local only / Draft vN / Published.
- **New set** → set ID and name prompts, then the set dashboard. All authoring happens in the single classic editor.
- **Open set** → per-category list (Campaigns / Quests / Armies / Dialogues) with Add / Edit / Remove.
- **Edit entry** → category editor with the **Full/Advanced** mode for full structured fields, stable IDs and registry parameters.
- **Save / Upload** creates or updates a private draft in Neon; **Publish** makes it the latest public revision and warns that tester progress resets.
- **Help** toggle reveals `.help-copy` hints; **version** and **Sign out** sit top-right.

## 2. Personas and editing jobs

- **Focused author** — Guided path only; unrelated controls stay folded or hidden.
- **Quick editor** — opens an existing entry, changes one value in Advanced, returns to the list.
- **Systems author** — needs IDs, availability, progress rules, effects, routes and extension fields; lives in Full/Advanced.
- **Campaign author** — chooses generated-only vs custom/mixed; only relevant steps appear.
- **Reviewer** — needs readable summaries of configured values plus validation before Publish.

Core jobs: create without manual IDs, continue a draft, make a narrow edit, build related content without losing context, check the result, publish.

---

## 3. Global jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| G1 | Create a content set | **+ New set** → ID and name prompts → set dashboard | Set ID and name editable in set details | **[done]** |
| G2 | Rename / delete a set | Rename button; Delete only for admin | — | **[done]** rename; **[partial]** delete (backend flag/route pending) |
| G3 | Browse authored work | Set browser list with status badges | — | **[done]** |
| G4 | Continue a draft after reload | Content session restores last set and Help; editor session restores mode, step and related-record return stack per set | — | **[done]** across the two local sessions |
| G5 | Save without publishing | **Save / Upload** → Draft vN | Same button in set list | **[done]** |
| G6 | Publish | **Publish** → warning → hash verification | Same | **[done]** |
| G7 | Validate before publish | Plain-language issue list in the set dashboard and editor | Same list | **[partial]** schema, refs, enums, campaign graph rules and dialogue structure are checked; no one-click fixes |
| G8 | Get help | Help toggle reveals field hints | Same toggle | **[done]** |
| G9 | Import / export JSON or ZIP | Hidden "Import / export JSON" control in the editor area | Same | **[done]** JSON/ZIP transfer; static examples were removed |
| G10 | Static examples | — | — | **[removed by design]** — live published sets are the reference |
| G11 | Toasts / save indicator | Toast region, "saved locally" in session | Same | **[done]** |
| G12 | Mode/step keyboard flow (Enter advances, focus first field) | — | — | **[done]** (Shift+Enter keeps newlines in text areas) |

---

## 4. Dialogue jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| D1 | Create a dialogue | Add dialogue → name + optional ID → first moment auto-created | `sequenceId`, `startNodeId` | **[done]** |
| D2 | Name / rename a moment | Node list → selected node → Headline | `nodes.N.*.headline` | **[done]** |
| D3 | Pick a speaker | Speaker picker from capability unit IDs, display name, side and mood | `speakers.S.unitId`, `displayName`, `side`, `mood` | **[done]** |
| D4 | Write lines | Lines list → Add line → text | `segments.I.text`, `speakerIds` | **[done]** |
| D5 | Add choices | Choices list → label + target + outcome + Default continue; moment-map Connect | `actions.A.{label,targetNodeId,decision.*}` | **[done]** |
| D6 | See the conversation structure | Moment map with node cards, routed lines, zoom and choice connections | — | **[done]** including persistent Drawflow node positions |
| D7 | Preview in game composition | Preview pane with speaker portraits, headline, lines and clickable choices + Start over | — | **[done]** including mood-specific portrait captures |
| D8 | One-time decisions / outcomes | Choice row exposes decision ID, label and outcome ID | `decision.id/label/outcomeId/outcomeLabel` | **[done]** |
| D9 | Switch guided ↔ advanced without losing selection | Guided editor ↔ Full/Advanced mode | — | **[done]** |
| D10 | Dialogue-specific validation | Validation panel: start node, duplicate IDs, empty headlines, broken choice targets | Same | **[done]** |

---

## 5. Quest jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| Q1 | Create a quest | Add quest → Basics → Objective → Quest Giver → Offer → In Progress → Reward → Review | `definition.id/title/...` | **[done]** 7 guided steps |
| Q2 | Basics / source / availability | Basics step: title, ID, description, source/floor/repeat foldout | `sourceKind`, `sourceSlot`, `firstFloor`, `repeatEveryFloors`, `priority` | **[done]** |
| Q3 | Objective-specific forms | Objective step shows fields for the chosen kind (Fetch items, Battle targets, Kill Count, Escort, Clear Floor, Timer) | Same fields plus distance rules | **[done]** |
| Q4 | Fetch items with counts | Objective step (Fetch): item rows, display name, count, add/remove | `fetchItems.I.{id,displayName,count}` | **[done]** |
| Q5 | Battle targets + Army handoff | Objective step → Create Army on a target, returns to the same target | `battleTargets.I.armyId` | **[done]** |
| Q6 | Quest giver and writing | Quest Giver → Offer → In Progress steps with text areas (auto-accept is in Full/Advanced) | `speakerUnitId`, `speakerName`, `offerText`, `activeText`, `autoAccept`, `acceptLabel`, `declineLabel` | **[done]** |
| Q7 | Reward configuration | Objective step: reward kind; foldout amount | `rewardKind`, `rewardAmount`, `rewardContentId` | **[done]** |
| Q8 | Dialogue links | Dialogue links step: offer + active; foldout completion/failure | four link slots | **[done]** |
| Q9 | Dialogue create/edit handoff | Review → Create Dialogue per slot, returns to the quest | — | **[done]** |
| Q10 | Timer project | Objective step chooses the objective; timer fields are in Full/Advanced Progress | `timer.*` | **[done]** |
| Q11 | Completion effects | Review → effect kind picker, target and author note | `completionEffects` rows | **[done]** |
| Q12 | Minimum node distances | Objective step → Advanced disclosure with from/to/hops rows | `minimumNodeDistances` rows | **[done]** |
| Q13 | Review before publish | Review step with concrete targets, reward, links, rules and effects | Full Advanced | **[done]** |

---

## 6. Army jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| A1 | Create / name an Army | Add Army → Name → Choose Units → Arrange Grid → Army Spells → Blessings → Review (opens the guided editor immediately) | `id`, `name` | **[done]** |
| A2 | Pick units from catalogs | Choose Units step: unit select + lineup + add/remove | `units.I.unitId` | **[done]** levels come from the capability catalog; buildings are not exposed in structured |
| A3 | Preview unit stats before adding | Choose Units step shows catalog description, footprint and stats | — | **[done]** with catalog portraits |
| A4 | Arrange formation | Arrange Grid step: click-to-place/remove, footprint collision check, grid grows beyond 5 | `units.I.{x,y}` | **[done]** including drag-to-move and drag-to-swap |
| A5 | Per-entry spells | Choose Units step: per-lineup spell picker with remove chips | `units.I.spellIds` | **[done]** |
| A6 | Army-wide spells / blessings / curses | Separate steps per category, All/Field filter, catalog previews and chips | `spellIds`, `blessingIds` | **[done]** with a dedicated curse catalog |
| A7 | Cell-target focus (boon/bane, lanes, locked) | Blessings step → Configure cells overlay with boon/bane grids, lane and Locked | `CellBlessingPicks` cells/lane/bool | **[done]** (game-specific cell rules are not interpreted) |
| A8 | Review lineup and loadout | Review step lists lineup, spells and blessings | — | **[done]** |
| A9 | Refresh game catalogs | — | — | **[done]** `npm run snapshot-army-catalog` / capabilities |

---

## 7. Campaign jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| C1 | Create a campaign | Add Campaign → Name → Floors → Map → Node → Quests → Shops → Starting Run → Review | `id`, `name`, `description` | **[done]** |
| C2 | Choose approach (randomizer-only vs custom) | Name step: approach buttons filter the step list | `settings.*` | **[done]** |
| C3 | Floors: add / select / remove / mode | Floor tabs, Add/Remove floor, layout mode and generated counts | `floors.F.{id,number,mode}` | **[done]** |
| C4 | Adventure map authoring | Map step: click empty cell to add node, click node to edit, Connect then click neighbor, distance labels | `floors.F.nodes.*` | **[done]** including plug dragging |
| C5 | Routes | Connect from a node, click neighbor; one-way toggle + Disconnect in Connections list | `floors.F.routes.*` | **[done]** adjacency/reachability validated |
| C6 | Focused node step | Node step: node picker, contextual fields, connect/remove | Advanced | **[done]** |
| C7 | Node inspector by kind | Battle/Boss army+faction with Create Army; Quest with Create Quest; Reward; Shop offers | `armyId`, `questId`, `enemyFactionId`, `reward*`, `shopOffers` | **[done]** with return-to-campaign |
| C8 | Exact three shop offers | Shop node offers: stock mode (generated/exact), pool, item, price, max 3 | `shopOffers` rows | **[done]** |
| C9 | Quest pool + floor pools | Quests step: toggle chips for authored quests | `questIds`, `questPoolIds` | **[done]** (per-floor subset only in Advanced) |
| C10 | Shop pools + tiers | Shops step: pool checkboxes + floor tier | `shopPoolKinds`, `shopLevel` | **[done]** |
| C11 | Events | Review events: ID, trigger, floor, node, remove | conditions/actions parameters | **[done]** (parameters in Advanced) |
| C12 | Starting run / progression panels | Starting Run step: board character, resources, faction, toggles, growth settings and per-campaign Sardine payout switch/base/per-floor | `settings.*`, `settings.sardinePayout*` | **[done]** |
| C13 | Review every floor | Review step lists each floor's mode, nodes, routes and shop tier | — | **[done]** |
| C14 | Publish / revision | Publish in set list | Same | **[done]** |

---

## 8. Comparison checklist for implementation review

1. For each row above, open the named structured screen and confirm **both** the Guided and Advanced column exist.
2. Anything marked **[partial]** must have the missing control either in the guided flow or in Advanced with a clear label; if neither, it is **[missing]**.
3. New features must keep the set layout: no second editor page, no duplicate Save/Publish, one entry at a time.
4. Deprecated by the new layout (do **not** restore): static example import and the per-type "publish to game" button.
5. The interactive surfaces implemented natively (highest impact): dialogue moment map, game-faithful preview, army catalog/grid/cell-target focus, campaign snap map with plug drag, and related-record return contexts.

## 9. Workflow-to-test map

Current automated coverage lives in `tests/content-contract.test.ts` (schema, registries, fixtures), `tests/content-schema-agreement.test.ts` (JSON Schema ↔ zod), `tests/content-app.test.ts` (set browser, set dashboard, save/publish, session), `tests/editor.test.ts` (all four editor screens and the cloud boundary), and the editor module tests under `tests/`. Tests are the executable form of this checklist.
