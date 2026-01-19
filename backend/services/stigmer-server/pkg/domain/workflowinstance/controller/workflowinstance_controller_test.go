package workflowinstance

import (
	"context"
	"net"
	"testing"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	workflowcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

// contextWithWorkflowInstanceKind creates a context with the workflow instance resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithWorkflowInstanceKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow_instance)
}

// contextWithWorkflowKind creates a context with the workflow resource kind injected
// Used for workflow operations
func contextWithWorkflowKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow)
}

// setupInProcessWorkflowServer creates an in-process gRPC server for workflow
func setupInProcessWorkflowServer(t *testing.T, store *badger.Store) (*grpc.ClientConn, func()) {
	// Create a listener using bufconn
	buffer := 1024 * 1024
	listener := bufconn.Listen(buffer)

	// Create gRPC server
	server := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			// Inject api_resource_kind for workflow operations
			ctx = contextWithWorkflowKind()
			return handler(ctx, req)
		}),
	)

	// Register workflow controller (without workflow instance client to avoid circular dependency)
	workflowController := workflowcontroller.NewWorkflowController(store, nil)
	workflowv1.RegisterWorkflowCommandControllerServer(server, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(server, workflowController)

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

// testControllers holds all controllers needed for testing
type testControllers struct {
	workflowInstance *WorkflowInstanceController
	workflow         *workflowcontroller.WorkflowController
	store            *badger.Store
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) *testControllers {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Setup in-process workflow server
	conn, cleanup := setupInProcessWorkflowServer(t, store)
	t.Cleanup(cleanup)

	// Create workflow client using the in-process connection
	workflowClient := workflow.NewClient(conn)

	// Create workflow instance controller
	workflowInstanceController := NewWorkflowInstanceController(store, workflowClient)

	// Create workflow controller for test setup
	workflowController := workflowcontroller.NewWorkflowController(store, nil)

	return &testControllers{
		workflowInstance: workflowInstanceController,
		workflow:         workflowController,
		store:            store,
	}
}

// createTestWorkflow creates a workflow in the store for testing
func createTestWorkflow(t *testing.T, controllers *testControllers, name string, scope apiresource.ApiResourceOwnerScope, org string) *workflowv1.Workflow {
	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: scope,
			Org:        org,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow",
		},
	}

	// Create workflow using the workflow controller directly
	created, err := controllers.workflow.Create(contextWithWorkflowKind(), wf)
	if err != nil {
		t.Fatalf("failed to create test workflow: %v", err)
	}

	return created
}

func TestWorkflowInstanceController_Create(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful creation with workflow_id", func(t *testing.T) {
		// Create a parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Test instance description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
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

		if created.Metadata.Slug != "test-instance" {
			t.Errorf("Expected slug 'test-instance', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "WorkflowInstance" {
			t.Errorf("Expected kind 'WorkflowInstance', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify workflow_id is preserved
		if created.Spec.WorkflowId != parentWorkflow.Metadata.Id {
			t.Errorf("Expected workflow_id '%s', got '%s'", parentWorkflow.Metadata.Id, created.Spec.WorkflowId)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test instance description" {
			t.Errorf("Expected description 'Test instance description', got '%s'", created.Spec.Description)
		}
	})

	t.Run("validation error - missing workflow_id", func(t *testing.T) {
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				Description: "Test description",
			},
		}

		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error when workflow_id is not provided")
		}
	})

	t.Run("error - non-existent workflow_id", func(t *testing.T) {
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  "non-existent-workflow-id",
				Description: "Test description",
			},
		}

		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error when workflow does not exist")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  "wfl-test-123",
				Description: "Test description",
			},
		}

		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  "wfl-test-123",
				Description: "Test description",
			},
		}

		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("same-org validation - org workflow can create instance in same org", func(t *testing.T) {
		// Create org-scoped workflow
		parentWorkflow := createTestWorkflow(t, store, "wfl-org-123", "org-workflow", apiresource.ApiResourceOwnerScope_organization, "org-123")

		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Org Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
				Org:        "org-123", // Same org as workflow
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Org instance description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed for same-org instance: %v", err)
		}

		if created.Metadata.Org != "org-123" {
			t.Errorf("Expected org 'org-123', got '%s'", created.Metadata.Org)
		}
	})

	t.Run("same-org validation - org workflow cannot create instance in different org", func(t *testing.T) {
		// Create org-scoped workflow
		parentWorkflow := createTestWorkflow(t, store, "wfl-org-456", "org-workflow-2", apiresource.ApiResourceOwnerScope_organization, "org-456")

		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Cross Org Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
				Org:        "org-789", // Different org from workflow
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Cross-org instance description",
			},
		}

		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error when creating instance of org workflow in different org")
		}
	})
}

func TestWorkflowInstanceController_Get(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "get-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create instance first
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Test description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the instance
		retrieved, err := controllers.workflowInstance.Get(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}

		if retrieved.Spec.WorkflowId != parentWorkflow.Metadata.Id {
			t.Errorf("Expected workflow_id '%s', got '%s'", parentWorkflow.Metadata.Id, retrieved.Spec.WorkflowId)
		}
	})

	t.Run("get non-existent instance", func(t *testing.T) {
		_, err := controllers.workflowInstance.Get(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent instance")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controllers.workflowInstance.Get(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestWorkflowInstanceController_GetByReference(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful get by slug", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "ref-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create instance first
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get By Reference Test",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Test description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get by slug
		ref := &apiresource.ApiResourceReference{
			Slug: created.Metadata.Slug,
		}
		retrieved, err := controllers.workflowInstance.GetByReference(contextWithWorkflowInstanceKind(), ref)
		if err != nil {
			t.Fatalf("GetByReference failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug '%s', got '%s'", created.Metadata.Slug, retrieved.Metadata.Slug)
		}
	})

	t.Run("get by reference with non-existent slug", func(t *testing.T) {
		ref := &apiresource.ApiResourceReference{
			Slug: "non-existent-slug",
		}
		_, err := controllers.workflowInstance.GetByReference(contextWithWorkflowInstanceKind(), ref)
		if err == nil {
			t.Error("Expected error when getting with non-existent slug")
		}
	})
}

func TestWorkflowInstanceController_Update(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "update-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create instance first
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Original description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the instance
		created.Spec.Description = "Updated description"
		updated, err := controllers.workflowInstance.Update(contextWithWorkflowInstanceKind(), created)
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
	})

	t.Run("update non-existent instance", func(t *testing.T) {
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  "wfl-test-123",
				Description: "Test description",
			},
		}

		_, err := controllers.workflowInstance.Update(contextWithWorkflowInstanceKind(), instance)
		if err == nil {
			t.Error("Expected error for updating non-existent instance")
		}
	})
}

func TestWorkflowInstanceController_Delete(t *testing.T) {
	controller, store, _ := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, store, "wfl-delete-test", "delete-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create instance first
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Test description",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the instance
		deleted, err := controller.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted instance ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify instance is deleted
		_, err = controller.Get(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted instance")
		}
	})

	t.Run("delete non-existent instance", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent instance")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted instance returns correct data", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, store, "wfl-delete-verify", "delete-verify-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create instance with specific data
		instance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  parentWorkflow.Metadata.Id,
				Description: "Verify deletion data",
			},
		}

		created, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.WorkflowId != parentWorkflow.Metadata.Id {
			t.Errorf("Expected workflow_id '%s', got '%s'", parentWorkflow.Metadata.Id, deleted.Spec.WorkflowId)
		}

		if deleted.Spec.Description != "Verify deletion data" {
			t.Errorf("Expected description 'Verify deletion data', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Instance" {
			t.Errorf("Expected name 'Delete Verify Instance', got '%s'", deleted.Metadata.Name)
		}
	})
}

func TestWorkflowInstanceController_GetByWorkflow(t *testing.T) {
	controller, store, _ := setupTestController(t)
	defer store.Close()

	t.Run("successful get by workflow with multiple instances", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, store, "wfl-list-test", "list-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create another workflow to test filtering
		otherWorkflow := createTestWorkflow(t, store, "wfl-other-test", "other-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create multiple instances for the parent workflow
		for i := 1; i <= 3; i++ {
			instance := &workflowinstancev1.WorkflowInstance{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "WorkflowInstance",
				Metadata: &apiresource.ApiResourceMetadata{
					Name:       "Instance " + string(rune(i+'0')),
					OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
				},
				Spec: &workflowinstancev1.WorkflowInstanceSpec{
					WorkflowId:  parentWorkflow.Metadata.Id,
					Description: "Instance description " + string(rune(i+'0')),
				},
			}
			_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
			if err != nil {
				t.Fatalf("Create failed for instance %d: %v", i, err)
			}
		}

		// Create one instance for the other workflow
		otherInstance := &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Other Instance",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{
				WorkflowId:  otherWorkflow.Metadata.Id,
				Description: "Other instance description",
			},
		}
		_, err := controller.Create(contextWithWorkflowInstanceKind(), otherInstance)
		if err != nil {
			t.Fatalf("Create failed for other instance: %v", err)
		}

		// Get instances by workflow
		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: parentWorkflow.Metadata.Id,
		}
		list, err := controller.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err != nil {
			t.Fatalf("GetByWorkflow failed: %v", err)
		}

		// Verify we got exactly 3 instances (not 4)
		if len(list.Entries) != 3 {
			t.Errorf("Expected 3 instances, got %d", len(list.Entries))
		}

		// Verify all instances belong to the parent workflow
		for _, inst := range list.Entries {
			if inst.Spec.WorkflowId != parentWorkflow.Metadata.Id {
				t.Errorf("Expected workflow_id '%s', got '%s'", parentWorkflow.Metadata.Id, inst.Spec.WorkflowId)
			}
		}
	})

	t.Run("get by workflow with no instances", func(t *testing.T) {
		// Create a workflow with no instances
		emptyWorkflow := createTestWorkflow(t, store, "wfl-empty-test", "empty-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: emptyWorkflow.Metadata.Id,
		}
		list, err := controller.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err != nil {
			t.Fatalf("GetByWorkflow failed: %v", err)
		}

		// Verify we got an empty list
		if len(list.Entries) != 0 {
			t.Errorf("Expected 0 instances, got %d", len(list.Entries))
		}
	})

	t.Run("get by workflow with empty workflow_id", func(t *testing.T) {
		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: "",
		}
		_, err := controller.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err == nil {
			t.Error("Expected error when workflow_id is empty")
		}
	})
}
