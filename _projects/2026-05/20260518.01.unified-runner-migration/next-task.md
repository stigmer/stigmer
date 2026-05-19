# Next Task: 20260518.01.unified-runner-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260518.01.unified-runner-migration

**Description**: Migrate Python agent-runner and TypeScript cursor-runner into a single unified TypeScript runner service (`backend/services/runner/`), eliminating Python from the agent execution path and creating a common codebase for both LangGraph deep agents and Cursor SDK harnesses.

**Goal**: Single TypeScript runner service that handles ExecuteDeepAgent, ExecuteCursor, EnsureThread, DiscoverMcpServer, and ClassifyToolApprovals — with all shared infrastructure unified. Python agent-runner, cursor-runner, and graphton library deleted after validated cutover.

**Tech Stack**: TypeScript/Node.js, Temporal SDK, deepagents JS (npm), LangGraph JS, Connect-ES (gRPC), @bufbuild/protobuf, Vitest

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-3-phase2.md
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

### Coding Guidelines / Wrong Assumptions / Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/coding-guidelines/
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/wrong-assumptions/
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/dont-dos/
```

## Current State

**Created**: 2026-05-18 15:11  
**Last Session**: 2026-05-19 — Phase 2 core shared infrastructure  
**Current Task**: Phase 3 — ExecuteDeepAgent Activity  
**Status**: Phase 2 COMPLETE — shared infrastructure in place; deep agent implementation is next

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 2)
- **2d** `shared/status.ts` — extracted `persistStatus`, `reportSetupProgress`, `slimStatus`, `utcTimestamp`; ExecuteCursor updated
- **2b** `shared/checkpointer/` — MemorySaver + HttpCheckpointSaver (HTTP proxy to Java); config fields added
- **2c** `shared/workspace/` — provisioner (git, local path, empty), local backend, file tree
- **2a** `shared/mcp-manager.ts` — `MultiServerMCPClient`, cloud compatibility warnings
- **52 new tests** (70 total), typecheck clean, build clean

### Key Decisions (Phase 2)
- Checkpointer: **memory (OSS)** + **HTTP proxy (cloud)** — SQLite and direct MongoDB dropped
- **StatusBuilder deferred to Phase 3** — LangGraph vs Cursor event models are too different for a speculative shared abstraction now
- MCP cloud guard: **warn only** for non-installable stdio commands (no proto change)

### Prior Sessions
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported, ExecuteDeepAgent stub — see `checkpoints/2026-05-19-session-2.md`

## Next Steps

1. **Phase 3: ExecuteDeepAgent** — wire shared checkpointer, MCP manager, workspace provisioner; port graphton-ts middleware; build LangGraph StatusBuilder
2. Implement HITL interrupt/resume with LangGraph `interrupt()` + `Command({ resume })`
3. **Phase 4**: EnsureThread, MCP discovery, classify tool approvals (after Phase 3)

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent still stub
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager)
- Python `agent-runner` still handles `ExecuteGraphton` on the base queue until cutover
- `cursor-runner` remains in production until Phase 7 cleanup
- Remote workspace backend (Daytona) and MCP package installer deferred to Phase 3+

## Open Questions / Design Notes

- **Cursor Cloud + native stdio MCP**: npx/node-based stdio generally works when passed to Cursor SDK; arbitrary local binaries do not. Deep-agent stdio is runner-managed. See changelog and Phase 2 plan for validation-guard approach.
- **HttpCheckpointSaver**: Must stay wire-compatible with Java proxy (`$binary` serde format)

## Blockers

None.

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Days | Status |
|-------|------|-----------|--------|
| 0 | Research Spike (T01) | 1 | COMPLETE |
| 1 | Service Scaffold | 2 | COMPLETE |
| 2 | Core Shared Infrastructure | 3-4 | COMPLETE |
| 3 | ExecuteDeepAgent Activity | 4-5 | **NEXT** |
| 4 | Supporting Activities | 2-3 | Blocked on Phase 3 |
| 5 | Testing | 3-4 | Blocked on Phase 4 |
| 6 | Deployment | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Phase 2 changelog**: `_changelog/2026-05/2026-05-19-150821-unified-runner-phase2-shared-infrastructure.md`
- **Gate decision**: `design-decisions/003-t01-gate-decision.md`

## Quick Commands

- "Continue with Phase 3" — Start ExecuteDeepAgent implementation
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
