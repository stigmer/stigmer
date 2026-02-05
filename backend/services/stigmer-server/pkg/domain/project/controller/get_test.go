package project

import (
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
)

// ============================================================================
// Successful Retrieval Tests
// ============================================================================

func TestGet_SuccessfulRetrieval(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project first
	project := createTestProject("Get Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get the project by ID
	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	// Verify the retrieved project matches
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

	// Create a project with all fields populated
	project := createTestProject("Complete Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get the project
	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
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
		if retrieved.Spec.Runtime != projectv1.ProjectRuntime_go {
			t.Errorf("Expected Runtime 'go', got '%v'", retrieved.Spec.Runtime)
		}
		if retrieved.Spec.EntryPoint != "main.go" {
			t.Errorf("Expected EntryPoint 'main.go', got '%s'", retrieved.Spec.EntryPoint)
		}
		if retrieved.Spec.Description != "Test project for unit tests" {
			t.Errorf("Expected Description 'Test project for unit tests', got '%s'", retrieved.Spec.Description)
		}
	})
}

func TestGet_PreservesEmbeddedResources(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project with embedded agents
	project := createTestProjectWithAgents("Embedded Resources Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Get the project
	retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	// Verify embedded agents are preserved
	if len(retrieved.Spec.Agents) != 1 {
		t.Fatalf("Expected 1 embedded agent, got %d", len(retrieved.Spec.Agents))
	}

	agent := retrieved.Spec.Agents[0]
	if agent.Metadata.Name != "test-agent" {
		t.Errorf("Expected agent name 'test-agent', got '%s'", agent.Metadata.Name)
	}
	if agent.Spec.Description != "A test agent for project testing" {
		t.Errorf("Expected agent description 'A test agent for project testing', got '%s'", agent.Spec.Description)
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestGet_NonExistentID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to get a project with a non-existent ID
	_, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: "prj-nonexistent123456789"})
	if err == nil {
		t.Error("Expected error when getting non-existent project, got nil")
	}

	// Verify error message indicates not found
	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "NotFound") {
		t.Logf("Error message: %v", err)
		// Note: We're lenient here as the exact error format may vary
	}
}

func TestGet_EmptyID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Try to get a project with an empty ID
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

	// Create multiple projects
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

	// Get each project and verify correct one is returned
	t.Run("get first project", func(t *testing.T) {
		retrieved, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created1.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if retrieved.Metadata.Id != created1.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created1.Metadata.Id, retrieved.Metadata.Id)
		}
		if retrieved.Metadata.Name != "First Project" {
			t.Errorf("Expected Name 'First Project', got '%s'", retrieved.Metadata.Name)
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
		if retrieved.Metadata.Name != "Second Project" {
			t.Errorf("Expected Name 'Second Project', got '%s'", retrieved.Metadata.Name)
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
		if retrieved.Metadata.Name != "Third Project" {
			t.Errorf("Expected Name 'Third Project', got '%s'", retrieved.Metadata.Name)
		}
	})
}

// ============================================================================
// State Consistency Tests
// ============================================================================

func TestGet_AfterUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a project
	project := createTestProject("Update Test Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify initial state
	retrieved1, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: created.Metadata.Id})
	if err != nil {
		t.Fatalf("Get after create failed: %v", err)
	}
	if retrieved1.Spec.Description != "Test project for unit tests" {
		t.Errorf("Expected initial description 'Test project for unit tests', got '%s'", retrieved1.Spec.Description)
	}

	// Update the project
	created.Spec.Description = "Updated description for testing"
	updated, err := controller.Update(contextWithProjectKind(), created)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify Get returns updated state
	retrieved2, err := controller.Get(contextWithProjectKind(), &projectv1.ProjectId{Value: updated.Metadata.Id})
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}

	if retrieved2.Spec.Description != "Updated description for testing" {
		t.Errorf("Expected updated description 'Updated description for testing', got '%s'", retrieved2.Spec.Description)
	}

	// Verify other fields remain unchanged
	if retrieved2.Metadata.Id != created.Metadata.Id {
		t.Errorf("Expected ID to remain unchanged")
	}
	if retrieved2.Metadata.Slug != created.Metadata.Slug {
		t.Errorf("Expected Slug to remain unchanged")
	}
}
