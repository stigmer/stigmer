//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
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
