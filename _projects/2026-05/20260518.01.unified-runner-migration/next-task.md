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
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-20-session-20-phase5-tier6-w3-subagent-transformer.md
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
**Last Session**: 2026-05-20 — Phase 5 Tier 6 W3 (Subagent Transformer)  
**Current Task**: Phase 6 Deployment (or remaining Tier 6 integration tests)  
**Status**: W3 Subagent Transformer COMPLETE — 45 new tests (1057 total); Phase 5 Tier 6 COMPLETE

**Cross-project update (2026-05-21)**: E2E integration tests for the unified runner's IPC manager mode and per-session task queue routing are now implemented in `test/integration-session-routing/` (runner-architecture-simplification project, Session 11). The tests validate `createStigmerRunnerManager()` addSession/removeSession IPC protocol, per-session Worker creation, and `ExecuteCursor` activity dispatch on `session:{id}` queues. Discovery: `ExecuteGraphton` → `ExecuteDeepAgent` name mismatch means native harness per-session routing is blocked until Java workflow is updated.

## Session Progress (2026-05-20, latest)

### What Was Accomplished (Phase 5 Tier 6 W3 — Subagent Transformer)

**2 new files** (1 module + 1 test suite):
- **`src/activities/execute-deep-agent/subagent-transformer.ts`** — 340 LOC: `createBuiltinSubagents()` (explore+shell), `transformSingleSubagent()` (proto→spec), `filterMcpToolsForSubagent()` (slug validation + tool intersection), `collectAllSkillRefs()` + `resolveSubagentSkillPrompt()` (batch fetch + prompt inject), `compileSubagents()` (createDeepAgent + middleware + gate), `transformAndCompileSubagents()` (top-level orchestrator).
- **`src/activities/execute-deep-agent/__tests__/subagent-transformer.test.ts`** — 45 tests covering built-ins, core transform, MCP filtering, skill resolution, model validation, think tool injection, compilation, integration pipeline, edge cases.

**4 files modified**:
- **`src/shared/model-registry.ts`** — Added `isModelRegistered()` for SubAgent model override validation.
- **`src/shared/subagent-gate.ts`** — Added `wrapRunnable()` method using `RunnableLambda` for CompiledSubAgent integration.
- **`src/middleware/index.ts`** — Exposed `costCap` in `MiddlewareStackResult` for sub-agent cost sharing via `forSubAgent()`.
- **`src/activities/execute-deep-agent/setup.ts`** — Wired Step 11b: transform + compile subagents, pass to `createDeepAgent({ subagents })`.

**Design decisions**:
- CompiledSubAgent format (full middleware control over deepagents' unwanted defaults)
- Filter parent MCP tools (no reconnection; stateless REST bridges)
- Prompt injection for skills (StateBackend incompatible with native field)
- Built-in explore/shell use StateBackend built-ins + prompt-based tool restriction
- SubAgentGate wraps via RunnableLambda for Runnable interface compatibility
- Model override fail-fast (invalid override → skip subagent entirely)

**Results**: 1057 tests passing (45 new). `tsc --noEmit` clean. No new dependencies.

### Previous: What Was Accomplished (Phase 5 Tier 6 W2 — Attachment Injector)

**2 new files** (1 module + 1 test suite):
- **`src/activities/execute-deep-agent/attachment-injector.ts`** — 320 LOC: `validateZipForExtraction()` (pure, 7 security checks), `injectAttachments()` (collision detection, local/cloud download, fail-hard), typed error classes (`AttachmentInjectionError`, `AttachmentValidationError`).
- **`src/activities/execute-deep-agent/__tests__/attachment-injector.test.ts`** — 33 tests covering ZIP validation, injection flow, error propagation, collision detection, binary content, and edge cases.

**8 files modified**:
- **`src/shared/workspace/types.ts`** — Added `writeFileBuffer(path: string, content: Buffer)` to `WorkspaceBackend` interface.
- **`src/shared/workspace/local-backend.ts`** — Implemented `writeFileBuffer`, extracted `ensureParentDir` helper.
- **`src/__test-utils__/mock-workspace.ts`** — Added `writeFileBuffer` mock.
- **`src/activities/execute-deep-agent/setup.ts`** — Wired Step 7c: `injectAttachments()` between skills and prompt building; replaced `injectedFiles: []` with live result.
- **`src/activities/execute-deep-agent/__tests__/inline-publisher.test.ts`** — Added `writeFileBuffer` to inline mock.
- **`src/activities/execute-deep-agent/__tests__/writeback-coordinator.test.ts`** — Added `writeFileBuffer` to inline mock.
- **`src/shared/__tests__/skill-writer.test.ts`** — Added `writeFileBuffer` to inline mock.

**Design decisions**:
- Binary writes via separate `writeFileBuffer` (VS Code/Deno pattern)
- Fail-hard error handling (Kubernetes init containers pattern)
- Mount path collision rejection before downloads (Kubernetes volume mounts pattern)
- ZIP parser independent from skill-writer (different trust boundaries)

**Results**: 961 tests passing (33 new). `tsc --noEmit` clean. No new dependencies.

### Previous: What Was Accomplished (Phase 5 Tier 6 W1 — Platform Mount)

**4 new files** (2 modules + 2 test suites):
- **`src/shared/workspace/platform-mount.ts`** — 5 pure functions + 3 constants: classifyPlatformPath, humanizePlatformRefs, resolvePlatformCommand, humanizeSandboxPaths, resolveDisplayEnvVars. Ported from Python `graphton/core/backends/platform_mount.py`.
- **`src/shared/workspace/platform-dir.ts`** — Shared `getPlatformDir`/`ensurePlatformDir` for session-scoped platform directory. Replaces duplication in Cursor harness.
- **`src/shared/workspace/__tests__/platform-mount.test.ts`** — 61 tests covering all pure functions + combined pipeline.
- **`src/shared/workspace/__tests__/local-backend-platform.test.ts`** — 25 tests for routing, env injection, traversal safety, backward compat.

**5 files modified**:
- **`src/shared/workspace/types.ts`** — Added optional `platformDir` to `WorkspaceBackend` interface.
- **`src/shared/workspace/local-backend.ts`** — Added `.stigmer/` path routing via `resolvePath()`, `STIGMER_PLATFORM_DIR` env injection in `execute()`, auto-mkdir for platform writes, path traversal guard.
- **`src/activities/execute-deep-agent/setup.ts`** — Wired `ensurePlatformDir(sessionId)` into `provisionWorkspace()`, passes `platformDir` to all `LocalWorkspaceBackend` instances.
- **`src/activities/execute-cursor/skill-resolver.ts`** — Replaced local `getPlatformDir` with shared module.
- **`src/activities/execute-cursor/attachment-resolver.ts`** — Replaced local `getPlatformDir` with shared module.

**Design decision**: Chose separate `platformDir` over real `.stigmer/` directory. Skills/inputs physically live at `~/.stigmer/sessions/{sessionId}/platform/`, never inside workspace entries. Matches Python AD-01 v3 and existing Cursor harness pattern.

**Results**: 809 tests passing (86 new). `tsc --noEmit` clean. No new dependencies.

### Previous: What Was Accomplished (Phase 5 — Test Porting, Tiers 0–5)

**11 new files** (3 shared test-utils + 8 test suites):
- **`src/__test-utils__/mock-client.ts`** — Reusable StigmerClient mock factory.
- **`src/__test-utils__/mock-workspace.ts`** — Reusable WorkspaceBackend mock factory.
- **`src/__test-utils__/proto-helpers.ts`** — Shared proto message builders (emptyStatus, aiMessage, toolCall).
- **`src/shared/workspace/__tests__/file-tree.test.ts`** — 20 tests (zero before): ignores, depth/entry caps, gitignore, dotfiles, truncation.
- **`src/shared/workspace/__tests__/git-source.test.ts`** — 17 tests (zero before): clone, idempotent reuse, token injection/sanitization, targetSubdir, git excludes, metadata.
- **`src/shared/workspace/__tests__/local-backend.test.ts`** — 18 tests (3 before): execute, read/write/exists, cwd options, absolute paths, initializeLocalWorkspace.
- **`src/shared/__tests__/placeholder-resolver.test.ts`** — 26 tests (zero before): `${VAR}` resolution, strict errors, headers, filterEnvToDeclaredKeys, pattern edge cases.
- **`src/shared/__tests__/approval-policy.test.ts`** — 16 tests (zero before): four-level merge chain, autoApproveAll, pinned overrides, lookupMcpToolPolicy, resolveApprovalMessage.
- **`src/shared/__tests__/grpc-retry-extended.test.ts`** — 13 tests: INTERNAL/ALREADY_EXISTS codes, mixed error sequences, maxRetries=0, custom backoff.
- **`src/shared/__tests__/artifact-storage-extended.test.ts`** — 18 tests: local upload/download/exists, proxy presign flow, createArtifactStorage factory.
- **`src/activities/execute-deep-agent/__tests__/execution-state-extended.test.ts`** — 8 tests: rebuildToolCallIndex, resetEphemeralState, reference identity.

**1 file modified**:
- **`src/activities/execute-deep-agent/__tests__/status-builder.test.ts`** — +45 tests: approval provider integration, args sanitization, namespace routing, usage edge cases, error resilience, concurrent tools, thinking interleaving, content edge cases.

**Results**: 723 tests passing (181 new). `tsc --noEmit` clean. No new dependencies. 51 test files (8 new).

### Deferred: Phase 5 Tier 6 (Feature-Gap Items)

The following Python tests cover features with **no TS implementation**. These require building new modules, not just porting tests:

| Feature | Python Tests | Module Needed |
|---------|-------------|---------------|
| Subagent transformer | 39 | `subagent-transformer.ts` — SubAgent proto → runtime format |
| Task-aware relevance | 60 | `relevance.ts` — file path extraction from user messages |
| Attachment injection | 30 | `attachment-injector.ts` — ZIP extraction with security guards |
| Platform mount | 21 | `platform-mount.ts` — virtual mount path routing |
| Integration: skill pipeline | 36 | E2E test for gRPC fetch → artifact → ZIP → prompt |
| Integration: subagent pipeline | 9 | E2E for transform → MCP → skill injection |
| Multi-workspace integration | 21 | Full provisioner → file tree → prompt section |
| Skill client | 7 | Dedicated gRPC client unit tests |

**Total deferred: ~223 tests** across 8 feature areas. These are Phase 5 Tier 6 scope or can be bundled with Phase 6.

### Prior Session (Phase 4 — Skill Relevance Filtering, 2026-05-19)

**4 new files**: skill-relevance.ts, skill-writer.ts, and their test suites (54 tests).
**1 file modified**: setup.ts — Step 7b: skill pipeline wiring.
**Results**: 542 tests passing.

### Prior Sessions (Phase 4 — Connect Backfill for Deep Agent)

**Key accomplishments**: Shared connect backfill module unified into `src/shared/connect-backfill.ts`; wired into deep-agent setup between `resolveMcpServers()` and `connectMcpServers()`; MCP pre-installer removed (unnecessary — npx/uvx self-install); 488 tests passing (17 new).

### Prior Sessions (Phase 4 — Multi-Provider Model Support)

**Key findings**: (1) Proxy routing was broken — TS runner passed bare `proxyEndpoint` to LangChain without `/v1/proxy/llm/{provider}` suffix expected by `LlmProxyController`. (2) Gemini deferred — cloud proxy only supports openai + anthropic; no `google` provider in `LlmProxyConfig`. (3) `createDeepAgent` is provider-agnostic (`BaseLanguageModel | string` param); `cache_control` annotations are no-op for non-Anthropic. (4) 471 tests passing (39 new).

### Prior Sessions
- **Phase 5 Tier 6 W3 Subagent Transformer (2026-05-20)**: Proto→CompiledSubAgent pipeline — see `checkpoints/2026-05-20-session-20-phase5-tier6-w3-subagent-transformer.md`
- **Phase 5 Tier 6 W2 Attachment Injector (2026-05-20)**: Full attachment injection pipeline — see `checkpoints/2026-05-20-session-19-phase5-tier6-w2-attachment-injector.md`
- **Phase 5 Tier 6 W1 Platform Mount (2026-05-20)**: Virtual platform mount with separate platformDir — see `checkpoints/2026-05-20-session-18-phase5-tier6-w1-platform-mount.md`
- **Phase 5 Test Porting (2026-05-20)**: 181 new tests across 8 files — see `checkpoints/2026-05-20-session-17-phase5-test-porting.md`
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

1. ~~**Phase 4: Supporting Activities**~~ — **COMPLETE**.
2. ~~**Phase 5 Tiers 0–5: Testing**~~ — **COMPLETE** (181 new tests, 723 total).
3. ~~**Phase 5 Tier 6: Feature-Gap Modules**~~ — **COMPLETE** (W1 Platform Mount, W2 Attachment Injector, W3 Subagent Transformer all done; 1057 total tests).
4. **Phase 6: Deployment** — Docker image, queue routing, cutover plan.

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
| 5 | Testing | 3-4 | **COMPLETE** (Tiers 0–6 done; 1057 tests passing) |
| 6 | Deployment | 2-3 | **NEXT** |
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

- "Start Phase 6" — Deployment: Docker image, queue routing, cutover
- "Show project status" — Roadmap and file overview
- `@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md` — Resume context

---

*This file provides direct paths to all project resources for quick context loading.*
