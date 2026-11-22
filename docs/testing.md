# Testing MeowEdit

## Commands

- `npm test` runs the Vitest suite in jsdom.
- `npm run test:coverage` runs the same suite and writes an HTML report to `coverage/index.html`.
- `npm run build` type-checks application and test TypeScript, then creates the production bundle.
- `npm run contract:check` verifies the authority hash, strict JSON Schemas, hand-authored fixtures and JSON Schema/zod agreement.

Coverage includes **all** `src/**/*.ts`, including the authenticated `src/bridge-bootstrap.ts` entrypoint and the v2 editor. The aggregate minimums are 78% statements, 70% branches, 84% functions, and 85% lines. Treat the latest test report as the current measurement; this document intentionally does not freeze a changing test count or percentage.

No application TypeScript under `src/` is excluded or marked as ignored. CSS and static assets are not executable TypeScript; HTML, documentation, build configuration, and the game-checkout snapshot scripts under `tools/` are outside the browser runtime scope. Do not add coverage-ignore comments solely to improve the percentage.

The suite covers the sign-in gate, the backend set browser with Local/Draft/Published badges, guided set creation and content authoring, the detailed editor, version-guarded draft saves, explicit publish with hash verification, strict v2 validation, registry vocabularies, and the capability manifest snapshot. Unity runtime loading and gameplay are tested separately in Meowdieval Kingdom.

Add tests beside the behavior they cover under `tests/`. Keep domain rules in side-effect-free modules so they can be tested without browser startup. When adding a new source module, add tests for its valid and rejected paths; for visible workflows, prefer a jsdom integration test that exercises the real rendered controls and persisted result.
