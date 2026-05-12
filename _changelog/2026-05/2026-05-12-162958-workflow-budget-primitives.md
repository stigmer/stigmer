# Workflow-Level Budget Primitives

**Date**: May 12, 2026

## Summary

Added workflow-level and per-task budget declarations to the Stigmer workflow domain, enabling authors to express cost, token, and duration limits directly in workflow specs. This lays the foundation for runtime budget enforcement (T13) by establishing the proto contracts, semantic validation warnings, and task schema registry metadata.

## Problem Statement

Workflows that invoke LLM calls and agent executions can accumulate unbounded costs. Without budget primitives in the domain model, there is no way for workflow authors to express spending limits, no way for the platform to validate budget configurations at design time, and no contract for the runtime to enforce limits at execution time.

### Pain Points

- Workflow specs had no mechanism to declare cost, token, or duration caps
- No validation feedback when a workflow contains cost-incurring tasks without any budget
- Per-task cost limits were missing from `LlmCallTaskConfig` and `AgentExecutionConfig`
- The task schema registry had no budget-related field group metadata for UI/CLI consumption

## Solution

Introduced a layered budget model: workflow-level budget on `WorkflowSpec` sets the aggregate ceiling, while per-task budget fields on cost-incurring tasks (`llm_call`, `agent_call`) set individual caps. A `BudgetExceededPolicy` enum governs what happens when limits are breached. Design-time validation warns about common misconfigurations. All cost amounts use `int64` micro-USD, consistent with the billing domain.

## Implementation Details

### Proto Changes

| File | Change |
|------|--------|
| `apis/.../workflow/v1/spec.proto` | `WorkflowBudget` message with `max_cost_micros`, `max_total_tokens`, `max_duration_seconds`, `on_exceeded`; `budget` field (5) on `WorkflowSpec` |
| `apis/.../workflow/v1/enum.proto` | `BudgetExceededPolicy` enum: `terminate`, `human_review`, `warn` |
| `apis/.../workflow/v1/tasks/llm_call.proto` | `max_cost_micros` (field 11), `max_total_tokens` (field 12) on `LlmCallTaskConfig` |
| `apis/.../workflow/v1/tasks/agent_call.proto` | `max_cost_micros` (field 5) on `AgentExecutionConfig` |

### Validation

`CheckBudgetWarnings()` in `backend/services/workflow-runner/pkg/validation/validate.go` produces warnings for:
1. Workflows with cost-incurring tasks but no workflow-level budget
2. Per-task cost caps exceeding the workflow-level budget
3. Sum of all per-task cost caps exceeding the workflow-level budget

### Task Schema Registry

- Updated `llm_call.yaml` and `agent_call.yaml` sidecar metadata with `budget` field groups
- Regenerated `task-kind-registry.json` with updated field descriptors and schemas

### Codegen Bug Fix (T04 Loose End)

Fixed a critical codegen issue where two gRPC services sharing the same role (`"query"`) caused duplicate field names in SDK client classes and incorrect import paths in TypeScript and Python generators:

- Added `ProtoFile` field to `ServiceDefinition` for proto-file-based import resolution
- Introduced `inferUniqueServiceRole()` for collision-free role derivation
- Added `tsServiceImportSuffix()` and `pyServiceModule()` helpers for correct module paths

### Key Design Decisions

- **No `budget_guard` task kind**: The existing `validate` task with budget context variables handles explicit mid-workflow checks without unnecessary complexity
- **Proto + validation + registry only**: Runtime enforcement deferred to T13, consistent with Phase 0 pattern
- **Micro-USD (int64)**: Matches `CostStamp.provider_cost_micros` and `CreditLedgerEntry.amount_micros`
- **Per-task budget on cost-incurring tasks only**: Only `agent_call` and `llm_call` consume LLM tokens

## Benefits

- **Author safety**: Workflow authors can now express budget constraints declaratively in YAML/JSON specs
- **Design-time feedback**: Validation warnings catch budget misconfigurations before execution
- **UI/CLI readiness**: Task schema registry metadata enables budget-aware form rendering
- **Billing alignment**: Consistent micro-USD representation across budget, billing, and usage domains
- **Clean codegen**: Fixed SDK generation bug that would have compounded with future service additions

## Impact

- **Workflow authors**: Can set spending limits on workflows and individual tasks
- **SDK consumers**: All language SDKs (Go, TypeScript, Python, Java, Dart) include generated budget types
- **UI/CLI developers**: Registry metadata provides field groups for budget configuration forms
- **Runtime (future)**: T13 will implement enforcement using these proto contracts

## Related Work

- `2026-05-12-154911-task-schema-registry.md` — T04 schema registry (budget fields extend this)
- `2026-05-12-124751-structured-agent-output-model.md` — T02 structured outputs
- `2026-05-03-113656-billing-proto-contracts-and-pricing-foundation.md` — Billing domain contracts (micro-USD convention)

---

**Status**: Production Ready
**Timeline**: T05 of Phase 0 (Harden Workflow Core)
