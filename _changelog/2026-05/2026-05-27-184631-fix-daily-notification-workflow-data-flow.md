# Fix Daily Notification Workflow Data Flow and Resilience

**Date**: May 27, 2026

## Summary

Fixed two critical bugs and added a data-quality retry mechanism to the `daily-notification-plan` workflow in the Tiny Tactics demo project. The workflow was failing silently due to incorrect export path semantics and a missing termination directive, causing cascading task failures.

## Problem Statement

The daily notification planning workflow (`daily-notification-plan.yaml`) was failing during local testing with two distinct errors:
1. The `check_data_quality` LLM call was reporting "analyst report is incomplete" despite the analyst completing successfully
2. The `design_notification_campaigns` agent was failing with "Missing required field 'campaigns'" even though it should never have been reached

### Pain Points

- The `check_data_quality` task (an `llm_call`) exported its result using `${ .structured }`, but `llm_call` results store structured data at `.result` — causing the entire quality gate to malfunction
- The `alert_data_quality_issue` task had no `flow: then: end`, so after emitting an alert event the workflow executor fell through to the next task in list order (`design_notification_campaigns`)
- No retry mechanism existed for when the analyst produced insufficient data — the workflow simply failed or alerted without attempting recovery
- The `dau` field was optional in the analyst schema, allowing incomplete reports to pass validation

## Solution

Applied a three-layer fix: correct the data flow bugs, add a retry-with-guidance loop for data insufficiency, and tighten the analyst output schema to fail fast on missing critical fields.

## Implementation Details

### Bug Fix 1: Export Path Correction

Changed `check_data_quality` export from `${ .structured }` to `${ .result }`. The `llm_call` task kind uses LangChain's `withStructuredOutput()` which returns parsed data at `.result` in the `LlmCallResult` interface, not `.structured` (which is the field used by `agent_call` tasks).

### Bug Fix 2: Termination Directive

Added `flow: then: end` to `alert_data_quality_issue` to terminate the workflow after emitting the alert event.

### Resilience: Retry-With-Guidance Loop

Inserted three new tasks between the quality gate and the alert:
- `retry_analyst_with_guidance` — re-invokes the notification-analyst with augmented instructions referencing the specific quality check feedback
- `recheck_data_quality` — a more pragmatic second quality evaluation
- `recheck_quality_gate` — routes to campaigns on success, alert on failure

Downstream tasks use jq's alternative operator (`//`) to pick the freshest analyst data: `($context.retry_analyst_with_guidance // $context.analyze_player_data)`.

### Schema Tightening

- Made `dau` a required field in `analyze_player_data`'s output schema
- Changed `analyze_player_data` from `ON_INVALID_FAIL` to `ON_INVALID_RETRY` with `max_retries: 1`
- Changed `design_notification_campaigns` from `ON_INVALID_FAIL` to `ON_INVALID_RETRY` with `max_retries: 1`

## Benefits

- The quality gate now functions correctly — `proceed == true` routes to campaigns, `proceed == false` routes to retry
- Data insufficiency triggers a guided retry before alerting, increasing the workflow's success rate
- The workflow terminates cleanly on unrecoverable data quality issues instead of cascading into unrelated failures
- Tighter schema validation catches incomplete analyst reports at the source

## Impact

- **Tiny Tactics demo project** — the `daily-notification-plan` workflow now runs reliably in local development
- **Workflow DSL documentation** — this investigation clarified the distinction between `llm_call` (`.result`) and `agent_call` (`.structured`) export paths, which should be documented for workflow authors

## Related Work

- Structured output schema propagation diagnostics (2026-05-27-135404)
- Execution inspector data display UX overhaul (2026-05-27-144435)
- Agent call strategy structured output LangChain (2026-05-23-194126)

---

**Status**: Production Ready
**Timeline**: ~30 minutes
