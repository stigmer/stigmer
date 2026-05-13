# Task T01: Implementation Plan — Cursor Experience Parity

**Created**: 2026-05-13
**Status**: PENDING REVIEW
**Type**: Feature Development (multi-phase)

> This plan requires your review before execution.

## Context

This plan is synthesized from three ChatGPT Deep Research reports:
- `research.cursor-harness-usage-tracking/04.report.gpt.md` — Usage/billing tracking
- `research.context-window-visibility/04.report.gpt.md` — Context window telemetry
- `research.cursor-ux-parity/04.report.gpt.md` — Cursor-like UX features

## Key Discoveries from Research

1. **Usage tracking already has a pipeline** — `cursor-runner` fetch interceptor → `CursorProxyController` SSE tee → `CursorUsageExtractor` → `ProxyUsageReporter` → `llm_call_usage_record`. The $0.00 issue is likely a scoping/authorization problem (`X-Stigmer-Execution-Id` missing, FGA `metered=false`, or Cursor Connect RPC calls not being metered), NOT a missing pipeline.

2. **Cursor SDK exposes usage data** — `TurnEndedUpdate.usage` has `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`. Also `TokenDeltaUpdate.tokens` for streaming progress. But `RunResult` does NOT contain usage.

3. **Context breakdown is NOT available via Cursor SDK** — The IDE's category ring (system/tools/rules/skills/MCP/subagents/conversation) is internal. For Cursor harness: approximate with shadow prompt ledger + reconciliation. For LangGraph: exact from prompt builder instrumentation.

4. **Chat summarization must be Stigmer-native** — Cursor's self-summarization is trained behavior inside Composer, not an SDK API. Stigmer needs its own summarization controller using a cheaper model at token-budget thresholds.

5. **Plan/Ask mode is implementable** — Cursor documents Agent/Ask/Custom modes. Stigmer can enforce via tool policy gating and prompt switching.

---

## Phase 1: Fix Usage Tracking (Week 1) — "Stop showing $0.00"

**Priority**: CRITICAL — user trust issue

### Task 1a: Diagnose the actual $0.00 root cause

Before building new infrastructure, verify whether the existing proxy pipeline is working:
- Confirm `X-Stigmer-Execution-Id` header is being sent from cursor-runner via fetch interceptor
- Confirm `CursorProxyController` receives SSE streams with `turn-ended` events
- Confirm `ProxyAuthorizationService` returns `metered=true` for cursor executions
- Check if Cursor Connect RPC calls (not SSE) carry metered usage that isn't being captured
- Check `llm_call_usage_record` collection for any Cursor records

**Deliverable**: Root-cause report — is it a missing header, FGA failure, SSE parsing gap, or Connect RPC blind spot?

### Task 1b: Ensure cursor-runner usage capture works end-to-end

If the proxy pipeline works but data isn't flowing:
- Add `CursorUsageAccumulator` in cursor-runner to capture `TurnEndedUpdate.usage` from `onDelta` callbacks
- Persist per-turn token counts to execution status (`AgentExecutionStatus`)
- Aggregate usage across turns within an execution
- Handle missing `usage` (optional field) — emit diagnostic, don't report as zero
- Use `TokenDeltaUpdate.tokens` as a cross-check/fallback diagnostic only

**Deliverable**: Cursor harness executions show non-zero tokens/cost in execution status

### Task 1c: Wire usage into Planton dashboard

- Ensure `ProxyUsageReporter` → `recordLlmCallUsage` path fires for Cursor SSE streams
- Verify `UsageAggregationService` includes Cursor records in org/session reports
- Confirm React `UsageWidget` / `OrgUsagePanel` displays Cursor harness data
- Add harness breakdown (native vs cursor) to usage reports

**Deliverable**: Planton usage page shows Cursor harness cost/tokens alongside LangGraph usage

### Task 1d: Add provisional cost estimation

- Create versioned Cursor rate card (model → input/output/cache rates + $0.25/M token fee)
- Calculate provisional cost from `TurnEndedUpdate.usage` + rate card
- Show as "Estimated" in UI until reconciled
- Never show $0.00 when Cursor activity was observed — show "Usage pending" instead

**Deliverable**: Users see estimated cost during and after Cursor sessions

---

## Phase 2: Context Window Visibility (Week 2-3) — "What is the agent seeing?"

**Priority**: HIGH — explicit early adopter request

### Task 2a: Proto design — `ContextWindowState`

Add to `agentexecution/v1/context.proto` (which already has `ContextInfo` and `SummarizationEvent`):
- `ContextWindowState` message: execution_id, harness, model, max_context_tokens, current tokens, fill_ratio, confidence, categories, summarization_count, estimated flag
- `ContextCategoryUsage` message: category enum, label, tokens, percent, confidence
- Category enum: SYSTEM_PROMPT, TOOLS, RULES, SKILLS, MCP, SUBAGENTS, CONVERSATION, MEMORY_SUMMARY, TOOL_RESULTS, THINKING, HARNESS_MANAGED_UNKNOWN, OTHER
- `ContextConfidence` enum: EXACT, HIGH, MEDIUM, LOW
- Wire into `AgentExecutionStatus.context_window_state`

**Deliverable**: Proto messages for context telemetry, stubs regenerated

### Task 2b: Cursor harness — shadow prompt ledger + reconciliation

In cursor-runner:
- Track Stigmer-known static inputs (system prompt, rules, skills, MCP, subagents) with token estimates
- Track observed conversation messages and tool calls from `SDKMessage` stream
- On `turn-ended`, reconcile estimated total against `inputTokens` — assign residual to `HARNESS_MANAGED_UNKNOWN`
- Emit `ContextWindowState` snapshot to execution status stream
- Detect summary events (`summary-started`/`summary-completed`) for timeline

**Deliverable**: Context state streamed during Cursor SDK executions with category breakdown

### Task 2c: LangGraph harness — prompt builder instrumentation

In agent-runner:
- Require prompt builder to emit typed `ContextContribution` records
- Pre-count tokens before each LLM call using model tokenizer
- Emit context snapshot via LangGraph custom stream (`get_stream_writer`)
- Reconcile with provider `usage_metadata` after model call
- Store context state in graph state for checkpoint retrieval

**Deliverable**: Exact context state for LangGraph executions

### Task 2d: React SDK — context gauge component

- Add `ContextGauge` component: circular/ring gauge with fill percentage
- Add `ContextPanel` component: category breakdown table, largest contributors, timeline events
- Wire to `useExecutionStream` — update from `context_window_state` in execution status
- Show confidence label: "Estimated" for Cursor, "Measured" for LangGraph
- Show summarization/compaction events in timeline
- Add model context registry for max token ceiling

**Deliverable**: Cursor-like context ring visible in session UI

---

## Phase 3: Chat Summarization (Week 3-4) — "I have summarized the conversation"

**Priority**: HIGH — users explicitly comparing to Cursor

### Task 3a: Summarization controller design

- Token-budget trigger (e.g., 70% of model context window → soft warning, 85% → auto-summarize)
- Use cheaper model for summarization (e.g., `claude-haiku` or `gpt-4.1-mini`)
- Structured summary format: user goal, current plan state, what changed, key files, failed approaches, next actions
- Separate canonical transcript (full history) from model context (summary + recent turns)
- Support manual trigger ("Summarize now" button)

### Task 3b: Cursor harness summarization

- Detect Cursor-managed summarization from SDK events (summary-started/completed, or input token drop)
- Show "Context compacted" card in timeline with before/after token counts
- If Cursor summary is insufficient, layer Stigmer's own summarization on top
- Persist summary to `SessionMemory.durable_summary` (already exists from durability project)

### Task 3c: LangGraph harness summarization

- Implement summarization as a LangGraph middleware/node
- Trigger when context meter exceeds threshold
- Use `get_stream_writer` to emit summary events
- Update `AgentState.memory_summary` for checkpoint persistence
- Maintain separate full message history vs summarized context

### Task 3d: React SDK — summary card UI

- "Context compacted" card in message timeline
- Shows: trigger reason, tokens before/after, what was retained
- Buttons: Expand summary, View full history, Regenerate summary
- Full transcript always remains accessible in a separate view

**Deliverable**: Active mid-conversation summarization visible to users

---

## Phase 4: Plan/Ask Mode & Queued Messages (Week 4-5) — "Plan before executing"

**Priority**: MEDIUM — improves workflow quality

### Task 4a: Mode infrastructure

- Add `SessionMode` enum to session proto: AGENT (full tools), ASK (read-only), PLAN (structured plan output)
- Session controller enforces tool policies per mode
- For Cursor harness: different system prompts + tool restrictions
- For LangGraph: route through planner vs executor subgraphs
- Mode is switchable mid-session

### Task 4b: Plan output format

- Plan card in timeline: structured markdown with task graph
- Buttons: Edit plan, Ask follow-up, Approve & Implement, Reject
- Plan → Agent transition: "Save plan, now execute it" flow

### Task 4c: Message queue

- Server-side FIFO queue for follow-up messages during active execution
- "Queue" (wait for safe point) vs "Steer" (inject at next safe point)
- UI shows queued messages below active execution
- Drag-to-reorder support

**Deliverable**: Plan/Ask/Agent mode toggle, message queue UX

---

## Phase 5: Reconciliation & Polish (Week 5-6) — "Production-grade"

### Task 5a: Cursor Admin API reconciliation worker

- Background job: poll `/teams/filtered-usage-events` after execution completion
- Match by user email + time window + model + token distance
- Upgrade provisional usage events to settled
- Alert on mismatches > 10%
- Backfill historical zero-cost sessions

### Task 5b: Unified usage ledger

- Normalize Cursor SDK + LangGraph + Provider usage into common `UsageEventV1` schema
- Append-only ledger with provenance (provisional → settled)
- Idempotency keys per execution/run/turn/call
- Execution/session aggregate materialized views

### Task 5c: Agent observability enhancements

- Token usage over time chart
- Tool call count and types breakdown
- Files modified timeline
- Time per step / cost per step
- Harness breakdown visualization

**Deliverable**: Production-grade usage tracking with reconciliation

---

## Implementation Order Summary

| Week | Phase | Deliverable | Impact |
|------|-------|-------------|--------|
| 1 | Phase 1 | Fix $0.00 usage tracking | CRITICAL — restores user trust |
| 2-3 | Phase 2 | Context window gauge + breakdown | HIGH — adopter-requested feature |
| 3-4 | Phase 3 | Chat summarization with visible cards | HIGH — direct Cursor comparison |
| 4-5 | Phase 4 | Plan/Ask mode + message queue | MEDIUM — workflow improvement |
| 5-6 | Phase 5 | Reconciliation + unified ledger + observability | MEDIUM — production hardening |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `TurnEndedUpdate.usage` absent for some turns | High | Emit diagnostic event, use `token-delta` as fallback, reconcile via Admin API |
| Cursor Admin API has no `runId`/`agentId` | High | Match by email/time/model/tokens; file feature request with Cursor team |
| LangGraph streaming + callbacks edge cases | Medium | Dual-path: prompt-ledger counting + provider usage reconciliation |
| Cursor SDK is public beta, APIs may change | Medium | Isolate SDK interactions behind adapter interfaces |
| Context breakdown for Cursor is estimated | Medium | Label as "Estimated", show `HARNESS_MANAGED_UNKNOWN` bucket, be transparent |

## Research Report References

All three research reports are in `_projects/2026-05/`:
- `research.cursor-harness-usage-tracking/04.report.gpt.md` (1871 lines)
- `research.context-window-visibility/04.report.gpt.md` (1763 lines)
- `research.cursor-ux-parity/04.report.gpt.md` (1696 lines)

These contain detailed code patterns, proto designs, architecture diagrams, and cross-platform comparisons that should be referenced during implementation.

---

## Review Process

**What happens next**:
1. **You review this plan** — especially prioritization and scope per phase
2. **Provide feedback** — anything to add, remove, reorder, or adjust?
3. **I'll revise** — create T01_2_revised_plan.md with your feedback
4. **You approve** — explicit go-ahead to begin Phase 1
5. **Execution begins** — tracked in T01_3_execution.md

**Key decisions for your review**:
- Is Phase 1 (diagnose existing pipeline first) the right starting point, or should we jump straight to new instrumentation?
- Should Phase 3 (summarization) be prioritized higher than Phase 2 (context gauge)?
- Is the 4-6 week timeline realistic given other active projects?
- Any phases you want to defer or accelerate?
