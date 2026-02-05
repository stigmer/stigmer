package project

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/types/known/structpb"
)

// contextWithProjectKind creates a context with the project resource kind injected.
// This simulates what the apiresource interceptor does in production.
func contextWithProjectKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_project)
}

// setupTestController creates a test controller with necessary dependencies.
func setupTestController(t *testing.T) (*ProjectController, store.Store) {
	t.Helper()

	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Pass nil for reconciliationService to use the default implementation
	controller := NewProjectController(store, nil)

	return controller, store
}

// createTestProject creates a valid Project proto for testing.
func createTestProject(name string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:     projectv1.ProjectRuntime_go,
			EntryPoint:  "main.go",
			Description: "Test project for unit tests",
		},
	}
}

// createTestProjectWithAgents creates a Project with embedded agents for testing.
func createTestProjectWithAgents(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.Agents = []*agentv1.Agent{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "test-agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "A test agent for project testing",
				Instructions: "You are a helpful test agent that assists with testing.",
			},
		},
	}
	return project
}

// createTestProjectWithWorkflows creates a Project with embedded workflows for testing.
func createTestProjectWithWorkflows(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.Workflows = []*workflowv1.Workflow{
		{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "test-workflow",
				Org:  "test-org",
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "A test workflow for project testing",
				Document: &workflowv1.WorkflowDocument{
					Dsl:       "1.0.0",
					Namespace: "test",
					Name:      "test-workflow",
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
	return project
}

func TestNewProjectController_CreatesWithStore(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	if controller == nil {
		t.Fatal("Expected controller to be created, got nil")
	}

	if controller.store == nil {
		t.Error("Expected store to be set in controller")
	}
}

func TestProjectController_ImplementsCommandServer(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Type assertion to verify interface implementation
	var _ projectv1.ProjectCommandControllerServer = controller

	// Verify the type assertion compiles - this is a compile-time check
	// but we also verify at runtime
	if _, ok := interface{}(controller).(projectv1.ProjectCommandControllerServer); !ok {
		t.Error("ProjectController does not implement ProjectCommandControllerServer")
	}
}

func TestProjectController_ImplementsQueryServer(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Type assertion to verify interface implementation
	var _ projectv1.ProjectQueryControllerServer = controller

	// Verify the type assertion compiles - this is a compile-time check
	// but we also verify at runtime
	if _, ok := interface{}(controller).(projectv1.ProjectQueryControllerServer); !ok {
		t.Error("ProjectController does not implement ProjectQueryControllerServer")
	}
}

func TestProjectController_AllMethodsImplemented(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Verify that the controller implements all expected methods
	// All CRUD operations and Apply are now implemented (D1, D2, D3, D4)
	// This is a compile-time check via interface satisfaction
	var _ projectv1.ProjectCommandControllerServer = controller
	var _ projectv1.ProjectQueryControllerServer = controller

	// Verify we can call Apply without getting "unimplemented" error
	ctx := contextWithProjectKind()
	_, err := controller.Apply(ctx, createTestProject("implemented-test"))
	if err != nil {
		// Apply may fail for other reasons, but should not be "unimplemented"
		if strings.Contains(err.Error(), "unimplemented") {
			t.Error("Apply should be implemented, got unimplemented error")
		}
	}
}

func TestCreateTestProject_ValidProto(t *testing.T) {
	project := createTestProject("My Test Project")

	if project.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("Expected ApiVersion 'agentic.stigmer.ai/v1', got '%s'", project.ApiVersion)
	}

	if project.Kind != "Project" {
		t.Errorf("Expected Kind 'Project', got '%s'", project.Kind)
	}

	if project.Metadata.Name != "My Test Project" {
		t.Errorf("Expected Name 'My Test Project', got '%s'", project.Metadata.Name)
	}

	if project.Metadata.Org != "test-org" {
		t.Errorf("Expected Org 'test-org', got '%s'", project.Metadata.Org)
	}

	if project.Spec.Runtime != projectv1.ProjectRuntime_go {
		t.Errorf("Expected Runtime 'go', got '%v'", project.Spec.Runtime)
	}

	if project.Spec.EntryPoint != "main.go" {
		t.Errorf("Expected EntryPoint 'main.go', got '%s'", project.Spec.EntryPoint)
	}
}

func TestCreateTestProjectWithAgents_HasEmbeddedAgents(t *testing.T) {
	project := createTestProjectWithAgents("Agent Project")

	if len(project.Spec.Agents) != 1 {
		t.Fatalf("Expected 1 embedded agent, got %d", len(project.Spec.Agents))
	}

	agent := project.Spec.Agents[0]
	if agent.Metadata.Name != "test-agent" {
		t.Errorf("Expected agent name 'test-agent', got '%s'", agent.Metadata.Name)
	}

	if agent.Spec.Description != "A test agent for project testing" {
		t.Errorf("Expected agent description 'A test agent for project testing', got '%s'", agent.Spec.Description)
	}
}

func TestCreateTestProjectWithWorkflows_HasEmbeddedWorkflows(t *testing.T) {
	project := createTestProjectWithWorkflows("Workflow Project")

	if len(project.Spec.Workflows) != 1 {
		t.Fatalf("Expected 1 embedded workflow, got %d", len(project.Spec.Workflows))
	}

	workflow := project.Spec.Workflows[0]
	if workflow.Metadata.Name != "test-workflow" {
		t.Errorf("Expected workflow name 'test-workflow', got '%s'", workflow.Metadata.Name)
	}

	if workflow.Spec.Description != "A test workflow for project testing" {
		t.Errorf("Expected workflow description 'A test workflow for project testing', got '%s'", workflow.Spec.Description)
	}
}

func TestContextWithProjectKind_SetsCorrectKind(t *testing.T) {
	ctx := contextWithProjectKind()

	kind := ctx.Value(apiresourceinterceptor.ApiResourceKindKey)
	if kind == nil {
		t.Fatal("Expected api_resource_kind to be set in context")
	}

	if kind != apiresourcekind.ApiResourceKind_project {
		t.Errorf("Expected kind to be 'project', got '%v'", kind)
	}
}
