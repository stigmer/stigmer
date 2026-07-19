package workflowexecution

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	wftemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	wfactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
)

const humanInputSignalPrefix = "human_input_"

// SubmitWorkflowTaskApproval submits a human reviewer's decision for a
// workflow-level human_input task.
//
// Constructs a Temporal signal matching the TS runner's expected
// HumanInputResult shape, wraps it in a relaySignal envelope, and
// delivers it via SignalWithStart to the Go outer workflow. The outer
// workflow's relaySignal handler forwards the signal to the TS child
// workflow where the human_input task is blocking.
//
// Pipeline Steps:
// 1. ValidateTaskApprovalInput - Validate required fields
// 2. LoadExecutionForApproval - Load execution from database
// 3. ValidateApprovalSignalable - Ensure execution is in a signalable phase
// 4. ValidateHumanInputTask - Ensure task exists and is a human_input task
// 5. SendTaskApprovalSignal - Build and send the relaySignal-wrapped signal
//
// @since T13c (Workflow HITL Approval UI)
func (c *WorkflowExecutionController) SubmitWorkflowTaskApproval(
	ctx context.Context,
	input *workflowexecutionv1.SubmitWorkflowTaskApprovalInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetExecutionId()).
		Str("task_name", input.GetTaskName()).
		Str("outcome", input.GetOutcome()).
		Msg("SubmitWorkflowTaskApproval request")

	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildSubmitWorkflowTaskApprovalPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetExecutionId()).
			Str("task_name", input.GetTaskName()).
			Err(err).
			Msg("SubmitWorkflowTaskApproval failed")
		return nil, err
	}

	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after pipeline")
	}

	log.Info().
		Str("execution_id", input.GetExecutionId()).
		Str("task_name", input.GetTaskName()).
		Str("outcome", input.GetOutcome()).
		Msg("SubmitWorkflowTaskApproval completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

func (c *WorkflowExecutionController) buildSubmitWorkflowTaskApprovalPipeline() *pipeline.Pipeline[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]("workflowexecution-submit-task-approval").
		AddStep(&ValidateTaskApprovalInputStep{}).
		AddStep(&LoadExecutionForApprovalStep{store: c.store}).
		AddStep(&ValidateApprovalSignalableStep{}).
		AddStep(&ValidateHumanInputTaskStep{}).
		AddStep(&SendTaskApprovalSignalStep{
			workflowCreator: c.workflowCreator,
			temporalConfig:  c.temporalConfig,
		}).
		Build()
}

// =============================================================================
// Step 1: Validate Input
// =============================================================================

type ValidateTaskApprovalInputStep struct{}

func (s *ValidateTaskApprovalInputStep) Name() string {
	return "ValidateTaskApprovalInput"
}

func (s *ValidateTaskApprovalInputStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]) error {
	input := ctx.Input()

	if input.GetExecutionId() == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}
	if input.GetTaskName() == "" {
		return grpclib.InvalidArgumentError("task_name is required")
	}
	if input.GetOutcome() == "" {
		return grpclib.InvalidArgumentError("outcome is required")
	}

	return nil
}

// =============================================================================
// Step 2: Load Execution
// =============================================================================

type LoadExecutionForApprovalStep struct {
	store store.Store
}

func (s *LoadExecutionForApprovalStep) Name() string {
	return "LoadExecutionForApproval"
}

func (s *LoadExecutionForApprovalStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]) error {
	input := ctx.Input()
	executionID := input.GetExecutionId()

	existing := &workflowexecutionv1.WorkflowExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, existing); err != nil {
		return grpclib.NotFoundError("WorkflowExecution", executionID)
	}

	ctx.Set(LoadedExecutionKey, existing)
	return nil
}

// =============================================================================
// Step 3: Validate Signalable Phase
// =============================================================================

type ValidateApprovalSignalableStep struct{}

func (s *ValidateApprovalSignalableStep) Name() string {
	return "ValidateApprovalSignalable"
}

func (s *ValidateApprovalSignalableStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]) error {
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return nil
	default:
		return grpclib.FailedPreconditionError(
			"cannot submit task approval: execution is in %s phase", phase.String(),
		)
	}
}

// =============================================================================
// Step 4: Validate Human Input Task
// =============================================================================

type ValidateHumanInputTaskStep struct{}

func (s *ValidateHumanInputTaskStep) Name() string {
	return "ValidateHumanInputTask"
}

func (s *ValidateHumanInputTaskStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	taskName := input.GetTaskName()

	tasks := execution.GetStatus().GetTasks()
	for _, task := range tasks {
		if task.GetTaskName() == taskName {
			if task.GetTaskType() != workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL {
				return grpclib.InvalidArgumentError(
					"task '%s' is not a human_input task (type: %s)", taskName, task.GetTaskType().String(),
				)
			}
			return nil
		}
	}

	return grpclib.InvalidArgumentError(
		"task '%s' not found in execution status", taskName,
	)
}

// =============================================================================
// Step 5: Send Signal via relaySignal Wrapping
// =============================================================================

type SendTaskApprovalSignalStep struct {
	workflowCreator *workflows.InvokeWorkflowExecutionWorkflowCreator
	temporalConfig  *wftemporal.Config
}

func (s *SendTaskApprovalSignalStep) Name() string {
	return "SendTaskApprovalSignal"
}

func (s *SendTaskApprovalSignalStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowTaskApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := input.GetExecutionId()

	// Reviewer attribution: OSS is single-user with no multi-tenant auth
	// context, so there is no authenticated principal to attribute the
	// decision to. An explicit client-supplied reviewer is honored (the CLI
	// may pass one); otherwise the reviewer stays empty — "Empty when not
	// attributed", matching the agent-execution ledger's decided_by contract.
	// The Cloud edition attributes server-side from the authenticated caller
	// and additionally stamps a reviewer_actor display snapshot.
	reviewer := input.GetReviewer()

	humanInputSignalName := humanInputSignalPrefix + input.GetTaskName()

	signalPayload := map[string]interface{}{
		"outcome":      input.GetOutcome(),
		"reviewer":     reviewer,
		"responded_at": time.Now().UTC().Format(time.RFC3339),
	}

	if input.GetFormData() != nil {
		signalPayload["form_data"] = input.GetFormData().AsMap()
	}

	if input.GetComment() != "" {
		signalPayload["comment"] = input.GetComment()
	}

	relayPayload := workflows.RelaySignalPayload{
		SignalName: humanInputSignalName,
		Payload:    signalPayload,
	}

	workflowInput := &wfactivities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        executionID,
		WorkflowInstanceID: execution.GetSpec().GetWorkflowInstanceId(),
		WorkflowID:         execution.GetStatus().GetTemporalWorkflowId(),
		OrgID:              execution.GetMetadata().GetOrg(),
	}

	if s.workflowCreator == nil {
		return grpclib.UnavailableError(
			"workflow creator not configured for task '%s'", input.GetTaskName(),
		)
	}

	dispatch := wftemporal.ResolveWorkflowTaskQueue(
		executionID,
		execution.GetSpec().GetExecutionTarget(),
		s.temporalConfig,
	)

	err := s.workflowCreator.SignalWithStart(
		ctx.Context(),
		workflowInput,
		"relaySignal",
		relayPayload,
		dispatch.TaskQueue,
	)
	if err != nil {
		return grpclib.UnavailableError(
			"failed to send approval signal for task '%s': %v", input.GetTaskName(), err,
		)
	}

	log.Info().
		Str("execution_id", executionID).
		Str("task_name", input.GetTaskName()).
		Str("outcome", input.GetOutcome()).
		Str("reviewer", reviewer).
		Str("signal_name", humanInputSignalName).
		Msg("AUDIT: Workflow task approval submitted via relaySignal")

	return nil
}
