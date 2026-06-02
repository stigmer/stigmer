//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowInstance_CreateThenGetByWorkflow verifies the complete lifecycle:
// 1. Create a workflow (which auto-creates a default instance)
// 2. Create a user instance via the Create RPC
// 3. Call GetByWorkflow and verify BOTH the default and user instances are returned
//
// This is the critical path for the Instances tab in the UI — if GetByWorkflow
// doesn't return the user-created instance, the list appears empty.
func TestWorkflowInstance_CreateThenGetByWorkflow(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "instance-lifecycle", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Step 1: Create a minimal workflow
	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"x": "1"},
	})
	require.NoError(t, err)

	workflow, err := deployer.ApplyWorkflow(ctx, &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "instance-test-workflow",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Workflow for instance lifecycle test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "instance-test-workflow",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setX",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
				},
			},
		},
	})
	require.NoError(t, err, "workflow apply should succeed")
	require.NotEmpty(t, workflow.GetMetadata().GetId())

	workflowId := workflow.GetMetadata().GetId()
	defaultInstanceId := workflow.GetStatus().GetDefaultInstanceId()
	t.Logf("workflow created: id=%s, defaultInstanceId=%s", workflowId, defaultInstanceId)

	// Step 2: Query instances BEFORE creating a user instance
	// Should return at least the default instance
	listBefore, err := clients.InstanceQuery.GetByWorkflow(ctx, &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
		WorkflowId: workflowId,
	})
	require.NoError(t, err, "GetByWorkflow should succeed before user instance creation")
	t.Logf("instances BEFORE user create: count=%d", len(listBefore.GetEntries()))
	for i, inst := range listBefore.GetEntries() {
		t.Logf("  [%d] id=%s name=%s workflowId=%s",
			i, inst.GetMetadata().GetId(), inst.GetMetadata().GetName(),
			inst.GetSpec().GetWorkflowId())
	}

	// Step 3: Create a user instance via the Create RPC
	userInstance, err := clients.InstanceCommand.Create(ctx, &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "my-custom-instance",
			Org:  harness.TestOrg,
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflowId,
			Description: "User-created instance for testing",
		},
	})
	require.NoError(t, err, "instance Create RPC should succeed")
	require.NotEmpty(t, userInstance.GetMetadata().GetId(), "created instance must have an ID")
	t.Logf("user instance created: id=%s, name=%s", userInstance.GetMetadata().GetId(), userInstance.GetMetadata().GetName())

	// Track for cleanup
	defer func() {
		_, _ = clients.InstanceCommand.Delete(ctx, &workflowinstancev1.WorkflowInstanceId{
			Value: userInstance.GetMetadata().GetId(),
		})
	}()

	// Step 4: Query instances AFTER creating the user instance
	listAfter, err := clients.InstanceQuery.GetByWorkflow(ctx, &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
		WorkflowId: workflowId,
	})
	require.NoError(t, err, "GetByWorkflow should succeed after user instance creation")
	t.Logf("instances AFTER user create: count=%d", len(listAfter.GetEntries()))
	for i, inst := range listAfter.GetEntries() {
		t.Logf("  [%d] id=%s name=%s workflowId=%s",
			i, inst.GetMetadata().GetId(), inst.GetMetadata().GetName(),
			inst.GetSpec().GetWorkflowId())
	}

	// Step 5: Assertions
	// The list AFTER should have more entries than BEFORE (at minimum +1 for the user instance)
	assert.Greater(t, len(listAfter.GetEntries()), len(listBefore.GetEntries()),
		"GetByWorkflow should return more instances after creating one")

	// The user instance ID must appear in the list
	var foundUserInstance bool
	for _, inst := range listAfter.GetEntries() {
		if inst.GetMetadata().GetId() == userInstance.GetMetadata().GetId() {
			foundUserInstance = true
			break
		}
	}
	assert.True(t, foundUserInstance,
		"GetByWorkflow response MUST contain the user-created instance (id=%s); got %d entries",
		userInstance.GetMetadata().GetId(), len(listAfter.GetEntries()))

	// Also verify the user instance can be fetched directly by ID
	fetched, err := clients.InstanceQuery.Get(ctx, &workflowinstancev1.WorkflowInstanceId{
		Value: userInstance.GetMetadata().GetId(),
	})
	require.NoError(t, err, "Get by ID should succeed for user-created instance")
	assert.Equal(t, userInstance.GetMetadata().GetId(), fetched.GetMetadata().GetId())
	assert.Equal(t, workflowId, fetched.GetSpec().GetWorkflowId())
	t.Logf("direct Get confirmed: id=%s, name=%s, workflowId=%s",
		fetched.GetMetadata().GetId(), fetched.GetMetadata().GetName(), fetched.GetSpec().GetWorkflowId())
}
