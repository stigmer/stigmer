package agent

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// contextWithAgentKind creates a context with the agent resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent)
}

func TestAgentController_Create(t *testing.T) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
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
				Name:       "Test Agent",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
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
				Name:       "Duplicate Agent",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
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
	store, err := badger.NewStore(t.TempDir() + "/badger")
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
				Name:       "Original Agent",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
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
				Id:         "non-existent-id",
				Name:       "Non-existent Agent",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
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
	store, err := badger.NewStore(t.TempDir() + "/badger")
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
				Name:       "Agent to Delete",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
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
