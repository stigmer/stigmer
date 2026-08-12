package workflows

import (
	"fmt"
	"strings"
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// childWorkflowName mirrors the child workflow name the orchestrator starts
// (executeChildWorkflow in invoke_workflow_impl.go).
const childWorkflowName = "stigmer/workflow/execute-from-execution"

// Stub activity functions for registration. The Temporal test env requires
// actual Go functions registered under the correct names so that
// workflow.ExecuteActivity / workflow.ExecuteLocalActivity calls can be
// matched.
func stubUpdateWfExecStatus(_ string, _ *workflowexecutionv1.WorkflowExecutionStatus) error {
	return nil
}
func stubDeleteWfExecContext(_ string) error { return nil }

// stubLegacyActivity is a stand-in for the old ExecuteWorkflow activity
// (the version-0 path).
func stubLegacyActivity(_ *activities.InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	return nil, nil
}

// childWorkflowFn is the signature of the TS child workflow stand-in
// ("stigmer/workflow/execute-from-execution").
type childWorkflowFn func(workflow.Context, *activities.InvokeWorkflowExecutionWorkflowInput) error

// childCompleting completes immediately with success.
func childCompleting(_ workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
	return nil
}

// childFailingWith returns a child that fails with the given message.
func childFailingWith(msg string) childWorkflowFn {
	return func(_ workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
		return fmt.Errorf("%s", msg)
	}
}

// ecDeleteRecorder counts DeleteExecutionContext calls so tests can assert the
// EC cleanup actually ran. Capturing at registration is mandatory: testify
// matches the FIRST registered expectation for an activity, so a later
// per-test OnActivity override would silently never run (the same recorder
// idiom as the agentexecution twin's persistedStatuses).
type ecDeleteRecorder struct {
	count int
}

// registerWfExecCommonMocks registers the activities every test needs and
// registers `child` as a REAL child workflow implementation under the
// production child workflow name. Returns a recorder of EC delete calls.
//
// Real children (instead of env.OnWorkflow mocks) buy two things: the test
// env delivers parent→child SignalExternalWorkflow calls DIRECTLY to running
// children — an OnSignalExternalWorkflow mock is never consulted for them —
// so relay tests can assert actual delivery; and a child that consumes its
// relays before returning serializes the whole signal chain ahead of parent
// completion, which keeps the parent-close-policy sweep (the orchestrator
// sets PARENT_CLOSE_POLICY_REQUEST_CANCEL) away from half-torn-down state.
//
// CRITICAL: every external stimulus (SignalWorkflow, CancelWorkflow) must be
// scheduled through runWhenChildStarts, never RegisterDelayedCallback at
// delay 0 — see that helper for the SDK startup race it closes (stigmer#457).
func registerWfExecCommonMocks(env *testsuite.TestWorkflowEnvironment, child childWorkflowFn) *ecDeleteRecorder {
	env.RegisterActivityWithOptions(stubUpdateWfExecStatus, activity.RegisterOptions{
		Name: activities.UpdateWorkflowExecutionStatusActivityName,
	})
	env.RegisterActivityWithOptions(stubDeleteWfExecContext, activity.RegisterOptions{
		Name: ecactivities.DeleteExecutionContextActivityName,
	})
	env.RegisterWorkflowWithOptions(child, workflow.RegisterOptions{
		Name: childWorkflowName,
	})
	env.RegisterActivityWithOptions(stubLegacyActivity, activity.RegisterOptions{
		Name: activities.ExecuteWorkflowActivityName,
	})

	recorder := &ecDeleteRecorder{}
	env.OnActivity(stubDeleteWfExecContext, mock.Anything).
		Return(func(_ string) error {
			recorder.count++
			return nil
		}).Maybe()
	return recorder
}

// runWhenChildStarts schedules f to run once the child workflow has actually
// begun executing — i.e. after its signal and cancel handlers are registered.
//
// This gate is what makes the signal/cancel tests deterministic, and it is
// the fix for the stigmer#457 flake. ExecuteChildWorkflow registers the child
// in the env's workflow map synchronously, but the child's startup runs on a
// SEPARATE goroutine. A stimulus scheduled with RegisterDelayedCallback at
// delay 0 races that goroutine; when it wins, the env delivers the signal (or
// the parent-close REQUEST_CANCEL sweep after the resulting panic) to a child
// env whose handlers are still nil, and the SDK nil-calls them (v1.43.1
// internal_workflow_testsuite.go:2537→:2519; code unchanged on SDK master as
// of v1.47.0). The child-started listener fires inside the child's first
// workflow task, strictly after handler registration, so stimuli enqueued
// from it can always be received.
func runWhenChildStarts(env *testsuite.TestWorkflowEnvironment, f func()) {
	env.SetOnChildWorkflowStartedListener(func(_ *workflow.Info, _ workflow.Context, _ converter.EncodedValues) {
		f()
	})
}

func TestChildWorkflow_CompletesSuccessfully(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	ecDeletes := registerWfExecCommonMocks(env, childCompleting)

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-success-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 1, ecDeletes.count, "success path must clean up the ExecutionContext")
	env.AssertExpectations(t)
}

func TestChildWorkflow_FailureUpdatesStatus(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env, childFailingWith("child workflow exploded"))

	// Expect status update to FAILED
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED
	})).Return(nil).Once()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-fail-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

// TestChildWorkflow_CancellationCleanup verifies the external-cancel path end
// to end: the child is cancelled with the parent, and handleCancellation
// persists the quiet CANCELLED status and deletes the ExecutionContext.
//
// Previously skipped for the test-env panic that runWhenChildStarts closes;
// cancelling only after the child has started lets the full path run.
func TestChildWorkflow_CancellationCleanup(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	// The child blocks until cancellation reaches it through the parent's
	// context, standing in for a long TS runner execution.
	childBlocking := func(ctx workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
		return workflow.Await(ctx, func() bool { return false })
	}
	ecDeletes := registerWfExecCommonMocks(env, childBlocking)

	// The cleanup must persist CANCELLED with NO error (the quiet-cancelled
	// contract, stigmer#282).
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED &&
			status.GetError() == ""
	})).Return(nil).Once()

	runWhenChildStarts(env, func() {
		env.CancelWorkflow()
	})

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-cancel-cleanup-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError(), "external cancellation surfaces as a workflow error")
	require.Equal(t, 1, ecDeletes.count, "cancellation cleanup must delete the ExecutionContext")
	env.AssertExpectations(t)
}

func TestPauseSignal_UpdatesStatusAndRelays(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	// The child completes only after the relayed pause signal reaches it:
	// the relay is asserted for real (the test's name), and the pause chain
	// (status update + relay) is serialized ahead of parent completion.
	var relayedReason string
	childAwaitingPause := func(ctx workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
		workflow.GetSignalChannel(ctx, SignalPause).Receive(ctx, &relayedReason)
		return nil
	}
	registerWfExecCommonMocks(env, childAwaitingPause)

	// Expect PAUSED status update
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED
	})).Return(nil).Once()

	runWhenChildStarts(env, func() {
		env.SignalWorkflow(SignalPause, "user requested pause")
	})

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-pause-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "user requested pause", relayedReason,
		"the pause reason must be relayed to the child verbatim")
	env.AssertExpectations(t)
}

// TestResumeSignal_UpdatesStatusAndRelays pins the pause→resume chain: each
// signal updates the persisted status (PAUSED, then IN_PROGRESS) and is
// relayed to the child in arrival order — the ordering the Selector in
// startSignalHandlers exists to guarantee.
//
// Previously skipped for the test-env panic that runWhenChildStarts closes.
func TestResumeSignal_UpdatesStatusAndRelays(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	// The child completes only after BOTH relays arrive, in order. A resume
	// relay overtaking its pause relay would leave the child blocked on the
	// pause channel and fail the test at the env timeout.
	var relayedReason string
	resumeRelayed := false
	childAwaitingPauseThenResume := func(ctx workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
		workflow.GetSignalChannel(ctx, SignalPause).Receive(ctx, &relayedReason)
		workflow.GetSignalChannel(ctx, SignalResume).Receive(ctx, nil)
		resumeRelayed = true
		return nil
	}
	registerWfExecCommonMocks(env, childAwaitingPauseThenResume)

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED
	})).Return(nil).Once()
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS
	})).Return(nil).Once()

	runWhenChildStarts(env, func() {
		env.SignalWorkflow(SignalPause, "user requested pause")
		env.SignalWorkflow(SignalResume, nil)
	})

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-resume-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "user requested pause", relayedReason)
	require.True(t, resumeRelayed, "the resume signal must be relayed to the child after the pause")
	env.AssertExpectations(t)
}

// TestRelaySignal_ForwardsToChild pins the generic relay lane used by
// signal-receiving tasks (human_input, listen): a relaySignal sent to the
// orchestrator is forwarded to the child under its task-specific signal name
// with the payload intact.
//
// Previously skipped for the test-env panic that runWhenChildStarts closes.
func TestRelaySignal_ForwardsToChild(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const taskSignalName = "human-input-task-1"

	var forwardedPayload string
	childAwaitingTaskSignal := func(ctx workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
		workflow.GetSignalChannel(ctx, taskSignalName).Receive(ctx, &forwardedPayload)
		return nil
	}
	registerWfExecCommonMocks(env, childAwaitingTaskSignal)

	runWhenChildStarts(env, func() {
		env.SignalWorkflow("relaySignal", RelaySignalPayload{
			SignalName: taskSignalName,
			Payload:    "approved",
		})
	})

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-relay-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "approved", forwardedPayload,
		"the relay payload must be forwarded to the child's task signal channel verbatim")
	env.AssertExpectations(t)
}

// TestChildWorkflow_FailureReachesTerminalState verifies that when the child
// workflow fails, the orchestrator workflow itself terminates with an error
// (not stuck in a retry loop). The returned error must be an ApplicationError
// (non-retryable), not a bare RuntimeException-equivalent that Temporal would
// retry forever.
func TestChildWorkflow_FailureReachesTerminalState(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env, childFailingWith("child failed: task 'deploy' exited with code 1"))

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED
	})).Return(nil).Once()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-terminal-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted(),
		"workflow must complete (not hang or retry)")
	require.Error(t, env.GetWorkflowError(),
		"workflow must return an error on child failure")

	env.AssertExpectations(t)
}

// TestChildWorkflow_CleanupOnFailure verifies that the EC delete activity
// is called on the failure path, not just the success path. This catches
// the bug where finally-block cleanup was silently lost.
func TestChildWorkflow_CleanupOnFailure(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	ecDeletes := registerWfExecCommonMocks(env, childFailingWith("child failed for cleanup test"))

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED
	})).Return(nil).Once()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-cleanup-fail-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
	require.Equal(t, 1, ecDeletes.count, "failure path must clean up the ExecutionContext")
	env.AssertExpectations(t)
}

// TestChildWorkflow_FailureStatusContainsError verifies that the FAILED
// status update includes the child workflow's own error message, not just a
// generic wrapper.
func TestChildWorkflow_FailureStatusContainsError(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	childErrMsg := "YAML parse error: invalid task 'deploy' configuration"
	registerWfExecCommonMocks(env, childFailingWith("child failed: "+childErrMsg))

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED &&
			strings.Contains(status.GetError(), childErrMsg)
	})).Return(nil).Once()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-err-msg-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

// TestChildWorkflow_SuccessDeletesEC verifies that EC delete is called on the
// success path.
func TestChildWorkflow_SuccessDeletesEC(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	ecDeletes := registerWfExecCommonMocks(env, childCompleting)

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-success-ec-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 1, ecDeletes.count, "success path must delete the ExecutionContext exactly once")
	env.AssertExpectations(t)
}

// TestChildWorkflow_RecoveryModeAccepted verifies that the orchestrator
// forwards the input — including RecoveryMode: true — to the child workflow
// unchanged. The real child captures its input, so the flag's arrival is
// asserted directly.
func TestChildWorkflow_RecoveryModeAccepted(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var childInput *activities.InvokeWorkflowExecutionWorkflowInput
	childCapturingInput := func(_ workflow.Context, in *activities.InvokeWorkflowExecutionWorkflowInput) error {
		childInput = in
		return nil
	}
	registerWfExecCommonMocks(env, childCapturingInput)

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-recovery-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
		RecoveryMode:       true,
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(),
		"orchestrator must complete without error when RecoveryMode is true")
	require.NotNil(t, childInput, "the child workflow must receive the forwarded input")
	require.True(t, childInput.RecoveryMode,
		"RecoveryMode must reach the child workflow unchanged")

	env.AssertExpectations(t)
}

// TestCancellationStatusIsQuiet pins the quiet-cancelled contract
// (stigmer#282): the status persisted on cancellation is EXECUTION_CANCELLED
// with NO error — cancel is a quiet terminal state, not a failure. A
// regression that reintroduces a "Workflow execution cancelled" error
// sentinel would make clients render a user-initiated stop as a failure.
//
// The full external-cancel path is covered by
// TestChildWorkflow_CancellationCleanup; this exercises
// updateStatusOnCancellation in isolation via a wrapper workflow (the same
// pattern TestVersioning_V0FallsBackToActivity uses) so the contract stays
// pinned even if the end-to-end test's shape changes.
func TestCancellationStatusIsQuiet(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env, childCompleting)

	// The mock only matches a CANCELLED status carrying no error; a sentinel
	// regression would leave the activity unmatched and fail the assertion.
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED &&
			status.GetError() == ""
	})).Return(nil).Once()

	testWorkflow := func(ctx workflow.Context, executionID string) error {
		impl := &InvokeWorkflowExecutionWorkflowImpl{}
		impl.updateStatusOnCancellation(ctx, executionID)
		return nil
	}
	env.RegisterWorkflow(testWorkflow)

	env.ExecuteWorkflow(testWorkflow, "exec-cancel-quiet-1")

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

func TestVersioning_V0FallsBackToActivity(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env, childCompleting)

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	// Mock the legacy activity to complete successfully
	env.OnActivity(stubLegacyActivity, mock.Anything).
		Return(&workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		}, nil)

	// Force version 0 by testing the executeVersioned method directly.
	// We wrap it in a simple workflow function for the test env.
	testWorkflow := func(ctx workflow.Context, input *activities.InvokeWorkflowExecutionWorkflowInput) error {
		impl := &InvokeWorkflowExecutionWorkflowImpl{}
		return impl.executeVersioned(ctx, 0, input)
	}
	env.RegisterWorkflow(testWorkflow)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-v0-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow(testWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Verify the legacy activity was called (not the child workflow)
	env.AssertExpectations(t)
}
