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
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-16-phase4-skill-relevance.md
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
**Last Session**: 2026-05-19 — Phase 4 Skill Relevance Filtering  
**Current Task**: Phase 5 — Testing (next)  
**Status**: Phase 4 COMPLETE — all supporting activities ported, skill relevance filtering done, Daytona removed from scope; 542 tests passing

## Session Progress (2026-05-19, latest)

### What Was Accomplished (Phase 4 — Skill Relevance Filtering)

**4 new files**:
- **`src/shared/skill-relevance.ts`** — BM25-based skill scoring: tokenization with stop-word removal, IDF computation, term-frequency saturation, document-length normalization. Threshold of 8 skills activates filtering; safety floor keeps at least half included.
- **`src/shared/skill-writer.ts`** — Complete skill pipeline: `mergeSkillRefs`, `fetchSkillsByRefs`, `writeSkills` (ZIP extraction), `generatePromptSection` (progressive disclosure), `generateAlsoAvailableSection`, `fetchSkillArtifacts`, `checkSkillIntegrity` (resume fast-path).
- **`src/shared/__tests__/skill-relevance.test.ts`** — 27 unit tests covering tokenization, BM25 scoring, threshold filtering, safety floor, alphabetical ordering.
- **`src/shared/__tests__/skill-writer.test.ts`** — 27 unit tests covering merge logic, gRPC fetch with error resilience, workspace writing, prompt generation, artifact downloads.

**1 file modified**:
- **`src/activities/execute-deep-agent/setup.ts`** — Added Step 7b: merge skill_refs from agent + session, fetch skills via gRPC, download artifacts, write to workspace, apply BM25 relevance filter, generate prompt section.

**Key decisions**: (1) Zero external dependencies for BM25 (standard library only). (2) Daytona sandbox removed from roadmap — runners execute inside Daytona sandboxes created by stigmer-service; no runner-level SDK needed. (3) ZIP parser is minimal and built-in (node:zlib). (4) Shared modules in `src/shared/` (not activity-specific) for eventual cursor-runner consolidation.

**Results**: 542 tests passing (54 new). `tsc --noEmit` clean. No new dependencies.

### Prior Sessions (Phase 4 — Connect Backfill for Deep Agent)

**Key accomplishments**: Shared connect backfill module unified into `src/shared/connect-backfill.ts`; wired into deep-agent setup between `resolveMcpServers()` and `connectMcpServers()`; MCP pre-installer removed (unnecessary — npx/uvx self-install); 488 tests passing (17 new).

### Prior Sessions (Phase 4 — Multi-Provider Model Support)

**Key findings**: (1) Proxy routing was broken — TS runner passed bare `proxyEndpoint` to LangChain without `/v1/proxy/llm/{provider}` suffix expected by `LlmProxyController`. (2) Gemini deferred — cloud proxy only supports openai + anthropic; no `google` provider in `LlmProxyConfig`. (3) `createDeepAgent` is provider-agnostic (`BaseLanguageModel | string` param); `cache_control` annotations are no-op for non-Anthropic. (4) 471 tests passing (39 new).

### Prior Sessions
- **Phase 4 Skill Relevance Filtering (2026-05-19)**: BM25 scoring + skill pipeline for deep-agent — see `checkpoints/2026-05-19-session-16-phase4-skill-relevance.md`
- **Phase 4 Connect Backfill (2026-05-19)**: Shared connect-backfill module + wired into deep-agent — see `checkpoints/2026-05-19-session-15-phase4-connect-backfill.md`
- **Phase 4 Multi-Provider Model Support (2026-05-19)**: OpenAI + Anthropic via proxy; proxy routing bug fix — see `checkpoints/2026-05-19-session-14-phase4-multi-provider.md`
- **Phase 4 Summarization Verification (2026-05-19)**: DeepAgents built-in confirmed correct — see `checkpoints/2026-05-19-session-13-phase4-summarization-verification.md`
- **Phase 4 ConnectMcpServerWorkflow (2026-05-19)**: First Temporal workflow in TS runner — see `checkpoints/2026-05-19-session-12-phase4-connect-workflow.md`
- **Phase 4 DiscoverMcpServer (2026-05-19)**: MCP server discovery activity — see `checkpoints/2026-05-19-session-11-phase4-discover-mcp-server.md`
- **Phase 4 ClassifyToolApprovals (2026-05-19)**: LLM tool safety classifier — see `checkpoints/2026-05-19-session-10-phase4-classify-tool-approvals.md`
- **Phase 4 EnsureThread (2026-05-19)**: Thread ID resolution — see `checkpoints/2026-05-19-session-9-phase4-ensurethread.md`
- **Phase 3c (2026-05-19)**: HITL approval gate, sub-agent infrastructure — see `checkpoints/2026-05-19-session-8-phase3c.md`
- **Phase 3b-iii (2026-05-19)**: Artifact storage, inline publishing, writeback — see `checkpoints/2026-05-19-session-7-phase3b-iii.md`
- **Phase 3b-ii (2026-05-19)**: Full middleware stack (8 modules) — see `checkpoints/2026-05-19-session-6-phase3b-ii.md`
- **Phase 3b-i (2026-05-19)**: StatusBuilder, streaming, scheduler, retry — see `checkpoints/2026-05-19-session-5-phase3b-i.md`
- **Phase 3a (2026-05-19)**: Walking skeleton — invoke() + final message extract
- **Phase 2 (2026-05-19)**: Core shared infrastructure — see `checkpoints/2026-05-19-session-3-phase2.md`
- **Phase 1 (2026-05-19 earlier)**: Service scaffold, single queue, ExecuteCursor ported

## Next Steps

1. ~~**Phase 4: Supporting Activities**~~ — **COMPLETE**. All items done or removed from scope.
2. **Phase 5: Testing** — port Python tests, integration tests, HITL e2e validation. This is the next phase to work on.

## Context for Resume

- Unified runner: `backend/services/runner/` — ExecuteCursor production-ready; ExecuteDeepAgent has full streaming pipeline + middleware stack + artifact/writeback + multi-provider model support (Anthropic + OpenAI); EnsureThread ported from Python; ClassifyToolApprovals ported with @langchain/openai structured output; DiscoverMcpServerCapabilities ported with MultiServerMCPClient + raw MCP Client access; ConnectMcpServerWorkflow ported as first TS Temporal workflow
- Workflows: `src/workflows/` — `connect-mcp-server.ts` (discover → classify with fingerprint short-circuit), `types.ts` (snake_case boundary types), `index.ts` (ES2022 string-named exports for Temporal workflow type names)
- Discovery: `src/activities/discover-mcp-server.ts` — connects via stdio or HTTP, enumerates tools + resource templates, computes tools fingerprint + newToolsFingerprint, extracts previous state for connect workflow short-circuit
- Artifact storage: `src/shared/artifact-storage.ts` (interface, local, proxy, factory)
- Inline publisher: `src/activities/execute-deep-agent/inline-publisher.ts` (fire-and-forget, SHA-256 dedup)
- Writeback coordinator: `src/activities/execute-deep-agent/writeback-coordinator.ts` (incremental git, per-entry mutex)
- Post-stream: `src/activities/execute-deep-agent/post-stream.ts` + `auto-publish.ts`
- Middleware: `src/middleware/` (types, think-tool, tool-truncation, error-hints, loop-detection, graceful-stop, execution-budget, cost-cap, otel-spans, approval-gate, index)
- Shared modules: `src/shared/` (status, checkpointer, workspace, mcp-manager, mcp-resolver, connect-backfill, grpc-retry, model-pricing, artifact-storage, approval-policy, subagent-gate, model-registry, llm-proxy, placeholder-resolver, skill-relevance, skill-writer)
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
- ~~Summarization middleware~~ VERIFIED in Phase 4 — DeepAgents JS built-in confirmed correct (DD-004); 15 verification tests added; 432 total tests passing

### Phase 4+ (Supporting) — COMPLETE
- ~~ConnectMcpServerWorkflow~~ Done (discover → classify with fingerprint short-circuit, ES2022 string-named exports for Temporal type names, snake_case boundary adapter)
- ~~Multi-provider model support~~ Done (Anthropic + OpenAI via proxy; `llm-proxy.ts` shared module; proxy routing bug fixed; 39 new tests)
- ~~Connect backfill~~ Done (shared `connect-backfill.ts` module, wired into deep-agent `setup.ts` + cursor delegates to shared; 17 new tests)
- ~~MCP package pre-installer~~ Removed (npx/uvx/go-run self-install; no MCP server in seedpack needs explicit pre-installation; 270s discovery timeout is sufficient for cold starts)
- ~~Skill relevance filtering~~ Done (BM25 scoring, threshold=8, safety floor=n/2, progressive disclosure prompt; 54 new tests)
- ~~Remote workspace backend (Daytona sandbox)~~ Removed (runner runs inside Daytona sandbox managed by stigmer-service; no runner-level SDK needed)

## Open Questions / Design Notes

- **Gemini/Google provider**: Cloud proxy (`LlmProxyConfig`) only supports `openai` + `anthropic`. Adding Gemini requires: (1) `google` provider in `LlmProxyConfig.java`, (2) auth injection in `LlmProxyController`, (3) `harness: "native"` registry entries, (4) `@langchain/google-genai` in runner. Cross-repo work (stigmer + stigmer-cloud).
- **Cursor Cloud + native stdio MCP**: npx/node-based stdio generally works when passed to Cursor SDK; arbitrary local binaries do not. Deep-agent stdio is runner-managed.
- **HttpCheckpointSaver**: Must stay wire-compatible with Java proxy (`$binary` serde format)
- **streamEvents**: Phase 3b-i switched from `invoke()` to `streamEvents()` v2. StatusBuilder consumes events and builds status proto progressively. Persistence cadence uses hybrid time+event scheduler.
- **StigmerMiddleware type**: Defined locally in `src/middleware/types.ts` because `AgentMiddleware` is not directly importable from `deepagents` (it's a transitive type from nested `langchain`). Structurally compatible — langchain uses structural typing.
- **Artifact storage proxy flow**: Runner calls `POST /v1/proxy/artifacts/presigned-upload-url` to get presigned URL, then PUTs content directly to R2. No R2 credentials in the runner.
- **Incremental writeback**: Branch `stigmer/{first8chars}` created on first file write. PR auto-updates on subsequent pushes. finalize() catches files modified by shell commands or other non-tool paths.
- **Temporal TS workflow sandbox**: Workflow files run in a deterministic V8 isolate — no `node:crypto`, `fs`, or `net`. Fingerprint computation moved to activity. Type-only imports from activity files are safe (stripped by bundler).
- **Wire format convention**: Workflow boundary types use snake_case (matching Java `Map<String, Object>` keys). Internal TS activity types use camelCase. Workflow is the boundary adapter. Temporal TS SDK does plain JSON.parse/stringify — no automatic name transformation.
- **ES2022 string-named exports**: Temporal TS derives workflow type from export name. Java uses `"stigmer/mcp-server/connect"` (slashes). Solved with `export { fn as "stigmer/mcp-server/connect" }` — TypeScript 5.0+ supports this.

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
| 4 | Supporting Activities | 2-3 | **COMPLETE** (all items done or removed from scope; 542 tests passing) |
| 5 | Testing | 3-4 | **NEXT** |
| 6 | Deployment | 2-3 | Blocked on Phase 5 |
| 7 | Cleanup | 1-2 | Blocked on Phase 6 |

## Key References

- **Unified runner**: `backend/services/runner/`
- **Phase 4 workflows**: `src/workflows/connect-mcp-server.ts`, `src/workflows/types.ts`, `src/workflows/index.ts`
- **Phase 4 activities**: `src/activities/discover-mcp-server.ts`, `src/activities/classify-tool-approvals.ts`, `src/activities/ensure-thread.ts`, `src/shared/model-registry.ts`
- **Phase 3b-iii files**: `src/shared/artifact-storage.ts`, `src/activities/execute-deep-agent/{inline-publisher,writeback-coordinator,auto-publish,post-stream}.ts`
- **Phase 3b-ii files**: `src/middleware/{types,think-tool,tool-truncation,error-hints,loop-detection,graceful-stop,execution-budget,cost-cap,otel-spans,index}.ts`
- **Phase 3b-i files**: `src/activities/execute-deep-agent/{status-builder,streaming,streaming-scheduler,execution-state}.ts` + `src/shared/grpc-retry.ts`
- **Phase 3a files**: `src/activities/execute-deep-agent/{index,setup,environment,prompt-builder}.ts`
- **Phase 4 summarization verification**: `src/activities/execute-deep-agent/__tests__/summarization-verification.test.ts`
- **Gate decision**: `design-decisions/003-t01-gate-decision.md`
- **Summarization decision**: `design-decisions/004-summarization-middleware.md`
- **Graphton module audit**: `design-decisions/001-t01a-graphton-module-audit.md`

## Quick Commands

- "Start Phase 5" — Testing: port Python tests, integration, HITL e2e
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
