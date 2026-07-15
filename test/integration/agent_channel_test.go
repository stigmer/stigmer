//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers the AgentChannel resource's core lifecycle against the
// cloud backend (this suite boots the stigmer-service fat JAR — see
// suite_test.go): apply-as-upsert, the config-preserving pause, the
// same-org invariant refusal, and the install surface's pre-T03 posture.
// The contracts asserted here are the shared ones (status codes, upsert
// semantics, status preservation); edition-specific refusal copy is pinned
// in each edition's own controller tests (the OSS §0-b message lives in
// the Go controller suite beside pkg/domain/agentchannel).

// channelFor builds a Slack channel manifest for an agent, as a YAML apply
// would send it. Channels have no canonical-slug default (they are
// N-per-agent), so a name is always provided.
func channelFor(agent *agentv1.Agent, name string, enabled bool) *agentchannelv1.AgentChannel {
	return &agentchannelv1.AgentChannel{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentChannel",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &agentchannelv1.AgentChannelSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Slug: agent.GetMetadata().GetSlug(),
			},
			Enabled: enabled,
			ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
				Slack: &agentchannelv1.SlackChannelConfig{},
			},
		},
	}
}

// TestAgentChannel_ApplyToggle verifies the declarative lifecycle: apply
// creates the channel (pending_install initialized server-side), a second
// apply updates it in place (no duplicate, status preserved), and
// disabling is a config-preserving pause that round-trips through
// getByAgent.
func TestAgentChannel_ApplyToggle(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-channel-toggle",
		"You are a test agent for channel toggle verification.")

	name := "toggle-slack-" + agent.GetMetadata().GetSlug()
	created, err := clients.AgentChannelCommand.Apply(ctx, channelFor(agent, name, true))
	require.NoError(t, err, "agentChannel apply should succeed")
	assert.True(t, created.GetSpec().GetEnabled(), "channel should be enabled after apply")
	assert.Equal(t, agent.GetMetadata().GetOrg(), created.GetSpec().GetAgentRef().GetOrg(),
		"agent_ref.org must be normalized to the channel org")
	assert.Equal(t, agentchannelv1.AgentChannelInstallState_pending_install,
		created.GetStatus().GetInstallState(),
		"a new channel must initialize status.install_state = pending_install")

	// Re-apply: updates in place, never forks a second channel, and the
	// server-owned status survives the manifest's absence of one.
	updated, err := clients.AgentChannelCommand.Apply(ctx, channelFor(agent, name, true))
	require.NoError(t, err)
	assert.Equal(t, created.GetMetadata().GetId(), updated.GetMetadata().GetId(),
		"apply must upsert the existing channel, not create a duplicate")
	assert.Equal(t, agentchannelv1.AgentChannelInstallState_pending_install,
		updated.GetStatus().GetInstallState(),
		"apply-as-update must preserve status verbatim")

	// Pause: enabled=false is a config-preserving pause.
	paused, err := clients.AgentChannelCommand.Apply(ctx, channelFor(agent, name, false))
	require.NoError(t, err)
	assert.False(t, paused.GetSpec().GetEnabled(), "channel should be disabled after pause")

	// getByAgent reflects the pause (the integrations-surface read path).
	list, err := clients.AgentChannelQuery.GetByAgent(ctx, &agentchannelv1.GetAgentChannelsByAgentRequest{
		AgentId: agent.GetMetadata().GetId(),
	})
	require.NoError(t, err, "getByAgent should succeed")
	require.Equal(t, int32(1), list.GetTotalCount(), "the agent must have exactly one channel")
	assert.False(t, list.GetItems()[0].GetSpec().GetEnabled(), "getByAgent should reflect the pause")

	t.Logf("channel toggled: id=%s, enabled→disabled", created.GetMetadata().GetId())
}

// TestAgentChannel_InvariantRefusals verifies the two create-time error
// contracts over the wire: a nonexistent agent is NOT_FOUND, and a
// cross-org agent_ref is FAILED_PRECONDITION (channels have no cross-org
// arm — the channel's org is the billing and credentials org).
func TestAgentChannel_InvariantRefusals(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-channel-invariants",
		"You are a test agent for channel invariant verification.")

	ghost := channelFor(agent, "ghost-channel", true)
	ghost.Spec.AgentRef.Slug = "agent-does-not-exist"
	_, err := clients.AgentChannelCommand.Apply(ctx, ghost)
	require.Error(t, err, "channel apply for a nonexistent agent should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"nonexistent agent should return NOT_FOUND, got %s", st.Code())

	crossOrg := channelFor(agent, "cross-org-channel", true)
	crossOrg.Spec.AgentRef.Org = "some-other-org"
	_, err = clients.AgentChannelCommand.Apply(ctx, crossOrg)
	require.Error(t, err, "cross-org channel apply should fail")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"cross-org agent_ref should return FAILED_PRECONDITION, got %s", st.Code())
}

// TestAgentChannel_InstallPosture pins the install surface's shared error
// contract over the wire: a nonexistent channel is NOT_FOUND, and an
// install that cannot proceed is FAILED_PRECONDITION with the channel left
// untouched. Pre-T03 the cloud refuses because no Slack installer is
// registered ("not available for provider"); the OSS edition refuses
// permanently (§0-b). When T03 lands SlackChannelInstaller, the
// existing-channel branch here changes from a refusal to a real authorize
// URL — update this test alongside that registration.
func TestAgentChannel_InstallPosture(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-channel-install",
		"You are a test agent for channel install posture verification.")
	created, err := clients.AgentChannelCommand.Apply(ctx,
		channelFor(agent, "install-slack-"+agent.GetMetadata().GetSlug(), true))
	require.NoError(t, err)

	_, err = clients.AgentChannelCommand.InitiateInstall(ctx, &agentchannelv1.InitiateChannelInstallInput{
		ResourceId: created.GetMetadata().GetId(),
	})
	require.Error(t, err, "initiateInstall must refuse while no installer serves the provider")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"an unavailable install must be FAILED_PRECONDITION, got %s", st.Code())

	_, err = clients.AgentChannelCommand.InitiateInstall(ctx, &agentchannelv1.InitiateChannelInstallInput{
		ResourceId: "ach_does_not_exist",
	})
	require.Error(t, err)
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"a nonexistent channel must be NOT_FOUND before the posture refusal, got %s", st.Code())

	// The refused install leaves the channel untouched and still readable.
	fetched, err := clients.AgentChannelQuery.Get(ctx, &agentchannelv1.AgentChannelId{
		Value: created.GetMetadata().GetId(),
	})
	require.NoError(t, err)
	assert.Equal(t, agentchannelv1.AgentChannelInstallState_pending_install,
		fetched.GetStatus().GetInstallState(),
		"a refused install must leave install_state untouched")
}
