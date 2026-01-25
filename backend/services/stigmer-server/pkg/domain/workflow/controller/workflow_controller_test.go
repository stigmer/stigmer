package workflow

import (
	"context"
	"net"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	workflowinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowinstance/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/structpb"
)

// contextWithWorkflowKind creates a context with the workflow resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithWorkflowKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow)
}

// contextWithWorkflowInstanceKind creates a context with the workflow instance resource kind injected
func contextWithWorkflowInstanceKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow_instance)
}

// setupInProcessServers sets up both workflow and workflow instance servers with proper circular dependencies
func setupInProcessServers(t *testing.T, store store.Store) (*grpc.ClientConn, *grpc.ClientConn, func()) {
	buffer := 1024 * 1024

	// Create workflow server and listener
	workflowListener := bufconn.Listen(buffer)
	workflowServer := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx = contextWithWorkflowKind()
			return handler(ctx, req)
		}),
	)

	// Create workflow instance server and listener
	workflowInstanceListener := bufconn.Listen(buffer)
	workflowInstanceServer := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx = contextWithWorkflowInstanceKind()
			return handler(ctx, req)
		}),
	)

	// Create client connections first (before starting servers)
	workflowConn, err := grpc.DialContext(context.Background(), "",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return workflowListener.Dial()
		}),
		grpc.WithInsecure(),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow client connection: %v", err)
	}

	workflowInstanceConn, err := grpc.DialContext(context.Background(), "",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return workflowInstanceListener.Dial()
		}),
		grpc.WithInsecure(),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow instance client connection: %v", err)
	}

	// Create clients
	workflowClient := workflow.NewClient(workflowConn)
	workflowInstanceClient := workflowinstance.NewClient(workflowInstanceConn)

	// Create and register controllers BEFORE starting servers
	workflowController := NewWorkflowController(store, workflowInstanceClient, nil)
	workflowv1.RegisterWorkflowCommandControllerServer(workflowServer, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(workflowServer, workflowController)

	workflowInstanceController := workflowinstancecontroller.NewWorkflowInstanceController(store, workflowClient)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(workflowInstanceServer, workflowInstanceController)

	// Now start both servers in background
	go func() {
		if err := workflowServer.Serve(workflowListener); err != nil {
			t.Logf("Workflow server exited with error: %v", err)
		}
	}()

	go func() {
		if err := workflowInstanceServer.Serve(workflowInstanceListener); err != nil {
			t.Logf("WorkflowInstance server exited with error: %v", err)
		}
	}()

	cleanup := func() {
		workflowConn.Close()
		workflowInstanceConn.Close()
		workflowServer.Stop()
		workflowInstanceServer.Stop()
		workflowListener.Close()
		workflowInstanceListener.Close()
	}

	return workflowConn, workflowInstanceConn, cleanup
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*WorkflowController, store.Store) {
	// Create temporary BadgerDB store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Setup both in-process servers
	_, workflowInstanceConn, cleanup := setupInProcessServers(t, store)
	t.Cleanup(cleanup)

	// Create workflow instance client and controller
	workflowInstanceClient := workflowinstance.NewClient(workflowInstanceConn)
	// Pass nil for validator in tests since validation can be skipped for testing
	controller := NewWorkflowController(store, workflowInstanceClient, nil)

	return controller, store
}

// createValidWorkflow creates a workflow with all required fields for validation
func createValidWorkflow(name, description string) *workflowv1.Workflow {
	// Create a minimal task_config for a SET task
	taskConfig, _ := structpb.NewStruct(map[string]interface{}{
		"set": map[string]interface{}{
			"test_var": "test_value",
		},
	})

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: apiresource.ApiResourceOwnerScope_platform,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: description,
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "test-task",
					Kind:       apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func TestWorkflowController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with spec fields", func(t *testing.T) {
		workflow := createValidWorkflow("Test Workflow", "Test workflow description")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify defaults set by pipeline
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "test-workflow" {
			t.Errorf("Expected slug 'test-workflow', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Workflow" {
			t.Errorf("Expected kind 'Workflow', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test workflow description" {
			t.Errorf("Expected description 'Test workflow description', got '%s'", created.Spec.Description)
		}

		// Verify default instance ID was set in status
		if created.Status == nil {
			t.Error("Expected status to be set")
		}
		if created.Status.DefaultInstanceId == "" {
			t.Error("Expected default_instance_id to be set in status")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		workflow := createValidWorkflow("Test Workflow", "Test description")
		workflow.Metadata = nil // Clear metadata to test validation

		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		workflow := createValidWorkflow("", "Test description")
		workflow.Metadata.Name = "" // Clear name to test validation

		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("duplicate workflow name", func(t *testing.T) {
		workflow := createValidWorkflow("Duplicate Workflow", "First workflow")

		// Create first workflow
		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("First Create failed: %v", err)
		}

		// Try to create duplicate
		duplicateWorkflow := createValidWorkflow("Duplicate Workflow", "Second workflow")

		_, err = controller.Create(contextWithWorkflowKind(), duplicateWorkflow)
		if err == nil {
			t.Error("Expected error for duplicate workflow name")
		}
	})
}

func TestWorkflowController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create workflow first
		workflow := createValidWorkflow("Get Test Workflow", "Test description")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the workflow
		retrieved, err := controller.Get(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}

		// Verify status is preserved
		if retrieved.Status == nil || retrieved.Status.DefaultInstanceId == "" {
			t.Error("Expected status with default_instance_id to be preserved")
		}
	})

	t.Run("get non-existent workflow", func(t *testing.T) {
		_, err := controller.Get(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent workflow")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestWorkflowController_GetByReference(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get by slug", func(t *testing.T) {
		// Create workflow first
		workflow := createValidWorkflow("Reference Test Workflow", "Test description")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get by reference using slug
		ref := &apiresource.ApiResourceReference{
			Slug: created.Metadata.Slug,
		}

		retrieved, err := controller.GetByReference(contextWithWorkflowKind(), ref)
		if err != nil {
			t.Fatalf("GetByReference failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug '%s', got '%s'", created.Metadata.Slug, retrieved.Metadata.Slug)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}
	})

	t.Run("get by non-existent slug", func(t *testing.T) {
		ref := &apiresource.ApiResourceReference{
			Slug: "non-existent-slug",
		}

		_, err := controller.GetByReference(contextWithWorkflowKind(), ref)
		if err == nil {
			t.Error("Expected error when getting by non-existent slug")
		}
	})

	t.Run("get with empty slug", func(t *testing.T) {
		ref := &apiresource.ApiResourceReference{
			Slug: "",
		}

		_, err := controller.GetByReference(contextWithWorkflowKind(), ref)
		if err == nil {
			t.Error("Expected error when getting with empty slug")
		}
	})
}

func TestWorkflowController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create workflow first
		workflow := createValidWorkflow("Update Test Workflow", "Original description")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the workflow
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithWorkflowKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}

		// Verify status is preserved
		if updated.Status == nil || updated.Status.DefaultInstanceId != created.Status.DefaultInstanceId {
			t.Error("Expected status to be preserved")
		}
	})

	t.Run("update non-existent workflow", func(t *testing.T) {
		workflow := createValidWorkflow("Non-existent Workflow", "Test description")
		workflow.Metadata.Id = "non-existent-id"

		_, err := controller.Update(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for updating non-existent workflow")
		}
	})

	t.Run("update without metadata", func(t *testing.T) {
		workflow := createValidWorkflow("Test Workflow", "Test description")
		workflow.Metadata = nil // Clear metadata to test validation

		_, err := controller.Update(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for update without metadata")
		}
	})
}

func TestWorkflowController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create workflow first
		workflow := createValidWorkflow("Delete Test Workflow", "Test description")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the workflow
		deleted, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted workflow ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify workflow is deleted
		_, err = controller.Get(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted workflow")
		}
	})

	t.Run("delete non-existent workflow", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent workflow")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted workflow returns correct data", func(t *testing.T) {
		// Create workflow with specific data
		workflow := createValidWorkflow("Delete Verify Workflow", "Verify deletion data")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.Description != "Verify deletion data" {
			t.Errorf("Expected description 'Verify deletion data', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Workflow" {
			t.Errorf("Expected name 'Delete Verify Workflow', got '%s'", deleted.Metadata.Name)
		}

		// Verify status is preserved in delete response
		if deleted.Status == nil || deleted.Status.DefaultInstanceId == "" {
			t.Error("Expected status with default_instance_id to be preserved in delete response")
		}
	})
}

func TestWorkflowController_CreateWithDefaultInstance(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("verify default instance created with workflow", func(t *testing.T) {
		workflow := createValidWorkflow("Instance Test Workflow", "Test workflow for default instance")

		created, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify status contains default_instance_id
		if created.Status == nil {
			t.Fatal("Expected status to be set")
		}

		if created.Status.DefaultInstanceId == "" {
			t.Error("Expected default_instance_id to be set in status")
		}

		// Verify default_instance_id is valid (not empty mock)
		if created.Status.DefaultInstanceId == "" {
			t.Error("Expected non-empty default_instance_id")
		}
	})
}
