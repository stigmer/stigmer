package agentinstance

import (
	"context"
	"testing"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// contextWithAgentInstanceKind creates a context with the agent instance resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentInstanceKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent_instance)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*AgentInstanceController, store.Store) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewAgentInstanceController(store)

	return controller, store
}

func TestAgentInstanceController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with agent_id", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test instance description",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify defaults set by pipeline
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "test-instance" {
			t.Errorf("Expected slug 'test-instance', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "AgentInstance" {
			t.Errorf("Expected kind 'AgentInstance', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify agent_id is preserved
		if created.Spec.AgentId != "test-agent-id" {
			t.Errorf("Expected agent_id 'test-agent-id', got '%s'", created.Spec.AgentId)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test instance description" {
			t.Errorf("Expected description 'Test instance description', got '%s'", created.Spec.Description)
		}
	})

	t.Run("validation error - missing agent_id", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Invalid Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error when agent_id is not provided")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

}

func TestAgentInstanceController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create instance first
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Get Test Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the instance
		retrieved, err := controller.Get(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}

		if retrieved.Spec.AgentId != "test-agent-id" {
			t.Errorf("Expected agent_id 'test-agent-id', got '%s'", retrieved.Spec.AgentId)
		}
	})

	t.Run("get non-existent instance", func(t *testing.T) {
		_, err := controller.Get(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent instance")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestAgentInstanceController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create instance first
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Update Test Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Original description",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the instance
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithAgentInstanceKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("update non-existent instance", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "non-existent-id",
				Name: "Non-existent Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
			},
		}

		_, err := controller.Update(contextWithAgentInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for updating non-existent instance")
		}
	})

}

func TestAgentInstanceController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create instance first
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Delete Test Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the instance
		deleted, err := controller.Delete(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted instance ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify instance is deleted
		_, err = controller.Get(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted instance")
		}
	})

	t.Run("delete non-existent instance", func(t *testing.T) {
		_, err := controller.Delete(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent instance")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted instance returns correct data", func(t *testing.T) {
		// Create instance with specific data
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Delete Verify Instance",
				Org:  "test-org",
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "verify-agent-id",
				Description: "Verify deletion data",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.AgentId != "verify-agent-id" {
			t.Errorf("Expected agent_id 'verify-agent-id', got '%s'", deleted.Spec.AgentId)
		}

		if deleted.Spec.Description != "Verify deletion data" {
			t.Errorf("Expected description 'Verify deletion data', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Instance" {
			t.Errorf("Expected name 'Delete Verify Instance', got '%s'", deleted.Metadata.Name)
		}
	})
}

func TestAgentInstanceController_GetByAgent(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	newInstance := func(name, org, agentId string) *agentinstancev1.AgentInstance {
		return &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  org,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     agentId,
				Description: "Instance for get-by-agent tests",
			},
		}
	}

	// One agent with instances in two orgs (the cross-org marketplace
	// case), plus an unrelated agent's instance that must never appear.
	for _, inst := range []*agentinstancev1.AgentInstance{
		newInstance("Home Org Instance", "home-org", "agt-scoped"),
		newInstance("Consumer Org Instance", "consumer-org", "agt-scoped"),
		newInstance("Unrelated Instance", "home-org", "agt-other"),
	} {
		if _, err := controller.Create(contextWithAgentInstanceKind(), inst); err != nil {
			t.Fatalf("Create failed for %s: %v", inst.Metadata.Name, err)
		}
	}

	t.Run("filters by agent_id", func(t *testing.T) {
		list, err := controller.GetByAgent(contextWithAgentInstanceKind(), &agentinstancev1.GetAgentInstancesByAgentRequest{
			AgentId: "agt-scoped",
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 2 {
			t.Fatalf("expected both orgs' instances, got %d", list.GetTotalCount())
		}
		for _, inst := range list.GetItems() {
			if inst.GetSpec().GetAgentId() != "agt-scoped" {
				t.Errorf("leaked an instance of agent %q", inst.GetSpec().GetAgentId())
			}
		}
	})

	// The org scope keeps each org's console tab on its own instances: a
	// caller who can see several orgs' instances of the same agent asks
	// for one org and gets exactly that org's rows.
	t.Run("org scopes the list to one org's instances", func(t *testing.T) {
		cases := []struct {
			name    string
			org     string
			want    int
			wantOrg string
		}{
			{"home org sees only its own instance", "home-org", 1, "home-org"},
			{"consumer org sees only its own instance", "consumer-org", 1, "consumer-org"},
			{"unrelated org sees nothing", "bystander-org", 0, ""},
		}
		for _, tt := range cases {
			t.Run(tt.name, func(t *testing.T) {
				list, err := controller.GetByAgent(contextWithAgentInstanceKind(), &agentinstancev1.GetAgentInstancesByAgentRequest{
					AgentId: "agt-scoped",
					Org:     tt.org,
				})
				if err != nil {
					t.Fatalf("GetByAgent failed: %v", err)
				}
				if int(list.GetTotalCount()) != tt.want {
					t.Fatalf("org %q: expected %d instances, got %d", tt.org, tt.want, list.GetTotalCount())
				}
				for _, inst := range list.GetItems() {
					if tt.wantOrg != "" && inst.GetMetadata().GetOrg() != tt.wantOrg {
						t.Errorf("org %q: leaked an instance from org %q", tt.org, inst.GetMetadata().GetOrg())
					}
				}
			})
		}
	})
}

func TestAgentInstanceController_UpdateVisibility(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful visibility update preserves spec", func(t *testing.T) {
		// Create a private instance first.
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Visibility Test Instance",
				Org:        "test-org",
				Visibility: apiresource.ApiResourceVisibility_visibility_private,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "vis-agent-id",
				Description: "Visibility test description",
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Promote to organization visibility.
		updated, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
			ResourceId: created.Metadata.Id,
			Visibility: apiresource.ApiResourceVisibility_visibility_org,
		})
		if err != nil {
			t.Fatalf("UpdateVisibility failed: %v", err)
		}

		if updated.Metadata.Visibility != apiresource.ApiResourceVisibility_visibility_org {
			t.Errorf("Expected visibility 'org', got '%v'", updated.Metadata.Visibility)
		}

		// Spec must be untouched by a targeted visibility update.
		if updated.Spec.AgentId != "vis-agent-id" {
			t.Errorf("Expected agent_id preserved 'vis-agent-id', got '%s'", updated.Spec.AgentId)
		}
		if updated.Spec.Description != "Visibility test description" {
			t.Errorf("Expected description preserved, got '%s'", updated.Spec.Description)
		}

		// Verify persistence: a fresh get reflects the new visibility.
		retrieved, err := controller.Get(contextWithAgentInstanceKind(), &agentinstancev1.AgentInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get after UpdateVisibility failed: %v", err)
		}
		if retrieved.Metadata.Visibility != apiresource.ApiResourceVisibility_visibility_org {
			t.Errorf("Expected persisted visibility 'org', got '%v'", retrieved.Metadata.Visibility)
		}
	})

	t.Run("update visibility of non-existent instance", func(t *testing.T) {
		_, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
			ResourceId: "non-existent-id",
			Visibility: apiresource.ApiResourceVisibility_visibility_org,
		})
		if err == nil {
			t.Error("Expected error when updating visibility of non-existent instance")
		}
	})
}
