//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// rotateShareLink rotates the agent's share link and returns the fresh token.
func rotateShareLink(t *testing.T, ctx context.Context, clients *harness.Clients, agentID string) string {
	t.Helper()
	rotated, err := clients.AgentCommand.RotateShareLink(ctx, &agentv1.RotateShareLinkInput{
		ResourceId: agentID,
	})
	require.NoError(t, err, "rotateShareLink should succeed for the owner")
	token := rotated.GetStatus().GetShareLinkToken()
	require.NotEmpty(t, token, "rotation must set status.share_link_token")
	return token
}

// TestShareLinkRotation_ProfileAndMintGate covers the full-gate contract of a
// locked link on both public endpoints: a wrong or absent token refuses with
// a NOT_FOUND byte-identical to a nonexistent agent (at getSharedProfile AND
// mintGuestToken), the correct token resolves and mints (with the link_token
// claim stamped into the guest JWT), and a stray token on a plain link stays
// harmless.
func TestShareLinkRotation_ProfileAndMintGate(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-rotation-gate")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	// Baseline refusals for a nonexistent agent, captured for the
	// byte-identical comparisons below.
	_, err := clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingProfileStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, missingProfileStatus.Code())

	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingMintStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, missingMintStatus.Code())

	// A stray ?k= on the still-plain link is harmless (absence-means-open).
	_, err = clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
		Org: org, Slug: slug, LinkToken: "stray-token",
	})
	require.NoError(t, err, "a stray token on a plain link must be ignored")

	token := rotateShareLink(t, ctx, clients, agent.GetMetadata().GetId())

	// 1. Profile gate: tokenless and wrong-token requests refuse with the
	// missing-agent error, verbatim.
	for name, presented := range map[string]string{"absent": "", "stale": "wrong-token"} {
		_, err = clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
			Org: org, Slug: slug, LinkToken: presented,
		})
		require.Error(t, err, "a locked link must not resolve with a %s token", name)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
		assert.Equal(t, missingProfileStatus.Message(), st.Message(),
			"a killed link (%s token) must be indistinguishable from a nonexistent agent", name)
	}

	profile, err := clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
		Org: org, Slug: slug, LinkToken: token,
	})
	require.NoError(t, err, "the correct token must resolve the locked link")
	assert.Equal(t, slug, profile.GetSlug())

	// 2. Mint gate: same contract at the guest mint.
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "a locked link must not mint without its token")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Equal(t, missingMintStatus.Message(), st.Message(),
		"the tokenless mint refusal must be indistinguishable from a nonexistent agent")

	minted, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug, LinkToken: token,
	})
	require.NoError(t, err, "the correct token must mint")
	claims := jwtClaims(t, minted.GetAccessToken())
	assert.Equal(t, token, claims["link_token"],
		"the validated token must be stamped into the guest JWT for the per-turn re-check")
}

// TestShareLinkRotation_LiveGuestKilledOnRotation is the headline behavior: a
// visitor chatting over the plain link is cut off on their next message the
// moment the owner resets the link — the same immediate-revocation latency as
// disabling sharing — while a visitor holding the NEW link keeps working.
func TestShareLinkRotation_LiveGuestKilledOnRotation(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-rotation-live-kill")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	// A guest arrives over the plain link and starts a conversation.
	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())
	_, err := guestCreateSession(t, ctx, guest, agent, "before-rotation")
	require.NoError(t, err, "the plain link must serve guests before rotation")

	// The owner resets the link.
	token := rotateShareLink(t, ctx, clients, agent.GetMetadata().GetId())

	// The live guest token (no link_token claim) dies on its next create.
	_, err = guestCreateSession(t, ctx, guest, agent, "after-rotation")
	require.Error(t, err,
		"a guest minted on the old link must be cut off on the next message after rotation")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())

	// A visitor holding the new link chats normally.
	freshMint, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug, LinkToken: token,
	})
	require.NoError(t, err)
	freshGuest := guestClients(t, freshMint.GetAccessToken())
	_, err = guestCreateSession(t, ctx, freshGuest, agent, "with-new-link")
	require.NoError(t, err, "the new link must serve fresh guests immediately")

	// Re-rotation kills the first token's guests the same way.
	rotateShareLink(t, ctx, clients, agent.GetMetadata().GetId())
	_, err = guestCreateSession(t, ctx, freshGuest, agent, "after-second-rotation")
	require.Error(t, err, "re-rotation must cut off guests holding the previous token")
}

// TestShareLinkRotation_ApplyPreservesToken pins the design's core guarantee:
// the token lives in server-owned status, so a full-resource update (what a
// manifest apply sends — no status) can never wipe it and silently fail open
// to the plain guessable URL.
func TestShareLinkRotation_ApplyPreservesToken(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-rotation-apply-preserves")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	token := rotateShareLink(t, ctx, clients, agent.GetMetadata().GetId())

	// A full-resource update as a manifest apply would send: no status,
	// sharing kept enabled.
	withoutStatus := proto.Clone(agent).(*agentv1.Agent)
	withoutStatus.Status = nil
	updated, err := clients.AgentCommand.Update(ctx, withoutStatus)
	require.NoError(t, err, "full update should succeed")
	assert.Equal(t, token, updated.GetStatus().GetShareLinkToken(),
		"a full update must preserve status.share_link_token verbatim")

	// The locked link keeps its posture: tokenless refused, tokened resolves.
	_, err = clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "the update must not fail the link open")
	_, err = clients.AgentQuery.GetSharedProfile(ctx, &agentv1.GetSharedProfileRequest{
		Org: org, Slug: slug, LinkToken: token,
	})
	require.NoError(t, err, "the token must keep resolving after the update")
}

// TestShareLinkRotation_MemberPathRefusesLockedPublic closes the one indirect
// read of a killed link: the tokenless getSharedProfileForMember must refuse
// a token-locked PUBLIC share (byte-identical to missing), while org-audience
// shares stay member-resolvable regardless of any token (their gate is live
// membership, not the link).
func TestShareLinkRotation_MemberPathRefusesLockedPublic(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	member := actors.Member()

	agent := createSharedAgent(t, ctx, clients, "test-rotation-member-path")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()
	ref := &apiresource.ApiResourceReference{Org: org, Slug: slug}

	// Baseline: a member resolves the plain public share through the
	// authenticated path (one path for any share).
	_, err := member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.NoError(t, err)

	_, err = member.Clients.AgentQuery.GetSharedProfileForMember(ctx, &apiresource.ApiResourceReference{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)

	rotateShareLink(t, ctx, clients, agent.GetMetadata().GetId())

	// Locked public share: refused on this tokenless path, indistinguishable
	// from missing — even for an owning-org member.
	_, err = member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.Error(t, err,
		"the tokenless member path must not reveal a token-locked public share")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Equal(t, missingStatus.Message(), st.Message())

	// Flipping to the org audience re-opens the member path: org access is
	// gated by membership, and the lingering token is not consulted.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing: &agentv1.AgentSharing{
			Enabled:  true,
			Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
		},
	})
	require.NoError(t, err)
	_, err = member.Clients.AgentQuery.GetSharedProfileForMember(ctx, ref)
	require.NoError(t, err,
		"an org-audience share must stay member-resolvable regardless of the link token")
}
