package session

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithSessionKind creates a context with the session resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithSessionKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_session)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*SessionController, store.Store) {
	// Create temporary BadgerDB store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewSessionController(store)

	return controller, store
}

func TestSessionController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with agent_instance_id", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
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

		if created.Metadata.Slug != "test-session" {
			t.Errorf("Expected slug 'test-session', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Session" {
			t.Errorf("Expected kind 'Session', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify agent_instance_id is preserved
		if created.Spec.AgentInstanceId != "test-agent-instance-id" {
			t.Errorf("Expected agent_instance_id 'test-agent-instance-id', got '%s'", created.Spec.AgentInstanceId)
		}

		// Verify subject is preserved
		if created.Spec.Subject != "Test conversation" {
			t.Errorf("Expected subject 'Test conversation', got '%s'", created.Spec.Subject)
		}
	})

	t.Run("successful creation with identity_account scope", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Identity Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Personal conversation",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Metadata.OwnerScope != apiresource.ApiResourceOwnerScope_identity_account {
			t.Errorf("Expected owner_scope 'identity_account', got '%v'", created.Metadata.OwnerScope)
		}
	})

	t.Run("validation error - missing agent_instance_id", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				Subject: "Test conversation",
			},
		}

		_, err := controller.Create(contextWithSessionKind(), session)
		if err == nil {
			t.Error("Expected error when agent_instance_id is not provided")
		}
	})

	t.Run("validation error - invalid owner_scope", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Scope Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		_, err := controller.Create(contextWithSessionKind(), session)
		if err == nil {
			t.Error("Expected error for invalid owner_scope")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		_, err := controller.Create(contextWithSessionKind(), session)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		_, err := controller.Create(contextWithSessionKind(), session)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("successful creation with metadata fields", func(t *testing.T) {
		metadata := map[string]string{
			"client": "web-ui",
			"version": "1.0.0",
		}

		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Metadata Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test with metadata",
				Metadata:        metadata,
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if len(created.Spec.Metadata) != 2 {
			t.Errorf("Expected 2 metadata entries, got %d", len(created.Spec.Metadata))
		}

		if created.Spec.Metadata["client"] != "web-ui" {
			t.Errorf("Expected client metadata 'web-ui', got '%s'", created.Spec.Metadata["client"])
		}
	})
}

func TestSessionController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create session first
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the session
		retrieved, err := controller.Get(contextWithSessionKind(), &sessionv1.SessionId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Subject != "Test conversation" {
			t.Errorf("Expected subject 'Test conversation', got '%s'", retrieved.Spec.Subject)
		}

		if retrieved.Spec.AgentInstanceId != "test-agent-instance-id" {
			t.Errorf("Expected agent_instance_id 'test-agent-instance-id', got '%s'", retrieved.Spec.AgentInstanceId)
		}
	})

	t.Run("get non-existent session", func(t *testing.T) {
		_, err := controller.Get(contextWithSessionKind(), &sessionv1.SessionId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent session")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithSessionKind(), &sessionv1.SessionId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestSessionController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create session first
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Original subject",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the session
		created.Spec.Subject = "Updated subject"
		created.Spec.ThreadId = "new-thread-id"
		created.Spec.SandboxId = "new-sandbox-id"

		updated, err := controller.Update(contextWithSessionKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Subject != "Updated subject" {
			t.Errorf("Expected subject 'Updated subject', got '%s'", updated.Spec.Subject)
		}

		if updated.Spec.ThreadId != "new-thread-id" {
			t.Errorf("Expected thread_id 'new-thread-id', got '%s'", updated.Spec.ThreadId)
		}

		if updated.Spec.SandboxId != "new-sandbox-id" {
			t.Errorf("Expected sandbox_id 'new-sandbox-id', got '%s'", updated.Spec.SandboxId)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}

		// Verify agent_instance_id remains unchanged
		if updated.Spec.AgentInstanceId != "test-agent-instance-id" {
			t.Errorf("Expected agent_instance_id to remain 'test-agent-instance-id', got '%s'", updated.Spec.AgentInstanceId)
		}
	})

	t.Run("update metadata fields", func(t *testing.T) {
		// Create session first
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Metadata Update Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test session",
				Metadata: map[string]string{
					"key1": "value1",
				},
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update metadata
		created.Spec.Metadata["key2"] = "value2"
		created.Spec.Metadata["key1"] = "updated-value1"

		updated, err := controller.Update(contextWithSessionKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if len(updated.Spec.Metadata) != 2 {
			t.Errorf("Expected 2 metadata entries, got %d", len(updated.Spec.Metadata))
		}

		if updated.Spec.Metadata["key1"] != "updated-value1" {
			t.Errorf("Expected key1 'updated-value1', got '%s'", updated.Spec.Metadata["key1"])
		}

		if updated.Spec.Metadata["key2"] != "value2" {
			t.Errorf("Expected key2 'value2', got '%s'", updated.Spec.Metadata["key2"])
		}
	})

	t.Run("update non-existent session", func(t *testing.T) {
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		_, err := controller.Update(contextWithSessionKind(), session)
		if err == nil {
			t.Error("Expected error for updating non-existent session")
		}
	})

	t.Run("validation error - missing agent_instance_id on update", func(t *testing.T) {
		// Create session first
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Validation Update Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test session",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Try to update with missing agent_instance_id
		created.Spec.AgentInstanceId = ""

		_, err = controller.Update(contextWithSessionKind(), created)
		if err == nil {
			t.Error("Expected error when updating with empty agent_instance_id")
		}
	})
}

func TestSessionController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create session first
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         "Test conversation",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the session
		deleted, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted session ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify session is deleted
		_, err = controller.Get(contextWithSessionKind(), &sessionv1.SessionId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted session")
		}
	})

	t.Run("delete non-existent session", func(t *testing.T) {
		_, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent session")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted session returns correct data", func(t *testing.T) {
		// Create session with specific data
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Session",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "verify-agent-instance-id",
				Subject:         "Verify deletion subject",
				ThreadId:        "test-thread-id",
				SandboxId:       "test-sandbox-id",
			},
		}

		created, err := controller.Create(contextWithSessionKind(), session)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.AgentInstanceId != "verify-agent-instance-id" {
			t.Errorf("Expected agent_instance_id 'verify-agent-instance-id', got '%s'", deleted.Spec.AgentInstanceId)
		}

		if deleted.Spec.Subject != "Verify deletion subject" {
			t.Errorf("Expected subject 'Verify deletion subject', got '%s'", deleted.Spec.Subject)
		}

		if deleted.Spec.ThreadId != "test-thread-id" {
			t.Errorf("Expected thread_id 'test-thread-id', got '%s'", deleted.Spec.ThreadId)
		}

		if deleted.Spec.SandboxId != "test-sandbox-id" {
			t.Errorf("Expected sandbox_id 'test-sandbox-id', got '%s'", deleted.Spec.SandboxId)
		}

		if deleted.Metadata.Name != "Delete Verify Session" {
			t.Errorf("Expected name 'Delete Verify Session', got '%s'", deleted.Metadata.Name)
		}
	})
}
