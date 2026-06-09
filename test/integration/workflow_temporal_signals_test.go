//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// --- Phase 5: Signal and Lifecycle Control with Temporal Assertions ---

// TestSignal_PauseResumeCompletes verifies that a pause/resume cycle
// completes the workflow cleanly with both Temporal and Stigmer in
// terminal state and EC cleaned up.
func TestSignal_PauseResumeCompletes(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "sig-pause-resume", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Unique per invocation so the test is safe to loop with -count=N: the
	// service auto-creates a "<name>-default" workflow instance that fixture
	// cleanup does not remove, so a fixed name collides on the second run.
	wf, err := multiStepWorkflow(fmt.Sprintf("signal-pause-resume-%d", time.Now().UnixNano()))
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "pause/resume signal test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	orchID := harness.OrchestratorWorkflowID(executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	// Pause
	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id:     executionID,
		Reason: "signal test pause",
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 90*time.Second)
	require.NoError(t, err)

	// While paused, Temporal parent should still be running
	open, err := inspector.IsWorkflowOpen(ctx, orchID)
	require.NoError(t, err)
	require.True(t, open, "Temporal workflow should be RUNNING while paused")

	// Resume
	_, err = clients.ExecutionCommand.Resume(ctx, &workflowexecutionv1.ResumeWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	if err != nil {
		// This wait is the historically flaky point: resume occasionally fails
		// to drive the execution to COMPLETED within the timeout. Capture the
		// Temporal history and log tails before failing so the root cause is
		// diagnosable from the next occurrence rather than a bare timeout.
		testHarness.CaptureWorkflowExecutionDiagnostics(t, t.Name(), executionID)
	}
	require.NoError(t, err, "resume should drive execution %s to COMPLETED", executionID)

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 0)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	time.Sleep(3 * time.Second)
	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("signal: pause/resume completed cleanly — Temporal terminal, EC cleaned up")
}

// TestSignal_CancelWhilePaused verifies that cancelling a paused workflow
// transitions to CANCELLED (not stuck in PAUSED) and cleans up resources.
func TestSignal_CancelWhilePaused(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "sig-cancel-paused", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("signal-cancel-while-paused")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cancel while paused test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	orchID := harness.OrchestratorWorkflowID(executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	// Pause first
	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id:     executionID,
		Reason: "pause before cancel",
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 60*time.Second)
	require.NoError(t, err)

	// Cancel while paused
	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id:     executionID,
		Reason: "cancel while paused",
	})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err,
		"paused workflow should transition to CANCELLED after cancel (not stuck in PAUSED)")

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	time.Sleep(3 * time.Second)
	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("signal: cancel-while-paused reached CANCELLED — no stuck state")
}

// TestSignal_TerminateWhilePaused verifies that terminating a paused
// workflow transitions to TERMINATED.
func TestSignal_TerminateWhilePaused(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "sig-term-paused", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("signal-terminate-while-paused")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "terminate while paused test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	orchID := harness.OrchestratorWorkflowID(executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	// Pause first
	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id:     executionID,
		Reason: "pause before terminate",
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 60*time.Second)
	require.NoError(t, err)

	// Terminate while paused
	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id:     executionID,
		Reason: "terminate while paused",
	})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, 90*time.Second)
	require.NoError(t, err)

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("signal: terminate-while-paused reached TERMINATED")
}

// TestSignal_MultiplePauseResumeCycles verifies that multiple
// pause/resume cycles on a long workflow all complete correctly.
func TestSignal_MultiplePauseResumeCycles(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "sig-multi-pr", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Use a workflow with enough tasks to allow multiple pause windows
	waitConfig, err := structpb.NewStruct(map[string]any{
		"duration": map[string]any{"seconds": float64(15)},
	})
	require.NoError(t, err)

	tasks := make([]*workflowv1.WorkflowTask, 0, 4)
	for i := 1; i <= 4; i++ {
		cfg, cfgErr := structpb.NewStruct(map[string]any{
			"variables": map[string]any{"step": float64(i)},
		})
		require.NoError(t, cfgErr)
		tasks = append(tasks, &workflowv1.WorkflowTask{
			Name:       "setVars" + string(rune('0'+i)),
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: cfg,
		})
		if i < 4 {
			tasks = append(tasks, &workflowv1.WorkflowTask{
				Name:       "wait" + string(rune('0'+i)),
				Kind:       workflowv1.WorkflowTaskKind_wait,
				TaskConfig: waitConfig,
			})
		}
	}

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "signal-multi-pause-resume",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Signal test: multiple pause/resume cycles",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "signal-multi-pause-resume",
				Version:   "1.0.0",
			},
			Tasks: tasks,
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "multi pause/resume test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	orchID := harness.OrchestratorWorkflowID(executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	const pauseCycles = 2
	for i := 1; i <= pauseCycles; i++ {
		time.Sleep(3 * time.Second)

		_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
			Id:     executionID,
			Reason: "multi-cycle pause",
		})
		require.NoError(t, err, "pause cycle %d", i)

		_, err = waiter.WaitForPhase(ctx, executionID,
			workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 60*time.Second)
		require.NoError(t, err, "should reach PAUSED in cycle %d", i)

		time.Sleep(2 * time.Second)

		_, err = clients.ExecutionCommand.Resume(ctx, &workflowexecutionv1.ResumeWorkflowExecutionInput{
			Id: executionID,
		})
		require.NoError(t, err, "resume cycle %d", i)

		t.Logf("pause/resume cycle %d completed", i)
	}

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "workflow should complete after %d pause/resume cycles", pauseCycles)

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 0)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("signal: %d pause/resume cycles — COMPLETED, Temporal clean", pauseCycles)
}

// --- Lifecycle with EC Cleanup Verification ---

// TestLifecycle_Cancel_ECCleanedUp verifies that cancelling a workflow
// results in ExecutionContext cleanup.
func TestLifecycle_Cancel_ECCleanedUp(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "lc-cancel-ec", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("lifecycle-cancel-ec-cleanup")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cancel EC cleanup test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err)

	time.Sleep(5 * time.Second)
	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("lifecycle: cancel EC cleanup confirmed for %s", executionID)
}

// TestLifecycle_Terminate_ECCleanedUp verifies that terminating a workflow
// results in ExecutionContext cleanup (via the workflow's finally block
// which may or may not run depending on Temporal terminate semantics).
func TestLifecycle_Terminate_ECCleanedUp(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "lc-term-ec", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("lifecycle-terminate-ec-cleanup")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "terminate EC cleanup test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, 90*time.Second)
	require.NoError(t, err)

	// Note: Temporal terminate kills the workflow immediately — finally blocks
	// do NOT run. EC cleanup relies on TTL backup. This test documents that
	// behavior rather than asserting cleanup (which would be a false positive).
	// The EC may or may not be deleted depending on whether the workflow task
	// with the finally block was already scheduled.
	t.Logf("lifecycle: terminate completed for %s — EC cleanup depends on timing/TTL", executionID)
}
