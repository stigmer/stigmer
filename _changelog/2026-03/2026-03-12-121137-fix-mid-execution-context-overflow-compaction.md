# Fix Mid-Execution Context Overflow: Claude Code-Inspired Two-Layer Compaction

**Date**: March 12, 2026

## Summary

The `ContextSummarizationMiddleware` in graphton only checked token counts once at graph start via `abefore_agent()`. Within a single agent invocation, tokens could grow from 70K to 249K unchecked, crashing with `AnthropicContextOverflowError`. This change adds a Claude Code-inspired two-layer defense: proactive mid-execution compaction via `awrap_model_call` (Layer A) and an emergency brake via `aafter_model` + `awrap_tool_call` (Layer B) as a safety net when compaction fails.

## Problem Statement

During the production incident analysis of execution `aex-01kkg22yeeez6579b8mcaz5bwt`, the agent's context window grew from ~70K tokens after graph-start summarization to 249,324 tokens during execution, eventually crashing with a provider-side context overflow error. The only mid-execution token check was in `aafter_step()` — a method that does not exist in LangChain's `AgentMiddleware` and was never invoked.

### Pain Points

- `abefore_agent()` fires once at graph start — tokens grow unchecked throughout the rest of the execution
- `aafter_step()` implemented mid-execution checks but was never called (dead code, same issue as PR1's loop detection)
- Production agents routinely exceed their context window during complex multi-tool executions
- When context overflow occurs, the provider returns an error and the agent crashes without any graceful recovery
- The existing `trigger_threshold` mechanism is only evaluated at graph start, never during execution

## Solution

Replaced the dead `aafter_step` with a two-layer defense inspired by Claude Code's auto-compaction architecture, adapted to LangGraph's middleware hooks:

**Layer A — `awrap_model_call` (Proactive Compaction)**: Before each model call, counts tokens in `request.messages`. If above `trigger_threshold`, runs LangMem-based summarization via the existing `_perform_summarization()` method. Creates a new `ModelRequest` with compacted messages using `dataclasses.replace()`. The model sees a manageable context while the raw graph state is preserved for checkpointing and debugging. Running summary persists across calls for incremental (not full re-) summarization.

**Layer B — `aafter_model` + `awrap_tool_call` (Emergency Brake)**: Fires only when Layer A compaction fails. `aafter_model` monitors the post-response token count; if `_compaction_failed` and tokens exceed `overflow_threshold` (95% of context window), it injects a SystemMessage warning and sets `_overflow_imminent`. `awrap_tool_call` checks this flag and blocks tool execution, preventing further context growth.

## Implementation Details

### Config Enhancement (`summarization_config.py`)

Added `context_window_tokens: int` field to the frozen dataclass, populated from `ModelRegistry` metadata in the `for_model()` factory. Added `overflow_threshold` as a `@property` computed at 95% of context window — the emergency brake point. Updated `disabled()` factory and `__repr__`.

### Mid-Execution Compaction (`awrap_model_call`)

The core of this change. Intercepts every model call, counts tokens, and triggers compaction when above threshold:

1. Extracts messages from `ModelRequest`, counts tokens via `TokenCounter`
2. Reports count to callback for external monitoring
3. If below threshold: passes request through unchanged (zero overhead path)
4. If above threshold: calls `_perform_summarization()` to get compacted messages
5. Creates new request via `dataclasses.replace(request, messages=compacted)` — immutable modification
6. On compaction failure: sets `_compaction_failed` flag, passes original request through

The `_running_summary` is shared with `abefore_agent`, so compaction is always incremental — each subsequent compaction builds on the last summary rather than re-summarizing from scratch.

### Emergency Monitoring (`aafter_model`)

Post-model hook that monitors token counts in the full graph state. During normal operation (compaction succeeds), it simply reports metrics via the callback. When compaction has failed and tokens exceed `overflow_threshold`, it injects a SystemMessage warning the model to conclude immediately, and sets `_overflow_imminent` for tool-call blocking.

### Tool Execution Brake (`awrap_tool_call`)

Simple guard: if `_overflow_imminent`, returns a ToolMessage explaining that tool execution is blocked due to context limits. Otherwise, calls the handler normally. This prevents expensive tool operations (sub-agent launches, API calls) when context overflow is imminent.

### Dead Code Removal

Removed `aafter_step()` entirely — same treatment as PR1. It was never invoked by LangGraph.

### Lifecycle Updates

- `abefore_agent()`: Now resets `_compaction_failed`, `_compactions_performed`, `_overflow_imminent`, `_mid_execution_warning_issued`
- `aafter_agent()`: Logs aggregated stats — graph-start summarizations, mid-execution compactions, compaction failures, overflow warnings, final token count

### Test Coverage

Created 26 new unit tests in 4 classes and 2 integration tests:

- **TestAwrapModelCall**: Below-threshold passthrough, compaction trigger, overridden request verification, compaction failure handling, disabled config, callback integration, state resets
- **TestAafterModel**: Normal operation (no intervention), disabled config, compaction failure below overflow (no intervention), compaction failure above overflow (warning injection + flag), callback integration
- **TestAwrapToolCallSummarization**: Passthrough when not overflow, blocking when overflow imminent, correct ToolMessage content, blocking multiple calls
- **TestCompactionLifecycle**: `abefore_agent` resets, successful compaction across multiple model calls, compaction failure leading to emergency brake engagement
- **TestMidExecutionCompactionIntegration**: Full compaction with callback events, emergency brake lifecycle end-to-end

## Benefits

- **Context overflow prevention** — agents that grow beyond the trigger threshold get automatic mid-execution compaction, preventing the 70K-to-249K crash scenario
- **Zero overhead when under threshold** — the fast path (check token count, pass through) adds negligible latency
- **Graceful degradation** — if LangMem compaction fails, the emergency brake prevents context overflow rather than crashing
- **Incremental summarization** — running summary persists across hooks, avoiding full re-summarization on every compaction
- **Model sees clean context** — compaction modifies the request, not graph state, preserving full history for checkpointing and debugging
- **Comprehensive safety net** — two independent layers ensure protection even when one fails

## Impact

- **Graphton library** (`backend/libs/python/graphton`) — core middleware component
- **All agent executions** — summarization middleware is auto-injected by `create_deep_agent()` for every agent
- **Production reliability** — directly prevents the class of context overflow crashes observed in the incident
- **Future-ready** — callback pipeline is ready for user-visible compaction notifications (deferred follow-up)

## Related Work

- PR3 (Recursion Limit Fix) — already merged at `0a4fb06a`
- PR1 (Loop Detection Middleware Fix) — completed, pending commit
- PR5 (Premature Completion Fix) — next in sequence
- Deferred: StatusBuilder source field + CLI compaction notification rendering
- Claude Code auto-compaction research documented in plan: `.cursor/plans/pr2_summarization_overflow_brake_2ae56946.plan.md`

---

**Status**: Production Ready
**Timeline**: Single session (~3 hours)
