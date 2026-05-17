# Structured Agent Output Model (T02)

**Date**: May 12, 2026

## Summary

Added a structured output contract to the `agent_call` workflow task, enabling dual-channel output (text + typed JSON), output schema validation, repair policies, and richer result metadata. This addresses the #1 architectural gap identified in the workflow domain research: routing on unstructured AI output.

## Problem Statement

`agent_call` tasks produce unstructured text output. When a `switch_case` task routes based on an agent's answer, it evaluates JQ expressions against `$context.taskName` — but that context value is raw prose. There is no contract for what the agent returns, no schema validation, and no way for downstream tasks to reliably extract structured data.

### Pain Points

- `switch_case` expressions like `${ $context.triage.severity == 'critical' }` fail silently when the referenced value is unstructured prose
- No industry-standard schema validation at the orchestration layer (OpenAI Structured Outputs, Instructor, and Guardrails all solve this at the model/framework level)
- No recovery mechanism when agent output doesn't match expectations (fail, retry, or fallback)
- No dual-channel output separating business data from execution metadata

## Solution

Introduced a proto-level structured output contract on `AgentCallTaskConfig` with three new constructs:

1. **`AgentCallOutputContract` message** — declares a JSON Schema (via `google.protobuf.Struct`), on-invalid policy, max retries, and optional fallback task
2. **`OnInvalidOutputPolicy` enum** — `FAIL`, `RETRY` (re-prompt with validation errors), `FALLBACK` (branch to named task)
3. **`output` field on `AgentCallTaskConfig`** — optional, backward-compatible; when absent, behavior is unchanged

Added semantic validation in the Go workflow-runner that warns when `switch_case` tasks route on `agent_call` output that lacks an output schema.

## Implementation Details

### Proto changes (single file)

`apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`:

- Added `import "google/protobuf/struct.proto"` for JSON Schema representation
- Added `OnInvalidOutputPolicy` enum with 4 values (UNSPECIFIED, FAIL, RETRY, FALLBACK)
- Added `AgentCallOutputContract` message with `schema`, `on_invalid`, `max_retries`, `fallback_task`
- Extended `AgentCallTaskConfig` with `AgentCallOutputContract output = 6`
- Updated YAML examples in doc comments to show structured output usage

### Validation warning (Go runner)

`backend/services/workflow-runner/pkg/validation/validate.go`:

- Added `CheckStructuredOutputWarnings()` — scans workflow tasks for switch_case→agent_call routing without output schemas
- Added `referencesContext()` helper — detects `$context.taskName` patterns in expressions
- Integrated into `ValidateWorkflow` activity in `validate_workflow_activity.go`

### Codegen

- Ran `make codegen` in stigmer repo — regenerated Go, Java, Python, TypeScript stubs + SDK code + MCP server + narration
- Ran `make protos` in stigmer-cloud repo — regenerated Go, Java, Python, TypeScript, Dart stubs

### Quality gates

- `buf lint` — clean
- `buf breaking` — clean (all additive changes)
- `go vet` on changed packages — clean

## Benefits

- **Reliable routing**: `switch_case` can evaluate expressions against typed fields instead of parsing prose
- **Self-documenting workflows**: the output schema serves as a contract visible to authors, reviewers, and tooling
- **Graceful failure handling**: authors choose between strict failure, retry-with-feedback, or human escalation
- **Industry alignment**: matches patterns from OpenAI Structured Outputs, Instructor, and Guardrails
- **Backward compatible**: existing workflows with no output schema continue to work unchanged
- **Immediate value**: validation warning nudges authors toward structured output at workflow creation time, even before runtime enforcement

## Impact

- **Workflow authors**: can now declare typed output contracts on agent_call tasks via YAML
- **All SDKs**: Go, Java, Python, TypeScript, Dart stubs regenerated with new types
- **CLI/Web/MCP**: codegen picks up `AgentCallOutputContract` for schema-driven tooling
- **Workflow runner**: validation activity now performs semantic analysis for fragile routing patterns
- **No breaking changes**: all existing workflows and APIs continue to work

## Related Work

- **T01**: Master Plan (parent task defining the phased roadmap)
- **T03**: New task types (`llm_call`, `extract`, `validate`) — will provide native provider-level structured output
- **T05**: Budget primitives — will add cost controls to agent invocations
- Research report: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

---

**Status**: ✅ Production Ready (proto contract + codegen; runtime implementation is a follow-up task)
**Timeline**: Single session
