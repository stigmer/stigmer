//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// TestAgent_UpdateSharing_Toggle verifies the targeted updateSharing RPC:
// enabling and revoking touch only spec.sharing, and the flag round-trips
// through get.
func TestAgent_UpdateSharing_Toggle(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-sharing-toggle",
		"You are a test agent for sharing toggle verification.")
	agentID := agent.GetMetadata().GetId()
	assert.False(t, agent.GetSpec().GetSharing().GetEnabled(),
		"a new agent must not be shared by default")

	updated, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agentID,
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err, "updateSharing to enabled should succeed")
	assert.True(t, updated.GetSpec().GetSharing().GetEnabled(),
		"sharing should be enabled after update")
	assert.Equal(t, agent.GetSpec().GetInstructions(), updated.GetSpec().GetInstructions(),
		"targeted sharing update must not touch other spec fields")

	got, err := clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err)
	assert.True(t, got.GetSpec().GetSharing().GetEnabled(),
		"get should reflect enabled sharing")

	reverted, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agentID,
		Sharing:    &agentv1.AgentSharing{Enabled: false},
	})
	require.NoError(t, err, "updateSharing back to disabled should succeed")
	assert.False(t, reverted.GetSpec().GetSharing().GetEnabled(),
		"sharing should be disabled after revert")

	t.Logf("sharing toggled: id=%s, enabled→disabled", agentID)
}

// TestAgent_UpdateSharing_NotFound verifies the error contract for a
// nonexistent resource id.
func TestAgent_UpdateSharing_NotFound(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: "agt-does-not-exist",
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.Error(t, err, "updateSharing on nonexistent agent should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"nonexistent agent should return NOT_FOUND, got %s", st.Code())
}

// TestAgent_GetSharedProfile covers the public resolution path's full error
// contract:
//   - shared agent resolves to the trimmed profile;
//   - unshared, revoked, and nonexistent agents are indistinguishable
//     (identical NOT_FOUND code and message);
//   - empty org is INVALID_ARGUMENT (no cross-org slug enumeration).
func TestAgent_GetSharedProfile(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-shared-profile",
		"You are a test agent for shared profile resolution verification.")
	agentID := agent.GetMetadata().GetId()
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	ref := &apiresource.ApiResourceReference{Org: org, Slug: slug}

	// 1. Unshared: NOT_FOUND, capturing the exact error for comparison below.
	_, err := clients.AgentQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile on unshared agent should fail")
	unsharedStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, unsharedStatus.Code(),
		"unshared agent must be NOT_FOUND (not PERMISSION_DENIED), got %s", unsharedStatus.Code())

	// 2. Shared: resolves to the trimmed profile.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agentID,
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err, "enabling sharing should succeed")

	profile, err := clients.AgentQuery.GetSharedProfile(ctx, ref)
	require.NoError(t, err, "getSharedProfile on shared agent should succeed")
	assert.Equal(t, org, profile.GetOrg(), "profile org")
	assert.Equal(t, slug, profile.GetSlug(), "profile slug")
	assert.Equal(t, agent.GetMetadata().GetName(), profile.GetName(), "profile name")
	assert.Equal(t, agent.GetSpec().GetDescription(), profile.GetDescription(), "profile description")
	assert.Equal(t, agent.GetStatus().GetDefaultInstanceId(), profile.GetDefaultInstanceId(),
		"profile must carry the default instance id for session creation")

	// The profile is a trimmed projection by type: SharedAgentProfile has no
	// instructions, env, or MCP fields to leak. Pin that contract so adding
	// such a field is a deliberate, reviewed act rather than drift.
	fields := profile.ProtoReflect().Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		name := string(fields.Get(i).Name())
		assert.NotContains(t,
			[]string{"instructions", "env", "mcp_server_usages", "sub_agents"}, name,
			"SharedAgentProfile must not carry blueprint internals; found field %q", name)
	}

	// 3. Revoked: NOT_FOUND again, identical to the unshared error.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agentID,
		Sharing:    &agentv1.AgentSharing{Enabled: false},
	})
	require.NoError(t, err, "revoking sharing should succeed")

	_, err = clients.AgentQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile after revoke should fail")
	revokedStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, revokedStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), revokedStatus.Message(),
		"revoked and unshared errors must be identical")

	// 4. Nonexistent (same slug, agent deleted): the error must be
	// byte-identical to the unshared case so the URL leaks nothing about
	// whether the agent exists.
	_, err = clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err, "delete should succeed")

	_, err = clients.AgentQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile on deleted agent should fail")
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, missingStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), missingStatus.Message(),
		"nonexistent and unshared errors must be indistinguishable")

	// 5. Empty org: INVALID_ARGUMENT, never a cross-org slug search.
	_, err = clients.AgentQuery.GetSharedProfile(ctx, &apiresource.ApiResourceReference{
		Org:  "",
		Slug: slug,
	})
	require.Error(t, err, "getSharedProfile with empty org should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"empty org should return INVALID_ARGUMENT, got %s", st.Code())
}

// TestAgent_Update_OmittingSharing_Revokes pins the declarative spec
// semantics: update/apply replace the whole spec, so a manifest that omits
// sharing revokes an active share (fails closed). This is intentional
// behavior, documented on AgentSharing in spec.proto — if this test breaks,
// either the semantics changed deliberately (update the proto docs) or a
// regression made spec updates preserve stale sharing state.
func TestAgent_Update_OmittingSharing_Revokes(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-sharing-omission",
		"You are a test agent for sharing omission-revoke verification.")
	agentID := agent.GetMetadata().GetId()

	_, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agentID,
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err, "enabling sharing should succeed")

	// Full-resource update whose spec omits sharing (as a YAML manifest
	// written before sharing existed would).
	withoutSharing := proto.Clone(agent).(*agentv1.Agent)
	withoutSharing.Spec.Sharing = nil

	updated, err := clients.AgentCommand.Update(ctx, withoutSharing)
	require.NoError(t, err, "full update omitting sharing should succeed")
	assert.False(t, updated.GetSpec().GetSharing().GetEnabled(),
		"an update omitting spec.sharing must revoke the share (fails closed)")

	ref := &apiresource.ApiResourceReference{
		Org:  agent.GetMetadata().GetOrg(),
		Slug: agent.GetMetadata().GetSlug(),
	}
	_, err = clients.AgentQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "shared link must stop working after the omitting update")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"revoked-by-omission agent should be NOT_FOUND at the shared link")
}
