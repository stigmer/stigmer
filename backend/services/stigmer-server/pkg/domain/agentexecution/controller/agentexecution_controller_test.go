package agentexecution

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithAgentExecutionKind creates a context with the agent execution resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentExecutionKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent_execution)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*AgentExecutionController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// For simple tests, pass nil for clients
	// These clients are only needed for complex pipeline steps that auto-create resources
	controller := NewAgentExecutionController(store, nil, nil, nil)

	return controller, store
}

func TestAgentExecutionController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with session_id", func(t *testing.T) {
		t.Skip("Skipping test that requires Temporal workflow engine")
		
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		created, err := controller.Create(contextWithAgentExecutionKind(), execution)
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

		if created.Metadata.Slug != "test-execution" {
			t.Errorf("Expected slug 'test-execution', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "AgentExecution" {
			t.Errorf("Expected kind 'AgentExecution', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify initial phase is set
		if created.Status == nil {
			t.Fatal("Expected status to be set")
		}

		if created.Status.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING {
			t.Errorf("Expected phase EXECUTION_PENDING, got %v", created.Status.Phase)
		}

		// Verify session_id is preserved
		if created.Spec.SessionId != "test-session-id" {
			t.Errorf("Expected session_id 'test-session-id', got '%s'", created.Spec.SessionId)
		}
	})

	t.Run("validation error - neither session_id nor agent_id provided", func(t *testing.T) {
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				Message: "Test message",
			},
		}

		_, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error when neither session_id nor agent_id is provided")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		_, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		_, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})
}

func TestAgentExecutionController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		t.Skip("Skipping test that requires Temporal workflow engine")
		
		// Create execution first
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		created, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the execution
		retrieved, err := controller.Get(contextWithAgentExecutionKind(), &agentexecutionv1.AgentExecutionId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Message != "Test message" {
			t.Errorf("Expected message 'Test message', got '%s'", retrieved.Spec.Message)
		}
	})

	t.Run("get non-existent execution", func(t *testing.T) {
		_, err := controller.Get(contextWithAgentExecutionKind(), &agentexecutionv1.AgentExecutionId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent execution")
		}
	})
}

func TestAgentExecutionController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		t.Skip("Skipping test that requires Temporal workflow engine")
		
		// Create execution first
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Original message",
			},
		}

		created, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the execution
		created.Spec.Message = "Updated message"
		updated, err := controller.Update(contextWithAgentExecutionKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Message != "Updated message" {
			t.Errorf("Expected message 'Updated message', got '%s'", updated.Spec.Message)
		}
	})

	t.Run("update non-existent execution", func(t *testing.T) {
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		_, err := controller.Update(contextWithAgentExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for updating non-existent execution")
		}
	})
}

func TestAgentExecutionController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		t.Skip("Skipping test that requires Temporal workflow engine")
		
		// Create execution first
		execution := &agentexecutionv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				SessionId: "test-session-id",
				Message:   "Test message",
			},
		}

		created, err := controller.Create(contextWithAgentExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the execution
		deleted, err := controller.Delete(contextWithAgentExecutionKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted execution ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify execution is deleted
		_, err = controller.Get(contextWithAgentExecutionKind(), &agentexecutionv1.AgentExecutionId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted execution")
		}
	})

	t.Run("delete non-existent execution", func(t *testing.T) {
		_, err := controller.Delete(contextWithAgentExecutionKind(), &apiresource.ApiResourceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent execution")
		}
	})
}
