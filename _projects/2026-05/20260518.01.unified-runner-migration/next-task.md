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
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-8-phase3c.md
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
**Last Session**: 2026-05-19 — Phase 3c HITL + Approval  
**Current Task**: Phase 4 — Supporting Activities  
**Status**: Phase 3c COMPLETE — approval gate middleware (interrupt/resume), HITL resume infrastructure (DB-driven, Command builder), sub-agent concurrency limiter (max 3), sub-agent middleware wiring (periodic budget, shared cost cap); 341 tests passing

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 3c)

**4 new files**:
- **middleware/approval-gate.ts** — `ApprovalGateMiddleware`; checks merged policies via `wrapToolCall`, calls LangGraph `interrupt()` for approval-required tools; platform tool defaults (safe: read/ls/glob/grep/think; dangerous: write/edit/delete/execute/shell)
- **activities/execute-deep-agent/hitl.ts** — `resolveResumeInput()` DB-driven resume; reads approval decisions from persisted execution, matches to LangGraph checkpoint interrupts, builds `Command(resume={...})`; `reconcileToolCallStatuses()` for status reconciliation
- **shared/subagent-gate.ts** — `SubAgentGate` Promise-based semaphore (max 3 concurrent); non-blocking rejection (error-shaped response); slot tracking
- **activities/execute-deep-agent/subagent-wiring.ts** — `buildSubAgentMiddleware()` per-sub-agent stack: loop detection (fresh) + execution budget (periodic: interval=30, max=4) + tool truncation + cost cap view (shared via `forSubAgent()`)

**5 new test files**, 38 new tests (341 total), typecheck clean, build clean

**Modified files:**
- `middleware/types.ts` — added `ApprovalGateConfig` to `MiddlewareStackConfig`
- `middleware/index.ts` — integrated `ApprovalGateMiddleware` (after graceful-stop, before cost-cap)
- `status-builder.ts` — added `ApprovalPolicyProvider`, `setApprovalProvider()`, WAITING_FOR_APPROVAL on tool start, argsPreview sanitization
- `streaming.ts` — detect WAITING_FOR_APPROVAL after stream ends, return terminal status without COMPLETED
- `post-stream.ts` — skip all post-stream processing when WAITING_FOR_APPROVAL
- `setup.ts` — resolve approval policies via `mergeApprovalPolicies()`, added `approvalPolicies`/`toolServerMap`/`autoApproveAll` to SetupResult
- `index.ts` — wire HITL resume: `resolveResumeInput()`, rejection fast-path, approval provider on StatusBuilder

### Design Decisions (Phase 3c)

- **DD-8: Middleware-based approval gating.** Approval checks in `wrapToolCall` middleware, not per-tool wrapping. All execution controls stay in the middleware stack.
- **DD-9: Platform tool defaults included.** Safe tools auto-approved; dangerous tools require approval when no explicit policy. Unknown tools default to auto-approved.
- **DD-10: Summarization deferred to Phase 4.** Custom summarization (880 Python lines) is independent from HITL. Phase 4 will verify DeepAgents JS built-in vs custom.

### Prior Sessions
- **Phase 3b-iii (2026-05-19)**: Artifact storage, inline publishing, writeback — see `checkpoints/2026-05-19-session-7-phase3b-iii.md`
- **Phase 3b-ii (2026-05-19)**: Full middleware stack (8 modules) — see `checkpoints/2026-05-19-session-6-phase3b-ii.md`
- **Phase 3b-i (2026-05-19)**: StatusBuilder, streaming, scheduler, retry — see `checkpoints/2026-05-19-session-5-phase3b-i.md`
- **Phase 3a (2026-05-19)**: Walking skeleton — invoke() + final message extract
- **Phase 2 (2026-05-19)**: Core shared infrastructure — see `checkpoints/2026-05-19-session-3-phase2.md`
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported

## Next Steps

1. **Phase 4: Supporting Activities** — EnsureThread, MCP discovery, classify tool approvals; `@langchain/openai` multi-provider support; MCP package pre-installer; connect backfill for undiscovered servers; skill relevance filtering; summarization middleware verification (DeepAgents JS built-in vs custom port)
2. **Phase 5: Testing** — port Python tests, integration, HITL e2e

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent has full streaming pipeline + middleware stack + artifact/writeback
- Artifact storage: `src/shared/artifact-storage.ts` (interface, local, proxy, factory)
- Inline publisher: `src/activities/execute-deep-agent/inline-publisher.ts` (fire-and-forget, SHA-256 dedup)
- Writeback coordinator: `src/activities/execute-deep-agent/writeback-coordinator.ts` (incremental git, per-entry mutex)
- Post-stream: `src/activities/execute-deep-agent/post-stream.ts` + `auto-publish.ts`
- Middleware: `src/middleware/` (types, think-tool, tool-truncation, error-hints, loop-detection, graceful-stop, execution-budget, cost-cap, otel-spans, approval-gate, index)
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager, mcp-resolver, grpc-retry, model-pricing, artifact-storage, approval-policy, subagent-gate)
- Deep agent modules: `src/activities/execute-deep-agent/` (index, setup, environment, prompt-builder, status-builder, streaming, streaming-scheduler, execution-state, inline-publisher, writeback-coordinator, auto-publish, post-stream, hitl, subagent-wiring)
- Python `agent-runner` still handles `ExecuteGraphton` on the base queue until cutover
- `cursor-runner` remains in production until Phase 7 cleanup

## Deferred Items

### ~~Phase 3b-iii (Artifacts + Writeback)~~ — COMPLETE
- ~~Artifact storage + inline publisher~~ Done (local + proxy backends, fire-and-forget publish, SHA-256 dedup)
- ~~Writeback coordinator~~ Done (incremental git, per-entry mutex, GitHub PR creation)
- ~~Post-stream safety net~~ Done (auto-publish + writeback finalize)

### ~~Phase 3c (HITL + Approval)~~ — COMPLETE
- ~~HITL interrupt/resume~~ Done (approval gate middleware + `Command(resume=...)` builder)
- ~~Approval policy integration~~ Done (middleware-based, platform tool defaults)
- ~~Sub-agent concurrency limiter~~ Done (`SubAgentGate`, max 3, non-blocking rejection)
- ~~Sub-agent middleware wiring~~ Done (`buildSubAgentMiddleware()` with `forSubAgent()` cost cap)
- ~~Sub-agent budget policies~~ Done (periodic mode: interval=30, max=4 advisories)
- Summarization middleware → deferred to Phase 4 (DD-10)

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
- **Artifact storage proxy flow**: Runner calls `POST /v1/proxy/artifacts/presigned-upload-url` to get presigned URL, then PUTs content directly to R2. No R2 credentials in the runner.
- **Incremental writeback**: Branch `stigmer/{first8chars}` created on first file write. PR auto-updates on subsequent pushes. finalize() catches files modified by shell commands or other non-tool paths.

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
| 3b-iii | Artifacts + Writeback | 2-3 | COMPLETE |
| 3c | HITL + Approval | 2-3 | COMPLETE |
| 4 | Supporting Activities | 2-3 | **NEXT** |
| 5 | Testing | 3-4 | Blocked on Phase 4 |
| 6 | Deployment | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Phase 3b-iii files**: `src/shared/artifact-storage.ts`, `src/activities/execute-deep-agent/{inline-publisher,writeback-coordinator,auto-publish,post-stream}.ts`
- **Phase 3b-ii files**: `src/middleware/{types,think-tool,tool-truncation,error-hints,loop-detection,graceful-stop,execution-budget,cost-cap,otel-spans,index}.ts`
- **Phase 3b-i files**: `src/activities/execute-deep-agent/{status-builder,streaming,streaming-scheduler,execution-state}.ts` + `src/shared/grpc-retry.ts`
- **Phase 3a files**: `src/activities/execute-deep-agent/{index,setup,environment,prompt-builder}.ts`
- **Gate decision**: `design-decisions/003-t01-gate-decision.md`
- **Graphton module audit**: `design-decisions/001-t01a-graphton-module-audit.md`

## Quick Commands

- "Continue with Phase 4" — Start Supporting Activities implementation
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
