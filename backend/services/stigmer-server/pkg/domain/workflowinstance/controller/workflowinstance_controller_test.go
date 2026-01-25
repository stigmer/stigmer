package workflowinstance

import (
	"context"
	"net"
	"testing"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	workflowcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/structpb"
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

// setupInProcessServers creates both gRPC servers with proper cross-dependencies
// This handles the circular dependency between Workflow and WorkflowInstance services:
// - Workflow needs WorkflowInstance client (to create default instances)
// - WorkflowInstance needs Workflow client (to validate parent workflows)
func setupInProcessServers(t *testing.T, store store.Store) (*workflow.Client, *workflowinstance.Client, func()) {
	// STEP 1: Create listeners for both servers
	workflowListener := bufconn.Listen(1024 * 1024)
	workflowInstanceListener := bufconn.Listen(1024 * 1024)

	// STEP 2: Create client connections BEFORE starting servers
	// This allows us to create clients before controllers need them
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

	// STEP 3: Create clients from connections
	workflowClient := workflow.NewClient(workflowConn)
	workflowInstanceClient := workflowinstance.NewClient(workflowInstanceConn)

	// STEP 4: Create controllers with proper cross-dependencies
	workflowController := workflowcontroller.NewWorkflowController(store, workflowInstanceClient, nil)
	workflowInstanceController := NewWorkflowInstanceController(store, workflowClient)

	// STEP 5: Create and start gRPC servers with controllers
	workflowServer := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx = contextWithWorkflowKind()
			return handler(ctx, req)
		}),
	)
	workflowv1.RegisterWorkflowCommandControllerServer(workflowServer, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(workflowServer, workflowController)

	workflowInstanceServer := grpc.NewServer(
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx = contextWithWorkflowInstanceKind()
			return handler(ctx, req)
		}),
	)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(workflowInstanceServer, workflowInstanceController)
	workflowinstancev1.RegisterWorkflowInstanceQueryControllerServer(workflowInstanceServer, workflowInstanceController)

	// STEP 6: Start servers in background
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

	// STEP 7: Return clients and cleanup function
	cleanup := func() {
		workflowConn.Close()
		workflowInstanceConn.Close()
		workflowServer.Stop()
		workflowInstanceServer.Stop()
		workflowListener.Close()
		workflowInstanceListener.Close()
	}

	return workflowClient, workflowInstanceClient, cleanup
}

// testControllers holds all controllers needed for testing
type testControllers struct {
	workflowInstance *WorkflowInstanceController
	workflow         *workflowcontroller.WorkflowController
	store            store.Store
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) *testControllers {
	// Create temporary BadgerDB store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Setup both gRPC servers with proper cross-dependencies
	// This handles the circular dependency between Workflow and WorkflowInstance
	workflowClient, workflowInstanceClient, cleanup := setupInProcessServers(t, store)
	t.Cleanup(cleanup)

	// Create controllers for testing
	// Note: The ACTUAL controllers used by the gRPC servers are created inside setupInProcessServers
	// These controllers are just for direct method calls in tests
	workflowInstanceController := NewWorkflowInstanceController(store, workflowClient)
	workflowController := workflowcontroller.NewWorkflowController(store, workflowInstanceClient, nil)

	return &testControllers{
		workflowInstance: workflowInstanceController,
		workflow:         workflowController,
		store:            store,
	}
}

// createTestWorkflow creates a workflow in the store for testing
// Workflows require: platform/organization scope, document, and at least one task
func createTestWorkflow(t *testing.T, controllers *testControllers, name string, scope apiresource.ApiResourceOwnerScope, org string) *workflowv1.Workflow {
	// If scope is unspecified, default to platform (required for workflows)
	if scope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
		scope = apiresource.ApiResourceOwnerScope_platform
	}

	// Create minimal task config for a SET task
	taskConfig, err := structpb.NewStruct(map[string]interface{}{
		"set": map[string]interface{}{
			"test_var": "test_value",
		},
	})
	if err != nil {
		t.Fatalf("failed to create task config: %v", err)
	}

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: scope,
			Org:        org,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow description",
			Document: &workflowv1.WorkflowDocument{
				Dsl:         "1.0.0",
				Namespace:   "test",
				Name:        name,
				Version:     "1.0.0",
				Description: "Test document",
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
		parentWorkflow := createTestWorkflow(t, controllers, "org-workflow", apiresource.ApiResourceOwnerScope_organization, "org-123")

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
		parentWorkflow := createTestWorkflow(t, controllers, "org-workflow-2", apiresource.ApiResourceOwnerScope_organization, "org-456")

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
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "delete-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

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
		deleted, err := controllers.workflowInstance.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted instance ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify instance is deleted
		_, err = controllers.workflowInstance.Get(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted instance")
		}
	})

	t.Run("delete non-existent instance", func(t *testing.T) {
		_, err := controllers.workflowInstance.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent instance")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controllers.workflowInstance.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted instance returns correct data", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "delete-verify-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

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
		deleted, err := controllers.workflowInstance.Delete(contextWithWorkflowInstanceKind(), &workflowinstancev1.WorkflowInstanceId{Value: created.Metadata.Id})
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
	controllers := setupTestController(t)
	defer controllers.store.Close()

	t.Run("successful get by workflow with multiple instances", func(t *testing.T) {
		// Create parent workflow first
		parentWorkflow := createTestWorkflow(t, controllers, "list-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		// Create another workflow to test filtering
		otherWorkflow := createTestWorkflow(t, controllers, "other-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

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
		_, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), otherInstance)
		if err != nil {
			t.Fatalf("Create failed for other instance: %v", err)
		}

		// Get instances by workflow
		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: parentWorkflow.Metadata.Id,
		}
		list, err := controllers.workflowInstance.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err != nil {
			t.Fatalf("GetByWorkflow failed: %v", err)
		}

		// Verify we got exactly 4 instances (3 explicit + 1 default instance auto-created with workflow)
		if len(list.Entries) != 4 {
			t.Errorf("Expected 4 instances (3 explicit + 1 default), got %d", len(list.Entries))
		}

		// Verify all instances belong to the parent workflow
		for _, inst := range list.Entries {
			if inst.Spec.WorkflowId != parentWorkflow.Metadata.Id {
				t.Errorf("Expected workflow_id '%s', got '%s'", parentWorkflow.Metadata.Id, inst.Spec.WorkflowId)
			}
		}
	})

	t.Run("get by workflow with no instances", func(t *testing.T) {
		// Create a workflow with no explicit instances (but it will have 1 default instance)
		emptyWorkflow := createTestWorkflow(t, controllers, "empty-test-workflow", apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified, "")

		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: emptyWorkflow.Metadata.Id,
		}
		list, err := controllers.workflowInstance.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err != nil {
			t.Fatalf("GetByWorkflow failed: %v", err)
		}

		// Verify we got 1 instance (the default instance auto-created with the workflow)
		if len(list.Entries) != 1 {
			t.Errorf("Expected 1 instance (default), got %d", len(list.Entries))
		}
	})

	t.Run("get by workflow with empty workflow_id", func(t *testing.T) {
		request := &workflowinstancev1.GetWorkflowInstancesByWorkflowRequest{
			WorkflowId: "",
		}
		_, err := controllers.workflowInstance.GetByWorkflow(contextWithWorkflowInstanceKind(), request)
		if err == nil {
			t.Error("Expected error when workflow_id is empty")
		}
	})
}
