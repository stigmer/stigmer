# Fix Execution Context Name Length Overflow

**Date**: May 23, 2026

## Summary

Fixed a runtime failure where `CreateExecutionContextStep` generated context names exceeding the 63-character `metadata.name` limit. The fix switches from using the execution name (which can itself be up to 63 chars) to the execution ID (a compact ~31-char ULID) when constructing the derived name, aligning with the pattern already used by `McpServerConnectHandler`.

## Problem Statement

Workflow `call:agent` tasks were failing with `INVALID_ARGUMENT: Input validation failed: metadata.name – value length must be at most 63 characters` during execution context creation.

### Pain Points

- Agent executions spawned by workflow tasks produce names like `aex-wf-{wfExecId}-{taskName}` (~55+ chars)
- `CreateExecutionContextStep` prepends `"exec-ctx-"` (9 chars), pushing the derived name to 64+ characters
- The `ExecutionContext` proto enforces `max_len = 63` on `metadata.name` via buf.validate
- The error only surfaces when `runtime_env` secrets are present (empty env skips context creation)
- Temporal retries exhausted, causing the entire workflow execution to fail

## Solution

Changed both `CreateExecutionContextStep` implementations (agent execution and workflow execution paths) to construct the context name using `executionId` instead of `executionName`. This matches the existing pattern in `McpServerConnectHandler` and keeps the derived name safely under the limit (~40 chars total).

## Implementation Details

Two files changed with identical fixes:

- `agentexecution/request/step/CreateExecutionContextStep.java` — `"exec-ctx-" + executionId` (was `executionName`)
- `workflowexecution/request/step/CreateExecutionContextStep.java` — same change

Math: `"exec-ctx-"` (9 chars) + ULID ID (~31 chars) = ~40 chars, well under the 63-char limit.

## Impact

- Unblocks all workflow `call:agent` tasks that pass `runtime_env` secrets
- Eliminates a class of runtime failures that only manifest with longer task names
- No behavioral change — the context name is an internal identifier, not user-facing

## Related Work

- `McpServerConnectHandler` already used `executionId` for the same purpose (consistency fix)
- `ApiResourceMetadata.name` 63-char constraint defined in `apis/ai/stigmer/commons/apiresource/metadata.proto`

---

**Status**: Production Ready
