package agentexecution

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"google.golang.org/protobuf/proto"
)

// Context keys for inter-step communication
const (
	IsIdempotentRequestKey = "isIdempotentRequest"
)

// SubmitApproval submits an approval decision for a pending tool call (HITL).
//
// This RPC enables human-in-the-loop approval flows where dangerous or sensitive
// tool calls require explicit user approval before execution.
//
// ## Preconditions
//
//   - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
//   - tool_call_id must match an entry in status.pending_approvals
//   - action must be APPROVE, SKIP, or REJECT (not UNSPECIFIED)
//
// ## Behavior by Action
//
//   - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
//   - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
//   - REJECT: Execution fails with rejection error, phase becomes FAILED
//
// ## Immediate State Transitions (in this handler)
//
//   - ToolCall.approval_action = submitted action
//   - ToolCall.approval_decided_at = current timestamp
//   - Updated state is persisted and broadcast to subscribers
//
// pending_approvals are intentionally PRESERVED in the DB. The re-invoked
// Python activity reads them to discover interrupt_ids for LangGraph resume.
// Cleanup happens via the clear-signal mechanism: the Python activity sends a
// PendingApproval with empty tool_call_id through UpdateStatus after resume.
//
// The execution phase remains WAITING_FOR_APPROVAL until the Python activity
// resumes and transitions it to IN_PROGRESS. This handler owns the approval
// decision recording; the phase transition is owned by the agent runner.
//
// ## Idempotency
//
// If the same approval is submitted twice (same execution, tool_call, action),
// the second call is a no-op and returns the current state.
//
// ## Temporal Integration
//
// After persisting the resolved state, the handler sends a submitApproval signal
// to the running Temporal workflow. The workflow receives this signal and:
//  1. Unblocks its signal channel
//  2. Collects approval decisions (one per pending tool call)
//  3. Re-invokes the Python activity with the decisions
//  4. Python processes the decisions and resumes execution
func (c *AgentExecutionController) SubmitApproval(ctx context.Context, input *agentexecutionv1.SubmitApprovalInput) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildSubmitApprovalPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution from context
	execution := reqCtx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	return execution, nil
}

// buildSubmitApprovalPipeline constructs the pipeline for submit-approval operations.
//
// Pipeline steps:
//  1. ValidateProto              - Validate input constraints (tool_call_id, action required)
//  2. LoadExisting               - Load AgentExecution from store
//  3. ValidateApproval           - Validate phase, tool_call_id match, idempotency
//  4. RecordApprovalDecision     - Record decision on ToolCall, broadcast to subscribers
//  5. SignalWorkflow             - Send Temporal signal to running workflow
//  6. BuildResponse              - Return current execution state (with audit log)
func (c *AgentExecutionController) buildSubmitApprovalPipeline() *pipeline.Pipeline[*agentexecutionv1.SubmitApprovalInput] {
	return pipeline.NewPipeline[*agentexecutionv1.SubmitApprovalInput]("agent-execution-submit-approval").
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.SubmitApprovalInput]()). // 1. Validate input
		AddStep(newLoadExistingForApprovalStep(c.store)).                             // 2. Load execution
		AddStep(newValidateApprovalStep()).                                           // 3. Validate approval
		AddStep(newRecordApprovalDecisionStep(c.store, c.streamBroker)).              // 4. Record approval decision
		AddStep(newSignalWorkflowStep(c.workflowCreator, c.store)).                   // 5. Signal workflow
		AddStep(newBuildApprovalResponseStep()).                                      // 6. Build response
		Build()
}

// =============================================================================
// Pipeline Steps
// =============================================================================

// loadExistingForApprovalStep loads an AgentExecution by ID for approval processing.
type loadExistingForApprovalStep struct {
	store store.Store
}

func newLoadExistingForApprovalStep(s store.Store) *loadExistingForApprovalStep {
	return &loadExistingForApprovalStep{store: s}
}

func (s *loadExistingForApprovalStep) Name() string {
	return "LoadExisting"
}

func (s *loadExistingForApprovalStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitApprovalInput]) error {
	input := ctx.Input()
	executionID := input.GetAgentExecutionId()

	if executionID == "" {
		return grpclib.InvalidArgumentError("agent_execution_id is required")
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Loading AgentExecution for approval")

	execution := &agentexecutionv1.AgentExecution{}
	err := s.store.GetResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		execution,
	)

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("execution_id", executionID).
				Msg("AgentExecution not found")
			return grpclib.NotFoundError("agent_execution", executionID)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to load AgentExecution")
		return grpclib.InternalError(err, "failed to load agent execution")
	}

	// Store loaded execution in context
	ctx.Set(steps.TargetResourceKey, execution)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.GetStatus().GetPhase().String()).
		Msg("Loaded AgentExecution for approval")

	return nil
}

// validateApprovalStep validates the approval preconditions.
type validateApprovalStep struct{}

func newValidateApprovalStep() *validateApprovalStep {
	return &validateApprovalStep{}
}

func (s *validateApprovalStep) Name() string {
	return "ValidateApproval"
}

func (s *validateApprovalStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)

	executionID := execution.GetMetadata().GetId()
	requestedToolCallId := input.GetToolCallId()
	requestedAction := input.GetAction()
	currentPhase := execution.GetStatus().GetPhase()

	// ── Idempotency via lifecycle_state (preferred) ──
	//
	// Check pending_approvals FIRST. If the PendingApproval for this tool_call_id
	// already has lifecycle_state >= DECISION_RECORDED and the action matches,
	// this is an idempotent retry. Checking PendingApproval (the authoritative
	// record) before ToolCall prevents the stale-approval-action bug where a
	// tool_call_id reused across cycles carries a stale ToolCall.approval_action
	// from the previous cycle.
	pendingApprovals := execution.GetStatus().GetPendingApprovals()
	var matchedPA *agentexecutionv1.PendingApproval
	for _, pa := range pendingApprovals {
		if pa.GetToolCallId() == requestedToolCallId {
			matchedPA = pa
			break
		}
	}

	if matchedPA != nil {
		paState := matchedPA.GetLifecycleState()
		if paState >= agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED {
			if matchedPA.GetDecisionAction() == requestedAction {
				log.Info().
					Str("execution_id", executionID).
					Str("tool_call_id", requestedToolCallId).
					Str("action", requestedAction.String()).
					Str("lifecycle_state", paState.String()).
					Msg("IDEMPOTENT: PendingApproval already has matching decision")
				ctx.Set(IsIdempotentRequestKey, true)
				return nil
			}
			return grpclib.FailedPreconditionError(
				"tool call %s already has approval decision %s (lifecycle=%s), cannot change to %s",
				requestedToolCallId, matchedPA.GetDecisionAction().String(), paState.String(), requestedAction.String(),
			)
		}
		// PendingApproval exists and is in REQUESTED or INTERRUPT_CAPTURED — proceed.
	}

	// ── Fallback idempotency via ToolCall.approval_action ──
	//
	// For backward compatibility with PendingApprovals that lack lifecycle_state
	// (legacy records or records from before this change is deployed).
	if matchedPA == nil || matchedPA.GetLifecycleState() == agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_UNSPECIFIED {
		if tc := findToolCallInExecution(execution, requestedToolCallId); tc != nil {
			existingAction := tc.GetApprovalAction()
			if existingAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
				// Only treat as idempotent if the tool_call_id is NOT in pending_approvals.
				// If it IS in pending_approvals, the stale approval_action is from a
				// previous cycle and this is a fresh approval request.
				if matchedPA == nil {
					if existingAction == requestedAction {
						log.Info().
							Str("execution_id", executionID).
							Str("tool_call_id", requestedToolCallId).
							Str("action", requestedAction.String()).
							Msg("IDEMPOTENT: ToolCall already has matching approval action (legacy path)")
						ctx.Set(IsIdempotentRequestKey, true)
						return nil
					}
					return grpclib.FailedPreconditionError(
						"tool call %s already has approval action %s, cannot change to %s",
						requestedToolCallId, existingAction.String(), requestedAction.String(),
					)
				}
			}
		}
	}

	// Validate phase: Must be EXECUTION_WAITING_FOR_APPROVAL
	if currentPhase != agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		log.Debug().
			Str("execution_id", executionID).
			Str("current_phase", currentPhase.String()).
			Msg("Execution not in WAITING_FOR_APPROVAL phase")
		return grpclib.FailedPreconditionError(
			"execution %s is in phase %s, expected EXECUTION_WAITING_FOR_APPROVAL",
			executionID, currentPhase.String(),
		)
	}

	// Best-effort validation of tool_call_id against pending_approvals.
	if len(pendingApprovals) == 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("tool_call_id", requestedToolCallId).
			Msg("pending_approvals empty in DB but phase is WAITING_FOR_APPROVAL -- proceeding with signal (DB consistency lag)")
	} else if matchedPA == nil {
		validIDs := make([]string, 0, len(pendingApprovals))
		for _, pa := range pendingApprovals {
			validIDs = append(validIDs, pa.GetToolCallId())
		}
		log.Debug().
			Str("execution_id", executionID).
			Str("requested_tool_call_id", requestedToolCallId).
			Strs("valid_tool_call_ids", validIDs).
			Msg("Tool call ID not found in pending_approvals")
		return grpclib.InvalidArgumentError(
			"tool_call_id %s not found in pending_approvals for execution %s",
			requestedToolCallId, executionID,
		)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("tool_call_id", requestedToolCallId).
		Str("action", requestedAction.String()).
		Msg("Approval validation passed")

	return nil
}

// recordApprovalDecisionStep records the user's approval decision on the matching
// ToolCall, persists the updated state to the DB, and broadcasts to subscribers.
//
// pending_approvals are intentionally NOT removed. The re-invoked Python activity
// reads them to discover the LangGraph interrupt_id for each approved tool call
// and build Command(resume={interrupt_id: decision}). If we removed them here,
// the activity would find an empty list and start a fresh LangGraph execution
// instead of resuming the interrupted one -- causing the LLM to regenerate the
// same tool call in an infinite loop.
//
// Cleanup of pending_approvals happens later via the Python activity's
// RESUME_RECONCILE phase, which sends a clear-signal (PendingApproval with
// empty tool_call_id) through the UpdateStatus handler.
type recordApprovalDecisionStep struct {
	store        store.Store
	streamBroker *StreamBroker
}

func newRecordApprovalDecisionStep(s store.Store, broker *StreamBroker) *recordApprovalDecisionStep {
	return &recordApprovalDecisionStep{store: s, streamBroker: broker}
}

func (s *recordApprovalDecisionStep) Name() string {
	return "RecordApprovalDecision"
}

func (s *recordApprovalDecisionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitApprovalInput]) error {
	if isIdempotent, ok := ctx.Get(IsIdempotentRequestKey).(bool); ok && isIdempotent {
		log.Debug().Msg("Skipping approval decision recording for idempotent request")
		return nil
	}

	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()
	toolCallId := input.GetToolCallId()
	action := input.GetAction()

	updated := proto.Clone(execution).(*agentexecutionv1.AgentExecution)
	if updated.Status == nil {
		updated.Status = &agentexecutionv1.AgentExecutionStatus{}
	}

	// Record the approval decision on the matching ToolCall for immediate UI
	// feedback. Python will also set these when it resumes, but recording here
	// provides instant visibility without waiting for the async activity.
	now := time.Now().UTC().Format(time.RFC3339)
	if tc := findToolCallInExecution(updated, toolCallId); tc != nil {
		tc.ApprovalAction = action
		tc.ApprovalDecidedAt = now
	}

	// Advance the matching PendingApproval's lifecycle to DECISION_RECORDED.
	// This records the decision on the authoritative PendingApproval record,
	// making ToolCall.approval_action a projection of this value.
	for _, pa := range updated.Status.PendingApprovals {
		if pa.GetToolCallId() == toolCallId {
			pa.LifecycleState = agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED
			pa.DecisionAction = action
			pa.DecisionRecordedAt = now
			break
		}
	}

	log.Info().
		Str("execution_id", executionID).
		Str("tool_call_id", toolCallId).
		Str("action", action.String()).
		Str("lifecycle_state", "DECISION_RECORDED").
		Str("from_state", "INTERRUPT_CAPTURED").
		Str("to_state", "DECISION_RECORDED").
		Str("service", "stigmer-server").
		Int("pending_approvals", len(updated.Status.PendingApprovals)).
		Msg("[LIFECYCLE] Recorded approval decision on ToolCall and PendingApproval")

	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, updated); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to persist approval decision")
		return grpclib.InternalError(err, "failed to persist approval decision")
	}

	if s.streamBroker != nil {
		s.streamBroker.Broadcast(updated)
	}

	// Update context so downstream steps see the updated state.
	ctx.Set(steps.TargetResourceKey, updated)

	return nil
}

// signalWorkflowStep sends a Temporal signal to the running workflow.
//
// If the workflow is no longer running (WorkflowNotFound), this step reconciles
// the execution status in the database to FAILED. This prevents executions from
// being permanently stuck in WAITING_FOR_APPROVAL when the backing workflow has
// terminated unexpectedly (e.g., infrastructure failure, manual termination).
type signalWorkflowStep struct {
	workflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator
	store           store.Store
}

func newSignalWorkflowStep(creator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator, s store.Store) *signalWorkflowStep {
	return &signalWorkflowStep{workflowCreator: creator, store: s}
}

func (s *signalWorkflowStep) Name() string {
	return "SignalWorkflow"
}

func (s *signalWorkflowStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitApprovalInput]) error {
	// Skip if this is an idempotent request (already processed)
	if isIdempotent, ok := ctx.Get(IsIdempotentRequestKey).(bool); ok && isIdempotent {
		log.Debug().Msg("Skipping workflow signal for idempotent request")
		return nil
	}

	// Skip if workflow creator is not available (graceful degradation)
	if s.workflowCreator == nil {
		log.Warn().Msg("Workflow creator not available - skipping Temporal signal")
		return nil
	}

	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	log.Info().
		Str("execution_id", executionID).
		Str("tool_call_id", input.GetToolCallId()).
		Str("action", input.GetAction().String()).
		Msg("Signaling Temporal workflow with approval decision")

	err := s.workflowCreator.SignalApproval(executionID, input)
	if err != nil {
		if errors.Is(err, agentexecutiontemporal.ErrWorkflowNotFound) {
			// Workflow not running - reconcile the stale execution status.
			// The DB still shows WAITING_FOR_APPROVAL but the workflow that would
			// process the approval no longer exists. Update to FAILED so the
			// execution is not permanently stuck.
			log.Warn().
				Str("execution_id", executionID).
				Msg("Workflow not found - reconciling stale execution status to FAILED")

			s.reconcileStaleExecution(ctx.Context(), execution)

			return grpclib.FailedPreconditionError(
				"workflow not running for execution %s - the backing workflow has terminated unexpectedly and the execution has been marked as failed",
				executionID,
			)
		}

		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to signal workflow")
		return grpclib.UnavailableError("failed to signal workflow: %v", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Msg("Successfully signaled workflow with approval decision")

	return nil
}

// reconcileStaleExecution updates an execution that is stuck in WAITING_FOR_APPROVAL
// to FAILED because the backing Temporal workflow is no longer running.
//
// This is a best-effort reconciliation: if the DB update fails, we log the error
// but still return the WorkflowNotFound error to the caller. The execution will
// remain stale until another reconciliation attempt or manual intervention.
func (s *signalWorkflowStep) reconcileStaleExecution(ctx context.Context, execution *agentexecutionv1.AgentExecution) {
	executionID := execution.GetMetadata().GetId()

	// Build the reconciled execution with FAILED status
	reconciledExecution := &agentexecutionv1.AgentExecution{
		ApiVersion: execution.GetApiVersion(),
		Kind:       execution.GetKind(),
		Metadata:   execution.GetMetadata(),
		Spec:       execution.GetSpec(),
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:     agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error:     "Workflow backing this execution is no longer running. Execution has been marked as failed.",
			Messages:  execution.GetStatus().GetMessages(),
			ToolCalls: execution.GetStatus().GetToolCalls(),
			Audit:     execution.GetStatus().GetAudit(),
			// PendingApproval intentionally omitted (cleared)
		},
	}

	// Append a system message explaining what happened
	reconciledExecution.Status.Messages = append(reconciledExecution.Status.Messages, &agentexecutionv1.AgentMessage{
		Type:    agentexecutionv1.MessageType_MESSAGE_SYSTEM,
		Content: "The workflow backing this execution is no longer running. This can happen due to infrastructure issues or manual termination. The execution has been marked as failed.",
	})

	if err := s.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, reconciledExecution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to reconcile stale execution status - execution will remain in WAITING_FOR_APPROVAL until next attempt")
		return
	}

	log.Info().
		Str("execution_id", executionID).
		Str("previous_phase", "EXECUTION_WAITING_FOR_APPROVAL").
		Str("new_phase", "EXECUTION_FAILED").
		Msg("RECONCILIATION: Updated stale execution status to FAILED")
}

// buildApprovalResponseStep builds the response with audit logging.
type buildApprovalResponseStep struct{}

func newBuildApprovalResponseStep() *buildApprovalResponseStep {
	return &buildApprovalResponseStep{}
}

func (s *buildApprovalResponseStep) Name() string {
	return "BuildResponse"
}

func (s *buildApprovalResponseStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitApprovalInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)

	executionID := execution.GetMetadata().GetId()
	org := execution.GetMetadata().GetOrg()
	toolCallId := input.GetToolCallId()
	action := input.GetAction()
	comment := input.GetComment()

	// Find tool name for audit logging
	toolName := "unknown"
	if tc := findToolCallInExecution(execution, toolCallId); tc != nil {
		toolName = tc.GetName()
	}

	// Audit log the approval decision
	// Note: In production, caller identity would come from auth context
	log.Info().
		Str("execution_id", executionID).
		Str("org", org).
		Str("tool_call_id", toolCallId).
		Str("tool_name", toolName).
		Str("action", action.String()).
		Str("comment", comment).
		Msg("AUDIT: Approval decision submitted")

	// The execution state in context reflects the recorded approval decision from
	// RecordApprovalDecisionStep. Clients see the ToolCall's approval_action
	// immediately; further updates arrive via the Subscribe stream as Python resumes.

	return nil
}

// findToolCallInExecution searches for a ToolCall by ID across both top-level
// and sub-agent tool calls. Sub-agent tools (e.g., write invoked by a
// sub-agent) live under SubAgentExecution.ToolCalls, not the top-level list.
func findToolCallInExecution(execution *agentexecutionv1.AgentExecution, toolCallID string) *agentexecutionv1.ToolCall {
	for _, tc := range execution.GetStatus().GetToolCalls() {
		if tc.GetId() == toolCallID {
			return tc
		}
	}
	for _, sa := range execution.GetStatus().GetSubAgentExecutions() {
		for _, tc := range sa.GetToolCalls() {
			if tc.GetId() == toolCallID {
				return tc
			}
		}
	}
	return nil
}
