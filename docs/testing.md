# Testing MeowEdit

## Commands

- `npm test` runs the Vitest suite in jsdom.
- `npm run test:coverage` runs the same suite and writes an HTML report to `coverage/index.html`.
- `npm run build` type-checks application and test TypeScript, then creates the production bundle.
- `npm run contract:check` verifies the authority hash, strict JSON Schemas, the shared packer hash vector, hand-authored fixtures and JSON Schema/zod agreement. It also cross-checks the hash with the sibling Kingdom contract doc; CI sets `MEOWEDIT_SKIP_AUTHORITY_DOC=1` because that checkout is not available there, while still enforcing `contract/content/schema.sha256`.

CI runs `contract:check`, `test:coverage` and `build` on pushes to `main` and pull requests targeting `main` before uploading the Pages artifact.

The aggregate gate includes the authenticated `src/bridge-bootstrap.ts` entrypoint, the structured set/cloud editor, the restored v1 modules under `src/editor/`, the per-set native workspace store, and the one-way boundary conversion to the structured cloud format. The aggregate minimums are 78% statements, 70% branches, 84% functions, and 85% lines. Treat the latest test report as the current measurement; this document intentionally does not freeze a changing test count or percentage.

The restored v1 controller `src/editor/main.ts` is excluded from the aggregate gate because it is verbatim upstream UI code; its screens are exercised end-to-end by `tests/legacy-editor.test.ts`, `tests/cleanup-regressions.test.ts` and the original v1 module tests. Aggregate thresholds can be propped up by small pure modules, so read the per-file table alongside the totals. Do not add coverage-ignore comments solely to improve the percentage.

The suite covers the sign-in gate, the set browser, the classic editor screens, the per-set workspace, boundary conversion, strict structured validation, registry vocabularies and the capability manifest shape. Save/publish success, conflict and stale-workspace paths are exercised in `tests/cleanup-regressions.test.ts` and `tests/content-app.test.ts`; Unity runtime behaviour is tested separately in Meowdieval Kingdom. Unity runtime loading and gameplay are tested separately in Meowdieval Kingdom.

Add tests beside the behavior they cover under `tests/`. Keep domain rules in side-effect-free modules so they can be tested without browser startup. When adding a new source module, add tests for its valid and rejected paths; for visible workflows, prefer a jsdom integration test that exercises the real rendered controls and persisted result.
