package project

import (
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ============================================================================
// Successful Retrieval Tests
// ============================================================================

func TestGet_SuccessfulRetrieval(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Get Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if retrieved.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
	}
	if retrieved.Metadata.Name != created.Metadata.Name {
		t.Errorf("Expected Name '%s', got '%s'", created.Metadata.Name, retrieved.Metadata.Name)
	}
	if retrieved.Metadata.Slug != created.Metadata.Slug {
		t.Errorf("Expected Slug '%s', got '%s'", created.Metadata.Slug, retrieved.Metadata.Slug)
	}
}

func TestGet_ReturnsCompleteProject(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Complete Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	t.Run("preserves ApiVersion", func(t *testing.T) {
		if retrieved.ApiVersion != "tenancy.stigmer.ai/v1" {
			t.Errorf("Expected ApiVersion 'tenancy.stigmer.ai/v1', got '%s'", retrieved.ApiVersion)
		}
	})

	t.Run("preserves Kind", func(t *testing.T) {
		if retrieved.Kind != "Project" {
			t.Errorf("Expected Kind 'Project', got '%s'", retrieved.Kind)
		}
	})

	t.Run("preserves Metadata", func(t *testing.T) {
		if retrieved.Metadata == nil {
			t.Fatal("Expected Metadata to be set, got nil")
		}
		if retrieved.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}
		if retrieved.Metadata.Slug == "" {
			t.Error("Expected Slug to be set")
		}
		if retrieved.Metadata.Org != "test-org" {
			t.Errorf("Expected Org 'test-org', got '%s'", retrieved.Metadata.Org)
		}
	})

	t.Run("preserves Spec", func(t *testing.T) {
		if retrieved.Spec == nil {
			t.Fatal("Expected Spec to be set, got nil")
		}
		if retrieved.Spec.EntryPoint != "main.go" {
			t.Errorf("Expected EntryPoint 'main.go', got '%s'", retrieved.Spec.EntryPoint)
		}
		if retrieved.Spec.Description != "Test project for unit tests" {
			t.Errorf("Expected Description 'Test project for unit tests', got '%s'", retrieved.Spec.Description)
		}
	})
}

func TestGet_PreservesMembers(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMembers("Members Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if len(retrieved.Spec.Members) != 2 {
		t.Fatalf("Expected 2 members, got %d", len(retrieved.Spec.Members))
	}

	if retrieved.Spec.Members[0].GetSlug() != "test-agent" {
		t.Errorf("Expected first member slug 'test-agent', got '%s'", retrieved.Spec.Members[0].GetSlug())
	}
	if retrieved.Spec.Members[0].GetKind() != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("Expected first member kind 'agent', got '%v'", retrieved.Spec.Members[0].GetKind())
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestGet_NonExistentID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: "prj-nonexistent123456789"})
	if err == nil {
		t.Error("Expected error when getting non-existent project, got nil")
	}
}

func TestGet_EmptyID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: ""})
	if err == nil {
		t.Error("Expected error when getting with empty ID, got nil")
	}
}

func TestGet_MalformedID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	testCases := []struct {
		name string
		id   string
	}{
		{"single character", "x"},
		{"special characters", "!@#$%^&*()"},
		{"spaces", "project with spaces"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: tc.id})
			if err == nil {
				t.Errorf("Expected error for malformed ID '%s', got nil", tc.id)
			}
		})
	}
}

// ============================================================================
// Multiple Projects Tests
// ============================================================================

func TestGet_MultipleProjects(t *testing.T) {
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

	t.Run("get first project", func(t *testing.T) {
		retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created1.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if retrieved.Metadata.Id != created1.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created1.Metadata.Id, retrieved.Metadata.Id)
		}
	})

	t.Run("get second project", func(t *testing.T) {
		retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created2.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if retrieved.Metadata.Id != created2.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created2.Metadata.Id, retrieved.Metadata.Id)
		}
	})

	t.Run("get third project", func(t *testing.T) {
		retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created3.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if retrieved.Metadata.Id != created3.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created3.Metadata.Id, retrieved.Metadata.Id)
		}
	})
}

// ============================================================================
// State Consistency Tests
// ============================================================================

func TestGet_AfterUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Update Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	retrieved1, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get after create failed: %v", err)
	}
	if retrieved1.Spec.Description != "Test project for unit tests" {
		t.Errorf("Expected initial description 'Test project for unit tests', got '%s'", retrieved1.Spec.Description)
	}

	created.Spec.Description = "Updated description for testing"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	retrieved2, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}

	if retrieved2.Spec.Description != "Updated description for testing" {
		t.Errorf("Expected updated description, got '%s'", retrieved2.Spec.Description)
	}

	if retrieved2.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID to remain unchanged")
	}
	if retrieved2.Metadata.Slug != created.Metadata.Slug {
		t.Errorf("Expected Slug to remain unchanged")
	}
}

func TestGet_WithMalformedIdReturnsSensibleError(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: "not-a-real-id"})
	if err == nil {
		t.Error("Expected error for non-existent ID")
	}
	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "NotFound") {
		t.Logf("Error message: %v", err)
	}
}
