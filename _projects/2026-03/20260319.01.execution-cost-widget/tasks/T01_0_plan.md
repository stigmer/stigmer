# Task T01: Execution Cost Widget — Full Plan

**Created**: 2026-03-19
**Status**: PENDING REVIEW

---

## Problem Statement

The Stigmer platform has a fully modeled `UsageMetrics` proto (`usage.proto`) with rich fields — token counts, LLM call metrics, model breakdown, estimated cost — and the Python agent-runner already updates `status.usage` after every LLM call via `on_chat_model_end`. However, two gaps exist:

1. **Server-side merge gap**: The Go server's `BuildNewStateWithStatusStep` in `update_status.go` does not merge the `usage` field from incoming status updates. It merges messages, tool_calls, todos, sub_agent_executions, phase, etc., but explicitly skips `usage`, `context_info`, and `resolved_context`. This means usage data sent by the Python worker on every progressive update is silently dropped. Cost data only becomes fully available after `finalize_usage()` at terminal state — defeating the proto's own doc comment: "Updated progressively during streaming for real-time cost visibility."

2. **No UI component**: No React component or hook exists to display cost/usage data. The `useExecutionStream` hook already provides the full `AgentExecution` (including `status.usage`), but nothing renders it.

## Objective

1. Fix the server-side usage merge so `UsageMetrics` flows through progressive streaming updates.
2. Create a `useExecutionUsage` hook in `@stigmer/react` that extracts and derives usage data from the execution stream.
3. Create an `ExecutionCostSummary` styled component in `@stigmer/react` that renders live cost data.
4. Integrate the widget into the Console's `SessionPage` sidebar alongside `ExecutionProgress`.

---

## Investigation Findings

### Data Model (Proto)

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto`

| Message | Key Fields |
|---------|------------|
| `UsageMetrics` | `prompt_tokens`, `completion_tokens`, `total_tokens`, `llm_call_count`, `primary_model`, `primary_provider`, `estimated_cost_usd`, `model_breakdown[]`, `llm_calls[]`, `total_duration_ms`, `llm_duration_ms`, `tool_duration_ms`, `cache_creation_tokens`, `cache_read_tokens` |
| `ModelUsage` | `model`, `provider`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `call_count`, pricing fields, `estimated_cost_usd` |
| `LlmCallMetrics` | `sequence`, `model`, `provider`, `input_tokens`, `output_tokens`, `estimated_cost_usd`, `duration_ms`, `timestamp` |

**Location in aggregate**: `AgentExecutionStatus.usage` (field 11) — main agent only. Sub-agents carry their own `SubAgentExecution.usage`. Total cost = main + sum of sub-agent usages.

### Python Agent-Runner (Updates Usage Progressively)

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

- `_handle_chat_model_end_event()` calls `self._usage_tracker.record_llm_call()` after every LLM call.
- Immediately updates `self.current_status.usage` via `CopyFrom(self._usage_tracker.build_usage_metrics(scope))`.
- This status (with usage) is sent to the server via `execution_client.update_status()` on a hybrid schedule: every 500ms, every 50 events, or on force update (new tool call).

### Go Server (Drops Usage During Merge)

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go`

- `BuildNewStateWithStatusStep` merges: messages, tool_calls, sub_agent_executions, todos, artifacts, phase, error, timestamps, pending_approvals.
- **Does NOT merge**: `usage`, `context_info`, `resolved_context`.
- This is the root cause. The Python worker sends usage on every update, but the Go server discards it.

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/update_status_impl.go`

- Temporal fallback path also does not merge usage. Same gap.

### Streaming Path

- `Subscribe` RPC (`query.proto`): Streams full `AgentExecution` snapshots via `StreamBroker.Broadcast()`.
- `useExecutionStream` hook (`sdk/react`): Receives snapshots and sets state. Already exposes `execution.status.usage` — just never rendered.

### Console Integration Point

**File**: `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`

- Right sidebar (`<aside>`) already shows `ExecutionProgress` in a card.
- The new cost widget would sit alongside it in the same sidebar.

### Existing Usage Report RPCs (Not Needed for Streaming Widget)

- `getSessionUsageReport`, `getAgentUsageReport`, `getOrgUsageReport` — aggregated reports, not real-time. Useful for dashboards but not for the live streaming widget.

---

## Task Breakdown

### Task 1: Fix Server-Side Usage Merge (Go Backend)

**Priority**: P0 — Prerequisite for everything else.

**Scope**:
- `update_status.go` → `BuildNewStateWithStatusStep`: Add usage merge logic. When `requestStatus.Usage` is non-nil, replace `updated.Status.Usage` with the incoming value (replace semantics, same as messages).
- `update_status_impl.go` → Temporal activity: Same change for the fallback path.
- Consider also merging `context_info` and `resolved_context` while we're at it (same gap, same fix pattern).

**Risks**:
- This is on the critical path. The merge must be additive — if the incoming usage is nil (e.g., an older worker), the existing usage must be preserved.
- Sub-agent usage is nested inside `sub_agent_executions[].usage` — that path already works because the full `sub_agent_executions` list is replaced wholesale.

**Validation**:
- Deploy locally, run an agent execution, and verify that `status.usage` is populated in the streaming `Subscribe` output before terminal state.
- Check that `estimated_cost_usd`, `total_tokens`, and `llm_call_count` increment during streaming.

### Task 2: Create `useExecutionUsage` Hook (SDK React)

**Priority**: P1

**File**: `sdk/react/src/execution/useExecutionUsage.ts`

**API Design**:
```typescript
interface ExecutionUsageSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  llmCallCount: number;
  estimatedCostUsd: number;
  primaryModel: string;
  primaryProvider: string;
  modelBreakdown: ModelUsage[];
  totalDurationMs: number;
  llmDurationMs: number;
  toolDurationMs: number;
  // Derived: includes sub-agent usage
  includesSubAgents: boolean;
}

function useExecutionUsage(execution: AgentExecution | null): ExecutionUsageSummary | null;
```

**Design Decisions**:
- Pure derivation hook — no fetching, no side effects. Derives from the `AgentExecution` already provided by `useExecutionStream`.
- Aggregates main agent + sub-agent usage into a single summary.
- Returns `null` when execution is null or usage is not yet available.
- Memoized to avoid recomputation on every render.

**Why a separate hook?** Platform builders may want usage data without the styled component. Also, this keeps the component thin — it just renders what the hook provides.

### Task 3: Create `ExecutionCostSummary` Component (SDK React)

**Priority**: P1

**File**: `sdk/react/src/execution/ExecutionCostSummary.tsx`

**API Design**:
```typescript
interface ExecutionCostSummaryProps {
  execution: AgentExecution | null;
  className?: string;
}

function ExecutionCostSummary({ execution, className }: ExecutionCostSummaryProps): JSX.Element | null;
```

**Visual Design**:
- Compact layout matching `ExecutionProgress` density (it sits alongside it).
- Key metrics at a glance: estimated cost (USD), total tokens, LLM calls, primary model.
- Progressive disclosure: expandable model breakdown for multi-model executions.
- Uses `--stgm-*` tokens exclusively. No hardcoded colors.
- Renders nothing when execution is null or usage is empty.
- Inline SVG icons (same pattern as `ExecutionProgress` — no external icon deps in SDK).
- Accessible: proper `aria-label`, semantic HTML, screen-reader-friendly number formatting.
- Animatable: token counts and cost should feel "alive" during streaming (numbers ticking up).

**Architecture**:
- Internally uses `useExecutionUsage` hook.
- Follows the existing chromeless pattern (no card wrapper — consumer provides the container).
- Same props interface pattern as `ExecutionProgress` for consistency.

### Task 4: Export and Integrate

**Priority**: P2

**Sub-tasks**:
1. **Barrel export**: Add `useExecutionUsage` and `ExecutionCostSummary` to `sdk/react/src/execution/index.ts` and `sdk/react/src/index.ts`.
2. **Console integration**: Add `ExecutionCostSummary` to `SessionPage.tsx` sidebar, below `ExecutionProgress`, inside its own card.
3. **Verify end-to-end**: Run a full agent execution in the Console and confirm live cost updates.

---

## SDK Placement Rationale

| Artifact | Package | Rationale |
|----------|---------|-----------|
| `useExecutionUsage` | `@stigmer/react` | Pure data derivation from `AgentExecution` — no Console dependency. Platform builders need this to show cost data in their own UIs. |
| `ExecutionCostSummary` | `@stigmer/react` | Styled component following `ExecutionProgress` pattern. Themeable via `--stgm-*`. Works identically in Console and third-party dashboards. |
| Server merge fix | `backend/services/stigmer-server` | Infrastructure fix. Not SDK but prerequisite. |
| Console page change | `client-apps/web` | Console-specific layout concern — consuming SDK components. |

---

## Out of Scope

- Session-level or org-level usage dashboards (separate project, uses the existing report RPCs).
- Cost cap configuration UI (separate feature).
- Historical cost trend charts.
- Budget alerts or notifications.

---

## Open Questions for Review

1. **Should the widget show sub-agent cost breakdown inline, or just the aggregated total?** Recommendation: Aggregated total by default, with an expandable sub-agent breakdown if sub-agents exist.

2. **Should we also merge `context_info` and `resolved_context` in the same server-side fix?** These fields have the same merge gap. Fixing them now prevents a second pass later.

3. **Number formatting**: Should cost display as "$0.0023" or "0.23c" for small amounts? Recommendation: Use "$X.XXXX" format for consistency with industry conventions.

4. **Should the hook also expose per-call metrics (`llm_calls[]`)?** The proto has `LlmCallMetrics` per call. Exposing these enables detailed debugging views but increases API surface. Recommendation: Expose in hook, don't render in the initial component — leave for future detail views.

---

## Definition of Done

- [ ] `BuildNewStateWithStatusStep` merges `usage` field (and optionally `context_info`, `resolved_context`)
- [ ] Temporal activity fallback path also merges usage
- [ ] `useExecutionUsage` hook exported from `@stigmer/react`
- [ ] `ExecutionCostSummary` component exported from `@stigmer/react`
- [ ] Both pass lint, type-check, and unit tests
- [ ] Console sidebar shows live cost data during active execution
- [ ] Cost data updates progressively (not just at terminal state)
- [ ] Component is themeable via `--stgm-*` tokens
- [ ] Component renders nothing gracefully when no usage data exists
