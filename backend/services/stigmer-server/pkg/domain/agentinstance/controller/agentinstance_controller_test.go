package agentinstance

import (
	"context"
	"testing"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithAgentInstanceKind creates a context with the agent instance resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentInstanceKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent_instance)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*AgentInstanceController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
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
				Name:       "Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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
				Name:       "Invalid Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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

	t.Run("successful creation with environment references", func(t *testing.T) {
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Instance With Envs",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Instance with environment references",
				EnvironmentRefs: []*apiresource.ApiResourceReference{
					{
						Kind: apiresourcekind.ApiResourceKind_environment,
						Id:   "env-1",
					},
					{
						Kind: apiresourcekind.ApiResourceKind_environment,
						Id:   "env-2",
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify environment references are preserved
		if len(created.Spec.EnvironmentRefs) != 2 {
			t.Errorf("Expected 2 environment references, got %d", len(created.Spec.EnvironmentRefs))
		}

		if created.Spec.EnvironmentRefs[0].Id != "env-1" {
			t.Errorf("Expected first environment ref ID 'env-1', got '%s'", created.Spec.EnvironmentRefs[0].Id)
		}

		if created.Spec.EnvironmentRefs[1].Id != "env-2" {
			t.Errorf("Expected second environment ref ID 'env-2', got '%s'", created.Spec.EnvironmentRefs[1].Id)
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
				Name:       "Get Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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
				Name:       "Update Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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
				Id:         "non-existent-id",
				Name:       "Non-existent Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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

	t.Run("update environment references", func(t *testing.T) {
		// Create instance with initial environment references
		instance := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Env Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     "test-agent-id",
				Description: "Test description",
				EnvironmentRefs: []*apiresource.ApiResourceReference{
					{
						Kind: apiresourcekind.ApiResourceKind_environment,
						Id:   "env-1",
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update environment references
		created.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{
			{
				Kind: apiresourcekind.ApiResourceKind_environment,
				Id:   "env-2",
			},
			{
				Kind: apiresourcekind.ApiResourceKind_environment,
				Id:   "env-3",
			},
		}

		updated, err := controller.Update(contextWithAgentInstanceKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		// Verify environment references are updated
		if len(updated.Spec.EnvironmentRefs) != 2 {
			t.Errorf("Expected 2 environment references, got %d", len(updated.Spec.EnvironmentRefs))
		}

		if updated.Spec.EnvironmentRefs[0].Id != "env-2" {
			t.Errorf("Expected first environment ref ID 'env-2', got '%s'", updated.Spec.EnvironmentRefs[0].Id)
		}

		if updated.Spec.EnvironmentRefs[1].Id != "env-3" {
			t.Errorf("Expected second environment ref ID 'env-3', got '%s'", updated.Spec.EnvironmentRefs[1].Id)
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
				Name:       "Delete Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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
				Name:       "Delete Verify Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
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
