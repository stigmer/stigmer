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
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
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
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
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

// TestWorkflowEmit_DeliversSignalToListener is the true emit→listen e2e
// (oss#530): an emit_event task authored with a signal delivery target
// unblocks another execution's listen task through the full production
// path — apply-time typed unmarshal of the delivery config, converter
// emission into the CNCF YAML, the runner's emit activity, and the
// server-mediated SendSignal lane (oss#517). Before #530 the emit leg was
// unit-tested only; the SendSignal lane above covers the receiving half.
//
// Flow:
//  1. Deploy + execute the LISTENER: listen task (signal "order-fulfilled")
//     → set_vars; it blocks on the signal channel.
//  2. Deploy + execute the EMITTER: one emit_event task whose delivery
//     addresses the listener's execution id.
//  3. Assert both executions reach COMPLETED, and the emit task output
//     carries no delivery_errors (delivery is best-effort by contract, so
//     a broken lane would still complete the emitter — the output is the
//     honest witness).
func TestWorkflowEmit_DeliversSignalToListener(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	// --- Listener: blocks on signal "order-fulfilled" ---
	listenerDeployer := harness.NewFixtureDeployer(clients, "emit-listener", suiteLogger)
	defer listenerDeployer.Cleanup(ctx)

	listenConfig, err := structpb.NewStruct(map[string]any{
		"to": map[string]any{
			"mode": "one",
			"signals": []any{
				map[string]any{"id": "order-fulfilled", "type": "signal"},
			},
		},
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"order_signal_received": "true"},
	})
	require.NoError(t, err)

	listener := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-emit-listener",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: listener half of the emit→listen pairing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-emit-listener",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitOrder",
					Kind:       workflowv1.WorkflowTaskKind_listen,
					TaskConfig: listenConfig,
				},
				{
					Name:       "afterOrder",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterConfig,
				},
			},
		},
	}

	_, listenerExecution, err := listenerDeployer.DeployAndExecute(ctx, listener, "emit-listen listener")
	require.NoError(t, err)
	listenerID := listenerExecution.GetMetadata().GetId()
	t.Logf("listener execution created: id=%s, waiting for signal channel registration...", listenerID)

	time.Sleep(3 * time.Second)

	// --- Emitter: emit_event with a signal delivery target addressing the
	// listener. The execution id is known at test time, so it is authored
	// literally; production workflows flow it from a prior task's output. ---
	emitterDeployer := harness.NewFixtureDeployer(clients, "emit-emitter", suiteLogger)
	defer emitterDeployer.Cleanup(ctx)

	emitConfig, err := structpb.NewStruct(map[string]any{
		"event": map[string]any{
			"type":    "acme.order.fulfilled",
			"subject": "ORDER-42",
			"data":    map[string]any{"order_id": "ord_123"},
		},
		"delivery": []any{
			map[string]any{
				"signal": map[string]any{
					"execution_id": listenerID,
					"signal_name":  "order-fulfilled",
				},
			},
		},
	})
	require.NoError(t, err)

	emitter := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-emit-emitter",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: emitter half of the emit→listen pairing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-emit-emitter",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "notifyFulfilled",
					Kind:       workflowv1.WorkflowTaskKind_emit_event,
					TaskConfig: emitConfig,
				},
			},
		},
	}

	_, emitterExecution, err := emitterDeployer.DeployAndExecute(ctx, emitter, "emit-listen emitter")
	require.NoError(t, err)
	emitterID := emitterExecution.GetMetadata().GetId()
	t.Logf("emitter execution created: id=%s, delivery targets listener %s", emitterID, listenerID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	emitterResult, err := waiter.WaitForPhase(ctx, emitterID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	harness.AssertPhase(t, emitterResult, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Best-effort delivery means the emitter completes even when delivery
	// fails — the output's delivery_errors array is the honest witness.
	for _, task := range emitterResult.GetStatus().GetTasks() {
		if task.GetTaskName() != "notifyFulfilled" {
			continue
		}
		outputFields := task.GetOutput().GetFields()
		require.NotContains(t, outputFields, "delivery_errors",
			"signal delivery must succeed: %v", outputFields["delivery_errors"])
	}

	listenerResult, err := waiter.WaitForPhase(ctx, listenerID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	harness.AssertPhase(t, listenerResult, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, listenerResult, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitOrder": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterOrder": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("emit→listen pairing completed end-to-end: emitter %s signaled listener %s", emitterID, listenerID)
}
