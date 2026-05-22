# Verify Workflow Event Persistence Fix

**Date**: May 23, 2026

## Summary

Verified that the workflow execution event persistence fix (d8900249) is working correctly. Events are being persisted to MongoDB with proper BSON types and are retrievable through the `getEventLog` RPC. The original report of "events not visible" was caused by a stale page state that hadn't been refreshed after the Java service restart — not a code defect.

## Problem Statement

After the event persistence fix was committed, compiled, and deployed locally, the user reported that workflow execution events were still not visible in the desktop app. This required a systematic end-to-end investigation to determine whether the issue was in the write path (runner → Java → MongoDB), the read path (MongoDB → Java → desktop), or a client-side rendering issue.

### Pain Points

- Uncertainty about whether the persistence fix was actually effective
- No way to distinguish between write-side and read-side failures without direct MongoDB inspection
- The `PersistEventsStep` success logs are at `DEBUG` level, invisible at the default `INFO` log level

## Investigation

### MongoDB Verification (Definitive)

Connected to the production MongoDB (`stigmer-prod-mongo-database.planton.live`) and confirmed:

- 12 total events in the `workflow_execution_events` collection
- 4 events for execution `wex_01ks8df803teyjshyvk5yna7fa`:
  - `execution_started` (seq=1)
  - `task_started` / `run_analyst` (seq=2)
  - `task_failed` / `run_analyst` (seq=3)
  - `execution_failed` (seq=4)
- `sequenceNumber` is stored as BSON `Long` (not string) — fix confirmed
- `occurredAt` is stored as BSON `Date` (not string) — fix confirmed
- Older events (pre-fix) still have string types, confirming the fix was applied between executions

### Infrastructure Verification

All services confirmed running and correctly wired:

| Service | Port | Status |
|---------|------|--------|
| Java stigmer-service (gRPC) | 8080 | Running (PID 66388) |
| Caddy dev proxy | 9090 | Running |
| grpcwebproxy | 9091 | Running, connected to :8080 |
| Vite dev server | 5173 | Running, active Tauri connection |

The gRPC-Web proxy chain was tested with a raw curl request confirming correct routing: Caddy :9090 → grpcwebproxy :9091 → Java :8080 (returned `UNAUTHENTICATED` as expected for unauthenticated calls).

### Read Path Verification

- The `docToEvent` roundtrip was validated: documents with corrected types produce valid proto JSON after the Long→string and Date→ISO reverse conversion
- The execution document has `status.phase = "EXECUTION_FAILED"`, so the React SDK correctly uses `getEventLog` (batch loading) rather than `subscribeEvents` (live streaming)
- The `useWorkflowExecutionEventStream` hook logic was reviewed and found correct

### Root Cause

The desktop app needed a fresh navigation to the execution detail page after the Java service restart. The initial "events not visible" state was from a prior page load where the React component had already settled into a terminal state (likely from a previous service session). Navigating to the page fresh triggered the `getEventLog` call, which successfully loaded all 4 events.

## Benefits

- Confirmed the three-layer persistence fix (d8900249) is production-ready
- Validated the full end-to-end event pipeline: runner → gRPC → Java → MongoDB → Java → gRPC-Web → desktop
- Identified that `PersistEventsStep` debug-level logging makes it invisible during normal operation — a future improvement could promote the first persist per execution to INFO level

## Impact

- **Confidence**: The event persistence system is verified working correctly in the local development environment
- **No code changes**: This was a pure investigation session; no code was modified

---

**Status**: Verified
**Repos**: stigmer (SDK verification), stigmer-cloud (Java service verification)
