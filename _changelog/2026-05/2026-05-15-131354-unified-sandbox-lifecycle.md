# Unified Sandbox Lifecycle Management

**Date**: May 15, 2026

## Summary

Replaced the single-process sandbox lifecycle model with server-side multi-process idle aggregation. All three runner processes in a Daytona sandbox (Python agent-runner, TypeScript cursor-runner, Go workflow-runner) now independently report heartbeats with `process_type` identifiers. The server tracks per-process execution counts and only deprovisions the sandbox when all processes have been idle for a configurable timeout -- eliminating premature sandbox deletion when one process disconnects while others are still active.

## Problem Statement

The sandbox lifecycle was tied to a single process. When the Python agent-runner's bidi stream disconnected (whether due to idle timeout, crash, or normal completion), the server immediately transitioned the runner to STOPPED and triggered Daytona sandbox deletion -- killing the Go workflow-runner and TypeScript cursor-runner processes that may still have been actively executing work.

### Pain Points

- Workflow-runner executing a long-running workflow could be killed mid-execution when the agent-runner went idle
- Cursor-runner processing a Cursor SDK activity could be killed when the agent-runner finished its work
- Each process had its own idle watchdog making independent shutdown decisions, with no coordination
- The `RunnerStreamRegistry` only supported one stream per runner, preventing multiple process streams

## Solution

Moved the "when to delete the sandbox" decision from individual runner processes to the Java server, which has visibility across all processes via their heartbeat streams.

Three coordinated changes:
1. **Multi-process heartbeat reporting** -- Go and TypeScript runners now send heartbeats alongside the existing Python runner, each identifying themselves with `process_type`
2. **Server-side aggregation** -- The server tracks per-process execution counts and computes aggregate idle state
3. **Idle watchdog removal** -- Individual process idle watchdogs removed; sandbox lifecycle is now exclusively a server-side decision

## Implementation Details

### Proto Changes (stigmer OSS)
- Added `process_executions` map (string -> int32) to `RunnerStatus` for per-process tracking
- Added `idle_since` timestamp to `RunnerStatus` for server-side idle detection
- The existing `process_type` field on `RunnerHeartbeat` (added in Phase 3) is now actively used by all three processes

### Go Workflow-Runner Heartbeat (stigmer OSS)
- New `pkg/heartbeat` package with `Client` (bidi stream with reconnection) and `ActivityCounter` (Temporal `WorkerInterceptor` using atomic int32)
- Heartbeat client is no-op when `STIGMER_RUNNER_ID` is not set (local/OSS mode)
- Wired into both orchestration and execution workers via the counter interceptor

### TypeScript Cursor-Runner Heartbeat (stigmer OSS)
- New `src/heartbeat.ts` using Connect-RPC's async generator bidi stream pattern
- Reuses existing activity tracking from the refactored `idle-watchdog.ts`
- Added `runnerId` to Config from `STIGMER_RUNNER_ID` env var

### Java Server Changes (stigmer-cloud)
- `RunnerHeartbeatService`: per-process `process_executions` map tracking, aggregate `current_executions` computation, `idle_since` lifecycle, configurable idle timeout for ephemeral runners
- `RunnerStreamRegistry`: changed from `Map<String, StreamEntry>` to `Map<String, Map<String, StreamEntry>>` (runnerId -> processType -> stream). Commands route to "agent" stream; heartbeats tracked per-process
- `RunnerConnectHandler`: extracts `processType` from first heartbeat, only transitions to STOPPED when the last process stream disconnects
- `RunnerLauncherConfig`: new `sandboxIdleTimeoutSeconds` (default 300s)

### Idle Watchdog Removal (stigmer OSS)
- Deleted `idle_watchdog.py` from Python agent-runner
- Refactored `idle-watchdog.ts` in cursor-runner: kept activity tracking functions, removed shutdown logic
- Go workflow-runner never had one

### Testing
- Queue derivation unit tests (`config_test.go`) for sandbox vs OSS mode
- Activity counter unit tests with concurrency verification
- Sandbox co-location integration test validating `preferred_runner_id` propagation
- Java heartbeat service tests: per-process tracking, backward compatibility, idle_since lifecycle, idle timeout for ephemeral runners, non-ephemeral safety

## Benefits

- Sandbox survives individual process disconnects -- no more premature deletion
- Configurable idle timeout (300s default) replaces hard-coded per-process watchdogs
- Server has full visibility into multi-process sandbox activity for observability
- Backward compatible: single-process runners (empty `process_type`) default to "agent"
- Safety net preserved: Daytona's `auto-stop-interval-minutes` catches server-side logic failures

## Impact

- **Cloud runners**: Sandbox lifecycle is now correct for the three-process model
- **Local/OSS runners**: No behavioral change (heartbeat clients are no-op, no deprovisioning)
- **Console/UI**: Runner status now shows aggregate activity across all processes

## Related Work

- Workflow Runner Sandbox Integration (Phases 1-4b) -- included workflow-runner in sandbox image, per-runner queue routing, preferred_runner_id for co-location
- This changelog covers Phases 5-6 of the same initiative

---

**Status**: Production Ready
**Timeline**: Single session
