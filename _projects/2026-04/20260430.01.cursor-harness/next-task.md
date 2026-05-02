# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests + cloud availability fix + unified model selector + dev-mode startup delay fix + agent blueprint propagation + RUNNER_PHASE_STARTING lifecycle + cursor-runner enum crash fix + parallel bootstrap + Temporal routing fix + process resilience + proxy observability + **event visibility (tool calls, sub-agents, thinking)**
- **Last Session**: May 2, 2026 — Session 21: Cursor Harness Event Visibility
- **Active Task**: None — event visibility fixes committed
- **Branch**: `feat/cursor-harness`

## Session Progress (May 2, 2026 — Session 21)

### Cursor Harness Event Visibility

Diagnosed and fixed three layers of data loss in the cursor-runner's SDK-to-UI pipeline. The cursor-runner was capturing 176+ SDK events per execution but persisting only 2 messages (assistant text). Tool calls, sub-agent invocations, and thinking blocks were invisible.

**Live SDK Investigation**: Ran a diagnostic script against the real Cursor SDK (v1.0.11) capturing all three event channels (SDKMessage, InteractionUpdate, ConversationStep). Confirmed tool_call events carry structured args/result objects, run.conversation() works on local runs, and the onDelta channel provides rich typed data.

**Layer 1 — Tool Call Attachment**: Refactored MessageAccumulator to attach tool calls to the parent MESSAGE_AI message instead of creating standalone MESSAGE_TOOL messages. Handles running/completed/error lifecycle, multiple concurrent tool calls, and edge case of tool call before any AI text.

**Layer 2 — Sub-Agent Execution Tracking**: Task tool calls now produce SubAgentExecution protos with id, name, subject, input, status, timestamps, and output. execute-cursor.ts populates status.subAgentExecutions from the accumulator.

**Layer 3 — MESSAGE_THINKING UI**: Added collapsible ThinkingMessage component to MessageEntry.tsx with preview, expand/collapse, streaming support, and accessibility.

**Files changed**: message-translator.ts, execute-cursor.ts, message-translator.test.ts, MessageEntry.tsx
**Tests**: 160 passed (40 message-translator tests including new tool call attachment, sub-agent tracking, and edge case tests)
**Deferred**: onDelta enrichment and streaming enrichment (separate conversation)

## Session Progress (May 1, 2026 — Session 20)

### Cursor Runner Process Resilience and Proxy Observability

Diagnosed and fixed a crash where the Cursor SDK's background API key exchange threw an unhandled promise rejection that killed the entire Temporal worker. Ran three diagnostic tests (API key validation, endpoint reachability, direct SDK test) confirming the proxy architecture is correct — the crash was purely a resilience gap. Added process-level error handlers, structured proxy logging, and fixed the CursorProxyController's response header policy.

## Session Progress (May 1, 2026 — Session 19)

### Fix Temporal Activity Routing for Cursor Harness

Fixed a critical non-deterministic routing bug: Temporal dispatches activity tasks to any worker polling a queue without activity-type awareness. With both Python and TypeScript workers on the same queue, `ExecuteCursor` could be received by the Python worker — causing permanent `NotFoundError` failures.

**Root cause**: The design assumed "Temporal routes activities by activity type name" — this is incorrect. Temporal round-robins across all pollers on a queue.

**Fix**: Derived task queue convention `{baseQueue}:cursor`. The cursor-runner polls this derived queue; the Go/Java workflows dispatch `ExecuteCursor` to it.

**Files changed (OSS — commit 3803d1cd0):**
- `backend/services/cursor-runner/src/config.ts` — added `CURSOR_QUEUE_SUFFIX`
- `backend/services/cursor-runner/src/worker.ts` — polls derived queue
- `backend/services/cursor-runner/src/main.ts` — logs actual queue
- `backend/services/stigmer-server/.../execute_cursor.go` — dispatches to derived queue
- `backend/services/stigmer-server/.../invoke_workflow_impl.go` — updated docs
- `backend/services/stigmer-server/.../worker_config.go` — updated docs
- Design doc corrected

**Files changed (Cloud — commit 49ce29c4):**
- `InvokeAgentExecutionWorkflowImpl.java` — dispatches to derived queue

## Next Steps

1. **Re-sync embedded cursorrunner** — run `sync.sh` so the CLI embed picks up the process resilience, observability, and derived-queue changes
2. **Fix ApprovalAction enum bug** — correct `APPROVAL_ACTION_APPROVE`/`REJECT`/`ALWAYS_APPROVE` to `APPROVE`/`REJECT`/`ALWAYS_APPROVE` in `approval-state.ts` and `execute-cursor.ts`
3. **Implement env var resolution** for MCP server configs (${VAR_NAME} placeholders in stdio args and http headers)
4. **Implement cloud-mode attachment download** from artifact storage (currently only local mode)
5. **End-to-end validation**: Full blueprint propagation flow testing — now includes verifying Cursor executions route to the cursor-runner deterministically
6. Integration testing across the full flow (create session → execution → streaming → billing)
7. PR review and merge of `feat/cursor-harness` branch (stigmer OSS)
8. PR review and merge of CursorProxyController changes (stigmer-cloud)
9. Release

## Context for Resume

- All 135 cursor-runner tests pass; typecheck clean
- Blueprint propagation uses message-based instruction injection (not rules files) to avoid workspace pollution
- Skills use platform mount pattern: physical at `~/.stigmer/sessions/{id}/platform/`, symlinked from workspace `.stigmer/`
- MCP merge: session overrides agent by slug; skill refs: union deduplicated by slug
- Multi-workspace: resolved from `session.spec.workspaceEntries`, passed as `string[]` to Cursor SDK
- The `openai` native provider remains in `DISABLED_PROVIDERS` (only Cursor-served OpenAI models are visible)
- Node.js 22 strip-only mode cannot handle `export enum` — the embed path now pre-compiles proto stubs to JS via `sync.sh`
- The April 30 `import_extension=js` fix is a prerequisite for the enum crash fix (ensures correct import paths in compiled output)
- Daemon path (`daemon_process.go`) bootstrap is still sequential — parallelization deferred as a follow-up
- **NEW**: Temporal does NOT route activities by type name — it round-robins across pollers. Cursor-runner must poll a separate derived queue (`{baseQueue}:cursor`). Both Go and Java workflows apply the same suffix constant when dispatching `ExecuteCursor`.

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-19.md
```

### 2. Previous Checkpoints
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-18.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-17.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-05-01-session-16.md
```

### 4. Task Plan
```
_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 5. Design Decisions
```
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-cost-model.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/embedded-packaging-strategy.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-sdk-proxy-support.md
```

---

*This file provides direct paths to all project resources for quick context loading.*
