package project

import (
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// ============================================================================
// Successful Update Tests
// ============================================================================

func TestUpdate_SuccessfulUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Update Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	created.Spec.Description = "Updated description"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Spec.Description != "Updated description" {
		t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
	}
	if updated.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
	}
	if updated.Metadata.Slug != created.Metadata.Slug {
		t.Errorf("Expected slug '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
	}
}

func TestUpdate_UpdatesEntryPoint(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Entry Point Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	created.Spec.EntryPoint = "cmd/main.go"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Spec.EntryPoint != "cmd/main.go" {
		t.Errorf("Expected entry_point 'cmd/main.go', got '%s'", updated.Spec.EntryPoint)
	}
}

// ============================================================================
// Error Case Tests
// ============================================================================

func TestUpdate_RejectsNonExistentProject(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "prj-nonexistent12345678901234",
			Name: "Non-existent Project",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Update(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for updating non-existent project")
	}
}

func TestUpdate_RejectsMissingMetadata(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Update(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing metadata")
	}
}

func TestUpdate_RejectsInvalidApiVersion(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("API Version Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	created.ApiVersion = "invalid/v1"
	_, err = controller.Update(contextWithProjectKind(), created)
	if err == nil {
		t.Error("Expected error for invalid api_version")
	}
}

// ============================================================================
// Immutability Tests
// ============================================================================

func TestUpdate_PreservesIDFromExistingResource(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("ID Preservation Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	originalID := created.Metadata.Id

	updateRequest := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: created.Metadata.Slug,
			Name: "ID Preservation Test",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "main.go",
			Description: "Updated via slug lookup",
		},
	}

	updated, err := controller.Update(contextWithProjectKind(), updateRequest)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Metadata.Id != originalID {
		t.Errorf("Expected ID '%s' to be populated from existing, got '%s'", originalID, updated.Metadata.Id)
	}
}

func TestUpdate_PreservesSlugEvenIfClientChangesIt(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Slug Preservation Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	originalSlug := created.Metadata.Slug

	created.Metadata.Slug = "different-slug"
	created.Spec.Description = "Updated with different slug"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Metadata.Slug != originalSlug {
		t.Errorf("Expected slug '%s' to be preserved, got '%s'", originalSlug, updated.Metadata.Slug)
	}
}

func TestUpdate_PreservesOrgEvenIfClientChangesIt(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Org Preservation Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	originalOrg := created.Metadata.Org

	created.Metadata.Org = "different-org"
	created.Spec.Description = "Updated with different org"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Metadata.Org != originalOrg {
		t.Errorf("Expected org '%s' to be preserved, got '%s'", originalOrg, updated.Metadata.Org)
	}
}

// ============================================================================
// Audit Fields Tests
// ============================================================================

func TestUpdate_UpdatesAuditFields(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Audit Update Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.Status == nil || created.Status.Audit == nil || created.Status.Audit.SpecAudit == nil {
		t.Fatal("Expected audit fields to be set after create")
	}
	originalCreatedAt := created.Status.Audit.SpecAudit.CreatedAt

	created.Spec.Description = "Updated for audit test"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	if updated.Status == nil || updated.Status.Audit == nil || updated.Status.Audit.SpecAudit == nil {
		t.Fatal("Expected audit fields to be set after update")
	}

	audit := updated.Status.Audit.SpecAudit

	if audit.CreatedAt.AsTime() != originalCreatedAt.AsTime() {
		t.Error("Expected created_at to be preserved")
	}
	if audit.Event != "updated" {
		t.Errorf("Expected event 'updated', got '%s'", audit.Event)
	}
}

// ============================================================================
// Lookup by Slug Tests
// ============================================================================

func TestUpdate_CanLookupBySlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Slug Lookup Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	updateRequest := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: created.Metadata.Slug,
			Name: "Slug Lookup Test",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "main.go",
			Description: "Updated via slug lookup",
		},
	}

	updated, err := controller.Update(contextWithProjectKind(), updateRequest)
	if err != nil {
		t.Fatalf("Update by slug failed: %v", err)
	}

	if updated.Spec.Description != "Updated via slug lookup" {
		t.Errorf("Expected description 'Updated via slug lookup', got '%s'", updated.Spec.Description)
	}
	if updated.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
	}
}
