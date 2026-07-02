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

// AgentExecutionFileDecisionClient forwards a file-review decision to a child
// AgentExecution. It is segregated from AgentExecutionApprovalClient so each
// forwarding handler depends only on the RPC it uses; the in-process
// AgentExecutionController satisfies both.
type AgentExecutionFileDecisionClient interface {
	SubmitFileDecision(ctx context.Context, input *agentexecutionv1.SubmitFileDecisionInput) (*agentexecutionv1.AgentExecution, error)
}

// SubmitFileDecision forwards a file-review keep/discard decision to the child
// AgentExecution whose file-review gate is surfaced on this workflow via
// status.pending_file_reviews. It is the file-review sibling of SubmitApproval.
//
// The child is identified by child_agent_execution_id on the input; the handler
// first validates that the (child, change_set_id) pair is actually surfaced on
// the parent (so a caller can never decide on a gate the workflow has not
// surfaced), then forwards to AgentExecution.SubmitFileDecision. The child's
// completeness/digest gates and caller attribution apply unchanged.
//
// ## Error Cases
//
//   - NOT_FOUND: Workflow execution doesn't exist
//   - FAILED_PRECONDITION: No matching pending file review for (child, change_set)
//   - INVALID_ARGUMENT: Invalid scope/action, or the child handler rejects
//     (e.g. digest mismatch, incomplete diff) — the child's status propagates
//   - UNAVAILABLE: Failed to forward to child agent (transient error)
func (c *WorkflowExecutionController) SubmitFileDecision(ctx context.Context, input *workflowexecutionv1.SubmitWorkflowFileDecisionInput) (*workflowexecutionv1.WorkflowExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildSubmitFileDecisionPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	execution := reqCtx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)
	return execution, nil
}

// buildSubmitFileDecisionPipeline constructs the pipeline for submit-file-decision
// operations. It mirrors buildSubmitApprovalPipeline:
//
//  1. ValidateProto      - Validate input constraints (ids, scope, action, digest)
//  2. LoadExisting       - Load WorkflowExecution from store
//  3. ValidateFileDecision - Validate the (child, change_set) pair is surfaced
//  4. ForwardToChild     - Forward the decision to the child AgentExecution
//  5. BuildResponse      - Return current execution state (with audit log)
func (c *WorkflowExecutionController) buildSubmitFileDecisionPipeline() *pipeline.Pipeline[*workflowexecutionv1.SubmitWorkflowFileDecisionInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]("workflow-execution-submit-file-decision").
		AddStep(steps.NewValidateProtoStep[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]()). // 1. Validate input
		AddStep(newLoadExistingForWfFileDecisionStep(c.store)).                                      // 2. Load execution
		AddStep(newValidateWfFileDecisionStep()).                                                    // 3. Validate the surfaced gate
		AddStep(newForwardFileDecisionToChildStep(c.agentExecutionFileDecisionClient)).              // 4. Forward to child
		AddStep(newBuildWfFileDecisionResponseStep()).                                               // 5. Build response
		Build()
}

// =============================================================================
// Pipeline Steps
// =============================================================================

// loadExistingForWfFileDecisionStep loads a WorkflowExecution by ID for decision processing.
type loadExistingForWfFileDecisionStep struct {
	store store.Store
}

func newLoadExistingForWfFileDecisionStep(s store.Store) *loadExistingForWfFileDecisionStep {
	return &loadExistingForWfFileDecisionStep{store: s}
}

func (s *loadExistingForWfFileDecisionStep) Name() string {
	return "LoadExisting"
}

func (s *loadExistingForWfFileDecisionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]) error {
	input := ctx.Input()
	executionID := input.GetExecutionId()

	if executionID == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	execution := &workflowexecutionv1.WorkflowExecution{}
	err := s.store.GetResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_workflow_execution,
		executionID,
		execution,
	)

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("workflow_execution", executionID)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to load WorkflowExecution for file decision")
		return grpclib.InternalError(err, "failed to load workflow execution")
	}

	ctx.Set(steps.TargetResourceKey, execution)
	return nil
}

// validateWfFileDecisionStep validates that the (child, change_set) pair the
// decision targets is actually surfaced on the parent's pending_file_reviews.
// This preserves the "cannot decide on an unsurfaced gate" invariant without
// relying on change_set_id being globally unique across sibling children.
type validateWfFileDecisionStep struct{}

func newValidateWfFileDecisionStep() *validateWfFileDecisionStep {
	return &validateWfFileDecisionStep{}
}

func (s *validateWfFileDecisionStep) Name() string {
	return "ValidateFileDecision"
}

func (s *validateWfFileDecisionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)

	executionID := execution.GetMetadata().GetId()
	childID := input.GetChildAgentExecutionId()
	changeSetID := input.GetChangeSetId()
	pendingFileReviews := execution.GetStatus().GetPendingFileReviews()

	if len(pendingFileReviews) == 0 {
		return grpclib.FailedPreconditionError(
			"workflow execution %s has no pending file reviews",
			executionID,
		)
	}

	for _, fr := range pendingFileReviews {
		if fr.GetChildAgentExecutionId() != childID {
			continue
		}
		for _, csID := range fr.GetChangeSetId() {
			if csID == changeSetID {
				log.Debug().
					Str("execution_id", executionID).
					Str("child_execution_id", childID).
					Str("change_set_id", changeSetID).
					Str("action", input.GetAction().String()).
					Msg("Workflow file decision validation passed")
				return nil
			}
		}
	}

	return grpclib.FailedPreconditionError(
		"workflow execution %s has no pending file review for child %s change set %s",
		executionID, childID, changeSetID,
	)
}

// forwardFileDecisionToChildStep forwards the decision to the child AgentExecution.
type forwardFileDecisionToChildStep struct {
	client AgentExecutionFileDecisionClient
}

func newForwardFileDecisionToChildStep(client AgentExecutionFileDecisionClient) *forwardFileDecisionToChildStep {
	return &forwardFileDecisionToChildStep{client: client}
}

func (s *forwardFileDecisionToChildStep) Name() string {
	return "ForwardToChild"
}

func (s *forwardFileDecisionToChildStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]) error {
	// Skip if no client available (graceful degradation, mirrors approval forwarding).
	if s.client == nil {
		log.Warn().Msg("AgentExecution client not available - skipping file decision forwarding")
		return nil
	}

	input := ctx.Input()
	childExecutionID := input.GetChildAgentExecutionId()

	log.Info().
		Str("child_execution_id", childExecutionID).
		Str("change_set_id", input.GetChangeSetId()).
		Str("scope", input.GetScope().String()).
		Str("action", input.GetAction().String()).
		Msg("Forwarding file decision to child AgentExecution")

	childInput := &agentexecutionv1.SubmitFileDecisionInput{
		AgentExecutionId:        childExecutionID,
		ChangeSetId:             input.GetChangeSetId(),
		Scope:                   input.GetScope(),
		FileChangeId:            input.GetFileChangeId(),
		Action:                  input.GetAction(),
		ExpectedDigest:          input.GetExpectedDigest(),
		Reason:                  input.GetReason(),
		AcknowledgeUnreviewable: input.GetAcknowledgeUnreviewable(),
	}

	if _, err := s.client.SubmitFileDecision(ctx.Context(), childInput); err != nil {
		// Propagate the child's gRPC status unchanged: the completeness and digest
		// gates return FAILED_PRECONDITION / INVALID_ARGUMENT that the caller needs
		// to see (a decision on an incomplete diff or a stale digest is a real,
		// actionable rejection — not a transient transport failure to flatten).
		log.Error().
			Err(err).
			Str("child_execution_id", childExecutionID).
			Msg("Child AgentExecution rejected the file decision")
		return err
	}

	log.Info().
		Str("child_execution_id", childExecutionID).
		Msg("Successfully forwarded file decision to child AgentExecution")

	return nil
}

// buildWfFileDecisionResponseStep audit-logs the decision. It returns the parent
// execution loaded earlier; the pending_file_reviews reference is cleared later by
// call-agent-status once the child leaves AWAITING_REVIEW (mirrors approval flow).
type buildWfFileDecisionResponseStep struct{}

func newBuildWfFileDecisionResponseStep() *buildWfFileDecisionResponseStep {
	return &buildWfFileDecisionResponseStep{}
}

func (s *buildWfFileDecisionResponseStep) Name() string {
	return "BuildResponse"
}

func (s *buildWfFileDecisionResponseStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubmitWorkflowFileDecisionInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)

	log.Info().
		Str("workflow_execution_id", execution.GetMetadata().GetId()).
		Str("org", execution.GetMetadata().GetOrg()).
		Str("child_execution_id", input.GetChildAgentExecutionId()).
		Str("change_set_id", input.GetChangeSetId()).
		Str("scope", input.GetScope().String()).
		Str("action", input.GetAction().String()).
		Str("reason", input.GetReason()).
		Msg("AUDIT: Workflow file decision submitted and forwarded to child agent")

	return nil
}
