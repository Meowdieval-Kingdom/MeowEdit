# Testing MeowEdit

## Commands

- `npm test` runs the Vitest suite in jsdom.
- `npm run test:coverage` runs the same suite and writes an HTML report to `coverage/index.html`.
- `npm run build` type-checks application and test TypeScript, then creates the production bundle.
- `npm run contract:check` verifies the authority hash, strict JSON Schemas, the shared packer hash vector, hand-authored fixtures and JSON Schema/zod agreement. It also cross-checks the hash with the sibling Kingdom contract doc; CI sets `MEOWEDIT_SKIP_AUTHORITY_DOC=1` because that checkout is not available there, while still enforcing `contract/v2/schema.sha256`.

CI runs `contract:check`, `test:coverage` and `build` on every push and pull request before uploading the Pages artifact.

Coverage includes the authenticated `src/bridge-bootstrap.ts` entrypoint, the v2 set/cloud editor, the restored v1 modules under `src/legacy/`, the per-set native workspace store, and the one-way boundary conversion to the v2 cloud format. The aggregate minimums are 78% statements, 70% branches, 84% functions, and 85% lines. Treat the latest test report as the current measurement; this document intentionally does not freeze a changing test count or percentage.

The restored v1 controller `src/legacy/main.ts` is excluded from the aggregate gate: it is verbatim upstream UI code, and its screens are exercised end-to-end by `tests/legacy-editor.test.ts` plus the original v1 module tests. All code we author and maintain (boundary conversion, v2, bridge) stays inside the gate. Do not add coverage-ignore comments solely to improve the percentage.

The suite covers the sign-in gate, the backend set browser with Local/Draft/Published badges, guided set creation and content authoring, the detailed editor, version-guarded draft saves, explicit publish with hash verification, strict v2 validation, registry vocabularies, and the capability manifest snapshot. Unity runtime loading and gameplay are tested separately in Meowdieval Kingdom.

Add tests beside the behavior they cover under `tests/`. Keep domain rules in side-effect-free modules so they can be tested without browser startup. When adding a new source module, add tests for its valid and rejected paths; for visible workflows, prefer a jsdom integration test that exercises the real rendered controls and persisted result.
