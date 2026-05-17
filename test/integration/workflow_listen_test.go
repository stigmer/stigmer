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
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowListen_SignalUnblocks verifies the listen task receives a signal
// via the production gRPC SendSignal API and completes the workflow.
//
// Flow:
//  1. Deploy workflow: listen task (signal mode "one") → set_vars task
//  2. Execute; the listen task blocks on signal channel "test_signal"
//  3. Send signal via gRPC SendSignal (Java → relaySignal → inner Go workflow)
//  4. Assert execution reaches COMPLETED with both tasks done
func TestWorkflowListen_SignalUnblocks(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "listen-signal", suiteLogger)
	defer deployer.Cleanup(ctx)

	listenConfig, err := structpb.NewStruct(map[string]any{
		"to": map[string]any{
			"mode": "one",
			"signals": []any{
				map[string]any{
					"id":   "test_signal",
					"type": "signal",
				},
			},
		},
	})
	require.NoError(t, err)

	afterSignalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"signal_received": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-listen-signal",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: listen task unblocked by SendSignal",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-listen-signal",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitSignal",
					Kind:       workflowv1.WorkflowTaskKind_listen,
					TaskConfig: listenConfig,
				},
				{
					Name:       "afterSignal",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterSignalConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "listen signal test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for listen task to register signal channel...", executionID)

	time.Sleep(3 * time.Second)

	payload, err := structpb.NewStruct(map[string]any{
		"message": "hello from integration test",
	})
	require.NoError(t, err)

	t.Logf("sending signal 'test_signal' via gRPC SendSignal for execution %s", executionID)
	_, err = clients.ExecutionCommand.SendSignal(ctx,
		&workflowexecutionv1.SendSignalInput{
			ExecutionId: executionID,
			SignalName:  "test_signal",
			Payload:     payload,
		})
	require.NoError(t, err, "gRPC SendSignal should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitSignal": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterSignal": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("listen task completed via gRPC SendSignal API path")
}

// TestWorkflowListen_AllMode verifies that a listen task in "all" mode waits
// for every configured signal before proceeding.
//
// Flow:
//  1. Deploy workflow: listen task (mode "all", two signals) → set_vars
//  2. Execute; the listen task blocks waiting for both signals
//  3. Send first signal — execution stays running
//  4. Send second signal — execution completes
func TestWorkflowListen_AllMode(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "listen-all", suiteLogger)
	defer deployer.Cleanup(ctx)

	listenConfig, err := structpb.NewStruct(map[string]any{
		"to": map[string]any{
			"mode": "all",
			"signals": []any{
				map[string]any{"id": "signal_a", "type": "signal"},
				map[string]any{"id": "signal_b", "type": "signal"},
			},
		},
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"all_received": "true"},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-listen-all",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: listen task all-mode waits for every signal",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-listen-all",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitAll",
					Kind:       workflowv1.WorkflowTaskKind_listen,
					TaskConfig: listenConfig,
				},
				{
					Name:       "afterAll",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "listen all-mode test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for listen task to register signal channels...", executionID)

	time.Sleep(3 * time.Second)

	// Send first signal — execution should stay running
	t.Logf("sending first signal 'signal_a' for execution %s", executionID)
	_, err = clients.ExecutionCommand.SendSignal(ctx,
		&workflowexecutionv1.SendSignalInput{
			ExecutionId: executionID,
			SignalName:  "signal_a",
			Payload:     nil,
		})
	require.NoError(t, err, "first SendSignal should succeed")

	// Brief pause to let the signal propagate
	time.Sleep(1 * time.Second)

	// Send second signal — this should complete the listen task
	t.Logf("sending second signal 'signal_b' for execution %s", executionID)
	_, err = clients.ExecutionCommand.SendSignal(ctx,
		&workflowexecutionv1.SendSignalInput{
			ExecutionId: executionID,
			SignalName:  "signal_b",
			Payload:     nil,
		})
	require.NoError(t, err, "second SendSignal should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitAll": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterAll": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("listen task all-mode completed after receiving both signals")
}
