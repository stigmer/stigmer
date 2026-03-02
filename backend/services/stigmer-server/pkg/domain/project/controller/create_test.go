package project

import (
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ============================================================================
// Successful Creation Tests
// ============================================================================

func TestCreate_SuccessfulCreation(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("My Test Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.ApiVersion != "management.stigmer.ai/v1" {
		t.Errorf("Expected ApiVersion 'management.stigmer.ai/v1', got '%s'", created.ApiVersion)
	}
	if created.Kind != "Project" {
		t.Errorf("Expected Kind 'Project', got '%s'", created.Kind)
	}
	if created.Metadata.Name != "My Test Project" {
		t.Errorf("Expected Name 'My Test Project', got '%s'", created.Metadata.Name)
	}
	if created.Metadata.Org != "test-org" {
		t.Errorf("Expected Org 'test-org', got '%s'", created.Metadata.Org)
	}
}

func TestCreate_GeneratesValidID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("ID Test Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.Metadata.Id == "" {
		t.Error("Expected ID to be generated, got empty string")
	}

	if !strings.HasPrefix(created.Metadata.Id, "prj-") {
		t.Errorf("Expected ID to start with 'prj-', got '%s'", created.Metadata.Id)
	}

	if len(created.Metadata.Id) != 30 {
		t.Errorf("Expected ID length 30 (prj- + 26 char ULID), got %d", len(created.Metadata.Id))
	}
}

func TestCreate_GeneratesSlugFromName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	tests := []struct {
		name         string
		projectName  string
		expectedSlug string
	}{
		{"simple name", "My Project", "my-project"},
		{"name with special characters", "Project #1 (Test)", "project-1-test"},
		{"already lowercase", "simple-project", "simple-project"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := createTestProject(tt.projectName)

			created, err := controller.Create(contextWithProjectKind(), project)
			if err != nil {
				t.Fatalf("Create failed: %v", err)
			}

			if created.Metadata.Slug != tt.expectedSlug {
				t.Errorf("Expected slug '%s', got '%s'", tt.expectedSlug, created.Metadata.Slug)
			}
		})
	}
}

// ============================================================================
// Duplicate Detection Tests
// ============================================================================

func TestCreate_RejectsDuplicateSlug(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project1 := createTestProject("Duplicate Test")
	_, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("First create failed: %v", err)
	}

	project2 := createTestProject("Duplicate Test")
	_, err = controller.Create(contextWithProjectKind(), project2)
	if err == nil {
		t.Error("Expected duplicate creation to fail, but it succeeded")
	}
}

func TestCreate_AllowsDifferentSlugs(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project1 := createTestProject("First Project")
	created1, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("First create failed: %v", err)
	}

	project2 := createTestProject("Second Project")
	created2, err := controller.Create(contextWithProjectKind(), project2)
	if err != nil {
		t.Fatalf("Second create failed: %v", err)
	}

	if created1.Metadata.Id == created2.Metadata.Id {
		t.Error("Expected different IDs for different projects")
	}
	if created1.Metadata.Slug == created2.Metadata.Slug {
		t.Error("Expected different slugs for different projects")
	}
}

// ============================================================================
// Validation Error Tests
// ============================================================================

func TestCreate_RejectsMissingMetadata(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "Project",
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing metadata")
	}
}

func TestCreate_RejectsMissingName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Org: "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing name")
	}
}

func TestCreate_RejectsInvalidApiVersion(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "invalid/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid API Version",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid api_version")
	}
}

func TestCreate_RejectsInvalidKind(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "InvalidKind",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid Kind",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid kind")
	}
}

func TestCreate_RejectsMissingSpec(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Missing Spec",
			Org:  "test-org",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing spec")
	}
}

// ============================================================================
// Members Tests
// ============================================================================

func TestCreate_WithMembers(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMembers("Member Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if len(created.Spec.Members) != 2 {
		t.Fatalf("Expected 2 members, got %d", len(created.Spec.Members))
	}

	if created.Spec.Members[0].GetSlug() != "test-agent" {
		t.Errorf("Expected first member slug 'test-agent', got '%s'", created.Spec.Members[0].GetSlug())
	}
	if created.Spec.Members[0].GetKind() != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("Expected first member kind 'agent', got '%v'", created.Spec.Members[0].GetKind())
	}
}

// ============================================================================
// Audit Fields Tests
// ============================================================================

func TestCreate_SetsAuditFields(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Audit Test Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.Status == nil {
		t.Fatal("Expected status to be set")
	}
	if created.Status.Audit == nil {
		t.Fatal("Expected audit to be set in status")
	}

	audit := created.Status.Audit
	if audit.SpecAudit == nil {
		t.Error("Expected spec_audit to be set")
	} else {
		if audit.SpecAudit.CreatedAt == nil {
			t.Error("Expected created_at to be set")
		}
		if audit.SpecAudit.UpdatedAt == nil {
			t.Error("Expected updated_at to be set")
		}
		if audit.SpecAudit.Event != "created" {
			t.Errorf("Expected event 'created', got '%s'", audit.SpecAudit.Event)
		}
	}
}

// ============================================================================
// Spec Preservation Tests
// ============================================================================

func TestCreate_PreservesSpecFields(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Full Spec Project",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "app.py",
			Description: "A project with full spec",
		},
	}

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.Spec.EntryPoint != "app.py" {
		t.Errorf("Expected entry_point 'app.py', got '%s'", created.Spec.EntryPoint)
	}
	if created.Spec.Description != "A project with full spec" {
		t.Errorf("Expected description to be preserved, got '%s'", created.Spec.Description)
	}
}
