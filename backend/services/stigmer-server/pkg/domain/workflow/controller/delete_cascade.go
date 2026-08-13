package workflow

import (
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Workflow deletion cascades to ALL of the workflow's instances — the
// system-managed default AND user-created ones — before the workflow row
// itself is removed (children before parent, so a mid-failure retry
// converges: the agent/session cascade ordering).
//
// This deliberately goes FURTHER than the agent cascade
// (agent/controller/delete_cascade.go), which spares personal instances as
// "inert dangling references". That rationale holds for the dangling
// REFERENCE (spec.workflow_id is an immutable ID, never reused) but not for
// the dangling SLUG: WorkflowInstance slugs are org-scoped, and the parent
// workflow's detail page is the only instance-management surface — so an
// orphan occupies its slug org-wide forever with no UI left to delete it
// (stigmer/stigmer#592, repro'd live). Instances are configuration OF the
// workflow, meaningless without it; owner ruling: they go with it.
//
// What deliberately SURVIVES a workflow delete, and must never be swept
// into this cascade:
//
//   - WorkflowExecutions — historical record, same posture as sessions
//     (owner ruling on #582). They carry a denormalized spec.workflow_id
//     and remain viewable after the workflow (and now its instances) are
//     gone.
//   - Version/audit rows (resource_audit) — surviving executions render
//     their historical graphs via getWorkflowVersion(workflow_id,
//     version_hash), so deleting version rows would break the execution
//     viewer for exactly the executions the ruling preserves.
//
// Both editions implement this contract; the cloud edition additionally
// cleans up each instance's FGA tuples (no IAM system in OSS).

// cascadeDeleteInstancesStep deletes every instance of the workflow
// (row + search-index entry) before the workflow is deleted.
//
// Instances are matched by spec.workflow_id — a required, validated field
// on every instance — so a single ID sweep covers the default instance
// too; no pointer-or-slug resolution is needed (unlike the agent cascade,
// whose default instance may predate the status pointer).
type cascadeDeleteInstancesStep struct {
	store store.Store
}

func newCascadeDeleteInstancesStep(s store.Store) *cascadeDeleteInstancesStep {
	return &cascadeDeleteInstancesStep{store: s}
}

func (s *cascadeDeleteInstancesStep) Name() string {
	return "CascadeDeleteInstances"
}

func (s *cascadeDeleteInstancesStep) Execute(ctx *pipeline.RequestContext[*workflowv1.WorkflowId]) error {
	workflow, ok := ctx.Get(steps.ExistingResourceKey).(*workflowv1.Workflow)
	if !ok {
		return grpclib.InternalError(nil, "workflow not found in context (LoadExistingForDelete must run first)")
	}
	workflowID := workflow.GetMetadata().GetId()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to list workflow instances for cascade delete")
	}

	deleted := 0
	for _, data := range resources {
		instance := &workflowinstancev1.WorkflowInstance{}
		if err := proto.Unmarshal(data, instance); err != nil {
			continue
		}
		if instance.GetSpec().GetWorkflowId() != workflowID {
			continue
		}
		instanceID := instance.GetMetadata().GetId()
		if err := s.store.DeleteResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instanceID); err != nil {
			return grpclib.InternalError(err, fmt.Sprintf(
				"failed to cascade-delete instance %s of workflow %s", instanceID, workflowID))
		}

		// Best-effort, matching DeleteSearchIndexStep: a stale index entry is
		// a cosmetic search artifact, not a correctness problem.
		if err := s.store.DeleteSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instanceID); err != nil {
			log.Warn().Err(err).
				Str("instance_id", instanceID).
				Msg("CascadeDeleteInstances: failed to remove search index entry (best-effort)")
		}
		deleted++
	}

	if deleted > 0 {
		log.Info().
			Int("count", deleted).
			Str("workflow_id", workflowID).
			Msg("Cascade-deleted instances of workflow")
	}
	return nil
}
