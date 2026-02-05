package project

import (
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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

	// Verify basic fields preserved
	if created.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("Expected ApiVersion 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
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

	// Verify ID is generated
	if created.Metadata.Id == "" {
		t.Error("Expected ID to be generated, got empty string")
	}

	// Verify ID format: prj-{ulid}
	if !strings.HasPrefix(created.Metadata.Id, "prj-") {
		t.Errorf("Expected ID to start with 'prj-', got '%s'", created.Metadata.Id)
	}

	// ULID is 26 characters, plus "prj-" prefix = 30 characters
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
		{
			name:         "simple name",
			projectName:  "My Project",
			expectedSlug: "my-project",
		},
		{
			name:         "name with special characters",
			projectName:  "Project #1 (Test)",
			expectedSlug: "project-1-test",
		},
		{
			name:         "already lowercase",
			projectName:  "simple-project",
			expectedSlug: "simple-project",
		},
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

	// Create first project
	project1 := createTestProject("Duplicate Test")
	_, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("First create failed: %v", err)
	}

	// Attempt to create second project with same name (same slug)
	project2 := createTestProject("Duplicate Test")
	_, err = controller.Create(contextWithProjectKind(), project2)
	if err == nil {
		t.Error("Expected duplicate creation to fail, but it succeeded")
	}

	// Verify error message mentions duplicate
	if !strings.Contains(err.Error(), "already exists") && !strings.Contains(err.Error(), "duplicate") {
		t.Logf("Error message: %v", err)
	}
}

func TestCreate_AllowsDifferentSlugs(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create first project
	project1 := createTestProject("First Project")
	created1, err := controller.Create(contextWithProjectKind(), project1)
	if err != nil {
		t.Fatalf("First create failed: %v", err)
	}

	// Create second project with different name
	project2 := createTestProject("Second Project")
	created2, err := controller.Create(contextWithProjectKind(), project2)
	if err != nil {
		t.Fatalf("Second create failed: %v", err)
	}

	// Verify both have different IDs and slugs
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		// Metadata is nil
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			// Name is empty
			Org: "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
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
		ApiVersion: "invalid/v1", // Should be "agentic.stigmer.ai/v1"
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid API Version",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "InvalidKind", // Should be "Project"
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid Kind",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Missing Spec",
			Org:  "test-org",
		},
		// Spec is nil
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing spec")
	}
}

func TestCreate_RejectsMissingRuntime(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Missing Runtime",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			// Runtime is UNSPECIFIED (0)
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Create(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing/unspecified runtime")
	}
}

// ============================================================================
// Embedded Resources Tests
// ============================================================================

func TestCreate_WithEmbeddedAgents(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithAgents("Agent Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify embedded agents are preserved
	if len(created.Spec.Agents) != 1 {
		t.Fatalf("Expected 1 embedded agent, got %d", len(created.Spec.Agents))
	}

	if created.Spec.Agents[0].Metadata.Name != "test-agent" {
		t.Errorf("Expected agent name 'test-agent', got '%s'", created.Spec.Agents[0].Metadata.Name)
	}
}

func TestCreate_WithEmbeddedWorkflows(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithWorkflows("Workflow Project")

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify embedded workflows are preserved
	if len(created.Spec.Workflows) != 1 {
		t.Fatalf("Expected 1 embedded workflow, got %d", len(created.Spec.Workflows))
	}

	if created.Spec.Workflows[0].Metadata.Name != "test-workflow" {
		t.Errorf("Expected workflow name 'test-workflow', got '%s'", created.Spec.Workflows[0].Metadata.Name)
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

	// Verify status exists with audit
	if created.Status == nil {
		t.Fatal("Expected status to be set")
	}

	if created.Status.Audit == nil {
		t.Fatal("Expected audit to be set in status")
	}

	audit := created.Status.Audit

	// Verify spec_audit
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Full Spec Project",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:     projectv1.ProjectRuntime_python,
			EntryPoint:  "app.py",
			Description: "A Python project with full spec",
		},
	}

	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if created.Spec.Runtime != projectv1.ProjectRuntime_python {
		t.Errorf("Expected runtime 'python', got '%v'", created.Spec.Runtime)
	}
	if created.Spec.EntryPoint != "app.py" {
		t.Errorf("Expected entry_point 'app.py', got '%s'", created.Spec.EntryPoint)
	}
	if created.Spec.Description != "A Python project with full spec" {
		t.Errorf("Expected description to be preserved, got '%s'", created.Spec.Description)
	}
}
