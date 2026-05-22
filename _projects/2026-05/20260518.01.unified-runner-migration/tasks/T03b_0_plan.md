# Task T03b: Middleware + StatusBuilder (Phase 3b)

**Created**: 2026-05-19
**Status**: READY FOR EXECUTION
**Type**: Implementation (3 sub-phases)
**Phase**: 3b
**Depends on**: Phase 3a (COMPLETE)

## Objective

Switch ExecuteDeepAgent from `invoke()` to `streamEvents()` with high-fidelity event-to-proto mapping (matching Cursor streaming parity), implement the production middleware stack (8 modules ported from Python graphton), and add post-execution artifact/writeback handling.

## Context

Phase 3a delivered a walking skeleton: setup pipeline + `invoke()` + final message extract. Phase 3b makes it production-grade by adding:
- Real-time streaming status (token-level, same UX as Cursor executions)
- Production controls (loop detection, cost cap, budget, etc.)
- Resilient status persistence (retry with backoff)
- Post-execution outputs (artifacts, git write-back)

## Sub-Phases

Phase 3b is split into three independent sub-phases. Execute one at a time with a checkpoint between each.

---

## Sub-Phase 3b-i: StatusBuilder + GrpcRetryExecutor

**Goal**: Replace `invoke()` with `streamEvents()`. Build high-fidelity event-to-proto mapping. Add resilient persistence.

**Estimated effort**: 3-4 sessions

### Deliverables

| File | Responsibility |
|------|---------------|
| `src/activities/execute-deep-agent/status-builder.ts` | Stateful LangGraph event-to-proto mapper. Maps every event type to progressive `AgentExecutionStatus` updates. |
| `src/activities/execute-deep-agent/streaming.ts` | The `streamEvents()` consumption loop. Replaces `executeAgent()`. Throttled persistence. |
| `src/shared/grpc-retry.ts` | Exponential-backoff wrapper for `persistStatus`. Classifies retryable vs terminal gRPC errors. Returns control signals. |
| `src/activities/execute-deep-agent/__tests__/status-builder.test.ts` | Table-driven tests for every LangGraph event type mapping |
| `src/activities/execute-deep-agent/__tests__/streaming.test.ts` | Streaming loop tests (mock async iterable, verify persistence cadence) |
| `src/shared/__tests__/grpc-retry.test.ts` | Retry behavior, backoff timing, signal propagation |

### StatusBuilder Event Mapping (LangGraph streamEvents v3)

| LangGraph Event | Proto Update |
|----------------|-------------|
| `on_chat_model_stream` (token chunk) | Append to current `AgentMessage.content`, set `is_streaming: true` |
| `on_chat_model_end` | Finalize `AgentMessage`, set `is_streaming: false`, extract `usage_metadata` → `RunnerUsageSummary` |
| `on_tool_start` | Create `ToolCall` with `status: RUNNING`, `started_at`, `name`, `args` |
| `on_tool_end` | Set `ToolCall.result`, `status: COMPLETED`, `completed_at` |
| `on_tool_error` | Set `ToolCall.error`, `status: FAILED` |
| `on_chain_start` (tool_call metadata) | Set `ToolCall.streaming_source: INPUT` |
| `on_chain_end` | Message boundary finalization |
| Anthropic thinking block | Create `AgentMessage` with `type: THINKING` |

### GrpcRetryExecutor Design

- Wraps `persistStatus()` from `shared/status.ts`
- Backoff: 100ms → 200ms → 400ms → 800ms, max 3 retries
- Retryable: `UNAVAILABLE`, `DEADLINE_EXCEEDED`
- Terminal: `INVALID_ARGUMENT`, `NOT_FOUND` (no retry)
- Returns `ExecutionControlSignal` on success
- On permanent failure: log error, do NOT throw (non-blocking)

### Changes to Existing Files

- `src/activities/execute-deep-agent/index.ts` — replace `executeAgent()` with `streamExecution()` from streaming.ts
- No changes to `setup.ts` (SetupResult already has `agentGraph`)

### Design Decisions to Make (Before Starting)

1. **Persistence cadence**: How often to persist during high-frequency token streaming?
   - Option A: Time-based throttle (at most every 500ms)
   - Option B: Event-count (every N events, like Cursor's ~20)
   - Option C: Hybrid (always persist on message/tool boundaries, throttle token updates)
2. **STOP signal handling**: When `persistStatus` returns STOP:
   - Option A: Let current tool finish, then stop
   - Option B: Abort immediately (cancel in-flight tool)

### Key References

- Python StatusBuilder: `backend/services/agent-runner/src/stigmer_runner/worker/activities/graphton/status_builder.py`
- Python streaming loop: `backend/services/agent-runner/src/stigmer_runner/worker/activities/graphton/streaming.py`
- Cursor streaming model: `backend/services/runner/src/activities/execute-cursor/index.ts` (lines 390-407)
- Proto types: `@stigmer/protos` — `agentexecution/v1/{message_pb, enum_pb, usage_pb, api_pb}`
- LangGraph JS docs: `streamEvents()` with `version: 'v3'`

---

## Sub-Phase 3b-ii: Middleware Stack

**Goal**: Port 8 production control middlewares from Python graphton to TypeScript using DeepAgents JS middleware system.

**Estimated effort**: 4-5 sessions

### Deliverables

| File | Lines est. | Python Source | Key Behavior |
|------|-----------|--------------|-------------|
| `src/middleware/types.ts` | ~40 | — | Shared types: `MiddlewareConfig`, per-middleware configs |
| `src/middleware/loop-detection.ts` | ~200 | `loop_detection.py` (385) | Tracks repeated tool name+args. After N repeats: inject "loop" system message. `wrapToolCall` to observe/block. |
| `src/middleware/cost-cap.ts` | ~250 | `cost_cap.py` (451) | Accumulates USD from `usage_metadata`. Warn at 80%, block at 100%. Sub-agent cost view propagation. |
| `src/middleware/execution-budget.ts` | ~200 | `execution_budget.py` (351) | Step counter. At 70%: "wrap up" nudge. At 100%: force completion. Periodic advisory mode. |
| `src/middleware/tool-truncation.ts` | ~120 | `tool_truncation.py` (203) | `wrapToolCall` — truncate result > `maxChars` with marker. |
| `src/middleware/graceful-stop.ts` | ~100 | `graceful_stop.py` (138) | Receives STOP signal via shared `AbortController`. Blocks tools, injects summary message. |
| `src/middleware/error-hints.ts` | ~80 | `error_hints.py` (137) | Pattern-match tool errors → actionable recovery hints. |
| `src/middleware/think-tool.ts` | ~40 | `think_tool.py` (71) | No-op `think(thought)` LangChain tool. Reasoning scratchpad. |
| `src/middleware/otel-spans.ts` | ~150 | `otel_callback.py` (301) | Wrap model/tool calls in OTel spans. Attributes: model, tokens, tool name, duration. |
| `src/middleware/index.ts` | ~60 | — | `buildMiddlewareStack(config)` — factory returning ordered middleware array. |
| Per-module test files | ~800-1000 | — | Config variations, threshold triggers, edge cases |

### Middleware Composition Order

Matches Python `create_deep_agent` injection order:
1. Loop detection
2. Execution budget
3. Tool truncation
4. Graceful stop
5. Cost cap (conditional on `max_cost_usd > 0`)
6. Error hints (applied inside tool wrappers, not as standalone middleware)
7. Think tool (added to tools list, not middleware)
8. OTel spans (via LangChain callbacks)

### Cross-Cutting: StatusBuilder ↔ GracefulStop Communication

Shared `AbortController`:
- StatusBuilder creates it, passes to streaming loop
- When `persistStatus` returns `STOP`, StatusBuilder calls `controller.abort(reason)`
- GracefulStop middleware checks `signal.aborted` in `wrapToolCall`

### Key References

- Python middleware source: `backend/libs/python/graphton/src/graphton/core/{loop_detection,cost_cap,execution_budget,tool_truncation,graceful_stop,error_hints,think_tool,otel_callback}.py`
- DeepAgents JS middleware API: `createMiddleware` from `deepagents` with `wrapToolCall`, `beforeAgent`, `afterAgent` hooks
- Module audit: `design-decisions/001-t01a-graphton-module-audit.md`
- Cursor OTel: `backend/services/runner/src/otel.ts`
- Model pricing (for cost cap): `backend/services/runner/src/shared/model-pricing.ts`

---

## Sub-Phase 3b-iii: Artifact Storage + Writeback Coordinator

**Goal**: Handle post-execution file outputs (upload artifacts, git write-back).

**Estimated effort**: 2-3 sessions

### Deliverables

| File | Responsibility |
|------|---------------|
| `src/activities/execute-deep-agent/artifact-storage.ts` | Scan workspace for new/modified files. Upload to storage. Build `ExecutionArtifact[]` protos. |
| `src/activities/execute-deep-agent/writeback-coordinator.ts` | For git-backed workspaces: branch, commit, push, PR. Build `WorkspaceWriteBack[]` protos. |
| `src/activities/execute-deep-agent/inline-publisher.ts` | Publish file contents inline during execution for immediate UI display. |
| Per-module test files | — | Workspace scanning, git operations, error handling |

### Writeback Flow (Post-Execution)

1. Execution completes → check if workspace has git source
2. `git diff --stat` → if no changes, skip
3. `git checkout -b stigmer/{short_execution_id}`
4. `git add . && git commit`
5. `git push origin`
6. Create PR (if agent config enables it)
7. Populate `WorkspaceWriteBack` proto with branch, commit SHA, PR URL

### Design Decisions to Make (Before Starting)

1. **Artifact storage backend**: Is there an existing upload API on stigmer-service, or is this new?
2. **Inline publisher scope**: Is this a distinct concept (publish file diffs as they happen), or is it just the StatusBuilder capturing tool results (which already include file contents)?

### Key References

- Proto types: `agentexecution/v1/{artifact_pb, writeback_pb}`
- Workspace provisioner: `backend/services/runner/src/shared/workspace/`
- Git source: `backend/services/runner/src/shared/workspace/sources/git.ts`

---

## Deferred Items from Phase 3a (Tracked Here)

These were explicitly unscoped from Phase 3a. Their target phase is indicated:

### → Phase 3b (addressed by this task)

- [x] StatusBuilder: LangGraph event-to-proto mapping → **Sub-phase 3b-i**
- [x] Switch from `invoke()` to `streamEvents()` → **Sub-phase 3b-i**
- [x] GrpcRetryExecutor → **Sub-phase 3b-i**
- [x] Middleware stack (8 modules) → **Sub-phase 3b-ii**
- [x] Artifact storage + inline publisher → **Sub-phase 3b-iii**
- [x] Writeback coordinator → **Sub-phase 3b-iii**

### → Phase 3c (next task after 3b)

- [ ] HITL interrupt/resume (`interruptOn` config + `Command({ resume })`)
- [ ] Approval policy integration (tool-level approval checks before execution)
- [ ] Sub-agent concurrency limiter (Promise-based semaphore, max 3)
- [ ] Summarization middleware config parity verification (DeepAgents JS built-in vs custom)

### → Phase 4+ (later)

- [ ] `@langchain/openai` multi-provider model support
- [ ] MCP package pre-installer (npm/pip install before tool connections)
- [ ] Connect backfill for undiscovered/stale MCP servers
- [ ] Skill relevance filtering (exclude low-relevance skills when count >= 8)
- [ ] Cost pricing integration (model pricing for cost cap middleware)
- [ ] Remote workspace backend (Daytona sandbox)

---

## How to Use This Plan

Drop this file into a new conversation with:

```
@_projects/2026-05/20260518.01.unified-runner-migration/tasks/T03b_0_plan.md

Continue with Sub-phase 3b-i (StatusBuilder + GrpcRetryExecutor)
```

Or for later sub-phases:
```
Continue with Sub-phase 3b-ii (Middleware Stack)
```

```
Continue with Sub-phase 3b-iii (Artifacts + Writeback)
```

Each sub-phase can be worked independently. Complete one, checkpoint, then start the next.

## Essential Context Files (for any sub-phase)

These files provide the necessary context for the AI to resume work:

```
@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md
@_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/001-t01a-graphton-module-audit.md
@_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-4-phase3a.md
```

## Quality Standards (Non-Negotiable)

- Full TypeScript strictness (no `any`, no type assertions without justification)
- Exhaustive unit tests for every module (table-driven where appropriate)
- Each sub-phase ends with: `typecheck clean`, `test pass`, `build clean`
- Checkpoint document created after each sub-phase
- No autonomous architectural decisions — pause and ask on surprises

## Full Roadmap Position

| Phase | Name | Status |
|-------|------|--------|
| 0 | Research Spike | COMPLETE |
| 1 | Service Scaffold | COMPLETE |
| 2 | Core Shared Infrastructure | COMPLETE |
| 3a | ExecuteDeepAgent Walking Skeleton | COMPLETE |
| **3b-i** | **StatusBuilder + GrpcRetryExecutor** | **NEXT** |
| 3b-ii | Middleware Stack | Blocked on 3b-i |
| 3b-iii | Artifacts + Writeback | Blocked on 3b-ii |
| 3c | HITL + Approval | Blocked on 3b |
| 4 | Supporting Activities | Blocked on 3c |
| 5 | Testing | Blocked on Phase 4 |
| 6 | Deployment | Blocked on Phase 5 |
| 7 | Cleanup | Blocked on Phase 6 |
