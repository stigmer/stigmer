# Phase 6: CLI Usage Display & Commands

**Date**: March 14, 2026

## Summary

Added per-execution cost visibility to the CLI and implemented `stigmer usage session|agent|org` commands that consume the Usage Report RPCs built in Phase 5. Users can now see model, cost, and cache efficiency directly in the execution summary panel, and run detailed usage reports at session, agent, or organization scope.

## Problem Statement

After Phases 1–5 established the full usage data pipeline (schema, pricing, field population, caching, server RPCs), the data was flowing through the system but invisible to CLI users. There was no way to see cost or model information in the terminal after an execution, and no way to query historical usage reports.

### Pain Points

- Execution summary showed only token counts — no cost, model, or cache data
- No CLI commands to query usage reports at any granularity
- Users had no self-service cost visibility without querying the backend directly

## Solution

Two complementary deliverables:

1. **Per-execution panel enhancement** — Model and Cost lines added to the existing EXECUTION COMPLETE panel, plus inline cost in the session exit line (`Completed (30s · $0.074)`)
2. **`stigmer usage` command family** — Three subcommands (`session`, `agent`, `org`) that call the Phase 5 gRPC RPCs and render rich tabular reports in the terminal

## Implementation Details

### Shared Formatting Helpers (`usage_format.go`)

12 pure functions with zero side effects, zero I/O:

- `formatCost` — Sub-cent precision (`$0.074`) when < $1, standard two-decimal (`$1.23`) otherwise
- `formatCacheHitRate` — `82% cached` from cache_read_tokens / prompt_tokens
- `formatModelLabel` — `claude-sonnet-4 (anthropic)` from primary_model + primary_provider
- `formatDurationBreakdown` — `LLM 12s · Tools 28s` with zero-component omission
- `formatCostLine` — Composite `$0.074 (82% cached)` for the panel
- `formatDate`, `formatDateRange`, `formatShare`, `formatMillis`, `formatTokensCompact`
- `writeReportJSON`, `writeReportYAML` — Shared output serializers

30 unit tests cover all helpers including edge cases (nil usage, zero cost, missing provider, millions of tokens).

### Panel Enhancement (`run_display_summary.go`)

Added Model line (before Tokens) and Cost line (after Tokens) to `buildAgentSummaryContent`. Enhanced `displaySessionExitLine` to append `· $cost` when cost data is available. All additions guard on data presence — old executions without Phase 1 data display exactly as before.

### Usage Commands (`usage.go`, `usage_session.go`, `usage_agent.go`, `usage_org.go`)

All three follow the established `search.go` pipeline pattern: args → config → daemon → connect → gRPC RPC → render. Each supports `--output table|json|yaml`. No new abstractions introduced.

- **session**: Single session-id arg. Model breakdown table + per-execution detail table with status.
- **agent**: Agent-id arg + optional `--from`/`--to` date flags. Summary stats (sessions, executions, total cost, avg/exec) + per-model breakdown with cost share + per-session table.
- **org**: Required `--from`/`--to` + optional `--org`. Summary stats + per-model breakdown + top agents by cost + daily cost trend.

### Build Integration

Updated `BUILD.bazel` with 5 new source files, 4 new test files, and `fatih/color` library dependency.

## Benefits

- **Instant cost feedback**: Users see model and cost right in the terminal after every execution
- **Self-service reporting**: `stigmer usage` provides session/agent/org level reports without needing a web UI
- **Cache visibility**: Cache hit rate shown alongside cost helps users understand optimization impact
- **Scriptable output**: `--output json|yaml` enables programmatic consumption for dashboards or alerts
- **Zero regression**: Graceful degradation ensures old executions display identically

## Impact

- **CLI users**: Every execution now surfaces cost and model information immediately
- **Platform operators**: Org-level usage reports enable budget monitoring and capacity planning
- **Developers**: Agent-level reports help identify cost optimization opportunities per agent

## Related Work

- Phase 1: Schema Foundation (`UsageMetrics`, `ModelUsage`, `LlmCallMetrics` protos)
- Phase 2: Model Pricing (`model_pricing.py`, per-token cost computation)
- Phase 3: Agent-Runner Field Population (Python event handlers)
- Phase 4: Prompt Caching (Anthropic automatic + explicit caching)
- Phase 5: Server Usage Report RPCs (Go + Java gRPC handlers)
- Phase 7 (next): Sub-Agent Model Routing

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (Phase 6 only)
