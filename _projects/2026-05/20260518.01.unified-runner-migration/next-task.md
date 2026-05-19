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
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-6-phase3b-ii.md
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
**Last Session**: 2026-05-19 — Phase 3b-ii Middleware Stack  
**Current Task**: Phase 3b-iii — Artifacts + Writeback  
**Status**: Phase 3b-ii COMPLETE — full middleware stack (7 middleware + think tool + OTel spans/metrics) wired into createDeepAgent; GracefulStop with activate() pattern; 235 tests passing

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 3b-ii)

**10 new files** in `src/middleware/`:
- **types.ts** — `StigmerMiddleware` interface (structural match for langchain `AgentMiddleware`), `ToolCallRequest`, `ModelCallRequest`, `MiddlewareStackConfig`, per-middleware config types
- **think-tool.ts** — no-op `think(thought: string)` LangChain tool for structured reasoning
- **tool-truncation.ts** — `wrapToolCall` middleware; prefix-truncates tool results > 30K chars with marker
- **error-hints.ts** — `enrichErrorMessage()` utility + `createErrorHintsMiddleware()` wrapToolCall that catches tool errors and adds recovery hints
- **loop-detection.ts** — `afterModel` + `wrapToolCall`; SHA-256 signature tracking in sliding window; consecutive + total thresholds; SystemMessage interventions + hard tool block
- **graceful-stop.ts** — `activate(reason)` pattern (DD-1); `afterModel` injects stop message once; `wrapToolCall` blocks tools; `forSubAgent()` delegation view
- **execution-budget.ts** — `wrapModelCall` (safe advisory injection avoiding AIMessage/ToolMessage ordering violation); threshold mode + periodic mode with escalating urgency
- **cost-cap.ts** — `afterModel` extracts usage_metadata, computes cost via model pricing; warning at 80%, hard block at 100%; `forSubAgent()` shared-budget delegation view
- **otel-spans.ts** — `wrapModelCall` + `wrapToolCall`; `stigmer.llm.call` + `stigmer.mcp.tool_call` spans + 6 metric instruments (2 histograms, 4 counters)
- **index.ts** — `buildMiddlewareStack(config)` factory; ordered composition matching Python create_deep_agent

**8 test files**, 66 new tests (235 total), typecheck clean, build clean

**Modified files:**
- `setup.ts` — middleware stack wired into `createDeepAgent({ middleware })`, think tool added to tools array, `gracefulStop` on `SetupResult`, model pricing loaded for cost cap, OTel tool-server map built from MCP connections
- `streaming.ts` — STOP signal now calls `gracefulStop.activate()` instead of breaking the loop (graceful summary instead of hard stop)
- `index.ts` — passes `gracefulStop` through to streaming
- `main.ts` — `initMetrics("stigmer-runner")` wired alongside `initTracing()`

### Design Decisions (Phase 3b-ii)

- **DD-1: Graceful Stop — activate() method, not AbortController.** AbortController semantics ("cancel immediately") conflict with graceful stop ("let model summarize"). activate() is semantically precise, battle-tested (matches Python), and keeps Temporal cancellation (isCancelledFn) cleanly separate.
- **DD-2: Error Hints — wired as middleware now.** Every tool error gets actionable recovery hints from day one. The utility function is independently importable for future contexts.
- **DD-3: OTel — spans AND metrics from day one.** initMetrics() was already implemented; 6 metric instruments added matching Python/Go schemas. Production observability requires both traces and aggregates.
- **DD-4: Sub-agent views — forSubAgent() implemented now.** CostCap and GracefulStop both have working delegation views. Phase 3c assembles them into sub-agent middleware arrays.

### Prior Sessions
- **Phase 3b-i (2026-05-19)**: StatusBuilder, streaming, scheduler, retry — see `checkpoints/2026-05-19-session-5-phase3b-i.md`
- **Phase 3a (2026-05-19)**: Walking skeleton — invoke() + final message extract
- **Phase 2 (2026-05-19)**: Core shared infrastructure — see `checkpoints/2026-05-19-session-3-phase2.md`
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported

## Next Steps

1. **Phase 3b-iii: Artifacts + Writeback** — artifact storage (scan/upload/proto), writeback coordinator (branch/commit/push/PR), inline publisher (file contents during execution)
2. **Phase 3c: HITL + Approval** — implement interrupt/resume (`interruptOn` + `Command({ resume })`); wire approval policy; sub-agent concurrency limiter; wire forSubAgent() views; verify summarization middleware config parity
3. **Phase 4**: EnsureThread, MCP discovery, classify tool approvals; `@langchain/openai` multi-provider support; MCP package pre-installer; connect backfill for undiscovered servers; skill relevance filtering; cost pricing integration

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent has full streaming pipeline + middleware stack
- Middleware: `src/middleware/` (types, think-tool, tool-truncation, error-hints, loop-detection, graceful-stop, execution-budget, cost-cap, otel-spans, index)
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager, grpc-retry, model-pricing)
- Deep agent modules: `src/activities/execute-deep-agent/` (index, setup, environment, prompt-builder, status-builder, streaming, streaming-scheduler, execution-state)
- Python `agent-runner` still handles `ExecuteGraphton` on the base queue until cutover
- `cursor-runner` remains in production until Phase 7 cleanup

## Deferred Items

### ~~Phase 3b-ii (Middleware Stack)~~ — COMPLETE
- ~~Middleware stack: loop detection, cost cap, execution budget, tool truncation, graceful stop, error hints, think tool, OTel spans~~ Done
- ~~GracefulStopMiddleware wiring~~ Done (activate() pattern, DD-1)
- ~~OTel metrics~~ Done (initMetrics wired in main.ts, DD-3)

### Phase 3b-iii (Artifacts + Writeback) — NEXT
- Artifact storage + inline publisher (for publishing files the agent writes)
- Writeback coordinator (git write-back for workspace changes)

### Phase 3c (HITL + Approval)
- HITL interrupt/resume (`interruptOn` config + `Command({ resume })`)
- Approval policy integration (tool-level approval checks before execution)
- Sub-agent concurrency limiter (Promise-based semaphore, max 3)
- Sub-agent middleware wiring (pass forSubAgent() views into sub-agent middleware arrays)
- Sub-agent budget policies (periodic mode: every 30 rounds, max 4 advisories)
- Summarization middleware config parity verification (DeepAgents JS built-in vs custom)

### Phase 4+ (Supporting)
- `@langchain/openai` multi-provider model support
- MCP package pre-installer (npm/pip install before tool connections)
- Connect backfill for undiscovered/stale MCP servers
- Skill relevance filtering (exclude low-relevance skills when count >= 8)
- Remote workspace backend (Daytona sandbox)

## Open Questions / Design Notes

- **Cursor Cloud + native stdio MCP**: npx/node-based stdio generally works when passed to Cursor SDK; arbitrary local binaries do not. Deep-agent stdio is runner-managed.
- **HttpCheckpointSaver**: Must stay wire-compatible with Java proxy (`$binary` serde format)
- **streamEvents**: Phase 3b-i switched from `invoke()` to `streamEvents()` v2. StatusBuilder consumes events and builds status proto progressively. Persistence cadence uses hybrid time+event scheduler.
- **StigmerMiddleware type**: Defined locally in `src/middleware/types.ts` because `AgentMiddleware` is not directly importable from `deepagents` (it's a transitive type from nested `langchain`). Structurally compatible — langchain uses structural typing.

## Blockers

None.

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Days | Status |
|-------|------|-----------|--------|
| 0 | Research Spike (T01) | 1 | COMPLETE |
| 1 | Service Scaffold | 2 | COMPLETE |
| 2 | Core Shared Infrastructure | 3-4 | COMPLETE |
| 3a | ExecuteDeepAgent Walking Skeleton | 1 | COMPLETE |
| 3b-i | StatusBuilder + GrpcRetryExecutor | 1 | COMPLETE |
| 3b-ii | Middleware Stack | 3-4 | COMPLETE |
| 3b-iii | Artifacts + Writeback | 2-3 | **NEXT** |
| 3c | HITL + Approval | 2-3 | Blocked on 3b |
| 4 | Supporting Activities | 2-3 | Blocked on 3c |
| 5 | Testing | 3-4 | Blocked on Phase 4 |
| 6 | Deployment | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Phase 3b-ii files**: `src/middleware/{types,think-tool,tool-truncation,error-hints,loop-detection,graceful-stop,execution-budget,cost-cap,otel-spans,index}.ts`
- **Phase 3b-i files**: `src/activities/execute-deep-agent/{status-builder,streaming,streaming-scheduler,execution-state}.ts` + `src/shared/grpc-retry.ts`
- **Phase 3a files**: `src/activities/execute-deep-agent/{index,setup,environment,prompt-builder}.ts`
- **Gate decision**: `design-decisions/003-t01-gate-decision.md`
- **Graphton module audit**: `design-decisions/001-t01a-graphton-module-audit.md`

## Quick Commands

- "Continue with Phase 3b-iii" — Start artifacts + writeback implementation
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
