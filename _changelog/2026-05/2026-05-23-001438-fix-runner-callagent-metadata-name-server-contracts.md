# Fix: Runner CallAgent Missing metadata.name + Server Contract Validation Layer

**Date**: May 23, 2026

## Summary

Fixed a recurring class of bug where the runner's `CallAgent` activity constructed gRPC messages that the server rejected because `metadata.name` was missing. Established a server contract validation layer (`server-contracts.ts`) that encodes business rules the proto schema does not express, preventing this class of bug from recurring. Ungated the previously-disabled `workflow_agent_call_test.go` integration test.

## Problem Statement

The runner's `CallAgent` activity creates an `AgentExecution` via gRPC but was sending `metadata: { org: orgId }` with no `name` or `slug`. The server's `ResolveSlugStepV2` pipeline step requires at least one for resource creation. This produced: `ConnectError: [invalid_argument] Either slug or name must be provided`.

### Pain Points

- This is the 3rd occurrence of the same class of bug (CLI Jan 14, CLI Jan 15, Runner May 22)
- The proto schema marks `name` and `slug` as optional (`IGNORE_IF_ZERO_VALUE`), but the server requires at least one — a hidden business rule
- Unit tests passed because they mocked the client (mocks accept any payload)
- The integration test for this path was permanently disabled behind a stale `AgentRunner` field check
- Missing secrets silently produced empty strings that flowed into gRPC calls unchecked

## Solution

Three-level fix: immediate bug fix, defensive contract layer, and test coverage.

## Implementation Details

### 1. Bug Fix (`call-agent.ts`)

- Added `metadata.name` to `createAgentExecution`: generates `aex-wf-{agent-slug}-{timestamp}`
- Added post-resolution guards: validates `resolved.agent` and `resolved.message` are non-empty after placeholder substitution, with actionable error messages

### 2. Server Contract Module (`server-contracts.ts`)

New module encoding business rules the proto schema cannot express:

- `assertCreateRequirements()` — validates envelope (apiVersion, kind), metadata.name/slug presence, and metadata.org
- `assertReferenceRequirements()` — validates slug and org are non-empty for getByReference calls
- `ServerContractError` — typed error class with caller context

Wired into `StigmerClient`: `createSession`, `createAgentExecution`, `getAgentByReference` now validate before sending. Replaces the old `assertEnvelope` (which only checked apiVersion/kind).

### 3. Integration Test Ungating (`workflow_agent_call_test.go`)

- Removed stale `AgentRunner` gate (field is never initialized)
- Tests now gate only on `UnifiedRunner` (which handles all execution paths)
- Added `TestWorkflowAgentCall_NonexistentAgent` negative test

### 4. Contract Compliance Tests (`call-agent-contracts.test.ts`)

- 11 tests verifying that `callAgentAction` produces messages satisfying server pipeline requirements
- Tests validate the constructed Session and AgentExecution payloads against `assertCreateRequirements`
- Includes regression test proving the old payload (without name) would fail

## Benefits

- The `daily-notification-plan` workflow (and any workflow with `call:agent` tasks) will now succeed
- Future proto-optional-but-server-required mismatches will be caught at the client with actionable error messages
- The integration test will catch regressions in CI (previously disabled for months)
- Post-resolution guards catch missing secrets/env_vars before they produce cryptic server errors

## Impact

- **Immediate**: Unblocks workflow execution with `call:agent` tasks (tiny-tactics demo workflow)
- **Systemic**: Establishes a pattern (`server-contracts.ts`) for encoding server business rules client-side
- **Testing**: 38 new/updated unit tests + 1 ungated integration test + 1 negative integration test

## Files Changed

| File | Change |
|------|--------|
| `backend/services/runner/src/activities/call-agent.ts` | Add metadata.name + post-resolution guards |
| `backend/services/runner/src/client/stigmer-client.ts` | Wire contract validation, remove old assertEnvelope |
| `backend/services/runner/src/client/server-contracts.ts` | **New** — contract validation module |
| `backend/services/runner/src/client/__tests__/server-contracts.test.ts` | **New** — 15 contract tests |
| `backend/services/runner/src/activities/__tests__/call-agent.test.ts` | Add metadata.name assertion + guard tests |
| `backend/services/runner/src/activities/__tests__/call-agent-contracts.test.ts` | **New** — 11 compliance tests |
| `test/integration/workflow_agent_call_test.go` | Ungate + add negative test |

## Related Work

- `_changelog/2026-01/2026-01-14-155542-fix-agent-execution-name-org-metadata.md` — same bug in CLI
- `_changelog/2026-01/2026-01-15-190212-fix-apikey-create-positional-arg-and-expiration.md` — same class
- `_cursor/offline-test-fixes-2026-05-22-night.md` — related offline test session

---

**Status**: ✅ Production Ready
**Timeline**: Single session
