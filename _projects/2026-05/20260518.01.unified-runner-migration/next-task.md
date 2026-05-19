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
**Last Session**: 2026-05-19 — Phase 3a walking skeleton  
**Current Task**: Phase 3b — Middleware + StatusBuilder  
**Status**: Phase 3a COMPLETE — ExecuteDeepAgent wired end-to-end; middleware and streaming status are next

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 3a)
- **ExecuteDeepAgent activity** — replaced stub with full working implementation
- **Setup pipeline** (`setup.ts`) — orchestrates: hydrate execution, chain resolution, checkpointer, workspace provisioning, MCP connection, model construction, `createDeepAgent`
- **Environment resolver** (`environment.ts`) — fetches ExecutionContext, extracts vars + secret tracking
- **Prompt builder** (`prompt-builder.ts`) — workspace sections (single/multi-entry), skills, file refs, injected files, response rules, sub-agent delegation rules
- **Model construction** — pre-constructed `ChatAnthropic` with explicit proxy `baseURL` routing
- **Agent execution** — `invoke()` with final message extraction; result persisted as `AgentExecutionStatus`
- **Proper cleanup** — MCP connection closed in finally block
- **24 new tests** (90 total), typecheck clean, build clean

### Key Decisions (Phase 3a)
- **SetupResult trimmed** — excludes artifact_storage, inline_publisher, writeback_coordinator (deferred to 3b)
- **Model construction: explicit** — pre-constructed `BaseChatModel` with proxy `baseURL`, not global fetch interceptor
- **Streaming: minimal** — `invoke()` + final message capture; full `streamEvents()` with progressive updates deferred to 3b
- **Error contract: simple** — single-attempt gRPC with try/catch + log; GrpcRetryExecutor deferred to 3b
- **OpenAI support: deferred** — explicit error thrown if non-Anthropic model requested; multi-provider is Phase 4

### Prior Sessions
- **Phase 2 (2026-05-19)**: Core shared infrastructure — see `checkpoints/2026-05-19-session-3-phase2.md`
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported — see `checkpoints/2026-05-19-session-2.md`

## Next Steps

1. **Phase 3b: Middleware + StatusBuilder** — port graphton-ts middleware (loop detection, cost cap, execution budget, tool truncation, graceful stop, error hints, think tool, OTel spans); build LangGraph StatusBuilder (event-to-proto mapping with progressive streaming updates); add artifact storage + inline publisher + writeback coordinator; add GrpcRetryExecutor
2. **Phase 3c: HITL + Approval** — implement interrupt/resume (`interruptOn` + `Command({ resume })`); wire approval policy; sub-agent concurrency limiter; verify summarization middleware config parity
3. **Phase 4**: EnsureThread, MCP discovery, classify tool approvals; `@langchain/openai` multi-provider support; MCP package pre-installer; connect backfill for undiscovered servers; skill relevance filtering; cost pricing integration

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent functional (walking skeleton)
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager)
- Deep agent modules: `src/activities/execute-deep-agent/` (index, setup, environment, prompt-builder)
- Python `agent-runner` still handles `ExecuteGraphton` on the base queue until cutover
- `cursor-runner` remains in production until Phase 7 cleanup

## Deferred Items (from Phase 3a)

These items were explicitly unscoped from Phase 3a and MUST be implemented in the indicated follow-up phase:

### Phase 3b (Middleware + StatusBuilder)
- StatusBuilder: LangGraph event-to-proto mapping with progressive streaming updates via `streamEvents()`
- Middleware stack: loop detection, cost cap, execution budget, tool truncation, graceful stop, error hints, think tool, OTel spans
- Artifact storage + inline publisher (for publishing files the agent writes)
- Writeback coordinator (git write-back for workspace changes)
- GrpcRetryExecutor (exponential-backoff retry for status persistence)
- Switch from `invoke()` to `streamEvents()` for progressive UI updates

### Phase 3c (HITL + Approval)
- HITL interrupt/resume (`interruptOn` config + `Command({ resume })`)
- Approval policy integration (tool-level approval checks before execution)
- Sub-agent concurrency limiter (Promise-based semaphore, max 3)
- Summarization middleware config parity verification (DeepAgents JS built-in vs custom)

### Phase 4+ (Supporting)
- `@langchain/openai` multi-provider model support
- MCP package pre-installer (npm/pip install before tool connections)
- Connect backfill for undiscovered/stale MCP servers
- Skill relevance filtering (exclude low-relevance skills when count >= 8)
- Cost pricing integration (model pricing for cost cap middleware)
- Remote workspace backend (Daytona sandbox)

## Open Questions / Design Notes

- **Cursor Cloud + native stdio MCP**: npx/node-based stdio generally works when passed to Cursor SDK; arbitrary local binaries do not. Deep-agent stdio is runner-managed.
- **HttpCheckpointSaver**: Must stay wire-compatible with Java proxy (`$binary` serde format)
- **streamEvents vs invoke**: Phase 3a uses `invoke()` for simplicity. Phase 3b will switch to `streamEvents()` with v2 event version for progressive status updates. The StatusBuilder will consume these events.

## Blockers

None.

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Days | Status |
|-------|------|-----------|--------|
| 0 | Research Spike (T01) | 1 | COMPLETE |
| 1 | Service Scaffold | 2 | COMPLETE |
| 2 | Core Shared Infrastructure | 3-4 | COMPLETE |
| 3a | ExecuteDeepAgent Walking Skeleton | 1 | COMPLETE |
| 3b | Middleware + StatusBuilder | 3-4 | **NEXT** |
| 3c | HITL + Approval | 2-3 | Blocked on 3b |
| 4 | Supporting Activities | 2-3 | Blocked on 3c |
| 5 | Testing | 3-4 | Blocked on Phase 4 |
| 6 | Deployment | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Phase 3a files**: `src/activities/execute-deep-agent/{index,setup,environment,prompt-builder}.ts`
- **Phase 2 changelog**: `_changelog/2026-05/2026-05-19-150821-unified-runner-phase2-shared-infrastructure.md`
- **Gate decision**: `design-decisions/003-t01-gate-decision.md`
- **Graphton module audit**: `design-decisions/001-t01a-graphton-module-audit.md`

## Quick Commands

- "Continue with Phase 3b" — Start middleware + StatusBuilder implementation
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
