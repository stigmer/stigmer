package workflowexecution

import (
	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// normalizeWorkflowRefStep guarantees that spec.workflow_id is populated on every
// workflow execution by resolving it from the execution's workflow instance.
//
// A WorkflowExecution may be created with only spec.workflow_instance_id — for
// example, when a run is triggered against a specific, non-default instance.
// Without this step spec.workflow_id stays empty, which detaches the execution
// from its parent Workflow in every workflow-scoped query (ListByWorkflow and
// GetExecutionSummary both match on spec.workflow_id or spec.workflow_instance_id).
// A WorkflowInstance's parent Workflow is immutable, so denormalizing workflow_id
// onto the execution cannot drift.
//
// Pipeline position: after CreateDefaultInstanceIfNeeded (which guarantees
// spec.workflow_instance_id is set) and before PinWorkflowVersion.
//
// Resolution is best-effort: when the instance cannot be loaded or carries no
// workflow_id, the step logs a warning and continues without mutating the spec,
// preserving the prior creation behavior rather than failing the request.
type normalizeWorkflowRefStep struct {
	store store.Store
}

func newNormalizeWorkflowRefStep(s store.Store) *normalizeWorkflowRefStep {
	return &normalizeWorkflowRefStep{store: s}
}

func (s *normalizeWorkflowRefStep) Name() string {
	return "NormalizeWorkflowRef"
}

func (s *normalizeWorkflowRefStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()

	if execution.GetSpec().GetWorkflowId() != "" {
		return nil
	}

	instanceID := execution.GetSpec().GetWorkflowInstanceId()
	if instanceID == "" {
		log.Warn().
			Str("execution_id", executionID).
			Msg("Cannot resolve spec.workflow_id: workflow_instance_id is empty")
		return nil
	}

	var instance workflowinstancev1.WorkflowInstance
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instanceID, &instance); err != nil {
		log.Warn().
			Err(err).
			Str("execution_id", executionID).
			Str("workflow_instance_id", instanceID).
			Msg("Cannot resolve spec.workflow_id: failed to load workflow instance")
		return nil
	}

	workflowID := instance.GetSpec().GetWorkflowId()
	if workflowID == "" {
		log.Warn().
			Str("execution_id", executionID).
			Str("workflow_instance_id", instanceID).
			Msg("Cannot resolve spec.workflow_id: instance has no workflow_id")
		return nil
	}

	if execution.Spec == nil {
		execution.Spec = &workflowexecutionv1.WorkflowExecutionSpec{}
	}
	execution.Spec.WorkflowId = workflowID
	ctx.SetNewState(execution)

	log.Debug().
		Str("execution_id", executionID).
		Str("workflow_instance_id", instanceID).
		Str("workflow_id", workflowID).
		Msg("Resolved spec.workflow_id from instance")

	return nil
}
