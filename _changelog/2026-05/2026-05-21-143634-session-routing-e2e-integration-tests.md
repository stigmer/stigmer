# Session Routing E2E Integration Tests

**Date**: May 21, 2026

## Summary

Added a new integration test suite (`test/integration-session-routing/`) that validates per-session Temporal task queue routing end-to-end. The suite covers three tiers: offline control plane verification via Temporal workflow memo inspection, offline runner dispatch verification with the unified runner in IPC manager mode, and provider-backed full E2E with Cursor API key. This is the first test infrastructure that exercises the `STIGMER_ACTIVITY_ROUTING=session` mode introduced in the runner architecture simplification project.

## Problem Statement

The runner architecture simplification project (Sessions 2-10) replaced the monolithic Runner API with per-session Temporal task queue routing (`session:{id}` queues). While each component had unit tests, there was no integration or E2E test proving the full dispatch pipeline works — from session creation through Java service dispatch to activity execution on a per-session queue by the unified runner.

### Pain Points

- No test verified that `SessionDispatchService.resolve()` correctly sets `activityTaskQueue` in the Temporal workflow memo
- No test validated the unified runner's IPC manager mode (`addSession`/`removeSession`) in a realistic environment
- No test proved that an `ExecuteCursor` activity dispatched to a `session:{id}` queue gets picked up by the correct per-session Worker
- The test harness lacked support for session routing configuration (`STIGMER_ACTIVITY_ROUTING`, `DefaultExecutionTarget`, `SandboxType`, `sandbox` Spring profile)

## Solution

Created a new standalone integration test suite following the established `test/integration-security/` satellite module pattern. The suite starts its own Java service instance with `STIGMER_ACTIVITY_ROUTING=session` to avoid interfering with the existing global-routing test suite.

## Implementation Details

### Harness Extensions (shared `test/integration/harness/`)

- **`service.go`**: Added `ActivityRouting`, `DefaultExecutionTarget`, `SandboxType` fields to `ServiceConfig`. Added `sandbox` Spring profile activation when `SandboxType` is set. Wired three new env vars into `buildServiceEnv()`.
- **`temporal.go`**: Added `Client()` method to `TemporalDevServer` returning a Temporal Go SDK client for workflow memo verification via `DescribeWorkflowExecution`.
- **`unified_runner.go`**: New file (~450 lines) with two runner modes:
  - `UnifiedRunnerManager` — IPC manager mode with `addSession`/`removeSession` via stdin JSON, `ready` health check, graceful shutdown
  - `UnifiedRunnerStatic` — static single-queue mode for simulating sandbox runners
- **`harness_config.go`**: Added `WithExecutionTarget` session option.
- **`benchmark_helpers.go`**: Fixed pre-existing `GetRunnerUsage` → `GetStreamingUsage` rename.

### Test Suite (`test/integration-session-routing/`)

- **Tier 1 — Offline Control Plane** (`routing_offline_test.go`, 4 tests): Verifies workflow memo `activityTaskQueue` matches `session:{sessionId}` without any runner. Tests default execution target resolution, execution target immutability, and distinct queues for distinct sessions.
- **Tier 2 — Offline Runner Dispatch** (`dispatch_offline_test.go`, 4 tests): Starts unified runner in IPC manager mode. Verifies `addSession` creates Workers on correct queues, activities are dispatched and picked up (failing with expected API error, proving routing works), idempotent session management, and independent multi-session dispatch.
- **Tier 3 — Provider-Backed E2E** (`e2e_provider_test.go`, 3 tests): Full end-to-end with `CURSOR_API_KEY`. Session routing through to `COMPLETED` execution. Concurrent sessions completing independently. Follow-up messages on the same session queue.
- **Cloud Control Plane** (`cloud_control_plane_test.go`, 2 tests): CLOUD execution target routing with noop sandbox provisioner. Verifies dispatch routes correctly and noop sandbox does not block execution.

### Build Infrastructure

- `go.mod` with replace directives, `BUILD.bazel` stub, `Makefile` with offline and provider-backed lanes (Planton secret auto-fetch)
- Root `go.work` and `Makefile` updated with delegate targets

## Benefits

- First integration-level validation of the per-session routing pipeline that spans Java dispatch, Temporal memo, and unified TypeScript runner
- Three-tier structure allows offline CI validation (Tier 1+2) without API keys, with provider-backed E2E as an optional lane
- Temporal memo verification technique (`DescribeWorkflowExecution` + payload decoding) is a reusable pattern for future routing tests
- IPC manager mode testing validates the exact code path used by the desktop app's embedded runner

## Impact

- **Runner architecture simplification project**: Provides the E2E validation layer that was the planned next step after cloud sandbox provisioning (Session 10)
- **Integration test infrastructure**: Extends the shared harness with session routing capabilities that other suites can use
- **CI pipeline**: Two new `make` targets (`test-integration-session-routing`, `test-integration-session-routing-providers`) ready for CI integration

## Related Work

- Runner Architecture Simplification (Sessions 2-10) — the project this test suite validates
- Unified Runner Migration — the runner manager IPC protocol tested here was created in that project
- Workflow Runner TypeScript Rewrite — the unified runner's activity set tested here includes the rewritten workflow engine

---

**Status**: Production Ready
**Timeline**: 1 session
