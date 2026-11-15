# MeowEdit

A lightweight, browser-only authoring studio for Meowdieval dialogues, quests, reusable army configurations, and Adventure campaigns.

## Run locally

Install dependencies with `npm install`, start the editor with `npm run dev`, and create a production build with `npm run build`.

Run the automated suite with `npm test`; use `npm run test:coverage` for the HTML and terminal coverage reports. The jsdom suite covers editor rendering, graph operations, import/export, validation, and a browser interaction flow for army replacement and per-unit spells. Coverage gates apply to the modular source files; the side-effectful `src/main.ts` bootstrap is exercised through integration tests and kept outside the line-coverage denominator. See [docs/testing.md](docs/testing.md).

The app is static HTML, CSS, and TypeScript. It has no server, database, account system, or runtime package dependencies. Drafts autosave in the current browser. Authors explicitly download JSON or a ZIP package to share content.

## Demo and local artwork

Every raster image in `public/` is watermarked `DEMO` before it is published. `npm run build` checks every image against `public/demo-assets.manifest.json`; changed, missing, or newly added images stop the build until the demo copies and manifest are refreshed. Original local copies are kept in the ignored `.local-assets/source/` folder and are never included in the repository snapshot or Pages build.

The editor uses the demo images by default. To view local real artwork during development, run `npm run confirm-real-assets`, enter the asset folder path, and type `USE REAL ASSETS LOCALLY`. This creates an ignored local opt-in used only by `npm run dev`. Production builds always package the watermarked files from `public/`.

To refresh demo copies after changing local originals, put them under `.local-assets/source/` with the same folder structure and run `npm run watermark-demo-assets`, then build. Regenerating watermarks requires ImageMagick; normal builds and deployments do not.

## Editor scope

- Dialogue sequences with connected nodes, branches, left/right speakers, speaker-attributed lines, and an in-game-style preview.
- Quest authoring for the game's current Escort, Fetch, Battle, and Clear Floor objective types.
- An Army library with game-sized floor grids, unit level selection, spells, blessings, and reusable army IDs for battle targets.
- A Campaign editor for hand-placed, random, and mixed Adventure floors; integer map-coordinate snapping; connected node routes; per-node quest, army, faction, and reward assignments; and campaign run settings.
- MeowEdit extensions for multiple fetch items, KillCount objectives, minimum node distances, quest-to-dialogue links, timer-project logic, and dialogue decisions.
- Guided and advanced editing modes, import, JSON export, and ZIP package export.

New workspaces start empty. Game examples are added only when an author selects **Import examples**; they are limited to the complete dialogue sequences and quest types currently supported by the game. The unfinished bridge-repair draft is not included.

The game currently reads the existing quest and dialogue fields. It does not yet load a campaign package or campaign start screen, execute MeowEdit decision, timer-project, KillCount, multi-item fetch, army configuration, node-distance, or world-effect extensions. Campaign JSON is an authoring/export contract until the Unity integration is completed. See the content format and game integration handoff documents in `docs/`.

## GitHub Pages

The project is prepared for a public GitHub Pages URL at https://meowdieval-kingdom.github.io/MeowEdit/. The workflow in `.github/workflows/deploy-pages.yml` builds `dist` and publishes it on pushes to `main`. In repository settings, set Pages → Build and deployment → Source to GitHub Actions. The first sanitized `main` snapshot must run successfully before the Pages URL is live. The publishing workflow only deploys `main`.

## Game catalogs

`public/unit-roster.json` contains playable characters shown in the current Compendium; buildings are excluded. `public/army-catalog.json` contains Army unit roots and levels, buildings, spells, blessings, and floor grid sizes. The dialogue and quest character pickers combine the Compendium roster with every Army unit level and upgrade form; buildings are never offered as characters, and level labels distinguish the forms while the dialogue display name stays clean. Refresh these snapshots from the sibling game checkout with `npm run snapshot-unit-roster` and `npm run snapshot-army-catalog`. `public/avatars/` contains transparent character renders captured with the game's `UnitPreviewCamera`; portraits appear in dialogue previews and the Army editor when a capture exists.
