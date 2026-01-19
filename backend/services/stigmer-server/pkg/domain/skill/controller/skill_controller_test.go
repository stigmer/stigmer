package skill

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithSkillKind creates a context with the skill resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithSkillKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_skill)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*SkillController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewSkillController(store)

	return controller, store
}

func TestSkillController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with markdown_content", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Test skill description",
				MarkdownContent: "# Test Skill\n\nThis is test markdown content.",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
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

		if created.Metadata.Slug != "test-skill" {
			t.Errorf("Expected slug 'test-skill', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Skill" {
			t.Errorf("Expected kind 'Skill', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify markdown_content is preserved
		if created.Spec.MarkdownContent != "# Test Skill\n\nThis is test markdown content." {
			t.Errorf("Expected markdown_content to be preserved, got '%s'", created.Spec.MarkdownContent)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test skill description" {
			t.Errorf("Expected description 'Test skill description', got '%s'", created.Spec.Description)
		}
	})

	t.Run("validation error - missing markdown_content", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithSkillKind(), skill)
		if err == nil {
			t.Error("Expected error when markdown_content is not provided")
		}
	})

	t.Run("validation error - empty markdown_content", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "",
			},
		}

		_, err := controller.Create(contextWithSkillKind(), skill)
		if err == nil {
			t.Error("Expected error when markdown_content is empty")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "# Test Content",
			},
		}

		_, err := controller.Create(contextWithSkillKind(), skill)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "# Test Content",
			},
		}

		_, err := controller.Create(contextWithSkillKind(), skill)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("successful creation without optional description", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Skill Without Description",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				MarkdownContent: "# Skill Content\n\nContent without description.",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Spec.Description != "" {
			t.Errorf("Expected empty description, got '%s'", created.Spec.Description)
		}

		if created.Spec.MarkdownContent != "# Skill Content\n\nContent without description." {
			t.Errorf("Expected markdown_content to be preserved, got '%s'", created.Spec.MarkdownContent)
		}
	})
}

func TestSkillController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create skill first
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "# Get Test\n\nTest content for get operation.",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the skill
		retrieved, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}

		if retrieved.Spec.MarkdownContent != "# Get Test\n\nTest content for get operation." {
			t.Errorf("Expected markdown_content to match, got '%s'", retrieved.Spec.MarkdownContent)
		}
	})

	t.Run("get non-existent skill", func(t *testing.T) {
		_, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent skill")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestSkillController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create skill first
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Original description",
				MarkdownContent: "# Original Content",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the skill
		created.Spec.Description = "Updated description"
		created.Spec.MarkdownContent = "# Updated Content\n\nThis content has been updated."
		updated, err := controller.Update(contextWithSkillKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		if updated.Spec.MarkdownContent != "# Updated Content\n\nThis content has been updated." {
			t.Errorf("Expected markdown_content to be updated, got '%s'", updated.Spec.MarkdownContent)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("update non-existent skill", func(t *testing.T) {
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "# Test Content",
			},
		}

		_, err := controller.Update(contextWithSkillKind(), skill)
		if err == nil {
			t.Error("Expected error for updating non-existent skill")
		}
	})

	t.Run("update with invalid markdown_content", func(t *testing.T) {
		// Create skill first
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Update Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Original description",
				MarkdownContent: "# Original Content",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Try to update with empty markdown_content
		created.Spec.MarkdownContent = ""
		_, err = controller.Update(contextWithSkillKind(), created)
		if err == nil {
			t.Error("Expected error when updating with empty markdown_content")
		}
	})
}

func TestSkillController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create skill first
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Test description",
				MarkdownContent: "# Delete Test\n\nThis skill will be deleted.",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the skill
		deleted, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted skill ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify skill is deleted
		_, err = controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted skill")
		}
	})

	t.Run("delete non-existent skill", func(t *testing.T) {
		_, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent skill")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted skill returns correct data", func(t *testing.T) {
		// Create skill with specific data
		skill := &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Skill",
				OwnerScope: apiresource.ApiResourceOwnerScope_platform,
			},
			Spec: &skillv1.SkillSpec{
				Description:     "Verify deletion data",
				MarkdownContent: "# Verify Delete\n\nVerify that deletion returns correct data.",
			},
		}

		created, err := controller.Create(contextWithSkillKind(), skill)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.MarkdownContent != "# Verify Delete\n\nVerify that deletion returns correct data." {
			t.Errorf("Expected markdown_content to be preserved, got '%s'", deleted.Spec.MarkdownContent)
		}

		if deleted.Spec.Description != "Verify deletion data" {
			t.Errorf("Expected description 'Verify deletion data', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Skill" {
			t.Errorf("Expected name 'Delete Verify Skill', got '%s'", deleted.Metadata.Name)
		}
	})
}
