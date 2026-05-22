# Integration Test Suite — Session 4 Failure Report

**Date**: May 22, 2026
**Suite**: `make test` from `test/integration/` (offline, no API keys)
**Result**: 486 tests, 276 PASS, 159 SKIP, 51 FAIL in 916s

## Context

This session confirmed all Session 1–3 fixes are in place, discovered and fixed one critical bug (Java orchestrator missing COMPLETED status update), and ran the full suite to produce this triage report. The remaining 51 failures cluster into 7 root causes across 2 repos.

### Fix Applied This Session (stigmer-cloud)

**`InvokeWorkflowExecutionWorkflowImpl.java`** — Added `handleCompletion()` on the success path. The Java Temporal orchestrator set status to `EXECUTION_FAILED` and `EXECUTION_CANCELLED` but never set `EXECUTION_COMPLETED`. This caused all workflow tests to hang for 90–240s each. Fixed by adding `handleCompletion(executionId)` after `executeChildWorkflow(input)` returns, mirroring the existing `handleFailure`/`handleCancellation` pattern. Tests that were timing out now complete in <1s.

---

## Root Cause 1: Task-Level Status Events Not Reaching Java Service

**Tests (12)**: `TestWorkflowBudget_DurationWarn`, `TestWorkflowControlFlow_SwitchCase`, `TestWorkflowData_SetVarsChaining`, `TestWorkflowFlowControl_ThenEnd`, `TestWorkflowFlowControl_ThenJumpToTask`, `TestWorkflowFlowControl_ExportContextScoping`, `TestWorkflowForEach_Batched`, `TestWorkflowForEach_OnErrorContinue`, `TestWorkflowFork_CompeteCancellationTiming`, `TestWorkflowHITL_WaitTask`, `TestWorkflowError_TryCatch`, `TestWorkflowForEach_Parallel`

**Error Pattern**: `task "X" not found in execution status` — the execution reaches `EXECUTION_COMPLETED` (our fix works) but individual task status entries are empty.

**Example**:
```
Error: Expected value not to be nil.
Test:  TestWorkflowBudget_DurationWarn
Messages: task "shortWait" not found in execution status
```

**Root Cause**: The TS runner's `EmitWorkflowEvents` local activity sends `task_started`, `task_completed`, etc. events to the Java service via `workflowExecutionCommand.updateStatus()`. However:

1. The `status` field in the update request is an **empty proto** — `create(WorkflowExecutionStatusSchema, {})` — with no phase or task status map.
2. The Java `WorkflowExecutionUpdateStatusHandler` stores events but does **not** process them into the execution's task status map. Events are persisted but the `status.tasks` map stays empty.

**Fix Location**:
- **TS runner** (`backend/services/runner/src/activities/workflow-event-activities.ts`): Set `status.phase` on terminal events (COMPLETED/FAILED) and populate task status entries from task events.
- **Java service** (`stigmer-cloud: WorkflowExecutionUpdateStatusHandler.java`): Process incoming events and update `status.tasks` map, or infer phase transitions from event types.

**Key Files**:
- `backend/services/runner/src/activities/workflow-event-activities.ts` (lines 232–252)
- `backend/services/runner/src/workflows/engine-core.ts` (lines 136–147, 254–260)
- `stigmer-cloud: WorkflowExecutionUpdateStatusHandler.java` (lines 196–199)

---

## Root Cause 2: HITL Tests — 90s Timeout Waiting for WAITING_APPROVAL

**Tests (8)**: `TestWorkflowHITL_HumanInputTimeout`, `TestWorkflowHITL_HumanInputOutcomeRouting`, `TestWorkflowHITL_ApprovalInvalidTaskName`, `TestWorkflowHITL_ApprovalAfterCompletion`, `TestWorkflowHITL_HumanInputApproval`, `TestWorkflowHITL_HumanInputRejection`, `TestWorkflowHITL_HumanInputWithFormData`, `TestWorkflowHITL_HumanInputWithComment`

**Error Pattern**: `timed out waiting for task "awaitApproval" to reach WAITING_APPROVAL in execution ... after 1m30s`

**Example**:
```
Error: timed out waiting for task "awaitApproval" to reach WAITING_APPROVAL
       in execution wex_01ks6652h27gda2fynwdg5ffnw after 1m30s
Test:  TestWorkflowHITL_HumanInputApproval
Messages: task should reach WAITING_APPROVAL
```

**Root Cause**: Same as Root Cause 1. These tests wait for a specific task to show `WAITING_APPROVAL` in the execution's task status map. The `human_input` task does reach `WAITING_APPROVAL` on the runner side (the workflow blocks on the approval signal), and the runner emits an `approval_requested` event. But the Java service doesn't process the event into the task status map, so the Go test never sees the task state change.

**Fix**: Same as Root Cause 1 — once task-level events are processed into `status.tasks`, these tests should pass. The HITL signal relay (pause/resume/approve/reject) infrastructure is functional; only the status visibility is broken.

---

## Root Cause 3: Lifecycle Tests — Execution Completes Before Signal

**Tests (5)**: `TestWorkflowExecution_Cancel`, `TestWorkflowExecution_CancelIdempotent`, `TestWorkflowExecution_Terminate`, `TestWorkflowExecution_TerminateIdempotent`, `TestWorkflowExecution_RecoverOnCancelledFails`

**Error Pattern**: `Cannot cancel/terminate workflow execution in EXECUTION_COMPLETED phase`

**Example**:
```
Error: rpc error: code = FailedPrecondition desc = Cannot cancel workflow
       execution in EXECUTION_COMPLETED phase. Only PENDING or IN_PROGRESS
       executions can be cancelled.
Test:  TestWorkflowExecution_Cancel
```

**Root Cause**: These tests create a workflow execution with a `wait` or `sleep` task (meant to keep the execution running long enough to send a cancel/terminate signal). But the workflow completes before the test sends the signal because:
1. Our COMPLETED status fix now works — the execution transitions to COMPLETED almost immediately after the child workflow finishes.
2. The `wait` task in the test workflow may be very short (e.g. 2 seconds), and the test sleeps or polls before sending the signal, by which time the execution has already completed.

**Fix Options**:
- Increase the `wait`/`sleep` duration in the test workflow definition to ensure the execution stays in-progress long enough for the cancel/terminate signal.
- Or: add a `WaitForPhase(EXECUTION_IN_PROGRESS)` poll before sending the cancel/terminate signal.

**Key Files**:
- `test/integration/workflow_execution_lifecycle_test.go` (lines 204, 316)

---

## Root Cause 4: Pause/Resume RPC Not Registered

**Tests (2)**: `TestWorkflowExecution_Pause`, `TestWorkflowExecution_PauseAndResume`

**Error Pattern**: `routable mapping not found for .../pause`

**Example**:
```
Error: rpc error: code = Internal desc = routable mapping not found for
       ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/pause
Test:  TestWorkflowExecution_Pause
```

**Root Cause**: The `pause` RPC method on `WorkflowExecutionCommandController` is not registered in the Java service's gRPC routing configuration. The RPC is defined in the proto but the Java handler/route is missing.

**Fix**: Register the `pause` method in the Java service's routing config. Check if `resume` and `recover` have the same issue.

**Key Files**:
- `stigmer-cloud: WorkflowExecutionCommandController` routing configuration
- Proto: `ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController.pause`

---

## Root Cause 5: Proto-to-CNCF Converter Bugs (for_each, fork)

**Tests (5)**: `TestWorkflowControlFlow_ForEach_Array`, `TestWorkflowControlFlow_ForEach_IntRange`, `TestWorkflowControlFlow_Fork_Parallel`, `TestWorkflowControlFlow_Fork_Compete`, `TestWorkflowForEach_Parallel`

**Error Pattern**: `'do' must be an array of task entries` or `Task entry at index 0 must have exactly one key (task name), got: name, do`

**Example**:
```
Activity failed: ApplicationFailure: Failed to parse CNCF Serverless
Workflow YAML for workflow 'wfl_...': 'do' must be an array of task entries
```

**Root Cause**: The Go converter (`backend/services/stigmer-server/pkg/domain/workflow/converter/task_converters.go`) incorrectly generates CNCF YAML from the proto `WorkflowTask` format:

1. **`for_each`**: `convertForTask()` nests `do` **inside** the `for` object (`forMap["do"] = doTasks`), but the CNCF spec and the TS loader expect `do` as a **sibling** of `for` at the task definition level.
2. **`fork`**: Branch entries leak proto-style flat objects (`{name: "branchA", do: [...]}`) instead of CNCF single-key objects (`{branchA: {do: [...]}}`). Nested `WorkflowTask` entries inside `task_config.branches[].do` are not converted through `convertTaskList`.

**Fix Location**:
- `backend/services/stigmer-server/pkg/domain/workflow/converter/task_converters.go`
  - `convertForTask()` (line 135–154): Move `do` from inside `forMap` to the task-level output.
  - `convertForkTask()`: Ensure branches are wrapped as CNCF single-key objects and nested tasks are recursively converted.

**CNCF format expected by runner parser** (`backend/services/runner/src/workflow-engine/loader.ts`):
```yaml
# for_each — 'do' is sibling of 'for', not nested inside it
- processItems:
    for:
      each: item
      in: ${ [...] }
    do:
      - processItem:
          set: { processed: "${ $data.item }" }

# fork — branches are single-key entries
- parallelWork:
    fork:
      branches:
        - branchA:
            do:
              - setA:
                  set: { result: "from-a" }
```

---

## Root Cause 6: Missing Runner Functions (transform, validate)

**Tests (4)**: `TestWorkflowData_Transform`, `TestWorkflowData_Validate_SchemaPass`, `TestWorkflowData_Validate_SchemaFail`, `TestWorkflowData_Validate_BusinessRules`

**Error Pattern**: `Unknown custom call function 'transform'. Supported: llm, emit_event, notification.`

**Example**:
```
Activity failed: ApplicationFailure: Unknown custom call function 'transform'.
Supported: llm, emit_event, notification.
```

**Root Cause**: The TS runner's `CallFunction` activity (`backend/services/runner/src/activities/call-function.ts`) only implements three functions: `llm`, `emit_event`, `notification`. The `transform` and `validate` functions are fully defined in the proto API and correctly converted by the Go converter (producing `call: "transform"` / `call: "validate"` in CNCF YAML), but the runner's activity dispatcher has no case for them.

**Fix**: Implement `transform` and `validate` handlers in `call-function.ts`:
- `transform`: Apply JQ transformations using the existing `EvaluateExpressions` infrastructure.
- `validate`: Run schema validation (JSON Schema) and business rules (JQ expressions).

**Key Files**:
- `backend/services/runner/src/activities/call-function.ts` (lines 31–47, switch statement)
- Converter reference: `backend/services/stigmer-server/pkg/domain/workflow/converter/task_converters.go` (`convertTransformTask`, `convertValidateTask`)

---

## Root Cause 7: Authz / PlatformClient / Visibility Tests

**Tests (11)**:

### Sub-cause 7a: MintUserToken Provisioning (7 tests)
`TestAuthz_AutoGrantedViewer_CanListPlatformClients`, `TestAuthz_AutoGrantedViewer_CannotCreateAgent`, `TestAuthz_AutoGrantedViewer_CannotDeleteOrg`, `TestAuthz_SessionOwnerOnly_OtherUserDenied`, `TestPlatformClient_MintUserToken_JITProvisioning_CreatesAccount`, `TestPlatformClient_MintUserToken_JITAutoGrant_GrantsRole`, `TestPlatformClient_SameUserAcrossMultipleClients_SingleIdentity`

**Error Pattern**: `MintUserTokenHandler/ResolveOrProvisionUser: Account provisioning failed`

**Example**:
```
Error: rpc error: code = Internal desc = request/.../MintUserTokenHandler/
       ResolveOrProvisionUser: Account provisioning failed
Test:  TestAuthz_AutoGrantedViewer_CanListPlatformClients
Messages: mint user token
```

**Root Cause**: These tests create a PlatformClient, then mint a user token via `MintUserToken`. The JIT (Just-In-Time) identity provisioning path fails during `ResolveOrProvisionUser`. In the security test suite (which runs with full Auth0 + OpenFGA), this is handled by seeding the machine account and FGA tuples. The main integration suite doesn't have the same seeding for JIT provisioning.

**Fix**: The `MintUserTokenHandler.ResolveOrProvisionUser` step in the Java service needs investigation. Check:
- Whether the auto-provisioning Mongock migration runs during test service startup.
- Whether the PlatformClient `AutoProvisionAccounts` flag triggers identity account creation correctly.
- Check the Java service log for the full error chain at `request/.../MintUserTokenHandler/ResolveOrProvisionUser`.

**Key Files**:
- `test/integration/auth_authorization_enforcement_test.go` (helper at line 49 calls `MintUserTokenAndGetClients`)
- `test/integration/harness/auth_helpers.go` (line 135, `MintUserToken` call)
- `stigmer-cloud: MintUserTokenHandler.java`, `ResolveOrProvisionUserStep.java`

### Sub-cause 7b: Workflow Create Validation (3 tests)
`TestWorkflowUpdateVisibility`, `TestWorkflowInstanceUpdateVisibility`, `TestVisibilityOrgEnumValue`

**Error Pattern**: `Input validation failed: spec.document – value is required, spec.tasks – value must contain at least 1 item(s)`

**Example**:
```
Error: rpc error: code = InvalidArgument desc = Input validation failed:
       spec.document – value is required,spec.tasks – value must contain
       at least 1 item(s)
Test:  TestWorkflowUpdateVisibility
Messages: create test workflow
```

**Root Cause**: These tests create a workflow without `spec.document` and `spec.tasks` fields, which are now required by the Java service's input validation. The test helper `createTestWorkflow` in `authorization_visibility_test.go` (line 36) builds a minimal workflow spec that doesn't include these required fields.

**Fix**: Update `createTestWorkflow` in `authorization_visibility_test.go` to include a valid `document` and at least one `task` in the workflow spec.

**Key File**: `test/integration/authorization_visibility_test.go` (line 36)

### Sub-cause 7c: FGA Permission for Visibility Update (1 test)
`TestAgentInstanceUpdateVisibility`

**Error Pattern**: `PERMISSION_DENIED: unauthorized to revoke access`

**Root Cause**: The test updates visibility on an agent instance but the test identity doesn't have FGA permission to revoke access tuples. The FGA authorization model may need an additional tuple for the test user, or the visibility update handler's permission check is too strict.

**Key File**: `test/integration/authorization_visibility_test.go` (line 229)

---

## Root Cause 8: Miscellaneous (3 tests)

### TestWorkflowArchitect_SeedpackSync
**Error**: `open /Users/suresh/scm/github.com/stigmer/seedpack/agents/workflow-architect.yaml: no such file or directory`
**Fix**: Clone the `seedpack` repo as a sibling, or skip the test when the seedpack isn't available.

### TestWorkflowError_RaiseError (90s timeout)
**Error**: `timed out waiting for execution ... to reach terminal phase after 1m30s`
**Root Cause**: The `raise` task throws a `WorkflowError` in the TS workflow sandbox. The Temporal SDK retries the failed workflow task (visible in runner log: `Failing workflow task` repeated 5 times), and the workflow stays stuck. The error is not caught as an `ApplicationFailure` so it doesn't transition to `EXECUTION_FAILED`.
**Key File**: `backend/services/runner/src/workflow-engine/tasks/raise.ts` (line 60)

### TestWorkflowError_Recover_AfterFailure (90s timeout)
**Error**: `timed out waiting for execution ... to reach phase EXECUTION_FAILED after 1m30s`
**Root Cause**: Similar to RaiseError — the workflow fails but the Temporal execution doesn't terminate cleanly, so the Java orchestrator never reaches the `handleFailure` path.

### TestValidateSpec_EvalTask_MissingModel
**Error**: `eval task missing model should not be VALID` — validateSpec returns `VALID` when it should reject a task with a missing model.
**Root Cause**: Server-side validation doesn't check for required fields inside `eval` task configs.
**Key File**: `backend/services/stigmer-server/pkg/domain/workflow/` validation code

### TestWorkflowError_InvalidConfig
**Error**: Workflow with invalid config is not rejected at execution time.

---

## Priority Order for Fixing

| Priority | Root Cause | Tests Fixed | Time Saved | Effort |
|----------|-----------|-------------|------------|--------|
| **P0** | RC1 + RC2: Task-level event propagation | 20 | ~720s of timeouts | Medium (TS + Java) |
| **P1** | RC5: Proto→CNCF converter (`for_each`, `fork`) | 5 | — | Small (Go) |
| **P1** | RC3: Lifecycle tests (execution completes too fast) | 5 | — | Small (Go tests) |
| **P1** | RC4: Pause RPC not registered | 2 | — | Small (Java) |
| **P2** | RC6: Implement `transform`/`validate` functions | 4 | — | Medium (TS) |
| **P2** | RC7a: PlatformClient JIT provisioning | 7 | — | Medium (Java) |
| **P3** | RC7b: Visibility test workflow specs | 3 | — | Small (Go tests) |
| **P3** | RC8: Misc (seedpack, raise, validate) | 5 | ~180s | Varies |

## How to Re-run

```bash
# Full offline suite (from repo root)
cd test/integration && make test

# Quick subset to verify a specific root cause
cd test/integration && make test-subset TEST_RUN='TestWorkflowBudget|TestWorkflowContinueAsNew'

# Run with verbose output
cd test/integration && make test-subset TEST_RUN='TestWorkflowHITL' 2>&1 | tee /tmp/hitl-results.txt
```

## Related Work

- Session 1: `_changelog/2026-05/2026-05-21-221545-integration-test-suite-fixes.md`
- Session 2: `_changelog/2026-05/2026-05-22-012138-integration-test-suite-four-failure-fixes.md`
- Session 3: `_changelog/2026-05/2026-05-22-020904-integration-test-suite-session3-systemic-fixes.md`

---

**Status**: 🔄 Triage Complete — 7 root causes identified, ready for fixing
**Timeline**: ~1.5 hours for investigation and triage
