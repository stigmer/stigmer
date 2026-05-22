# Fix Missing API Resource Envelope Fields in CallAgent Activity

**Date**: May 22, 2026

## Summary

The runner's `CallAgent` Temporal activity was creating Session and AgentExecution protobuf objects without the required `apiVersion` and `kind` envelope fields, causing server-side buf-validate to reject every `call:agent` workflow task with `invalid_argument`. This fix adds the missing fields, strengthens unit test assertions to prevent regression, hardens the integration test that silently tolerated the failure, and adds client-side validation in `StigmerClient` to catch the pattern early.

## Problem Statement

When a workflow containing a `call:agent` task was executed (e.g., `daily-notification-plan` in the tiny-tactics demo), the runner's `CallAgent` activity called `createSession` with a proto that was missing `apiVersion: "agentic.stigmer.ai/v1"` and `kind: "Session"`. The Stigmer server's `ValidateProtoStep` pipeline rejected the request, the activity failed after 3 retries, and the entire workflow execution transitioned to `EXECUTION_FAILED`.

### Pain Points

- Every workflow with a `call:agent` task was broken in production
- The error message from the server (`value must equal 'agentic.stigmer.ai/v1'`) was cryptic and didn't point to the call site
- The existing unit test mocked `StigmerClient` completely, so proto validation was never exercised
- The only integration test for this path (`TestSandboxColocation_SessionRunnerID`) silently logged and passed when no session was created

## Solution

Four-part fix addressing the bug, the test gap, the integration test leniency, and the systemic risk:

1. **Bug fix**: Add `apiVersion` and `kind` to both `create(SessionSchema, ...)` and `create(AgentExecutionSchema, ...)` in `call-agent.ts`
2. **Unit tests**: Assert envelope fields, metadata, and cross-resource references (sessionId propagation) on both Session and AgentExecution payloads
3. **Integration test**: Replace sleep-and-hope pattern with `WaitForTerminal` polling; fail hard when workflow reaches `EXECUTION_FAILED` with no child session
4. **Client guard**: Add `assertEnvelope()` validation in `StigmerClient.createSession()` and `createAgentExecution()` to produce a clear developer-facing error before the gRPC call

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/services/runner/src/activities/call-agent.ts` | Added `apiVersion` and `kind` to Session and AgentExecution proto construction |
| `backend/services/runner/src/activities/__tests__/call-agent.test.ts` | Expanded downstream call assertions: envelope fields, metadata.org, metadata.name pattern, spec.sessionId |
| `backend/services/runner/src/client/stigmer-client.ts` | Added `assertEnvelope()` guard on `createSession()` and `createAgentExecution()` |
| `test/integration/workflow_sandbox_colocation_test.go` | Replaced `time.Sleep` + lenient log with `WaitForTerminal` + `require.True(foundSession)` |

### Audit Result

Searched all `create(XXXSchema, {...})` calls in the runner where the schema is a top-level API resource. Only two sites exist (both in `call-agent.ts`), both now fixed. All other runner proto creation uses sub-resource schemas (messages, status, artifacts) that don't have envelope validation rules.

## Benefits

- `call:agent` workflow tasks now work correctly against the platform gRPC API
- Unit tests catch missing envelope fields at the assertion level
- Integration test catches missing sessions at the E2E level (no more silent pass)
- `StigmerClient` guard catches the pattern at construction time with a clear error message, preventing future recurrence

## Impact

- **Workflows with `call:agent` tasks**: Now functional (previously 100% failure rate)
- **Demo workflows** (e.g., `daily-notification-plan`): Unblocked
- **Developer experience**: Any future code that creates a Session or AgentExecution without envelope fields gets an immediate, actionable error

## Related Work

- Prior fix `fdce2f21a` addressed `ApiResourceKind.agent` in the same `CallAgent` activity
- The `call:agent` task type was recently introduced for workflow-to-agent orchestration
- SDK (`sdk/typescript/src/gen/session.ts`) has always set these fields correctly; the runner bypassed the SDK and hit the same trap

---

**Status**: Production Ready
**Timeline**: Single session fix
