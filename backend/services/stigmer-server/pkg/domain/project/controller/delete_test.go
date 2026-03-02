package project

import (
	"fmt"
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// ============================================================================
// Successful Deletion Tests
// ============================================================================

func TestDelete_SuccessfulDeletion(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Delete Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if deleted.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected deleted project ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
	}

	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err == nil {
		t.Error("Expected error when getting deleted project, got nil")
	}
}

func TestDelete_ReturnsDeletedProjectData(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Data Verify Project")
	project.Spec.Description = "Verify all fields preserved in delete response"
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

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
			t.Errorf("Expected Description preserved, got '%s'", deleted.Spec.Description)
		}
	})

	t.Run("preserves EntryPoint", func(t *testing.T) {
		if deleted.Spec.EntryPoint != "main.go" {
			t.Errorf("Expected EntryPoint 'main.go', got '%s'", deleted.Spec.EntryPoint)
		}
	})
}

func TestDelete_WithMembers(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMembers("Members Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if len(created.Spec.Members) != 2 {
		t.Fatalf("Expected 2 members in created project, got %d", len(created.Spec.Members))
	}

	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if len(deleted.Spec.Members) != 2 {
		t.Errorf("Expected 2 members in deleted response, got %d", len(deleted.Spec.Members))
	}

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

	_, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: "prj-nonexistent123456789"})
	if err == nil {
		t.Error("Expected error when deleting non-existent project, got nil")
	}
}

func TestDelete_EmptyID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

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
		{"single character", "x"},
		{"special characters", "!@#$%^&*()"},
		{"spaces", "project with spaces"},
		{"very long ID", strings.Repeat("a", 1000)},
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

	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created2.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	retrieved1, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created1.Metadata.Id})
	if err != nil {
		t.Errorf("First project should still exist: %v", err)
	}
	if retrieved1.Metadata.Name != "First Project" {
		t.Errorf("Expected first project name 'First Project', got '%s'", retrieved1.Metadata.Name)
	}

	retrieved3, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created3.Metadata.Id})
	if err != nil {
		t.Errorf("Third project should still exist: %v", err)
	}
	if retrieved3.Metadata.Name != "Third Project" {
		t.Errorf("Expected third project name 'Third Project', got '%s'", retrieved3.Metadata.Name)
	}

	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created2.Metadata.Id})
	if err == nil {
		t.Error("Second project should be deleted")
	}
}

func TestDelete_MultipleDeletions(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	var createdProjects []*projectv1.Project
	for i := 0; i < 5; i++ {
		project := createTestProject(fmt.Sprintf("Multi Delete Project %d", i))
		created, err := controller.Create(contextWithProjectKind(), project)
		if err != nil {
			t.Fatalf("Create project %d failed: %v", i, err)
		}
		createdProjects = append(createdProjects, created)
	}

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

	project := createTestProject("Update Then Delete Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	created.Spec.Description = "Updated description before deletion"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	deleted, err := controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if deleted.Spec.Description != "Updated description before deletion" {
		t.Errorf("Expected updated description 'Updated description before deletion', got '%s'", deleted.Spec.Description)
	}

	_, err = controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err == nil {
		t.Error("Expected error when getting deleted project")
	}
}

func TestDelete_IdempotencyCheck(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Idempotency Check Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("First delete failed: %v", err)
	}

	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err == nil {
		t.Error("Expected error on second delete, got nil")
	}
}

func TestDelete_GetByReferenceAfterDelete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Slug Lookup After Delete")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	_, err = controller.GetByReference(contextWithProjectKind(), &apiresource.ApiResourceReference{
		Slug: created.Metadata.Slug,
		Org:  created.Metadata.Org,
	})
	if err != nil {
		t.Fatalf("GetByReference before delete failed: %v", err)
	}

	_, err = controller.Delete(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err = controller.GetByReference(contextWithProjectKind(), &apiresource.ApiResourceReference{
		Slug: created.Metadata.Slug,
		Org:  created.Metadata.Org,
	})
	if err == nil {
		t.Error("Expected error when getting deleted project by slug, got nil")
	}
}
