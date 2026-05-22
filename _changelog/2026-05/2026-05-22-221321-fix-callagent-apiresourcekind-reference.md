# Fix CallAgent ApiResourceKind in Workflow Runner

**Date**: May 22, 2026

## Summary

Fixed a bug where the runner's `CallAgent` Temporal activity constructed `ApiResourceReference` without setting the `kind` field, causing all `agent_call` workflow tasks to fail against Stigmer Cloud with `"Invalid resource kind. Expected agent, got: api_resource_kind_unknown"`. Added comprehensive unit tests for the activity and extended the golden execution test suite with agent_call config contract verification.

## Problem Statement

Executing any workflow containing an `agent_call` task (e.g., the Tiny Tactics `daily-notification-plan` workflow) failed immediately on agent resolution. The error occurred because the runner sent `kind: 0` (protobuf default) instead of `kind: agent (40)` in the gRPC `getByReference` call.

### Pain Points

- Every workflow with `agent_call` tasks was broken when running against Stigmer Cloud
- The same bug class was fixed in all four SDKs in March 2026 (via codegen templates), but the runner's manual reference construction was missed
- OSS backend is lenient (falls through to service-level kind from proto descriptor), masking the bug during local development
- The `CallAgent` Temporal activity had zero unit test coverage for reference construction

## Solution

Added `kind: ApiResourceKind.agent` to `parseAgentReference()` in the runner's `call-agent.ts`, mirroring the pattern used by all SDK `getByReference` methods since the March 2026 fix.

## Implementation Details

### Bug fix (1 file)

- `backend/services/runner/src/activities/call-agent.ts`: Imported `ApiResourceKind` from generated proto stubs and added `kind: ApiResourceKind.agent` to the return value of `parseAgentReference()` for both org-relative (`"slug"`) and org-prefixed (`"org/slug"`) reference formats.

### Unit tests (1 new file, 10 tests)

- `backend/services/runner/src/activities/__tests__/call-agent.test.ts`: Direct tests for `callAgentAction()` covering:
  - `ApiResourceReference` has `kind == agent` for both reference formats
  - Org resolution priority (config.org > `__stigmer_org_id` > error)
  - Error when agent has no `metadata.id`
  - Session creation with correct agent instance and harness
  - Agent execution creation with callback token, parent workflow ID, and message
  - Sandbox queue affinity propagation

### Integration tests (2 new tests in existing file)

- `backend/services/runner/src/workflow-engine/__tests__/golden-execution.test.ts`: Extended with:
  - Config contract verification (agent slug, env placeholders, model/timeout/temperature, output schema, harness)
  - Cross-org agent reference preservation through the workflow engine pipeline

## Benefits

- All `agent_call` workflow tasks now work against Stigmer Cloud
- The `CallAgent` activity has unit test coverage for the first time (10 tests)
- The golden execution suite now verifies the full config contract for agent calls (2 new tests)
- Future regressions in reference construction will be caught immediately

## Impact

- **Workflow users**: Any workflow using `agent_call` tasks (including all Tiny Tactics workflows) will now execute correctly
- **Runner maintainers**: Activity-level reference construction is now tested
- **CI**: 12 new tests added to the runner test suite (55 total across call-agent test files)

## Related Work

- March 2026 SDK-wide `ApiResourceKind` injection fix ([changelog](../2026-03/2026-03-25-202247-fix-apiresourcekind-injection-getbyreference.md))
- OSS vs Cloud behavioral divergence in `getByReference` kind validation

---

**Status**: Production Ready
**Timeline**: Single session
