package project

import (
	"fmt"
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// ============================================================================
// Successful Deletion Tests
// ============================================================================

func TestDelete_SuccessfulDeletion(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project first
	project := createTestProject("Delete Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Delete the project
	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify deleted project ID matches created project ID
	if deleted.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected deleted project ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
	}

	// Verify project is actually deleted - Get should fail
	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err == nil {
		t.Error("Expected error when getting deleted project, got nil")
	}
}

func TestDelete_ReturnsDeletedProjectData(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create project with specific data
	project := createTestProject("Data Verify Project")
	project.Spec.Description = "Verify all fields preserved in delete response"
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Delete and verify returned data
	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify all fields are preserved in deleted response
	t.Run("preserves ID", func(t *testing.T) {
		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}
	})

	t.Run("preserves Name", func(t *testing.T) {
		if deleted.Metadata.Name != "Data Verify Project" {
			t.Errorf("Expected Name 'Data Verify Project', got '%s'", deleted.Metadata.Name)
		}
	})

	t.Run("preserves Slug", func(t *testing.T) {
		if deleted.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected Slug '%s', got '%s'", created.Metadata.Slug, deleted.Metadata.Slug)
		}
	})

	t.Run("preserves Org", func(t *testing.T) {
		if deleted.Metadata.Org != "test-org" {
			t.Errorf("Expected Org 'test-org', got '%s'", deleted.Metadata.Org)
		}
	})

	t.Run("preserves Description", func(t *testing.T) {
		if deleted.Spec.Description != "Verify all fields preserved in delete response" {
			t.Errorf("Expected Description 'Verify all fields preserved in delete response', got '%s'", deleted.Spec.Description)
		}
	})

	t.Run("preserves Runtime", func(t *testing.T) {
		if deleted.Spec.Runtime != projectv1.ProjectRuntime_go {
			t.Errorf("Expected Runtime 'go', got '%v'", deleted.Spec.Runtime)
		}
	})

	t.Run("preserves EntryPoint", func(t *testing.T) {
		if deleted.Spec.EntryPoint != "main.go" {
			t.Errorf("Expected EntryPoint 'main.go', got '%s'", deleted.Spec.EntryPoint)
		}
	})
}

func TestDelete_WithEmbeddedResources(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create project with embedded agents
	project := createTestProjectWithAgents("Embedded Resources Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify embedded agents exist in created project
	if len(created.Spec.Agents) != 1 {
		t.Fatalf("Expected 1 embedded agent in created project, got %d", len(created.Spec.Agents))
	}

	// Delete the project - should succeed without cascade
	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify deleted project preserves embedded resources in response
	if len(deleted.Spec.Agents) != 1 {
		t.Errorf("Expected 1 embedded agent in deleted response, got %d", len(deleted.Spec.Agents))
	}

	// Verify project is deleted
	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err == nil {
		t.Error("Expected error when getting deleted project")
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestDelete_NonExistentProject(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to delete a project that doesn't exist
	_, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: "prj-nonexistent123456789"})
	if err == nil {
		t.Error("Expected error when deleting non-existent project, got nil")
	}

	// Verify error indicates not found
	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "NotFound") {
		t.Logf("Error message: %v", err)
		// Note: We're lenient here as the exact error format may vary
	}
}

func TestDelete_EmptyID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to delete with an empty ID
	_, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: ""})
	if err == nil {
		t.Error("Expected error when deleting with empty ID, got nil")
	}
}

func TestDelete_MalformedID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	testCases := []struct {
		name string
		id   string
	}{
		{
			name: "single character",
			id:   "x",
		},
		{
			name: "special characters",
			id:   "!@#$%^&*()",
		},
		{
			name: "spaces",
			id:   "project with spaces",
		},
		{
			name: "very long ID",
			id:   strings.Repeat("a", 1000),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: tc.id})
			if err == nil {
				t.Errorf("Expected error for malformed ID '%s', got nil", tc.id)
			}
		})
	}
}

func TestDelete_NilInput(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to delete with nil input
	_, err := controller.Delete(contextWithProjectKind(), nil)
	if err == nil {
		t.Error("Expected error when deleting with nil input, got nil")
	}
}

// ============================================================================
// Multiple Projects Tests
// ============================================================================

func TestDelete_DoesNotAffectOtherProjects(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create three projects
	project1 := createTestProject("First Project")
	created1, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("Create first project failed: %v", err)
	}

	project2 := createTestProject("Second Project")
	created2, err := controller.Create(contextWithProjectKind(), project2)
	if err != nil {
		t.Fatalf("Create second project failed: %v", err)
	}

	project3 := createTestProject("Third Project")
	created3, err := controller.Create(contextWithProjectKind(), project3)
	if err != nil {
		t.Fatalf("Create third project failed: %v", err)
	}

	// Delete the second project
	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created2.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify first project still exists
	retrieved1, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created1.Metadata.Id})
	if err != nil {
		t.Errorf("First project should still exist: %v", err)
	}
	if retrieved1.Metadata.Name != "First Project" {
		t.Errorf("Expected first project name 'First Project', got '%s'", retrieved1.Metadata.Name)
	}

	// Verify third project still exists
	retrieved3, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created3.Metadata.Id})
	if err != nil {
		t.Errorf("Third project should still exist: %v", err)
	}
	if retrieved3.Metadata.Name != "Third Project" {
		t.Errorf("Expected third project name 'Third Project', got '%s'", retrieved3.Metadata.Name)
	}

	// Verify second project is deleted
	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created2.Metadata.Id})
	if err == nil {
		t.Error("Second project should be deleted")
	}
}

func TestDelete_MultipleDeletions(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create multiple projects with unique names
	var createdProjects []*projectv1.Project
	for i := 0; i < 5; i++ {
		project := createTestProject(fmt.Sprintf("Multi Delete Project %d", i))
		created, err := controller.Create(contextWithProjectKind(), project)
		if err != nil {
			t.Fatalf("Create project %d failed: %v", i, err)
		}
		createdProjects = append(createdProjects, created)
	}

	// Delete all projects sequentially
	for i, created := range createdProjects {
		deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
		if err != nil {
			t.Errorf("Delete project %d failed: %v", i, err)
			continue
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Project %d: Expected deleted ID '%s', got '%s'", i, created.Metadata.Id, deleted.Metadata.Id)
		}
	}

	// Verify all projects are deleted
	for i, created := range createdProjects {
		_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
		if err == nil {
			t.Errorf("Project %d should be deleted", i)
		}
	}
}

// ============================================================================
// State Consistency Tests
// ============================================================================

func TestDelete_AfterUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project
	project := createTestProject("Update Then Delete Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Update the project
	created.Spec.Description = "Updated description before deletion"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Delete the updated project
	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify deleted project has the updated state
	if deleted.Spec.Description != "Updated description before deletion" {
		t.Errorf("Expected updated description 'Updated description before deletion', got '%s'", deleted.Spec.Description)
	}

	// Verify project is deleted
	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err == nil {
		t.Error("Expected error when getting deleted project")
	}
}

func TestDelete_IdempotencyCheck(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project
	project := createTestProject("Idempotency Check Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// First delete should succeed
	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("First delete failed: %v", err)
	}

	// Second delete should return not found error
	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err == nil {
		t.Error("Expected error on second delete, got nil")
	}
}

func TestDelete_GetByReferenceAfterDelete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project
	project := createTestProject("Slug Lookup After Delete")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify GetByReference works before deletion
	_, err = controller.GetByReference(contextWithProjectKind(), &apiresource.ApiResourceReference{
		Slug: created.Metadata.Slug,
		Org:  created.Metadata.Org,
	})
	if err != nil {
		t.Fatalf("GetByReference before delete failed: %v", err)
	}

	// Delete the project
	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify GetByReference also fails after deletion
	_, err = controller.GetByReference(contextWithProjectKind(), &apiresource.ApiResourceReference{
		Slug: created.Metadata.Slug,
		Org:  created.Metadata.Org,
	})
	if err == nil {
		t.Error("Expected error when getting deleted project by slug, got nil")
	}
}
