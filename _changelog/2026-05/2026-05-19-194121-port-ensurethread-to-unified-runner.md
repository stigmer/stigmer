# Port EnsureThread Activity to Unified TypeScript Runner

**Date**: May 19, 2026

## Summary

Ported the EnsureThread Temporal activity from the Python agent-runner to the unified TypeScript runner service. This is the first Phase 4 (Supporting Activities) deliverable in the unified runner migration, enabling the Java/Go workflow to dispatch both EnsureThread and ExecuteDeepAgent to the same TypeScript process — eliminating one more dependency on the Python agent-runner.

## Problem Statement

The EnsureThread activity resolves a LangGraph thread ID before each deep agent execution. It was implemented in Python and registered on the Python agent-runner's Temporal queue. With the unified TypeScript runner now handling ExecuteDeepAgent (Phases 1-3c), EnsureThread remained as a dangling dependency on the Python process, preventing full cutover of the native harness flow to TypeScript.

### Pain Points

- Python agent-runner must remain running solely because EnsureThread is registered there
- Two-process dependency for what should be a single-process execution path
- EnsureThread + ExecuteDeepAgent should run in the same TypeScript worker

## Solution

Port EnsureThread as a lightweight activity factory in the unified runner, matching the Python behavior exactly. The activity is a pure function with no database or gRPC dependencies — it derives thread IDs deterministically from session IDs.

## Implementation Details

**New file**: `backend/services/runner/src/activities/ensure-thread.ts`
- `createEnsureThreadActivities()` factory following the existing runner pattern
- Session-based: `"thread-{sessionId}"` (deterministic, load-bearing for proxy authorization)
- Ephemeral: `"ephemeral-{agentId}-{8hex}"` using `crypto.randomUUID()`
- Idle watchdog integration (`activityStarted`/`activityFinished`)

**Modified file**: `backend/services/runner/src/main.ts`
- Registers EnsureThread alongside ExecuteCursor and ExecuteDeepAgent

**Test file**: `backend/services/runner/src/activities/__tests__/ensure-thread.test.ts`
- 11 unit tests: format, determinism, uniqueness, watchdog, proxy compatibility
- 352 total tests passing (11 new + 341 existing)

## Benefits

- Unified runner now registers 3 activities: ExecuteCursor, ExecuteDeepAgent, EnsureThread
- No Java/Go workflow changes required — Temporal routes by activity name automatically
- First step toward full Python agent-runner retirement for the native harness flow
- Zero new dependencies — pure function using Node.js built-in `crypto`

## Impact

- **Unified runner**: Now handles the complete native deep agent execution path
- **Python agent-runner**: One fewer activity binding it to production
- **Deployment**: No coordinated deployment needed — the TypeScript runner simply starts handling EnsureThread requests when it registers on the queue

## Related Work

- Phase 3c completion: HITL approval gate, sub-agent concurrency (previous session)
- Phase 4 roadmap: ClassifyToolApprovals and DiscoverMcpServer are next
- Project: `_projects/2026-05/20260518.01.unified-runner-migration`

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes implementation
