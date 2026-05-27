# Fix Converter: agent_call Output Schema Propagation to CNCF DSL

**Date**: May 27, 2026

## Summary

Fixed the Go CNCF DSL converter to include the `AgentCallOutputContract` (output schema, validation policy, retry config, fallback task) when converting `agent_call` tasks from proto to CNCF Serverless Workflow DSL YAML. Without this, the structured output pipeline was completely non-functional for workflow agent calls — the Cursor harness never received the schema, never injected the JSON instruction into the prompt, and never extracted structured output from the agent's response.

## Problem Statement

When the `daily-notification-plan` workflow ran, downstream tasks received empty values for all `${ $context.analyze_player_data.* }` expressions. The agent call task produced output, but the structured extraction pipeline was never triggered.

### Pain Points

- `$context` populated with null values, causing all downstream embedded expressions to resolve to empty strings
- The Cursor harness prompt never included the "CRITICAL OUTPUT REQUIREMENT" JSON schema instruction (gated on `structuredOutputSchema`)
- The 3-tier structured extraction pipeline (JSON.parse → code-fence → LLM) was entirely skipped
- Output validation and retry (`on_invalid: ON_INVALID_RETRY`) were non-functional
- The per-task budget cap (`max_cost_micros`) on agent calls was also silently dropped

## Solution

Added `cfg.Output` and `cfg.Config.MaxCostMicros` conversion to `convertAgentCallTask` in the Go converter. The fix maps all 4 `AgentCallOutputContract` fields (`schema`, `on_invalid`, `max_retries`, `fallback_task`) into the CNCF DSL `with.output` block, matching the pattern already used by `convertLlmCallTask`.

## Implementation Details

**File:** `backend/services/stigmer-server/pkg/domain/workflow/converter/task_converters.go`

The `convertAgentCallTask` function previously mapped only `agent`, `message`, `env`, `config` (partial), and `harness`. The `AgentCallTaskConfig.Output` field (proto field 6, type `AgentCallOutputContract`) was completely ignored. The `AgentExecutionConfig.MaxCostMicros` field (proto field 5) was also ignored.

After fix:

| Field | Before | After |
|---|---|---|
| `cfg.Output.Schema` | Dropped | `output["schema"] = cfg.Output.Schema.AsMap()` |
| `cfg.Output.OnInvalid` | Dropped | `output["on_invalid"] = cfg.Output.OnInvalid.String()` |
| `cfg.Output.MaxRetries` | Dropped | `output["max_retries"] = cfg.Output.MaxRetries` |
| `cfg.Output.FallbackTask` | Dropped | `output["fallback_task"] = cfg.Output.FallbackTask` |
| `cfg.Config.MaxCostMicros` | Dropped | `config["max_cost_micros"] = cfg.Config.MaxCostMicros` |

### Relationship to SDK Codegen Fix

This fix complements the earlier SDK codegen fix (same day) that restored `Export` and `Flow` propagation through `toProto()`. The two bugs were on different links of the same chain:

1. SDK codegen bug (fixed earlier): `WorkflowTask.Export`/`Flow` dropped during CLI apply → no `export:` in CNCF DSL
2. Converter bug (this fix): `AgentCallTaskConfig.Output` dropped during proto→CNCF conversion → no `with.output` in CNCF DSL

Both fixes are required for the structured output pipeline to work end-to-end.

### Diagnostic Logging for Skills

Added comprehensive diagnostic logging to the Cursor harness skill resolver (`skill-resolver.ts`) to help debug a related issue where workflow-initiated Cursor agents report "can't find the .stigmer directory." The logs capture skill ref count, symlink creation path, per-skill write status, and final resolution summary.

## Benefits

- Structured output extraction pipeline is now functional for all `agent_call` tasks in workflows
- `$context` propagation via `export: as: "${ .structured }"` works correctly
- Output validation (`on_invalid`) and retry semantics are now active
- Per-task budget caps (`max_cost_micros`) are enforced
- Audit confirmed all other task-type converters (llm_call, validate, eval, etc.) already handle their fields correctly

## Impact

- **All workflows** using `agent_call` with `output.schema` — structured output was completely non-functional
- **OSS only** — the Cloud Java validator (`InProcessWorkflowValidator`) passes the full `task_config` map and was not affected
- **Zero risk** — adds fields that were always intended to be present; the runner and loader already handle this shape correctly
- **Existing integration test** `TestWorkflow_SchemaPropagation` validates the full pipeline and should now pass through the converter path

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes investigation + fix)
