# Unblock `make check`: Test, Build, and Packaging Fixes Across Go, SDK, and the ink CLI

**Date**: June 2, 2026

## Summary

`make check` was failing in both the Stigmer OSS and Stigmer Cloud repositories at
several different stages, each failure masking the next. This work walked the CI
gate end-to-end and fixed a cascade of pre-existing breakages — spanning Go
modules, the `@stigmer/react` SDK, the terminal (`ink`) CLI packaging, and the
Cloud Java service — so the pipeline can progress. After these fixes the OSS gate
passes `tidy`, `lint`, `tsdoc-check`, the full `build` (including the entire
`@stigmer/react` vitest suite), and the complete Go test suite under `-race`. The
Cloud gate is fully green.

## Problem Statement

The CI gate (`make check`) aggregates many sub-targets (`tidy`, `lint`,
`tsdoc-check`, `build`, `test`, …). A single broken file at any stage halts the
whole pipeline, so a backlog of in-progress changes had accumulated multiple
independent failures that were invisible until the stage ahead of them was fixed.

### Pain Points

- A workflow-execution test imported a non-existent Go package path
  (`backend/libs/go/grpclib/pipeline`) and used a stale `NewRequestContext`
  signature, breaking `go mod tidy`.
- A migration referenced two store methods (`CountAuditEntries`,
  `GetLatestAuditHash`) that were never added to the `store.Store` interface,
  breaking `go vet`.
- A React ref was mutated during render (`react-hooks/refs`), failing the web
  ESLint stage.
- A cross-file `{@link}` in a TSDoc comment could not be resolved, failing
  `tsdoc-check` (run with `--treatValidationWarningsAsErrors`).
- The `@stigmer/react` visual registry returned `captionHeight: 0` for
  non-rectangular node shapes, contradicting its own contract and tests.
- `useWorkspaceFiles` tests shared a default entry id and leaked async work past
  teardown, producing cache-pollution failures and a `window is not defined`
  error.
- `WorkflowArchitectDialog` moved its YAML behind a collapsible toggle, but its
  test still asserted the YAML was visible inline.
- Workflow pause tests stubbed `ExecuteDeepAgent` with the old
  `*AgentExecutionStatus` return type after it was refactored to
  `RunnerActivityResult` (a map), so the Temporal data converter rejected the
  results.
- An agent-controller test still expected a missing MCP-server reference to be
  "skipped gracefully" after `ValidateReferences` was made strict.
- The terminal `ink` CLI crashed at module load (`ERR_UNKNOWN_FILE_EXTENSION`)
  because `@stigmer/react` graph components imported `@xyflow/react/dist/style.css`
  as a side effect — fine for a web bundler, fatal under Node/`tsx`.
- (Cloud) A recover-handler test used Jackson without declaring the dependency
  (Bazel strict-deps), and 5 `update_status` tests encoded the pre-guard
  `pending_approvals` semantics.

## Solution

Fix each failure at its true root, preferring to align stale tests with the
current, intentional production behavior (rather than weakening production), and
adding the small amount of missing production code where it was genuinely absent.

## Implementation Details

### Go (OSS)

- **Store version-history methods**: Added `CountAuditEntries` and
  `GetLatestAuditHash` to the `store.Store` interface, implemented them in the
  SQLite store (reusing the existing `resource_audit` indexes), and added them to
  the test `mockStore`.
- **Workflow-execution controller test**: Corrected the import to
  `backend/libs/go/grpc/request/pipeline` and passed a `context.Context` to
  `NewRequestContext`; removed the stale dep from the target's `BUILD.bazel`.
- **Workflow pause tests**: Updated the `ExecuteDeepAgent` stub and mocks to the
  refactored `RunnerActivityResult` (map of proto-JSON fields) via a small
  `runnerResult(phase, err)` helper, and corrected
  `TestFailedActivityPropagatesError` to assert the workflow error that the
  production flow now propagates on an `EXECUTION_FAILED` result.
- **Agent controller test**: `ValidateReferences` now strictly rejects unknown
  MCP-server references; reframed the subtest to assert that rejection.

### `@stigmer/react` SDK (OSS)

- **Caption dimensions**: Restored the documented `captionHeight` values
  (`gate-octagon` 24, `decision-diamond` 24, `event-circle` 20) in the visual
  registry; layout now reserves external caption space again.
- **`useWorkspaceFiles` tests**: Gave each `makeEntry()` a unique default id to
  isolate the module-level cache, and added `afterEach(cleanup)` to prevent a
  post-teardown `window is not defined`.
- **`WorkflowArchitectDialog` test**: Expand the "View YAML" toggle before
  asserting on the YAML.
- **TSDoc link**: Replaced an unresolved cross-file `{@link WorkflowOverviewGraph}`
  with a backticked code reference.

### ink CLI packaging (OSS)

- Moved `@import "@xyflow/react/dist/style.css"` into the central
  `@stigmer/react` `src/styles.css` (which both the web app and the published
  `dist/styles.css` consume) and removed the five per-component inline CSS
  side-effect imports. The headless `@stigmer/react` entry is now loadable under
  Node/`tsx`, so `stigmer-ink --help` works; the Tailwind build still bundles the
  React Flow styles.

### Web console (OSS)

- `Sidebar` no longer mutates a ref during render; the "latest entries" ref is
  synced in an effect.

### Cloud (Stigmer Cloud)

- Declared `@maven//:com_fasterxml_jackson_core_jackson_databind` on the
  `workflow_execution_recover_handler_test` target.
- Updated 5 `WorkflowExecutionUpdateStatusHandler` tests to the guarded
  `pending_approvals` merge contract (only mutated when
  `update_pending_approvals` is set), including repurposing one test to verify
  the race-condition guard preserves existing approvals.

## Benefits

- The OSS `make check` advances through `tidy`, `lint`, `tsdoc-check`, the full
  `build` (incl. the 1602-test `@stigmer/react` vitest suite), and the complete
  Go test suite under `-race`.
- The Stigmer Cloud gate is fully green (154 backend tests passing).
- The terminal CLI no longer pulls web-only CSS into a Node runtime, removing a
  whole class of "works in browser, breaks in CLI" packaging bugs.

## Impact

- Unblocks contributors whose changes were stuck behind unrelated, pre-existing
  failures in the shared CI gate.
- Establishes the central-stylesheet pattern as the single source of graph styles
  for both web and terminal consumers of `@stigmer/react`.

## Related Work

- Follows the recent workflow-graph visualization work in `@stigmer/react`
  (overview/diff/execution graphs, node visual registry).
- The remaining known gap is the `backend/services/runner` TypeScript suite,
  which still has ~40 failures across multiple subsystems (HTTP/2 interceptor
  mocks, model-registry fetch mocking, a new `ResetEventSequence` local activity,
  deep-agent activity context, and some environment-gated Cursor smoke tests);
  these are tracked separately.

---

**Status**: ✅ Production Ready (OSS gate green through the Go test suite; Cloud gate fully green)
**Timeline**: Single session
