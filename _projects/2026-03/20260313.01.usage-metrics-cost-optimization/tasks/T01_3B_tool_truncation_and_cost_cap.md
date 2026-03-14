# Task T01 Phase 3B: Tool Result Truncation & Cost Cap Checking

**Created**: 2026-03-13
**Status**: PENDING
**Depends on**: Phase 3 (Usage Metrics Population) — COMPLETE
**Type**: Feature Development

---

## Context

Phase 3 of T01 delivered the usage metrics population pipeline: `UsageTracker`, `ModelRegistry` reverse lookup, per-call `LlmCallMetrics`, `ModelUsage` aggregation, duration breakdown, and summarization cost capture. The original T01 Phase 3 scope (items 9 and 10) also included two runtime optimization features that were deferred to keep the Phase 3 scope focused on the measurement foundation:

1. **Tool result truncation** — prevent oversized tool outputs from inflating context
2. **Cost cap checking** — stop runaway executions before they drain API credits

These features consume the `ExecutionConfig` proto fields added in Phase 1 (`max_tool_result_chars` field 4, `max_cost_usd` field 5) and depend on the running cost tracking built in Phase 3.

---

## 3B.1 — Tool Result Truncation

### What it does

When a tool returns output exceeding `ExecutionConfig.max_tool_result_chars`, truncate it and append a marker so the LLM knows the result was cut.

### Schema (already exists)

```protobuf
// ExecutionConfig (spec.proto, field 4)
int32 max_tool_result_chars = 4;
// 0 = platform default (recommended: 30,000 chars ≈ ~7,500 tokens)
```

```protobuf
// UsageMetrics (usage.proto, field 10)
int64 tool_result_chars_truncated = 10;
```

### Implementation

1. **Where**: In the tool result processing pipeline — after tool execution, before injecting the result into the conversation as a `ToolMessage`.

2. **Logic**:
   ```python
   limit = execution_config.max_tool_result_chars or DEFAULT_MAX_TOOL_RESULT_CHARS
   if len(result) > limit:
       chars_truncated = len(result) - limit
       result = result[:limit] + f"\n\n[truncated — result exceeded {limit:,} chars, ask for specific sections]"
       usage_tracker.record_tool_truncation(chars_truncated, scope)
   ```

3. **Tracking**: Accumulate `tool_result_chars_truncated` in `UsageTracker` and expose on `UsageMetrics`.

4. **Default**: 30,000 characters (approximately 7,500 tokens). This is generous enough for most tool outputs while preventing the 50-100K character context spikes from `cat` on large files or verbose shell output.

5. **Scope**: Applies to all tool results (shell, read, write, MCP tools). Does not apply to built-in tools that already manage their own output size.

### Files to modify

| File | Change |
|------|--------|
| `status_builder.py` | Apply truncation in `_handle_tool_end_event` before injecting result |
| `usage_tracker.py` | Add `record_tool_truncation()` and `_tool_chars_truncated` accumulator |
| `usage_tracker.py` | Include `tool_result_chars_truncated` in `build_usage_metrics()` |

### Tests

- Tool result under limit → no truncation, marker not appended
- Tool result over limit → truncated, marker appended, chars tracked
- Multiple truncations → totals accumulate correctly
- `max_tool_result_chars = 0` → uses platform default

---

## 3B.2 — Cost Cap Checking

### What it does

Allows setting a maximum cost per execution. When the running `estimated_cost_usd` exceeds this limit, the agent receives a budget warning and eventually the execution terminates gracefully.

### Schema (already exists)

```protobuf
// ExecutionConfig (spec.proto, field 5)
double max_cost_usd = 5;
// 0.0 = no cost cap (default, unlimited)
```

### Implementation

1. **Where**: After each `on_chat_model_end` event, after `UsageTracker.record_llm_call()` updates the running cost.

2. **Warning at 80%**: When `estimated_cost_usd >= max_cost_usd * 0.8`, inject a system message into the conversation:
   ```
   ⚠️ Budget warning: This execution has consumed ${cost:.2f} of the ${cap:.2f} budget ({pct:.0f}%).
   Please wrap up your current task. The execution will terminate if the budget is exceeded.
   ```

3. **Terminate at 100%**: When `estimated_cost_usd >= max_cost_usd`, transition execution to `EXECUTION_TERMINATED` with a budget-exhaustion reason.

4. **State tracking**: Track whether the 80% warning has been issued (so it fires only once).

### Interaction with UsageTracker

`UsageTracker.get_estimated_cost()` already provides the running total. The cost cap logic lives in `StatusBuilder` (the event router) since it needs to control execution flow (inject messages, trigger termination).

### Files to modify

| File | Change |
|------|--------|
| `status_builder.py` | Add `_cost_cap` and `_budget_warning_issued` fields |
| `status_builder.py` | After `record_llm_call()`, check cost against cap |
| `execute_graphton.py` | Pass `max_cost_usd` from `ExecutionConfig` to `StatusBuilder` |

### Tests

- No cost cap (0.0) → no warning, no termination
- Cost at 79% of cap → no warning
- Cost at 80% of cap → warning injected, once only
- Cost at 100% of cap → execution terminates gracefully
- Warning + termination sequence in a multi-call scenario

---

## Estimated Effort

1-2 days. Both features are straightforward — the hard part (running cost calculation) was done in Phase 3.

---

## Pre-existing Cleanup Required

Before starting Phase 3B, the protobuf import migration in the agent-runner should be completed. See: `tasks/T01_3_cleanup_proto_imports.md`
