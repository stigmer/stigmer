//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
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

// T10 — External-org share links, Phase B (decision 013). These tests prove
// the cross-org AgentShare contract end to end against the real cloud
// backend + live FGA, with two genuinely independent tenants: TestOrg plays
// the agent-owning org ("org A") and a StandaloneOrg peer plays the sharing
// org ("org B"). The invariants under test:
//
//   - Create bar (D1/D2): only an org-B ADMIN can share org A's
//     marketplace-PUBLIC agent; everything non-public is refused
//     indistinguishably from absence.
//   - Channel independence (D4): org B owns the share's lifecycle; org A's
//     delete cascade never crosses the org boundary, and the agent-ULID pin
//     kills slug-reuse rebinds.
//   - Billing follows the SHARE org (DD-001 generalized): every guest turn
//     on org B's link gates on org B's balance, never org A's.
//   - Credential boundary (D5 + T06): org B's org-shared environments power
//     the tools; org A's are structurally unreachable from org B's channel.
//   - Owner-retained control (D1): a visibility flip by org A kills every
//     external channel on the next message.

// t10EnvVar is unique to this suite so the personal-environment fallback can
// never mask a resolution failure (the t06EnvVar pattern).
const t10EnvVar = "T10_CROSS_ORG_TOOL_KEY"

// peerOrg provisions the standalone counterpart tenant (org B).
func peerOrg(t *testing.T, ctx context.Context) *harness.StandaloneOrg {
	t.Helper()
	return harness.CreateStandaloneOrg(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
}

// makeAgentPublic flips the agent to marketplace-public visibility — the
// origin org's implicit consent to external shares (D1).
func makeAgentPublic(t *testing.T, ctx context.Context, clients *harness.Clients, agentID string) {
	t.Helper()
	updated, err := clients.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
		ResourceId: agentID,
		Visibility: apiresource.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err, "agent updateVisibility to public should succeed")
	require.Equal(t, apiresource.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility())
}

// crossOrgShareFor builds the canonical cross-org AgentShare: the share
// lives in shareOrg while agent_ref names the agent's own org explicitly.
// The explicit ref org matters — shareFor leaves it empty, and an empty ref
// org normalizes to the SHARE's org (the platform-wide relative-reference
// convention), which would silently turn this into a Phase A same-org share.
func crossOrgShareFor(agent *agentv1.Agent, shareOrg string, enabled bool) *agentsharev1.AgentShare {
	return &agentsharev1.AgentShare{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentShare",
		Metadata: &apiresource.ApiResourceMetadata{
			Org: shareOrg,
		},
		Spec: &agentsharev1.AgentShareSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Org:  agent.GetMetadata().GetOrg(),
				Slug: agent.GetMetadata().GetSlug(),
			},
			Enabled: enabled,
		},
	}
}

// applyCrossOrgShare applies a cross-org share and registers its deletion.
// Explicit cleanup is load-bearing here: Phase A shares die with their
// agent's delete cascade, but the cascade is same-org-scoped BY DESIGN
// (D4 — org A deleting its agent must never destroy org B's resources), so
// a cross-org share outlives its agent and must be torn down by its own org.
func applyCrossOrgShare(t *testing.T, ctx context.Context, clients *harness.Clients, share *agentsharev1.AgentShare) *agentsharev1.AgentShare {
	t.Helper()
	applied, err := clients.AgentShareCommand.Apply(ctx, share)
	require.NoError(t, err, "cross-org agentShare apply should succeed")
	shareID := applied.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.AgentShareCommand.Delete(cleanCtx, &agentsharev1.AgentShareId{Value: shareID}); err != nil {
			t.Logf("warning: failed to clean up cross-org share %s: %v", shareID, err)
		}
	})
	return applied
}

// adjustCredits applies a signed credit adjustment to an org's balance.
// The idempotency key derives from the caller-supplied per-run unique id
// (never the test name): gotestsum reruns failed root tests, and a
// name-derived key would be deduplicated by the billing idempotency layer
// on rerun, silently skipping the adjustment.
func adjustCredits(t *testing.T, ctx context.Context, clients *harness.Clients, org string, amountMicros int64, reason, key string) {
	t.Helper()
	_, err := clients.BillingCommand.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          org,
		AmountMicros:   amountMicros,
		Reason:         reason,
		IdempotencyKey: key,
	})
	require.NoError(t, err, "adjustCredits(%s, %d) should succeed", org, amountMicros)
}

// drainCredits zeroes an org's available balance and restores it on
// cleanup, returning the drained amount.
//
// The drain covers available PLUS reserved: an earlier test's execution
// can still hold a reservation, and its asynchronous release moves the
// unused hold back into available — landing after a drain of available
// alone would re-fund the org above the launch-gate threshold mid-test.
// Overdraining by the reserved amount caps any such release at zero.
func drainCredits(t *testing.T, ctx context.Context, clients *harness.Clients, org, uniqueID string) int64 {
	t.Helper()
	balance, err := clients.BillingQuery.GetCreditBalance(ctx, &billingv1.GetCreditBalanceInput{OrgId: org})
	require.NoError(t, err, "reading org %s balance should succeed", org)
	drained := balance.GetAvailableMicros() + balance.GetReservedMicros()
	require.Greater(t, drained, int64(0), "org %s must start funded", org)

	adjustCredits(t, ctx, clients, org, -drained, "t10 cross-org billing drain", "t10-drain-"+org+"-"+uniqueID)
	t.Cleanup(func() {
		restoreCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, err := clients.BillingCommand.AdjustCredits(restoreCtx, &billingv1.AdjustCreditsInput{
			OrgId:          org,
			AmountMicros:   drained,
			Reason:         "t10 cross-org billing restore",
			IdempotencyKey: "t10-restore-" + org + "-" + uniqueID,
		})
		require.NoError(t, err, "restoring org %s credits must succeed or later tests will fail", org)
	})
	return drained
}

// TestCrossOrgShare_CreateMatrix pins the two-sided create bar and the
// fail-loud refusals (D1–D3, D5) through the real authorization stack:
// admin-yes/member-no on the org side, public-visibility consent on the
// agent side (refused indistinguishably from absence), no org-audience
// side door on create OR update, and non-public dependencies named
// verbatim in the refusal.
func TestCrossOrgShare_CreateMatrix(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	t.Run("admin_creates_canonical_share", func(t *testing.T) {
		agent := harness.CreateAgent(t, ctx, clients, "t10-create-happy",
			"You are a public agent for cross-org share creation verification.")
		makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

		applied := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))

		// The channel identity: org B's share, org A's agent, pinned by ULID.
		assert.Equal(t, peer.OrgID, applied.GetMetadata().GetOrg(),
			"the share must land in the sharing org")
		assert.Equal(t, agent.GetMetadata().GetOrg(), applied.GetSpec().GetAgentRef().GetOrg(),
			"agent_ref must keep naming the agent's own org")
		assert.Equal(t, agent.GetMetadata().GetId(), applied.GetStatus().GetAgentId(),
			"status.agent_id must pin the resolved agent's ULID (the D4 rebind guard)")
		assert.Equal(t, agent.GetMetadata().GetSlug(), applied.GetMetadata().GetSlug(),
			"the canonical share's slug must default from the agent")

		// The hosted URL identity is /chat/<org-b>/<slug>: the public
		// profile resolves under the SHARING org.
		profile, err := clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
			Org:  peer.OrgID,
			Slug: applied.GetMetadata().GetSlug(),
		})
		require.NoError(t, err, "the cross-org share must resolve at the sharing org's URL")
		assert.Equal(t, peer.OrgID, profile.GetOrg(), "profile org is the share's org (the URL identity)")
		assert.Equal(t, agent.GetMetadata().GetName(), profile.GetName(),
			"display fields come from the referenced agent")
	})

	t.Run("member_refused_by_org_side_bar", func(t *testing.T) {
		agent := harness.CreateAgent(t, ctx, clients, "t10-create-member",
			"You are a public agent for org-side create bar verification.")
		makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

		_, err := peer.Member.Clients.AgentShareCommand.Apply(ctx, crossOrgShareFor(agent, peer.OrgID, true))
		require.Error(t, err,
			"an org member must not create a cross-org share (can_create_agent_share is admin-only)")
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.PermissionDenied, st.Code(),
			"the org-side bar is an authorization denial, got %s: %s", st.Code(), st.Message())
	})

	t.Run("non_public_agent_indistinguishable_from_absent", func(t *testing.T) {
		// Baseline: a genuinely nonexistent agent.
		missing := crossOrgShareFor(&agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Org: harness.TestOrg, Slug: "t10-does-not-exist",
			},
		}, peer.OrgID, true)
		_, err := peer.Admin.Clients.AgentShareCommand.Apply(ctx, missing)
		require.Error(t, err)
		missingStatus, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.NotFound, missingStatus.Code())

		// Org-visibility (the default) and private agents must be refused
		// with the SAME error: for org B, another org's non-public agent
		// does not exist, and create must not become an existence probe.
		orgVisible := harness.CreateAgent(t, ctx, clients, "t10-create-orgvis",
			"You are an org-visible agent that must be unshareable across orgs.")

		private := harness.CreateAgentFull(t, ctx, clients, "t10-create-private",
			"You are a private agent that must be unshareable across orgs.",
			nil,
			[]harness.AgentCreateOption{func(a *agentv1.Agent) {
				a.Metadata.Visibility = apiresource.ApiResourceVisibility_visibility_private
			}})

		for _, tc := range []struct {
			label string
			agent *agentv1.Agent
		}{
			{"org_visibility", orgVisible},
			{"private", private},
		} {
			_, err := peer.Admin.Clients.AgentShareCommand.Apply(ctx, crossOrgShareFor(tc.agent, peer.OrgID, true))
			require.Error(t, err, "%s agent must be refused for cross-org sharing", tc.label)
			st, ok := status.FromError(err)
			require.True(t, ok)
			requireIndistinguishableRefusals(t,
				tc.label+" agent must be indistinguishable from a nonexistent one",
				missingStatus, "t10-does-not-exist",
				st, tc.agent.GetMetadata().GetSlug())
		}
	})

	t.Run("org_audience_refused_on_create_and_update", func(t *testing.T) {
		agent := harness.CreateAgent(t, ctx, clients, "t10-create-audience",
			"You are a public agent for cross-org audience guard verification.")
		makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

		// Create: the D3 guard fails loud (org-audience semantics don't
		// carry across the boundary; a share that admits nobody is worse
		// than a refusal).
		invalid := crossOrgShareFor(agent, peer.OrgID, true)
		invalid.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
		_, err := peer.Admin.Clients.AgentShareCommand.Apply(ctx, invalid)
		require.Error(t, err, "a cross-org org-audience share must be refused at create")
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code(),
			"got %s: %s", st.Code(), st.Message())

		// Update: the same combination must not be assemblable as a second
		// write on a valid public share (the side-door guard).
		applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))

		sideDoor := crossOrgShareFor(agent, peer.OrgID, true)
		sideDoor.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
		_, err = peer.Admin.Clients.AgentShareCommand.Apply(ctx, sideDoor)
		require.Error(t, err, "an update must not side-door an org-audience cross-org share")
		st, ok = status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code(),
			"got %s: %s", st.Code(), st.Message())
	})

	t.Run("non_public_dependency_named_in_refusal", func(t *testing.T) {
		// A skill at its default (non-public) visibility is exactly the
		// blocker D5 exists for: cross-org guests can only elevate reads on
		// public resources, so the share would silently lose its tools.
		skill := createTestSkill(t, ctx, clients, "t10-private-skill",
			"# T10 Skill\n\nA non-public dependency that must block cross-org sharing.")

		agent := harness.CreateAgent(t, ctx, clients, "t10-create-deps",
			"You are a public agent with a non-public skill dependency.",
			harness.WithSkillRef(skill.GetMetadata().GetSlug()))
		makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

		_, err := peer.Admin.Clients.AgentShareCommand.Apply(ctx, crossOrgShareFor(agent, peer.OrgID, true))
		require.Error(t, err, "a non-public dependency must fail the cross-org create loudly")
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code(),
			"got %s: %s", st.Code(), st.Message())
		assert.Contains(t, st.Message(),
			harness.TestOrg+"/"+skill.GetMetadata().GetSlug(),
			"the refusal must name the blocking dependency so org B knows what to ask org A to publish")

		// The same agent stays shareable in its OWN org — D5 is a
		// cross-org rule, not a new same-org restriction.
		applyShare(t, ctx, clients, shareFor(agent, true))
	})
}

// TestCrossOrgShare_GuestChat_BillingFollowsShareOrg is the Phase B billing
// headline: every guest turn on org B's link gates on org B's balance —
// never org A's. The proof is the synchronous fail-closed credit gate run
// both ways: with org A drained the turn still passes; with org B drained
// it is refused at create. The mint on org B's link is also the first
// exercise of lazy managed-PlatformClient provisioning for a second org.
func TestCrossOrgShare_GuestChat_BillingFollowsShareOrg(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	agent := harness.CreateAgent(t, ctx, clients, "t10-billing",
		"You are a public agent for cross-org billing verification. Answer briefly.")
	makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

	share := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))
	slug := share.GetMetadata().GetSlug()

	// Mint on org B's link: provisions org B's system-managed
	// PlatformClient lazily, and the guest JWT is scoped to org B.
	minted := mintGuestToken(t, ctx, clients, peer.OrgID, slug, "")
	claims := jwtClaims(t, minted.GetAccessToken())
	assert.Equal(t, peer.OrgID, claims["org"],
		"the guest token must be scoped to the SHARING org — it is the billing org")
	guest := guestClients(t, minted.GetAccessToken())

	// The guest chats on org A's pristine default instance, but every
	// record lands in org B.
	session, err := guestCreateSession(t, ctx, guest, agent, "cross-org-billing")
	require.NoError(t, err, "guest session create on a cross-org share should succeed")
	assert.Equal(t, peer.OrgID, session.GetMetadata().GetOrg(),
		"the session org must be forced to the share org from the guest token")

	exec, err := guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "baseline-turn")
	require.NoError(t, err, "a funded share org must admit the guest turn")
	assert.Equal(t, peer.OrgID, exec.GetMetadata().GetOrg(),
		"the execution org must be the share org — billing follows metadata.org")

	uniqueID := session.GetMetadata().GetId()

	// Org A drained: org A is not the payer, so the guest turn still passes.
	drainCredits(t, ctx, clients, harness.TestOrg, uniqueID)
	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "agent-org-drained")
	require.NoError(t, err,
		"draining the AGENT org must not block the guest — the sharing org is the payer")

	// Org B drained: the payer is exhausted, so the very next turn is
	// refused synchronously at create (fail closed, never an async failure).
	drainCredits(t, ctx, clients, peer.OrgID, uniqueID)
	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "share-org-drained")
	require.Error(t, err, "an exhausted share org must refuse the guest turn at create")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"got %s: %s", st.Code(), st.Message())
}

// TestCrossOrgShare_CredentialBoundary proves the D5/T06 credential
// containment both ways on the pristine default instance: org A's
// org-shared environment is structurally unreachable from org B's channel
// (no leak), while org B's own org-shared environment bound via the
// share's environment_refs powers the agent's tools (and unbinding fails
// closed on the very next message). The refusal a guest sees is always the
// generic copy — the owner diagnostic names internal variables and slugs
// that must never reach an anonymous visitor.
func TestCrossOrgShare_CredentialBoundary(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	// Org A: a PUBLIC tool agent — the MCP server must itself be public or
	// the cross-org create would fail the D5 sweep (that refusal has its
	// own test above).
	mcpName := "t10-public-mcp-" + uuid.New().String()[:8]
	mcpServer, err := clients.McpServerCommand.Apply(ctx, &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       mcpName,
			Org:        harness.TestOrg,
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "T10 public tool server requiring a credential",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "echo",
					Args:    []string{"${" + t10EnvVar + "}"},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				t10EnvVar: {
					Description: "T10 credential the tool cannot start without",
					IsSecret:    true,
					// optional defaults to false — the validator enforces it.
				},
			},
		},
	})
	require.NoError(t, err, "public MCP server apply should succeed")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: mcpServer.GetMetadata().GetId(),
		})
	})

	agent := harness.CreateAgent(t, ctx, clients, "t10-cred-boundary",
		"You are a tool-using public agent for cross-org credential verification.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()))
	makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

	// Org A holds a perfectly valid org-shared environment with the
	// required credential. It must count for NOTHING on org B's channel.
	orgAEnv := createT10Environment(t, ctx, clients, harness.TestOrg, "t10-org-a-env")

	share := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))
	slug := share.GetMetadata().GetSlug()

	minted := mintGuestToken(t, ctx, clients, peer.OrgID, slug, "")
	guest := guestClients(t, minted.GetAccessToken())
	session, err := guestCreateSession(t, ctx, guest, agent, "cred-boundary")
	require.NoError(t, err)
	sessionID := session.GetMetadata().GetId()

	// 1. No binding on org B's share: the turn fails closed even though
	//    org A's org-shared env holds the exact credential — resolution
	//    happens in the EXECUTION's org, and org A's environments are not
	//    reachable from org B's channel.
	_, err = guestCreateExecution(ctx, guest, sessionID, "unbound-attempt")
	require.Error(t, err,
		"org A's org-shared environment must never satisfy org B's channel")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, defaultUnavailableCopy, st.Message(),
		"the guest must see the generic copy, never the owner diagnostic")
	assert.NotContains(t, st.Message(), t10EnvVar,
		"the refusal must never leak the missing variable name")
	assert.NotContains(t, st.Message(), orgAEnv.GetMetadata().GetSlug(),
		"the refusal must never leak org A's environment slug")

	// 2. Org B binds its OWN org-shared environment through the share's
	//    environment_refs (the DD-011 channel binding): the SAME guest
	//    token's next message goes through on the pristine default
	//    instance.
	orgBEnv := createT10Environment(t, ctx, peer.Admin.Clients, peer.OrgID, "t10-org-b-env")

	bound := crossOrgShareFor(agent, peer.OrgID, true)
	bound.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{{
		Kind: apiresourcekind.ApiResourceKind_environment,
		Org:  orgBEnv.GetMetadata().GetOrg(),
		Slug: orgBEnv.GetMetadata().GetSlug(),
	}}
	_, err = peer.Admin.Clients.AgentShareCommand.Apply(ctx, bound)
	require.NoError(t, err, "binding org B's env to org B's share should succeed")

	_, err = guestCreateExecution(ctx, guest, sessionID, "bound-attempt")
	require.NoError(t, err,
		"org B's share-bound credentials must satisfy tool validation on the pristine default instance")

	// 3. Unbind: the next message fails closed again — the gate reads the
	//    live share, and no credential lingers on the instance.
	_, err = peer.Admin.Clients.AgentShareCommand.Apply(ctx, crossOrgShareFor(agent, peer.OrgID, true))
	require.NoError(t, err)

	_, err = guestCreateExecution(ctx, guest, sessionID, "unbound-again")
	require.Error(t, err, "removing the binding must block the very next guest message")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, defaultUnavailableCopy, st.Message())
}

// TestCrossOrgShare_VisibilityFlipRevocation pins org A's retained control
// (D1): public visibility IS the consent, so withdrawing it kills every
// external channel on the guest's NEXT message — live state, no caching,
// no grandfathering — and the dead channel is indistinguishable from one
// that never existed at profile and mint. Restoring visibility restores
// the channel without any re-share.
func TestCrossOrgShare_VisibilityFlipRevocation(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	agent := harness.CreateAgent(t, ctx, clients, "t10-revocation",
		"You are a public agent for cross-org revocation verification. Answer briefly.")
	agentID := agent.GetMetadata().GetId()
	makeAgentPublic(t, ctx, clients, agentID)

	share := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))
	slug := share.GetMetadata().GetSlug()

	// A live guest conversation, mid-session.
	minted := mintGuestToken(t, ctx, clients, peer.OrgID, slug, "")
	guest := guestClients(t, minted.GetAccessToken())
	session, err := guestCreateSession(t, ctx, guest, agent, "revocation")
	require.NoError(t, err)
	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "before-flip")
	require.NoError(t, err, "the channel must work while the agent is public")

	// Baseline refusal for the indistinguishability comparison below.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org: peer.OrgID, Slug: "t10-never-existed",
	})
	require.Error(t, err)
	absentStatus, ok := status.FromError(err)
	require.True(t, ok)

	// Org A withdraws consent.
	updated, err := clients.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
		ResourceId: agentID,
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err, "flipping the agent back to org visibility should succeed")
	require.Equal(t, apiresource.ApiResourceVisibility_visibility_org,
		updated.GetMetadata().GetVisibility())

	// Profile and mint refuse BEFORE the chat page renders, and the
	// refusal matches a channel that never existed.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org: peer.OrgID, Slug: slug,
	})
	require.Error(t, err, "the profile must refuse once the agent is no longer public")
	profileStatus, ok := status.FromError(err)
	require.True(t, ok)
	requireIndistinguishableRefusals(t,
		"a de-published channel must be indistinguishable from an absent one",
		absentStatus, "t10-never-existed", profileStatus, slug)

	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: peer.OrgID, Slug: slug,
	})
	require.Error(t, err, "minting must refuse once the agent is no longer public")
	mintStatus, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, mintStatus.Code())

	// The LIVE guest's next message fails closed — revocation does not
	// wait for token expiry.
	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "after-flip")
	require.Error(t, err, "the visibility flip must kill the live conversation on the next message")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"the dead channel must not leak why it died, got %s: %s", st.Code(), st.Message())

	// Restoring visibility restores the channel — the gates read live
	// state in both directions.
	makeAgentPublic(t, ctx, clients, agentID)
	_, err = guestCreateExecution(ctx, guest, session.GetMetadata().GetId(), "after-restore")
	require.NoError(t, err, "restoring public visibility must restore the existing channel")
}

// TestCrossOrgShare_AgentDeleteLifecycle pins the D4 lifecycle contract:
// org A deleting its agent never destroys org B's share (the cascade is
// same-org-scoped — a cross-org cascade would be a cross-principal
// destructive action), but the surviving share fails closed
// indistinguishably. And when org A recreates the SAME slug, the
// agent-ULID pin keeps the stale share dark forever — the exact rebind
// hazard status.agent_id exists to kill: without it, org B's old link
// would silently attach its audience and credentials to a brand-new agent.
func TestCrossOrgShare_AgentDeleteLifecycle(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	// The agent is created with a FIXED name (unique per run) so the
	// recreate below lands on the SAME slug — the precondition of the
	// rebind hazard.
	name := "t10-rebind-target-" + uuid.New().String()[:8]
	buildAgent := func() *agentv1.Agent {
		return &agentv1.Agent{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  harness.TestOrg,
			},
			Spec: &agentv1.AgentSpec{
				Description:  "T10 rebind lifecycle agent",
				Instructions: "You are a public agent for cross-org lifecycle verification.",
			},
		}
	}
	agent, err := clients.AgentCommand.Apply(ctx, buildAgent())
	require.NoError(t, err)
	makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())

	share := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))
	slug := share.GetMetadata().GetSlug()
	profileRef := &agentsharev1.GetSharedProfileRequest{Org: peer.OrgID, Slug: slug}

	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, profileRef)
	require.NoError(t, err, "the channel must resolve while the agent exists")

	// Baseline refusal for indistinguishability comparisons.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, &agentsharev1.GetSharedProfileRequest{
		Org: peer.OrgID, Slug: "t10-never-existed",
	})
	require.Error(t, err)
	absentStatus, ok := status.FromError(err)
	require.True(t, ok)

	// Org A deletes the agent. The same-org cascade must NOT cross the
	// boundary: org B's share row survives, owned and readable by org B.
	_, err = clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.NoError(t, err, "org A's agent delete should succeed")

	surviving, err := peer.Admin.Clients.AgentShareQuery.Get(ctx, &agentsharev1.AgentShareId{
		Value: share.GetMetadata().GetId(),
	})
	require.NoError(t, err,
		"org B's share must survive org A's delete — the cascade is same-org-scoped by design")
	assert.Equal(t, agent.GetMetadata().GetId(), surviving.GetStatus().GetAgentId(),
		"the surviving share keeps its pin to the deleted agent")

	// But the channel is dead, indistinguishably.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, profileRef)
	require.Error(t, err, "a dangling cross-org share must fail closed")
	danglingStatus, ok := status.FromError(err)
	require.True(t, ok)
	requireIndistinguishableRefusals(t,
		"a dangling channel must be indistinguishable from an absent one",
		absentStatus, "t10-never-existed", danglingStatus, slug)

	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: peer.OrgID, Slug: slug,
	})
	require.Error(t, err, "minting on a dangling channel must refuse")

	// Org A recreates the same slug — as a PUBLIC agent, so the only thing
	// standing between org B's stale share and the new agent is the pin.
	recreated, err := clients.AgentCommand.Apply(ctx, buildAgent())
	require.NoError(t, err, "recreating the same slug should succeed")
	require.Equal(t, agent.GetMetadata().GetSlug(), recreated.GetMetadata().GetSlug(),
		"the recreate must land on the same slug for the rebind probe to mean anything")
	require.NotEqual(t, agent.GetMetadata().GetId(), recreated.GetMetadata().GetId(),
		"the recreated agent must be a different resource")
	makeAgentPublic(t, ctx, clients, recreated.GetMetadata().GetId())
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: recreated.GetMetadata().GetId()})
	})

	// The pin keeps the stale channel dark: org+slug now resolve to the
	// new agent, but status.agent_id does not match it.
	_, err = clients.AgentShareQuery.GetSharedProfile(ctx, profileRef)
	require.Error(t, err,
		"the stale share must NEVER rebind to a new agent that claims the slug")
	rebindStatus, ok := status.FromError(err)
	require.True(t, ok)
	requireIndistinguishableRefusals(t,
		"the pin-mismatched channel must stay indistinguishable from an absent one",
		absentStatus, "t10-never-existed", rebindStatus, slug)

	_, err = clients.PlatformClientToken.MintGuestToken(ctx, &platformclientv1.MintGuestTokenRequest{
		Org: peer.OrgID, Slug: slug,
	})
	require.Error(t, err, "minting must stay refused after the slug is reclaimed")

	// A DELIBERATE new share of the recreated agent works — the pin blocks
	// silent rebinds, not org B's explicit consent to the new agent.
	fresh := crossOrgShareFor(recreated, peer.OrgID, true)
	fresh.Metadata.Name = name + "-fresh"
	freshShare := applyCrossOrgShare(t, ctx, peer.Admin.Clients, fresh)
	assert.Equal(t, recreated.GetMetadata().GetId(), freshShare.GetStatus().GetAgentId(),
		"a new share pins the NEW agent — recreating the channel is a deliberate act")
}

// TestCrossOrgShare_GetByAgentOrgScope pins the org parameter on
// getByAgent (the decision 013 amendment): the org scope NARROWS the view
// to one org's channels of an agent and never widens it past what the
// caller may see. This is the contract the console's Shares tab relies on —
// a member of several orgs viewing the tab in org X sees org X's channels
// only, not a merged list of every org's channels badged cross-org.
func TestCrossOrgShare_GetByAgentOrgScope(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	peer := peerOrg(t, ctx)

	agent := harness.CreateAgent(t, ctx, clients, "t10-getbyagent-scope",
		"You are a public agent for getByAgent org-scope verification.")
	makeAgentPublic(t, ctx, clients, agent.GetMetadata().GetId())
	agentID := agent.GetMetadata().GetId()

	homeShare := applyShare(t, ctx, clients, shareFor(agent, true))
	peerShare := applyCrossOrgShare(t, ctx, peer.Admin.Clients, crossOrgShareFor(agent, peer.OrgID, true))

	getByAgent := func(t *testing.T, c *harness.Clients, org string) *agentsharev1.AgentShareList {
		t.Helper()
		list, err := c.AgentShareQuery.GetByAgent(ctx, &agentsharev1.GetAgentSharesByAgentRequest{
			AgentId: agentID,
			Org:     org,
		})
		require.NoError(t, err, "getByAgent(org=%q) should succeed", org)
		return list
	}

	// Every row of an org-scoped response belongs to that org — the
	// invariant that holds regardless of what the caller may see.
	requireAllInOrg := func(t *testing.T, list *agentsharev1.AgentShareList, org string) {
		t.Helper()
		for _, item := range list.GetItems() {
			assert.Equal(t, org, item.GetMetadata().GetOrg(),
				"an org-scoped list must never leak another org's share")
		}
	}

	t.Run("each_org_sees_exactly_its_own_channel", func(t *testing.T) {
		homeList := getByAgent(t, clients, harness.TestOrg)
		requireAllInOrg(t, homeList, harness.TestOrg)
		require.Len(t, homeList.GetItems(), 1)
		assert.Equal(t, homeShare.GetMetadata().GetId(), homeList.GetItems()[0].GetMetadata().GetId())

		peerList := getByAgent(t, peer.Admin.Clients, peer.OrgID)
		requireAllInOrg(t, peerList, peer.OrgID)
		require.Len(t, peerList.GetItems(), 1)
		assert.Equal(t, peerShare.GetMetadata().GetId(), peerList.GetItems()[0].GetMetadata().GetId())
	})

	t.Run("org_scope_narrows_the_unscoped_view", func(t *testing.T) {
		unscopedIds := map[string]bool{}
		for _, item := range getByAgent(t, peer.Admin.Clients, "").GetItems() {
			unscopedIds[item.GetMetadata().GetId()] = true
		}
		for _, item := range getByAgent(t, peer.Admin.Clients, peer.OrgID).GetItems() {
			assert.True(t, unscopedIds[item.GetMetadata().GetId()],
				"the org scope must be a pure narrowing of the unscoped view")
		}
	})

	t.Run("org_scope_never_widens_past_authorization", func(t *testing.T) {
		// Org B's admin naming org A does not gain org A's channel: the
		// filter composes with the permission bound, it never replaces it.
		crossList := getByAgent(t, peer.Admin.Clients, harness.TestOrg)
		requireAllInOrg(t, crossList, harness.TestOrg)
		for _, item := range crossList.GetItems() {
			assert.NotEqual(t, peerShare.GetMetadata().GetId(), item.GetMetadata().GetId())
		}

		assert.Empty(t, getByAgent(t, peer.Admin.Clients, "t10-no-such-org").GetItems(),
			"an org with no channels of this agent yields an empty list")
	})
}

// createT10Environment creates an org-shared environment holding the T10
// tool credential in the given org, cleaned up on test exit. Born with org
// visibility: runtime-resolvable for any execution in that org (T06), which
// is precisely the boundary the credential tests probe.
func createT10Environment(t *testing.T, ctx context.Context, clients *harness.Clients, org, name string) *environmentv1.Environment {
	t.Helper()
	env, err := clients.EnvironmentCommand.Create(ctx, &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name + "-" + uuid.New().String()[:8],
			Org:        org,
			Visibility: apiresource.ApiResourceVisibility_visibility_org,
		},
		Spec: &environmentv1.EnvironmentSpec{
			Description: "T10 cross-org credential boundary test environment",
			Data: map[string]*environmentv1.EnvironmentValue{
				t10EnvVar: {Value: "t10-secret-value", IsSecret: true},
			},
		},
	})
	require.NoError(t, err, "environment create in %s should succeed", org)
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.EnvironmentCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: env.GetMetadata().GetId(),
		})
	})
	return env
}
