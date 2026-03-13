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
- **Last Session**: 2026-03-13 — Phase 3B completed
- **Active Task**: Phase 3B complete. Next: Phase 4 → Phase 5
- **Branch**: `feat/usage-metrics-and-cost-optimization`

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

### Next: Phase 4 — Prompt Caching (2-3 days)
**Task file**: `tasks/T01_4_prompt_caching.md` (if exists, otherwise see `T01_0_plan.md`)

Restructure prompt construction with `cache_control` breakpoints to leverage Anthropic/OpenAI prompt caching. This reduces input token costs by 90% for cache hits.

### Then: Remaining T01 Phases
3. **Phase 5: Server — Usage Report RPCs** — Implement getSessionUsageReport, getAgentUsageReport, getOrgUsageReport
4. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands
5. **Phase 7: Sub-Agent Model Routing** — Wire `model_override`

## Context for Resume

- `ToolTruncationMiddleware` is always injected in `create_deep_agent()`. Default 30K chars. Covers all tools (platform + MCP + resource).
- `CostCapMiddleware` is only injected when `max_cost_usd > 0` with `cost_pricing` dict from `ModelRegistry`.
- The truncation callback bridges graphton (library) → agent-runner (service): `_on_tool_truncation` closure in `execute_graphton.py` calls `status_builder.usage_tracker.record_tool_truncation()`.
- `CostCapMiddleware` tracks its own running cost independently of `UsageTracker` (timing + layer separation).
- `UsageTracker` is in `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`. StatusBuilder owns it via `self._usage_tracker`.
- `ModelRegistry.get_by_api_model_id()` resolves provider API model IDs to `ModelMetadata` for pricing.
- Cost formula: `(regular_input * input_price + output * output_price + cache_creation * creation_price + cache_read * read_price) / 1_000_000`
- LangChain `input_tokens` = total input (including cached). Regular input = `input_tokens - cache_creation - cache_read`.
- All 1193+ agent-runner tests pass. 128 graphton middleware tests pass.
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
