# Usage Metrics & Cost Optimization — Phase 1 Schema Foundation

**Date**: March 13, 2026

## Summary

Established the proto schema foundation for usage metrics and cost optimization across the Stigmer agentic platform. Split the monolithic 1084-line `api.proto` into 7 focused files, added 2 new message types for per-model and per-call cost tracking, enriched 5 existing messages with ~25 new fields for cache token differentiation, cost computation, and duration breakdowns, and introduced 3 usage report RPCs for session/agent/org-level cost visibility.

## Problem Statement

Agent execution cost data was fundamentally incomplete — `UsageMetrics` tracked token volume but had zero financial data. There was no way to answer "this execution cost $0.37" or determine whether prompt caching was saving money. Additionally, the 1084-line `api.proto` was becoming unnavigable and would grow past 1300 lines with the new types.

### Pain Points

- No cost/pricing data on executions — impossible to calculate or display costs
- No cache token differentiation — cached tokens (10x cheaper) lumped with regular tokens
- No per-model breakdown — multi-model executions (main + summarization model) couldn't attribute cost
- No per-call granularity — couldn't verify cache hit patterns or debug expensive calls
- No cost cap mechanism — runaway agents could drain API credits without limit
- No usage reporting RPCs — no way to query historical cost data at any level
- Monolithic api.proto (1084 lines) — difficult to navigate and maintain

## Solution

Designed and implemented the Phase 1 schema changes in a "refactor first, extend second" approach:

1. **File reorganization**: Split api.proto into domain-focused files within the same proto package (preserving DDD aggregate boundaries and generated code identity)
2. **New cost types**: `ModelUsage` with disjoint token buckets and stamped pricing rates; `LlmCallMetrics` for per-call debugging
3. **Message enrichment**: Cache tokens, cost estimates, duration breakdowns, and model attribution across existing types
4. **Config controls**: Cost cap and tool result truncation limits on `ExecutionConfig`
5. **Report RPCs**: Session, agent, and org-level usage report endpoints

## Implementation Details

### File Reorganization (same package, multiple files)

Split `agentexecution/v1/api.proto` into:

| File | Messages | Lines |
|------|----------|-------|
| `api.proto` | AgentExecution, AgentExecutionStatus, TodoItem | ~230 |
| `message.proto` | AgentMessage, ToolCall, ComponentMetadata | ~226 |
| `subagent.proto` | SubAgentExecution | ~105 |
| `usage.proto` | UsageMetrics, ModelUsage, LlmCallMetrics | ~323 |
| `context.proto` | ResolvedExecutionContext, McpServerResolutionStatus, SummarizationEvent, ContextInfo | ~308 |
| `approval.proto` | PendingApproval, ChildApprovalNotification | ~158 |
| `artifact.proto` | ExecutionArtifact | ~64 |

### Key Design Decision: Disjoint Token Buckets

`ModelUsage.input_tokens` represents non-cached input only (following Anthropic convention). Four buckets — `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens` — are completely non-overlapping, making cost calculation a simple sum-of-products with no subtraction or ambiguity.

### New Fields Added

- **UsageMetrics** (fields 6-16): cache tokens, model breakdown, estimated cost, tool truncation tracking, per-call metrics, 4 duration fields, provider
- **ModelUsage** (12 fields): model, provider, 4 token buckets, call count, 4 pricing rates, computed cost
- **LlmCallMetrics** (10 fields): sequence, model, provider, tokens, cost, duration, timestamp
- **SummarizationEvent** (fields 10-12): summarization LLM call token usage and cost
- **AgentMessage** (fields 9-13): per-message input/output tokens, cache tokens, cost, model
- **ResolvedExecutionContext** (field 4): excluded skill names for context filtering visibility
- **ExecutionConfig** (fields 4-5): max_tool_result_chars, max_cost_usd
- **SubAgent** (field 6): model_override

### Usage Report RPCs

Three new RPCs on `AgentExecutionQueryController`:
- `getSessionUsageReport` — per-execution breakdown within a session
- `getAgentUsageReport` — per-session breakdown for an agent (paginated, time-ranged)
- `getOrgUsageReport` — org-wide totals, top agents by cost, daily trend

## Benefits

- **Accurate cost tracking**: Every execution carries self-contained cost data with stamped pricing rates
- **Cache visibility**: Separate cache_creation and cache_read token tracking enables cache hit rate analysis
- **Cost control**: `max_cost_usd` on ExecutionConfig prevents runaway agent spend
- **Multi-level reporting**: Session, agent, and org usage reports for billing and capacity planning
- **Maintainable codebase**: api.proto reduced from 1084 to ~230 lines; each file has a clear domain focus
- **Wire-compatible**: Zero breaking changes at the protobuf package level

## Impact

- **Proto APIs**: 8 files modified, 6 new files created in `agentexecution/v1/`; 1 field added in `agent/v1/spec.proto`
- **External consumers**: `workflowexecution/v1/` imports updated (approval.proto, enum.proto)
- **Generated code**: Same package, same types — all consumers (Go, Python, Java) see the same API after stub regeneration
- **Runtime**: No runtime changes yet — Phase 2 will populate these fields from LangGraph events

## Related Work

- Phase 2 (Runtime Implementation): Python agent-runner to populate new fields from LangGraph events
- Phase 3 (Backend): Go stigmer-server to implement usage report RPC handlers
- Phase 4 (CLI): `stigmer usage` commands for cost visibility
- Project plan: `_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/T01_0_plan.md`

---

**Status**: ✅ Production Ready (schema only — runtime population in Phase 2)
**Timeline**: 1 session
