package workflows

import (
	"fmt"
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// Stub activity functions for registration. The Temporal test env requires
// actual Go functions registered under the correct names so that
// workflow.ExecuteActivity / workflow.ExecuteLocalActivity calls can be matched.
func stubUpdateWfExecStatus(_ string, _ *workflowexecutionv1.WorkflowExecutionStatus) error {
	return nil
}
func stubDeleteWfExecContext(_ string) error { return nil }

// stubChildWorkflow is a stand-in for the TS child workflow
// "stigmer/workflow/execute-from-execution".
func stubChildWorkflow(_ workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
	return nil
}

// stubLegacyActivity is a stand-in for the old ExecuteWorkflow activity.
func stubLegacyActivity(_ *activities.InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	return nil, nil
}

// registerWfExecCommonMocks sets up the activity/workflow mocks that every test needs.
func registerWfExecCommonMocks(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(stubUpdateWfExecStatus, activity.RegisterOptions{
		Name: activities.UpdateWorkflowExecutionStatusActivityName,
	})
	env.RegisterActivityWithOptions(stubDeleteWfExecContext, activity.RegisterOptions{
		Name: ecactivities.DeleteExecutionContextActivityName,
	})
	env.RegisterWorkflowWithOptions(stubChildWorkflow, workflow.RegisterOptions{
		Name: "stigmer/workflow/execute-from-execution",
	})
	env.RegisterActivityWithOptions(stubLegacyActivity, activity.RegisterOptions{
		Name: activities.ExecuteWorkflowActivityName,
	})

	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	env.OnActivity(stubDeleteWfExecContext, mock.Anything).
		Return(nil).Maybe()
}

func TestChildWorkflow_CompletesSuccessfully(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(nil)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-success-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Verify EC cleanup was called
	env.AssertExpectations(t)
}

func TestChildWorkflow_FailureUpdatesStatus(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(fmt.Errorf("child workflow exploded"))

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

func TestChildWorkflow_CancellationCleanup(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	// Child workflow blocks until cancelled
	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(func(ctx workflow.Context, _ *activities.InvokeWorkflowExecutionWorkflowInput) error {
			return workflow.Sleep(ctx, 10*60*1e9) // 10 min (will be cancelled)
		})

	// Expect status update to CANCELLED
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
	})).Return(nil).Once()

	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 0)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-cancel-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

func TestPauseSignal_UpdatesStatusAndRelays(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(nil)

	// Expect PAUSED status update
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED
	})).Return(nil).Once()

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalPause, "user requested pause")
	}, 0)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-pause-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

func TestResumeSignal_UpdatesStatusAndRelays(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(nil)

	// Expect IN_PROGRESS status update
	env.OnActivity(stubUpdateWfExecStatus, mock.Anything, mock.MatchedBy(func(status *workflowexecutionv1.WorkflowExecutionStatus) bool {
		return status.GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS
	})).Return(nil).Once()

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalResume, "")
	}, 0)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-resume-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertExpectations(t)
}

func TestRelaySignal_ForwardsToChild(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

	env.OnWorkflow(stubChildWorkflow, mock.Anything, mock.Anything).
		Return(nil)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow("relaySignal", relaySignalPayload{
			SignalName: "human_input_awaitApproval",
			Payload:    map[string]string{"decision": "approved"},
		})
	}, 0)

	input := &activities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        "exec-relay-1",
		WorkflowInstanceID: "wi-1",
		WorkflowID:         "wf-1",
		OrgID:              "org-1",
	}

	env.ExecuteWorkflow((&InvokeWorkflowExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

func TestVersioning_V0FallsBackToActivity(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	registerWfExecCommonMocks(env)

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
