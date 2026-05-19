# Next Task: 20260518.01.unified-runner-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260518.01.unified-runner-migration

**Description**: Migrate Python agent-runner and TypeScript cursor-runner into a single unified TypeScript runner service (backend/services/runner/), eliminating Python from the agent execution path and creating a common codebase for both LangGraph deep agents and Cursor SDK harnesses.
**Goal**: Single TypeScript runner service that handles ExecuteDeepAgent, ExecuteCursor, EnsureThread, DiscoverMcpServer, and ClassifyToolApprovals — with all shared infrastructure (MCP resolver, HITL, status builder) unified. Python agent-runner, cursor-runner, and graphton library deleted after validated cutover.
**Tech Stack**: TypeScript/Node.js, Temporal SDK, deepagents JS (npm), LangGraph JS, Connect-ES (gRPC), @bufbuild/protobuf, Vitest

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/dont-dos/
```

## Current Status

**Created**: 2026-05-18 15:11
**Current Task**: Phase 1 — Service Scaffold
**Status**: COMPLETE — unified runner service scaffolded, typecheck passes, tests pass, Go/Java workflow updated

## Session Progress (2026-05-19)

### What Was Accomplished
- Created `backend/services/runner/` as a fresh TypeScript package (not a copy)
- Built shared infrastructure: config, OTel, heartbeat, idle-watchdog, gRPC client
- Extracted harness-agnostic adapters into `shared/`: mcp-resolver, placeholder-resolver, approval-policy, model-pricing
- Moved ExecuteCursor activity with all cursor-specific adapters into `activities/execute-cursor/`
- Created ExecuteDeepAgent activity stub (Phase 3 implementation pending)
- Built `main.ts` + `worker.ts` — single Worker polling one queue with both activities
- Removed `CursorQueueSuffix` from Go (`stigmer-server`) and Java (`stigmer-cloud`) workflow orchestrators
- All 18 tests pass, typecheck clean, build clean

### Key Decisions Made
- **Single queue architecture**: Eliminated the `:cursor` queue suffix. Both activities register on the base queue (`runner:{id}`). Temporal routes by activity name.
- **Fresh package, selective moves**: Started `backend/services/runner/` from scratch rather than copying cursor-runner wholesale. Deliberate inclusion of each module.
- **Shared vs cursor-specific split**: MCP resolution, approval policies, and model pricing are harness-agnostic in `shared/`. Cursor SDK lifecycle, fetch interceptor, hook scripts stay in `activities/execute-cursor/`.
- **Go/Java workflow change in Phase 1**: Rather than deferring, we made the trivial workflow change now (remove suffix, both activities dispatch to same queue).

### Key Discoveries
- The `@stigmer/protos` package exports use `.ts` extension mapping (`"./*": "./*.ts"`) — imports must NOT have `.js` suffix
- The cursor-runner's 20+ adapter files all moved cleanly once import paths were adjusted
- Go workflow change was 2 lines (remove constant + remove suffix concatenation)

## Next Steps
1. **Phase 2: Core Shared Infrastructure** — Extract MCP manager, checkpointer, status builder from existing runners into shared/
2. Add `@langchain/langgraph-checkpoint-mongodb` for production checkpointers
3. Build the StatusBuilder equivalent in TypeScript (streaming execution status → gRPC)
4. Wire up the workspace/sandbox management for deep-agent activity

## Context for Resume
- The unified runner is at `backend/services/runner/` — fully functional for ExecuteCursor, stub for ExecuteDeepAgent
- The Go/Java workflow now dispatches both activities to the same base queue
- cursor-runner still exists and works in production — it won't be deleted until Phase 7
- The ExecuteDeepAgent stub returns EXECUTION_FAILED with a clear message — safe to deploy but won't handle real traffic
- Python agent-runner is unmodified and still handles ExecuteGraphton on the base queue

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Days | Status |
|-------|------|-----------|--------|
| 0 | Research Spike (T01) | 1 | COMPLETE |
| 1 | Service Scaffold | 2 | COMPLETE |
| 2 | Core Shared Infrastructure — MCP, workspace, checkpointer, status | 3-4 | NEXT |
| 3 | ExecuteDeepAgent Activity — the core migration | 4-5 | Blocked on Phase 2 |
| 4 | Supporting Activities — EnsureThread, MCP discovery, classify | 2-3 | Blocked on Phase 3 |
| 5 | Testing — port Python tests, integration, HITL e2e | 3-4 | Blocked on Phase 4 |
| 6 | Deployment — sandbox image, CI, cutover | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup — delete Python/cursor-runner, graphton, update CI | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Python agent-runner** (to be retired): `backend/services/agent-runner/`
- **TypeScript cursor-runner** (to be retired): `backend/services/cursor-runner/`
- **Go workflow**: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`
- **Gate decision**: `_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/003-t01-gate-decision.md`

## Quick Commands

After loading context:
- "Continue with Phase 2" - Start core shared infrastructure
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
