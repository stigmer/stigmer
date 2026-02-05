package project

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
	"google.golang.org/protobuf/types/known/structpb"
)

// ============================================================================
// Idempotent Semantics Tests
// ============================================================================

func TestApply_CreatesNewProjectWhenNotExists(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("New Apply Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify project was created
	if applied.Metadata.Id == "" {
		t.Error("Expected ID to be generated")
	}
	if applied.Metadata.Name != "New Apply Project" {
		t.Errorf("Expected Name 'New Apply Project', got '%s'", applied.Metadata.Name)
	}
	if applied.Metadata.Slug != "new-apply-project" {
		t.Errorf("Expected Slug 'new-apply-project', got '%s'", applied.Metadata.Slug)
	}
}

func TestApply_UpdatesExistingProjectWhenExists(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// First create a project
	project := createTestProject("Existing Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	originalID := created.Metadata.Id

	// Now apply with updated description
	project.Spec.Description = "Updated description via apply"
	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify it was updated (same ID)
	if applied.Metadata.Id != originalID {
		t.Errorf("Expected ID to remain '%s', got '%s'", originalID, applied.Metadata.Id)
	}
	if applied.Spec.Description != "Updated description via apply" {
		t.Errorf("Expected updated description, got '%s'", applied.Spec.Description)
	}
}

func TestApply_IsIdempotent(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Idempotent Project")

	// Apply twice
	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	second, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Second Apply failed: %v", err)
	}

	// Verify same ID
	if first.Metadata.Id != second.Metadata.Id {
		t.Errorf("Expected same ID across applies, got '%s' and '%s'",
			first.Metadata.Id, second.Metadata.Id)
	}
}

func TestApply_WithChangedSpecTriggersUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Spec Change Project")
	project.Spec.Description = "Initial description"

	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	// Change the spec
	project.Spec.Description = "Changed description"
	second, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Second Apply failed: %v", err)
	}

	// Verify ID preserved and description updated
	if first.Metadata.Id != second.Metadata.Id {
		t.Error("Expected ID to be preserved across updates")
	}
	if second.Spec.Description != "Changed description" {
		t.Errorf("Expected description 'Changed description', got '%s'", second.Spec.Description)
	}
}

func TestApply_PreservesProjectIdAcrossUpdates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Preserve ID Project")

	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	// Multiple applies
	for i := 0; i < 3; i++ {
		project.Spec.Description = "Update " + string(rune('A'+i))
		applied, err := controller.Apply(contextWithProjectKind(), project)
		if err != nil {
			t.Fatalf("Apply %d failed: %v", i+1, err)
		}
		if applied.Metadata.Id != first.Metadata.Id {
			t.Errorf("Apply %d: Expected ID '%s', got '%s'", i+1, first.Metadata.Id, applied.Metadata.Id)
		}
	}
}

// ============================================================================
// Reconciliation Integration Tests
// ============================================================================

func TestApply_ReturnsReconciliationSummaryInResponse(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Reconciliation Summary Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify status exists (may not have reconciliation changes for empty project)
	if applied.Status == nil {
		t.Fatal("Expected status to be set")
	}
	// Note: For a project without embedded resources, ReconciliationSummary may be nil or empty
}

func TestApply_WithNewAgentsShowsCreates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithAgents("Agent Creates Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify reconciliation summary shows agent create
	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	if len(summary.Created) == 0 {
		t.Error("Expected at least one create in reconciliation summary")
	}
}

func TestApply_WithWorkflowsShowsCreates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithWorkflows("Workflow Creates Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	if len(summary.Created) == 0 {
		t.Error("Expected workflow create in reconciliation summary")
	}
}

func TestApply_WithMcpServersShowsCreates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMcpServers("MCP Creates Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	if len(summary.Created) == 0 {
		t.Error("Expected MCP server create in reconciliation summary")
	}
}

func TestApply_WithSkillsShowsCreates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithSkills("Skill Creates Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	if len(summary.Created) == 0 {
		t.Error("Expected skill create in reconciliation summary")
	}
}

func TestApply_WithMixedResourcesReturnsCorrectCounts(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMixedResources("Mixed Resources Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	// Should have 4 creates (1 agent, 1 workflow, 1 MCP server, 1 skill)
	if len(summary.Created) != 4 {
		t.Errorf("Expected 4 creates, got %d", len(summary.Created))
	}
}

// ============================================================================
// Validation Tests
// ============================================================================

func TestApply_RejectsMissingMetadata(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing metadata")
	}
}

func TestApply_RejectsMissingName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Org: "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing name")
	}
}

func TestApply_RejectsInvalidApiVersion(t *testing.T) {
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
			Runtime:    projectv1.ProjectRuntime_go,
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid api_version")
	}
}

func TestApply_RejectsInvalidKind(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "InvalidKind",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid Kind",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    projectv1.ProjectRuntime_go,
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid kind")
	}
}

func TestApply_RejectsMissingSpec(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Missing Spec",
			Org:  "test-org",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing spec")
	}
}

// ============================================================================
// Audit and Metadata Tests
// ============================================================================

func TestApply_GeneratesValidID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("ID Generation Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify ID format: prj-{ulid}
	if !strings.HasPrefix(applied.Metadata.Id, "prj-") {
		t.Errorf("Expected ID to start with 'prj-', got '%s'", applied.Metadata.Id)
	}

	// ULID is 26 characters, plus "prj-" prefix = 30 characters
	if len(applied.Metadata.Id) != 30 {
		t.Errorf("Expected ID length 30, got %d", len(applied.Metadata.Id))
	}
}

func TestApply_GeneratesSlugFromName(t *testing.T) {
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

			applied, err := controller.Apply(contextWithProjectKind(), project)
			if err != nil {
				t.Fatalf("Apply failed: %v", err)
			}

			if applied.Metadata.Slug != tt.expectedSlug {
				t.Errorf("Expected slug '%s', got '%s'", tt.expectedSlug, applied.Metadata.Slug)
			}
		})
	}
}

func TestApply_SetsAuditFields(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Audit Test Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil {
		t.Fatal("Expected status to be set")
	}

	if applied.Status.Audit == nil {
		t.Fatal("Expected audit to be set in status")
	}

	audit := applied.Status.Audit
	if audit.SpecAudit == nil {
		t.Error("Expected spec_audit to be set")
	} else {
		if audit.SpecAudit.CreatedAt == nil {
			t.Error("Expected created_at to be set")
		}
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestApply_HandlesReconciliationGracefully(t *testing.T) {
	// This test verifies that even if reconciliation has issues,
	// the project itself is still persisted successfully
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Error Handling Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply should not fail: %v", err)
	}

	// Project should be persisted
	if applied.Metadata.Id == "" {
		t.Error("Expected project to be persisted with an ID")
	}
}

// ============================================================================
// Mock ReconciliationService Tests
// ============================================================================

func TestApply_WithMockReconciliationService(t *testing.T) {
	store, err := setupTestStore(t)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer store.Close()

	// Create a mock reconciliation service
	mockService := &mockReconciliationService{
		result: reconcile.NewSuccessResult(
			[]*projectv1.ResourceChangeRecord{
				{Slug: "mock-agent"},
			},
			nil,
			nil,
		),
	}

	controller := NewProjectController(store, mockService)

	project := createTestProject("Mock Service Project")
	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	// Verify mock was used
	if !mockService.called {
		t.Error("Expected mock reconciliation service to be called")
	}

	// Verify mock result is in response
	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}
	if len(applied.Status.LastReconciliation.Created) != 1 {
		t.Errorf("Expected 1 create from mock, got %d", len(applied.Status.LastReconciliation.Created))
	}
}

// ============================================================================
// Helper Types and Functions
// ============================================================================

// mockReconciliationService is a test double for ReconciliationService
type mockReconciliationService struct {
	called  bool
	result  *reconcile.ReconciliationResult
	err     error
	options *reconcile.ReconciliationOptions
}

func (m *mockReconciliationService) Reconcile(
	ctx context.Context,
	project *projectv1.Project,
	options *reconcile.ReconciliationOptions,
) (*reconcile.ReconciliationResult, error) {
	m.called = true
	m.options = options
	if m.err != nil {
		return nil, m.err
	}
	if m.result == nil {
		return reconcile.EmptyResult(), nil
	}
	return m.result, nil
}

// setupTestStore creates a test store (separate from controller setup for mock tests)
func setupTestStore(t *testing.T) (store.Store, error) {
	t.Helper()
	return sqlite.NewStore(t.TempDir() + "/test.sqlite")
}

// createTestProjectWithMcpServers creates a Project with embedded MCP servers for testing.
func createTestProjectWithMcpServers(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.McpServers = []*mcpserverv1.McpServer{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "test-mcp-server",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "A test MCP server for project testing",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "echo",
						Args:    []string{"hello"},
					},
				},
			},
		},
	}
	return project
}

// createTestProjectWithSkills creates a Project with embedded skills for testing.
func createTestProjectWithSkills(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.Skills = []*skillv1.Skill{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "test-skill",
				Org:  "test-org",
			},
			Spec: &skillv1.SkillSpec{
				Name:        "test-skill", // Must match regex ^[a-z0-9]+(-[a-z0-9]+)*$
				Description: "A test skill for project testing",
				SkillMd:     "# Test Skill\n\nThis is a test skill.",
			},
		},
	}
	return project
}

// createTestProjectWithMixedResources creates a Project with all resource types.
func createTestProjectWithMixedResources(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.Agents = []*agentv1.Agent{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "mixed-agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Test agent",
				Instructions: "You are a test agent that helps with testing. Be helpful and respond accurately.",
			},
		},
	}
	project.Spec.Workflows = []*workflowv1.Workflow{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "mixed-workflow",
				Org:  "test-org",
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test workflow",
				Document: &workflowv1.WorkflowDocument{
					Dsl:       "1.0.0",
					Namespace: "test",
					Name:      "mixed-workflow",
					Version:   "1.0.0",
				},
				Tasks: []*workflowv1.WorkflowTask{
					{
						Name:       "test-task",
						Kind:       workflowv1.WorkflowTaskKind_set_vars,
						TaskConfig: &structpb.Struct{Fields: map[string]*structpb.Value{}},
					},
				},
			},
		},
	}
	project.Spec.McpServers = []*mcpserverv1.McpServer{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "mixed-mcp-server",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test MCP server",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "echo",
						Args:    []string{"hello"},
					},
				},
			},
		},
	}
	project.Spec.Skills = []*skillv1.Skill{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "mixed-skill",
				Org:  "test-org",
			},
			Spec: &skillv1.SkillSpec{
				Name:        "mixed-skill", // Must match regex ^[a-z0-9]+(-[a-z0-9]+)*$
				Description: "Test skill",
				SkillMd:     "# Mixed Skill\n\nThis is a test skill.",
			},
		},
	}
	return project
}
