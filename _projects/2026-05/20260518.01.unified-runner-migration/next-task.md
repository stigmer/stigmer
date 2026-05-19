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
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-7-phase3b-iii.md
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
**Last Session**: 2026-05-19 — Phase 3b-iii Artifacts + Writeback  
**Current Task**: Phase 3c — HITL + Approval  
**Status**: Phase 3b-iii COMPLETE — artifact storage (local+proxy), inline publisher (fire-and-forget, SHA-256 dedup), incremental git writeback (branch/commit/push/PR), auto-publish safety net, post-stream orchestrator; 303 tests passing

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 3b-iii)

**5 new files**:
- **shared/artifact-storage.ts** — `ArtifactStorage` interface, `LocalArtifactStorage` (filesystem for OSS), `ProxyArtifactStorage` (presigned URL via side-channel proxy for cloud), `createArtifactStorage()` factory
- **execute-deep-agent/inline-publisher.ts** — `InlinePublisher` class; fire-and-forget callback on file-modifying tool completion; reads file, computes SHA-256, uploads to storage, builds `ExecutionArtifact` proto, registers on StatusBuilder; dedup by path+contentHash
- **execute-deep-agent/writeback-coordinator.ts** — `WriteBackCoordinator` class; incremental git cycle: detects changes → create branch → commit → push → create PR via GitHub REST API; per-entry mutex (Promise-chain lock); eligibility filtering (GIT_REPO + credentials + writeBackMode); finalize() safety net
- **execute-deep-agent/auto-publish.ts** — `autoPublishWrittenFiles()` post-stream safety net; scans completed tool calls for file-modifying ops, publishes files not already published inline
- **execute-deep-agent/post-stream.ts** — `processPostStream()` orchestrator: drain pending publish promises → drain pending writeback promises → auto-publish safety net → writeback finalize; each step independently try/caught

**5 new test files**, 68 new tests (303 total), typecheck clean, build clean

**Modified files:**
- `status-builder.ts` — `addArtifact()` (dedup by sandboxPath, replace on contentHash change) and `addWriteBack()` (upsert by workspaceEntryName)
- `streaming.ts` — file-modification detection on `on_tool_end`, fires inlinePublisher.publish() + writebackCoordinator.onFileModified() as background promises, returns pendingPublish/WritebackPromises in StreamResult
- `setup.ts` — creates ArtifactStorage via factory, adds `artifactStorage` + `provisionResults` to SetupResult
- `index.ts` — creates InlinePublisher + WriteBackCoordinator (conditional on provisionResults), passes to streamExecution, calls processPostStream after streaming, logs artifact/writeback counts

### Design Decisions (Phase 3b-iii)

- **DD-5: Incremental writeback, not batch.** Commit+push on each file-modifying tool call. PR created on first push. finalize() as post-stream safety net only. Matches Python for real-time UX — users see PR link the moment the first file is written.
- **DD-6: Local + Proxy artifact storage only.** No direct R2 upload. Local filesystem for OSS; proxy-based presigned URL upload for cloud. Runner stays credential-light.
- **DD-7: Defer skill-aware publishing.** Publish individual files only. No SKILL.md directory detection or ZIP packaging. Foundation exists in proto (`kind: DIRECTORY`, `entries[]`) for future enhancement.

### Prior Sessions
- **Phase 3b-ii (2026-05-19)**: Full middleware stack (8 modules) — see `checkpoints/2026-05-19-session-6-phase3b-ii.md`
- **Phase 3b-i (2026-05-19)**: StatusBuilder, streaming, scheduler, retry — see `checkpoints/2026-05-19-session-5-phase3b-i.md`
- **Phase 3a (2026-05-19)**: Walking skeleton — invoke() + final message extract
- **Phase 2 (2026-05-19)**: Core shared infrastructure — see `checkpoints/2026-05-19-session-3-phase2.md`
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported

## Next Steps

1. **Phase 3c: HITL + Approval** — implement interrupt/resume (`interruptOn` + `Command({ resume })`); wire approval policy; sub-agent concurrency limiter; wire forSubAgent() views; verify summarization middleware config parity
2. **Phase 4**: EnsureThread, MCP discovery, classify tool approvals; `@langchain/openai` multi-provider support; MCP package pre-installer; connect backfill for undiscovered servers; skill relevance filtering; cost pricing integration

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent has full streaming pipeline + middleware stack + artifact/writeback
- Artifact storage: `src/shared/artifact-storage.ts` (interface, local, proxy, factory)
- Inline publisher: `src/activities/execute-deep-agent/inline-publisher.ts` (fire-and-forget, SHA-256 dedup)
- Writeback coordinator: `src/activities/execute-deep-agent/writeback-coordinator.ts` (incremental git, per-entry mutex)
- Post-stream: `src/activities/execute-deep-agent/post-stream.ts` + `auto-publish.ts`
- Middleware: `src/middleware/` (types, think-tool, tool-truncation, error-hints, loop-detection, graceful-stop, execution-budget, cost-cap, otel-spans, index)
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager, grpc-retry, model-pricing, artifact-storage)
- Deep agent modules: `src/activities/execute-deep-agent/` (index, setup, environment, prompt-builder, status-builder, streaming, streaming-scheduler, execution-state, inline-publisher, writeback-coordinator, auto-publish, post-stream)
- Python `agent-runner` still handles `ExecuteGraphton` on the base queue until cutover
- `cursor-runner` remains in production until Phase 7 cleanup

## Deferred Items

### ~~Phase 3b-iii (Artifacts + Writeback)~~ — COMPLETE
- ~~Artifact storage + inline publisher~~ Done (local + proxy backends, fire-and-forget publish, SHA-256 dedup)
- ~~Writeback coordinator~~ Done (incremental git, per-entry mutex, GitHub PR creation)
- ~~Post-stream safety net~~ Done (auto-publish + writeback finalize)

### Phase 3c (HITL + Approval) — NEXT
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
| 3c | HITL + Approval | 2-3 | **NEXT** |
| 4 | Supporting Activities | 2-3 | Blocked on 3c |
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

- "Continue with Phase 3c" — Start HITL + Approval implementation
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
