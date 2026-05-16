//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowHTTP_SuccessfulCall verifies that an http_call task can
// reach an external HTTP server and complete successfully.
//
// Workflow: setURL (set_vars with mock URL) → fetchData (http_call GET)
func TestWorkflowHTTP_SuccessfulCall(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	mock := harness.NewMockHTTPServer([]harness.MockRoute{
		{
			Method:     "GET",
			Path:       "/api/data",
			StatusCode: 200,
			Response: map[string]any{
				"status": "ok",
				"count":  42,
			},
		},
	})
	defer mock.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "http-ok", suiteLogger)
	defer deployer.Cleanup(ctx)

	setURLConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"mock_url": mock.URL() + "/api/data",
		},
	})
	require.NoError(t, err)

	httpConfig, err := structpb.NewStruct(map[string]any{
		"method": "GET",
		"endpoint": map[string]any{
			"uri": "${ $data.mock_url }",
		},
		"timeout_seconds": float64(30),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-http-call",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: http_call with mock server",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-http-call",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setURL",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setURLConfig,
				},
				{
					Name:       "fetchData",
					Kind:       workflowv1.WorkflowTaskKind_http_call,
					TaskConfig: httpConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "http call test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setURL":    workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"fetchData": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("http_call completed: mock server returned 200, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowHTTP_ServerError verifies that an http_call task that receives
// a 500 response results in a failed execution.
func TestWorkflowHTTP_ServerError(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	mock := harness.NewMockHTTPServer([]harness.MockRoute{
		{
			Method:     "POST",
			Path:       "/api/submit",
			StatusCode: 500,
			Response: map[string]any{
				"error": "internal server error",
			},
		},
	})
	defer mock.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "http-err", suiteLogger)
	defer deployer.Cleanup(ctx)

	setURLConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"mock_url": mock.URL() + "/api/submit",
		},
	})
	require.NoError(t, err)

	httpConfig, err := structpb.NewStruct(map[string]any{
		"method": "POST",
		"endpoint": map[string]any{
			"uri": "${ $data.mock_url }",
		},
		"timeout_seconds": float64(30),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-http-error",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: http_call with 500 error",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-http-error",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setURL",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setURLConfig,
				},
				{
					Name:       "submitData",
					Kind:       workflowv1.WorkflowTaskKind_http_call,
					TaskConfig: httpConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "http error test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)

	t.Logf("http_call error: execution correctly failed on 500 response")
}

// TestWorkflowIO_EmitEvent verifies that the emit_event task constructs
// a CloudEvents envelope and completes successfully.
//
// Workflow: setContext (set_vars) → emitEvent (emit_event with type, source, data)
//
// The emit_event activity constructs a CloudEvents 1.0 envelope. Cross-workflow
// delivery is deferred; this test validates envelope construction and task lifecycle.
func TestWorkflowIO_EmitEvent(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "emit-ev", suiteLogger)
	defer deployer.Cleanup(ctx)

	setContextConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"order_id": "ord-12345",
		},
	})
	require.NoError(t, err)

	emitConfig, err := structpb.NewStruct(map[string]any{
		"event": map[string]any{
			"type":    "com.stigmer.order.completed",
			"source":  "/integration-tests",
			"subject": "ord-12345",
			"data": map[string]any{
				"order_id": "ord-12345",
				"status":   "completed",
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-emit-event",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: emit_event CloudEvents envelope",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-emit-event",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setContext",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setContextConfig,
				},
				{
					Name:       "emitEvent",
					Kind:       workflowv1.WorkflowTaskKind_emit_event,
					TaskConfig: emitConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "emit event test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setContext": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"emitEvent":  workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("emit_event completed: CloudEvents envelope constructed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowIO_Notification_Webhook verifies that a notification task
// delivers a webhook payload to the recipient URL.
//
// Workflow: notify (notification, channel="webhook", recipient=capture server)
//
// A WebhookCaptureServer receives the POST and the test asserts both
// task completion and payload content.
func TestWorkflowIO_Notification_Webhook(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	capture := harness.NewWebhookCaptureServer()
	defer capture.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "notif-ok", suiteLogger)
	defer deployer.Cleanup(ctx)

	notifyConfig, err := structpb.NewStruct(map[string]any{
		"channel":    "webhook",
		"recipients": []any{capture.URL()},
		"subject":    "Integration Test Alert",
		"body":       "Deployment pipeline completed successfully",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-notification-webhook",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: notification via webhook",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-notification-webhook",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "notify",
					Kind:       workflowv1.WorkflowTaskKind_notification,
					TaskConfig: notifyConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "notification webhook test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "notify",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	select {
	case payload := <-capture.Payloads:
		var body map[string]any
		require.NoError(t, json.Unmarshal(payload, &body))
		assert.Equal(t, "Integration Test Alert", body["subject"])
		assert.Equal(t, "Deployment pipeline completed successfully", body["body"])
		t.Logf("notification webhook delivered: subject=%q, body_length=%d",
			body["subject"], len(payload))
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for webhook payload — notification was not delivered")
	}
}

// TestWorkflowIO_Notification_WebhookFailed documents the behavior when the
// webhook recipient is unreachable.
//
// The WebhookProvider in notification/webhook.go returns a non-error result
// with Delivered=false when the HTTP call fails, so the notification activity
// succeeds (the task completes) but the result indicates delivery failure.
func TestWorkflowIO_Notification_WebhookFailed(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "notif-bad", suiteLogger)
	defer deployer.Cleanup(ctx)

	notifyConfig, err := structpb.NewStruct(map[string]any{
		"channel":    "webhook",
		"recipients": []any{"http://127.0.0.1:1"},
		"subject":    "Unreachable Test",
		"body":       "This should fail delivery",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-notification-bad-url",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: notification to unreachable webhook",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-notification-bad-url",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "notifyBadUrl",
					Kind:       workflowv1.WorkflowTaskKind_notification,
					TaskConfig: notifyConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "notification bad url test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	// The WebhookProvider returns a non-error result with Delivered=false
	// when the HTTP call fails, so the activity succeeds and the execution
	// completes. This documents that behavior.
	phase := result.GetStatus().GetPhase()
	t.Logf("notification to unreachable URL: phase=%s, tasks=%d",
		phase.String(), len(result.GetStatus().GetTasks()))

	harness.AssertTaskStatus(t, result, "notifyBadUrl",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
}
