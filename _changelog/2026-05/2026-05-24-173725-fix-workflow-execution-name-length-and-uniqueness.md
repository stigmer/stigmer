# Fix Workflow Execution Name Length and Agent Execution Uniqueness

**Date**: May 24, 2026

## Summary

Removed the 63-character `max_len` constraint from `metadata.name` and `metadata.slug` in the shared proto definition, and made agent execution names unique per invocation. These two changes unblock all multi-step workflow executions that use descriptively-named `agent_call` tasks.

## Problem Statement

The `daily-notification-plan` workflow for Tiny Tactics failed every time it reached an `agent_call` task with a name longer than ~25 characters. The system-generated `metadata.name` (pattern: `aex-wf-{workflowExecutionId}-{taskName}`) exceeded the 63-char proto validation limit, causing the workflow execution to fail and enter a Temporal retry loop.

### Pain Points

- Workflow execution died on step 4 (`design_notification_campaigns`) every time -- 2 of 4 agent_call tasks had names exceeding 63 chars
- On Temporal retry, the runner's ALREADY_EXISTS recovery path appended `-r{timestamp}`, creating non-deterministic orphan agent executions that also exceeded the length limit
- The Temporal parent workflow entered a `LocalActivity: MARKER_COMMAND_CREATED->RECORD_MARKER` state machine error loop, permanently stuck
- The 63-char limit was a Kubernetes DNS label convention adopted but not technically required by Stigmer (resources are stored in MongoDB/SQLite, not etcd)

## Solution

Two targeted fixes:

1. **Proto constraint removal**: Removed `(buf.validate.field).string.max_len = 63` from both `metadata.name` and `metadata.slug` in the shared `ApiResourceMetadata` proto. The slug pattern constraint (`^[a-z][a-z0-9-]*[a-z0-9]$`) is preserved for correctness.

2. **Unique agent execution names**: Appended an 8-char random hex suffix to agent execution names in the `CallAgent` activity. Removed the broken ALREADY_EXISTS retry block. Session names remain deterministic for idempotent reuse via `apply`.

## Implementation Details

### Proto change (1 file)

- `apis/ai/stigmer/commons/apiresource/metadata.proto`: Removed `max_len = 63` from `name` (field 1) and `slug` (field 2). Updated field comments.

### Runner change (1 file)

- `backend/services/runner/src/activities/call-agent.ts`:
  - Added `import { randomUUID } from "node:crypto"`
  - Changed execution name from `aex-wf-${taskKey}` to `aex-wf-${taskKey}-${shortUniqueId()}`
  - Added `shortUniqueId()` function (8 hex chars from UUID)
  - Removed the `ConnectError`/`Code` imports and the entire ALREADY_EXISTS catch-and-retry block
  - Session name unchanged -- deterministic for `apply` reuse

### Test updates (2 files)

- `backend/services/stigmer-server/pkg/domain/organization/controller/organization_controller_test.go`: Removed "slug too long" test case that validated the now-removed constraint
- `backend/services/runner/src/activities/__tests__/call-agent-contracts.test.ts`: Replaced the ALREADY_EXISTS retry test with 6 new workflow-context naming tests (deterministic sessions, unique executions, cross-invocation uniqueness, long task names)

### Stub regeneration

- `stigmer` (OSS): `make codegen` regenerated Go, TypeScript, Python, Java, Dart stubs
- `stigmer-cloud`: `make protos` regenerated all stubs in `apis/stubs/`

## Benefits

- Workflow executions with descriptively-named tasks no longer fail validation
- Agent executions are always unique per invocation -- no collisions on Temporal retry
- No orphan agent executions from the broken `-r{timestamp}` retry path
- Session reuse on retry still works (deterministic names via `apply`)

## Impact

- **Tiny Tactics workflows**: The `daily-notification-plan` and any future workflow with long task names will now execute correctly
- **All workflow users**: Any `agent_call` task with a name producing a slug > 63 chars will now succeed
- **Platform-wide**: The 63-char limit removal affects all resource types. Existing resources are unaffected (constraint relaxation is non-breaking).

## Related Work

- `2026-05-24-134907-fix-workflow-session-recovery-idempotency.md` -- Earlier fix that switched sessions to `apply` for Temporal replay safety; this fix addresses the same class of problem for agent executions
- `2026-05-24-164746-fix-runner-execution-pipeline-errors.md` -- Earlier fix for connect-backfill proto serialization and session slug validation

---

**Status**: Production Ready
**Timeline**: ~30 minutes (targeted proto + runner fix + tests)
