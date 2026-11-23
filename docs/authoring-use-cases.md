# MeowEdit authoring use cases (definitive)

This is the single authoring checklist. It merges the v1 workflow overview with the v2 set-based layout. For each job it records the **Guided path** (focused, 1–2 inputs per step), the **Advanced path** (all fields, section jumps, stable IDs), and the **current implementation status** against the v2 screens. `docs/content-contract-v2.md`-style field rules live in the contract doc; this file is about *how an author gets work done*.

Status legend: **[done]** works in the current build · **[partial]** data/field exists but the UX is degraded · **[missing]** not built yet.

## 1. Where work happens in v2

- **Content sets** browser: create / rename / open / (admin-gated) delete a set. Badges show Local only / Draft vN / Published.
- **New set** → 5-step guided wizard: Set details → Campaign → Board character → Content → Review & publish.
- **Open set** → per-category list (Campaigns / Quests / Armies / Dialogues) with Add / Edit / Remove.
- **Edit entry** → category editor with a **Raw fields** tab for full structured fields, stable IDs and registry parameters.
- **Save / Upload** creates or updates a private draft in Neon; **Publish** makes it the latest public revision and warns that tester progress resets.
- **Help** toggle reveals `.help-copy` hints; **version** and **Sign out** sit top-right.

## 2. Personas and editing jobs

- **Focused author** — Guided path only; unrelated controls stay folded or hidden.
- **Quick editor** — opens an existing entry, changes one value in Advanced, returns to the list.
- **Systems author** — needs IDs, availability, progress rules, effects, routes and extension fields; lives in Raw fields / Advanced.
- **Campaign author** — chooses generated-only vs custom/mixed; only relevant steps appear.
- **Reviewer** — needs readable summaries of configured values plus validation before Publish.

Core jobs: create without manual IDs, continue a draft, make a narrow edit, build related content without losing context, check the result, publish.

---

## 3. Global jobs

| # | Use case | Guided path | Advanced path | Status |
|---|---|---|---|---|
| G1 | Create a content set | **+ New set** → 2 fields per step → Review | Set ID and name editable in set details | **[done]** |
| G2 | Rename / delete a set | Rename button; Delete only for admin | — | **[done]** rename; **[partial]** delete (backend flag/route pending) |
| G3 | Browse authored work | Set browser list with status badges | — | **[done]** |
| G4 | Continue a draft after reload | Session restores last set, category, entry, step, Help | — | **[done]** for set/category/entry; **[partial]** nested return stack |
| G5 | Save without publishing | **Save / Upload** → Draft vN | Same button in set list | **[done]** |
| G6 | Publish | **Publish** → warning → hash verification | Same | **[done]** |
| G7 | Validate before publish | Grouped validation panel with hints, suggestions, "Use …" / "Apply fixes" / "Open entry" | Same panel | **[done]** for schema/refs/enums/campaign graph rules; **[partial]** no full v1 dialogue/quest rule set |
| G8 | Get help | Help toggle reveals field hints | Same toggle | **[done]** |
| G9 | Import / export JSON or ZIP | — | — | **[missing]** (deliberately replaced by Neon drafts + publish) |
| G10 | Static examples | — | — | **[missing]** (removed; live published sets are the reference) |
| G11 | Toasts / save indicator | Toast region, "saved locally" in session | Same | **[done]** |
| G12 | Mode/step keyboard flow (Enter advances, focus first field) | — | — | **[done]** (Shift+Enter keeps newlines in text areas) |

---

## 4. Dialogue jobs

| # | Use case | Guided path | Advanced path (Raw fields) | Status |
|---|---|---|---|---|
| D1 | Create a dialogue | Add dialogue → name + optional ID → first moment auto-created | `sequenceId`, `startNodeId` | **[done]** |
| D2 | Name / rename a moment | Node list → selected node → Headline | `nodes.N.*.headline` | **[done]** |
| D3 | Pick a speaker | Speaker picker from capability unit IDs; display name | `speakers.S.unitId`, `displayName`, `side`, `mood` | **[partial]** unit + name; **missing** side/mood in guided, roster-driven level labels |
| D4 | Write lines | Lines list → Add line → text | `segments.I.text`, `speakerIds` | **[done]** |
| D5 | Add choices | Choices list → label + target + outcome | `actions.A.{label,targetNodeId,decision.*}` | **[partial]** no default-Continue affordance or reserved-destination copy |
| D6 | See the conversation structure | Moment map with node cards, routed lines, zoom and choice connections | — | **[done]** (no free-form node dragging) |
| D7 | Preview in game composition | Preview pane with speaker portraits, headline, lines and clickable choices + Start over | — | **[done]** (mood-specific art not yet) |
| D8 | One-time decisions / outcomes | — | `decision.id/label/outcomeId/outcomeLabel` | **[partial]** fields exist, no dedicated decision box |
| D9 | Switch guided ↔ advanced without losing selection | Guided editor ↔ Raw fields tab | — | **[done]** |
| D10 | Dialogue-specific validation | Validation panel on review | Same | **[partial]** start-node check only |

---

## 5. Quest jobs

| # | Use case | Guided path | Advanced path (Raw fields) | Status |
|---|---|---|---|---|
| Q1 | Create a quest | Add quest → Basics → Objective → Quest Giver → Offer → In Progress → Reward → Review | `definition.id/title/...` | **[done]** 7 guided steps |
| Q2 | Basics / source / availability | Basics step: title, ID, description (foldout) | `sourceKind`, `sourceSlot`, `firstFloor`, `repeatEveryFloors`, `priority` | **[partial]** guided lacks source/availability; fields in Raw |
| Q3 | Objective-specific forms | Objective step shows fields for the chosen kind (Fetch items, Battle targets, Kill Count, Escort, Clear Floor, Timer) | Same fields plus distance rules | **[done]** |
| Q4 | Fetch items with counts | — | `fetchItems.I.{id,displayName,count}` | **[partial]** rows only |
| Q5 | Battle targets + Army handoff | — | `battleTargets.I.armyId` | **[missing]** create/edit Army in context and return |
| Q6 | Quest giver and writing | Quest Giver → Offer → In Progress steps with text areas | `speakerUnitId`, `speakerName`, `offerText`, `activeText`, `acceptLabel`, `declineLabel` | **[done]** |
| Q7 | Reward configuration | Objective step: reward kind; foldout amount | `rewardKind`, `rewardAmount`, `rewardContentId` | **[done]** |
| Q8 | Dialogue links | Dialogue links step: offer + active; foldout completion/failure | four link slots | **[done]** |
| Q9 | Dialogue create/edit handoff | — | — | **[missing]** return-to-slot stack |
| Q10 | Timer project | — | `timer.*`, `paymentCompletesImmediately` | **[partial]** fields exist, no dedicated progress UI |
| Q11 | Completion effects | — | `completionEffects` rows | **[partial]** add/remove but no scope/kind UX |
| Q12 | Minimum node distances | — | `minimumNodeDistances` rows | **[partial]** no disclosure or guided entry |
| Q13 | Review before publish | Review step: title, objective, reward, link count | Full Raw fields | **[partial]** no concrete readable summary of targets/effects |

---

## 6. Army jobs

| # | Use case | Guided path | Advanced path (Raw fields) | Status |
|---|---|---|---|---|
| A1 | Create / name an Army | Add Army → Name → Choose Units → Arrange Grid → Army Spells → Blessings → Review (opens the guided editor immediately) | `id`, `name` | **[done]** |
| A2 | Pick units from catalogs | Choose Units step: unit select + lineup + add/remove | `units.I.unitId` | **[done]** levels come from the capability catalog; buildings are not exposed in v2 |
| A3 | Preview unit stats before adding | Choose Units step shows catalog description, footprint and stats | — | **[done]** portrait still omitted |
| A4 | Arrange formation | Arrange Grid step: click-to-place/remove, grid grows beyond 5 | `units.I.{x,y}` | **[partial]** footprint shown but not enforced; no drag/swaps |
| A5 | Per-entry spells | Choose Units step: per-lineup spell picker with remove chips | `units.I.spellIds` | **[done]** |
| A6 | Army-wide spells / blessings / curses | Add buttons in rich editor | `spellIds`, `blessingIds` | **[partial]** no tabs, filters, previews or chips |
| A7 | Cell-target focus (boon/bane, lanes, locked) | Blessings step → Configure cells overlay with boon/bane grids, lane and Locked | `CellBlessingPicks` cells/lane/bool | **[done]** (game-specific cell rules are not interpreted) |
| A8 | Review lineup and loadout | — | — | **[missing]** review screen |
| A9 | Refresh game catalogs | — | — | **[done]** `npm run snapshot-army-catalog` / capabilities |

---

## 7. Campaign jobs

| # | Use case | Guided path | Advanced path (Raw fields) | Status |
|---|---|---|---|---|
| C1 | Create a campaign | Add Campaign → Name → Floors → Map → Node → Quests → Shops → Starting Run → Review | `id`, `name`, `description` | **[done]** |
| C2 | Choose approach (randomizer-only vs custom) | — | `settings.*` | **[missing]** designMode concept in v2 |
| C3 | Floors: add / select / remove / mode | Floor tabs + Add floor | `floors.F.{id,number,mode}` | **[partial]** no remove, no random-count controls in rich editor |
| C4 | Adventure map authoring | Map step: click empty cell to add selected node kind; click node to edit; Connect then click target | `floors.F.nodes.*` | **[partial]** no distance labels or plug dragging |
| C5 | Routes | Connect from a node, click neighbor; one-way toggle + Disconnect in Connections list | `floors.F.routes.*` | **[done]** adjacency/reachability validated |
| C6 | Focused node step | Node step: node picker, contextual fields, connect/remove | Raw fields | **[done]** |
| C7 | Node inspector by kind | Battle/Boss army+faction with Create Army; Quest with Create Quest; Reward; Shop offers | `armyId`, `questId`, `enemyFactionId`, `reward*`, `shopOffers` | **[done]** with return-to-campaign |
| C8 | Exact three shop offers | — | `shopOffers` rows | **[partial]** validation checks count, UI is generic rows |
| C9 | Quest pool + floor pools | Quests step: toggle chips for authored quests | `questIds`, `questPoolIds` | **[done]** (per-floor subset only in Advanced) |
| C10 | Shop pools + tiers | Shops step: pool checkboxes + floor tier | `shopPoolKinds`, `shopLevel` | **[done]** |
| C11 | Events | Rich Events list: ID + trigger + remove | conditions/actions parameters | **[partial]** no focused event screen, floor/node targeting or army handoff |
| C12 | Starting run / progression panels | Wizard set details + Raw fields | `settings.*` | **[partial]** no dedicated panels or conditional growth controls |
| C13 | Review every floor | Validation panel | Raw fields | **[partial]** no readable per-floor audit |
| C14 | Publish / revision | Publish in set list | Same | **[done]** |

---

## 8. Comparison checklist for implementation review

1. For each row above, open the named v2 screen and confirm **both** the Guided and Advanced column exist.
2. Anything marked **[partial]** must have the missing control either in the guided flow or in Raw fields with a clear label; if neither, it is **[missing]**.
3. New features must keep the set layout: no second editor page, no duplicate Save/Publish, one entry at a time.
4. Deprecated by the new layout (do **not** restore): ZIP import/export, static example import, PER-TYPE "publish to game" button, v1 localStorage workspace.
5. The interactive surfaces still worth porting natively (highest impact): dialogue moment map, game-faithful preview, army catalog/grid/cell-target focus, campaign snap map with plug drag, and related-record return contexts.

## 9. Workflow-to-test map

Current automated coverage lives in `tests/v2-contract.test.ts` (schema, registries, fixtures), `tests/v2-schema-agreement.test.ts` (JSON Schema ↔ zod), and `tests/v2-app.test.ts` (set browser, guided wizard, per-category lists, rich editors, raw fields, validation fixes, save/publish). Tests are the executable form of this checklist; rows marked **[missing]** have no test because the screen does not exist.
