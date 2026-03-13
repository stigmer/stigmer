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
- **Last Session**: 2026-03-13 — Phase 1 (Schema Foundation) completed
- **Active Task**: T01 Phase 1 complete, Phase 2 next
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-13)

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

### Key Decisions Made
- **File reorg over sub-packages**: All types stay in the same proto package (DDD aggregate root boundary), split across multiple files for navigability
- **ModelUsage.input_tokens = non-cached input only**: Follows Anthropic provider convention, creates 4 disjoint token buckets for clean cost math
- **Usage report RPCs in query.proto**: Data-colocated with the AgentExecution query controller, consistent with listBySession pattern
- **SubAgent.model_override in agent/v1/spec.proto**: Confirmed as field 6 on SubAgent

### Files Modified (8 modified, 6 new)
- Modified: `api.proto`, `enum.proto`, `io.proto`, `query.proto`, `spec.proto` (agentexecution), `spec.proto` (agent), `workflowexecution/api.proto`, `workflowexecution/io.proto`
- New: `message.proto`, `subagent.proto`, `usage.proto`, `context.proto`, `approval.proto`, `artifact.proto`

## Next Steps

Phase 2 and beyond from the T01 plan:
1. **Phase 2: Runtime Implementation (Python/agent-runner)** — Populate the new proto fields from LangGraph `on_chat_model_end` events, implement prompt caching, tool result truncation, model routing
2. **Phase 3: Backend (Go/stigmer-server)** — Implement usage report RPC handlers, aggregate usage data across executions/sessions
3. **Phase 4: CLI** — Add `stigmer usage` commands for cost visibility
4. **Regenerate stubs** — Run `buf generate` / stub regeneration before starting Phase 2

## Context for Resume
- The `buf breaking` check with `FILE` mode will flag the file reorg as "breaking" — this is expected and safe. Use `--config '..PACKAGE..'` to verify no actual wire-level breaking changes.
- `workflowexecution/v1/api.proto` now imports `approval.proto` (was `api.proto`); `workflowexecution/v1/io.proto` now imports `enum.proto` (was `api.proto` — for `ApprovalAction`)
- Plan file: `_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/T01_0_plan.md`
- Design plan: `.cursor/plans/phase_1_schema_foundation_d775fd3a.plan.md`

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
