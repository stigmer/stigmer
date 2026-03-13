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
- **Last Session**: 2026-03-13 — Phase 2 (Model Pricing Registry) completed
- **Active Task**: T01 Phases 1-2 complete, Phase 3 next
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-13, Session 2)

### Phase 2: Model Pricing Registry — COMPLETED

Extended `ModelMetadata` with cache-aware pricing fields and fixed a unit mislabeling:

1. **Fixed pricing field naming**: Renamed `input_cost_per_1k` / `output_cost_per_1k` to `input_price_per_million` / `output_price_per_million`. The fields stored per-million-token pricing but the names said "per_1k" — a bug factory for Phase 3 cost calculation. Now the Python field names match the proto `ModelUsage` field names exactly (zero-conversion stamping).

2. **Added cache pricing fields**: Two new fields on `ModelMetadata`:
   - `cache_creation_price_per_million` — cost to write tokens to provider cache
   - `cache_read_price_per_million` — cost to read tokens from provider cache

3. **Populated cache pricing for all 22 models**:
   - 8 Anthropic models: cache creation = 1.25x input (5-min ephemeral TTL), cache read = 0.1x input
   - 7 OpenAI models: cache creation = 1x input (automatic, no write premium), cache read = 0.5x input
   - 7 Ollama models: None (local, no cost, no caching)

4. **Added 9 new tests** in `TestCachePricing` class — verifying provider-specific multiplier rules, spot-check values, and default behavior for unknown models

5. **Updated engineering docs** (`adding-new-models.md`) — renamed field references, added cache pricing to optional fields table and PR checklist, added "Cache Pricing Reference" section

### Key Decisions Made
- **5-minute ephemeral TTL pricing for Anthropic**: Anthropic offers two cache TTLs (5-min at 1.25x, 1-hour at 2.0x). We store the 5-minute pricing as default since that's what `cache_control: {"type": "ephemeral"}` uses, which Phase 4 will implement.
- **Explicit per-model cache prices over derived multipliers**: Each model entry stores its own cache prices rather than deriving from provider rules. Self-documenting and allows for model-specific exceptions.
- **Unit alignment between Python and proto**: Both use per-million. `ModelMetadata.input_price_per_million` maps directly to `ModelUsage.input_price_per_million` — same name, same unit.

### Files Modified (3 files, +213 -51)
- `backend/libs/python/graphton/src/graphton/core/model_registry.py` — field rename, new fields, cache pricing data
- `backend/libs/python/graphton/tests/core/test_model_registry.py` — field rename, 9 new cache pricing tests
- `docs/engineering/adding-new-models.md` — renamed fields, cache pricing docs, common mistakes

### Pre-existing Issue Noted
Tests reference `claude-haiku-4` which does not exist in the registry (only `claude-haiku-4.5` exists). Causes 8 pre-existing test failures across `test_model_registry.py`, `test_summarization_middleware.py`, `test_summarization.py`. Not introduced by Phase 2 work.

## Session Progress (2026-03-13, Session 1)

### Phase 1: Schema Foundation — COMPLETED

All 6 tasks completed successfully:

1. **File Reorganization**: Split `api.proto` (1084 lines, 16 messages) into 7 focused files within the same `ai.stigmer.agentic.agentexecution.v1` package:
   - `api.proto` → `AgentExecution`, `AgentExecutionStatus`, `TodoItem` (~230 lines)
   - `message.proto` → `AgentMessage`, `ToolCall`, `ComponentMetadata`
   - `subagent.proto` → `SubAgentExecution`
   - `usage.proto` → `UsageMetrics`, `ModelUsage`, `LlmCallMetrics`
   - `context.proto` → `ResolvedExecutionContext`, `McpServerResolutionStatus`, `SummarizationEvent`, `ContextInfo`
   - `approval.proto` → `PendingApproval`, `ChildApprovalNotification`
   - `artifact.proto` → `ExecutionArtifact`
   - `ApprovalAction` enum moved to `enum.proto`

2. **New Usage Types**: Added `ModelUsage` (12 fields) and `LlmCallMetrics` (10 fields) to `usage.proto`

3. **Enriched Existing Messages**:
   - `UsageMetrics`: fields 6-16 (cache tokens, model_breakdown, estimated_cost_usd, tool_result_chars_truncated, llm_calls, 4 duration fields, primary_provider)
   - `SummarizationEvent`: fields 10-12 (summarization LLM call usage)
   - `AgentMessage`: fields 9-13 (per-message cost and model)
   - `ResolvedExecutionContext`: field 4 (excluded_skill_names)

4. **Config & SubAgent**: Added `max_tool_result_chars` (field 4) and `max_cost_usd` (field 5) to `ExecutionConfig`; added `model_override` (field 6) to `SubAgent`

5. **Usage Report Types**: Added 6 request/response messages and 4 supporting types to `io.proto`

6. **RPCs + Build Verification**: Registered 3 RPCs in `query.proto` (getSessionUsageReport, getAgentUsageReport, getOrgUsageReport). `buf build` and `buf lint` pass. `buf breaking --use PACKAGE` passes (FILE-level flags expected due to file reorg).

## Next Steps

Phase 3 and beyond from the T01 plan:
1. **Phase 3: Agent-Runner — Populate New Fields** — Extract cache token counts from LangChain `usage_metadata`, look up pricing from Model Registry, compute `estimated_cost_usd`, populate `ModelUsage` and `LlmCallMetrics`, track duration breakdown, implement tool result truncation and cost cap checking
2. **Phase 4: Agent-Runner — Prompt Caching** — Restructure prompt construction with `cache_control` breakpoints, verify cache hit rates
3. **Phase 5: Server — Usage Report RPCs** — Implement getSessionUsageReport, getAgentUsageReport, getOrgUsageReport handlers
4. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands

## Context for Resume
- Proto stubs already regenerated (done before Phase 2)
- `ModelMetadata` now has 4 pricing fields: `input_price_per_million`, `output_price_per_million`, `cache_creation_price_per_million`, `cache_read_price_per_million` — all matching proto `ModelUsage` field names exactly
- Phase 3 can now call `ModelRegistry.get_or_default(model_name)` and stamp pricing directly to `ModelUsage` with zero conversion
- Cost formula: `estimated_cost_usd = (input * input_price + output * output_price + cache_creation * creation_price + cache_read * read_price) / 1_000_000`
- The `buf breaking` check with `FILE` mode will flag the file reorg as "breaking" — expected and safe. Use `--config '..PACKAGE..'` to verify no wire-level breaking changes.
- Plan file: `_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/T01_0_plan.md`
- Phase 2 plan: `.cursor/plans/model_pricing_registry_bb49c144.plan.md`

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
