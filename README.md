# MeowEdit

The browser authoring studio for Meowdieval content sets: campaigns, quests, armies and dialogues in one structured v2 document.

> **Contract:** the single source of truth is `C:\Users\ekkii\Projects\MeowdievalKingdom\Docs\WIP\MeowEdit-Content-Contract-V2.md`. The v1 local-only editor, ZIP workflow and "Import examples" flow have been removed. Sign-in is required, drafts autosave locally, uploading a draft and publishing a revision are separate explicit actions.

## Run locally

Install dependencies with `npm install`, start the editor with `npm run dev`, and create a production build with `npm run build`.

Run the automated suite with `npm test`; use `npm run test:coverage` for the HTML and terminal coverage reports. `npm run contract:check` verifies the authority hash, the strict JSON Schemas, hand-authored fixtures, and JSON Schema/zod agreement. The jsdom suite covers the sign-in gate, the set browser, guided authoring and the v2 validators. See [docs/testing.md](docs/testing.md).

The app is static HTML, CSS and TypeScript. Neon Auth handles sign-in; the game backend stores version-guarded drafts and published revisions. No credentials or publisher secrets are in the browser build. The set browser lists your backend sets with Local only / Draft vN / Published badges. **Save / Upload** creates or updates a private draft; **Publish** makes it the latest public revision for the set and warns that tester progress resets. The set view lists entries per category with Add / Edit / Remove; adding is guided, and editing opens one entry's advanced fields in the same page.

For local use, copy `.env.example` to `.env.local` (ignored by Git) and set `VITE_NEON_AUTH_BASE_URL` and `VITE_GAME_API_BASE_URL`. Neon Auth accounts must be provisioned by an administrator; there is no public sign-up. A valid account can author; uploading and publishing additionally require a server-side publisher allowlist entry.

## Demo and local artwork

Every raster image in `public/` is watermarked `DEMO` before it is published. `npm run build` checks every image against `public/demo-assets.manifest.json`; changed, missing, or newly added images stop the build until the demo copies and manifest are refreshed. Original local copies are kept in the ignored `.local-assets/source/` folder and are never included in the repository snapshot or Pages build.

The editor uses the demo images by default. To view local real artwork during development, run `npm run confirm-real-assets`, enter the asset folder path, and type `USE REAL ASSETS LOCALLY`. This creates an ignored local opt-in used only by `npm run dev`. Production builds always package the watermarked files from `public/`.

To refresh demo copies after changing local originals, put them under `.local-assets/source/` with the same folder structure and run `npm run watermark-demo-assets`, then build. Regenerating watermarks requires ImageMagick; normal builds and deployments do not.

## Editor scope

- **Content sets** are the unit of authoring and publishing: one set contains one or more campaigns plus shared quests, armies and dialogues.
- A **guided path** focuses on one or two fields per step (set details → campaign → board character → content → review); optional fields live in folded, dimmed "More options" areas.
- Each category opens in the restored **classic editor** — the original Drawflow dialogue map with game preview, the full quest and campaign editors, and the footprint-aware army grid with drag/swap placement. **Quick fields** offers a compact v2 field view, and **Advanced** exposes the full structured contract. Set/cloud controls (Save / Upload, Publish, Back to set, Sign out) sit in the classic topbar.
- Validation is grouped by category with plain-language explanations, suggested IDs and one-click fixes; dialogue-only sets are valid.
- The capability manifest (`public/game-capabilities.json`) drives pickers, strict validation and enum whitelists; `npm run snapshot-game-capabilities` regenerates it from the game checkout.

Meowdieval Kingdom reads published revisions through a public, read-only catalog and caches them locally. New runs use the latest published revision of each set; a started run stays pinned to its package ID and content hash. Bundled v1 packages still require manual `PackageIndex.json` registration in the Unity project; published v2 sets do not.

## GitHub Pages

The project is prepared for a public GitHub Pages URL at https://meowdieval-kingdom.github.io/MeowEdit/. Configure repository Actions variables `MEOWEDIT_NEON_AUTH_BASE_URL` and `MEOWEDIT_GAME_API_BASE_URL`; the workflow injects them as public `VITE_` build settings. They are service addresses, not secrets. Without them, the deployed app remains on a configuration gate and does not load the editor. In repository settings, set Pages → Build and deployment → Source to GitHub Actions. The publishing workflow only deploys `main`.

## Game catalogs

`public/unit-roster.json` contains playable characters shown in the current Compendium; buildings are excluded. `public/army-catalog.json` contains Army unit roots and levels, buildings, spells, blessings, curses, cell-target rules, serialized mechanics, floor grid sizes, and fingerprints for the runtime mechanics source files. The dialogue and quest character pickers combine the Compendium roster with every Army unit level and upgrade form; buildings are never offered as characters, and level labels distinguish the forms while the dialogue display name stays clean. Snapshot generators accept `--game-root <path>` and `--output <path>` so they can write to a staging directory. On this development machine, the ignored `tools/local/sync-game-data.ps1` compares staged snapshots with the checked-in catalogs; pass `-Detailed` to see changed content IDs and runtime source paths, and `-Apply` to replace changed catalog files after reviewing the diff. The local sync helper is intentionally not committed. `public/avatars/` contains transparent character renders captured with the game's `UnitPreviewCamera`; portraits appear in dialogue previews and the Army editor when a capture exists.
