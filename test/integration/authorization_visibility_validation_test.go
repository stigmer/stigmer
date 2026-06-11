//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
)

const visPlatform = apiresource.ApiResourceVisibility_visibility_platform

// TestVisibilityCreateDefaults locks in the per-kind create defaults that the
// rest of the model depends on: blueprints default to visibility_org
// (defaults_to_org_visibility — shareable by default within the org), while
// instances default to visibility_private (personal by default).
//
// This is pure pipeline behaviour (no cross-actor enforcement), so it runs
// regardless of whether real FGA is wired in.
func TestVisibilityCreateDefaults(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := harness.NewClients(grpcConn)

	for _, bk := range blueprintKinds() {
		bk := bk
		t.Run("blueprint_"+bk.name, func(t *testing.T) {
			id := bk.create(t, ctx, c)
			got, err := bk.getVisibility(ctx, c, id)
			require.NoError(t, err)
			require.Equal(t, visOrg, got, "%s should default to visibility_org", bk.name)
		})
	}

	for _, ik := range instanceKinds() {
		ik := ik
		t.Run("instance_"+ik.name, func(t *testing.T) {
			id := ik.create(t, ctx, c)
			got, err := ik.getVisibility(ctx, c, id)
			require.NoError(t, err)
			require.Equal(t, visPrivate, got, "%s should default to visibility_private", ik.name)
		})
	}
}

// TestVisibilityUnsupportedLevelRejected asserts the support matrix is enforced
// at the pipeline boundary: instances support private/org/public but NOT
// platform, so both a create with platform visibility and an update to platform
// are rejected with INVALID_ARGUMENT.
//
// Note on no-visibility kinds (e.g. session): they are guarded structurally —
// no UpdateVisibility RPC is generated for them at all — so there is no runtime
// path to exercise here.
func TestVisibilityUnsupportedLevelRejected(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := harness.NewClients(grpcConn)

	t.Run("agent_instance", func(t *testing.T) {
		agent := createAgentBlueprint(t, ctx, c)

		// Create with platform visibility -> rejected (instances have no platform).
		_, err := c.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       uniqueVisibilityName("vis-bad-agent-inst"),
				Org:        harness.TestOrg,
				Visibility: visPlatform,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{AgentId: agent.GetMetadata().GetId()},
		})
		requireStatusCode(t, err, codes.InvalidArgument, "create agent_instance with platform visibility")

		// Update to platform visibility -> rejected.
		inst := createAgentInstanceFor(t, ctx, c, agent.GetMetadata().GetId())
		_, err = c.AgentInstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
			ResourceId: inst.GetMetadata().GetId(),
			Visibility: visPlatform,
		})
		requireStatusCode(t, err, codes.InvalidArgument, "update agent_instance to platform visibility")
	})

	t.Run("workflow_instance", func(t *testing.T) {
		wf := createWorkflowBlueprint(t, ctx, c)

		_, err := c.InstanceCommand.Create(ctx, &workflowinstancev1.WorkflowInstance{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       uniqueVisibilityName("vis-bad-wf-inst"),
				Org:        harness.TestOrg,
				Visibility: visPlatform,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{WorkflowId: wf.GetMetadata().GetId()},
		})
		requireStatusCode(t, err, codes.InvalidArgument, "create workflow_instance with platform visibility")

		inst := createWorkflowInstanceFor(t, ctx, c, wf.GetMetadata().GetId())
		_, err = c.InstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
			ResourceId: inst.GetMetadata().GetId(),
			Visibility: visPlatform,
		})
		requireStatusCode(t, err, codes.InvalidArgument, "update workflow_instance to platform visibility")
	})
}
