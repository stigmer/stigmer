# Add human_input and validate Workflow Task Types (T03 Batch 2)

**Date**: May 12, 2026

## Summary

Added two governance-focused workflow task types — `human_input` and `validate` — as proto definitions with full codegen, validation wiring, and regenerated stubs across all five languages. These close critical safety gaps by enabling workflow-level approval gates and explicit data validation checkpoints.

## Problem Statement

The workflow domain lacked two essential governance primitives: a way to pause execution for human judgment before proceeding, and a way to validate data correctness before downstream tasks consume it. These gaps forced users to approximate safety checks with workarounds that were invisible in the execution trace and unreliable in production.

### Pain Points

- No workflow-level approval gate — approval decisions only existed inside agents (tool-level HITL), invisible at the workflow orchestration layer
- No way to model multi-party approval with custom outcomes (approve, deny, needs revision, escalate) and routing to different workflow branches
- No timeout-aware human interaction — if a reviewer doesn't respond, the workflow hangs indefinitely
- No explicit validation checkpoint — distinguishing "the API call succeeded" from "the data is safe and complete enough to continue" required convoluted `switch_case` + `raise_error` patterns
- No advisory validation — either the workflow failed or it continued; no middle ground for logging warnings while proceeding

## Solution

Add `human_input` (enum 16) for workflow-level approval gates and `validate` (enum 17) for schema and business-rule validation checkpoints. Both follow the established proto-first pattern from Batch 1. Policy enums are kept local to their proto files since their semantics are task-specific and not shared.

## Implementation Details

### New Proto Files

- **`human_input.proto`**: The most architecturally significant proto in T03. Contains:
  - `HumanInputTimeoutPolicy` enum (5 values) — fail, auto-approve, auto-deny, escalate. Kept local because timeout-on-human-interaction is a concept unique to this task type.
  - `HumanInputOutcome` message — named outcomes with optional labels and branching (`then` field for routing to downstream tasks). Enables rich patterns beyond binary approve/deny.
  - `HumanInputTaskConfig` with 7 fields — prompt (expression-interpolated), form_schema (JSON Schema for typed input forms), outcomes (repeated, for custom routing), approvers (user/team/role identifiers), timeout (0–30 days), on_timeout (timeout policy), notification_channels (channel identifiers for alerting reviewers).

- **`validate.proto`**: Explicit validation checkpoint with two complementary modes. Contains:
  - `ValidationFailPolicy` enum (4 values) — raise (hard stop), branch (to fallback task), warn (log and continue). Kept local because its semantics differ from `OnInvalidOutputPolicy` (no RETRY — data validation has no LLM to re-prompt; has WARN — advisory validation is meaningful for data checks but not for LLM output).
  - `ValidationRule` message — named business rules with boolean expressions and custom error messages. Uses the same expression engine as `switch_case.when` for consistency.
  - `ValidateTaskConfig` with 5 fields — input (expression selecting data to validate), schema (JSON Schema), rules (business-rule expressions), on_fail (failure policy), fallback_task (branch target). Cross-field constraint "at least one of schema or rules" documented in proto and enforced at runtime.

### Modified Files

- `enum.proto`: Added `human_input = 16` and `validate = 17` to `WorkflowTaskKind` with config schema summaries
- `spec.proto`: Added kind-to-config mapping comments for both new types
- `unmarshal.go`: Added switch cases for both new task types in the validation pipeline
- `tasks/README.md`: Updated task definitions table to 17 entries

### Design Decisions

1. **Policy enums stay local**: `HumanInputTimeoutPolicy` and `ValidationFailPolicy` are not added to `common.proto`. Unlike `OnInvalidOutputPolicy` (shared by `agent_call` and `llm_call` with identical semantics), the new enums have no second consumer and their values don't align with existing shared enums.

2. **Cross-field constraint at runtime**: The "at least one of schema or rules" constraint on `ValidateTaskConfig` cannot be expressed in `buf.validate` (which operates on individual fields). Documented in proto comments, enforced in the Go validation layer — consistent with how cross-field constraints are handled elsewhere in the codebase.

3. **form_schema pattern consistency**: `HumanInputTaskConfig.form_schema` uses the same `google.protobuf.Struct` + JSON Schema pattern as `AgentCallOutputContract.schema`, `LlmCallTaskConfig.response_schema`, establishing a consistent pattern across four task types now.

## Benefits

- Workflows can now model real-world approval processes: multi-party review, custom outcomes with routing, timeout policies, and notification integration
- Data validation is an explicit, inspectable step in the execution trace — not a hidden side effect of `switch_case` patterns
- Advisory validation (WARN policy) enables monitoring and audit workflows that don't block on non-critical issues
- The `human_input` output model (outcome + form_data + reviewer + timestamp) enables rich downstream routing via `switch_case` expressions

## Impact

- **Proto API**: Two new task types (17 total) available in the workflow DSL; no breaking changes to existing types
- **Workflow Runner (Go)**: Unmarshal switch cases wired; runtime implementation deferred to T13 (Temporal signals for `human_input` resumption, JSON Schema + expression evaluation for `validate`)
- **Stigmer Service (Java)**: Stubs regenerated in stigmer-cloud; no service code changes needed yet
- **SDK / MCP Server / Codegen**: All downstream artifacts regenerated automatically
- **Execution Viewer (T09)**: Both task types will be visible as distinct steps with rich input/output in the execution trace

## Related Work

- T02 (Structured Agent Output Model) — established the `OnInvalidOutputPolicy` and JSON Schema validation patterns
- T03 Batch 1 (llm_call + transform) — established the `common.proto` convention and the Batch 1 proto patterns that Batch 2 follows
- T03 Batch 3 (emit_event + notification) — next in queue, completing the T03 task type roster
- T13 (Runtime Implementation) — will implement Go Temporal activities: Temporal signals for `human_input`, JSON Schema validation + expression evaluation for `validate`
- T09 (Execution Viewer) — will render `human_input` approval gates and `validate` checkpoints in the UI

---

**Status**: ✅ Production Ready (proto + codegen layer; runtime is T13)
**Timeline**: Single session
