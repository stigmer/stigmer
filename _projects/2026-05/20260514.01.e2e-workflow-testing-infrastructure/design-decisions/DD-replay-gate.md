# DD: Temporal Workflow Replay CI Gate

**Date**: 2026-05-16
**Status**: Accepted
**Context**: T15 — E2E Workflow Testing Infrastructure

## Decision

Every PR that touches `backend/services/workflow-runner/` must pass a Temporal
workflow replay test that verifies the `ExecuteServerlessWorkflow` workflow's
command sequence has not changed in a way that is incompatible with in-flight
executions.

## Why This Matters

`ExecuteServerlessWorkflow` is Stigmer's core Temporal workflow. It is a
**generic** workflow that receives YAML and dynamically builds task executors
at runtime. Any change to how this workflow schedules activities, handles
signals, manages state, or flushes events alters its deterministic command
sequence.

Temporal replays workflow event histories from durable storage to reconstruct
workflow state after worker restarts, crashes, or deployments. If the current
code produces a different command sequence than the recorded history, Temporal
raises a **non-determinism error** and the workflow permanently stalls.

This is a silent corruption: the workflow does not fail fast — it enters a
broken state that requires manual intervention to resolve.

## Approach: Gold Master Replay Testing

### How It Works

1. **Capture**: Run representative workflows through the full integration test
   harness. After each workflow completes, export its Temporal event history
   as a JSON file using the `HistoryExporter` utility.

2. **Commit**: The exported JSON files are committed to the repo as gold
   masters at `backend/services/workflow-runner/test/replay/testdata/replay-histories/`.

3. **Replay**: On every PR, the CI replays each committed history against the
   current workflow code using `worker.NewWorkflowReplayer()`. If the code
   produces a different command sequence, the test fails.

### Why Gold Masters (Not Live Capture)

- **Fast**: Replay tests run in under 10 seconds with no infrastructure.
- **Deterministic**: No Testcontainers, no Java service, no Temporal server.
- **Explicit**: Changes to the command sequence require deliberate action
  (version the workflow, regenerate histories, commit the new files).

## History Coverage

Each history file covers a distinct execution path through the workflow:

| History | Code Path |
|---------|-----------|
| `set_vars.json` | Simplest inline task — baseline determinism |
| `set_vars_chain.json` | Multiple sequential tasks with state export |
| `transform.json` | JQ expression evaluation via activity |
| `switch_case.json` | Conditional branching with flow control |
| `try_catch.json` | Error handling with catch compensation |
| `raise_error.json` | Deliberate failure → EXECUTION_FAILED |
| `http_call.json` | External I/O activity with mock server |
| `for_each.json` | Iteration with inline child tasks |

## Regeneration Protocol

When a change legitimately alters the workflow's command sequence:

1. **Add `workflow.GetVersion()`** in the workflow code to handle both the old
   and new execution paths. This ensures in-flight executions (recorded with
   the old history) continue to replay correctly.

2. **Verify existing replay tests pass** — backward compatibility with
   in-flight executions is non-negotiable.

3. **Run `make capture-replay-histories`** to capture new histories that
   reflect the new code path.

4. **Commit the updated history files** alongside the workflow code change.

5. **Both old and new histories should replay successfully** — the old ones
   via the `GetVersion()` backward-compatible path, the new ones via the
   new path.

## What Replay Does NOT Test

- **Activity correctness**: Replay does not execute activity code. It only
  verifies that the workflow schedules the same activities in the same order
  with the same options.
- **External behavior**: HTTP responses, LLM outputs, and signal payloads
  are recorded in the history. Replay uses the recorded values.
- **Java outer workflow**: The `InvokeWorkflowExecutionWorkflow` Java
  workflow is not covered by this gate (scoped to Go inner workflow only).

## Commands

```bash
# Run replay tests locally (fast, no infra)
make test-replay

# Regenerate gold master histories (needs full harness)
make capture-replay-histories
```

## Files

| File | Purpose |
|------|---------|
| `test/integration/harness/history_exporter.go` | Exports Temporal histories via SDK client |
| `test/integration/replay_capture_test.go` | Runs workflows and captures histories |
| `backend/services/workflow-runner/test/replay/replay_test.go` | Replays committed histories |
| `backend/services/workflow-runner/test/replay/testdata/replay-histories/*.json` | Gold master history files |
| `.github/workflows/ci.replay.yaml` | CI gate on workflow-runner PRs |
