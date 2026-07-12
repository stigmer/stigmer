package agent

import (
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newSharingTestController(t *testing.T) *AgentController {
	t.Helper()
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return NewAgentController(store, nil)
}

func createSharingTestAgent(t *testing.T, controller *AgentController, name string) *agentv1.Agent {
	t.Helper()
	created, err := controller.Create(contextWithAgentKind(), &agentv1.Agent{
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
		t.Fatalf("Create failed: %v", err)
	}
	return created
}

func TestAgentController_UpdateSharing(t *testing.T) {
	controller := newSharingTestController(t)

	t.Run("enables and revokes sharing without touching other spec fields", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Sharing Toggle Agent")
		if created.GetSpec().GetSharing().GetEnabled() {
			t.Fatal("a new agent must not be shared by default")
		}

		updated, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing:    &agentv1.AgentSharing{Enabled: true},
		})
		if err != nil {
			t.Fatalf("UpdateSharing(enable) failed: %v", err)
		}
		if !updated.GetSpec().GetSharing().GetEnabled() {
			t.Error("sharing should be enabled after update")
		}
		if updated.GetSpec().GetInstructions() != created.GetSpec().GetInstructions() {
			t.Error("targeted sharing update must not touch instructions")
		}

		got, err := controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if !got.GetSpec().GetSharing().GetEnabled() {
			t.Error("enabled sharing must persist")
		}

		reverted, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing:    &agentv1.AgentSharing{Enabled: false},
		})
		if err != nil {
			t.Fatalf("UpdateSharing(disable) failed: %v", err)
		}
		if reverted.GetSpec().GetSharing().GetEnabled() {
			t.Error("sharing should be disabled after revert")
		}
	})

	t.Run("nonexistent agent is NOT_FOUND", func(t *testing.T) {
		_, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: "agt-does-not-exist",
			Sharing:    &agentv1.AgentSharing{Enabled: true},
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
	})
}

// TestAgentController_UpdateSharing_LaunchGateConfig pins persistence and
// validation of the T01 launch-gate config fields (allowed_origins, messages).
// The Go edition stores the config; enforcement is cloud-only.
func TestAgentController_UpdateSharing_LaunchGateConfig(t *testing.T) {
	controller := newSharingTestController(t)

	t.Run("allowed_origins and messages persist and round-trip", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Launch Gate Config Agent")

		updated, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing: &agentv1.AgentSharing{
				Enabled:        true,
				AllowedOrigins: []string{"https://docs.example.com", "http://localhost:3000"},
				Messages: &agentv1.AgentSharingMessages{
					RateLimited:       "Custom rate copy",
					Unavailable:       "Custom unavailable copy",
					ConversationEnded: "Custom ended copy",
				},
			},
		})
		if err != nil {
			t.Fatalf("UpdateSharing with config failed: %v", err)
		}
		if got := updated.GetSpec().GetSharing().GetAllowedOrigins(); len(got) != 2 {
			t.Errorf("expected 2 allowed origins, got %v", got)
		}

		fetched, err := controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		sharing := fetched.GetSpec().GetSharing()
		if sharing.GetAllowedOrigins()[0] != "https://docs.example.com" {
			t.Errorf("allowed_origins did not round-trip: %v", sharing.GetAllowedOrigins())
		}
		if sharing.GetMessages().GetRateLimited() != "Custom rate copy" ||
			sharing.GetMessages().GetUnavailable() != "Custom unavailable copy" ||
			sharing.GetMessages().GetConversationEnded() != "Custom ended copy" {
			t.Errorf("messages did not round-trip: %+v", sharing.GetMessages())
		}
	})

	t.Run("malformed origins are INVALID_ARGUMENT", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Origin Validation Agent")

		for _, origin := range []string{
			"docs.example.com",         // missing scheme
			"https://example.com/path", // path not allowed
			"https://example.com/",     // trailing slash not allowed
			"ftp://example.com",        // wrong scheme
			"https://example.com?q=1",  // query not allowed
		} {
			_, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
				ResourceId: created.Metadata.Id,
				Sharing: &agentv1.AgentSharing{
					Enabled:        true,
					AllowedOrigins: []string{origin},
				},
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Errorf("origin %q: expected INVALID_ARGUMENT, got %s (%v)", origin, status.Code(err), err)
			}
		}
	})

	t.Run("overlong custom message is INVALID_ARGUMENT", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Message Length Agent")

		_, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing: &agentv1.AgentSharing{
				Enabled: true,
				Messages: &agentv1.AgentSharingMessages{
					RateLimited: strings.Repeat("x", 301),
				},
			},
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for overlong message, got %s (%v)", status.Code(err), err)
		}
	})
}

func TestAgentController_GetSharedProfile(t *testing.T) {
	controller := newSharingTestController(t)

	created := createSharingTestAgent(t, controller, "Shared Profile Agent")
	ref := &agentv1.GetSharedProfileRequest{
		Org:  created.Metadata.Org,
		Slug: created.Metadata.Slug,
	}

	t.Run("unshared agent is NOT_FOUND", func(t *testing.T) {
		_, err := controller.GetSharedProfile(contextWithAgentKind(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for unshared agent, got %s (%v)", status.Code(err), err)
		}
	})

	// Capture the unshared error for the indistinguishability checks below.
	_, unsharedErr := controller.GetSharedProfile(contextWithAgentKind(), ref)

	t.Run("shared agent resolves to the trimmed profile", func(t *testing.T) {
		if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing:    &agentv1.AgentSharing{Enabled: true},
		}); err != nil {
			t.Fatalf("UpdateSharing failed: %v", err)
		}

		profile, err := controller.GetSharedProfile(contextWithAgentKind(), ref)
		if err != nil {
			t.Fatalf("GetSharedProfile failed: %v", err)
		}
		if profile.GetOrg() != created.Metadata.Org {
			t.Errorf("profile org: expected %q, got %q", created.Metadata.Org, profile.GetOrg())
		}
		if profile.GetSlug() != created.Metadata.Slug {
			t.Errorf("profile slug: expected %q, got %q", created.Metadata.Slug, profile.GetSlug())
		}
		if profile.GetName() != created.Metadata.Name {
			t.Errorf("profile name: expected %q, got %q", created.Metadata.Name, profile.GetName())
		}
		if profile.GetDescription() != created.GetSpec().GetDescription() {
			t.Errorf("profile description: expected %q, got %q",
				created.GetSpec().GetDescription(), profile.GetDescription())
		}
		if profile.GetIconUrl() != created.GetSpec().GetIconUrl() {
			t.Errorf("profile icon_url: expected %q, got %q",
				created.GetSpec().GetIconUrl(), profile.GetIconUrl())
		}
		if profile.GetDefaultInstanceId() != created.GetStatus().GetDefaultInstanceId() {
			t.Errorf("profile default_instance_id: expected %q, got %q",
				created.GetStatus().GetDefaultInstanceId(), profile.GetDefaultInstanceId())
		}
	})

	t.Run("revoked share is NOT_FOUND, identical to the unshared error", func(t *testing.T) {
		if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing:    &agentv1.AgentSharing{Enabled: false},
		}); err != nil {
			t.Fatalf("UpdateSharing(revoke) failed: %v", err)
		}

		_, err := controller.GetSharedProfile(contextWithAgentKind(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND after revoke, got %s (%v)", status.Code(err), err)
		}
		// Compare the client-visible status message (what the gRPC transport
		// sends), not Error(), which carries an internal step-name prefix.
		if status.Convert(err).Message() != status.Convert(unsharedErr).Message() {
			t.Errorf("revoked and unshared wire errors must be identical:\n  revoked:  %v\n  unshared: %v",
				status.Convert(err).Message(), status.Convert(unsharedErr).Message())
		}
	})

	t.Run("nonexistent agent error is indistinguishable from unshared", func(t *testing.T) {
		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		_, err := controller.GetSharedProfile(contextWithAgentKind(), ref)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for deleted agent, got %s (%v)", status.Code(err), err)
		}
		// The wire-visible message must match the unshared case exactly, so
		// the URL leaks nothing about whether the agent exists.
		if status.Convert(err).Message() != status.Convert(unsharedErr).Message() {
			t.Errorf("nonexistent and unshared wire errors must be indistinguishable:\n  missing:  %v\n  unshared: %v",
				status.Convert(err).Message(), status.Convert(unsharedErr).Message())
		}
	})

	t.Run("empty org is INVALID_ARGUMENT", func(t *testing.T) {
		_, err := controller.GetSharedProfile(contextWithAgentKind(), &agentv1.GetSharedProfileRequest{
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

// TestAgentController_UpdateSharing_Audience pins persistence of the T07
// audience field. The Go edition stores and echoes the audience; org-audience
// enforcement (membership checks) is cloud-only, so GetSharedProfileForMember
// resolves like GetSharedProfile here (the one local principal is effectively
// the organization).
func TestAgentController_UpdateSharing_Audience(t *testing.T) {
	controller := newSharingTestController(t)

	t.Run("audience persists and round-trips through update and get", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Audience Round Trip Agent")

		updated, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing: &agentv1.AgentSharing{
				Enabled:  true,
				Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
			},
		})
		if err != nil {
			t.Fatalf("UpdateSharing with org audience failed: %v", err)
		}
		if got := updated.GetSpec().GetSharing().GetAudience(); got != agentv1.AgentSharingAudience_agent_sharing_audience_org {
			t.Errorf("expected org audience on response, got %v", got)
		}

		fetched, err := controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if got := fetched.GetSpec().GetSharing().GetAudience(); got != agentv1.AgentSharingAudience_agent_sharing_audience_org {
			t.Errorf("org audience did not persist, got %v", got)
		}
	})

	t.Run("unspecified audience means public and survives a toggle", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Audience Default Agent")

		updated, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing:    &agentv1.AgentSharing{Enabled: true},
		})
		if err != nil {
			t.Fatalf("UpdateSharing failed: %v", err)
		}
		if got := updated.GetSpec().GetSharing().GetAudience(); got != agentv1.AgentSharingAudience_agent_sharing_audience_unspecified {
			t.Errorf("expected unspecified audience (treated as public), got %v", got)
		}
	})

	t.Run("member resolution path resolves shared agents in either audience", func(t *testing.T) {
		created := createSharingTestAgent(t, controller, "Member Resolution Agent")
		ref := &apiresource.ApiResourceReference{
			Org:  created.Metadata.Org,
			Slug: created.Metadata.Slug,
		}

		// Unshared: NOT_FOUND through the member path too.
		if _, err := controller.GetSharedProfileForMember(contextWithAgentKind(), ref); status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for unshared agent via member path, got %v", err)
		}

		if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
			ResourceId: created.Metadata.Id,
			Sharing: &agentv1.AgentSharing{
				Enabled:  true,
				Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
			},
		}); err != nil {
			t.Fatalf("UpdateSharing failed: %v", err)
		}

		profile, err := controller.GetSharedProfileForMember(contextWithAgentKind(), ref)
		if err != nil {
			t.Fatalf("GetSharedProfileForMember failed: %v", err)
		}
		if profile.GetSlug() != created.Metadata.Slug {
			t.Errorf("profile slug: expected %q, got %q", created.Metadata.Slug, profile.GetSlug())
		}
	})
}

// TestAgentController_Update_OmittingSharing_Revokes pins the declarative
// spec semantics in the Go edition: a full update whose spec omits sharing
// revokes an active share (fails closed). Mirrors the cloud-edition
// integration test of the same name.
func TestAgentController_Update_OmittingSharing_Revokes(t *testing.T) {
	controller := newSharingTestController(t)

	created := createSharingTestAgent(t, controller, "Omission Revoke Agent")
	if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
		ResourceId: created.Metadata.Id,
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	}); err != nil {
		t.Fatalf("UpdateSharing failed: %v", err)
	}

	// A full-resource update whose spec omits sharing, as a YAML manifest
	// written before sharing existed would.
	created.Spec.Sharing = nil
	updated, err := controller.Update(contextWithAgentKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.GetSpec().GetSharing().GetEnabled() {
		t.Error("an update omitting spec.sharing must revoke the share (fails closed)")
	}

	_, err = controller.GetSharedProfile(contextWithAgentKind(), &agentv1.GetSharedProfileRequest{
		Org:  created.Metadata.Org,
		Slug: created.Metadata.Slug,
	})
	if status.Code(err) != codes.NotFound {
		t.Errorf("shared link must stop working after the omitting update, got %s (%v)",
			status.Code(err), err)
	}
}

// TestAgentController_RotateShareLink pins the rotatable-share-token
// behavior: rotation locks the link behind a fresh server-generated token,
// re-rotation kills the previous token, and a full update preserves the
// token (it lives in status, which every update preserves verbatim — the
// design's core guarantee against declarative clobber).
func TestAgentController_RotateShareLink(t *testing.T) {
	controller := newSharingTestController(t)

	created := createSharingTestAgent(t, controller, "Rotate Link Agent")
	request := func(token string) *agentv1.GetSharedProfileRequest {
		return &agentv1.GetSharedProfileRequest{
			Org:       created.Metadata.Org,
			Slug:      created.Metadata.Slug,
			LinkToken: token,
		}
	}

	// Capture the unshared NOT_FOUND for this URL before enabling sharing —
	// the locked-link refusal must be byte-identical to it (the NOT_FOUND
	// message embeds the slug, so same-URL comparison is the meaningful one).
	_, unsharedErr := controller.GetSharedProfile(contextWithAgentKind(), request(""))

	if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
		ResourceId: created.Metadata.Id,
		Sharing:    &agentv1.AgentSharing{Enabled: true},
	}); err != nil {
		t.Fatalf("UpdateSharing failed: %v", err)
	}

	t.Run("plain link ignores a stray token and resolves", func(t *testing.T) {
		if _, err := controller.GetSharedProfile(contextWithAgentKind(), request("stray-token")); err != nil {
			t.Fatalf("a stray ?k= on an unlocked link must be harmless, got %v", err)
		}
	})

	var firstToken string

	t.Run("rotation generates a token and locks the link", func(t *testing.T) {
		rotated, err := controller.RotateShareLink(contextWithAgentKind(), &agentv1.RotateShareLinkInput{
			ResourceId: created.Metadata.Id,
		})
		if err != nil {
			t.Fatalf("RotateShareLink failed: %v", err)
		}
		firstToken = rotated.GetStatus().GetShareLinkToken()
		if firstToken == "" {
			t.Fatal("rotation must set status.share_link_token")
		}
		if rotated.GetStatus().GetDefaultInstanceId() != created.GetStatus().GetDefaultInstanceId() {
			t.Error("rotation must preserve the rest of status (default_instance_id)")
		}

		// Tokenless resolution now refuses, indistinguishable from unshared.
		_, err = controller.GetSharedProfile(contextWithAgentKind(), request(""))
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND without token on a locked link, got %v", err)
		}
		if status.Convert(err).Message() != status.Convert(unsharedErr).Message() {
			t.Errorf("locked-link and unshared wire errors must be indistinguishable:\n  locked:   %v\n  unshared: %v",
				status.Convert(err).Message(), status.Convert(unsharedErr).Message())
		}

		// The correct token resolves.
		if _, err := controller.GetSharedProfile(contextWithAgentKind(), request(firstToken)); err != nil {
			t.Fatalf("GetSharedProfile with the rotated token failed: %v", err)
		}
	})

	t.Run("re-rotation kills the previous token", func(t *testing.T) {
		rotated, err := controller.RotateShareLink(contextWithAgentKind(), &agentv1.RotateShareLinkInput{
			ResourceId: created.Metadata.Id,
		})
		if err != nil {
			t.Fatalf("RotateShareLink failed: %v", err)
		}
		secondToken := rotated.GetStatus().GetShareLinkToken()
		if secondToken == firstToken {
			t.Fatal("re-rotation must generate a different token")
		}

		if _, err := controller.GetSharedProfile(contextWithAgentKind(), request(firstToken)); status.Code(err) != codes.NotFound {
			t.Errorf("the previous token must be dead after re-rotation, got %v", err)
		}
		if _, err := controller.GetSharedProfile(contextWithAgentKind(), request(secondToken)); err != nil {
			t.Errorf("the new token must resolve, got %v", err)
		}
	})

	t.Run("member path refuses a token-locked public share", func(t *testing.T) {
		_, err := controller.GetSharedProfileForMember(contextWithAgentKind(), &apiresource.ApiResourceReference{
			Org:  created.Metadata.Org,
			Slug: created.Metadata.Slug,
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("the tokenless member path must not reveal a token-locked public share, got %v", err)
		}
	})

	t.Run("full update preserves the token (status survives apply)", func(t *testing.T) {
		current, err := controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		tokenBefore := current.GetStatus().GetShareLinkToken()
		if tokenBefore == "" {
			t.Fatal("precondition: link must be locked")
		}

		// A full-resource update as a manifest apply would send: no status.
		current.Status = nil
		updated, err := controller.Update(contextWithAgentKind(), current)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if got := updated.GetStatus().GetShareLinkToken(); got != tokenBefore {
			t.Errorf("a full update must preserve status.share_link_token: before %q, after %q",
				tokenBefore, got)
		}
	})

	t.Run("nonexistent agent is NOT_FOUND", func(t *testing.T) {
		_, err := controller.RotateShareLink(contextWithAgentKind(), &agentv1.RotateShareLinkInput{
			ResourceId: "agt-does-not-exist",
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
	})
}

// TestAgentController_RotateShareLink_OrgAudienceMemberPath pins that the
// member path stays open for org-audience shares even when a token exists:
// the org gate is membership, not the link token.
func TestAgentController_RotateShareLink_OrgAudienceMemberPath(t *testing.T) {
	controller := newSharingTestController(t)

	created := createSharingTestAgent(t, controller, "Org Audience Rotate Agent")
	if _, err := controller.UpdateSharing(contextWithAgentKind(), &agentv1.UpdateAgentSharingInput{
		ResourceId: created.Metadata.Id,
		Sharing: &agentv1.AgentSharing{
			Enabled:  true,
			Audience: agentv1.AgentSharingAudience_agent_sharing_audience_org,
		},
	}); err != nil {
		t.Fatalf("UpdateSharing failed: %v", err)
	}
	if _, err := controller.RotateShareLink(contextWithAgentKind(), &agentv1.RotateShareLinkInput{
		ResourceId: created.Metadata.Id,
	}); err != nil {
		t.Fatalf("RotateShareLink failed: %v", err)
	}

	if _, err := controller.GetSharedProfileForMember(contextWithAgentKind(), &apiresource.ApiResourceReference{
		Org:  created.Metadata.Org,
		Slug: created.Metadata.Slug,
	}); err != nil {
		t.Errorf("org-audience member resolution must ignore the link token, got %v", err)
	}
}
