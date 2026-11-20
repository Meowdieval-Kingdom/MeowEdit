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
- Quest authoring for Escort, Fetch, Battle, Clear Floor, Timer, and Kill Count objectives, including multi-item Fetch and ordered Battle targets.
- An Army library with game-sized floor grids, unit level selection, spells, blessings, and reusable army IDs for battle targets.
- A Campaign editor for hand-placed, random, and mixed Adventure floors; integer map-coordinate snapping; connected node routes; per-node quest, army, faction, and reward assignments; and campaign run settings.
- Campaign events for campaign start, battle timing, or cleared nodes, with a `replace-player-army` action linked to an Army Editor configuration.
- MeowEdit extensions for multiple fetch items, KillCount objectives, minimum node distances, quest-to-dialogue links, timer-project logic, and dialogue decisions.
- Guided and advanced editing modes, import, JSON export, and ZIP package export.

New workspaces start empty. Selecting **Import examples** adds representative dialogues, every supported quest objective, a reusable Army, and a three-floor campaign that demonstrates authored, random, and mixed maps, rewards, shop stock, saved dialogue decisions, and quest completion effects. The bridge repair is an example Timer quest, not an unfinished draft.

Meowdieval Kingdom can load manually installed version 1 packages containing quests, dialogue sequences, reusable armies, and campaigns. It validates game catalog references and campaign structure before offering a campaign; a package with invalid or unsupported content is excluded as a whole. A started run remains pinned to the package revision and content hash it began with, while new runs use the revision marked latest. Packages are still copied into the Unity project by hand; there is no hosted upload or dynamic in-game download yet. See [content format](docs/content-format.md) and [game integration handoff](docs/game-integration-handoff.md) for the install steps and runtime boundary.

## GitHub Pages

The project is prepared for a public GitHub Pages URL at https://meowdieval-kingdom.github.io/MeowEdit/. The workflow in `.github/workflows/deploy-pages.yml` builds `dist` and publishes it on pushes to `main`. In repository settings, set Pages → Build and deployment → Source to GitHub Actions. The first sanitized `main` snapshot must run successfully before the Pages URL is live. The publishing workflow only deploys `main`.

## Game catalogs

`public/unit-roster.json` contains playable characters shown in the current Compendium; buildings are excluded. `public/army-catalog.json` contains Army unit roots and levels, buildings, spells, blessings, curses, cell-target rules, serialized mechanics, floor grid sizes, and fingerprints for the runtime mechanics source files. The dialogue and quest character pickers combine the Compendium roster with every Army unit level and upgrade form; buildings are never offered as characters, and level labels distinguish the forms while the dialogue display name stays clean. Snapshot generators accept `--game-root <path>` and `--output <path>` so they can write to a staging directory. On this development machine, the ignored `tools/local/sync-game-data.ps1` compares staged snapshots with the checked-in catalogs; pass `-Detailed` to see changed content IDs and runtime source paths, and `-Apply` to replace changed catalog files after reviewing the diff. The local sync helper is intentionally not committed. `public/avatars/` contains transparent character renders captured with the game's `UnitPreviewCamera`; portraits appear in dialogue previews and the Army editor when a capture exists.
