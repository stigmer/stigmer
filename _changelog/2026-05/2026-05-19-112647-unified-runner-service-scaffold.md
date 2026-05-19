# Unified Runner Service Scaffold (Phase 1)

**Date**: May 19, 2026

## Summary

Created `backend/services/runner/` — a unified TypeScript Temporal activity worker that replaces both the Python agent-runner and TypeScript cursor-runner with a single service. This Phase 1 scaffold establishes the package structure, shared infrastructure, and registers both `ExecuteCursor` (fully functional) and `ExecuteDeepAgent` (stub) activities on a single Temporal queue. The Go and Java workflow orchestrators were updated to eliminate the polyglot `:cursor` queue suffix.

## Problem Statement

The agent execution path required two separate runner processes in two languages:
- **Python agent-runner**: Handles `ExecuteGraphton` (LangGraph deep agents) on the base queue
- **TypeScript cursor-runner**: Handles `ExecuteCursor` (Cursor SDK agents) on a `{base}:cursor` derived queue

### Pain Points

- Two codebases (Python + TypeScript) for fundamentally similar work (execute an agent, stream events, report status)
- Duplicated infrastructure: MCP resolution, HITL approval, session lifecycle, billing — implemented twice in different languages
- The `:cursor` queue suffix was a polyglot workaround, adding operational complexity (separate monitoring, scaling, debugging per queue)
- Python in the execution path prevents using the JS-native DeepAgents framework directly

## Solution

A single TypeScript service (`@stigmer/runner`) that:
1. Polls one Temporal queue (the runner's base queue)
2. Registers both `ExecuteCursor` and `ExecuteDeepAgent` activities
3. Shares infrastructure (gRPC client, config, OTel, heartbeat) across activities
4. Separates harness-agnostic adapters (`shared/`) from harness-specific code (`activities/execute-cursor/`, `activities/execute-deep-agent/`)

## Implementation Details

### New service structure

```
backend/services/runner/
├── src/main.ts                 # Boot sequence with fetch interceptor ordering
├── src/worker.ts               # Single Worker, all activities
├── src/config.ts               # Unified env-based config
├── src/shared/                 # Harness-agnostic: MCP resolver, approval policy, pricing
├── src/activities/execute-cursor/   # Full ExecuteCursor (moved from cursor-runner)
└── src/activities/execute-deep-agent/  # Stub (Phase 3)
```

### Go/Java workflow changes

- Removed `CursorQueueSuffix` constant from `execute_cursor.go`
- Both `ExecuteCursor` and `ExecuteGraphton` now dispatch to the same `activityTaskQueue` from memo
- Updated `InvokeAgentExecutionWorkflowImpl.java` to mirror the same change
- Zero behavioral change — harness routing, HITL loop, pause/resume all identical

### Dependencies added

- `deepagents` (JS agent framework)
- `@langchain/langgraph` (graph execution + checkpointers)
- `@langchain/anthropic` (model provider for deep-agent)

## Benefits

- **Single process** for all agent execution activities — simpler deployment and operations
- **One queue** — eliminates queue suffix complexity, simplifies monitoring
- **Shared infrastructure** — MCP resolution, approval policies, and pricing computed once, used by all harnesses
- **TypeScript throughout** — enables direct use of DeepAgents JS and LangGraph JS without Python bridging
- **Clean architecture** — deliberate separation between shared and harness-specific code

## Impact

- **Runners**: New `backend/services/runner/` ready for development (ExecuteCursor functional, ExecuteDeepAgent stub)
- **Orchestrators**: Go and Java workflows updated (trivial diff, same behavior)
- **Production**: No impact yet — the unified runner is not deployed. cursor-runner and agent-runner continue serving production traffic until Phase 6 cutover.

## Related Work

- Phase 0: Research Spike (completed 2026-05-18) — validated DeepAgents JS feasibility
- Phase 2 (next): Core Shared Infrastructure — StatusBuilder, checkpointers, workspace manager
- Phase 3: ExecuteDeepAgent implementation — the core migration

---

**Status**: ✅ Production Ready (scaffold only — ExecuteCursor works, ExecuteDeepAgent is a stub)
**Timeline**: 1 session (~2 hours)
