//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// blockingWorkflow returns a workflow with: set_vars -> wait 60s -> set_vars.
// The long wait gives a reliable window for issuing cancel/terminate/pause commands.
func blockingWorkflow(name string) (*workflowv1.Workflow, error) {
	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"started": "true"},
	})
	if err != nil {
		return nil, err
	}

	waitConfig, err := structpb.NewStruct(map[string]any{
		"duration": map[string]any{"seconds": float64(60)},
	})
	if err != nil {
		return nil, err
	}

	finalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"finished": "true"},
	})
	if err != nil {
		return nil, err
	}

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: blocking workflow for lifecycle control",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "longWait",
					Kind:       workflowv1.WorkflowTaskKind_wait,
					TaskConfig: waitConfig,
				},
				{
					Name:       "finalVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: finalConfig,
				},
			},
		},
	}, nil
}

// fastWorkflow returns a workflow with a single fast set_vars task that
// completes immediately, useful for testing lifecycle commands on terminal executions.
func fastWorkflow(name string) (*workflowv1.Workflow, error) {
	config, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"done": "true"},
	})
	if err != nil {
		return nil, err
	}

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: fast workflow for terminal-phase tests",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "quickSet",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: config,
				},
			},
		},
	}, nil
}

// multiStepWorkflow returns a workflow with many sequential set_vars tasks.
// Pause takes effect at checkPause yield points between tasks, so multiple
// fast tasks give the pause signal a window to land between boundaries.
func multiStepWorkflow(name string) (*workflowv1.Workflow, error) {
	tasks := make([]*workflowv1.WorkflowTask, 0, 8)
	for i := 1; i <= 8; i++ {
		cfg, err := structpb.NewStruct(map[string]any{
			"variables": map[string]any{
				"step": float64(i),
			},
		})
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, &workflowv1.WorkflowTask{
			Name:       "step" + string(rune('0'+i)),
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: cfg,
		})
	}

	// Insert a short wait in the middle to give pause time to arrive
	waitCfg, err := structpb.NewStruct(map[string]any{
		"duration": map[string]any{"seconds": float64(10)},
	})
	if err != nil {
		return nil, err
	}
	waitTask := &workflowv1.WorkflowTask{
		Name:       "midWait",
		Kind:       workflowv1.WorkflowTaskKind_wait,
		TaskConfig: waitCfg,
	}
	// Insert wait after step4
	expanded := make([]*workflowv1.WorkflowTask, 0, 9)
	expanded = append(expanded, tasks[:4]...)
	expanded = append(expanded, waitTask)
	expanded = append(expanded, tasks[4:]...)

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: multi-step workflow for pause/resume",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: expanded,
		},
	}, nil
}

func TestWorkflowExecution_Cancel(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-cancel", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("integration-test-wf-cancel")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cancel test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// Wait until the workflow is running (first set_vars completes, wait starts)
	time.Sleep(3 * time.Second)

	t.Logf("cancelling execution %s", executionID)
	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test cancel",
	})
	require.NoError(t, err, "cancel should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err, "execution should reach CANCELLED")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED)

	t.Logf("workflow execution cancelled: id=%s", executionID)
}

func TestWorkflowExecution_CancelIdempotent(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-cancel-idem", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("integration-test-wf-cancel-idem")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cancel idempotent test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	time.Sleep(3 * time.Second)

	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err)

	// Second cancel should be a no-op
	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err, "cancelling already-cancelled execution should be idempotent")

	t.Logf("cancel idempotent: second cancel returned no error")
}

func TestWorkflowExecution_CancelTerminalFails(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-cancel-term", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := fastWorkflow("integration-test-wf-cancel-terminal")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cancel terminal test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err, "execution should complete first")

	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id: execution.GetMetadata().GetId(),
	})
	assert.Error(t, err, "cancelling completed execution should return FAILED_PRECONDITION")
	t.Logf("cancel-terminal correctly rejected: %v", err)
}

func TestWorkflowExecution_Terminate(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-terminate", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("integration-test-wf-terminate")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "terminate test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	time.Sleep(3 * time.Second)

	t.Logf("terminating execution %s", executionID)
	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test terminate",
	})
	require.NoError(t, err, "terminate should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, 90*time.Second)
	require.NoError(t, err, "execution should reach TERMINATED")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED)

	t.Logf("workflow execution terminated: id=%s", executionID)
}

func TestWorkflowExecution_TerminateIdempotent(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-term-idem", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("integration-test-wf-term-idem")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "terminate idempotent test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	time.Sleep(3 * time.Second)

	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err, "terminating already-terminated execution should be idempotent")

	t.Logf("terminate idempotent: second terminate returned no error")
}

func TestWorkflowExecution_Pause(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-pause", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := multiStepWorkflow("integration-test-wf-pause")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "pause test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// Let the workflow start executing tasks
	time.Sleep(3 * time.Second)

	t.Logf("pausing execution %s", executionID)
	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test pause",
	})
	require.NoError(t, err, "pause should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 90*time.Second)
	require.NoError(t, err, "execution should reach PAUSED")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED)

	t.Logf("workflow execution paused: id=%s", executionID)

	// Clean up by terminating (paused workflow won't complete on its own)
	_, _ = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id: executionID,
	})
}

func TestWorkflowExecution_PauseAndResume(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-pause-resume", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := multiStepWorkflow("integration-test-wf-pause-resume")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "pause resume test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	time.Sleep(3 * time.Second)

	t.Logf("pausing execution %s", executionID)
	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test pause-resume",
	})
	require.NoError(t, err, "pause should succeed")

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, 90*time.Second)
	require.NoError(t, err, "execution should reach PAUSED")

	t.Logf("resuming execution %s", executionID)
	_, err = clients.ExecutionCommand.Resume(ctx, &workflowexecutionv1.ResumeWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err, "resume should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should complete after resume")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("workflow execution pause/resume cycle complete: id=%s", executionID)
}

func TestWorkflowExecution_PauseTerminalFails(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-pause-term", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := fastWorkflow("integration-test-wf-pause-terminal")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "pause terminal test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err, "execution should complete first")

	_, err = clients.ExecutionCommand.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
		Id: execution.GetMetadata().GetId(),
	})
	assert.Error(t, err, "pausing completed execution should return FAILED_PRECONDITION")
	t.Logf("pause-terminal correctly rejected: %v", err)
}
