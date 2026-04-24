# Dispatch Fail-Fast and Session Auto-Bind

**Date**: April 22, 2026

## Summary

Replaced the dead global fallback queue in OSS dispatch with two complementary mechanisms: session auto-bind at creation time and dispatch fail-fast with auto-routing at execution time. After T06 made every runner listen on its own per-runner queue, sessions without an explicit `runner_id` were silently timing out. This change ensures OSS users get immediate, actionable feedback when no runner is available and seamless routing when one is.

## Problem Statement

After T06 (embedded runner identity), every runner — including the embedded one started by `stigmer up server` — listens exclusively on its per-runner Temporal task queue (`agent-runner:{runner-id}`). No runner listens on the global `agent_execution_runner` queue anymore.

### Pain Points

- Sessions created via CLI or web UI don't set `runner_id` (the runner picker in T08 hasn't been built yet)
- `ResolveActivityTaskQueue` had three fallback paths that returned the global queue — all three now route to a dead queue
- Users running `stigmer run` after `stigmer up server` would see a Temporal StartToClose timeout instead of an immediate error
- The error experience was silent and confusing: no indication that the runner was right there, just not bound

## Solution

Two complementary layers, modeled after how cloud auto-provisions runners:

**Layer 1 — Session auto-bind (primary):** A new `resolveDefaultRunnerStep` in the session create pipeline. When `runner_id` is empty and exactly one READY runner exists, the session is automatically bound to it. This provides persistence — all subsequent executions in that session route to the same runner for conversation continuity and workspace consistency.

**Layer 2 — Dispatch fail-fast (safety net):** The three global-queue fallback paths in `ResolveActivityTaskQueue` now call `resolveByAvailableRunner`, which scans all runners and picks the best active candidate (READY preferred over BUSY). When no active runner exists, the function returns a descriptive `FAILED_PRECONDITION` error with actionable CLI guidance.

## Implementation Details

### New file: `resolve_runner.go` (session controller)

- `resolveDefaultRunnerStep` — pipeline step that lists all runners, finds sole READY runner, and sets `newState.Spec.RunnerId`
- `findSoleReadyRunner` — helper that returns the single READY runner or nil when auto-binding should be skipped
- Follows the exact same pattern as the existing `resolveDefaultAgentInstanceStep`
- Wired into `buildCreatePipeline()` as step 2 (after ResolveDefaultAgentInstance, before ValidateProto)

### Rewritten: `dispatch.go` (agentexecution temporal)

- `ResolveActivityTaskQueue` signature changed: removed `fallbackQueue` parameter
- Two resolution paths: `resolveByExplicitRunner` (session has `runner_id`) and `resolveByAvailableRunner` (auto-route)
- `resolveByAvailableRunner` scans all runners via `store.ListResources`, prefers READY over BUSY
- Two distinct error messages:
  - "no runners registered — start one with 'stigmer up' or 'stigmer up runner'"
  - "no active runners available (found N runner(s), none in READY phase) — check with 'stigmer list runners' and restart with 'stigmer up'"

### Updated: `workflow_creator.go`

- Removed `FallbackRunnerQueue()` accessor (dead code)
- `Create()` now always uses `dispatch.TaskQueue` directly — the conditional fallback to `config.RunnerQueue` is removed

### Updated: `create.go` (agentexecution controller)

- Single call site updated to drop the `fallbackQueue` argument

### Tests

- 13 new dispatch tests covering auto-route, explicit binding, fail-fast, runner preference
- 6 new session auto-bind tests covering sole READY, no runners, multiple runners, explicit override, BUSY-only, STOPPED-only
- All existing tests pass unchanged

## Benefits

- **Immediate feedback**: users see "no runners registered" instead of a 30+ second Temporal timeout
- **Zero-config routing**: the common OSS case (one embedded runner) "just works" without the user needing to know about runner IDs
- **Conversation continuity**: session auto-bind persists the runner choice, so all executions in a session route to the same runner
- **Actionable errors**: every failure message tells the user exactly what to do (`stigmer up`, `stigmer list runners`)

## Impact

- **OSS users**: immediate improvement — `stigmer up server` + `stigmer run` now works without runner binding
- **Web UI**: sessions created from the web app auto-bind to the sole runner (pre-T08 fix)
- **SDK consumers**: sessions created via the SDK auto-bind; no code changes needed
- **Cloud**: no impact (cloud has its own Java dispatch and session controller)

## Related Work

- T06: Embedded Runner Identity — made every runner use per-runner queues, which exposed the dead fallback queue
- T08 (upcoming): Web UI Runner Picker — will allow explicit runner selection; auto-bind is the default when picker isn't used
- 20260422.02: Runner Command Stream — will replace Python heartbeat with Go supervisor; dispatch changes are forward-compatible

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
