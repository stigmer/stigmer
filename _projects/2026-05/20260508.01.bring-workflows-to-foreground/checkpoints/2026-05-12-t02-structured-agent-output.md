# Session Notes: 2026-05-12

## Task: T02 — Structured Agent Output Model

## Accomplishments

- Defined `AgentCallOutputContract` message with JSON Schema, on-invalid policy, max retries, and fallback task
- Added `OnInvalidOutputPolicy` enum (FAIL, RETRY, FALLBACK)
- Extended `AgentCallTaskConfig` with `output` field (field 6, backward compatible)
- Added semantic validation warning in Go workflow-runner for switch_case routing on unschema'd agent_call output
- Passed `buf lint` and `buf breaking` checks
- Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) — all stubs regenerated

## Decisions Made

1. **Structured output lives on `AgentCallTaskConfig`** (workflow-scoped, not agent-scoped) — different workflows can want different structured views of the same agent
2. **Schema is `google.protobuf.Struct` carrying JSON Schema** — industry standard, no Stigmer-specific schema language
3. **Three on-invalid policies**: fail (strict), retry (re-prompt with errors), fallback (branch to named task)
4. **Dual-channel output**: structured JSON + execution summary in `WorkflowTask.output`, full traces via agent_execution_id link
5. **Scope is proto + codegen only** — runtime implementation is a follow-up
6. **Backward compatible** — no output schema = unchanged behavior

## Key Code Changes

- `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`: Added `OnInvalidOutputPolicy` enum, `AgentCallOutputContract` message, `output` field on `AgentCallTaskConfig`
- `backend/services/workflow-runner/pkg/validation/validate.go`: Added `CheckStructuredOutputWarnings()` and `referencesContext()` for semantic analysis
- `backend/services/workflow-runner/worker/activities/validate_workflow_activity.go`: Integrated semantic warnings into the validation pipeline

## Next Session Plan

- T02 is complete — move to T03 or the next task in the master plan
- T03 candidates: new task types (`llm_call`, `extract`, `validate`) for native provider-level structured output
- Runtime implementation of the output contract (Go workflow-runner extraction + validation) is a separate follow-up task
