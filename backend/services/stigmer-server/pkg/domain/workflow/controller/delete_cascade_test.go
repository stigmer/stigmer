package workflow

import (
	"context"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"google.golang.org/protobuf/proto"
)

// TestWorkflowController_Delete_Cascade pins the stigmer/stigmer#592
// contract: deleting a workflow removes ALL of its instances — the
// system-managed default AND user-created ones — while other workflows'
// instances and the workflow's executions survive. Unlike the agent
// cascade tests (which hand-save instances against a nil instance
// client), these drive the REAL workflow + workflow-instance controllers
// over in-process gRPC, so default-instance provisioning and the
// org-scoped duplicate check behave exactly as in production.
func TestWorkflowController_Delete_Cascade(t *testing.T) {
	// newCascadeHarness wires a fresh store with both controllers connected;
	// the returned stub creates USER instances through the full create
	// pipeline (slug resolution, parent load, duplicate check).
	newCascadeHarness := func(t *testing.T) (*WorkflowController, workflowinstancev1.WorkflowInstanceCommandControllerClient, store.Store) {
		t.Helper()
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		t.Cleanup(func() { s.Close() })

		_, instanceConn, cleanup := setupInProcessServers(t, s)
		t.Cleanup(cleanup)

		controller := NewWorkflowController(s, workflowinstance.NewClient(instanceConn), nil)
		return controller, workflowinstancev1.NewWorkflowInstanceCommandControllerClient(instanceConn), s
	}

	createWorkflow := func(t *testing.T, c *WorkflowController, name string) *workflowv1.Workflow {
		t.Helper()
		created, err := c.Create(contextWithWorkflowKind(), createValidWorkflow(name, "cascade test workflow"))
		if err != nil {
			t.Fatalf("Create workflow %q failed: %v", name, err)
		}
		if created.GetStatus().GetDefaultInstanceId() == "" {
			t.Fatalf("precondition: workflow %q should have a provisioned default instance", name)
		}
		return created
	}

	createUserInstance := func(t *testing.T, stub workflowinstancev1.WorkflowInstanceCommandControllerClient, name, workflowID string) *workflowinstancev1.WorkflowInstance {
		t.Helper()
		created, err := stub.Create(context.Background(), &workflowinstancev1.WorkflowInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  "test-org",
			},
			Spec: &workflowinstancev1.WorkflowInstanceSpec{WorkflowId: workflowID},
		})
		if err != nil {
			t.Fatalf("Create user instance %q failed: %v", name, err)
		}
		return created
	}

	assertGone := func(t *testing.T, s store.Store, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) {
		t.Helper()
		if err := s.GetResource(context.Background(), kind, id, msg); err == nil {
			t.Errorf("expected %s %s to be cascade-deleted, but it still exists", kind, id)
		}
	}

	assertSurvives := func(t *testing.T, s store.Store, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) {
		t.Helper()
		if err := s.GetResource(context.Background(), kind, id, msg); err != nil {
			t.Errorf("expected %s %s to survive the cascade, but it is gone: %v", kind, id, err)
		}
	}

	t.Run("deletes the default and every user instance; bystanders survive", func(t *testing.T) {
		controller, instanceStub, s := newCascadeHarness(t)

		target := createWorkflow(t, controller, "Cascade Target")
		targetUser := createUserInstance(t, instanceStub, "team-setup", target.Metadata.Id)

		bystander := createWorkflow(t, controller, "Cascade Bystander")
		bystanderUser := createUserInstance(t, instanceStub, "bystander-setup", bystander.Metadata.Id)

		if _, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: target.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_workflow_instance, target.Status.DefaultInstanceId, &workflowinstancev1.WorkflowInstance{})
		assertGone(t, s, apiresourcekind.ApiResourceKind_workflow_instance, targetUser.Metadata.Id, &workflowinstancev1.WorkflowInstance{})

		assertSurvives(t, s, apiresourcekind.ApiResourceKind_workflow, bystander.Metadata.Id, &workflowv1.Workflow{})
		assertSurvives(t, s, apiresourcekind.ApiResourceKind_workflow_instance, bystander.Status.DefaultInstanceId, &workflowinstancev1.WorkflowInstance{})
		assertSurvives(t, s, apiresourcekind.ApiResourceKind_workflow_instance, bystanderUser.Metadata.Id, &workflowinstancev1.WorkflowInstance{})
	})

	t.Run("recreate at the same slug converges after delete", func(t *testing.T) {
		controller, _, _ := newCascadeHarness(t)

		created := createWorkflow(t, controller, "Recreate Workflow")

		if _, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// The DD-010 poison shape this cascade kills: without it, the orphaned
		// "<slug>-default" instance makes the recreate's default provisioning
		// collide (or silently adopt the orphan).
		recreated := createWorkflow(t, controller, "Recreate Workflow")
		if recreated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("expected recreated slug %q, got %q", created.Metadata.Slug, recreated.Metadata.Slug)
		}
		if recreated.Metadata.Id == created.Metadata.Id {
			t.Error("expected a fresh workflow ID on recreate")
		}
	})

	t.Run("freed user-instance slug is reusable org-wide", func(t *testing.T) {
		controller, instanceStub, _ := newCascadeHarness(t)

		// The #582 session's live repro: instance slugs are org-scoped, so an
		// orphan blocked the slug for every LATER workflow's instances.
		first := createWorkflow(t, controller, "First Owner")
		createUserInstance(t, instanceStub, "verify-592", first.Metadata.Id)

		if _, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: first.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		second := createWorkflow(t, controller, "Second Owner")
		reused := createUserInstance(t, instanceStub, "verify-592", second.Metadata.Id)
		if reused.Metadata.Slug != "verify-592" {
			t.Errorf("expected reused slug %q, got %q", "verify-592", reused.Metadata.Slug)
		}
	})

	t.Run("executions survive the cascade", func(t *testing.T) {
		controller, instanceStub, s := newCascadeHarness(t)

		created := createWorkflow(t, controller, "Executed Workflow")
		instance := createUserInstance(t, instanceStub, "executed-setup", created.Metadata.Id)

		// Executions are historical record (the #582 ruling) — they reference
		// the workflow and instance by immutable IDs and must outlive both.
		execution := &workflowexecutionv1.WorkflowExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "WorkflowExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "wfe_cascade_survivor",
				Name: "cascade survivor run",
				Org:  "test-org",
			},
			Spec: &workflowexecutionv1.WorkflowExecutionSpec{
				WorkflowId:         created.Metadata.Id,
				WorkflowInstanceId: instance.Metadata.Id,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_workflow_execution, execution.Metadata.Id, execution); err != nil {
			t.Fatalf("failed to save execution: %v", err)
		}

		if _, err := controller.Delete(contextWithWorkflowKind(), &workflowv1.WorkflowId{Value: created.Metadata.Id}); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		assertGone(t, s, apiresourcekind.ApiResourceKind_workflow_instance, instance.Metadata.Id, &workflowinstancev1.WorkflowInstance{})
		assertSurvives(t, s, apiresourcekind.ApiResourceKind_workflow_execution, "wfe_cascade_survivor", &workflowexecutionv1.WorkflowExecution{})
	})
}
