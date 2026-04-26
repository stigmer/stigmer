# Fix Ephemeral Runner Missing `api_version` and `kind` Fields

**Date**: April 26, 2026

## Summary

Fixed an `INVALID_ARGUMENT` validation error that prevented agent executions from starting in the cloud environment. The ephemeral runner provisioning path in `RunnerDispatchService` was constructing a `Runner` proto without the required `api_version` and `kind` fields, causing `buf.validate` to reject the request before the Temporal workflow could start.

## Problem Statement

When a user initiated an agent execution through the desktop app (or any client), the cloud service's `AgentExecutionCreateHandler.StartWorkflowStep` would attempt to provision an ephemeral runner if no session-bound runner existed. This provisioning failed with:

```
INVALID_ARGUMENT: input validation failed: api_version – value must equal
'agentic.stigmer.ai/v1', kind – value must equal 'Runner'
```

### Pain Points

- Agent executions could not start when no session-bound runner was available and the launcher was configured (non-noop)
- The error message was misleading -- it appeared as "Failed to start execution workflow" which suggested a Temporal issue, when the actual failure was proto validation on the ephemeral Runner create request
- The bug was specific to the cloud ephemeral provisioning path; OSS dispatch does not provision runners

## Solution

Added the required `apiVersion` and `kind` fields to the `Runner.newBuilder()` call in `RunnerDispatchService.provisionEphemeralRunner()`, matching the `buf.validate` constraints defined in the proto contract (`apis/ai/stigmer/agentic/runner/v1/api.proto`).

## Implementation Details

**Primary fix** -- `RunnerDispatchService.java` (`provisionEphemeralRunner` method):
Added `.setApiVersion("agentic.stigmer.ai/v1")` and `.setKind("Runner")` to the `Runner.newBuilder()` chain, consistent with how `AgentExecutionCreateHandler` already sets these fields when auto-creating a `Session`.

**Test fixture alignment** -- Updated `buildRunner` helpers in three test files to include `apiVersion` and `kind`, so test fixtures accurately represent valid `Runner` resources:
- `RunnerStopHandlerTest.java`
- `RunnerSendCommandHandlerTest.java`
- `RunnerHeartbeatServiceTest.java`

## Benefits

- Agent executions can now start successfully via ephemeral runner provisioning
- Test fixtures match production resource structure, improving test fidelity
- Consistent resource construction pattern across the codebase

## Impact

- **Cloud service** (`stigmer-cloud`): Fixes a blocking bug in the ephemeral runner provisioning path
- **OSS server** (`stigmer`): No changes needed -- OSS does not provision ephemeral runners
- **Desktop/Web clients**: No changes needed -- clients were already sending correct payloads
- **Proto definitions**: No changes needed -- validation constraints are correct as designed

## Related Work

- Runner resource proto definition: `apis/ai/stigmer/agentic/runner/v1/api.proto`
- Runner dispatch service: cloud-only ephemeral provisioning added as part of the runner lifecycle feature set

---

**Status**: Production Ready
