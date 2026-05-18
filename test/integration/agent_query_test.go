//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAgentQuery_GetDefault_ReturnsSeededAgent(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent, err := clients.AgentQuery.GetDefault(ctx, &agentv1.GetDefaultAgentRequest{
		Org: "test-org",
	})
	require.NoError(t, err, "getDefault should succeed — seedDefaultAgent() runs in TestMain")
	require.NotNil(t, agent, "returned agent must not be nil")

	// The seeded agent carries the default-agent label.
	labels := agent.GetMetadata().GetLabels()
	require.Equal(t, "true", labels["stigmer.ai/default-agent"],
		"default agent must have stigmer.ai/default-agent=true label")

	// The seeded agent has public visibility.
	require.Equal(t, apiresource.ApiResourceVisibility_visibility_public,
		agent.GetMetadata().GetVisibility(),
		"default agent must have visibility_public")

	// The desktop app needs default_instance_id to create a session.
	require.NotEmpty(t, agent.GetStatus().GetDefaultInstanceId(),
		"default agent must have a populated status.default_instance_id — "+
			"the desktop app uses this to create sessions")

	t.Logf("getDefault returned agent: id=%s, name=%s, default_instance_id=%s",
		agent.GetMetadata().GetId(),
		agent.GetMetadata().GetName(),
		agent.GetStatus().GetDefaultInstanceId())
}

func TestAgentQuery_GetDefault_EmptyOrg_Rejected(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.AgentQuery.GetDefault(ctx, &agentv1.GetDefaultAgentRequest{
		Org: "",
	})
	require.Error(t, err, "empty org should be rejected by proto validation (min_len=1)")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	require.Equal(t, codes.InvalidArgument, st.Code(),
		"expected INVALID_ARGUMENT for empty org, got %s: %s", st.Code(), st.Message())

	t.Logf("empty org correctly rejected: code=%s, message=%s", st.Code(), st.Message())
}

func TestAgentQuery_GetDefault_ResponseShape(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent, err := clients.AgentQuery.GetDefault(ctx, &agentv1.GetDefaultAgentRequest{
		Org: "test-org",
	})
	require.NoError(t, err, "getDefault should succeed")

	// Validate the full response shape that clients depend on.
	require.Equal(t, "agentic.stigmer.ai/v1", agent.GetApiVersion(), "api_version")
	require.Equal(t, "Agent", agent.GetKind(), "kind")

	md := agent.GetMetadata()
	require.NotNil(t, md, "metadata must be present")
	require.NotEmpty(t, md.GetId(), "metadata.id must be populated")
	require.Equal(t, "assistant", md.GetName(), "metadata.name must match the seeded agent")
	require.NotEmpty(t, md.GetOrg(), "metadata.org must be populated")

	spec := agent.GetSpec()
	require.NotNil(t, spec, "spec must be present")
	require.NotEmpty(t, spec.GetDescription(), "spec.description must be populated")
	require.NotEmpty(t, spec.GetInstructions(), "spec.instructions must be populated")

	st := agent.GetStatus()
	require.NotNil(t, st, "status must be present")
	require.NotEmpty(t, st.GetDefaultInstanceId(),
		"status.default_instance_id must be populated — clients use this to create sessions")

	t.Logf("response shape validated: api_version=%s, kind=%s, id=%s, name=%s, instance=%s",
		agent.GetApiVersion(), agent.GetKind(),
		md.GetId(), md.GetName(), st.GetDefaultInstanceId())
}
