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
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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

// createSharedAgent creates an agent in the test org and enables sharing.
func createSharedAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *agentv1.Agent {
	t.Helper()

	agent := harness.CreateAgent(t, ctx, clients, name,
		"You are a test agent for guest token verification. Answer briefly.")

	updated, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err, "enabling sharing should succeed")
	require.True(t, updated.GetSpec().GetSharing().GetEnabled())
	return updated
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

	// 2. Nonexistent: byte-identical to unshared.
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: org, Slug: "does-not-exist",
	})
	require.Error(t, err)
	missingStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, missingStatus.Code())
	assert.Equal(t, unsharedStatus.Message(), missingStatus.Message(),
		"unshared and nonexistent agents must be indistinguishable at the mint endpoint")

	// 3. Empty org: INVALID_ARGUMENT (no cross-org slug enumeration).
	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Slug: slug,
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())

	// 4. Shared: mints; the guest JWT carries the org scope and cookie id.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	})
	require.NoError(t, err)

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

	// 6. Revoke: minting stops immediately (fail closed).
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: false},
	})
	require.NoError(t, err)

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

	// Revoke stops guests: disable sharing, then session create fails closed.
	_, err = clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
		ResourceId: agent.GetMetadata().GetId(),
		Sharing:    &agentv1.AgentSharing{Enabled: false},
	})
	require.NoError(t, err)

	_, err = guestCreateSession(t, ctx, guest, agent, "after-revoke")
	require.Error(t, err, "an existing guest token must stop working once sharing is revoked")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
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
			_, err := clients.AgentCommand.UpdateSharing(ctx, &agentv1.UpdateAgentSharingInput{
				ResourceId: agent.GetMetadata().GetId(),
				Sharing:    &agentv1.AgentSharing{Enabled: true},
			})
			require.NoError(t, err, "enabling sharing should succeed")

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
