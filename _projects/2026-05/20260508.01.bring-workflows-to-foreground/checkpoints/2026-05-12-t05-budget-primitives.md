# Session Notes: 2026-05-12 — T05 Workflow-Level Budget Primitives

## Accomplishments

- **WorkflowBudget proto message**: Added to `spec.proto` with `max_cost_micros` (int64), `max_total_tokens` (int64), `max_duration_seconds` (int32), and `on_exceeded` (BudgetExceededPolicy). All cost fields use micro-USD (1 USD = 1,000,000 micros) consistent with the billing domain.

- **BudgetExceededPolicy enum**: Added to `enum.proto` with `budget_exceeded_terminate`, `budget_exceeded_human_review`, and `budget_exceeded_warn` values.

- **Per-task budget fields on LlmCallTaskConfig**: `max_cost_micros` (field 11) and `max_total_tokens` (field 12) for per-task cost and token caps.

- **Per-task budget field on AgentExecutionConfig**: `max_cost_micros` (field 5) for per-agent-call cost cap.

- **CheckBudgetWarnings()**: New validation function in `validate.go` that produces warnings for: (1) workflows with cost-incurring tasks but no budget, (2) per-task cost caps exceeding workflow budget, (3) combined per-task costs exceeding workflow budget.

- **Sidecar YAML updates**: Added `budget` field groups to `llm_call.yaml` and `agent_call.yaml`.

- **T04 codegen bug fix**: Fixed duplicate `"role": "query"` in `ServiceDefinition` that caused broken TS/Python/Go SDK generation. Added `ProtoFile` field to `ServiceDefinition`, `inferUniqueServiceRole()` function, and `tsServiceImportSuffix()` / `pyServiceModule()` helpers. All SDK generators now produce correct code when multiple services share the same role.

- **Full codegen pipelines**: Both `make codegen` (stigmer) and `make protos` (stigmer-cloud) run cleanly. `task-kind-registry.json` generated and placed in stigmer-cloud classpath.

## Decisions Made

- **D1: No `budget_guard` task kind.** Workflow-level budget is enforced automatically by the runtime (T13). Mid-workflow explicit checks use the existing `validate` task kind with budget context variables. Adding a task kind later is cheap if needed.

- **D2: Proto + validation + registry only.** Consistent with T02/T03/T04 Phase 0 pattern. Runtime enforcement depends on T06 (Event Stream) for accumulated cost tracking and belongs in T13.

- **D3: Amounts in micro-USD (int64).** Matches `CostStamp.provider_cost_micros`, `CreditLedgerEntry.amount_micros`, `ExecutionReservation.reserved_micros`. No floating-point dollar fields.

- **D4: Per-task budget on cost-incurring tasks only.** Only `agent_call` and `llm_call` consume LLM tokens. Other task kinds don't get budget fields.

- **D5: React SDK `workflow/types.ts` deferred.** The proto stubs and generated TypeScript SDK already include `WorkflowBudget`, `BudgetExceededPolicy`, and `WorkflowBudgetInput` types. A dedicated React SDK types file isn't needed until workflow-specific hooks require custom types beyond what the proto stubs provide.

## Key Code Changes

| File | Change |
|------|--------|
| `apis/.../workflow/v1/spec.proto` | Add `WorkflowBudget` message, `budget` field (5) on `WorkflowSpec` |
| `apis/.../workflow/v1/enum.proto` | Add `BudgetExceededPolicy` enum (3 values) |
| `apis/.../workflow/v1/tasks/llm_call.proto` | Add `max_cost_micros` (11), `max_total_tokens` (12) |
| `apis/.../workflow/v1/tasks/agent_call.proto` | Add `max_cost_micros` (5) to `AgentExecutionConfig` |
| `apis/.../workflow/v1/tasks/meta/llm_call.yaml` | Add `budget` field group |
| `apis/.../workflow/v1/tasks/meta/agent_call.yaml` | Add `budget` field group |
| `backend/.../validation/validate.go` | Add `CheckBudgetWarnings()` function |
| `tools/codegen/proto2schema/main.go` | Add `ProtoFile` to `ServiceDefinition`, fix duplicate roles |
| `tools/codegen/generator/sdk_client.go` | Add `ProtoFile` to `ServiceDefinition` |
| `tools/codegen/generator/sdk_client_ts.go` | Add `tsServiceImportSuffix()` for correct proto imports |
| `tools/codegen/generator/sdk_client_python.go` | Add `pyServiceModule()`, fix pb2_grpc imports |
| `tools/codegen/output/task-kind-registry.json` | Regenerated with budget fields |
| (stigmer-cloud) `src/main/resources/task-kind-registry.json` | Updated classpath resource |

## Learnings

- **Service role collisions in codegen**: When two gRPC services in the same proto package share the same conceptual role (e.g., both are "query" services), the SDK generators create duplicate field names. The fix requires both unique role derivation and proto-file-based import path resolution — the role determines the field name while the proto file determines the import module.

- **Field groups in the task registry**: The sidecar YAML `field_groups[].fields` lists provide grouping metadata, but the current registry generator doesn't resolve them into either field-level group references or group-level field arrays. The groups serve as organizational metadata for SDK/UI consumers to pair with field descriptors.

## Verification Results

- `buf lint` — zero errors
- `buf breaking` — zero breaking changes (all additive)
- `go vet ./...` — zero errors (workflow-runner)
- `go test ./pkg/validation/...` — all tests pass
- TypeScript SDK compiles cleanly (`tsc --noEmit`)
- Generated TS SDK correctly includes `WorkflowBudgetInput`, `BudgetExceededPolicy`, `buildWorkflowBudgetProto`

## Next Session Plan

1. T06: Event Stream — define workflow event contracts for runtime observability
2. After T06: T07 (Artifact Store) to complete Phase 0
3. After Phase 0: Phase 1 — Foreground MVP
