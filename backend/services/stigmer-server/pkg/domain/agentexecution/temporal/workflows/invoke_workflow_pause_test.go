package workflows

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	enums "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

// Stub activity functions for registration. The Temporal test env requires
// actual Go functions registered under the correct names so that
// workflow.ExecuteActivity calls can be matched and mocked.
func stubEnsureThread(_ string, _ string) (string, error) { return "", nil }
func stubGenerateSessionSubject(_ string) error           { return nil }
func stubExecuteDeepAgent(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
	return nil, nil
}

// runnerResult builds the slim activity result the runner returns. The runner
// emits proto-JSON (string enum names), and the workflow reads it back as a
// map[string]interface{} (RunnerActivityResult) across the data converter.
func runnerResult(phase agentexecutionv1.ExecutionPhase, errMsg string) activities.RunnerActivityResult {
	r := activities.RunnerActivityResult{"phase": phase.String()}
	if errMsg != "" {
		r["error"] = errMsg
	}
	return r
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
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			resumeCallCount++
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
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

	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil)

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
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			if callCount == 1 {
				return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, ""), nil
			}
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
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

// TestHitlFileReviewOnlyGateWaitsForSignal verifies the UNIFIED HITL gate for a
// turn blocked purely on file review (apply-then-review): the execution is
// WAITING_FOR_APPROVAL with ZERO pending tool approvals but one change set
// AWAITING_REVIEW. The gate is non-empty (filereview.UnresolvedGateCount counts
// the change set), so the workflow must WAIT for the approvalGateResolved signal
// and re-invoke once — exactly like the pending-approval path — rather than
// tripping the zero-gate fail-fast watchdog (TestHitlZeroPendingApprovalFailsFast)
// that fires only when BOTH sub-gates are empty. This pins the file-review half
// of the unified gate that the pending-approval test does not exercise.
func TestHitlFileReviewOnlyGateWaitsForSignal(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-filereview"
	const executionID = "exec-filereview-only"
	registerCommonMocks(env, threadID)

	// The DB reports zero pending approvals but one change set awaiting review —
	// the pure-file-review gate. UnresolvedGateCount must see it as non-empty.
	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{
			Status: &agentexecutionv1.AgentExecutionStatus{
				FileChangeSets: []*agentexecutionv1.FileChangeSet{
					{
						Id:     "cs-1",
						Status: agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW,
					},
				},
			},
		}, nil)

	callCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			if callCount == 1 {
				return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, ""), nil
			}
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
		})

	// The file decision clears the gate and sends the SAME unified signal.
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
	require.NoError(t, env.GetWorkflowError(),
		"a file-review-only gate must wait for the signal and resume, not fail fast")
	require.Equal(t, 2, callCount,
		"workflow must re-invoke once after the file-review gate is resolved")
}

// TestHitlZeroPendingApprovalFailsFast verifies the workflow does NOT tight-loop
// the full agent activity when the execution is WAITING_FOR_APPROVAL but
// pending_approvals is empty. That state is an inconsistency that should be
// impossible once the runner<->backend approval-finalize contract holds, but the
// workflow must still fail safe: it tolerates only a small bounded number of
// consecutive zero-pending cycles (to absorb a transient read race) then fails
// fast with a descriptive error — instead of re-invoking up to MaxApprovalCycles
// (100) full agent runs, the production "RUNNING<->WAITING" churn.
func TestHitlZeroPendingApprovalFailsFast(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-zero"
	const executionID = "exec-zero-pending"
	registerCommonMocks(env, threadID)

	// DB always reports zero pending approvals (empty status) while the activity
	// keeps returning WAITING_FOR_APPROVAL — the stuck-loop signature.
	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{
			Status: &agentexecutionv1.AgentExecutionStatus{},
		}, nil)

	callCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, ""), nil
		})

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError(),
		"a persistent zero-pending WAITING_FOR_APPROVAL must fail fast, not tight-loop")
	// Initial invocation + MaxZeroGateCycles bounded re-invocations
	// before giving up — well below MaxApprovalCycles (100).
	require.Equal(t, MaxZeroGateCycles+1, callCount,
		"workflow must stop after a small bounded number of zero-pending cycles")
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor-flow parity: the WAITING_FOR_APPROVAL + pending=0 watchdog is duplicated
// in executeCursorWithHitl (the deny-and-reconcile harness), so it must be pinned
// independently of the native deep-agent loop. The Cursor flow dispatches on
// input.Harness == HARNESS_CURSOR and drives ReadHarnessStateId (local) +
// ExecuteCursor instead of EnsureThread + ExecuteDeepAgent.
// ─────────────────────────────────────────────────────────────────────────────

func stubExecuteCursor(_ activities.ExecuteCursorActivityInput) (activities.RunnerActivityResult, error) {
	return nil, nil
}
func stubReadHarnessStateId(_ string) (string, error) { return "", nil }

// registerCursorActivities registers the Cursor-flow activities (ExecuteCursor +
// the ReadHarnessStateId local activity). Temporal's test env forbids any
// RegisterActivity after the first OnActivity, so this MUST be called BEFORE
// registerCommonMocks (which issues mocks); the ReadHarnessStateId mock is then
// set alongside the other OnActivity calls.
func registerCursorActivities(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(stubExecuteCursor, activity.RegisterOptions{
		Name: activities.ExecuteCursorActivityName,
	})
	env.RegisterActivityWithOptions(stubReadHarnessStateId, activity.RegisterOptions{
		Name: activities.ReadHarnessStateIdActivityName,
	})
}

func cursorInput(executionID string) *InvokeAgentExecutionWorkflowInput {
	return &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
		Harness:     int32(sessionv1.Harness_HARNESS_CURSOR),
	}
}

// TestCursorHitlApprovalLoopWithoutPause is the Cursor analog of
// TestHitlApprovalLoopWithoutPause: one gated turn (pending=1) resolved by the
// approval signal re-invokes ExecuteCursor and completes. The happy-path counter
// to the fail-fast test below — a non-zero pending count must NOT trip the
// watchdog, it must wait for the signal.
func TestCursorHitlApprovalLoopWithoutPause(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-cursor"
	const executionID = "exec-cursor-hitl"
	registerCursorActivities(env)
	registerCommonMocks(env, threadID)
	env.OnActivity(stubReadHarnessStateId, mock.Anything).Return("harness-state-1", nil).Maybe()

	// DB reports one pending approval (the gated tool), so the watchdog stays
	// dormant and the workflow waits for the resolution signal.
	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{
			Status: &agentexecutionv1.AgentExecutionStatus{
				PendingApprovals: []*agentexecutionv1.PendingApproval{{ToolCallId: "tc-1"}},
			},
		}, nil)

	callCount := 0
	env.OnActivity(stubExecuteCursor, mock.Anything).
		Return(func(_ activities.ExecuteCursorActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			if callCount == 1 {
				return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, ""), nil
			}
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
		})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalApprovalGateResolved, nil)
	}, 0)

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, cursorInput(executionID))

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 2, callCount, "Cursor flow must re-invoke once after the approval signal and complete")
}

// TestCursorHitlZeroPendingApprovalFailsFast is the Cursor analog of
// TestHitlZeroPendingApprovalFailsFast: the precise production loop from
// aex_01kvz3pw20j6t0hw80wpevnztb. When ExecuteCursor keeps returning
// WAITING_FOR_APPROVAL while the DB projects zero pending approvals (the
// transcript-guard-rejected resume signature), the workflow must tolerate only a
// small bounded number of zero-pending cycles then fail fast — NOT tight-loop the
// full Cursor activity up to MaxApprovalCycles.
func TestCursorHitlZeroPendingApprovalFailsFast(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-cursor-zero"
	const executionID = "exec-cursor-zero-pending"
	registerCursorActivities(env)
	registerCommonMocks(env, threadID)
	env.OnActivity(stubReadHarnessStateId, mock.Anything).Return("harness-state-1", nil).Maybe()

	// DB always reports zero pending while the activity keeps returning WAITING —
	// the stuck-loop signature the watchdog must break.
	env.OnActivity(stubLoadAgentExecution, mock.Anything).
		Return(&agentexecutionv1.AgentExecution{
			Status: &agentexecutionv1.AgentExecutionStatus{},
		}, nil)

	callCount := 0
	env.OnActivity(stubExecuteCursor, mock.Anything).
		Return(func(_ activities.ExecuteCursorActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, ""), nil
		})

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, cursorInput(executionID))

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError(),
		"a persistent zero-pending WAITING_FOR_APPROVAL on the Cursor flow must fail fast, not tight-loop")
	require.Equal(t, MaxZeroGateCycles+1, callCount,
		"Cursor flow must stop after a small bounded number of zero-pending cycles")
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
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			resumeCallCount++
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
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

// TestRecoverableInterruptionResumesFromState verifies that a transient
// heartbeat-timeout interruption (worker died / machine slept mid-run) triggers
// the bounded recovery branch: the workflow re-invokes the activity from
// persisted state rather than dead-ending, and completes once the activity
// succeeds on the retry.
func TestRecoverableInterruptionResumesFromState(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-recover"
	registerCommonMocks(env, threadID)

	callCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			if callCount == 1 {
				// Simulate the worker being reaped mid-run: a heartbeat timeout.
				return nil, temporal.NewTimeoutError(enums.TIMEOUT_TYPE_HEARTBEAT, nil)
			}
			return runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, ""), nil
		})

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 2, callCount, "activity should be re-invoked once after a recoverable interruption")
}

// TestRecoveryIsBoundedByMaxCycles verifies that a persistently interrupting
// activity does not loop forever: after MaxRecoveryCycles re-invocations the
// workflow surfaces the failure instead of spinning.
func TestRecoveryIsBoundedByMaxCycles(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-recover-bound"
	registerCommonMocks(env, threadID)

	callCount := 0
	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(func(_ activities.ExecuteDeepAgentActivityInput) (activities.RunnerActivityResult, error) {
			callCount++
			return nil, temporal.NewTimeoutError(enums.TIMEOUT_TYPE_HEARTBEAT, nil)
		})

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError(), "exhausted recovery should surface the failure")
	// Initial invocation + MaxRecoveryCycles re-invocations before giving up.
	require.Equal(t, MaxRecoveryCycles+1, callCount)
}

func TestFailedActivityPropagatesError(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	const threadID = "thread-abc"
	const executionID = "exec-fail"
	registerCommonMocks(env, threadID)

	env.OnActivity(stubExecuteDeepAgent, mock.Anything).
		Return(runnerResult(agentexecutionv1.ExecutionPhase_EXECUTION_FAILED, "something went wrong"), nil)

	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID: executionID,
		SessionID:   "session-1",
		AgentID:     "agent-1",
	}

	env.ExecuteWorkflow((&InvokeAgentExecutionWorkflowImpl{}).Run, input)

	require.True(t, env.IsWorkflowCompleted())
	// An EXECUTION_FAILED activity result is propagated as a workflow error
	// (see executeDeepAgentFlow), which Run wraps as an application error.
	// The FAILED phase is also persisted via defense-in-depth.
	require.Error(t, env.GetWorkflowError())
}
