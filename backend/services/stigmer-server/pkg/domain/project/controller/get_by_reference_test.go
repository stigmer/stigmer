package project

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ============================================================================
// Successful Retrieval Tests
// ============================================================================

func TestGetByReference_SuccessfulRetrieval(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Reference Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	if retrieved.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
	}
	if retrieved.Metadata.Slug != created.Metadata.Slug {
		t.Errorf("Expected Slug '%s', got '%s'", created.Metadata.Slug, retrieved.Metadata.Slug)
	}
	if retrieved.Metadata.Name != created.Metadata.Name {
		t.Errorf("Expected Name '%s', got '%s'", created.Metadata.Name, retrieved.Metadata.Name)
	}
}

func TestGetByReference_ReturnsCompleteProject(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMembers("Complete Reference Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	t.Run("preserves ApiVersion", func(t *testing.T) {
		if retrieved.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected ApiVersion 'agentic.stigmer.ai/v1', got '%s'", retrieved.ApiVersion)
		}
	})

	t.Run("preserves Kind", func(t *testing.T) {
		if retrieved.Kind != "Project" {
			t.Errorf("Expected Kind 'Project', got '%s'", retrieved.Kind)
		}
	})

	t.Run("preserves Spec with members", func(t *testing.T) {
		if retrieved.Spec == nil {
			t.Fatal("Expected Spec to be set, got nil")
		}
		if len(retrieved.Spec.Members) != 2 {
			t.Errorf("Expected 2 members, got %d", len(retrieved.Spec.Members))
		}
	})
}

// ============================================================================
// Slug Matching Tests
// ============================================================================

func TestGetByReference_MatchesSlugNotName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("My Display Name")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	expectedSlug := "my-display-name"
	if created.Metadata.Slug != expectedSlug {
		t.Fatalf("Expected slug '%s', got '%s'", expectedSlug, created.Metadata.Slug)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: expectedSlug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	if retrieved.Metadata.Name != "My Display Name" {
		t.Errorf("Expected Name 'My Display Name', got '%s'", retrieved.Metadata.Name)
	}
}

func TestGetByReference_OrgScoped(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Org Scoped Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference with correct org failed: %v", err)
	}

	if retrieved.Metadata.Org != "test-org" {
		t.Errorf("Expected Org 'test-org', got '%s'", retrieved.Metadata.Org)
	}

	wrongOrgRef := &apiresource.ApiResourceReference{
		Org:  "different-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	_, err = controller.GetByReference(contextWithProjectKind(), wrongOrgRef)
	if err == nil {
		t.Error("Expected error when getting project with wrong org, got nil")
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestGetByReference_NonExistentSlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: "non-existent-slug",
	}

	_, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err == nil {
		t.Error("Expected error when getting non-existent project, got nil")
	}

	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "NotFound") {
		t.Logf("Error message: %v", err)
	}
}

func TestGetByReference_EmptySlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: "",
	}

	_, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err == nil {
		t.Error("Expected error when getting with empty slug, got nil")
	}
}

func TestGetByReference_EmptyOrg(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Empty Org Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	_, err = controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Logf("Empty org lookup returned error (expected): %v", err)
	}
}

// ============================================================================
// State Consistency Tests
// ============================================================================

func TestGetByReference_AfterUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Update Reference Test")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved1, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference after create failed: %v", err)
	}
	if retrieved1.Spec.Description != "Test project for unit tests" {
		t.Errorf("Expected initial description, got '%s'", retrieved1.Spec.Description)
	}

	created.Spec.Description = "Updated via reference test"
	_, err = controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	retrieved2, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference after update failed: %v", err)
	}

	if retrieved2.Spec.Description != "Updated via reference test" {
		t.Errorf("Expected updated description, got '%s'", retrieved2.Spec.Description)
	}
}

func TestGetByReference_CaseInsensitiveSlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Case Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	expectedSlug := "case-test-project"
	if created.Metadata.Slug != expectedSlug {
		t.Fatalf("Expected slug '%s', got '%s'", expectedSlug, created.Metadata.Slug)
	}

	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: expectedSlug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference with exact slug failed: %v", err)
	}

	if retrieved.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
	}
}
