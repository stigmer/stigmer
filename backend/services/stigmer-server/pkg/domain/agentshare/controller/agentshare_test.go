package agentshare

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// contextWithKind simulates the apiresource interceptor, which injects the
// RPC's resource kind into the request context in production.
func contextWithKind(kind apiresourcekind.ApiResourceKind) context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, kind)
}

func shareCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_agent_share)
}

func agentCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_agent)
}

type testControllers struct {
	shares *AgentShareController
	agents *agentcontroller.AgentController
}

func newTestControllers(t *testing.T) *testControllers {
	t.Helper()
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return &testControllers{
		shares: NewAgentShareController(store),
		agents: agentcontroller.NewAgentController(store, nil),
	}
}

func createTestAgent(t *testing.T, tc *testControllers, name string) *agentv1.Agent {
	t.Helper()
	created, err := tc.agents.Create(agentCtx(), &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Agent for sharing tests",
			Instructions: "You are a helpful agent for sharing verification.",
			IconUrl:      "https://example.com/icon.svg",
		},
	})
	if err != nil {
		t.Fatalf("agent Create failed: %v", err)
	}
	return created
}

// shareFor builds the minimal canonical share for an agent: no slug, no
// name — both default from the referenced agent.
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

func createTestShare(t *testing.T, tc *testControllers, agent *agentv1.Agent, enabled bool) *agentsharev1.AgentShare {
	t.Helper()
	created, err := tc.shares.Create(shareCtx(), shareFor(agent, enabled))
	if err != nil {
		t.Fatalf("share Create failed: %v", err)
	}
	return created
}

func TestAgentShareController_Create(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("canonical share defaults slug and name from the agent", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Canonical Default Agent")
		share := createTestShare(t, tc, agent, true)

		if share.GetMetadata().GetSlug() != agent.GetMetadata().GetSlug() {
			t.Errorf("share slug should default to the agent's slug: agent %q, share %q",
				agent.GetMetadata().GetSlug(), share.GetMetadata().GetSlug())
		}
		if !strings.HasPrefix(share.GetMetadata().GetId(), "ash_") {
			t.Errorf("share id should carry the ash_ prefix, got %q", share.GetMetadata().GetId())
		}
		if got := share.GetSpec().GetAgentRef().GetOrg(); got != agent.GetMetadata().GetOrg() {
			t.Errorf("agent_ref.org should be normalized to the share org, got %q", got)
		}
	})

	t.Run("nonexistent agent is NOT_FOUND", func(t *testing.T) {
		_, err := tc.shares.Create(shareCtx(), &agentsharev1.AgentShare{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentShare",
			Metadata:   &apiresource.ApiResourceMetadata{Org: "test-org"},
			Spec: &agentsharev1.AgentShareSpec{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent,
					Slug: "no-such-agent",
				},
				Enabled: true,
			},
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND for a share of a nonexistent agent, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("cross-org agent_ref is FAILED_PRECONDITION (Phase A invariant)", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Cross Org Agent")
		share := shareFor(agent, true)
		share.Spec.AgentRef.Org = "some-other-org"

		_, err := tc.shares.Create(shareCtx(), share)
		if status.Code(err) != codes.FailedPrecondition {
			t.Errorf("expected FAILED_PRECONDITION for cross-org share, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("missing org is INVALID_ARGUMENT", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Orgless Share Agent")
		share := shareFor(agent, true)
		share.Metadata.Org = ""

		_, err := tc.shares.Create(shareCtx(), share)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for missing org, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("second canonical share for the same agent is ALREADY_EXISTS", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Duplicate Share Agent")
		createTestShare(t, tc, agent, true)

		_, err := tc.shares.Create(shareCtx(), shareFor(agent, true))
		if status.Code(err) != codes.AlreadyExists {
			t.Errorf("expected ALREADY_EXISTS for a duplicate canonical share, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("a named share coexists under its own slug", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Multi Channel Agent")
		createTestShare(t, tc, agent, true)

		named := shareFor(agent, true)
		named.Metadata.Name = "Docs Site Channel"
		second, err := tc.shares.Create(shareCtx(), named)
		if err != nil {
			t.Fatalf("named share Create failed: %v", err)
		}
		if second.GetMetadata().GetSlug() == agent.GetMetadata().GetSlug() {
			t.Error("a named share must get its own slug, not the agent's")
		}
	})
}

// TestAgentShareController_LaunchGateConfig pins persistence and validation
// of the launch-gate config fields (allowed_origins, messages). The Go
// edition stores the config; enforcement is cloud-only.
func TestAgentShareController_LaunchGateConfig(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("allowed_origins and messages persist and round-trip", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Launch Gate Config Agent")
		share := shareFor(agent, true)
		share.Spec.AllowedOrigins = []string{"https://docs.example.com", "http://localhost:3000"}
		share.Spec.Messages = &agentsharev1.AgentShareMessages{
			RateLimited:       "Custom rate copy",
			Unavailable:       "Custom unavailable copy",
			ConversationEnded: "Custom ended copy",
		}

		created, err := tc.shares.Create(shareCtx(), share)
		if err != nil {
			t.Fatalf("Create with config failed: %v", err)
		}

		fetched, err := tc.shares.Get(shareCtx(), &agentsharev1.AgentShareId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		spec := fetched.GetSpec()
		if len(spec.GetAllowedOrigins()) != 2 || spec.GetAllowedOrigins()[0] != "https://docs.example.com" {
			t.Errorf("allowed_origins did not round-trip: %v", spec.GetAllowedOrigins())
		}
		if spec.GetMessages().GetRateLimited() != "Custom rate copy" ||
			spec.GetMessages().GetUnavailable() != "Custom unavailable copy" ||
			spec.GetMessages().GetConversationEnded() != "Custom ended copy" {
			t.Errorf("messages did not round-trip: %+v", spec.GetMessages())
		}
	})

	t.Run("malformed origins are INVALID_ARGUMENT", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Origin Validation Agent")

		for _, origin := range []string{
			"docs.example.com",         // missing scheme
			"https://example.com/path", // path not allowed
			"https://example.com/",     // trailing slash not allowed
			"ftp://example.com",        // wrong scheme
			"https://example.com?q=1",  // query not allowed
		} {
			share := shareFor(agent, true)
			share.Spec.AllowedOrigins = []string{origin}
			_, err := tc.shares.Create(shareCtx(), share)
			if status.Code(err) != codes.InvalidArgument {
				t.Errorf("origin %q: expected INVALID_ARGUMENT, got %s (%v)", origin, status.Code(err), err)
			}
		}
	})

	t.Run("overlong custom message is INVALID_ARGUMENT", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Message Length Agent")
		share := shareFor(agent, true)
		share.Spec.Messages = &agentsharev1.AgentShareMessages{
			RateLimited: strings.Repeat("x", 301),
		}

		_, err := tc.shares.Create(shareCtx(), share)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for overlong message, got %s (%v)", status.Code(err), err)
		}
	})
}

// TestAgentShareController_EnvironmentRefsAudienceGate pins the Phase A
// rule: guest tool credentials bind to public-audience shares only.
// Org-audience members carry no share linkage, so bound credentials would
// silently never apply — the combination fails loud at the proto boundary.
func TestAgentShareController_EnvironmentRefsAudienceGate(t *testing.T) {
	tc := newTestControllers(t)
	agent := createTestAgent(t, tc, "Env Refs Audience Agent")

	envRef := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_environment,
		Org:  "test-org",
		Slug: "shared-credentials",
	}

	t.Run("environment_refs on an org-audience share is INVALID_ARGUMENT", func(t *testing.T) {
		share := shareFor(agent, true)
		share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
		share.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{envRef}

		_, err := tc.shares.Create(shareCtx(), share)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for env refs on an org share, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("environment_refs on a public-audience share persists", func(t *testing.T) {
		share := shareFor(agent, true)
		share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_public
		share.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{envRef}

		created, err := tc.shares.Create(shareCtx(), share)
		if err != nil {
			t.Fatalf("Create with env refs failed: %v", err)
		}
		if got := created.GetSpec().GetEnvironmentRefs(); len(got) != 1 || got[0].GetSlug() != "shared-credentials" {
			t.Errorf("environment_refs did not persist: %v", got)
		}
	})
}

func TestAgentShareController_Update(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("disable is a config-preserving pause", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Pause Agent")
		share := shareFor(agent, true)
		share.Spec.AllowedOrigins = []string{"https://docs.example.com"}
		created, err := tc.shares.Create(shareCtx(), share)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		paused := created
		paused.Spec.Enabled = false
		updated, err := tc.shares.Update(shareCtx(), paused)
		if err != nil {
			t.Fatalf("Update(disable) failed: %v", err)
		}
		if updated.GetSpec().GetEnabled() {
			t.Error("share should be disabled after update")
		}
		if len(updated.GetSpec().GetAllowedOrigins()) != 1 {
			t.Error("disabling must preserve the share's configuration")
		}
	})

	t.Run("agent_ref is immutable", func(t *testing.T) {
		agentA := createTestAgent(t, tc, "Immutable Ref Agent A")
		agentB := createTestAgent(t, tc, "Immutable Ref Agent B")
		created := createTestShare(t, tc, agentA, true)

		repointed := created
		repointed.Spec.AgentRef = &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Org:  agentB.GetMetadata().GetOrg(),
			Slug: agentB.GetMetadata().GetSlug(),
		}
		_, err := tc.shares.Update(shareCtx(), repointed)
		if status.Code(err) != codes.FailedPrecondition {
			t.Errorf("expected FAILED_PRECONDITION for a re-pointed agent_ref, got %s (%v)", status.Code(err), err)
		}
	})
}

func TestAgentShareController_GetSharedProfile(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Shared Profile Agent")
	ref := &agentsharev1.GetSharedProfileRequest{
		Org:  agent.Metadata.Org,
		Slug: agent.Metadata.Slug,
	}

	t.Run("agent without a share is NOT_FOUND", func(t *testing.T) {
		_, err := tc.shares.GetSharedProfile(shareCtx(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND without a share, got %s (%v)", status.Code(err), err)
		}
	})

	// Capture the no-share error for the indistinguishability checks below.
	_, noShareErr := tc.shares.GetSharedProfile(shareCtx(), ref)

	var share *agentsharev1.AgentShare

	t.Run("enabled share resolves to the trimmed profile", func(t *testing.T) {
		share = createTestShare(t, tc, agent, true)

		profile, err := tc.shares.GetSharedProfile(shareCtx(), ref)
		if err != nil {
			t.Fatalf("GetSharedProfile failed: %v", err)
		}
		if profile.GetOrg() != share.GetMetadata().GetOrg() {
			t.Errorf("profile org: expected %q, got %q", share.GetMetadata().GetOrg(), profile.GetOrg())
		}
		if profile.GetSlug() != share.GetMetadata().GetSlug() {
			t.Errorf("profile slug: expected %q, got %q", share.GetMetadata().GetSlug(), profile.GetSlug())
		}
		if profile.GetName() != agent.Metadata.Name {
			t.Errorf("profile name: expected %q, got %q", agent.Metadata.Name, profile.GetName())
		}
		if profile.GetDescription() != agent.GetSpec().GetDescription() {
			t.Errorf("profile description: expected %q, got %q",
				agent.GetSpec().GetDescription(), profile.GetDescription())
		}
		if profile.GetIconUrl() != agent.GetSpec().GetIconUrl() {
			t.Errorf("profile icon_url: expected %q, got %q",
				agent.GetSpec().GetIconUrl(), profile.GetIconUrl())
		}
		if profile.GetDefaultInstanceId() != agent.GetStatus().GetDefaultInstanceId() {
			t.Errorf("profile default_instance_id: expected %q, got %q",
				agent.GetStatus().GetDefaultInstanceId(), profile.GetDefaultInstanceId())
		}
	})

	t.Run("disabled share is NOT_FOUND, identical to the no-share error", func(t *testing.T) {
		share.Spec.Enabled = false
		if _, err := tc.shares.Update(shareCtx(), share); err != nil {
			t.Fatalf("Update(disable) failed: %v", err)
		}

		_, err := tc.shares.GetSharedProfile(shareCtx(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND after disable, got %s (%v)", status.Code(err), err)
		}
		// Compare the client-visible status message (what the gRPC transport
		// sends), not Error(), which carries an internal step-name prefix.
		if status.Convert(err).Message() != status.Convert(noShareErr).Message() {
			t.Errorf("disabled and no-share wire errors must be identical:\n  disabled: %v\n  no-share: %v",
				status.Convert(err).Message(), status.Convert(noShareErr).Message())
		}
	})

	t.Run("deleted share error is indistinguishable from no-share", func(t *testing.T) {
		if _, err := tc.shares.Delete(shareCtx(), &agentsharev1.AgentShareId{Value: share.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		_, err := tc.shares.GetSharedProfile(shareCtx(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for a deleted share, got %s (%v)", status.Code(err), err)
		}
		if status.Convert(err).Message() != status.Convert(noShareErr).Message() {
			t.Errorf("deleted and no-share wire errors must be indistinguishable:\n  deleted:  %v\n  no-share: %v",
				status.Convert(err).Message(), status.Convert(noShareErr).Message())
		}
	})

	t.Run("dangling agent_ref fails closed with the same error", func(t *testing.T) {
		danglingAgent := createTestAgent(t, tc, "Soon Deleted Agent")
		createTestShare(t, tc, danglingAgent, true)
		if _, err := tc.agents.Delete(agentCtx(), &agentv1.AgentId{Value: danglingAgent.Metadata.Id}); err != nil {
			t.Fatalf("agent Delete failed: %v", err)
		}

		danglingRef := &agentsharev1.GetSharedProfileRequest{
			Org:  danglingAgent.Metadata.Org,
			Slug: danglingAgent.Metadata.Slug,
		}
		_, err := tc.shares.GetSharedProfile(shareCtx(), danglingRef)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for a share whose agent is gone, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("empty org is INVALID_ARGUMENT", func(t *testing.T) {
		_, err := tc.shares.GetSharedProfile(shareCtx(), &agentsharev1.GetSharedProfileRequest{
			Org:  "",
			Slug: "any-slug",
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected INVALID_ARGUMENT for empty org, got %s (%v)", status.Code(err), err)
		}
		if !strings.Contains(err.Error(), "org is required") {
			t.Errorf("error should explain that org is required, got: %v", err)
		}
	})
}

// TestAgentShareController_Audience pins persistence of the audience field.
// The Go edition stores and echoes the audience; org-audience enforcement
// (membership checks) is cloud-only, so GetSharedProfileForMember resolves
// like GetSharedProfile here (the one local principal is effectively the
// organization).
func TestAgentShareController_Audience(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("audience persists and round-trips", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Audience Round Trip Agent")
		share := shareFor(agent, true)
		share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org

		created, err := tc.shares.Create(shareCtx(), share)
		if err != nil {
			t.Fatalf("Create with org audience failed: %v", err)
		}
		if got := created.GetSpec().GetAudience(); got != agentsharev1.AgentShareAudience_agent_share_audience_org {
			t.Errorf("expected org audience on response, got %v", got)
		}

		fetched, err := tc.shares.Get(shareCtx(), &agentsharev1.AgentShareId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if got := fetched.GetSpec().GetAudience(); got != agentsharev1.AgentShareAudience_agent_share_audience_org {
			t.Errorf("org audience did not persist, got %v", got)
		}
	})

	t.Run("member resolution path resolves shares in either audience", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Member Resolution Agent")
		ref := &apiresource.ApiResourceReference{
			Org:  agent.Metadata.Org,
			Slug: agent.Metadata.Slug,
		}

		// No share: NOT_FOUND through the member path too.
		if _, err := tc.shares.GetSharedProfileForMember(shareCtx(), ref); status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND without a share via member path, got %v", err)
		}

		share := shareFor(agent, true)
		share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
		if _, err := tc.shares.Create(shareCtx(), share); err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		profile, err := tc.shares.GetSharedProfileForMember(shareCtx(), ref)
		if err != nil {
			t.Fatalf("GetSharedProfileForMember failed: %v", err)
		}
		if profile.GetSlug() != agent.Metadata.Slug {
			t.Errorf("profile slug: expected %q, got %q", agent.Metadata.Slug, profile.GetSlug())
		}
	})
}

// TestAgentShareController_AgentApplyNeverTouchesShare pins the core
// guarantee of the promotion (decision 011): applying/updating the AGENT
// manifest cannot affect its share — the bug class where a manifest apply
// silently revoked or reset a share is structurally gone.
func TestAgentShareController_AgentApplyNeverTouchesShare(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Apply Isolation Agent")
	createTestShare(t, tc, agent, true)

	// A full agent update, as a YAML manifest apply would send it.
	agent.Spec.Description = "Updated description"
	if _, err := tc.agents.Update(agentCtx(), agent); err != nil {
		t.Fatalf("agent Update failed: %v", err)
	}

	profile, err := tc.shares.GetSharedProfile(shareCtx(), &agentsharev1.GetSharedProfileRequest{
		Org:  agent.Metadata.Org,
		Slug: agent.Metadata.Slug,
	})
	if err != nil {
		t.Fatalf("share must survive an agent manifest update, got %v", err)
	}
	if profile.GetDescription() != "Updated description" {
		t.Errorf("profile should reflect the updated agent description, got %q", profile.GetDescription())
	}
}

// TestAgentShareController_RotateShareLink pins the rotatable-share-token
// behavior: rotation locks the link behind a fresh server-generated token,
// re-rotation kills the previous token, and a share update preserves the
// token (it lives in status, which every update preserves verbatim — the
// design's core guarantee against declarative clobber).
func TestAgentShareController_RotateShareLink(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Rotate Link Agent")
	request := func(token string) *agentsharev1.GetSharedProfileRequest {
		return &agentsharev1.GetSharedProfileRequest{
			Org:       agent.Metadata.Org,
			Slug:      agent.Metadata.Slug,
			LinkToken: token,
		}
	}

	// Capture the no-share NOT_FOUND for this URL before creating the share —
	// the locked-link refusal must be byte-identical to it (the NOT_FOUND
	// message embeds the slug, so same-URL comparison is the meaningful one).
	_, noShareErr := tc.shares.GetSharedProfile(shareCtx(), request(""))

	share := createTestShare(t, tc, agent, true)

	t.Run("plain link ignores a stray token and resolves", func(t *testing.T) {
		if _, err := tc.shares.GetSharedProfile(shareCtx(), request("stray-token")); err != nil {
			t.Fatalf("a stray ?k= on an unlocked link must be harmless, got %v", err)
		}
	})

	var firstToken string

	t.Run("rotation generates a token and locks the link", func(t *testing.T) {
		rotated, err := tc.shares.RotateShareLink(shareCtx(), &agentsharev1.RotateShareLinkInput{
			ResourceId: share.Metadata.Id,
		})
		if err != nil {
			t.Fatalf("RotateShareLink failed: %v", err)
		}
		firstToken = rotated.GetStatus().GetShareLinkToken()
		if firstToken == "" {
			t.Fatal("rotation must set status.share_link_token")
		}

		// Tokenless resolution now refuses, indistinguishable from no-share.
		_, err = tc.shares.GetSharedProfile(shareCtx(), request(""))
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND without token on a locked link, got %v", err)
		}
		if status.Convert(err).Message() != status.Convert(noShareErr).Message() {
			t.Errorf("locked-link and no-share wire errors must be indistinguishable:\n  locked:   %v\n  no-share: %v",
				status.Convert(err).Message(), status.Convert(noShareErr).Message())
		}

		// The correct token resolves.
		if _, err := tc.shares.GetSharedProfile(shareCtx(), request(firstToken)); err != nil {
			t.Fatalf("GetSharedProfile with the rotated token failed: %v", err)
		}
	})

	t.Run("re-rotation kills the previous token", func(t *testing.T) {
		rotated, err := tc.shares.RotateShareLink(shareCtx(), &agentsharev1.RotateShareLinkInput{
			ResourceId: share.Metadata.Id,
		})
		if err != nil {
			t.Fatalf("RotateShareLink failed: %v", err)
		}
		secondToken := rotated.GetStatus().GetShareLinkToken()
		if secondToken == firstToken {
			t.Fatal("re-rotation must generate a different token")
		}

		if _, err := tc.shares.GetSharedProfile(shareCtx(), request(firstToken)); status.Code(err) != codes.NotFound {
			t.Errorf("the previous token must be dead after re-rotation, got %v", err)
		}
		if _, err := tc.shares.GetSharedProfile(shareCtx(), request(secondToken)); err != nil {
			t.Errorf("the new token must resolve, got %v", err)
		}
	})

	t.Run("member path refuses a token-locked public share", func(t *testing.T) {
		_, err := tc.shares.GetSharedProfileForMember(shareCtx(), &apiresource.ApiResourceReference{
			Org:  agent.Metadata.Org,
			Slug: agent.Metadata.Slug,
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("the tokenless member path must not reveal a token-locked public share, got %v", err)
		}
	})

	t.Run("share update preserves the token (status survives apply)", func(t *testing.T) {
		current, err := tc.shares.Get(shareCtx(), &agentsharev1.AgentShareId{Value: share.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		tokenBefore := current.GetStatus().GetShareLinkToken()
		if tokenBefore == "" {
			t.Fatal("precondition: link must be locked")
		}

		// A full-resource update as a manifest apply would send: no status.
		current.Status = nil
		updated, err := tc.shares.Update(shareCtx(), current)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if got := updated.GetStatus().GetShareLinkToken(); got != tokenBefore {
			t.Errorf("a share update must preserve status.share_link_token: before %q, after %q",
				tokenBefore, got)
		}
	})

	t.Run("nonexistent share is NOT_FOUND", func(t *testing.T) {
		_, err := tc.shares.RotateShareLink(shareCtx(), &agentsharev1.RotateShareLinkInput{
			ResourceId: "ash-does-not-exist",
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
	})
}

// TestAgentShareController_RotateShareLink_OrgAudienceMemberPath pins that
// the member path stays open for org-audience shares even when a token
// exists: the org gate is membership, not the link token.
func TestAgentShareController_RotateShareLink_OrgAudienceMemberPath(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Org Audience Rotate Agent")
	share := shareFor(agent, true)
	share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
	created, err := tc.shares.Create(shareCtx(), share)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if _, err := tc.shares.RotateShareLink(shareCtx(), &agentsharev1.RotateShareLinkInput{
		ResourceId: created.Metadata.Id,
	}); err != nil {
		t.Fatalf("RotateShareLink failed: %v", err)
	}

	if _, err := tc.shares.GetSharedProfileForMember(shareCtx(), &apiresource.ApiResourceReference{
		Org:  agent.Metadata.Org,
		Slug: agent.Metadata.Slug,
	}); err != nil {
		t.Errorf("org-audience member resolution must ignore the link token, got %v", err)
	}
}

func TestAgentShareController_GetByAgent(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("finds the canonical share and a renamed share", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Get By Agent Agent")
		canonical := createTestShare(t, tc, agent, true)

		renamed := shareFor(agent, true)
		renamed.Metadata.Name = "Renamed Channel"
		second, err := tc.shares.Create(shareCtx(), renamed)
		if err != nil {
			t.Fatalf("second share Create failed: %v", err)
		}

		list, err := tc.shares.GetByAgent(shareCtx(), &agentsharev1.GetAgentSharesByAgentRequest{
			AgentId: agent.Metadata.Id,
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 2 {
			t.Fatalf("expected both shares, got %d", list.GetTotalCount())
		}
		slugs := map[string]bool{}
		for _, item := range list.GetItems() {
			slugs[item.GetMetadata().GetSlug()] = true
		}
		if !slugs[canonical.GetMetadata().GetSlug()] || !slugs[second.GetMetadata().GetSlug()] {
			t.Errorf("expected canonical + renamed share slugs, got %v", slugs)
		}
	})

	t.Run("nonexistent agent yields an empty list", func(t *testing.T) {
		list, err := tc.shares.GetByAgent(shareCtx(), &agentsharev1.GetAgentSharesByAgentRequest{
			AgentId: "agt-does-not-exist",
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 0 {
			t.Errorf("expected an empty list for a nonexistent agent, got %d", list.GetTotalCount())
		}
	})
}

func TestAgentShareController_Apply(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Apply Semantics Agent")

	created, err := tc.shares.Apply(shareCtx(), shareFor(agent, true))
	if err != nil {
		t.Fatalf("Apply(create) failed: %v", err)
	}
	if created.GetMetadata().GetId() == "" {
		t.Fatal("apply-as-create must assign an id")
	}

	// Re-apply with a config change: must update in place, not duplicate.
	again := shareFor(agent, true)
	again.Spec.AllowedOrigins = []string{"https://docs.example.com"}
	updated, err := tc.shares.Apply(shareCtx(), again)
	if err != nil {
		t.Fatalf("Apply(update) failed: %v", err)
	}
	if updated.GetMetadata().GetId() != created.GetMetadata().GetId() {
		t.Errorf("apply must update the existing share, not create a new one: %q vs %q",
			updated.GetMetadata().GetId(), created.GetMetadata().GetId())
	}
	if len(updated.GetSpec().GetAllowedOrigins()) != 1 {
		t.Error("apply-as-update must carry the new configuration")
	}

	list, err := tc.shares.List(shareCtx(), &agentsharev1.ListAgentSharesRequest{Org: "test-org"})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if list.GetTotalCount() != 1 {
		t.Errorf("expected exactly one share after apply+apply, got %d", list.GetTotalCount())
	}
}
