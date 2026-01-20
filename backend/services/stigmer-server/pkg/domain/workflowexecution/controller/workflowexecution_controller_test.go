package workflowexecution

import (
	"context"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithWorkflowExecutionKind creates a context with the workflow execution resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithWorkflowExecutionKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow_execution)
}

// contextWithWorkflowInstanceKind creates a context with the workflow instance resource kind injected
func contextWithWorkflowInstanceKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow_instance)
}

// contextWithWorkflowKind creates a context with the workflow resource kind injected
func contextWithWorkflowKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_workflow)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*WorkflowExecutionController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// For simple tests, pass nil for workflow instance client
	// This client is only needed for tests that auto-create default instances
	controller := NewWorkflowExecutionController(store, nil)

	return controller, store
}

// createTestWorkflowInstance creates a workflow instance in the store for testing
func createTestWorkflowInstance(t *testing.T, store *badger.Store, workflowID string) *workflowinstancev1.WorkflowInstance {
	instance := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         "wfi-test-instance",
			Name:       "Test Workflow Instance",
			Slug:       "test-workflow-instance",
			OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflowID,
			Description: "Test workflow instance",
		},
	}

	err := store.SaveResource(contextWithWorkflowInstanceKind(), apiresourcekind.ApiResourceKind_workflow_instance, instance.Metadata.Id, instance)
	if err != nil {
		t.Fatalf("failed to create test workflow instance: %v", err)
	}

	return instance
}

// createTestWorkflow creates a workflow in the store for testing
func createTestWorkflow(t *testing.T, store *badger.Store) *workflowv1.Workflow {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         "wf-test-workflow",
			Name:       "Test Workflow",
			Slug:       "test-workflow",
			OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow",
		},
	}

	err := store.SaveResource(contextWithWorkflowKind(), apiresourcekind.ApiResourceKind_workflow, workflow.Metadata.Id, workflow)
	if err != nil {
		t.Fatalf("failed to create test workflow: %v", err)
	}

	return workflow
}

func TestWorkflowExecutionController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with workflow_instance_id", func(t *testing.T) {
		// Create test workflow and instance
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Test trigger message",
			},
		}

		created, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
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

		if created.Metadata.Slug != "test-execution" {
			t.Errorf("Expected slug 'test-execution', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "WorkflowExecution" {
			t.Errorf("Expected kind 'WorkflowExecution', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify workflow_instance_id is preserved
		if created.Spec.WorkflowInstanceId != instance.Metadata.Id {
			t.Errorf("Expected workflow_instance_id '%s', got '%s'", instance.Metadata.Id, created.Spec.WorkflowInstanceId)
		}

		// Verify trigger_message is preserved
		if created.Spec.TriggerMessage != "Test trigger message" {
			t.Errorf("Expected trigger_message 'Test trigger message', got '%s'", created.Spec.TriggerMessage)
		}

		// Verify initial phase is PENDING
		if created.Status == nil {
			t.Error("Expected status to be set")
		} else if created.Status.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING {
			t.Errorf("Expected phase EXECUTION_PENDING, got %v", created.Status.Phase)
		}
	})

	// NOTE: Test for workflow_id auto-instance creation is skipped because it requires
	// a properly configured in-process gRPC connection for the workflow instance client.
	// This test would need to set up the full gRPC server infrastructure.
	// The auto-instance creation logic is tested indirectly through integration tests.
	
	// t.Run("successful creation with workflow_id", func(t *testing.T) {
	// 	// This test requires a full gRPC setup with workflow instance service
	// })

	t.Run("validation error - missing workflow_id and workflow_instance_id", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				TriggerMessage: "Test message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error when neither workflow_id nor workflow_instance_id is provided")
		}
	})

	t.Run("validation error - non-existent workflow_id", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Execution With Invalid Workflow",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowId:     "non-existent-workflow",
				TriggerMessage: "Test message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error when workflow_id does not exist")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: "wfi-test",
				TriggerMessage:     "Test message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: "wfi-test",
				TriggerMessage:     "Test message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})
}

func TestWorkflowExecutionController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create test workflow and instance
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		// Create execution first
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Test trigger message",
			},
		}

		created, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the execution
		retrieved, err := controller.Get(contextWithWorkflowExecutionKind(), &workflowexecutionv1.WorkflowExecutionId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.TriggerMessage != "Test trigger message" {
			t.Errorf("Expected trigger_message 'Test trigger message', got '%s'", retrieved.Spec.TriggerMessage)
		}

		if retrieved.Spec.WorkflowInstanceId != instance.Metadata.Id {
			t.Errorf("Expected workflow_instance_id '%s', got '%s'", instance.Metadata.Id, retrieved.Spec.WorkflowInstanceId)
		}
	})

	t.Run("get non-existent execution", func(t *testing.T) {
		_, err := controller.Get(contextWithWorkflowExecutionKind(), &workflowexecutionv1.WorkflowExecutionId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent execution")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithWorkflowExecutionKind(), &workflowexecutionv1.WorkflowExecutionId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestWorkflowExecutionController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update", func(t *testing.T) {
		// Create test workflow and instance
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		// Create execution first
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Update Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Original trigger message",
			},
		}

		created, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the execution
		created.Spec.TriggerMessage = "Updated trigger message"
		updated, err := controller.Update(contextWithWorkflowExecutionKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.TriggerMessage != "Updated trigger message" {
			t.Errorf("Expected trigger_message 'Updated trigger message', got '%s'", updated.Spec.TriggerMessage)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("update non-existent execution", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: "wfi-test",
				TriggerMessage:     "Test message",
			},
		}

		_, err := controller.Update(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Error("Expected error for updating non-existent execution")
		}
	})
}

func TestWorkflowExecutionController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create test workflow and instance
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		// Create execution first
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Test trigger message",
			},
		}

		created, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the execution
		deleted, err := controller.Delete(contextWithWorkflowExecutionKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted execution ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify execution is deleted
		_, err = controller.Get(contextWithWorkflowExecutionKind(), &workflowexecutionv1.WorkflowExecutionId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted execution")
		}
	})

	t.Run("delete non-existent execution", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowExecutionKind(), &apiresource.ApiResourceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent execution")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithWorkflowExecutionKind(), &apiresource.ApiResourceId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted execution returns correct data", func(t *testing.T) {
		// Create test workflow and instance
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		// Create execution with specific data
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Execution",
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Verify deletion data",
			},
		}

		created, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithWorkflowExecutionKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.WorkflowInstanceId != instance.Metadata.Id {
			t.Errorf("Expected workflow_instance_id '%s', got '%s'", instance.Metadata.Id, deleted.Spec.WorkflowInstanceId)
		}

		if deleted.Spec.TriggerMessage != "Verify deletion data" {
			t.Errorf("Expected trigger_message 'Verify deletion data', got '%s'", deleted.Spec.TriggerMessage)
		}

		if deleted.Metadata.Name != "Delete Verify Execution" {
			t.Errorf("Expected name 'Delete Verify Execution', got '%s'", deleted.Metadata.Name)
		}
	})
}
