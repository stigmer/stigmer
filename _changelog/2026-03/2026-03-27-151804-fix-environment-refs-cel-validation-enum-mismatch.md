# Fix environment_refs CEL Validation Enum Mismatch

**Date**: March 27, 2026

## Summary

Fixed a proto validation bug where the CEL expression on `environment_refs` checked for the wrong `ApiResourceKind` enum value, causing all agent instance and workflow instance saves with environment references to fail with "environment_refs must reference resources with kind=environment".

## Problem Statement

When clicking "Save" on the agent credential form (e.g., the `mcp-server-creator` agent configuration dialog), the request was rejected by server-side buf-validate with:

> Input validation failed: spec.environment_refs[0] - environment_refs must reference resources with kind=environment

The UI was correctly setting `kind: ApiResourceKind.environment` (enum value 53), but the server-side CEL rule was checking `this.kind == 52`.

### Pain Points

- Users could not save agent credentials to their personal environment
- Every agent instance or workflow instance creation with environment references was blocked
- The error message was misleading -- it said "must reference resources with kind=environment" while the actual check was against `workflow_execution` (52)

## Solution

Corrected the CEL validation expression from `this.kind == 52` to `this.kind == 53` in both proto specs, matching the actual `environment` enum value in `ApiResourceKind`.

## Implementation Details

**Root cause**: In `api_resource_kind.proto`, the enum values are:
- `workflow_execution = 52`
- `environment = 53`

The CEL expressions in both `AgentInstanceSpec` and `WorkflowInstanceSpec` had `this.kind == 52` with an incorrect comment `// 52 = environment enum value`. This was likely introduced when `workflow_execution` was added to the enum, shifting `environment` to 53 without updating the downstream CEL references.

**Files changed** (source protos):
- `apis/ai/stigmer/agentic/agentinstance/v1/spec.proto` -- CEL expression `52` -> `53`
- `apis/ai/stigmer/agentic/workflowinstance/v1/spec.proto` -- CEL expression `52` -> `53`

**Regenerated stubs** across both `stigmer` and `stigmer-cloud`:
- Go (apis/stubs, sdk/go, mcp-server/proto)
- Java (apis/stubs)
- Python (apis/stubs)
- TypeScript (apis/stubs)
- Dart (client-apps/mobile)

## Benefits

- Agent credential save flow works correctly -- users can persist environment variables to their personal environment
- Workflow instance creation with environment refs is unblocked
- The validation now correctly enforces that `environment_refs` must reference `Environment` resources (kind=53), not `WorkflowExecution` resources (kind=52)

## Impact

- **All users** attempting to save agent credentials via the web console were affected
- **All SDK consumers** creating agent instances or workflow instances with environment_refs were affected
- Both `stigmer` (OSS) and `stigmer-cloud` repos required stub regeneration

---

**Status**: Production Ready
