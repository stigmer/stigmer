//go:build integration

package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// TestWorkflowUpdateVisibility verifies that the new updateVisibility RPC
// for workflows correctly toggles between private and public.
func TestWorkflowUpdateVisibility(t *testing.T) {
	ctx := context.Background()

	// Create a private workflow
	workflow := testHarness.CreateWorkflow(t, ctx, "test-visibility-wf")
	require.NotEmpty(t, workflow.GetMetadata().GetId())
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		workflow.GetMetadata().GetVisibility(),
	)

	workflowId := workflow.GetMetadata().GetId()

	// Toggle to public
	updated, err := testHarness.WorkflowCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: workflowId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = testHarness.WorkflowCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: workflowId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		updated.GetMetadata().GetVisibility(),
	)

	// Verify via get
	fetched, err := testHarness.WorkflowQuery().GetById(ctx, &workflowv1.WorkflowId{Value: workflowId})
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

	// Create a workflow (which auto-creates a default instance)
	workflow := testHarness.CreateWorkflow(t, ctx, "test-inst-vis-wf")
	require.NotEmpty(t, workflow.GetMetadata().GetId())

	// Create a non-default instance for testing visibility changes
	instance := testHarness.CreateWorkflowInstance(t, ctx, workflow.GetMetadata().GetId())
	require.NotEmpty(t, instance.GetMetadata().GetId())

	instanceId := instance.GetMetadata().GetId()

	// Default should be private
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		instance.GetMetadata().GetVisibility(),
	)

	// Toggle to org visibility
	updated, err := testHarness.WorkflowInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle to public
	updated, err = testHarness.WorkflowInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = testHarness.WorkflowInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
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

	// Create an agent (which auto-creates a default instance)
	agent := testHarness.CreateAgent(t, ctx, "test-inst-vis-agent")
	require.NotEmpty(t, agent.GetMetadata().GetId())

	// Create a non-default instance for testing
	instance := testHarness.CreateAgentInstance(t, ctx, agent.GetMetadata().GetId())
	require.NotEmpty(t, instance.GetMetadata().GetId())

	instanceId := instance.GetMetadata().GetId()

	// Default should be private
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		instance.GetMetadata().GetVisibility(),
	)

	// Toggle to org visibility
	updated, err := testHarness.AgentInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)

	// Toggle back to private
	updated, err = testHarness.AgentInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instanceId,
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err)
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_private,
		updated.GetMetadata().GetVisibility(),
	)
}

// TestVisibilityOrgEnumValue verifies that the new visibility_org
// enum value (3) is accepted by the server and persists correctly.
func TestVisibilityOrgEnumValue(t *testing.T) {
	ctx := context.Background()

	instance := testHarness.CreateWorkflowInstance(t, ctx, "")
	require.NotEmpty(t, instance.GetMetadata().GetId())

	// Set to org visibility using the new enum value
	updated, err := testHarness.WorkflowInstanceCommand().UpdateVisibility(ctx, &apiresourcepb.UpdateVisibilityInput{
		ResourceId: instance.GetMetadata().GetId(),
		Visibility: apiresourcepb.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)

	// Verify the enum value round-trips correctly
	assert.Equal(t, int32(3), int32(updated.GetMetadata().GetVisibility()))
	assert.Equal(t,
		apiresourcepb.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility(),
	)
}
