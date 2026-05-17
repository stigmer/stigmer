# Temporal Workflow Replay CI Gate

**Date**: May 16, 2026

## Summary

Added a Temporal workflow replay determinism gate that catches non-deterministic changes to `ExecuteServerlessWorkflow` before they corrupt in-flight workflow executions. The gate replays 8 committed gold master event histories against current workflow code in 0.8 seconds, with zero infrastructure requirements. A CI workflow blocks merge on any PR that introduces a non-deterministic command sequence change.

## Problem Statement

`ExecuteServerlessWorkflow` is a generic Temporal workflow that dynamically executes any CNCF Serverless Workflow definition. It has been evolving rapidly over 24+ sessions with no replay safety net. Any change that alters the workflow's deterministic command sequence (reordering activities, changing state flow, modifying event flushing) would silently corrupt all in-flight workflow executions — Temporal would raise non-determinism errors and the workflows would permanently stall.

### Pain Points

- Zero replay tests existed prior to this change
- Zero `workflow.GetVersion()` calls existed — no versioning discipline
- No event histories were captured for regression testing
- Non-determinism bugs are silent: they don't fail at deploy time, they fail when existing workflows resume after a code change

## Solution

A two-component architecture: (1) a capture pipeline that runs representative workflows through the full integration harness and exports their Temporal event histories as JSON files, and (2) a replay test that replays those committed gold masters against the current workflow code using `worker.NewWorkflowReplayer()`.

## Implementation Details

**History Exporter** (`test/integration/harness/history_exporter.go`): Uses Temporal SDK's `GetWorkflowHistory()` iterator to fetch complete event histories and writes them as JSON compatible with `ReplayWorkflowHistoryFromJSONFile()`. Includes a `NewTemporalClient()` helper with connectivity health check.

**Capture Test** (`test/integration/replay_capture_test.go`): 8 representative workflows covering the main task families. Gated behind `CAPTURE_REPLAY_HISTORIES=1` so it doesn't run during normal `make test-integration`. Each test deploys a workflow, waits for terminal phase, then exports the inner `workflow-exec-{id}` workflow's history.

**Replay Test** (`backend/services/workflow-runner/test/replay/replay_test.go`): Discovers all `.json` files in `testdata/replay-histories/`, registers `ExecuteServerlessWorkflow` with the replayer, and replays each history. Activities are not registered — replay only verifies the workflow's command sequence, not activity execution. Skips gracefully when no histories are present.

**CI Gate** (`.github/workflows/ci.replay.yaml`): Triggered on PRs touching `backend/services/workflow-runner/**`. Runs `go test ./test/replay/` — no JAR build, no Testcontainers, under 30 seconds.

**Gold Master Histories** (8 files, ~236KB total):
- `set_vars.json` — single inline task baseline
- `set_vars_chain.json` — sequential tasks with state export
- `transform.json` — JQ expression via activity
- `switch_case.json` — conditional branching with flow control
- `try_catch.json` — error handling with catch compensation
- `raise_error.json` — deliberate failure path
- `http_call.json` — external I/O activity
- `for_each.json` — iteration with inline child tasks

## Benefits

- **Catches silent corruption**: Non-deterministic workflow changes are now detected at PR time, before they can affect production
- **Sub-second feedback**: Replay tests run in 0.8s with zero infrastructure — fast enough for local iteration
- **Documented regeneration protocol**: When changes are intentional, developers add `workflow.GetVersion()` for backward compatibility and regenerate histories with `make capture-replay-histories`
- **8 code paths covered**: Each gold master exercises a different execution path through the generic workflow engine

## Impact

- **Workflow-runner developers**: Every PR to `backend/services/workflow-runner/` now passes a replay gate
- **Platform reliability**: In-flight workflow executions are protected from code changes that would break their replay
- **CI pipeline**: New lightweight job (~30s) added to PR checks

## Related Work

- Part of T15 in the E2E Workflow Testing Infrastructure project (T01 plan)
- Follows T18 (SDK Acceptance Smoke Tests) and T19 (Agent Execution Coverage Gaps)
- Design decision documented at `_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/design-decisions/DD-replay-gate.md`

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes implementation + capture)
