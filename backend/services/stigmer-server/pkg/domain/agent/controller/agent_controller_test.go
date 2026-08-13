package agent

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/proto"
)

// contextWithAgentKind creates a context with the agent resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent)
}

func TestAgentController_Create(t *testing.T) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful creation", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "A test agent",
				Instructions: "You are a helpful test agent that assists with testing.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify pipeline set defaults
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "test-agent" {
			t.Errorf("Expected slug 'test-agent', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Agent" {
			t.Errorf("Expected kind 'Agent', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}
	})

	t.Run("duplicate detection", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Duplicate Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are a duplicate test agent.",
			},
		}

		// Create first time should succeed
		_, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("First create failed: %v", err)
		}

		// Create second time should fail (duplicate slug)
		_, err = controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected duplicate creation to fail")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata:   &apiresource.ApiResourceMetadata{},
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})
}

func TestAgentController_Update(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful update", func(t *testing.T) {
		// Create an agent first
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Original Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Original description",
				Instructions: "You are a helpful agent for update testing.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the agent
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithAgentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}
	})

	t.Run("update non-existent agent", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "non-existent-id",
				Name: "Non-existent Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are a non-existent agent.",
			},
		}

		_, err := controller.Update(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for updating non-existent agent")
		}
	})
}

func TestAgentController_Delete(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful deletion", func(t *testing.T) {
		// Create an agent first
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Agent to Delete",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are an agent that will be deleted.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the agent
		deleted, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted agent ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify agent is deleted
		_, err = controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted agent")
		}
	})

	t.Run("delete non-existent agent", func(t *testing.T) {
		_, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent agent")
		}
	})
}

// TestAgentController_Delete_Cascade pins the cascade contract (#611
// extended the #592 workflow ruling to agents): deleting an agent removes
// ALL of its instances — the system-managed default AND members' personal
// ones — and every AgentShare referencing it, while look-alike children of
// OTHER agents survive. Instance slugs are org-scoped, so an orphan would
// occupy its slug org-wide with no UI left to delete it; a stale share
// would silently rebind to whatever agent is later created at the slug.
func TestAgentController_Delete_Cascade(t *testing.T) {
	newAgent := func(name string) *agentv1.Agent {
		return &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are a cascade test agent.",
			},
		}
	}

	saveInstance := func(t *testing.T, s store.Store, id, slug, agentID string) {
		t.Helper()
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: slug,
				Slug: slug,
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{AgentId: agentID},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent_instance, id, instance); err != nil {
			t.Fatalf("failed to save instance %s: %v", id, err)
		}
	}

	saveShare := func(t *testing.T, s store.Store, id, shareSlug, agentSlug string) {
		t.Helper()
		share := &agentsharev1.AgentShare{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentShare",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: shareSlug,
				Slug: shareSlug,
				Org:  "test-org",
			},
			Spec: &agentsharev1.AgentShareSpec{
				AgentRef: &apiresource.ApiResourceReference{
					Org:  "test-org",
					Kind: apiresourcekind.ApiResourceKind_agent,
					Slug: agentSlug,
				},
				Enabled: true,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent_share, id, share); err != nil {
			t.Fatalf("failed to save share %s: %v", id, err)
		}
	}

	assertGone := func(t *testing.T, s store.Store, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) {
		t.Helper()
		if err := s.GetResource(context.Background(), kind, id, msg); err == nil {
			t.Errorf("expected %s %s to be cascade-deleted, but it still exists", kind, id)
		}
	}

	assertSurvives := func(t *testing.T, s store.Store, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) {
		t.Helper()
		if err := s.GetResource(context.Background(), kind, id, msg); err != nil {
			t.Errorf("expected %s %s to survive the cascade, but it is gone: %v", kind, id, err)
		}
	}

	t.Run("deletes the default instance (status pointer set)", func(t *testing.T) {
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		defer s.Close()
		controller := NewAgentController(s, nil)

		created, err := controller.Create(contextWithAgentKind(), newAgent("Pointer Agent"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		saveInstance(t, s, "ain_pointer", created.Metadata.Slug+"-default", created.Metadata.Id)
		created.Status = &agentv1.AgentStatus{DefaultInstanceId: "ain_pointer"}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, created.Metadata.Id, created); err != nil {
			t.Fatalf("failed to save agent with status: %v", err)
		}

		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_agent_instance, "ain_pointer", &agentinstancev1.AgentInstance{})
	})

	t.Run("deletes a legacy default instance that predates the status pointer", func(t *testing.T) {
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		defer s.Close()
		controller := NewAgentController(s, nil)

		// No status.default_instance_id (nil instance client leaves it unset)
		// — the half-created legacy shape. The spec.agent_id sweep covers it
		// without any pointer-or-slug resolution.
		created, err := controller.Create(contextWithAgentKind(), newAgent("Fallback Agent"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		saveInstance(t, s, "ain_fallback", created.Metadata.Slug+"-default", created.Metadata.Id)

		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_agent_instance, "ain_fallback", &agentinstancev1.AgentInstance{})
	})

	t.Run("cascades personal instances; other agents' look-alikes survive", func(t *testing.T) {
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		defer s.Close()
		controller := NewAgentController(s, nil)

		created, err := controller.Create(contextWithAgentKind(), newAgent("Survivor Agent"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// A member's personal instance of THIS agent (different slug): its
		// org-scoped slug must be freed with the agent (#611 — the earlier
		// posture left it as an orphan occupying the slug org-wide).
		saveInstance(t, s, "ain_personal", "my-personal-setup", created.Metadata.Id)
		// An instance that merely reuses the "-default" name but belongs to a
		// DIFFERENT agent — the spec.agent_id match must protect it.
		saveInstance(t, s, "ain_lookalike", created.Metadata.Slug+"-default", "agt_someone_else")

		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_agent_instance, "ain_personal", &agentinstancev1.AgentInstance{})
		assertSurvives(t, s, apiresourcekind.ApiResourceKind_agent_instance, "ain_lookalike", &agentinstancev1.AgentInstance{})
	})

	t.Run("deletes every share of the agent, including renamed ones", func(t *testing.T) {
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		defer s.Close()
		controller := NewAgentController(s, nil)

		created, err := controller.Create(contextWithAgentKind(), newAgent("Shared Agent"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		otherAgent, err := controller.Create(contextWithAgentKind(), newAgent("Other Agent"))
		if err != nil {
			t.Fatalf("Create (other) failed: %v", err)
		}

		// Canonical share (slug matches the agent) + a renamed share (own slug
		// diverged; still matched by spec.agent_ref — decision 011 D2).
		saveShare(t, s, "ash_canonical", created.Metadata.Slug, created.Metadata.Slug)
		saveShare(t, s, "ash_renamed", "customer-demo-link", created.Metadata.Slug)
		// A share of a DIFFERENT agent must survive.
		saveShare(t, s, "ash_other", otherAgent.Metadata.Slug, otherAgent.Metadata.Slug)

		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_agent_share, "ash_canonical", &agentsharev1.AgentShare{})
		assertGone(t, s, apiresourcekind.ApiResourceKind_agent_share, "ash_renamed", &agentsharev1.AgentShare{})
		assertSurvives(t, s, apiresourcekind.ApiResourceKind_agent_share, "ash_other", &agentsharev1.AgentShare{})
	})

	t.Run("recreate at the same slug converges after delete", func(t *testing.T) {
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		defer s.Close()
		controller := NewAgentController(s, nil)

		created, err := controller.Create(contextWithAgentKind(), newAgent("Recreate Agent"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		saveInstance(t, s, "ain_recreate", created.Metadata.Slug+"-default", created.Metadata.Id)
		created.Status = &agentv1.AgentStatus{DefaultInstanceId: "ain_recreate"}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, created.Metadata.Id, created); err != nil {
			t.Fatalf("failed to save agent with status: %v", err)
		}

		if _, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// The exact scenario the cascade exists for: a fresh create at the
		// same org/slug finds no orphan and succeeds cleanly.
		recreated, err := controller.Create(contextWithAgentKind(), newAgent("Recreate Agent"))
		if err != nil {
			t.Fatalf("Recreate at the same slug failed: %v", err)
		}
		if recreated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("expected recreated slug %q, got %q", created.Metadata.Slug, recreated.Metadata.Slug)
		}
		if recreated.Metadata.Id == created.Metadata.Id {
			t.Error("expected a fresh agent ID on recreate")
		}
	})
}

// TestAgentController_UpdateVisibility_PreservesCreationAudit pins the
// call-site half of the stigmer/stigmer#453 fix: a visibility flip must
// not rewrite spec_audit.created_by/created_at (before the fix,
// steps.SetAuditFieldsForUpdate rebuilt the whole audit block, resetting
// creation to system/now — which also reordered every created_at-sorted
// list). The steps package pins the helper contract; this test proves the
// preservation survives the full update-visibility pipeline.
func TestAgentController_UpdateVisibility_PreservesCreationAudit(t *testing.T) {
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()
	controller := NewAgentController(s, nil)

	created, err := controller.Create(contextWithAgentKind(), &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Audit Pin Agent",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are an agent pinning audit preservation.",
		},
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	originalSpecAudit := created.GetStatus().GetAudit().GetSpecAudit()
	if originalSpecAudit.GetCreatedAt() == nil || originalSpecAudit.GetCreatedBy() == nil {
		t.Fatalf("precondition: create should stamp spec_audit creation, got %v", originalSpecAudit)
	}

	updated, err := controller.UpdateVisibility(contextWithAgentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.Metadata.Id,
		Visibility: apiresource.ApiResourceVisibility_visibility_private,
	})
	if err != nil {
		t.Fatalf("UpdateVisibility failed: %v", err)
	}

	if updated.Metadata.Visibility != apiresource.ApiResourceVisibility_visibility_private {
		t.Errorf("Expected visibility_private, got %v", updated.Metadata.Visibility)
	}

	specAudit := updated.GetStatus().GetAudit().GetSpecAudit()
	if !proto.Equal(specAudit.GetCreatedAt(), originalSpecAudit.GetCreatedAt()) {
		t.Errorf("spec_audit.created_at destroyed by visibility flip: want %v, got %v",
			originalSpecAudit.GetCreatedAt(), specAudit.GetCreatedAt())
	}
	if !proto.Equal(specAudit.GetCreatedBy(), originalSpecAudit.GetCreatedBy()) {
		t.Errorf("spec_audit.created_by destroyed by visibility flip: want %v, got %v",
			originalSpecAudit.GetCreatedBy(), specAudit.GetCreatedBy())
	}
	if specAudit.GetEvent() != "updated" {
		t.Errorf("spec_audit.event: want updated, got %q", specAudit.GetEvent())
	}

	// The persisted row must agree with the response.
	persisted := &agentv1.Agent{}
	if err := s.GetResource(context.Background(), apiresourcekind.ApiResourceKind_agent, created.Metadata.Id, persisted); err != nil {
		t.Fatalf("failed to reload agent: %v", err)
	}
	if !proto.Equal(persisted.GetStatus().GetAudit().GetSpecAudit().GetCreatedAt(), originalSpecAudit.GetCreatedAt()) {
		t.Errorf("persisted spec_audit.created_at destroyed: want %v, got %v",
			originalSpecAudit.GetCreatedAt(), persisted.GetStatus().GetAudit().GetSpecAudit().GetCreatedAt())
	}
}

func TestAgentController_MergeMcpServerEnvSpecs(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil)

	t.Run("merges env from referenced MCP server", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_1",
				Name: "Test MCP Server",
				Slug: "test-mcp-server",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "An MCP server for testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"API_KEY": {
						Description: "API key for the MCP server",
						IsSecret:    true,
					},
					"API_URL": {
						Description: "Base URL for the API",
						IsSecret:    false,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_1", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Agent With MCP",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent that uses an MCP server",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "test-mcp-server",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated, got nil")
		}
		if len(envDecls) != 2 {
			t.Fatalf("Expected 2 env vars, got %d", len(envDecls))
		}
		if apiKey, ok := envDecls["API_KEY"]; !ok {
			t.Error("Expected API_KEY in env")
		} else {
			if !apiKey.IsSecret {
				t.Error("Expected API_KEY.is_secret to be true")
			}
		}
		if apiUrl, ok := envDecls["API_URL"]; !ok {
			t.Error("Expected API_URL in env")
		} else {
			if apiUrl.IsSecret {
				t.Error("Expected API_URL.is_secret to be false")
			}
		}
	})

	t.Run("agent-declared env vars take precedence", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_2",
				Name: "Precedence MCP Server",
				Slug: "precedence-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for precedence testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"SHARED_VAR": {
						Description: "MCP description",
						IsSecret:    false,
					},
					"MCP_ONLY_VAR": {
						Description: "Only from MCP",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_2", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Precedence Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent testing precedence",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "precedence-mcp",
						},
					},
				},
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"SHARED_VAR": {
						Description: "Agent description wins",
						IsSecret:    true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 2 {
			t.Fatalf("Expected 2 env vars, got %d", len(envDecls))
		}

		sharedVar := envDecls["SHARED_VAR"]
		if sharedVar.Description != "Agent description wins" {
			t.Errorf("Expected agent description to win, got %q", sharedVar.Description)
		}
		if !sharedVar.IsSecret {
			t.Error("Expected agent's is_secret=true to be preserved")
		}

		if _, ok := envDecls["MCP_ONLY_VAR"]; !ok {
			t.Error("Expected MCP_ONLY_VAR to be merged from MCP server")
		}
	})

	t.Run("no MCP usages is a no-op", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "No MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent without MCP servers",
				Instructions: "You are a helpful agent.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 0 {
			t.Errorf("Expected empty env, got %d entries", len(envDecls))
		}
	})

	t.Run("missing MCP server is rejected", func(t *testing.T) {
		// The ValidateReferences pipeline step (which runs before
		// MergeMcpServerEnvSpecs) strictly rejects references to MCP servers
		// that do not exist, so Create fails with FAILED_PRECONDITION.
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Missing MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent referencing non-existent MCP server",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "does-not-exist",
						},
					},
				},
			},
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Fatal("Create should fail when referencing a non-existent MCP server")
		}
		if !strings.Contains(err.Error(), "does-not-exist") {
			t.Errorf("expected error to mention the missing MCP server slug, got: %v", err)
		}
	})

	t.Run("multiple MCP servers with overlapping env vars", func(t *testing.T) {
		mcpServerA := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_a",
				Name: "MCP Server A",
				Slug: "mcp-server-a",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "First MCP server",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"COMMON_KEY": {
						Description: "From server A",
						IsSecret:    true,
					},
					"A_ONLY": {
						Description: "Only in A",
						IsSecret:    false,
					},
				},
			},
		}
		mcpServerB := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_b",
				Name: "MCP Server B",
				Slug: "mcp-server-b",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Second MCP server",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"COMMON_KEY": {
						Description: "From server B",
						IsSecret:    false,
					},
					"B_ONLY": {
						Description: "Only in B",
						IsSecret:    true,
					},
				},
			},
		}

		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_a", mcpServerA); err != nil {
			t.Fatalf("failed to save MCP server A: %v", err)
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_b", mcpServerB); err != nil {
			t.Fatalf("failed to save MCP server B: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Multi MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent with multiple MCP servers",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "mcp-server-a",
						},
					},
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "mcp-server-b",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 3 {
			t.Fatalf("Expected 3 env vars (COMMON_KEY, A_ONLY, B_ONLY), got %d", len(envDecls))
		}

		if _, ok := envDecls["A_ONLY"]; !ok {
			t.Error("Expected A_ONLY from MCP server A")
		}
		if _, ok := envDecls["B_ONLY"]; !ok {
			t.Error("Expected B_ONLY from MCP server B")
		}
		if _, ok := envDecls["COMMON_KEY"]; !ok {
			t.Error("Expected COMMON_KEY (first-encountered wins)")
		}
	})

	t.Run("merges env when mcp_server_ref omits org", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_no-org-ref",
				Name: "No Org Ref MCP",
				Slug: "no-org-ref-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for org fallback testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"FALLBACK_KEY": {
						Description: "Resolved via agent org fallback",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_no-org-ref", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Org Fallback Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent with mcp_server_ref that omits org",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "no-org-ref-mcp",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated via org fallback, got nil")
		}
		if len(envDecls) != 1 {
			t.Fatalf("Expected 1 env var, got %d", len(envDecls))
		}
		if fallbackKey, ok := envDecls["FALLBACK_KEY"]; !ok {
			t.Error("Expected FALLBACK_KEY in env")
		} else {
			if !fallbackKey.IsSecret {
				t.Error("Expected FALLBACK_KEY.is_secret to be true")
			}
		}
	})

	t.Run("update also merges MCP env declarations", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_update",
				Name: "Update MCP Server",
				Slug: "update-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for update testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"UPDATE_KEY": {
						Description: "Key added during update",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_update", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Update Merge Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent for update merge testing",
				Instructions: "You are a helpful agent.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.McpServerUsages = []*agentv1.McpServerUsage{
			{
				McpServerRef: &apiresource.ApiResourceReference{
					Org:  "test-org",
					Kind: apiresourcekind.ApiResourceKind_mcp_server,
					Slug: "update-mcp",
				},
			},
		}

		updated, err := controller.Update(contextWithAgentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		envDecls := updated.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated after update, got nil")
		}
		if _, ok := envDecls["UPDATE_KEY"]; !ok {
			t.Error("Expected UPDATE_KEY to be merged from MCP server during update")
		}
	})
}
