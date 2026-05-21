//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
)

func createTestWorkflow(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *workflowv1.Workflow {
	t.Helper()
	suffix := uuid.New().String()[:8]
	wf, err := clients.WorkflowCommand.Create(ctx, &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: fmt.Sprintf("%s-%s", name, suffix),
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow for visibility tests",
		},
	})
	require.NoError(t, err, "create test workflow")
	return wf
}

func createTestWorkflowInstance(t *testing.T, ctx context.Context, clients *harness.Clients, workflowID string) *workflowinstancev1.WorkflowInstance {
	t.Helper()
	suffix := uuid.New().String()[:8]
	inst, err := clients.InstanceCommand.Create(ctx, &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: fmt.Sprintf("test-inst-%s", suffix),
			Org:  "test-org",
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId: workflowID,
		},
	})
	require.NoError(t, err, "create test workflow instance")
	return inst
}

func createVisibilityTestAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *agentv1.Agent {
	t.Helper()
	suffix := uuid.New().String()[:8]
	agent, err := clients.AgentCommand.Create(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: fmt.Sprintf("%s-%s", name, suffix),
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Test agent for visibility tests",
			Instructions: "You are a test agent.",
		},
	})
	require.NoError(t, err, "create test agent")
	return agent
}

func createTestAgentInstance(t *testing.T, ctx context.Context, clients *harness.Clients, agentID string) *agentinstancev1.AgentInstance {
	t.Helper()
	suffix := uuid.New().String()[:8]
	inst, err := clients.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentInstance",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: fmt.Sprintf("test-inst-%s", suffix),
			Org:  "test-org",
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId: agentID,
		},
	})
	require.NoError(t, err, "create test agent instance")
	return inst
}

// TestWorkflowUpdateVisibility verifies that the updateVisibility RPC
// for workflows correctly toggles between private and public.
func TestWorkflowUpdateVisibility(t *testing.T) {
	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	workflow := createTestWorkflow(t, ctx, clients, "test-visibility-wf")
	require.NotEmpty(t, workflow.GetMetadata().GetId())
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		workflow.GetMetadata().GetVisibility(),
	)

	workflowId := workflow.GetMetadata().GetId()

	// Toggle to public
	updated, err := clients.WorkflowCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: workflowId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = clients.WorkflowCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: workflowId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		updated.GetMetadata().GetVisibility(),
	)

	// Verify via get
	fetched, err := clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: workflowId})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		fetched.GetMetadata().GetVisibility(),
	)
}

// TestWorkflowInstanceUpdateVisibility verifies the 3-state visibility
// for workflow instances (private, org, public).
func TestWorkflowInstanceUpdateVisibility(t *testing.T) {
	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	workflow := createTestWorkflow(t, ctx, clients, "test-inst-vis-wf")
	require.NotEmpty(t, workflow.GetMetadata().GetId())

	instance := createTestWorkflowInstance(t, ctx, clients, workflow.GetMetadata().GetId())
	require.NotEmpty(t, instance.GetMetadata().GetId())

	instanceId := instance.GetMetadata().GetId()

	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		instance.GetMetadata().GetVisibility(),
	)

	// Toggle to org visibility
	updated, err := clients.InstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle to public
	updated, err = clients.InstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = clients.InstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		updated.GetMetadata().GetVisibility(),
	)
}

// TestAgentInstanceUpdateVisibility verifies the 3-state visibility
// for agent instances.
func TestAgentInstanceUpdateVisibility(t *testing.T) {
	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	agent := createVisibilityTestAgent(t, ctx, clients, "test-inst-vis-agent")
	require.NotEmpty(t, agent.GetMetadata().GetId())

	instance := createTestAgentInstance(t, ctx, clients, agent.GetMetadata().GetId())
	require.NotEmpty(t, instance.GetMetadata().GetId())

	instanceId := instance.GetMetadata().GetId()

	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		instance.GetMetadata().GetVisibility(),
	)

	// Toggle to org visibility
	updated, err := clients.AgentInstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = clients.AgentInstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		updated.GetMetadata().GetVisibility(),
	)
}

// TestVisibilityOrgEnumValue verifies that the visibility_org enum value (3)
// is accepted by the server and persists correctly.
func TestVisibilityOrgEnumValue(t *testing.T) {
	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	workflow := createTestWorkflow(t, ctx, clients, "test-org-enum-wf")
	instance := createTestWorkflowInstance(t, ctx, clients, workflow.GetMetadata().GetId())
	require.NotEmpty(t, instance.GetMetadata().GetId())

	updated, err := clients.InstanceCommand.UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instance.GetMetadata().GetId(),
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)

	assert.Equal(t, int32(3), int32(updated.GetMetadata().GetVisibility()))
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)
}
