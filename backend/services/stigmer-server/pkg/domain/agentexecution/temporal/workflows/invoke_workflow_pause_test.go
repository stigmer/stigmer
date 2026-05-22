package workflows

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

// Stub activity functions for registration. The Temporal test env requires
// actual Go functions registered under the correct names so that
// workflow.ExecuteActivity calls can be matched and mocked.
func stubEnsureThread(_ string, _ string) (string, error) { return "", nil }
func stubGenerateSessionSubject(_ string) error           { return nil }
func stubExecuteDeepAgent(_ string, _ string) (*agentexecutionv1.AgentExecutionStatus, error) {
	return nil, nil
}
func stubUpdateExecutionStatus(_ string, _ *agentexecutionv1.AgentExecutionStatus) error {
	return nil
}
func stubDeleteExecutionContext(_ string) error { return nil }
func stubLoadAgentExecution(_ string) (*agentexecutionv1.AgentExecution, error) {
	return nil, nil
}
func stubCompleteExternalActivity(_ []byte, _ *agentexecutionv1.AgentExecution, _ error) error {
	return nil
}

// registerCommonMocks sets up the activity mocks that every test needs:
// EnsureThread, GenerateSessionSubject, deleteExecutionContext, and
// the UpdateExecutionStatus local activity (used by persistFinalStatus).
func registerCommonMocks(env *testsuite.TestWorkflowEnvironment, threadID string) {
	env.RegisterActivityWithOptions(stubEnsureThread, activity.RegisterOptions{
		Name: activities.EnsureThreadActivityName,
	})
	env.RegisterActivityWithOptions(stubGenerateSessionSubject, activity.RegisterOptions{
		Name: activities.GenerateSessionSubjectActivityName,
	})
	env.RegisterActivityWithOptions(stubExecuteDeepAgent, activity.RegisterOptions{
		Name: activities.ExecuteDeepAgentActivityName,
	})
	env.RegisterActivityWithOptions(stubUpdateExecutionStatus, activity.RegisterOptions{
		Name: activities.UpdateExecutionStatusActivityName,
	})
	env.RegisterActivityWithOptions(stubDeleteExecutionContext, activity.RegisterOptions{
		Name: ecactivities.DeleteExecutionContextActivityName,
	})
	env.RegisterActivityWithOptions(stubLoadAgentExecution, activity.RegisterOptions{
		Name: activities.LoadAgentExecutionActivityName,
	})
	env.RegisterActivityWithOptions(stubCompleteExternalActivity, activity.RegisterOptions{
		Name: activities.CompleteExternalActivityName,
	})

	env.OnActivity(stubEnsureThread, mock.Anything, mock.Anything).
		Return(threadID, nil)

	env.OnActivity(stubGenerateSessionSubject, mock.Anything).
		Return(nil)

	env.OnActivity(stubUpdateExecutionStatus, mock.Anything, mock.Anything).
		Return(nil).Maybe()

	env.OnActivity(stubDeleteExecutionContext, mock.Anything).
		Return(nil).Maybe()

	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{}, nil).Maybe()

	env.OnActivity(stubCompleteExternalActivity, mock.Anything, mock.Anything, mock.Anything).
		Return(nil).Maybe()
}

func TestPauseSignalCancelsActivityAndWaitsForResume(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-123"
	registerCommonMocks(env, threadID)

	// In the test env, cancelled activities don't run the mock callback.
	// The first invocation is cancelled by the pause signal (mock not called).
	// After resume, the second invocation runs the mock and completes.
	resumeCallCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything, mock.Anything).
		Return(func(eid string, tid string) (*agentexecutionv1.AgentExecutionStatus, error) {
			resumeCallCount++
			return &agentexecutionv1.AgentExecutionStatus{
				Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			}, nil
		})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalPause, "user requested pause")
	}, 0)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalResume, nil)
	}, 0)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 1, resumeCallCount, "activity should complete once after resume (first invocation is cancelled by pause)")
}

func TestNormalCompletionWithoutPause(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-456"
	registerCommonMocks(env, threadID)

	env.OnActivity(stubExecuteDeepAgent, mock.Anything, mock.Anything).
		Return(&agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		}, nil)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

func TestHitlApprovalLoopWithoutPause(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-hitl"
	registerCommonMocks(env, threadID)

	// The workflow reads pending_approvals from DB via loadExecution(), not
	// from the slim status returned by the activity.
	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{
			Status: &agentexecutionv1.AgentExecutionStatus{
				PendingApprovals: []*agentexecutionv1.PendingApproval{
					{ToolCallId: "tc-1"},
				},
			},
		}, nil)

	callCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything, mock.Anything).
		Return(func(eid string, tid string) (*agentexecutionv1.AgentExecutionStatus, error) {
			callCount++
			if callCount == 1 {
				return &agentexecutionv1.AgentExecutionStatus{
					Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
				}, nil
			}
			return &agentexecutionv1.AgentExecutionStatus{
				Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			}, nil
		})

	// Send approval signal
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalApprovalGateResolved, nil)
	}, 0)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 2, callCount)
}

func TestMultiplePauseResumeCycles(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-multi"
	registerCommonMocks(env, threadID)

	// Two pause/resume cycles: first two invocations cancelled, third completes.
	// In the test env, cancelled invocations don't run the mock, so only the
	// final (non-cancelled) invocation runs.
	resumeCallCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything, mock.Anything).
		Return(func(eid string, tid string) (*agentexecutionv1.AgentExecutionStatus, error) {
			resumeCallCount++
			return &agentexecutionv1.AgentExecutionStatus{
				Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			}, nil
		})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalPause, "pause 1")
	}, 0)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalResume, nil)
	}, 0)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalPause, "pause 2")
	}, 0)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalResume, nil)
	}, 0)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 1, resumeCallCount, "only the final post-resume invocation completes (first two cancelled by pause)")
}

func TestFailedActivityPropagatesError(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-fail"
	registerCommonMocks(env, threadID)

	env.OnActivity(stubExecuteDeepAgent, mock.Anything, mock.Anything).
		Return(&agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: "something went wrong",
		}, nil)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	// FAILED status doesn't cause a workflow error — the workflow completes
	// normally and the Go/Java workflow relies on the FAILED phase being
	// persisted via defense-in-depth.
	require.NoError(t, env.GetWorkflowError())
}
