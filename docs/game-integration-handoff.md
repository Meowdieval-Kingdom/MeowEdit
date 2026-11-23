# MeowEdit content in Meowdieval Kingdom (v1 — historical)

> **SUPERSEDED — do not implement from this document.** In particular the manual ZIP install
> steps and the "save pinned to package revision" behaviour below are replaced by structured
> records in Neon, a generated immutable package, and content-hash save invalidation. The single
> source of truth is `C:\Users\ekkii\Projects\MeowdievalKingdom\Docs\WIP\MeowEdit-Content-Contract-V2.md`.

MeowEdit is the authoring tool; Meowdieval Kingdom is the runtime. They share one JSON contract for dialogue sequences, quests, Army configurations, and Adventure campaigns. In v2 the game downloads published revisions from the backend catalog by package ID and content hash; the manual ZIP install steps below apply only to historical v1 packages.

## What the game supports

The game reads a version 1 package with a manifest, quest and Army catalogs, campaign catalog, dialogue files, and the MeowEdit extension index. It validates the package as a whole against the Unity unit, faction, spell, blessing, quest, dialogue, route, and shop data. A malformed package or missing gameplay reference is excluded before the New Campaign selector; it is never offered as a partially playable campaign.

Supported authored content includes:

- Branching dialogue, speaker portraits, text segments, saved decision metadata, and quest-linked offer/progress/completion/failure sequences.
- Escort, Fetch, Battle, ClearFloor, Timer, and KillCount quest objectives. Fetch supports multiple item requirements; Battle supports ordered targets and authored armies.
- Timer pay-or-wait outcomes, one-time Sardines payment, configured battle counting, and the supported completion effects.
- Army formations with unit placements, per-unit and Army spells, blessings, and cell-target data.
- Authored, random, and mixed campaign floors, node routes, faction and run settings, generated quest/shop pools, exact shop stock, rewards, and campaign progression.
- An optional `boardPreviewUnitId` selects the player character shown on the Adventure map; an empty value uses the selected faction's default hero. It does not change the battle Army.
- Authored minimum route-hop constraints on fixed authored floors. These constraints are rejected for generated floors when the game could not guarantee them.

For a play-event completion effect, the game records its event ID on the run so a game-side system can consume it. It does not implicitly invoke an arbitrary animation or script from JSON. Unlock-path and unlock-shop-item effects resolve against the campaign route and supported shop catalogs.

## Install a package manually

1. In MeowEdit, validate and publish a content set. Dialogue-only sets are valid; game content needs at least one campaign.
2. Extract the contents of the ZIP's meowdieval-content folder into a new, uniquely named folder under:
   Assets/Meowdieval/Resources/AdventureContent/<immutable-revision>/
   Keep the package subfolders (manifest.json, quests, armies, campaigns, dialogues, and extensions) intact.
3. Add a reference for the revision to Assets/Meowdieval/Resources/AdventureContent/PackageIndex.json. Each entry has packageId, campaignSetId, isLatest, and resourcePath. The resourcePath points to the manifest without its .json extension, for example AdventureContent/<immutable-revision>/manifest.
4. Use a unique packageId for every content revision. Use the same campaignSetId for successive updates to the same campaign line. Set exactly one revision in that set to isLatest=true; mark older installed revisions false.
5. Let Unity import the JSON TextAssets, then run the game’s package tests or launch the game and confirm that the campaign appears. Runtime catalog errors explain why a package is rejected.

Do not overwrite an installed revision in place. The package hash is computed from its content files and is stored with a new run.

## Save and revision behavior

The campaign selector offers only the one valid latest revision per campaign set. Starting a new run stores both packageId and content hash in the save. Continuing resolves that exact pair, even if a newer revision has since been installed. The older revision therefore stays available for that save; it is not silently migrated to new maps, dialogue, or encounters.

Keep the old package folder and index entry while any saved run refers to it. Once no saves refer to that packageId/hash, remove its index entry and folder from the project. This cleanup is currently a deliberate content-maintenance step, not an automatic runtime deletion; never prune based solely on the latest flag.

## Editing an existing campaign

Export the revised content as a new immutable revision and copy it alongside the old one. Keep the same campaignSetId, set the new revision to latest, and set the prior revision to not-latest. Start a new run to use the new content. Existing runs continue against their pinned revision. If the new package fails validation, it will not replace the old playable option.

## Package review checklist

- The manifest declares campaign content and runtime support, and every listed file exists.
- IDs are unique and all quest, dialogue, Army, unit, faction, spell, blessing, reward, route, and shop references resolve.
- Each campaign has sequential floors with valid Start/Boss structure, reachable routes, supported floor modes, and enough room for generated nodes.
- Decision metadata in dialogue actions agrees with the extension index. Quest dialogue links point to included sequences.
- Every package revision has a unique packageId; each campaignSetId has exactly one latest revision.
- A package with any critical content error is rejected as a whole, before campaign selection.

## MeowEdit tests versus game tests

MeowEdit's Vitest suite tests the browser editor: authoring flows, validation, the native per-set workspace and the v2 package contract. It does not execute Unity.

Meowdieval Kingdom's Unity tests cover JSON package parsing and validation, runtime references, campaign option filtering, campaign map creation, Army-backed encounter rosters, exact shop offers, quest behavior, and save-pinned revisions. Gameplay-sensitive content changes should update both a MeowEdit authoring test and a Kingdom runtime test where applicable.

## Later hosted delivery

The Bridge requires a Neon Auth account before any editor workspace is loaded. A valid account grants authoring access; publishing requires a separate publisher allowlist entry enforced by the server. Uploaded packages are immutable drafts until an authorized author explicitly publishes them. The game catalog exposes only published revisions and is intentionally public/read-only; the build contains no upload credential. CORS limits browser origins but is not treated as authentication.
