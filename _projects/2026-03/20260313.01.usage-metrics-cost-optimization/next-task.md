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
- **Last Session**: 2026-03-13 — Phase 3 (Usage Metrics Population Pipeline) completed
- **Active Task**: Phase 3 complete. Next: Phase 3 Cleanup → Phase 3B → Phase 4
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-13, Session 3)

### Phase 3: Usage Metrics Population Pipeline — COMPLETED

Built the complete runtime pipeline that transforms raw LangGraph events into accurate, cost-enriched usage metrics. Seven steps implemented:

1. **Investigation spike**: Verified LangChain `usage_metadata` semantics — `input_tokens` is total input (including cached), `input_token_details.cache_creation`/`cache_read` provide the breakdown. Cost formula validated for both Anthropic and OpenAI.

2. **ModelRegistry reverse lookup**: Added `get_by_api_model_id()` with a lazily-initialized reverse index. Resolves provider API model IDs (e.g., `claude-sonnet-4-6`) to `ModelMetadata` for pricing lookups. O(1) after first call.

3. **UsageTracker class** (NEW — `usage_tracker.py`, ~385 lines): Encapsulates all token accounting, pricing lookup, per-call metrics construction, per-model aggregation, duration tracking, and proto assembly. Scope-based isolation (main agent + sub-agents), pricing stamped at call time.

4. **StatusBuilder integration**: Delegated usage tracking from StatusBuilder to UsageTracker. Extracted cache tokens from `usage_metadata.input_token_details`. Enriched `AgentMessage` with `input_tokens`, `output_tokens`, `cache_read_tokens`, `estimated_cost_usd`, `model`. Removed 8 redundant accumulator fields and 2 helper methods.

5. **Duration breakdown**: `llm_duration_ms` from LLM calls, `tool_duration_ms` from tool execution, `approval_wait_duration_ms` from HITL waits, `total_duration_ms` from started_at/completed_at. All tracked per-scope.

6. **Summarization cost capture**: Created `_SummarizationUsageCapture` callback handler to intercept hidden LLM calls in graphton's `_perform_summarization()`. Extended `SummarizationEventData` with `summarization_input_tokens`, `summarization_output_tokens`, `summarization_cost_usd`.

7. **Tests**: 35 new tests — 23 for UsageTracker, 7 for ModelRegistry reverse lookup, 5 for summarization token capture. All pass.

### Discoveries During Phase 3

- **Proto import migration needed**: Phase 1's file split moved messages to separate `_pb2.py` modules but Python imports were never updated. Fixed 3 production files; remaining test imports documented as cleanup task.
- **LangChain cache semantics verified**: `input_tokens` includes cached tokens (total input). Non-cached regular input = `input_tokens - cache_creation - cache_read`.
- **StatusBuilder extraction was essential**: At 3,200 lines, adding cost logic directly would have been unmaintainable. UsageTracker provides clean separation.

### Files Changed (11 files, +486 -160)

**New**:
- `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`
- `backend/services/agent-runner/tests/test_usage_tracker.py`

**Modified**:
- `backend/libs/python/graphton/src/graphton/core/model_registry.py`
- `backend/libs/python/graphton/src/graphton/core/summarization_callback.py`
- `backend/libs/python/graphton/src/graphton/core/summarization_middleware.py`
- `backend/libs/python/graphton/tests/core/test_model_registry.py`
- `backend/libs/python/graphton/tests/core/test_summarization_middleware.py`
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`
- `backend/services/agent-runner/worker/tools/publish_artifact.py`
- `backend/services/agent-runner/tests/test_status_builder.py`

## Next Steps

Pick up in this order:

### Immediate: Phase 3 Cleanup (2-3 hours)
**Task file**: `tasks/T01_3_cleanup_proto_imports.md`

Fix remaining proto import migration in `test_status_builder.py` (18 inline imports) and `test_git_diff_artifact.py`. Update 12 old StatusBuilder usage tests to use the new UsageTracker-delegated API. This unblocks the full agent-runner test suite.

### Next: Phase 3B — Tool Result Truncation & Cost Cap (1-2 days)
**Task file**: `tasks/T01_3B_tool_truncation_and_cost_cap.md`

Two runtime optimization features deferred from Phase 3:
1. Tool result truncation (`max_tool_result_chars`) — prevent oversized tool outputs from inflating context
2. Cost cap checking (`max_cost_usd`) — stop runaway executions. Warn at 80%, terminate at 100%

Both consume `ExecutionConfig` proto fields from Phase 1 and depend on the running cost tracking from Phase 3.

### Then: Remaining T01 Phases
3. **Phase 4: Prompt Caching** — Restructure prompt construction with `cache_control` breakpoints
4. **Phase 5: Server — Usage Report RPCs** — Implement getSessionUsageReport, getAgentUsageReport, getOrgUsageReport
5. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands
6. **Phase 7: Sub-Agent Model Routing** — Wire `model_override`

## Context for Resume

- `UsageTracker` is in `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`. StatusBuilder owns it via `self._usage_tracker`.
- `ModelRegistry.get_by_api_model_id()` resolves provider API model IDs to `ModelMetadata` for pricing. Uses a lazy reverse index.
- `SummarizationEventData` now carries `summarization_input_tokens`, `summarization_output_tokens`, `summarization_cost_usd`.
- `_SummarizationUsageCapture` callback handler captures hidden LLM usage from LangMem's `summarize_messages()`.
- Cost formula: `(regular_input * input_price + output * output_price + cache_creation * creation_price + cache_read * read_price) / 1_000_000`
- LangChain `input_tokens` = total input (including cached). Regular input = `input_tokens - cache_creation - cache_read`.
- Proto stubs were regenerated via `make protos`. Python imports in production code are fixed; test imports partially remain on old paths.
- Phase 3 plan: `.cursor/plans/phase_3_usage_metrics_4044b9fe.plan.md`
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
