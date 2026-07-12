package workflowexecution

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Context keys for inter-step communication
const (
	ChildExecutionIDKey = "childAgentExecutionId"
)

// SubmitApproval submits an approval decision for a child agent's tool call (HITL Phase 5.3).
//
// This RPC forwards the approval decision to the child AgentExecution that is
// waiting for approval. The child is identified by the child_agent_execution_id
// in the matched entry of status.pending_approvals.
//
// ## Behavior
//
// When a workflow invokes an agent that requires tool approval, the approval
// request surfaces at the workflow level via status.pending_approvals. Users can
// submit their decision through this RPC, which forwards it to the child agent.
//
// ## Preconditions
//
//   - status.pending_approvals must have at least one entry
//   - tool_call_id must match an entry in status.pending_approvals
//   - The matched entry's child_agent_execution_id must not be empty
//
// ## State Transitions
//
// After successful approval:
//   - Approval is forwarded to child AgentExecution
//   - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
//   - WorkflowExecution.status.pending_approval is eventually cleared
//
// ## Approval Actions
//
//   - APPROVE: Tool executes with the provided arguments
//   - SKIP: Tool execution is skipped, agent continues with skip message
//   - REJECT: Tool is denied and the child agent continues (the objection is fed
//     back to the model); REJECT denies a single tool, it does not fail the child
//     agent or the workflow task
//
// ## Error Cases
//
//   - NOT_FOUND: Workflow execution doesn't exist
//   - FAILED_PRECONDITION: No pending approval, or tool_call_id mismatch
//   - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
//   - UNAVAILABLE: Failed to forward to child agent (transient error)
func (c *WorkflowExecutionController) SubmitApproval(ctx context.Context, input *workflowexecutionv1.SubmitWorkflowApprovalInput) (*workflowexecutionv1.WorkflowExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildSubmitApprovalPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution from context
	execution := reqCtx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)
	return execution, nil
}

// buildSubmitApprovalPipeline constructs the pipeline for submit-approval operations.
//
// Pipeline steps:
//  1. ValidateProto       - Validate input constraints (tool_call_id, action required)
//  2. LoadExisting        - Load WorkflowExecution from store
//  3. ValidateApproval    - Validate pending_approval, tool_call_id, extract child ID
//  4. ForwardToChild      - Forward approval to child AgentExecution
//  5. BuildResponse       - Return current execution state (with audit log)
func (c *WorkflowExecutionController) buildSubmitApprovalPipeline() *pipeline.Pipeline[*workflowexecutionv1.SubmitWorkflowApprovalInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.SubmitWorkflowApprovalInput]("workflow-execution-submit-approval").
		AddStep(steps.NewValidateProtoStep[*workflowexecutionv1.SubmitWorkflowApprovalInput]()). // 1. Validate input
		AddStep(newLoadExistingForWfApprovalStep(c.store)).                                      // 2. Load execution
		AddStep(newValidateWfApprovalStep()).                                                    // 3. Validate approval
		AddStep(newForwardToChildStep(c.agentExecutionClient)).                                  // 4. Forward to child
		AddStep(newBuildWfApprovalResponseStep()).                                               // 5. Build response
		Build()
}

// =============================================================================
// Pipeline Steps
// =============================================================================

// loadExistingForWfApprovalStep loads a WorkflowExecution by ID for approval processing.
type loadExistingForWfApprovalStep struct {
	store store.Store
}

func newLoadExistingForWfApprovalStep(s store.Store) *loadExistingForWfApprovalStep {
	return &loadExistingForWfApprovalStep{store: s}
}

func (s *loadExistingForWfApprovalStep) Name() string {
	return "LoadExisting"
}

func (s *loadExistingForWfApprovalStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowApprovalInput]) error {
	input := ctx.Input()
	executionID := input.GetExecutionId()

	if executionID == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Loading WorkflowExecution for approval")

	execution := &workflowexecutionv1.WorkflowExecution{}
	err := s.store.GetResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_workflow_execution,
		executionID,
		execution,
	)

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("execution_id", executionID).
				Msg("WorkflowExecution not found")
			return grpclib.NotFoundError("workflow_execution", executionID)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to load WorkflowExecution")
		return grpclib.InternalError(err, "failed to load workflow execution")
	}

	// Store loaded execution in context
	ctx.Set(steps.TargetResourceKey, execution)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.GetStatus().GetPhase().String()).
		Msg("Loaded WorkflowExecution for approval")

	return nil
}

// validateWfApprovalStep validates the approval preconditions for workflow execution.
type validateWfApprovalStep struct{}

func newValidateWfApprovalStep() *validateWfApprovalStep {
	return &validateWfApprovalStep{}
}

func (s *validateWfApprovalStep) Name() string {
	return "ValidateApproval"
}

func (s *validateWfApprovalStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)

	executionID := execution.GetMetadata().GetId()
	requestedToolCallId := input.GetToolCallId()
	pendingApprovals := execution.GetStatus().GetPendingApprovals()

	// Validate pending_approvals has entries
	if len(pendingApprovals) == 0 {
		log.Debug().
			Str("execution_id", executionID).
			Msg("No pending approvals on workflow execution")
		return grpclib.FailedPreconditionError(
			"workflow execution %s has no pending approvals",
			executionID,
		)
	}

	// Find the matching entry by tool_call_id
	var matchedApproval *workflowexecutionv1.WorkflowPendingApproval
	for _, pa := range pendingApprovals {
		if pa.GetApproval().GetToolCallId() == requestedToolCallId {
			matchedApproval = pa
			break
		}
	}

	if matchedApproval == nil {
		validIDs := make([]string, 0, len(pendingApprovals))
		for _, pa := range pendingApprovals {
			validIDs = append(validIDs, pa.GetApproval().GetToolCallId())
		}
		log.Debug().
			Str("execution_id", executionID).
			Str("requested_tool_call_id", requestedToolCallId).
			Strs("valid_tool_call_ids", validIDs).
			Msg("Tool call ID not found in pending_approvals")
		return grpclib.InvalidArgumentError(
			"tool_call_id %s not found in pending_approvals for workflow execution %s",
			requestedToolCallId, executionID,
		)
	}

	// Validate child_agent_execution_id exists on the matched entry
	childExecutionId := matchedApproval.GetChildAgentExecutionId()
	if childExecutionId == "" {
		log.Debug().
			Str("execution_id", executionID).
			Msg("No child_agent_execution_id in matched pending approval")
		return grpclib.FailedPreconditionError(
			"workflow execution %s has no child agent execution ID for tool_call %s - approval must be submitted directly to the agent",
			executionID, requestedToolCallId,
		)
	}

	// Store child execution ID for next step
	ctx.Set(ChildExecutionIDKey, childExecutionId)

	log.Debug().
		Str("execution_id", executionID).
		Str("tool_call_id", requestedToolCallId).
		Str("child_execution_id", childExecutionId).
		Str("action", input.GetAction().String()).
		Msg("Workflow approval validation passed")

	return nil
}

// AgentExecutionApprovalClient defines the interface for forwarding approvals.
// This allows dependency injection for testing and decoupling.
type AgentExecutionApprovalClient interface {
	SubmitApproval(ctx context.Context, input *agentexecutionv1.SubmitApprovalInput) (*agentexecutionv1.AgentExecution, error)
}

// forwardToChildStep forwards the approval to the child AgentExecution.
type forwardToChildStep struct {
	client AgentExecutionApprovalClient
}

func newForwardToChildStep(client AgentExecutionApprovalClient) *forwardToChildStep {
	return &forwardToChildStep{client: client}
}

func (s *forwardToChildStep) Name() string {
	return "ForwardToChild"
}

func (s *forwardToChildStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowApprovalInput]) error {
	// Skip if no client available (graceful degradation)
	if s.client == nil {
		log.Warn().Msg("AgentExecution client not available - skipping approval forwarding")
		return nil
	}

	input := ctx.Input()
	childExecutionId := ctx.Get(ChildExecutionIDKey).(string)

	log.Info().
		Str("child_execution_id", childExecutionId).
		Str("tool_call_id", input.GetToolCallId()).
		Str("action", input.GetAction().String()).
		Msg("Forwarding approval to child AgentExecution")

	// Build approval input for child
	childInput := &agentexecutionv1.SubmitApprovalInput{
		AgentExecutionId: childExecutionId,
		ToolCallId:       input.GetToolCallId(),
		Action:           input.GetAction(),
		Comment:          input.GetComment(),
	}

	// Forward to child via client
	_, err := s.client.SubmitApproval(ctx.Context(), childInput)
	if err != nil {
		log.Error().
			Err(err).
			Str("child_execution_id", childExecutionId).
			Msg("Failed to forward approval to child AgentExecution")
		return grpclib.UnavailableError("failed to forward approval to child agent: %v", err)
	}

	log.Info().
		Str("child_execution_id", childExecutionId).
		Msg("Successfully forwarded approval to child AgentExecution")

	return nil
}

// buildWfApprovalResponseStep builds the response with audit logging.
type buildWfApprovalResponseStep struct{}

func newBuildWfApprovalResponseStep() *buildWfApprovalResponseStep {
	return &buildWfApprovalResponseStep{}
}

func (s *buildWfApprovalResponseStep) Name() string {
	return "BuildResponse"
}

func (s *buildWfApprovalResponseStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)

	executionID := execution.GetMetadata().GetId()
	org := execution.GetMetadata().GetOrg()
	toolCallId := input.GetToolCallId()
	action := input.GetAction()
	comment := input.GetComment()
	childExecutionId := ctx.Get(ChildExecutionIDKey).(string)

	// Find tool name from the matched pending approval
	toolName := "unknown"
	for _, pa := range execution.GetStatus().GetPendingApprovals() {
		if pa.GetApproval().GetToolCallId() == toolCallId {
			toolName = pa.GetApproval().GetToolName()
			break
		}
	}

	// Audit log the approval decision
	log.Info().
		Str("workflow_execution_id", executionID).
		Str("org", org).
		Str("tool_call_id", toolCallId).
		Str("tool_name", toolName).
		Str("action", action.String()).
		Str("comment", comment).
		Str("child_execution_id", childExecutionId).
		Msg("AUDIT: Workflow approval decision submitted and forwarded to child agent")

	return nil
}
