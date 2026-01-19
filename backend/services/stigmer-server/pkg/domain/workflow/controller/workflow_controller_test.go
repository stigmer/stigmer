package workflow

import (
	"context"
	"net"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	workflowinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowinstance/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
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

// setupInProcessWorkflowInstanceServer creates an in-process gRPC server for workflow instance
func setupInProcessWorkflowInstanceServer(t *testing.T, store *badger.Store) (*grpc.ClientConn, func()) {
	// Create a listener using bufconn
	buffer := 1024 * 1024
	listener := bufconn.Listen(buffer)

	// Create gRPC server
	server := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			// Inject api_resource_kind for workflow instance operations
			ctx = contextWithWorkflowInstanceKind()
			return handler(ctx, req)
		}),
	)

	// Register workflow instance controller (without workflow client to avoid circular dependency)
	workflowInstanceController := workflowinstancecontroller.NewWorkflowInstanceController(store, nil)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(server, workflowInstanceController)

	// Start server in background
	go func() {
		if err := server.Serve(listener); err != nil {
			t.Logf("Server exited with error: %v", err)
		}
	}()

	// Create client connection
	conn, err := grpc.DialContext(context.Background(), "",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithInsecure(),
	)
	if err != nil {
		t.Fatalf("Failed to create client connection: %v", err)
	}

	cleanup := func() {
		conn.Close()
		server.Stop()
		listener.Close()
	}

	return conn, cleanup
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*WorkflowController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Setup in-process workflow instance server
	conn, cleanup := setupInProcessWorkflowInstanceServer(t, store)
	t.Cleanup(cleanup)

	// Create workflow instance client using the in-process connection
	workflowInstanceClient := workflowinstance.NewClient(conn)

	// Create workflow controller
	controller := NewWorkflowController(store, workflowInstanceClient)

	return controller, store
}

func TestWorkflowController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with spec fields", func(t *testing.T) {
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test workflow description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("duplicate workflow name", func(t *testing.T) {
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Duplicate Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "First workflow",
			},
		}

		// Create first workflow
		_, err := controller.Create(contextWithWorkflowKind(), workflow)
		if err != nil {
			t.Fatalf("First Create failed: %v", err)
		}

		// Try to create duplicate
		duplicateWorkflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Duplicate Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Second workflow",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Reference Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Original description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Update(contextWithWorkflowKind(), workflow)
		if err == nil {
			t.Error("Expected error for updating non-existent workflow")
		}
	})

	t.Run("update without metadata", func(t *testing.T) {
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test description",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Verify deletion data",
			},
		}

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
		workflow := &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Instance Test Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Test workflow for default instance",
			},
		}

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
