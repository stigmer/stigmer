//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowRunWorkflow_ChildCompletes verifies that run_workflow tasks
// pass validation and apply successfully. The parent and child workflows
// are both applied to verify the proto → YAML → model pipeline handles
// the run_workflow config correctly.
//
// Runtime execution of run_workflow requires child workflow registration
// on the same Temporal worker, which the current test harness does not
// support. The runtime test is deferred until harness infrastructure
// for child workflow dispatch is built.
//
// Workflow structure:
//
//	Parent: callChild (run_workflow → child)
//	Child:  childSetVars (set_vars with child_result)
func TestWorkflowRunWorkflow_ChildCompletes(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "run-wf", suiteLogger)
	defer deployer.Cleanup(ctx)

	childTaskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"child_result": "hello-from-child",
		},
	})
	require.NoError(t, err)

	childWorkflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-run-child",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Child workflow for run_workflow test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-run-child",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "childSetVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: childTaskConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, err = deployer.ApplyWorkflow(ctx, childWorkflow)
	require.NoError(t, err, "child workflow apply should succeed")

	runConfig, err := structpb.NewStruct(map[string]any{
		"workflow": "integration-test-run-child",
	})
	require.NoError(t, err)

	parentWorkflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-run-parent",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Parent workflow that calls child via run_workflow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-run-parent",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callChild",
					Kind:       workflowv1.WorkflowTaskKind_run_workflow,
					TaskConfig: runConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, err = deployer.ApplyWorkflow(ctx, parentWorkflow)
	require.NoError(t, err, "parent workflow with run_workflow task should apply successfully")

	t.Logf("run_workflow: both child and parent workflows applied successfully; " +
		"runtime execution deferred until child workflow dispatch harness is built")
}

// TestWorkflowGrpcCall_InvalidConfig verifies that a grpc_call task with
// missing required configuration (service, method) is rejected at apply time.
func TestWorkflowGrpcCall_InvalidConfig(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "grpc-bad", suiteLogger)
	defer deployer.Cleanup(ctx)

	emptyConfig, err := structpb.NewStruct(map[string]any{})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-grpc-invalid",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: grpc_call with missing config",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-grpc-invalid",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "badGrpc",
					Kind:       workflowv1.WorkflowTaskKind_grpc_call,
					TaskConfig: emptyConfig,
				},
			},
		},
	}

	_, err = deployer.ApplyWorkflow(ctx, workflow)
	assert.Error(t, err, "applying a grpc_call workflow with empty config should fail")
	t.Logf("grpc_call invalid config correctly rejected: %v", err)
}

// TestWorkflowActivityCall_InvalidConfig verifies that an activity_call task
// with missing required configuration (activity name) is rejected at apply time.
func TestWorkflowActivityCall_InvalidConfig(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "act-bad", suiteLogger)
	defer deployer.Cleanup(ctx)

	emptyConfig, err := structpb.NewStruct(map[string]any{})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-activity-invalid",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: activity_call with missing config",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-activity-invalid",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "badActivity",
					Kind:       workflowv1.WorkflowTaskKind_activity_call,
					TaskConfig: emptyConfig,
				},
			},
		},
	}

	_, err = deployer.ApplyWorkflow(ctx, workflow)
	assert.Error(t, err, "applying an activity_call workflow with empty config should fail")
	t.Logf("activity_call invalid config correctly rejected: %v", err)
}
