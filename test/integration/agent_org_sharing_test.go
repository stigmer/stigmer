//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers T07 — org-internal authenticated sharing
// (spec.sharing.audience = org): a signed-in org member chats with a shared
// agent while anonymous guests are excluded, the agent stays private in the
// marketplace, and membership is re-checked on every conversation turn so a
// revoked member loses access immediately.

// createOrgAudienceAgent creates a PRIVATE agent and shares it with the org
// audience. Private visibility matters: agents default to visibility_org, and
// an org-visible agent resolves through the normal can_view path — only a
// private one exercises the T07 member fallback this suite exists to prove.
func createOrgAudienceAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *agentv1.Agent {
	t.Helper()

	agent := harness.CreateAgentFull(t, ctx, clients, name,
		"You are a test agent for org-internal sharing verification. Answer briefly.",
		nil,
		[]harness.AgentCreateOption{func(a *agentv1.Agent) {
			a.Metadata.Visibility = apiresource.ApiResourceVisibility_visibility_private
		}})

	updated, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing: &agentv1.AgentSharing{
			Enabled:  true,
			Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
		},
	})
	require.NoError(t, err, "enabling org-audience sharing should succeed")
	require.True(t, updated.GetSpec().GetSharing().GetEnabled())
	require.Equal(t, agentv1.AgentSharingAudience_agent_sharing_audience_org,
		updated.GetSpec().GetSharing().GetAudience(),
		"the audience must round-trip through updateSharing")
	return updated
}

// memberCreateSession creates a session as an authenticated actor against the
// shared agent. Unlike the guest path (where the backend forces the org from
// the token), an authenticated create carries the org explicitly — the hosted
// chat page sends the org from the share URL, and the server-side
// org-alignment invariant rejects anything else.
func memberCreateSession(ctx context.Context, actor *harness.Actor, agent *agentv1.Agent, subject string) (*sessionv1.Session, error) {
	return actor.Clients.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "member-session-" + subject,
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
			Subject:         subject,
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	})
}

// memberCreateExecution creates an execution (one conversation turn) as an
// authenticated actor in an existing session, carrying the sharing org.
func memberCreateExecution(ctx context.Context, actor *harness.Actor, agent *agentv1.Agent, sessionID, message string) (*agentexecv1.AgentExecution, error) {
	return actor.Clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "member-exec-" + message,
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			SessionId: sessionID,
			Message:   message,
		},
	})
}

// revokeMembership deletes the actor's member policy on TestOrg through the
// real IamPolicy pipeline, so the FGA tuple the live membership check reads
// is genuinely gone.
func revokeMembership(t *testing.T, ctx context.Context, owner *harness.Clients, accountID string) {
	t.Helper()
	_, err := owner.IamPolicyCommand.Delete(ctx, &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: accountID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: "organization", Id: harness.TestOrg},
		Relation:  "member",
	})
	require.NoError(t, err, "revoking org membership should succeed")
}

// TestOrgAudienceSharing_GuestPathsExcluded proves anonymous visitors can
// never touch an org-audience share: the guest mint and the public profile
// both refuse with a NOT_FOUND byte-identical to a nonexistent agent, and a
// guest token minted while the agent was public dies on its next create once
// the owner switches the audience (revocation parity with disabling sharing).
func TestOrgAudienceSharing_GuestPathsExcluded(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createOrgAudienceAgent(t, ctx, clients, "test-org-audience-guest-excluded")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	// Capture the canonical missing-agent error for indistinguishability.
	_, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, missingStatus.Code())

	// 1. Guest mint on the org-audience agent: NOT_FOUND, identical to missing.
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "guests must never mint on an org-audience agent")
	orgStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, orgStatus.Code())
	assert.Equal(t, missingStatus.Message(), orgStatus.Message(),
		"an org-audience share must be indistinguishable from a nonexistent agent at the mint endpoint")

	// 2. Anonymous getSharedProfile: NOT_FOUND too.
	_, err = clients.AgentQuery.GetSharedProfile(ctx, &apiresource.ApiResourceReference{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "the anonymous profile path must not resolve an org-audience share")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())

	// 3. Revocation parity: a guest token minted while the agent was PUBLIC
	// dies on its next create after the owner switches to the org audience.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: true}, // unspecified audience = public
	})
	require.NoError(t, err)

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())

	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing: &agentv1.AgentSharing{
			Enabled:  true,
			Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
		},
	})
	require.NoError(t, err)

	_, err = guestCreateSession(t, ctx, guest, agent, "after-audience-switch")
	require.Error(t, err,
		"a live guest token must stop working the moment the audience switches to org")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// TestOrgAudienceSharing_MemberProfileResolution covers the authenticated
// resolution path (getSharedProfileForMember): a member resolves the trimmed
// profile for org-audience AND public-audience shares (one path for any
// share), while a stranger's refusal is byte-identical to a missing agent.
func TestOrgAudienceSharing_MemberProfileResolution(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	member := actors.Member()
	stranger := actors.Stranger()

	agent := createOrgAudienceAgent(t, ctx, clients, "test-org-audience-profile")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()
	ref := &apiresource.ApiResourceReference{Org: org, Slug: slug}

	// 1. Member resolves the trimmed profile.
	profile, err := member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.NoError(t, err, "an org member must resolve an org-audience share")
	assert.Equal(t, org, profile.GetOrg())
	assert.Equal(t, slug, profile.GetSlug())
	assert.NotEmpty(t, profile.GetDefaultInstanceId(),
		"the profile must carry the default instance id the chat page pins")

	// 2. Stranger: NOT_FOUND, byte-identical to a missing agent.
	_, err = stranger.Clients.AgentQuery.GetSharedProfileForMember(ctx, &apiresource.ApiResourceReference{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, missingStatus.Code())

	_, err = stranger.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.Error(t, err, "a non-member must not resolve an org-audience share")
	strangerStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, strangerStatus.Code())
	assert.Equal(t, missingStatus.Message(), strangerStatus.Message(),
		"a non-member's refusal must not reveal that the agent exists")

	// 3. The same authenticated path resolves a public-audience share too.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err)
	_, err = member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.NoError(t, err,
		"getSharedProfileForMember must resolve public shares as well — one path for any share")

	// 4. Unshared: NOT_FOUND even for a member.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: false},
	})
	require.NoError(t, err)
	_, err = member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.Error(t, err, "an unshared agent must not resolve for anyone")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// TestOrgAudienceSharing_MemberChat is the headline T07 flow: a member of the
// owning org creates a session and conversation turns against a PRIVATE
// org-audience agent (blueprint hidden, marketplace-invisible), a stranger is
// denied, the org-alignment invariant rejects a mis-stamped org, and revoking
// membership ends access on the very next turn.
func TestOrgAudienceSharing_MemberChat(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	member := actors.Member()
	stranger := actors.Stranger()

	agent := createOrgAudienceAgent(t, ctx, clients, "test-org-audience-chat")

	// The agent is private: the member cannot read the blueprint even though
	// they can chat — sharing grants conversation, never the spec.
	member.RequireCannotView(t, ctx, "agent", agent.GetMetadata().GetId())

	// 1. Member creates a session against the shared agent's default instance.
	session, err := memberCreateSession(ctx, member, agent, "member-chat")
	require.NoError(t, err,
		"an org member must be able to start a conversation with an org-audience shared agent")
	require.Equal(t, agent.GetMetadata().GetOrg(), session.GetMetadata().GetOrg(),
		"the session must carry the sharing org — it drives billing and the runner's reads")
	sessionID := session.GetMetadata().GetId()

	// 2. Member sends a turn: execution create passes the per-turn gate.
	_, err = memberCreateExecution(ctx, member, agent, sessionID, "turn-one")
	require.NoError(t, err, "a member's conversation turn must pass the blueprint gate")

	// 3. Org-alignment invariant: a session stamped with another org the
	// member belongs to is rejected — it would bill the wrong org and strand
	// the run. (The stranger's own-org membership doesn't matter here; any
	// org != the agent's org must be refused.)
	_, err = member.Clients.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "member-misaligned-org",
			Org:  "some-other-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
			Subject:         "misaligned",
		},
	})
	require.Error(t, err, "a create stamped with a foreign org must be refused")

	// 4. Stranger cannot start a conversation at all.
	_, err = memberCreateSession(ctx, stranger, agent, "stranger-chat")
	require.Error(t, err, "a non-member must not chat with an org-audience share")
	require.True(t, isAccessDenied(err),
		"stranger denial must be PERMISSION_DENIED or NOT_FOUND, got: %v", err)

	// 5. Revocation: membership is checked live on EVERY turn, so revoking
	// it ends access on the next execution create — even in an existing
	// session the member owns. This is the guarantee public mode cannot give.
	revokeMembership(t, ctx, clients, member.AccountID)

	_, err = memberCreateExecution(ctx, member, agent, sessionID, "turn-after-revoke")
	require.Error(t, err,
		"a revoked member's next conversation turn must be refused (per-turn revocation)")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code(),
		"the revoked member gets the pre-T07 denial, not a special error")

	// New sessions are refused too.
	_, err = memberCreateSession(ctx, member, agent, "after-revoke")
	require.Error(t, err, "a revoked member must not start new conversations")
}
