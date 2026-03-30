# Fix Event Loop Blocking in Agent Runner

**Date**: March 30, 2026

## Summary

All graphton tool wrappers (read, write, edit, delete, execute, ls, glob, grep, search) were calling synchronous backend methods directly from async functions, blocking the asyncio event loop. When multiple sub-agents invoked tools concurrently, the event loop froze — stopping heartbeats, halting Temporal polling, and leaving the pod in a hung state that Kubernetes couldn't detect. This fix offloads all sync I/O to the thread pool, adds an event loop watchdog for diagnostics, and introduces a Kubernetes liveness probe to catch future hangs.

## Problem Statement

Agent executions that spawned three concurrent sub-agents would hang indefinitely. The agent-runner pod showed "Running" with "0 restarts" but had ceased all logging and stopped picking up Temporal tasks. Temporal reported heartbeat timeouts on the activity.

### Pain Points

- Every agent execution was failing in production due to the hung process
- The pod appeared healthy to Kubernetes (no restarts, no crash) because the existing Docker HEALTHCHECK only verified imports
- The root cause was invisible without deep investigation — synchronous `subprocess.run()`, recursive file walks, and sync file I/O blocked the single-threaded event loop
- No diagnostic tooling existed to detect event loop blockage

## Solution

Offload all synchronous backend calls in graphton's tool wrappers to the thread pool via `asyncio.to_thread()`, add an event loop watchdog background task, and introduce a Kubernetes exec-based liveness probe tied to a heartbeat file.

## Implementation Details

### Investigation: Which tools actually run?

Read the deepagents 0.4.10 `FilesystemMiddleware` source to determine whether it replaces graphton's tools with its own implementations. Found that both `awrap_model_call` and `awrap_tool_call` are pass-through — the middleware only filters the `execute` tool when the backend doesn't support it, and post-processes large results. **Graphton's own tool wrappers are the code that LangGraph invokes**, confirming they are the source of blocking.

### Tool wrappers non-blocking (`tool_wrappers.py`)

- **Simple operations** (read, write, delete, ls): wrapped the single sync call in `await asyncio.to_thread(backend.method, ...)`
- **Edit**: wrapped both `backend.read()` and `backend.write()` individually (CPU work between them is trivial)
- **Execute fallback**: wrapped `backend.execute()` for backends without `execute_streaming` (FilesystemBackend has streaming, so this is a safety net for other backends)
- **Recursive operations** (glob, grep): offloaded the entire recursive walk as a single `asyncio.to_thread()` call — wrapping each individual call would add excessive thread-pool context switching
- **Search**: offloaded `build_workspace_index()` to a thread; made `_get_index()` async

### Adapter async execute (`deepagents_adapter.py`)

Added `aexecute` override on `DeepAgentsBackendAdapter` that prefers the inner backend's native `execute_streaming` (async subprocess via `asyncio.create_subprocess_shell`) over the default `asyncio.to_thread(subprocess.run)`. Falls back to `to_thread` for backends without streaming.

### Event loop watchdog (`streaming.py`)

New `_event_loop_watchdog` background task runs alongside the existing heartbeat task during the LangGraph streaming loop. It sleeps for 100ms and measures the actual elapsed time — if the event loop was blocked, the drift exceeds the 500ms threshold and a `[WATCHDOG]` warning is logged. The watchdog also touches `/tmp/agent-runner-heartbeat` on each iteration.

### Kubernetes liveness probe (`_kustomize/overlays/prod/service.yaml`)

Added an `exec`-based liveness probe that runs a Python one-liner checking whether the heartbeat file exists and was modified within the last 120 seconds. If the event loop hangs (watchdog stops touching the file), the probe fails after 3 consecutive checks and Kubernetes restarts the pod.

## Benefits

- Agent executions with concurrent sub-agents no longer hang the process
- If any future blocking call is introduced, the watchdog logs a warning identifying the problem
- If the event loop hangs completely, Kubernetes automatically restarts the pod within ~3 minutes
- The `aexecute` override avoids wasting a thread-pool slot for long-running shell commands when native async subprocess is available

## Impact

- **Agent runner**: All tool invocations now run without blocking the event loop
- **Production reliability**: Kubernetes will detect and recover from hung agent-runner pods
- **Observability**: `[WATCHDOG]` log lines provide early warning of event loop contention
- **Test coverage**: 12 new tests (7 non-blocking tool wrapper tests + 5 async adapter tests)

## Files Changed

| File | Change |
|------|--------|
| `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` | Wrap all sync backend calls in `asyncio.to_thread()` |
| `backend/libs/python/graphton/src/graphton/core/backends/deepagents_adapter.py` | Add `aexecute` override using native async streaming |
| `backend/services/agent-runner/worker/activities/graphton/streaming.py` | Add event loop watchdog background task |
| `backend/services/agent-runner/_kustomize/overlays/prod/service.yaml` | Add exec-based liveness probe |
| `backend/libs/python/graphton/tests/core/test_deepagents_adapter.py` | 5 new async execute tests |
| `backend/libs/python/graphton/tests/core/test_tool_wrappers_async.py` | 7 new non-blocking tool wrapper tests |

## Related Work

- [Status Builder Hardening](../2026-03/) — StatusBuilder refactoring that preceded this work
- Execute Graphton Simplification (T04 in progress) — structural refactoring of execute_graphton.py, independent of this fix

---

**Status**: ✅ Production Ready
**Timeline**: Single session
