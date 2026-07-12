package workflowexecution

import (
	"context"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
func setupTestController(t *testing.T) (*WorkflowExecutionController, store.Store) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// For simple tests, pass nil for workflow instance client
	// This client is only needed for tests that auto-create default instances
	controller := NewWorkflowExecutionController(store, nil)

	return controller, store
}

// createTestWorkflowInstance creates a workflow instance in the store for testing
func createTestWorkflowInstance(t *testing.T, store store.Store, workflowID string) *workflowinstancev1.WorkflowInstance {
	instance := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "wfi-test-instance",
			Name: "Test Workflow Instance",
			Slug: "test-workflow-instance",
			Org:  "test-org",
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
func createTestWorkflow(t *testing.T, store store.Store) *workflowv1.Workflow {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "wf-test-workflow",
			Name: "Test Workflow",
			Slug: "test-workflow",
			Org:  "test-org",
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

// seedTestExecution persists a WorkflowExecution directly into the store, bypassing
// the Create pipeline. Create now requires a connected workflow engine (see
// ensureEngineAvailableStep), so Get/Update/Delete tests seed the execution they
// operate on rather than driving it through Create — keeping those operations
// under test in isolation from engine availability.
func seedTestExecution(t *testing.T, store store.Store, instanceID, id, name string) *workflowexecutionv1.WorkflowExecution {
	execution := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: name,
			Slug: id,
			Org:  "test-org",
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowInstanceId: instanceID,
			TriggerMessage:     "Test trigger message",
		},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		},
	}

	if err := store.SaveResource(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution, id, execution); err != nil {
		t.Fatalf("failed to seed workflow execution: %v", err)
	}

	return execution
}

func TestWorkflowExecutionController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("engine unavailable - rejects with Unavailable and leaves no trace", func(t *testing.T) {
		// The test controller is constructed without a workflow creator, so the
		// engine-availability guard rejects the create before any state is persisted.
		// This is the F7 regression guard: no silent success, no zombie PENDING record.
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)

		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Engine Unavailable Execution",
				Org:  "test-org",
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowInstanceId: instance.Metadata.Id,
				TriggerMessage:     "Test trigger message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if err == nil {
			t.Fatal("Expected Create to fail when the workflow engine is unavailable")
		}
		if code := status.Code(err); code != codes.Unavailable {
			t.Errorf("Expected gRPC code Unavailable, got %v (err: %v)", code, err)
		}

		// Zero trace: no execution record should have been persisted.
		executions, listErr := store.ListResources(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution)
		if listErr != nil {
			t.Fatalf("failed to list executions: %v", listErr)
		}
		if len(executions) != 0 {
			t.Errorf("Expected zero persisted executions after a rejected create, got %d", len(executions))
		}
	})

	// NOTE: The happy path (a create that actually starts a workflow and returns
	// PENDING) requires a connected Temporal engine and is asserted by the
	// conformance suite (local-go-execution target), consistent with the
	// AgentExecution controller test's stance at the unit layer.

	t.Run("validation error - missing workflow_id and workflow_instance_id", func(t *testing.T) {
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Invalid Execution",
				Org:  "test-org",
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

	t.Run("engine unavailable takes precedence over workflow lookup", func(t *testing.T) {
		// The engine guard sits before the workflow-existence lookup, so during an
		// engine outage an otherwise-processable request fails fast with Unavailable
		// rather than doing lookups (and without persisting anything). When the engine
		// is up, a non-existent workflow_id surfaces NotFound - asserted at the
		// integration layer, which this unit test cannot reach (guard fires first).
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Execution With Invalid Workflow",
				Org:  "test-org",
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowId:     "non-existent-workflow",
				TriggerMessage: "Test message",
			},
		}

		_, err := controller.Create(contextWithWorkflowExecutionKind(), execution)
		if code := status.Code(err); code != codes.Unavailable {
			t.Errorf("Expected gRPC code Unavailable, got %v (err: %v)", code, err)
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
		// Create test workflow and instance, then seed the execution directly
		// (Create requires a connected engine; this test exercises Get in isolation).
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)
		created := seedTestExecution(t, store, instance.Metadata.Id, "wex-get-test", "Get Test Execution")

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
		// Create test workflow and instance, then seed the execution directly
		// (Create requires a connected engine; this test exercises Update in isolation).
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)
		created := seedTestExecution(t, store, instance.Metadata.Id, "wex-update-test", "Update Test Execution")

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
				Id:   "non-existent-id",
				Name: "Non-existent Execution",
				Org:  "test-org",
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
		// Create test workflow and instance, then seed the execution directly
		// (Create requires a connected engine; this test exercises Delete in isolation).
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)
		created := seedTestExecution(t, store, instance.Metadata.Id, "wex-delete-test", "Delete Test Execution")

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
		// Create test workflow and instance, then seed the execution directly
		// (Create requires a connected engine; this test exercises Delete in isolation).
		workflow := createTestWorkflow(t, store)
		instance := createTestWorkflowInstance(t, store, workflow.Metadata.Id)
		created := seedTestExecution(t, store, instance.Metadata.Id, "wex-delete-verify", "Delete Verify Execution")
		created.Spec.TriggerMessage = "Verify deletion data"
		if err := store.SaveResource(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution, created.Metadata.Id, created); err != nil {
			t.Fatalf("failed to seed execution: %v", err)
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
