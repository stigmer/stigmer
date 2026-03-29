# Fix Sub-Agent Streaming, Budget Middleware Crash, and Status Propagation

**Date**: March 29, 2026

## Summary

Fixed three interconnected production bugs causing sub-agents to show "Running" with no UI activity, cost to increase invisibly, and eventual crash that retroactively overwrote completed sub-agents as FAILED. The root causes were: (1) budget middleware injecting messages that violated Anthropic's tool_use/tool_result ordering constraint, (2) namespace registration gated behind a single event type causing sub-agent events to misroute to the main agent, and (3) crash finalization blindly overwriting all sub-agent statuses regardless of completion state.

## Problem Statement

Production execution `aex_01kmw48kjt426a3kf3vrjtbtcq` exhibited a cascading failure pattern where three distinct bugs interacted:

### Pain Points

- Sub-agent UI showed "Running" indefinitely with no streaming activity, while backend logs showed active work and token consumption — cost accrued invisibly to the user
- `ExecutionBudgetMiddleware` injected a `SystemMessage` between `AIMessage(tool_use)` and `ToolMessage(tool_result)`, violating Anthropic's strict message ordering and causing a fatal `BadRequestError` at model round 30
- Sub-agent events from `on_chat_model_stream` and `on_tool_end` failed namespace lookup and fell back to the main agent context, making sub-agent work invisible in the UI
- When the parent execution crashed from the Anthropic error, `finalize_active_sub_agents` marked ALL active sub-agents as FAILED — including those that had already completed with meaningful results

## Solution

Three targeted root-cause fixes, each minimal in scope and surgical in impact:

1. **Budget advisory moved from output injection to input prepend** — Replaced the `aafter_model` hook (which injected into the model's state output, landing between tool_use and tool_result) with `awrap_model_call` (which appends to the next model call's input messages). Advisories are now queued in `_pending_advisory` after round evaluation and delivered as input context to the subsequent call.

2. **Universal namespace registration** — Moved the `_register_sub_agent_namespace()` call from inside `_handle_tool_start_event` up into `process_event` itself. The existing 4-strategy registration pipeline (root-prefix, substring, causal, sole-active) was already correct — it simply wasn't being invoked for most event types. Two lines added, six lines removed. No fallback logic, no new matching strategies.

3. **Finalization respects terminal status** — Updated `finalize_active_sub_agents` (and its differentiated variant) to flush pending completion entries before crash finalization and preserve sub-agents that already have a terminal status or non-empty output. Only genuinely in-progress sub-agents receive the forced FAILED/CANCELLED status.

## Implementation Details

### ExecutionBudgetMiddleware (`execution_budget.py`)

- Removed `aafter_model` hook entirely
- Added `awrap_model_call` hook that wraps the model call pipeline:
  - Step 1: If `_pending_advisory` exists from a previous round, append it to `request.messages`
  - Step 2: Call the handler (actual model invocation)
  - Step 3: Increment round counter and evaluate budget via `_evaluate_budget()`
  - Advisory is queued in `_pending_advisory` for delivery on the *next* call
- Added `_pending_advisory: SystemMessage | None` instance field, reset in `__init__` and `abefore_agent`
- Extracted budget evaluation logic into `_evaluate_budget()` for clarity
- Round counter only increments after successful model call (exceptions don't count)

### StatusBuilder (`status_builder.py`)

**Namespace registration (Issue 2):**
- Added `_register_sub_agent_namespace(namespace)` call in `process_event`, before the handler dispatch block
- Removed the now-redundant call from `_handle_tool_start_event` (lines 818-824)
- `_get_execution_context` unchanged — stays as a clean exact-match lookup

**Finalization (Issue 3):**
- Added `_flush_pending_completions()` helper that immediately drains the deferred completion queue and sets `force_next_update`
- Updated `finalize_active_sub_agents` to call `_flush_pending_completions()` first, then skip sub-agents with terminal status (`COMPLETED`, `FAILED`, `CANCELLED`) or non-empty `output`
- Applied the same pattern to `finalize_active_sub_agents_differentiated` and `finalize_sub_agents_from_checkpoint_validation`

### Tests

- **Execution budget** (72 tests): Fully rewritten for `awrap_model_call` API. New test classes: `TestAwrapModelCallThreshold`, `TestAwrapModelCallPeriodic`, `TestMessageOrderingSafety`. Key safety tests verify advisory appears in handler input (not output) and that the handler's `ModelResponse` is returned unchanged.
- **Status builder** (11 new tests, 272 total): `TestUniversalNamespaceRegistration` (4 tests verifying `on_chat_model_stream`/`on_tool_end` trigger registration), `TestFinalizationPreservesTerminalStatus` (7 tests covering preservation logic, pending flush drain, mixed finalization).

## Benefits

- **Eliminates Anthropic API crashes** caused by budget advisory placement — the advisory can no longer corrupt message ordering regardless of when it fires
- **Sub-agent streaming visible in UI** — all event types now route to the correct SubAgentExecution, not silently to the main agent
- **Accurate terminal status** — completed sub-agents retain their COMPLETED status even when the parent crashes, preserving the user's confidence in results they already saw
- **Zero new abstractions** — all three fixes leverage existing infrastructure (registration pipeline, completion flush mechanism, `awrap_model_call` pattern from `ContextSummarizationMiddleware`)

## Impact

- **Users**: Sub-agent work streams correctly in the UI; cost is attributable to visible activity; crash recovery preserves completed results
- **Backend**: Budget middleware is now safe for any LLM provider with strict message ordering (Anthropic, future providers)
- **Test coverage**: 83 new/rewritten tests covering all three fix areas

## Related Work

- [Gated General-Purpose Sub-Agent](2026-03-29-080321-gated-general-purpose-sub-agent.md) — introduced the sub-agent gating that these events flow through
- [Fix Interrupt Proxy Callback Context](2026-03-29-095041-fix-interrupt-proxy-callback-context.md) — enabled event observability that this fix depends on
- [Sub-Agent Status and Execution Guardrails](2026-03-29-110412-fix-subagent-status-and-execution-guardrails.md) — introduced the deferred completion flush that Issue 3 now respects during crash finalization
- [Periodic Advisory Budget Middleware](2026-03-29-114945-periodic-advisory-budget-middleware.md) — introduced the periodic mode whose `aafter_model` injection caused Issue 1

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (diagnosis from prior session, implementation and testing in this session)
