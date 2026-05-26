# Fix Structured Output Callback Pipeline and Remove Redundant Runner Billing

**Date**: May 26, 2026

## Summary

Fixed the structured output callback pipeline where data was lost during the Temporal activity return round-trip between the TS runner and Java workflow. Added a MongoDB fallback to Java's `buildCallbackResultJson` (matching the Go OSS pattern) and removed the redundant `emitBillingRecords` from the Cursor activity that always failed with `permission_denied`.

## Problem Statement

The `daily-notification-plan` workflow consistently failed with "Agent did not return structured output" despite the runner successfully extracting and persisting structured output to MongoDB (confirmed via direct DB inspection: `aex_01kshpqwba1gwj0hchkw60evgh` has full `structuredOutput` data).

### Pain Points

- Runner logs show `hasStructuredOutput=true` but the workflow fails — the data is lost in the Temporal callback path
- Java's `buildCallbackResultJson` reads `finalStatus.hasStructuredOutput()` from the deserialized activity proto without any fallback when Temporal's `google.protobuf.Struct` serialization fails
- The Go OSS implementation has a 3-key check plus DB fallback; Java had no such resilience
- Runner's `emitBillingRecords` always fails with `[permission_denied] only platform operators can execute billing operations` because it uses the user's token, creating noise in logs

## Solution

**Structured Output**: Added a MongoDB fallback to Java's `buildCallbackResultJson`. When `finalStatus.hasStructuredOutput()` returns false (Temporal Struct serialization lost the data), the method now reads the persisted execution from MongoDB — the runner's `updateStatus` gRPC call already stored it there. This mirrors the Go OSS `buildCallbackResult` which has both a 3-key activity result check and a DB fallback.

**Billing**: Removed `emitBillingRecords` entirely from the Cursor activity path. The Java workflow already handles billing correctly via `billingActivities.recordCursorUsage(executionId)` with operator auth after the activity completes.

## Implementation Details

### Java DB Fallback (`InvokeAgentExecutionWorkflowImpl.java`)

```java
if (!structuredIncluded) {
    var dbExecution = updateStatusLocalActivity.loadExecution(executionId);
    var dbStatus = dbExecution.getStatus();
    if (dbStatus != null && dbStatus.hasStructuredOutput()) {
        // serialize from MongoDB (authoritative source)
    }
}
```

### Billing Removal (`execute-cursor/index.ts`)

- Removed `emitBillingRecords` calls from both platform-stop and normal-completion paths
- Removed dead code: `emitBillingRecords` function, `buildTurnBillingInput`, `BillingRecordParams` interface
- Removed unused imports: `RecordLlmCallUsageInputSchema`, `TokenUsageSchema`, `UsageCompletionStatus`, `TurnRecord`

### Diagnostic Logging

- `status.ts` (`slimStatus`): Logs whether `structuredOutput` survives `toJson()` serialization
- `call-agent-orchestrator.ts`: Logs callback result keys when the activity completes
- Java `buildCallbackResultJson`: Logs which path provided structured output (activity return vs DB fallback)

### Integration Test

New `workflow_structured_output_callback_test.go` — hard regression test asserting the full chain:
1. Runner extracts structured output
2. Child `AgentExecution.status.structuredOutput` populated in DB
3. Callback JSON includes `"structured"` key
4. Workflow task output contains structured data with schema-required fields

## Benefits

- Structured output propagation is now resilient to Temporal Struct serialization failures
- Runner logs are no longer polluted with permission_denied billing warnings
- Hard regression test catches future callback pipeline breakages
- Diagnostic logging enables fast root-cause identification if the issue recurs

## Impact

- **Cloud Cursor workflows**: All workflows with `output.schema` using the Cursor harness are unblocked
- **Runner**: Cleaner execution path without dead-end billing calls
- **Observability**: Clear logging at each handoff point in the callback chain
- **Testing**: New E2E test covers the previously untested callback handoff (C3/C5 gap)

## Related Work

- `2026-05-26-121306-fix-structured-output-extraction-pipeline-v3.md` — Fixed the extraction logic itself
- `2026-05-25-153147-structured-output-pipeline-test-suite.md` — Identified the 15 handoff points
- Go OSS `invoke_workflow_impl.go` `buildCallbackResult` — Reference implementation with DB fallback

---

**Status**: Production Ready
**Timeline**: Single session
