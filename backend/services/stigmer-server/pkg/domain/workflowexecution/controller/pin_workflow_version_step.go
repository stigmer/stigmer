package workflowexecution

import (
	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// pinWorkflowVersionStep reads the current workflow's version_hash and stores
// it on the execution's status.workflow_version_hash field.
//
// This ensures the execution is permanently tied to the workflow definition
// that was active at creation time, solving two problems:
// 1. The runner executes the correct version even if the workflow is updated
//    between execution creation and runner hydration
// 2. The execution viewer renders the correct graph for historical executions
//
// If the workflow has no version_hash (pre-versioning workflows), the field is
// left empty and the runner falls back to fetching the live workflow.
type pinWorkflowVersionStep struct {
	store store.Store
}

func newPinWorkflowVersionStep(s store.Store) *pinWorkflowVersionStep {
	return &pinWorkflowVersionStep{store: s}
}

func (s *pinWorkflowVersionStep) Name() string {
	return "PinWorkflowVersion"
}

func (s *pinWorkflowVersionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.NewState()

	// Resolve which workflow_id to look up.
	// Priority: spec.workflow_id > resolve from instance
	workflowID := execution.GetSpec().GetWorkflowId()
	if workflowID == "" {
		// If workflow_id is not directly on the spec, check the original input.
		// The createDefaultInstanceIfNeeded step may have populated workflow_instance_id
		// but the workflow_id could be on the original input.
		input := ctx.Input()
		workflowID = input.GetSpec().GetWorkflowId()
	}

	if workflowID == "" {
		log.Debug().Msg("No workflow_id available for version pinning — will resolve at hydration time")
		return nil
	}

	// Load the workflow to read its current version_hash
	var workflow workflowv1.Workflow
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, &workflow); err != nil {
		log.Warn().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to load workflow for version pinning — execution will use live workflow at hydration")
		return nil
	}

	versionHash := workflow.GetStatus().GetVersionHash()
	if versionHash == "" {
		log.Debug().
			Str("workflow_id", workflowID).
			Msg("Workflow has no version_hash (pre-versioning) — skipping pin")
		return nil
	}

	// Pin the version hash on the execution status
	if execution.Status == nil {
		execution.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}
	execution.Status.WorkflowVersionHash = versionHash
	ctx.SetNewState(execution)

	log.Info().
		Str("workflow_id", workflowID).
		Str("version_hash", versionHash[:12]+"...").
		Msg("Pinned workflow version on execution")

	return nil
}
