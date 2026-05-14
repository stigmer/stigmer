# Session Notes: 2026-05-14 — Unified Platform Dashboard

## Accomplishments

- Transformed the workflow-only `/dashboard` page into a unified platform dashboard that
  surfaces both agent and workflow execution metrics in a single operational view
- Full vertical slice: proto API definition, Go+Java backend handlers, React SDK module,
  web+desktop console integration
- Established 5 architectural decisions (AD-DASH-001 through AD-DASH-005) governing
  dashboard domain design, data composition, and cost attribution

## Decisions Made

### AD-DASH-001: No platform-wide summary RPC
Client-side composition (merging agent + workflow summaries in the SDK) preserves bounded
contexts. Adding a `getPlatformSummary` RPC would create a cross-domain dependency.

### AD-DASH-002: Parallel getExecutionSummary on agent domain
Mirror the existing workflow `getExecutionSummary` pattern for agents. Both RPCs return
structurally similar summaries (active count, phase counts, avg duration, top failures).

### AD-DASH-003: Execution counts are safe to add
Agent executions and workflow executions are distinct resources with no overlap. Active,
completed, and failed counts can be summed without risk of double-counting.

### AD-DASH-004: SDK-first, headless-first
New dashboard module follows the established layered architecture:
data hooks → composition hooks → styled components → composed widgets.

### AD-DASH-005: Cost from billing source of truth (no double-counting)
Total platform cost comes from `getOrgUsageReport` (billing domain), NOT from summing
agent + workflow costs. When a workflow delegates to an agent, the agent's LLM calls
create billing records AND the workflow's `total_cost_micros` includes that cost —
summing both would double-count. Known gap: direct workflow `llm_call` tasks bypass
the billing pipeline (cost only on `WorkflowExecutionStatus.total_cost_micros`).

## Key Code Changes

### Proto API (2 files)
- `agentexecution/v1/io.proto`: Added `AgentExecutionSummary`, `GetAgentExecutionSummaryRequest`,
  `AgentFailureRank`, `AgentExecutionSummaryTimeWindow`
- `agentexecution/v1/query.proto`: Added `getExecutionSummary` RPC to `AgentExecutionQueryController`

### Backend (2 new files)
- `stigmer-server/pkg/domain/agentexecution/controller/get_execution_summary.go`:
  Go handler with SQLite aggregation
- `stigmer-cloud/.../AgentExecutionGetExecutionSummaryHandler.java`:
  Java handler with MongoDB aggregation

### SDK Dashboard Module (8 new files)
- `sdk/react/src/dashboard/types.ts` — DashboardSummary, DashboardFailedRun
- `sdk/react/src/dashboard/useAgentExecutionSummary.ts` — data hook
- `sdk/react/src/dashboard/useDashboardSummary.ts` — composition hook (merges 3 sources)
- `sdk/react/src/dashboard/useDashboardFailedRuns.ts` — composition hook
- `sdk/react/src/dashboard/DashboardKPICards.tsx` — unified stat cards with tooltips
- `sdk/react/src/dashboard/DashboardFailedRuns.tsx` — merged failure list
- `sdk/react/src/dashboard/OperationalDashboard.tsx` — composed widget
- `sdk/react/src/dashboard/index.ts` — barrel exports

### Console Pages (2 modified)
- `client-apps/web/src/domain/dashboard/DashboardPage.tsx` — OperationalDashboard + charts
- `client-apps/desktop/src/pages/dashboard/DashboardPage.tsx` — identical, DD-016 parity

### SDK Client Patch (1 modified)
- `sdk/typescript/src/gen/agentexecution.ts` — manually added `getExecutionSummary` method
  (codegen gap workaround)

## Learnings

- **proto2schema codegen gap**: The `proto2schema` tool that generates JSON schemas for
  SDK client codegen does not automatically pick up new query RPCs added to existing
  services. Manual patches to generated files are a temporary workaround but create
  maintenance risk — this should be fixed in the codegen toolchain.

- **Client-side composition is the right pattern**: Following `useRecentActivity`'s
  established pattern of merging data from agent and workflow domains client-side
  keeps the backend services cleanly separated while providing a unified UI.

- **Cost attribution is subtle**: Simply summing costs from different execution domains
  leads to double-counting. The billing pipeline (`LlmCallUsageRecord` → `getOrgUsageReport`)
  is the only reliable source of truth for total platform cost.

## Open Questions

- Should the workflow-specific charts (`CostByWorkflowChart`, `ExecutionTrendChart`) be
  unified to show both agent and workflow data? Currently they remain workflow-scoped.
- When will the `proto2schema` codegen gap be fixed so the manual SDK client patch can
  be removed?
- Usage page unification (show workflow data alongside agent data) — when to tackle?

## Next Session Plan

1. **T16: Natural Language to Workflow** (Phase 3) — prompt-to-workflow generation,
   chat-to-workflow, repair assistant
2. Or tackle open tech debt: proto2schema codegen fix, Usage page unification,
   CheckBudgetWarnings wiring, OSS event persistence
