# Next Task: 20260313.01.usage-metrics-cost-optimization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260313.01.usage-metrics-cost-optimization

**Description**: Address gaps in agent execution usage metrics tracking (cost/pricing data, cache token differentiation) and implement usage optimization techniques (prompt caching, tool result truncation, model routing) to enable accurate cost reporting and minimize LLM costs.
**Goal**: Enable per-execution cost reporting with accurate pricing, implement prompt caching for cost optimization, and provide CLI-level usage/cost visibility with historical reporting RPCs.
**Tech Stack**: Protobuf/gRPC (API schema), Go (stigmer-server, CLI), Python (agent-runner/LangGraph), Java (Temporal workflows)
**Components**: Proto APIs (agentexecution/v1, session/v1), agent-runner (Python/LangGraph), stigmer-server (Go), CLI (Go)

## Current State
- **Status**: In Progress
- **Last Session**: 2026-03-13 — Phase 4A completed
- **Active Task**: Phase 4A complete. Next: Phase 5 → Phase 6 → Phase 7 → Phase 4B
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-13, Session 6)

### Phase 4A: Prompt Caching (System + Tools) — COMPLETED

Added Anthropic prompt caching by injecting `cache_control: {"type": "ephemeral"}` breakpoints on the system prompt and last tool definition. No prompt restructuring was needed — the original plan's assumption that prompt construction needed restructuring was incorrect. The existing architecture already separates system, tools, and messages into distinct API parameters.

**Key insight**: The original plan called for "restructuring prompt construction to place static content as a stable prefix." Investigation revealed the Anthropic API payload already has this structure (`system`, `tools`, `messages` are separate parameters). Only additive `cache_control` markers were needed.

**What was done (1 modified file, 1 new file, ~30 lines modified, ~300 lines new):**

1. **`_EagerToolStreamingChatAnthropic._get_request_payload()`** (`graphton/core/models.py`): Extended the existing payload-patching method (which already handles eager tool streaming and adaptive thinking effort) to inject `cache_control` markers. Layer 1: system prompt string is converted to a content block list with `cache_control`. Layer 2: last tool definition gets `cache_control`. Both are idempotent (won't overwrite existing markers).

2. **`_inject_cache_control()`** (`graphton/core/models.py`): Pure function that mutates the payload in place. Handles string system prompts, list-of-blocks system prompts, None/empty, and tool definitions. Guarded by `_prompt_caching` private attribute (default True) for testability.

3. **Unit tests**: 24 tests covering string/list/None system prompts, tool caching, empty/missing keys, idempotency, opt-out, combined scenarios, and integration through `_get_request_payload()`. All pass.

**Impact**: ~80% savings on the static prefix (system prompt + tool schemas) that is repeated on every LLM call. Break-even at 2 calls; typical executions have 5-15 calls.

### Design Decisions Made

1. **Payload-level patching over middleware**: Consistent with the established `_EagerToolStreamingChatAnthropic._get_request_payload()` pattern. More reliable than middleware (no dependency on deepagents internals).
2. **Always-on for Anthropic**: Cache write costs 1.25x but reads cost 0.1x. Break-even at 2 calls. Every execution exceeds this. No opt-in needed.
3. **No public API surface change**: Caching is transparent. `create_deep_agent()` callers don't need to know about it.
4. **5-minute TTL (default)**: Extended 1h TTL deferred. Can be added later if approval waits cause cache misses.

### Files Changed

**New**:
- `backend/libs/python/graphton/tests/core/test_prompt_caching.py`

**Modified**:
- `backend/libs/python/graphton/src/graphton/core/models.py`

---

## Session Progress (2026-03-13, Session 5)

### Phase 3B: Tool Result Truncation & Cost Cap — COMPLETED

Implemented two new graphton middlewares for tool result truncation and cost cap enforcement. The original task file incorrectly specified placing both features in `StatusBuilder` (an observer that cannot modify LLM state or control execution flow). During planning, this was identified and corrected — both features were implemented as proper `AgentMiddleware` subclasses following the established pattern of `ExecutionBudgetMiddleware` and `LoopDetectionMiddleware`.

**What was done (4 modified files, 4 new files, +190 lines modified, ~700 lines new):**

1. **`ToolTruncationMiddleware`** (`graphton/core/tool_truncation.py`): Always-active middleware that prefix-truncates tool results exceeding a configurable character limit (default 30K). Covers ALL tools uniformly (platform, MCP, resource) via `awrap_tool_call`. Fires an optional callback for usage metric accumulation. Acts as a "context budget" layer above the existing 120K head+tail truncation in `tool_wrappers.py`.

2. **`CostCapMiddleware`** (`graphton/core/cost_cap.py`): Optional middleware (only when `max_cost_usd > 0`) that tracks running LLM cost via `aafter_model`, injects a warning SystemMessage at 80% of the budget, and blocks all tools at 100% via `awrap_tool_call`. Gives the model one final tool-free round to summarize before the graph terminates naturally. Uses its own running cost total independent of `UsageTracker` (different timing, layer, precision needs).

3. **`create_deep_agent()` wiring** (`graphton/core/agent.py`): Added `max_tool_result_chars`, `tool_truncation_callback`, `max_cost_usd`, and `cost_pricing` parameters. Tool truncation is always injected; cost cap only when configured with pricing.

4. **`UsageTracker` extension** (`usage_tracker.py`): Added `record_tool_truncation()` method and `tool_chars_truncated` field on `_ScopeState`. Wired into `build_usage_metrics()` → `UsageMetrics.tool_result_chars_truncated` (proto field 10, already existed).

5. **`execute_graphton.py` wiring**: Reads `max_tool_result_chars` and `max_cost_usd` from `ExecutionConfig`, builds `cost_pricing` dict from `ModelRegistry`, creates truncation callback wired to `UsageTracker`, and passes all to `create_deep_agent()`.

6. **Unit tests**: 21 tests for `ToolTruncationMiddleware`, 22 for `CostCapMiddleware`, 5 for `UsageTracker.record_tool_truncation`. All 128 middleware tests pass, all 28 usage tracker tests pass.

### Design Decisions Made

1. **Truncation strategy**: Prefix-only for the middleware (context budget layer). `tool_wrappers.py` handles head+tail at 120K (smart formatting layer). Two layers, two purposes.
2. **Sub-agent cost scope**: Main agent only for Phase 3B. Matches `ExecutionBudgetMiddleware`'s per-graph pattern.
3. **Tool truncation activation**: Always active with 30K default. `max_tool_result_chars=0` means "use platform default", not "disable".
4. **Cost cap termination**: Graceful — inject "budget exhausted, summarize" SystemMessage + block tools. One final model call.

### Files Changed

**New**:
- `backend/libs/python/graphton/src/graphton/core/tool_truncation.py`
- `backend/libs/python/graphton/src/graphton/core/cost_cap.py`
- `backend/libs/python/graphton/tests/core/test_tool_truncation.py`
- `backend/libs/python/graphton/tests/core/test_cost_cap.py`

**Modified**:
- `backend/libs/python/graphton/src/graphton/core/agent.py`
- `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`
- `backend/services/agent-runner/tests/test_usage_tracker.py`

## Next Steps

Pick up in this order:

### Next: Phase 5 — Server Usage Report RPCs
Implement `GetSessionUsageReport`, `GetAgentUsageReport`, `GetOrgUsageReport` RPCs. Aggregate usage across executions/sessions/agents with time range filtering and pagination.

### Then: Remaining T01 Phases
1. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands, per-execution usage summary
2. **Phase 7: Sub-Agent Model Routing** — Wire `model_override` on `SubAgentDefinition`
3. **Phase 4B: Incremental Conversation Caching** — Inject `AnthropicPromptCachingMiddleware` from langchain-anthropic to cache conversation history between turns. Lower priority since Phase 4A already captures 80-90% of caching savings. Known issue with model fallback (langchain-ai/langchain#33709) — re-evaluate when that is resolved.

## Context for Resume

- **Prompt caching** is always-on for Anthropic models via `_EagerToolStreamingChatAnthropic._get_request_payload()`. Injects `cache_control: {"type": "ephemeral"}` on the system prompt (converted from string to content block list) and the last tool definition. Idempotent. Opt-out via `model._prompt_caching = False` (for tests only).
- **`_inject_cache_control()`** in `graphton/core/models.py` is the pure function that mutates the API payload in place. Handles string/list/None system prompts and empty/missing tool lists.
- **No restructuring was needed**: The Anthropic API already separates `system`, `tools`, and `messages` into distinct payload parameters. The original plan's assumption about restructuring was wrong.
- **Phase 4B (deferred)**: Incremental conversation caching via `AnthropicPromptCachingMiddleware` from langchain-anthropic. Independent of Phase 4A. Blocked by langchain-ai/langchain#33709 (breaks model fallback).
- `ToolTruncationMiddleware` is always injected in `create_deep_agent()`. Default 30K chars. Covers all tools (platform + MCP + resource).
- `CostCapMiddleware` is only injected when `max_cost_usd > 0` with `cost_pricing` dict from `ModelRegistry`.
- The truncation callback bridges graphton (library) → agent-runner (service): `_on_tool_truncation` closure in `execute_graphton.py` calls `status_builder.usage_tracker.record_tool_truncation()`.
- `CostCapMiddleware` tracks its own running cost independently of `UsageTracker` (timing + layer separation).
- `UsageTracker` is in `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`. StatusBuilder owns it via `self._usage_tracker`.
- `ModelRegistry.get_by_api_model_id()` resolves provider API model IDs to `ModelMetadata` for pricing.
- Cost formula: `(regular_input * input_price + output * output_price + cache_creation * creation_price + cache_read * read_price) / 1_000_000`
- LangChain `input_tokens` = total input (including cached). Regular input = `input_tokens - cache_creation - cache_read`.
- All 1193+ agent-runner tests pass. 152 graphton tests pass (128 middleware + 24 prompt caching).
- Phase 4A plan: `.cursor/plans/phase_4_prompt_caching_adee63e8.plan.md`
- Phase 3B plan: `.cursor/plans/phase_3b_implementation_4797ea64.plan.md`
- T01 master plan: `tasks/T01_0_plan.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/dont-dos/
```

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260313.01.usage-metrics-cost-optimization/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
