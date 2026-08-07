//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers the AgentShare resource's core lifecycle against the
// cloud backend: apply-as-upsert, the config-preserving pause, the public
// profile's NOT_FOUND indistinguishability contract, and the two headline
// DD-011 guarantees — an agent manifest update can never touch its share,
// and the share's own declarative sharp edge (omitted audience resets to
// public) lives on the share.

// TestAgentShare_ApplyToggle verifies the canonical enable/pause flow:
// apply creates the share (slug defaulted from the agent), a second apply
// updates it in place (no duplicate), and disabling is a config-preserving
// pause that round-trips through getByAgent.
func TestAgentShare_ApplyToggle(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-share-toggle",
		"You are a test agent for share toggle verification.")

	created := applyShare(t, ctx, clients, shareFor(agent, true))
	assert.True(t, created.GetSpec().GetEnabled(), "share should be enabled after apply")
	assert.Equal(t, agent.GetMetadata().GetSlug(), created.GetMetadata().GetSlug(),
		"the canonical share's slug must default to the agent's slug")
	assert.Equal(t, agent.GetMetadata().GetOrg(), created.GetSpec().GetAgentRef().GetOrg(),
		"agent_ref.org must be normalized to the share org")

	// Re-apply with config: updates in place, never forks a second share.
	withOrigins := shareFor(agent, true)
	withOrigins.Spec.AllowedOrigins = []string{"https://docs.example.com"}
	updated := applyShare(t, ctx, clients, withOrigins)
	assert.Equal(t, created.GetMetadata().GetId(), updated.GetMetadata().GetId(),
		"apply must upsert the existing share, not create a duplicate")

	// Pause: enabled=false preserves the rest of the config.
	pause := shareFor(agent, false)
	pause.Spec.AllowedOrigins = []string{"https://docs.example.com"}
	paused := applyShare(t, ctx, clients, pause)
	assert.False(t, paused.GetSpec().GetEnabled(), "share should be disabled after pause")

	fetched := canonicalShare(t, ctx, clients, agent)
	assert.False(t, fetched.GetSpec().GetEnabled(), "getByAgent should reflect the pause")
	assert.Equal(t, []string{"https://docs.example.com"}, fetched.GetSpec().GetAllowedOrigins(),
		"pausing must preserve the share's configuration")

	t.Logf("share toggled: id=%s, enabled→disabled", created.GetMetadata().GetId())
}

// TestAgentShare_NonexistentAgent verifies the error contract for a share
// referencing an agent that does not exist.
func TestAgentShare_NonexistentAgent(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-share-not-found",
		"You are a test agent for share not-found verification.")
	share := shareFor(agent, true)
	share.Spec.AgentRef.Slug = "agent-does-not-exist"

	_, err := clients.AgentShareCommand.Apply(ctx, share)
	require.Error(t, err, "share apply for a nonexistent agent should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"nonexistent agent should return NOT_FOUND, got %s", st.Code())
}

// TestAgentShare_GetSharedProfile covers the public resolution path's full
// error contract:
//   - a shared agent resolves to the trimmed profile;
//   - no-share, paused, and deleted-agent (dangling agent_ref) states are
//     indistinguishable (identical NOT_FOUND code and message);
//   - empty org is INVALID_ARGUMENT (no cross-org slug enumeration).
func TestAgentShare_GetSharedProfile(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-shared-profile",
		"You are a test agent for shared profile resolution verification.")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	ref := &agentsharev1.GetSharedProfileRequest{Org: org, Slug: slug}

	// 1. No share: NOT_FOUND, capturing the exact error for comparison below.
	_, err := clients.AgentShareQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile without a share should fail")
	unsharedStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, unsharedStatus.Code(),
		"no-share must be NOT_FOUND (not PERMISSION_DENIED), got %s", unsharedStatus.Code())

	// 2. Shared: resolves to the trimmed profile. Org/slug come from the
	// SHARE (the URL identity); display fields from the referenced AGENT.
	applyShare(t, ctx, clients, shareFor(agent, true))

	profile, err := clients.AgentShareQuery.GetSharedProfile(ctx, ref)
	require.NoError(t, err, "getSharedProfile on a shared agent should succeed")
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

	// 3. Paused: NOT_FOUND again, identical to the no-share error.
	applyShare(t, ctx, clients, shareFor(agent, false))

	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile after pause should fail")
	revokedStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, revokedStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), revokedStatus.Message(),
		"paused and no-share errors must be identical")

	// 4. Deleted agent (dangling agent_ref): the share still exists but
	// must fail closed with an error byte-identical to the no-share case,
	// so the URL leaks nothing about whether the agent ever existed.
	applyShare(t, ctx, clients, shareFor(agent, true))
	_, err = clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.NoError(t, err, "agent delete should succeed")

	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, ref)
	require.Error(t, err, "getSharedProfile with a dangling agent_ref should fail")
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, missingStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), missingStatus.Message(),
		"dangling-ref and no-share errors must be indistinguishable")

	// 5. Empty org: INVALID_ARGUMENT, never a cross-org slug search.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org:  "",
		Slug: slug,
	})
	require.Error(t, err, "getSharedProfile with empty org should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"empty org should return INVALID_ARGUMENT, got %s", st.Code())
}

// TestAgentShare_AgentManifestUpdateDoesNotTouchShare pins the headline
// DD-011 guarantee: sharing is a separate channel resource, so applying or
// updating the AGENT manifest can never revoke, reset, or otherwise affect
// its share. Pre-promotion, a manifest omitting spec.sharing silently
// revoked the share — that bug class is now structurally gone.
func TestAgentShare_AgentManifestUpdateDoesNotTouchShare(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-share-agent-isolation",
		"You are a test agent for share isolation verification.")
	share := shareFor(agent, true)
	share.Spec.AllowedOrigins = []string{"https://docs.example.com"}
	applyShare(t, ctx, clients, share)

	// A full agent update, as a YAML manifest apply would send it — the
	// exact operation that used to wipe spec.sharing.
	fetched, err := clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.NoError(t, err)
	fetched.Spec.Description = "Updated by manifest"
	fetched.Status = nil
	_, err = clients.AgentCommand.Update(ctx, fetched)
	require.NoError(t, err, "full agent update should succeed")

	// The share survives with its full config, and the public link still
	// resolves — reflecting the updated agent.
	surviving := canonicalShare(t, ctx, clients, agent)
	assert.True(t, surviving.GetSpec().GetEnabled(),
		"an agent manifest update must never disable the share")
	assert.Equal(t, []string{"https://docs.example.com"}, surviving.GetSpec().GetAllowedOrigins(),
		"an agent manifest update must never reset share config")

	profile, err := clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org:  agent.GetMetadata().GetOrg(),
		Slug: agent.GetMetadata().GetSlug(),
	})
	require.NoError(t, err, "the shared link must keep resolving across agent updates")
	assert.Equal(t, "Updated by manifest", profile.GetDescription(),
		"the profile should reflect the updated agent description")
}

// TestAgentShare_ApplyOmittingAudienceResetsToPublic pins the share's own
// declarative sharp edge (documented on AgentShareSpec and in the sharing
// how-to): apply replaces the spec wholesale, so a manifest that omits
// audience resets an org-audience share to public. If this breaks, either
// the semantics changed deliberately (update the proto docs and the how-to)
// or apply stopped replacing the spec.
func TestAgentShare_ApplyOmittingAudienceResetsToPublic(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-share-audience-omission",
		"You are a test agent for audience omission verification.")

	orgShare := shareFor(agent, true)
	orgShare.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
	applied := applyShare(t, ctx, clients, orgShare)
	require.Equal(t, agentsharev1.AgentShareAudience_agent_share_audience_org,
		applied.GetSpec().GetAudience(), "org audience must round-trip through apply")

	// A manifest written without the audience field (as one predating the
	// org audience would be).
	reset := applyShare(t, ctx, clients, shareFor(agent, true))
	assert.Equal(t, agentsharev1.AgentShareAudience_agent_share_audience_unspecified,
		reset.GetSpec().GetAudience(),
		"an apply omitting audience must reset the share to public (unspecified = public)")

	// The reset is live: the anonymous public path resolves again.
	_, err := clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org:  agent.GetMetadata().GetOrg(),
		Slug: agent.GetMetadata().GetSlug(),
	})
	assert.NoError(t, err,
		"after the audience reset, the share must be publicly resolvable again")
}

// TestAgentShare_RunConfigRejectedOnOrgAudience pins the proto CEL rule
// added with run_config (stigmer/stigmer#360): an org-audience share must
// refuse the field at write time, because member sessions carry no share
// linkage — a stored run_config there would silently never apply, the exact
// anti-pattern the shared RunConfig exists to end. Mirrors the
// environment_refs rule for the same reason.
func TestAgentShare_RunConfigRejectedOnOrgAudience(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-share-run-config-audience",
		"You are a test agent for run_config audience verification.")

	// Public audience (the default): run_config is accepted and round-trips.
	withRunConfig := shareFor(agent, true)
	withRunConfig.Spec.RunConfig = &agentexecv1.RunConfig{
		ModelName:  "gpt-5-mini",
		MaxCostUsd: 0.25,
	}
	applied := applyShare(t, ctx, clients, withRunConfig)
	assert.Equal(t, "gpt-5-mini", applied.GetSpec().GetRunConfig().GetModelName(),
		"a public-audience share's run_config must round-trip through apply")

	// Org audience: the same field is refused at the write boundary.
	orgShare := shareFor(agent, true)
	orgShare.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
	orgShare.Spec.RunConfig = &agentexecv1.RunConfig{ModelName: "gpt-5-mini"}
	_, err := clients.AgentShareCommand.Apply(ctx, orgShare)
	require.Error(t, err, "run_config on an org-audience share must be refused at write time")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"the CEL refusal must surface as INVALID_ARGUMENT, got %s", st.Code())
	assert.True(t, strings.Contains(st.Message(), "run_config can only be set on public-audience shares"),
		"the refusal must name the rule; got: %s", st.Message())
}
