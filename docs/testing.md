# Testing MeowEdit

## Commands

- `npm test` runs the Vitest suite in jsdom.
- `npm run test:coverage` runs the same suite and writes an HTML report to `coverage/index.html`.
- `npm run build` type-checks application and test TypeScript, then creates the production bundle.

Coverage includes **all** `src/**/*.ts`, including `src/main.ts` browser startup and UI event handling. The aggregate minimums are 78% statements, 70% branches, 84% functions, and 85% lines. `src/main.ts` also has per-file minimums of 70% statements, 58% branches, 72% functions, and 77% lines so the entrypoint cannot remain untested behind a healthy aggregate. The latest verified run covers 81.85% statements, 73.94% branches, 88.39% functions, and 87.08% lines across 109 tests in 18 files. These are regression floors, not a claim that every UI detail needs a unit test.

No application TypeScript under `src/` is excluded or marked as ignored. CSS and static assets are not executable TypeScript; HTML, documentation, build configuration, and the game-checkout snapshot scripts under `tools/` are outside the browser runtime scope. Add tests for portable logic in those scripts if it becomes shared or risky; do not add coverage-ignore comments solely to improve the percentage.

The suite covers army catalog geometry (including multi-cell buildings), unit/building placement swaps, Guided Army screen separation, one-copy stats presentation across add/lineup views, complete Advanced section visibility, catalog stat/effect previews, pointer drag placement, replacement and per-unit spells, detailed Guided reviews for Quest objectives/links/effects, Army per-entry spells, and all Campaign floors/settings, campaign domain operations, nested editor navigation, session restoration after reload, content validation, dialogue graph wiring, import normalization, JSON/ZIP exports, demo asset manifest enforcement, confirmed local artwork routing, and jsdom create/edit/return flows. Integration paths include complete dialogue authoring, multi-target quest edits, Army creation from linked editors, campaign randomizer-only setup and custom campaign authoring, floor setup, graph node placement/movement/routes/disconnection, invalid route feedback, examples import/removal, list deletion, and browser file import/export. For the exact workflow inventory and the future runtime boundary, see [authoring use cases](./authoring-use-cases.md) and [game integration handoff](./game-integration-handoff.md).

Add tests beside the behavior they cover under `tests/`. Keep domain rules in side-effect-free modules so they can be tested without browser startup. When adding a new source module, add tests for its valid and rejected paths; for visible workflows, prefer a jsdom integration test that exercises the real rendered controls and persisted result.
