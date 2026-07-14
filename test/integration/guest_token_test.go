//go:build integration

package integration

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// guestCookieLabel is the metadata label the backend stamps on guest-created
// records; it is the key the per-visitor isolation filter matches on.
const guestCookieLabel = "stigmer.ai/guest-cookie-id"

// requireGuestPrereqs skips when FGA is not enabled: the guest runtime's
// entire containment story (guest relation, permission ceiling, blueprint
// gate) is FGA-backed, so without it the denial assertions are meaningless.
func requireGuestPrereqs(t *testing.T) {
	t.Helper()
	if testHarness == nil || !testHarness.FGAEnabled() {
		t.Skip("FGA not enabled — skipping guest token test")
	}
	require.NotNil(t, grpcConn)
}

// shareFor builds the minimal canonical AgentShare for an agent: no slug, no
// name — both default from the referenced agent, so the share resolves at
// the agent's own org/slug URL. Mirrors the OSS domain test's helper of the
// same name; callers set config fields (origins, messages, audience,
// environment_refs) directly on the returned spec before applying.
func shareFor(agent *agentv1.Agent, enabled bool) *agentsharev1.AgentShare {
	return &agentsharev1.AgentShare{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentShare",
		Metadata: &apiresource.ApiResourceMetadata{
			Org: agent.GetMetadata().GetOrg(),
		},
		Spec: &agentsharev1.AgentShareSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Slug: agent.GetMetadata().GetSlug(),
			},
			Enabled: enabled,
		},
	}
}

// applyShare upserts an AgentShare. Apply is the canonical commit path
// (idempotent by (org, slug), preserves server-owned status), matching how
// the console and CLI persist share config.
func applyShare(t *testing.T, ctx context.Context, clients *harness.Clients, share *agentsharev1.AgentShare) *agentsharev1.AgentShare {
	t.Helper()
	applied, err := clients.AgentShareCommand.Apply(ctx, share)
	require.NoError(t, err, "agentShare apply should succeed")
	return applied
}

// canonicalShare resolves the agent's canonical share: slug-match-else-first,
// the same selection rule the CLI uses (share.ts; the console's Shares tab
// lists all shares instead of picking one). Rotation and share updates need
// this because callers hold the agent id, not the share id — the same reason
// production added getByAgent.
func canonicalShare(t *testing.T, ctx context.Context, clients *harness.Clients, agent *agentv1.Agent) *agentsharev1.AgentShare {
	t.Helper()
	list, err := clients.AgentShareQuery.GetByAgent(ctx, &agentsharev1.GetAgentSharesByAgentRequest{
		AgentId: agent.GetMetadata().GetId(),
	})
	require.NoError(t, err, "getByAgent should succeed")
	require.NotEmpty(t, list.GetItems(), "agent %s must have at least one share", agent.GetMetadata().GetSlug())
	for _, item := range list.GetItems() {
		if item.GetMetadata().GetSlug() == agent.GetMetadata().GetSlug() {
			return item
		}
	}
	return list.GetItems()[0]
}

// createSharedAgent creates an agent in the test org and enables sharing by
// applying the canonical AgentShare (public audience). Returns the agent —
// callers need its metadata and default instance id; the share is
// resolvable via canonicalShare when needed.
func createSharedAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *agentv1.Agent {
	t.Helper()

	agent := harness.CreateAgent(t, ctx, clients, name,
		"You are a test agent for guest token verification. Answer briefly.")

	applied := applyShare(t, ctx, clients, shareFor(agent, true))
	require.True(t, applied.GetSpec().GetEnabled())
	return agent
}

// mintGuestToken mints a guest token for the given shared agent reference.
func mintGuestToken(t *testing.T, ctx context.Context, clients *harness.Clients, org, slug, cookieID string) *platformclientv1.MintGuestTokenResponse {
	t.Helper()

	resp, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org:           org,
		Slug:          slug,
		GuestCookieId: cookieID,
	})
	require.NoError(t, err, "mintGuestToken should succeed for a shared agent")
	require.NotEmpty(t, resp.GetAccessToken())
	require.Equal(t, "Bearer", resp.GetTokenType())
	require.Greater(t, resp.GetExpiresIn(), int32(0))
	require.NotEmpty(t, resp.GetGuestCookieId(),
		"the visitor cookie id must always be returned (echoed or generated)")
	return resp
}

// guestClients opens a gRPC connection authenticated with the guest token.
func guestClients(t *testing.T, token string) *harness.Clients {
	t.Helper()
	conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	return harness.NewClients(conn)
}

// requireIndistinguishableRefusals asserts two public NOT_FOUND refusals are
// byte-identical modulo the caller-echoed slug. The refusal message embeds
// the REQUESTED slug ("Agent not found: <slug>" — the caller already knows
// it, so echoing leaks nothing), which means refusals for different URLs
// compare equal only after normalizing that echo. Same-URL comparisons
// should stay raw byte-identical instead of using this helper.
func requireIndistinguishableRefusals(t *testing.T, why string, a *status.Status, aSlug string, b *status.Status, bSlug string) {
	t.Helper()
	require.Equal(t, codes.NotFound, a.Code(), why)
	require.Equal(t, codes.NotFound, b.Code(), why)
	assert.Equal(t,
		strings.ReplaceAll(a.Message(), aSlug, "<slug>"),
		strings.ReplaceAll(b.Message(), bSlug, "<slug>"),
		"%s: refusals must be identical modulo the echoed slug", why)
}

// jwtClaims decodes the (unverified) claims of a JWT for assertions.
func jwtClaims(t *testing.T, token string) map[string]any {
	t.Helper()
	parts := strings.Split(token, ".")
	require.Len(t, parts, 3, "JWT must have three segments")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err)
	var claims map[string]any
	require.NoError(t, json.Unmarshal(payload, &claims))
	return claims
}

// guestCreateSession creates a session as the guest against the shared
// agent's default instance. Deliberately leaves metadata.org empty: the
// backend must force it from the guest token.
func guestCreateSession(t *testing.T, ctx context.Context, guest *harness.Clients, agent *agentv1.Agent, subject string) (*sessionv1.Session, error) {
	t.Helper()
	return guest.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "guest-session-" + subject,
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
			Subject:         subject,
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	})
}

// TestGuestToken_SharingGate covers the public mint endpoint's error
// contract: unshared and nonexistent agents are indistinguishable
// (byte-identical NOT_FOUND, matching getSharedProfile), empty org/slug is
// INVALID_ARGUMENT, and revoking sharing stops minting (fail closed).
func TestGuestToken_SharingGate(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-guest-gate",
		"You are a test agent for guest sharing gate verification.")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	// 1. Unshared: NOT_FOUND.
	_, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "mint against unshared agent must fail")
	unsharedStatus, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, unsharedStatus.Code())

	// 2. Nonexistent: indistinguishable from unshared (modulo the slug the
	// caller itself sent, which the refusal echoes).
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	requireIndistinguishableRefusals(t,
		"unshared and nonexistent agents must be indistinguishable at the mint endpoint",
		unsharedStatus, slug, missingStatus, "does-not-exist")

	// 3. Empty org: INVALID_ARGUMENT (no cross-org slug enumeration).
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Slug: slug,
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())

	// 4. Shared: mints; the guest JWT carries the org scope and cookie id.
	applyShare(t, ctx, clients, shareFor(agent, true))

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	claims := jwtClaims(t, minted.GetAccessToken())
	assert.Equal(t, "guest", claims["token_type"], "token_type claim")
	assert.Equal(t, org, claims["org"], "org claim must be the shared agent's org")
	assert.Equal(t, minted.GetGuestCookieId(), claims["guest_cookie_id"],
		"cookie id must be embedded in the token")
	assert.NotEmpty(t, claims["sub"], "sub must be the org guest account id")
	assert.NotEmpty(t, claims["platform_client_id"], "system-managed client id must be present")

	// 5. Cookie echo: a supplied cookie id round-trips unchanged.
	echoed := mintGuestToken(t, ctx, clients, org, slug, minted.GetGuestCookieId())
	assert.Equal(t, minted.GetGuestCookieId(), echoed.GetGuestCookieId())

	// 6. Revoke (config-preserving pause): minting stops immediately (fail closed).
	applyShare(t, ctx, clients, shareFor(agent, false))

	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: slug,
	})
	require.Error(t, err, "mint after revoke must fail")
	revokedStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, revokedStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), revokedStatus.Message())
}

// TestGuestToken_BoundedCardinality is the headline invariant of the per-org
// guest model: N mints across M "visitors" (including concurrent first-mints)
// resolve to exactly ONE guest identity account — every minted JWT carries
// the same sub.
func TestGuestToken_BoundedCardinality(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-cardinality")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	const visitors = 8
	subs := make([]string, visitors)
	var wg sync.WaitGroup
	for i := 0; i < visitors; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
				Org: org, Slug: slug,
			})
			if err != nil {
				t.Errorf("concurrent mint %d failed: %v", i, err)
				return
			}
			parts := strings.Split(resp.GetAccessToken(), ".")
			payload, err := base64.RawURLEncoding.DecodeString(parts[1])
			if err != nil {
				t.Errorf("decode mint %d: %v", i, err)
				return
			}
			var claims map[string]any
			if err := json.Unmarshal(payload, &claims); err != nil {
				t.Errorf("unmarshal mint %d: %v", i, err)
				return
			}
			subs[i], _ = claims["sub"].(string)
		}(i)
	}
	wg.Wait()

	require.NotEmpty(t, subs[0])
	for i := 1; i < visitors; i++ {
		assert.Equal(t, subs[0], subs[i],
			"every visitor must resolve to the SAME per-org guest account (bounded cardinality)")
	}
}

// TestGuestToken_SessionCreate_OrgForcing verifies a guest can create a
// session against the shared agent, that metadata.org is forced from the
// token (never the request), and that the visitor cookie id is stamped.
func TestGuestToken_SessionCreate_OrgForcing(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-session")
	org := agent.GetMetadata().GetOrg()

	minted := mintGuestToken(t, ctx, clients, org, agent.GetMetadata().GetSlug(), "")
	guest := guestClients(t, minted.GetAccessToken())

	// Empty request org: forced to the token org, cookie label stamped.
	created, err := guestCreateSession(t, ctx, guest, agent, "org-forcing")
	require.NoError(t, err, "guest session create against a shared agent should succeed")
	assert.Equal(t, org, created.GetMetadata().GetOrg(),
		"metadata.org must be forced from the guest token — billing must never be skipped")
	assert.Equal(t, minted.GetGuestCookieId(),
		created.GetMetadata().GetLabels()[guestCookieLabel],
		"the visitor cookie id must be stamped for read isolation")

	// Foreign request org: NOT_FOUND (indistinguishable, never created).
	_, err = guest.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "guest-cross-org",
			Org:  "some-other-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
			Subject:         "cross-org attempt",
		},
	})
	require.Error(t, err, "guest must not create a session in another org")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// TestGuestToken_ReadIsolation is the cross-visitor leak defense: all
// visitors share one FGA principal, so only the app-level cookie filter
// separates them. Visitor B must not be able to read, list, or continue
// visitor A's session — and the denial must be NOT_FOUND, never revealing
// that the session exists.
func TestGuestToken_ReadIsolation(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-isolation")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	mintA := mintGuestToken(t, ctx, clients, org, slug, "")
	mintB := mintGuestToken(t, ctx, clients, org, slug, "")
	require.NotEqual(t, mintA.GetGuestCookieId(), mintB.GetGuestCookieId(),
		"distinct visitors must receive distinct cookie ids")

	guestA := guestClients(t, mintA.GetAccessToken())
	guestB := guestClients(t, mintB.GetAccessToken())

	sessionA, err := guestCreateSession(t, ctx, guestA, agent, "visitor-a")
	require.NoError(t, err)
	sessionAID := sessionA.GetMetadata().GetId()

	// A reads its own session.
	got, err := guestA.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionAID})
	require.NoError(t, err, "a visitor must be able to read their own session")
	assert.Equal(t, sessionAID, got.GetMetadata().GetId())

	// B cannot get A's session — NOT_FOUND, not PERMISSION_DENIED.
	_, err = guestB.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionAID})
	require.Error(t, err, "visitor B must not read visitor A's session")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"cross-visitor denial must be NOT_FOUND (existence must not leak), got %s", st.Code())

	// B does not see A's session in list.
	listB, err := guestB.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{PageSize: 100})
	require.NoError(t, err)
	for _, s := range listB.GetEntries() {
		assert.NotEqual(t, sessionAID, s.GetMetadata().GetId(),
			"visitor A's session leaked into visitor B's list")
	}

	// B does not see A's session in listByAgentInstance.
	listByInstance, err := guestB.SessionQuery.ListByAgentInstance(ctx, &sessionv1.ListSessionsByAgentInstanceRequest{
		AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
	})
	require.NoError(t, err)
	for _, s := range listByInstance.GetEntries() {
		assert.NotEqual(t, sessionAID, s.GetMetadata().GetId(),
			"visitor A's session leaked into visitor B's listByAgentInstance")
	}

	// A sees its own session in list.
	listA, err := guestA.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{PageSize: 100})
	require.NoError(t, err)
	foundOwn := false
	for _, s := range listA.GetEntries() {
		if s.GetMetadata().GetId() == sessionAID {
			foundOwn = true
		}
	}
	assert.True(t, foundOwn, "visitor A must see their own session in list")

	// Continue isolation: B cannot create an execution in A's session.
	_, err = guestB.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "guest-b-hijack",
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			SessionId: sessionAID,
			Message:   "hijack attempt",
		},
	})
	require.Error(t, err, "visitor B must not continue visitor A's session")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"continue denial must be NOT_FOUND (existence must not leak), got %s", st.Code())
}

// TestGuestToken_Denials verifies the guest relation grants nothing beyond
// session/execution creation: blueprint reads, agent listing, and
// impersonation are all denied, and revoking sharing stops new guest
// sessions (fail closed).
func TestGuestToken_Denials(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-denials")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())

	// Blueprint read denied: the guest holds no can_view on the agent.
	_, err := guest.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.Error(t, err, "a guest must not read the full agent blueprint")

	// Cross-agent gate: an unshared agent in the same org is not runnable.
	unshared := harness.CreateAgent(t, ctx, clients, "test-guest-unshared-target",
		"You are a private agent that must be unreachable by guests.")
	_, err = guest.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "guest-unshared-attempt"},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: unshared.GetStatus().GetDefaultInstanceId(),
			Subject:         "unshared attempt",
		},
	})
	require.Error(t, err, "a guest must not create a session against an unshared agent")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"unshared agent must be indistinguishable from nonexistent, got %s", st.Code())

	// Revoke stops guests: disable the share, then session create fails closed.
	applyShare(t, ctx, clients, shareFor(agent, false))

	_, err = guestCreateSession(t, ctx, guest, agent, "after-revoke")
	require.Error(t, err, "an existing guest token must stop working once sharing is revoked")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// guestCreateExecution creates an execution as the guest in an existing
// session. Deliberately leaves metadata.org empty: the backend forces it.
func guestCreateExecution(ctx context.Context, guest *harness.Clients, sessionID, message string) (*agentexecv1.AgentExecution, error) {
	return guest.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "guest-exec-" + message,
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			SessionId: sessionID,
			Message:   message,
		},
	})
}

// Platform-default refusal copy — mirrors GuestLimitReason in the cloud
// stigmer-service. These tests pin the wire contract: the copy travels in
// the gRPC status description and the SDK renders it verbatim.
const (
	defaultRateLimitedCopy       = "You\u2019re sending messages too quickly. Please wait a moment before sending another."
	defaultConversationEndedCopy = "This conversation has ended. Please start a new conversation to continue."
	// Deliberately not owner-customizable: the widget hides on this refusal
	// rather than rendering copy (T04).
	defaultOriginRefusedCopy = "This agent can\u2019t be embedded on this site."
	// Default UNAVAILABLE copy (GuestLimitReason.UNAVAILABLE): what a guest
	// sees when the agent cannot run — including MCP env validation failures,
	// whose owner-facing diagnostic must never reach an anonymous visitor.
	defaultUnavailableCopy = "This agent is currently unavailable. Please check back later."
)

// TestGuestToken_LaunchGate_SessionRateLimit trips the per-guest
// new-conversation rate limit (5/min by default): the same cookie creating a
// sixth session inside the window is refused RESOURCE_EXHAUSTED with the
// platform-default rate-limit copy on the wire. A second visitor (fresh
// cookie) is unaffected — the bucket isolates per visitor.
func TestGuestToken_LaunchGate_SessionRateLimit(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-session-rate")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())

	// The default window allows 5 sessions per cookie; the 6th must trip.
	var refusal error
	for i := 0; i < 6; i++ {
		_, err := guestCreateSession(t, ctx, guest, agent, "rate-"+string(rune('a'+i)))
		if err != nil {
			refusal = err
			require.Equal(t, 5, i, "the rate limit must trip on the 6th create, not earlier")
			break
		}
	}
	require.Error(t, refusal, "the 6th session create inside the window must be rate limited")
	st, ok := status.FromError(refusal)
	require.True(t, ok)
	assert.Equal(t, codes.ResourceExhausted, st.Code(),
		"rate-limit refusals are RESOURCE_EXHAUSTED (retryable-by-waiting)")
	assert.Equal(t, defaultRateLimitedCopy, st.Message(),
		"the wire-visible message must be the platform-default rate-limit copy, verbatim")

	// A different visitor (fresh cookie) is not collateral damage.
	otherMinted := mintGuestToken(t, ctx, clients, org, slug, "")
	otherGuest := guestClients(t, otherMinted.GetAccessToken())
	_, err := guestCreateSession(t, ctx, otherGuest, agent, "other-visitor")
	assert.NoError(t, err, "the per-guest bucket must not throttle other visitors")
}

// TestGuestToken_LaunchGate_TurnLimit trips the per-session turn limit
// (lowered to 5 via STIGMER_SHARING_MAX_TURNS_PER_SESSION in the harness):
// the 6th message in one conversation is refused FAILED_PRECONDITION with
// the conversation-ended copy, and the same visitor can immediately start a
// fresh conversation.
func TestGuestToken_LaunchGate_TurnLimit(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-turn-limit")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())

	session, err := guestCreateSession(t, ctx, guest, agent, "turn-limit")
	require.NoError(t, err)
	sessionID := session.GetMetadata().GetId()

	for i := 0; i < 5; i++ {
		_, err := guestCreateExecution(ctx, guest, sessionID, "turn-"+string(rune('a'+i)))
		require.NoError(t, err, "turn %d is within the limit and must be accepted", i+1)
	}

	_, err = guestCreateExecution(ctx, guest, sessionID, "turn-over")
	require.Error(t, err, "the 6th turn must exceed the harness's turn limit of 5")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"bounds refusals are FAILED_PRECONDITION (not retryable as-is)")
	assert.Equal(t, defaultConversationEndedCopy, st.Message(),
		"the wire-visible message must be the conversation-ended copy, verbatim")

	// The visitor is not locked out — a fresh conversation works immediately.
	// (This is also the 2nd session for this cookie, well under the session
	// bucket of 5.)
	_, err = guestCreateSession(t, ctx, guest, agent, "turn-limit-fresh")
	assert.NoError(t, err, "a fresh conversation must be available after a turn-limit refusal")
}

// TestGuestToken_LaunchGate_FailClosed_CustomCopy drains the org's credits
// below the minimum start threshold and verifies (1) a guest message is
// refused synchronously at create — never an accepted message followed by an
// async EXECUTION_FAILED — and (2) the owner's custom unavailable copy from
// spec.sharing.messages is carried verbatim in the status description.
// Credits are restored on cleanup so later tests keep a funded org.
func TestGuestToken_LaunchGate_FailClosed_CustomCopy(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-guest-fail-closed",
		"You are a test agent for fail-closed verification.")
	customCopy := "Acme's helper is napping — come back soon!"
	share := shareFor(agent, true)
	share.Spec.Messages = &agentsharev1.AgentShareMessages{
		Unavailable: customCopy,
	}
	applyShare(t, ctx, clients, share)
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	minted := mintGuestToken(t, ctx, clients, org, slug, "")
	guest := guestClients(t, minted.GetAccessToken())

	// Session first, while the org is still funded (the session itself is free;
	// the billing pre-flight guards execution create — the spend event).
	session, err := guestCreateSession(t, ctx, guest, agent, "fail-closed")
	require.NoError(t, err)

	// Drain the org to zero available balance; restore on cleanup.
	balance, err := clients.BillingQuery.GetCreditBalance(ctx, &billingv1.GetCreditBalanceInput{OrgId: org})
	require.NoError(t, err, "reading the org balance should succeed")
	drained := balance.GetAvailableMicros()
	require.Greater(t, drained, int64(0), "the test org must start funded")

	_, err = clients.BillingCommand.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          org,
		AmountMicros:   -drained,
		Reason:         "launch-gate fail-closed test drain",
		IdempotencyKey: "launch-gate-drain-" + session.GetMetadata().GetId(),
	})
	require.NoError(t, err, "draining the org balance should succeed")
	t.Cleanup(func() {
		restoreCtx, restoreCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer restoreCancel()
		_, restoreErr := clients.BillingCommand.AdjustCredits(restoreCtx, &billingv1.AdjustCreditsInput{
			OrgId:          org,
			AmountMicros:   drained,
			Reason:         "launch-gate fail-closed test restore",
			IdempotencyKey: "launch-gate-restore-" + session.GetMetadata().GetId(),
		})
		require.NoError(t, restoreErr, "restoring org credits must succeed or later tests will fail")
	})

	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "fail-closed-attempt")
	require.Error(t, err, "an exhausted org must refuse the guest message at create (fail closed)")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, customCopy, st.Message(),
		"the owner's custom unavailable copy must reach the wire verbatim")
}

// TestGuestToken_Sharing_AllowedOriginsRoundTrip pins cloud-edition
// persistence of the allowed_origins config — stored on the AgentShare via
// apply, surfaced on getByAgent, malformed entries rejected by shared proto
// validation — and the hosted-page exemption: a mint that reports NO embed
// origin must keep working even when the share restricts embed origins (the
// hosted link is anyone-with-link by design; enforcement is embed-only, see
// TestGuestToken_EmbedOriginEnforcement).
func TestGuestToken_Sharing_AllowedOriginsRoundTrip(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-guest-origins",
		"You are a test agent for allowed-origins verification.")

	origins := []string{"https://docs.example.com", "http://localhost:3000"}
	share := shareFor(agent, true)
	share.Spec.AllowedOrigins = origins
	applied := applyShare(t, ctx, clients, share)
	assert.Equal(t, origins, applied.GetSpec().GetAllowedOrigins())

	fetched := canonicalShare(t, ctx, clients, agent)
	assert.Equal(t, origins, fetched.GetSpec().GetAllowedOrigins(),
		"allowed_origins must persist and round-trip")

	// Malformed origins are rejected by shared proto validation.
	malformed := shareFor(agent, true)
	malformed.Spec.AllowedOrigins = []string{"https://example.com/path"}
	_, err := clients.AgentShareCommand.Apply(ctx, malformed)
	require.Error(t, err, "an origin with a path must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())

	// Hosted-page exemption: no embed origin reported -> mint and chat work
	// even though the agent restricts embed origins.
	minted := mintGuestToken(t, ctx, clients,
		agent.GetMetadata().GetOrg(), agent.GetMetadata().GetSlug(), "")
	claims := jwtClaims(t, minted.GetAccessToken())
	assert.NotContains(t, claims, "embed_origin",
		"a hosted-page mint must not stamp an embed_origin claim")
	guest := guestClients(t, minted.GetAccessToken())
	_, err = guestCreateSession(t, ctx, guest, agent, "hosted-page-exempt")
	assert.NoError(t, err, "the hosted page must stay anyone-with-link regardless of allowed_origins")
}

// mintGuestTokenWithOrigin drives the public mint with an embed_origin, the
// way the embedded hosted page does after discovering its parent's origin.
func mintGuestTokenWithOrigin(ctx context.Context, clients *harness.Clients, org, slug, embedOrigin string) (*platformclientv1.MintGuestTokenResponse, error) {
	return clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org:         org,
		Slug:        slug,
		EmbedOrigin: embedOrigin,
	})
}

// TestGuestToken_EmbedOriginEnforcement covers the T04 allowlist end to end
// through production code paths: the embed origin is validated at mint
// (PERMISSION_DENIED + default copy verbatim on the wire), stamped into the
// guest JWT as the embed_origin claim, and re-validated against the LIVE
// allowed_origins by the guest create-time gate on session and execution
// creates — so revoking an origin takes effect on the visitor's next
// message, exactly like disabling sharing.
func TestGuestToken_EmbedOriginEnforcement(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-embed-origin")
	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	setOrigins := func(origins ...string) {
		t.Helper()
		share := shareFor(agent, true)
		share.Spec.AllowedOrigins = origins
		applyShare(t, ctx, clients, share)
	}

	requireOriginRefusal := func(err error, when string) {
		t.Helper()
		require.Error(t, err, when)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.PermissionDenied, st.Code(), when)
		assert.Equal(t, defaultOriginRefusedCopy, st.Message(),
			"the default origin-refusal copy must reach the wire verbatim")
	}

	// 1. Open mode (empty list): any embed origin mints, and the validated
	//    origin is stamped into the JWT.
	openMint, err := mintGuestTokenWithOrigin(ctx, clients, org, slug, "https://anywhere.example.com")
	require.NoError(t, err, "an empty allowed_origins list must admit any embed origin")
	assert.Equal(t, "https://anywhere.example.com",
		jwtClaims(t, openMint.GetAccessToken())["embed_origin"],
		"the embed origin must ride the guest JWT as a claim")

	// 2. Strict mode: listed origin mints and chats; unlisted origin and the
	//    opaque-origin sentinel ("null" — a framed page whose parent could
	//    not be discovered) are refused at mint.
	setOrigins("https://docs.example.com")

	allowedMint, err := mintGuestTokenWithOrigin(ctx, clients, org, slug, "https://docs.example.com")
	require.NoError(t, err, "a listed origin must mint in strict mode")
	allowedGuest := guestClients(t, allowedMint.GetAccessToken())
	session, err := guestCreateSession(t, ctx, allowedGuest, agent, "embed-allowed")
	require.NoError(t, err, "a guest minted under a listed origin must chat normally")

	_, err = mintGuestTokenWithOrigin(ctx, clients, org, slug, "https://evil.example.com")
	requireOriginRefusal(err, "an unlisted origin must be refused at mint")

	_, err = mintGuestTokenWithOrigin(ctx, clients, org, slug, "null")
	requireOriginRefusal(err, "an undiscoverable parent origin must fail closed in strict mode")

	// Malformed embed origins never reach the allowlist logic (shared CEL).
	_, err = mintGuestTokenWithOrigin(ctx, clients, org, slug, "https://example.com/path")
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"a malformed embed_origin must be INVALID_ARGUMENT, not a policy refusal")

	// 3. Revocation mid-token: the guest minted under docs.example.com holds
	//    a still-valid JWT, but removing the origin must refuse the next
	//    create — proving the create-time gate re-checks the LIVE list, not
	//    just the mint-time snapshot.
	setOrigins("https://other.example.com")

	_, err = guestCreateExecution(ctx, allowedGuest, session.GetMetadata().GetId(), "embed-revoked-turn")
	requireOriginRefusal(err, "an in-flight conversation must stop when its origin is revoked")

	_, err = guestCreateSession(t, ctx, allowedGuest, agent, "embed-revoked-session")
	requireOriginRefusal(err, "new conversations must stop when the origin is revoked")

	// 4. Restoring the origin immediately restores the same token — the gate
	//    reads config, not per-token state, so nothing needs re-minting.
	setOrigins("https://docs.example.com")
	_, err = guestCreateSession(t, ctx, allowedGuest, agent, "embed-restored")
	assert.NoError(t, err, "restoring the origin must restore the existing token's access")
}

// TestGuestToken_Malformed verifies malformed and tampered tokens are
// rejected at the authentication layer.
func TestGuestToken_Malformed(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := createSharedAgent(t, ctx, clients, "test-guest-malformed")

	minted := mintGuestToken(t, ctx, clients,
		agent.GetMetadata().GetOrg(), agent.GetMetadata().GetSlug(), "")

	// Tamper with the signature segment.
	parts := strings.Split(minted.GetAccessToken(), ".")
	tampered := parts[0] + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString([]byte("forged"))

	forgedGuest := guestClients(t, tampered)
	_, err := guestCreateSession(t, ctx, forgedGuest, agent, "forged")
	require.Error(t, err, "a tampered guest token must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	// In production security mode a forged signature is UNAUTHENTICATED. In the
	// harness's test security mode an unverifiable token falls back to a
	// synthetic NON-guest caller, whose org-less session create fails — the
	// invariant either way is that a forged token never acquires guest scope.
	assert.Contains(t,
		[]codes.Code{codes.Unauthenticated, codes.PermissionDenied, codes.Internal}, st.Code(),
		"tampered token must never act as a guest, got %s", st.Code())
}

// swapRunnerForGuestSandbox restarts the suite's shared static runner with a
// session-scoped sandbox token, reproducing what the production
// EnsureSessionSandboxStep injects into a provisioned sandbox: the runner
// authenticates as the session creator (here, the per-org guest identity
// account) with `session_id` + `token_type=sandbox` claims.
//
// This fidelity matters for guest sessions: the shared runner's fixed
// test-identity token holds no FGA tuples on guest-owned executions, so
// without the swap every status read/update — and the decision-004
// blueprint-read elevation, which requires a sandbox token — is denied.
// The shared runner is restored on cleanup so later tests are unaffected.
func swapRunnerForGuestSandbox(t *testing.T, guestAccountID, sessionID string) {
	t.Helper()
	require.NotNil(t, testHarness.UnifiedRunner, "shared unified runner must be available")

	sandboxToken, err := harness.MintSandboxToken(guestAccountID, sessionID)
	require.NoError(t, err, "mint sandbox token for guest session")

	shared := testHarness.UnifiedRunner
	queue := shared.TaskQueue()
	baseCfg := shared.Cfg()

	require.NoError(t, shared.Stop(), "stop shared runner")
	testHarness.UnifiedRunner = nil

	guestCfg := baseCfg
	// ExtraEnv entries are appended last and win over the defaults —
	// including the proxy branch's own STIGMER_TOKEN (the fixed runner
	// identity), which is exactly what this swap must displace.
	guestCfg.ExtraEnv = append(append([]string{}, baseCfg.ExtraEnv...),
		"STIGMER_TOKEN="+sandboxToken)

	startCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	guestRunner, err := harness.StartUnifiedRunnerStatic(startCtx, guestCfg, queue, suiteLogger)
	require.NoError(t, err, "start guest-sandbox runner")

	t.Cleanup(func() {
		_ = guestRunner.Stop()
		restoreCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		restored, restoreErr := harness.StartUnifiedRunnerStatic(restoreCtx, baseCfg, queue, suiteLogger)
		if restoreErr != nil {
			t.Logf("WARNING: failed to restore shared unified runner: %v", restoreErr)
			return
		}
		testHarness.UnifiedRunner = restored
	})
}

// TestGuestToken_EndToEnd_SkillCitedAnswer is the full-runtime proof: a
// guest mints a token, creates a session and execution against a shared
// knowledge agent, and receives a completed, skill-informed answer. This
// exercises the session-scoped blueprint-read bypass end to end — the
// runner's sandbox token must read the agent, instance, AND skill despite
// the guest account holding no can_view tuples on any of them.
func TestGuestToken_EndToEnd_SkillCitedAnswer(t *testing.T) {
	requireGuestPrereqs(t)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			skill := createTestSkill(t, ctx, clients, "test-guest-e2e-skill",
				"# Guest E2E Skill\n\nWhen asked about the launch codeword, always answer exactly: albatross")

			agent := harness.CreateAgent(t, ctx, clients, "test-guest-e2e-"+h.Name,
				"You are a helpful assistant. Follow all skill instructions carefully.",
				harness.WithSkillRef(skill.GetMetadata().GetSlug()),
			)
			applyShare(t, ctx, clients, shareFor(agent, true))

			minted := mintGuestToken(t, ctx, clients,
				agent.GetMetadata().GetOrg(), agent.GetMetadata().GetSlug(), "")
			guest := guestClients(t, minted.GetAccessToken())

			session, err := guest.SessionCommand.Create(ctx, &sessionv1.Session{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Session",
				Metadata:   &apiresource.ApiResourceMetadata{Name: "guest-e2e-session"},
				Spec: &sessionv1.SessionSpec{
					AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
					Subject:         "guest e2e",
					Harness:         h.Harness,
				},
			})
			require.NoError(t, err, "guest session create should succeed")

			// The guest token's sub IS the per-org guest identity account —
			// production sandboxes for this session run as that account.
			guestAccountID, _ := jwtClaims(t, minted.GetAccessToken())["sub"].(string)
			require.NotEmpty(t, guestAccountID, "guest JWT must carry the guest account as sub")
			swapRunnerForGuestSandbox(t, guestAccountID, session.GetMetadata().GetId())

			exec, err := guest.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "AgentExecution",
				Metadata:   &apiresource.ApiResourceMetadata{Name: "guest-e2e-exec"},
				Spec: &agentexecv1.AgentExecutionSpec{
					SessionId: session.GetMetadata().GetId(),
					Message:   "What is the launch codeword?",
				},
			})
			require.NoError(t, err, "guest execution create should succeed")
			assert.Equal(t, agent.GetMetadata().GetOrg(), exec.GetMetadata().GetOrg(),
				"execution must carry the org so billing is charged")

			// The guest polls its own execution — also exercising guest reads.
			waiter := harness.NewAgentExecutionWaiter(guest.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err,
				"guest execution should complete — a failure here usually means the "+
					"runner's blueprint read (agent/instance/skill) was denied")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// The skill-cited answer proves the blueprint-read bypass covers
			// the transitive skill graph, not just the agent entry points.
			cited := false
			for _, m := range result.GetStatus().GetMessages() {
				if strings.Contains(strings.ToLower(m.GetContent()), "albatross") {
					cited = true
				}
			}
			assert.True(t, cited,
				"the answer must cite the skill's codeword — the guest runtime read the skill")
		})
	}
}
