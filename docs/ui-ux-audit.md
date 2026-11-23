# MeowEdit UX review

## Design goal

MeowEdit serves two different editing jobs. **Guided is for authoring:** keep one next decision dominant, hide manual identifiers, and dim useful-but-inactive context during focused tasks. **Advanced is for editing:** show the complete selected record together, keep related controls grouped by purpose, and make a narrow correction possible without progressing through a wizard. Both modes edit the same draft and remain one action apart.

The interface should help a writer create without exposing the whole data model, while still letting a systems author or teammate make a quick, exact change. This review covers Dialogue, Quest, Army, Campaign, workspace navigation, recovery, and the handoff/export job.

Primary screens keep task names, field labels, authored data, and actionable status visible. Explanatory paragraphs, field hints, graph instructions, and workflow tips are optional Help copy, hidden by default and available from the Help control in either editor mode. The Help preference is stored with the browser editor session. Remove decorative category labels and repeated product labels when the section title already carries that meaning.

## Persona and use-case coverage

| Persona / job | Expected path | Review result |
| --- | --- | --- |
| Focused author creating content | Create from the workspace; enter the category's short Guided flow; preview/review; export | Covered in all four categories. Generated IDs stay out of Guided; Guided review shows configured values and references. |
| Quick editor changing one value | Select an existing item; switch to Advanced; use a section link; edit in place; autosave/validate | Addressed: all Advanced fields are now visible together, with section links on every category. |
| Systems author setting detailed rules | Use Advanced for IDs, availability, extension logic, graph structure, and catalog references; inspect validation | Covered by the complete forms and validators. Runtime support and manual package installation are described in the handoff docs. |
| Campaign author using only generation | Choose Randomizer settings only; set generated floors and run/progression values; review/export | Separate Guided path omits authored maps and quest setup unless the campaign actually uses them. |
| Campaign author building a custom adventure | Choose Custom; set each floor's mode; place/connect nodes; focus the selected node; set quest pools/run rules; review/export | Covered for authored, random, and mixed floors, including related Army/Quest creation. Review lists every floor, authored node/route references, generated counts, and run settings. |
| Author making linked content in context | Create/edit Army, Quest, or Dialogue from the owning node/target; return to the exact parent slot | Covered; the return path now survives refresh in the same browser. |
| Teammate continuing a draft | Sign in on another browser; version-guarded drafts are stored in the game backend | JSON/ZIP handoff was removed in v2. Live multi-user editing and merge/conflict handling are not product features today. |

## Guided flow contracts

| Category | Ordered Guided steps | Focus behavior and conditional work |
| --- | --- | --- |
| Dialogue | Optional moment name → Speaker → Lines → Choices → Preview | The graph remains as structural context and dims during writing. Continue is always available unless authored choices replace it. The moment name defaults to Moment N; IDs remain Advanced-only. |
| Quest | Basics → Objective → Quest giver → Offer → In progress → Reward → Review | Objective-specific fields appear only for the selected type. Speaker selection and each writing task have separate screens. Battle targets can open an Army in context. Extended dialogue links, timer rules, and completion effects remain in Advanced and are summarized at Review. |
| Army | Name → Choose units/buildings → Arrange grid → Army spells → Blessings → Review | Selection and placement are separate tasks. Full footprints, drag/drop, replacement, per-entry spells, selected stats, and focused wide-loadout screens are preserved. |
| Campaign | Choose approach → Name → conditional floor/map/node/quest tasks → run settings → progression → Review | Randomizer-only avoids map authoring by default. Node content opens in a focused screen with its graph dimmed; authored/mixed boards expose the graph and route tools. |

Guided focuses on the core creation path. Detailed system fields remain available in Advanced by design: Dialogue decision/outcome metadata; Quest timer-project configuration, authored dialogue links, and completion effects; stable IDs and raw references in every category. Quest Guided still supports objective-specific targets and minimum-distance rules. Review shows the stored complex values even when their editing controls are Advanced-only, so authors can spot an unexpected setting before export.

## Screen review and changes

| Screen | Finding | Change / contract |
| --- | --- | --- |
| Workspace | Create and browse jobs were mixed with editor detail in earlier iterations; the sidebar still had a redundant "AUTHORING WORKSPACE" label under the brand. | Start remains a small content chooser; the redundant label and category descriptions are removed; entries stay in the content picker and set/cloud controls live in the topbar. |
| Dialogue | Guided supports writing and branches, but Advanced previously hid fields behind the same step sequence. | Advanced now keeps sequence settings, selected moment, speakers, lines, choices, preview, and validation together. Its section links make a single-field correction direct. The graph remains above the selected moment's form. |
| Quest | Advanced hid detailed objective/progress/dialogue/effect values behind steps, making exact corrections slow; Guided grouped speaker selection and both quest messages on one screen and its review omitted saved rules. | Advanced now displays all eight sections together with direct links: details, objective, story, reward, dialogue, progress, effects, review. Guided separates speaker, offer text, and in-progress text. Guided review shows each objective type's target details, linked dialogue names, minimum distances, effects, and timer summary. |
| Army | Guided and Advanced already had different scopes, but Advanced required scrolling through a long mixed layout; Guided review omitted per-entry spell assignments. | Advanced has the same direct section navigation for basics, formation, lineup, and loadout. Unit/building stats and per-entry spells remain beside the selected entry; Guided review now lists spells for each lineup entry. |
| Campaign | The full form includes multiple independent tasks, and finding a specific setting required scrolling; Guided review only summarized the selected floor. | Advanced has direct links to basics, floors, map, quests, starting run, and progression. Guided hides irrelevant map and quest tasks for Randomizer-only designs. Review now lists every floor, authored nodes/routes and references, randomizer counts, quest pool, starting run, and progression. Stable node IDs are visible by default only in Advanced. |
| Related editor | The return stack was in-memory, so a refresh while building a linked record lost the path to its Campaign/Quest slot. | Editor mode, step, selected Campaign floor/node or Army placement, sidebar state, and related return stack now restore from local browser storage. |
| Copy and Help | Persistent tips and decorative editor labels competed with authored content. | Hide instructional copy until Help is enabled; retain task and field labels, authored data, validation, and actionable state. Provide Help in Guided and Advanced. |

## Section-navigation and focus rules

- Advanced sections use one shared, lightweight sticky jump bar across all four categories; the links target the actual section headings/content and are keyboard focusable.
- Guided flow keeps its compact progress/footer navigation and does not show the Advanced jump bar.
- Dialogue map and Campaign map remain visible as structural context. The selected record's detail fields stay in the primary editing surface.
- Quest offer and in-progress text each get a single writing screen; speaker selection has a separate preceding step. Objective configuration stays together because its target fields depend on the chosen objective; optional spacing rules are collapsed until requested.
- During focused sub-tasks, the context that would otherwise compete with the work is dimmed: Dialogue graph while writing, Army setup while choosing an army-wide loadout, Campaign map while editing a node, and unrelated Campaign controls while setting generation rules. Review screens switch back to a readable summary rather than dimming the data being checked.
- Remove, mode switching, and parent return actions remain available from their existing persistent workspace/editor controls; they do not take over the creative writing surface. Set/cloud actions are in the topbar.
- Switching modes does not mutate the draft. Advanced hides no stable IDs or extension sections behind a closed disclosure; Guided does not show IDs as required setup.

## Remaining product boundaries

- Browser storage belongs to one browser profile. Team members hand off files; there is no shared cloud workspace or concurrent-edit merge.
- The game consumes published, hash-verified revisions from the backend; the editor uploads version-guarded drafts and publishes explicitly. Package validation and save-pinned revision behavior are described in [game integration handoff](./game-integration-handoff.md) (historical) and the v2 contract.
- Automated test coverage is a regression floor and validates rendered DOM/workflows; it cannot guarantee visual legibility at every browser width or replace an in-game integration check.
- DOM tests cover navigation, data entry, context handoffs, and export structure. They cannot fully prove browser download behavior, multi-tab races, storage-quota recovery, or Unity runtime behavior; those need browser/game acceptance checks.

## Architecture note

The shared Advanced section navigation is implemented as one renderer helper so category-specific sections retain consistent jump behavior. Editor-session persistence is isolated in `editor-session.ts`; nested return-path validation lives in `editor-navigation.ts`. Domain rules remain split into Army, Campaign, Dialogue graph, import, export, and validation modules.

`main.ts` and `view.ts` still coordinate many category-specific events and templates. They are the remaining high-complexity files; future refactors should extract one category at a time behind the current domain/session boundaries and preserve the integration tests. The new Advanced layout does not add category-specific event paths.

The detailed end-to-end workflow and test mapping live in [authoring use cases](./authoring-use-cases.md).
