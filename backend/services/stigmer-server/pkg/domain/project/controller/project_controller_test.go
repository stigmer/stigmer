package project

import (
	"context"
	"strings"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// contextWithProjectKind creates a context with the project resource kind injected.
// This simulates what the apiresource interceptor does in production.
func contextWithProjectKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_project)
}

// setupTestController creates a test controller with necessary dependencies.
func setupTestController(t *testing.T) (*ProjectController, store.Store) {
	t.Helper()

	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewProjectController(store, nil)

	return controller, store
}

// createTestProject creates a valid Project proto for testing.
func createTestProject(name string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "management.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "main.go",
			Description: "Test project for unit tests",
		},
	}
}

// createTestProjectWithMembers creates a Project with member references for testing.
func createTestProjectWithMembers(name string) *projectv1.Project {
	project := createTestProject(name)
	project.Spec.Members = []*apiresource.ApiResourceReference{
		{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "test-agent"},
		{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "test-workflow"},
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

	var _ projectv1.ProjectCommandControllerServer = controller

	if _, ok := interface{}(controller).(projectv1.ProjectCommandControllerServer); !ok {
		t.Error("ProjectController does not implement ProjectCommandControllerServer")
	}
}

func TestProjectController_ImplementsQueryServer(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	var _ projectv1.ProjectQueryControllerServer = controller

	if _, ok := interface{}(controller).(projectv1.ProjectQueryControllerServer); !ok {
		t.Error("ProjectController does not implement ProjectQueryControllerServer")
	}
}

func TestProjectController_AllMethodsImplemented(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	var _ projectv1.ProjectCommandControllerServer = controller
	var _ projectv1.ProjectQueryControllerServer = controller

	ctx := contextWithProjectKind()
	_, err := controller.Apply(ctx, createTestProject("implemented-test"))
	if err != nil {
		if strings.Contains(err.Error(), "unimplemented") {
			t.Error("Apply should be implemented, got unimplemented error")
		}
	}
}

func TestCreateTestProject_ValidProto(t *testing.T) {
	project := createTestProject("My Test Project")

	if project.ApiVersion != "management.stigmer.ai/v1" {
		t.Errorf("Expected ApiVersion 'management.stigmer.ai/v1', got '%s'", project.ApiVersion)
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

	if project.Spec.EntryPoint != "main.go" {
		t.Errorf("Expected EntryPoint 'main.go', got '%s'", project.Spec.EntryPoint)
	}
}

func TestCreateTestProjectWithMembers_HasMembers(t *testing.T) {
	project := createTestProjectWithMembers("Member Project")

	if len(project.Spec.Members) != 2 {
		t.Fatalf("Expected 2 members, got %d", len(project.Spec.Members))
	}

	if project.Spec.Members[0].GetSlug() != "test-agent" {
		t.Errorf("Expected first member slug 'test-agent', got '%s'", project.Spec.Members[0].GetSlug())
	}

	if project.Spec.Members[1].GetSlug() != "test-workflow" {
		t.Errorf("Expected second member slug 'test-workflow', got '%s'", project.Spec.Members[1].GetSlug())
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
