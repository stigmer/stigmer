# HITL Approval Test Coverage -- Comprehensive Multi-Layer Testing

**Date**: May 22, 2026

## Summary

Added comprehensive test coverage across all 5 layers of the Workflow Human Input Approval UI feature -- Go backend handler, TS runner loader and event emission, React SDK event store and approval card, and integration tests. Also fixed a production defect in the Go handler (`task_kind` vs `task_type` mismatch) and eliminated flaky `time.Sleep` patterns in existing HITL integration tests.

## Problem Statement

The Workflow HITL Approval UI feature (T13c) shipped with integration tests for the happy paths but had zero unit-level coverage for the new backend handler, event emission pipeline, loader parsing, React SDK components, and event store. Several layers had critical serialization boundaries and validation logic that could silently break without isolated tests catching the regression.

### Pain Points

- `SubmitWorkflowTaskApproval` Go handler had zero unit tests and was not even registered in BUILD.bazel (never compiled by Bazel)
- The handler referenced `task.GetTaskKind()` which does not exist on `WorkflowTask` proto (uses `task_type`/`WorkflowTaskType`, not `task_kind`/`WorkflowTaskKind`)
- `toProtoEvent` in `workflow-event-activities.ts` converts 11 event descriptor types to protos with zero test coverage
- `parseHumanInputConfig` in the TS loader parses `form_schema`, `outcomes`, `approvers` with no tests
- `WorkflowTaskApprovalCard` React component (exported from `@stigmer/react`) had no unit tests
- `WorkflowExecutionEventStore.deriveTaskStates` handles `waiting_approval` state transitions with no tests
- Existing HITL integration tests used `time.Sleep(3s)` instead of the deterministic `WaitForTaskWaitingApproval` helper
- No integration tests exercised `form_data`, `comment`, 3-way outcomes, or error paths

## Solution

A 6-phase test implementation covering every layer of the HITL approval feature, plus a production fix for the Go handler.

## Implementation Details

### Production Fix: Go Handler `task_kind` vs `task_type`

Fixed `ValidateHumanInputTaskStep` in `submit_workflow_task_approval.go` to use `task.GetTaskType() != workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL` instead of the non-existent `task.GetTaskKind()`. Removed unused `workflowv1` import. Registered the file in `BUILD.bazel` `go_library` and `go_test` targets.

### Phase 1: Go Backend Handler Unit Tests (12 tests)

New file `submit_workflow_task_approval_test.go` with a `createTestExecutionWithTasksUnique` helper that seeds task entries via `UpdateStatus`. Tests cover all 5 pipeline steps: input validation (empty fields), execution load (not found), phase validation (terminal phases rejected), task validation (wrong type, task not found), and the Temporal boundary (validation passes, expected failure at signal step).

### Phase 2: TS Loader Tests (8 tests)

Extended `loader.test.ts` with `human_input task reclassification` block testing `parseHumanInputConfig`: prompt parsing, outcomes with name/label/then, `form_schema` preservation, approvers filtering (non-strings dropped), timeout/on_timeout mapping, and error cases (missing prompt, missing `with` block, empty outcomes array).

### Phase 3a: TS Event Emission Tests (7 tests)

Extended `human-input.test.ts` with an `event emission` block. Added `emitFn` parameter to `makeCtx`. Tests verify `approval_requested` descriptor fields (prompt, approvers, timeout, outcomes, formSchema), `approval_resolved` fields (outcome, resolvedBy, waitDurationMs, autoResolved), backward compatibility when `emitEvents` is undefined, and edge cases (defaults for empty approvers/outcomes).

### Phase 3b: Event Activities Tests (15 tests)

New file `workflow-event-activities.test.ts`. Exported `toProtoEvent` (with `@internal` JSDoc) for direct testing. Tests cover all 11 event descriptor types with proto field assertions. Focus on `approval_requested` (outcomes mapped to `HumanInputOutcomeInfo` protos, formSchema Struct conversion) and `approval_resolved` (documents current limitation: outcome/autoResolved not mapped to proto). Also tests sequence counter monotonicity, reset, and `emitWorkflowEvents` no-op guards.

### Phase 4: Event Store Tests (10 tests)

New file `workflow-execution-event-store.test.ts` following `conversation-store.test.ts` patterns. Tests cover `appendEvents` (dedup by sequence, sort, cache invalidation, listener notification), `deriveTaskStates` approval lifecycle (`taskStarted` -> `approvalRequested`/`waiting_approval` -> `approvalResolved`/`running` -> `taskCompleted`), and subscribe/reset lifecycle.

### Phase 5: Approval Card Tests (17 tests)

New file `WorkflowTaskApprovalCard.test.tsx` following `WorkflowRepairCard.test.tsx` patterns. Tests organized by concern: outcome rendering (defaults, custom, fallback), button variants (primary/destructive/secondary logic), form fields (JSON Schema properties), submission (callback args with/without form data and comments, empty value filtering), loading state (disabled buttons, active spinner, clear on submit end), and accessibility (role, aria-label, aria-busy, label-input association).

### Phase 6: Integration Test Improvements

Replaced all `time.Sleep(3s)` with `WaitForTaskWaitingApproval` in `workflow_hitl_test.go` and `workflow_hitl_edge_cases_test.go`. Added 5 new integration tests: `TestWorkflowHITL_HumanInputWithFormData`, `TestWorkflowHITL_HumanInputWithComment`, `TestWorkflowHITL_HumanInputThreeWayOutcome` (Tiny Tactics pattern), `TestWorkflowHITL_ApprovalInvalidTaskName` (error path), and `TestWorkflowHITL_ApprovalAfterCompletion` (error path).

## Benefits

- 69 new test cases across 5 layers, covering the complete HITL approval pipeline from YAML parsing to UI rendering
- Production fix for a handler that could not compile under Bazel and had broken task type validation
- Flaky `time.Sleep` patterns eliminated from integration tests
- First-ever unit tests for `toProtoEvent` serialization boundary, event store state machine, and approval card component
- Error-path integration tests for invalid task names and post-completion approval attempts

## Impact

- **Regression safety**: Any change to the approval handler, event emission, loader parsing, or UI rendering will be caught by isolated unit tests
- **Documentation**: Tests document the expected behavior of each component, including the `ApprovalResolvedPayload` proto limitation (outcome/autoResolved not mapped)
- **CI reliability**: Deterministic polling replaces sleep-based timing in integration tests

## Related Work

- Feature implementation: `_changelog/2026-05/2026-05-22-001023-workflow-hitl-approval-ui.md`
- Integration test infrastructure: `_changelog/2026-05/2026-05-21-221545-integration-test-suite-fixes.md`

---

**Status**: Production Ready
**Timeline**: Single session
