# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: In Progress
- **Last Session**: April 30, 2026 -- T07 Session Lifecycle completed
- **Active Task**: T01-T07 + T09 COMPLETED, ready for T08
- **Branch**: `feat/cursor-harness`

## Session Progress (April 30, 2026)

### Session 1: T01 Proto Changes
- Added `Harness` enum (UNSPECIFIED, NATIVE, CURSOR) to `session/v1/enum.proto`
- Added `SessionSpec.harness` field (number 10) to `session/v1/spec.proto`
- Added `MESSAGE_THINKING = 5` to `MessageType` in `agentexecution/v1/enum.proto`
- Ran `buf lint`, `buf format`, `make codegen` -- all passed
- Regenerated stubs in stigmer-cloud via `make protos`
- 48 files committed across Go/Java/Python/TypeScript stubs, SDKs, docs, schemas
- **Renamed** `HARNESS_LANGGRAPH` to `HARNESS_NATIVE` -- LangGraph is an implementation detail; "native" names what the harness IS to the user (Stigmer's own built-in engine)

### Session 2: T02 HITL Research Spike
- Researched Cursor SDK TypeScript docs (full API surface)
- Researched Cursor Hooks system (preToolUse, sessionStart, all lifecycle events)
- Evaluated three HITL mechanisms: Cursor Hooks (chosen), SDKRequestMessage (supplementary), MCP Bridge (discarded)
- Explored Stigmer's full HITL system: approval protos, Python agent-runner interrupt flow, Go workflow signal pattern, SubmitApproval RPC, React approval components
- Explored Stigmer's MCP integration: config transform, policy chain, session merge
- Discovered Cursor's hooks system as a broader extensibility pattern Stigmer could adopt in the future (documented as strategic finding, not MVP)
- Wrote two design decision documents

### Key Decisions (T02)
- **Primary HITL mechanism**: Cursor `preToolUse` hooks (deterministic, non-bypassable)
- **Discarded**: MCP bridge (relies on agent cooperation, bypassable)
- **No proto changes needed**: Hooks bridge is internal to cursor-runner
- **Execution interceptors (Cursor hooks-like system)**: Documented as strategic future concept, NOT included in MVP
- **Built-in Cursor tool approval**: Runner-local policy (Shell/Delete require approval, Read/Grep allow by default)

### Design Decision Documents (T02)
- `design-decisions/hitl-cursor-hooks-approach.md` -- Cursor harness HITL bridge design
- `design-decisions/execution-interceptors-concept.md` -- Future extensibility concept (shelved)

### Session 3: T03 Cursor Runner TypeScript Service
- Created `backend/services/cursor-runner/` -- 15 TypeScript files, full Temporal activity worker
- Resolved 5 major architecture decisions collaboratively before implementation
- **Key architecture revision**: Changed from blocking HITL model to durable hook-deny + workflow reinvoke model (same pattern as LangGraph)
- Mapped `SessionSpec.thread_id` to Cursor `agentId` (no new proto fields needed)
- Confirmed pause/resume support via `run.cancel()` + `Agent.resume()`
- Same `approvalGateResolved` signal pattern as LangGraph -- minimal T04 workflow changes needed

### Key Decisions (T03)
- **Activity signature**: `ExecuteCursor(executionId, threadId)` -- parallel to `ExecuteGraphton`
- **Durable HITL**: Hook-deny + activity returns to workflow + reinvoke (NOT blocking). Survives 10-day approval waits.
- **thread_id reuse**: `SessionSpec.thread_id` stores Cursor agentId (same field, harness-aware semantics)
- **Approval notification**: Same `approvalGateResolved` signal -- no polling, no new infra
- **Pause/resume**: `run.cancel()` + `Agent.resume()` -- maps to existing workflow signals
- **No HTTP server for hooks**: Simplified to file-based state (hook reads JSON state file)

### Files Created (T03)
```
backend/services/cursor-runner/
  package.json, tsconfig.json
  src/main.ts, config.ts, worker.ts
  src/activity/execute-cursor.ts
  src/adapter/message-translator.ts, usage-tracker.ts, mcp-resolver.ts, session-lifecycle.ts
  src/client/stigmer-client.ts
  src/hitl/workspace-setup.ts, hook-script.ts, approval-policy.ts, approval-state.ts
```

### Session 4: T04 Workflow Harness Dispatch (Go + Java)
- Added harness-based dispatch to Go and Java workflows -- Cursor sessions now route to ExecuteCursor
- Removed vestigial `approvalDecisions` parameter from ExecuteGraphton across Go, Java, and Python
- Added Harness to DispatchResult and WorkflowInput (propagation from session DB through dispatch to workflow)
- Created ExecuteCursorActivity interface + stub (Go + Java)
- Created ReadSessionThreadId local activity (Go + Java) for Cursor agentId resolution
- Added executeCursorFlow with same HITL loop and pause/resume as Graphton
- Skip GenerateSessionSubject for Cursor (generates conversation context natively)
- Committed across both stigmer and stigmer-cloud repos

### Session 5: T05 CLI Daemon Multi-Worker Management + Cursor Proxy Architecture
- Researched Cursor SDK proxy support -- no `baseURL` parameter on `Agent.create()`
- **Critical finding**: Proxy IS feasible via `global.fetch` interception (JavaScript-level equivalent of LangChain's `base_url`)
- Created `src/proxy/fetch-interceptor.ts` -- rewrites Cursor-bound requests to `STIGMER_PROXY_ENDPOINT/v1/proxy/cursor/...`, replaces auth with `STIGMER_TOKEN`
- Updated `config.ts` with two credential modes: direct (local, `CURSOR_API_KEY`) and proxy (cloud, `STIGMER_PROXY_ENDPOINT` + `STIGMER_TOKEN`)
- Updated `main.ts` with critical load ordering: interceptor installs BEFORE SDK import (dynamic import of worker.ts)
- Created `embedded/cursorrunner/` package (SourceFS, SourceDir, dev-mode locator, embed placeholder)
- Created `nodert/bootstrap.go` -- shared Node.js version check, npm install, tsx resolution
- Added cursor-runner as optional managed component in daemon (`buildComponents` expansion)
- Added cursor-runner to standalone runner path (`startNativeRunner` dual-worker support)
- Standalone cloud env builder passes `STIGMER_PROXY_ENDPOINT` to enable proxy mode
- Both workers share the same runner identity and task queue (Temporal routes by activity type)
- Non-fatal: if cursor-runner bootstrap fails, agent-runner continues normally

### Key Decisions (T05)
- **Cursor proxy IS feasible**: `global.fetch` interception before SDK load. SDK uses `fetch()` internally (Node.js 20+). Cursor documents enterprise proxy support with automatic SSE fallback.
- **Two credential modes**: Direct (local: `CURSOR_API_KEY` from user) and Proxy (cloud: `STIGMER_PROXY_ENDPOINT` + `STIGMER_TOKEN`, runner is credential-free). Architecturally identical to LLM proxy pattern.
- **Cursor harness is optional**: Env-var driven detection. Available when `CURSOR_API_KEY` set (local) or `STIGMER_PROXY_ENDPOINT` set (cloud).
- **System Node.js for dev mode**: Require >= 20 on PATH. Embedding (bun compile) deferred to T09.
- **Both runner paths covered**: daemon (`stigmer up server`) and standalone (`stigmer up` / `stigmer up runner`).
- **Docker runner path deferred**: Multi-process container pattern not in T05 scope.
- **Shared nodert package**: `EnsureNodeAvailable` + `EnsureDepsInstalled` + `TsxArgs` shared between daemon and standalone.
- **Non-fatal failures**: Bootstrap errors logged as warnings, daemon continues without cursor harness.
- **CursorProxyController**: Separate task in stigmer-cloud. Reverse proxy at `/v1/proxy/cursor/**`, same pattern as `LlmProxyController`.

### Session 6: T09 Embedded Cursor Runner Packaging
- **Critical finding**: `bun build --compile` is NOT viable -- Temporal Worker SDK requires Node-API native modules, worker_threads, vm, async_hooks (all Node.js-specific)
- **Decision**: Mirror Python agentrunner pattern -- embed compiled JS source, download managed Node.js at first bootstrap, npm install for platform-specific native deps
- Created `nodert.Manager` (5 files) -- managed Node.js 22.22.2 LTS lifecycle, parallel to `pythonrt.Manager`
- Created `cursorrunner/sync.sh` -- build-time source preparation: copy TS, resolve protos, tsc compile, strip for embedding
- Created `tsconfig.build.json` for emit-capable TypeScript compilation
- Implemented dual-mode bootstrap: dev (system Node.js + tsx) and embed (`nodert.Manager` + compiled JS)
- New `CursorRunnerBootstrapResult` type with `EntryArgs` -- daemon process reads entry point from env
- Updated daemon.go, daemon_process.go, runner/start.go for new bootstrap API
- Created BUILD.bazel for cursorrunner and nodert packages
- Updated release.cli.yaml (3 platform jobs), release.desktop.yaml, setup-sidecar-dev.sh with cursor-runner sync + embed_cursorrunner tag
- Updated root Makefile: cursorrunner devSourceDir ldflags + clean target

### Key Decisions (T09)
- **Bun compile invalidated**: Temporal Worker SDK requires Node.js-specific APIs. Bun is unsupported.
- **Node.js SEA rejected**: Cross-compilation requires per-platform builds, native module handling is fragile.
- **Mirror Python pattern**: Embed source via go:embed, download managed Node.js (22.22.2 LTS) at first bootstrap, npm install for native deps. Same UX as Python.
- **tsc at build time, npm at runtime**: TypeScript compiled during sync.sh. npm install runs at runtime because @temporalio/core-bridge is platform-specific.
- **Two-mode bootstrap**: Dev mode (system Node.js + tsx) preserved. Embed mode (managed Node.js + compiled JS) for release.
- **Entry args via env var**: `STIGMER_CURSOR_RUNNER_ENTRY_ARGS` communicates entry point from bootstrap to daemon process.

### Key Decisions (T04)
- **EnsureThread skipped for Cursor**: Python's EnsureThread generates deterministic "thread-{sessionId}" which is not a valid Cursor agentId. Cursor flow uses ReadSessionThreadId instead.
- **approvalDecisions removed (not added to Cursor)**: Parameter was always nil/null. Both harnesses read decisions from DB. Cleaner to remove than perpetuate.
- **Minimal branching**: Cursor flow structurally identical to Graphton -- same HITL loop, same pause/resume, same signals. Only variation: threadId source and activity type.
- **No GenerateSessionSubject for Cursor**: Cursor generates conversation context natively during execution; redundant LLM call avoided.
- **invokerIdentityAccountId on Java ExecuteCursor**: Added for forward-compatibility even though not used by cursor-runner today.

### Session 7: T06 Cost Model and Billing Integration
- **Critical architecture fix**: T03's `UsageTracker` built aggregate `UsageMetrics` but the system uses per-message `LlmCallMetrics`. Rewrote to match established pattern.
- **Research finding**: Cursor SDK `TurnEndedUpdate.usage` provides token counts only (no cost, no pricing). `totalCents` exists only in Admin/Analytics API, not real-time SDK events.
- Created `model-pricing.ts` -- Cursor model pricing registry from published rates at cursor.com/docs/models-and-pricing
- Rewrote `usage-tracker.ts` -- `recordTurn()` now returns `LlmCallMetrics` with pricing stamped at call time
- Modified `execute-cursor.ts` -- stamps `LlmCallMetrics` on `MESSAGE_AI` messages via `pendingMetrics` queue
- Added `"cursor"` provider and model entries to React `MODEL_REGISTRY`
- **Verified**: Go server, Java service, React hooks, and all usage UI work for Cursor sessions with zero changes

### Key Decisions (T06)
- **Per-message LlmCallMetrics**: Matches Python agent-runner pattern. Entire downstream pipeline works unchanged.
- **Static Cursor pricing table**: SDK doesn't provide cost. Rates sourced from Cursor's published pricing page, stamped at execution time.
- **Provider = "cursor"**: Cursor is the billing provider from Stigmer's perspective.
- **One LlmCallMetrics per Cursor turn**: Finest granularity available from the SDK.

### Design Decision Documents (T06)
- `design-decisions/cursor-cost-model.md` -- Full rationale for cost model decisions

### Session 8: T07 Session Lifecycle -- Cursor Agent Management
- **Bug fix**: `ReadSessionThreadId` local activity was never registered on the Go Temporal worker. Added registration in `worker_config.go`. Without this, every Cursor harness execution would fail at runtime.
- **Resume failure hardening**: Removed dangerous silent fallback in `resolveAgent()`. When `Agent.resume()` fails for an existing session (agent expired/deleted on Cursor's side), the execution now fails with a clear, actionable error instead of silently creating a new agent and losing all conversation context.
- **Session delete restricted to operators**: Added `can_delete_session` permission (`IamPermission = 26`) gated at platform level. Changed session delete RPC annotation from `can_delete` on session to `can_delete_session` on `platform:stigmer`. Updated FGA models: added `can_delete_session: operator` to `platform.fga`, removed `can_delete: owner` from `session.fga`. Protects billing/audit trail.
- **Verified Java wiring**: Java `readSessionThreadId` correctly wired via `UpdateExecutionStatusActivity` local activity stub. No registration gap (unlike Go).
- **Verified threadId persistence**: `execute-cursor.ts` correctly persists `agent.agentId` as `session.spec.thread_id` via the update RPC. Safe from concurrent modification because session spec is immutable during execution.
- Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) -- all passed.

### Key Decisions (T07)
- **Session delete restricted to operators**: Protects billing audit trail. Regular users cannot delete sessions. Operator-only via FGA `can_delete_session` permission on `platform:stigmer`.
- **Cursor agent cleanup deferred**: Session delete does NOT call `Agent.archive` on Cursor's side. Cursor agents expire naturally. Revisit when SDK lifecycle semantics are better understood.
- **Resume failure = fail loud**: No silent fallback. If `Agent.resume()` fails, execution fails with actionable error: "Please start a new session to continue."

## Next Steps

Phase 4 (Polish) is nearly complete. T07 done, T08 remaining.

Ready for:

1. **T08: SDK/React -- Session Harness Picker** -- UI for selecting native vs Cursor harness.

### Recommended Next Pick
- **T08** -- The final task. UI component for harness selection when creating a session.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/checkpoints/
```

### 2. Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
```

### 4. Changed Proto Files (for reference)
- `apis/ai/stigmer/agentic/session/v1/enum.proto` -- Harness enum
- `apis/ai/stigmer/agentic/session/v1/spec.proto` -- SessionSpec.harness field
- `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto` -- MESSAGE_THINKING
- `apis/ai/stigmer/iam/v1/enum.proto` -- `can_delete_session` permission (T07)
- `apis/ai/stigmer/agentic/session/v1/command.proto` -- Session delete RPC: operator-only (T07)

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260430.01.cursor-harness/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status (T01-T07 + T09 done, T08 pending)
3. [ ] Review T07 changes: `worker_config.go` (ReadSessionThreadId registration), `session-lifecycle.ts` (fail-loud resume), `command.proto` + FGA models (operator-only delete)
4. [ ] Review design decisions for context (especially `cursor-cost-model.md`, `embedded-packaging-strategy.md`, `cursor-sdk-proxy-support.md`)
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Pick next task: T08 (SDK/React session harness picker)

## Quick Commands

After loading context:
- "Start T08" - Begin SDK/React session harness picker
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
