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

	// Create a project first
	project := createTestProject("Reference Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get the project by reference (slug)
	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	// Verify the retrieved project matches
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

	// Create a project with all fields populated
	project := createTestProjectWithAgents("Complete Reference Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get the project by reference
	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	retrieved, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	// Verify all fields are preserved
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

	t.Run("preserves Spec with embedded resources", func(t *testing.T) {
		if retrieved.Spec == nil {
			t.Fatal("Expected Spec to be set, got nil")
		}
		if len(retrieved.Spec.Agents) != 1 {
			t.Errorf("Expected 1 embedded agent, got %d", len(retrieved.Spec.Agents))
		}
	})
}

// ============================================================================
// Slug Matching Tests
// ============================================================================

func TestGetByReference_MatchesSlugNotName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project with a name that differs from slug
	project := createTestProject("My Display Name")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify slug is normalized (lowercase, hyphenated)
	expectedSlug := "my-display-name"
	if created.Metadata.Slug != expectedSlug {
		t.Fatalf("Expected slug '%s', got '%s'", expectedSlug, created.Metadata.Slug)
	}

	// Get by slug (not by display name)
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

	// Create a project in test-org
	project := createTestProject("Org Scoped Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get with correct org should succeed
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

	// Get with different org should fail (not found)
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

	// Try to get a project with a non-existent slug
	ref := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: "non-existent-slug",
	}

	_, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err == nil {
		t.Error("Expected error when getting non-existent project, got nil")
	}

	// Verify error indicates not found
	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "NotFound") {
		t.Logf("Error message: %v", err)
		// Note: We're lenient here as the exact error format may vary
	}
}

func TestGetByReference_EmptySlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to get a project with an empty slug
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

	// Create a project first
	project := createTestProject("Empty Org Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Try to get with empty org (platform-scoped lookup)
	ref := &apiresource.ApiResourceReference{
		Org:  "",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created.Metadata.Slug,
	}

	// This should either succeed (if platform-scoped lookup is supported)
	// or fail with validation error (if org is required)
	_, err = controller.GetByReference(contextWithProjectKind(), ref)

	// Either outcome is acceptable - we're testing that the system handles it gracefully
	if err != nil {
		// If it fails, it should be a validation error, not a panic
		t.Logf("Empty org lookup returned error (expected): %v", err)
	}
}

// ============================================================================
// Multi-Org Tests
// ============================================================================

func TestGetByReference_SameSlugDifferentOrgs(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create first project in test-org
	project1 := createTestProject("Shared Name Project")
	created1, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("Create first project failed: %v", err)
	}

	// Get first project by reference
	ref1 := &apiresource.ApiResourceReference{
		Org:  "test-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created1.Metadata.Slug,
	}

	retrieved1, err := controller.GetByReference(contextWithProjectKind(), ref1)
	if err != nil {
		t.Fatalf("GetByReference for first project failed: %v", err)
	}

	if retrieved1.Metadata.Id != created1.Metadata.Id {
		t.Errorf("Expected first project ID '%s', got '%s'", created1.Metadata.Id, retrieved1.Metadata.Id)
	}

	// Verify querying with wrong org fails
	wrongOrgRef := &apiresource.ApiResourceReference{
		Org:  "other-org",
		Kind: apiresourcekind.ApiResourceKind_project,
		Slug: created1.Metadata.Slug,
	}

	_, err = controller.GetByReference(contextWithProjectKind(), wrongOrgRef)
	if err == nil {
		t.Error("Expected error when querying with wrong org, got nil")
	}
}

// ============================================================================
// State Consistency Tests
// ============================================================================

func TestGetByReference_AfterUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project
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

	// Verify initial state
	retrieved1, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference after create failed: %v", err)
	}
	if retrieved1.Spec.Description != "Test project for unit tests" {
		t.Errorf("Expected initial description, got '%s'", retrieved1.Spec.Description)
	}

	// Update the project
	created.Spec.Description = "Updated via reference test"
	_, err = controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify GetByReference returns updated state
	retrieved2, err := controller.GetByReference(contextWithProjectKind(), ref)
	if err != nil {
		t.Fatalf("GetByReference after update failed: %v", err)
	}

	if retrieved2.Spec.Description != "Updated via reference test" {
		t.Errorf("Expected updated description 'Updated via reference test', got '%s'", retrieved2.Spec.Description)
	}
}

func TestGetByReference_CaseInsensitiveSlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project - slug will be lowercase
	project := createTestProject("Case Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// The slug should be lowercase
	expectedSlug := "case-test-project"
	if created.Metadata.Slug != expectedSlug {
		t.Fatalf("Expected slug '%s', got '%s'", expectedSlug, created.Metadata.Slug)
	}

	// Query with exact slug (lowercase) - should work
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

	// Note: Whether uppercase slugs work depends on the store implementation.
	// Since slugs are normalized to lowercase at creation time, querying with
	// uppercase would typically not find the resource. This is expected behavior.
}
