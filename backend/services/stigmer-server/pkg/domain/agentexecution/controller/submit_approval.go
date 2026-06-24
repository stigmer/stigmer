package agentexecution

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
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
//   - Execution must be in EXECUTION_WAITING_FOR_APPROVAL or EXECUTION_IN_PROGRESS phase
//   - tool_call_id must reference a ToolCall with status TOOL_CALL_WAITING_APPROVAL
//   - action must be APPROVE, SKIP, REJECT, or APPROVE_ALL (not UNSPECIFIED)
//
// ## Behavior by Action
//
//   - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
//   - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
//   - REJECT: Execution fails with rejection error, phase becomes FAILED
//   - APPROVE_ALL: Like APPROVE for the clicked tool, and also auto-approves the
//     co-pending tool calls of the SAME lease class (the clicked tool's built-in
//     category, or its MCP server — see approval.DeriveLeaseScope). Co-pending
//     calls of a different class stay WAITING_APPROVAL, so pending_approvals
//     becomes empty (and the gate resolves) only when no other-class approval is
//     outstanding. The runner then auto-approves only that class for the rest of
//     the execution (a run-lifetime lease, see ApprovalAction doc in enum.proto).
//
// ## Immediate State Transitions (in this handler)
//
//   - ToolCall.approval_action = submitted action
//   - ToolCall.approval_decided_at = current timestamp
//   - pending_approvals recomputed (approved entry disappears immediately)
//   - Updated state is persisted and broadcast to subscribers
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
// After persisting the resolved state, the handler sends an approvalGateResolved
// signal to the running Temporal workflow ONLY when the gate has fully resolved:
//   - REJECT action: signal immediately (Python auto-skips remaining tool calls)
//   - All decided: signal when pending_approvals becomes empty
//   - Otherwise: no signal — the workflow continues waiting
//
// The workflow waits for exactly one approvalGateResolved signal per approval
// cycle, then re-invokes Python. Python reads the approval decisions from the
// DB (not from Temporal args) and resumes execution.
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
//  5. SignalWorkflow             - Conditionally send approvalGateResolved signal
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

	// Validate phase: approval is accepted during active execution phases where
	// tool calls may be awaiting decisions. Terminal and pre-start phases are rejected.
	if currentPhase != agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL &&
		currentPhase != agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		log.Debug().
			Str("execution_id", executionID).
			Str("current_phase", currentPhase.String()).
			Msg("Execution not in an approvable phase")
		return grpclib.FailedPreconditionError(
			"execution %s is in phase %s, approval requires EXECUTION_WAITING_FOR_APPROVAL or EXECUTION_IN_PROGRESS",
			executionID, currentPhase.String(),
		)
	}

	// Find the ToolCall in messages — the single source of truth.
	tc := findToolCallInExecution(execution, requestedToolCallId)
	if tc == nil {
		return grpclib.InvalidArgumentError(
			"tool_call_id %s not found in messages for execution %s",
			requestedToolCallId, executionID,
		)
	}

	// Idempotency: if a decision is already recorded on the ToolCall
	existingAction := tc.GetApprovalAction()
	if existingAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		if existingAction == requestedAction {
			log.Info().
				Str("execution_id", executionID).
				Str("tool_call_id", requestedToolCallId).
				Str("action", requestedAction.String()).
				Msg("IDEMPOTENT: ToolCall already has matching approval action")
			ctx.Set(IsIdempotentRequestKey, true)
			return nil
		}
		return grpclib.FailedPreconditionError(
			"tool call %s already has approval action %s, cannot change to %s",
			requestedToolCallId, existingAction.String(), requestedAction.String(),
		)
	}

	// Validate the tool call is actually waiting for approval
	if tc.GetStatus() != agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL {
		return grpclib.FailedPreconditionError(
			"tool call %s has status %s, expected TOOL_CALL_WAITING_APPROVAL",
			requestedToolCallId, tc.GetStatus().String(),
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
// ToolCall, recomputes pending_approvals (so the approved entry disappears
// immediately), persists, and broadcasts to subscribers.
//
// Uses store.UpdateResource for atomic read-modify-write to prevent concurrent
// SubmitApproval calls from overwriting each other's approval decisions.
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
	executionID := input.GetAgentExecutionId()
	toolCallId := input.GetToolCallId()
	action := input.GetAction()
	comment := input.GetComment()
	now := time.Now().UTC().Format(time.RFC3339)

	// Decider identity for the approval ledger. OSS is single-user with no
	// multi-tenant auth context, so the principal is empty; the Cloud edition
	// populates decided_by/approved_by from the authenticated caller.
	decidedBy := ""

	updated := &agentexecutionv1.AgentExecution{}

	err := s.store.UpdateResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		updated,
		func() error {
			// Re-check under the write lock: the tool call must still exist
			// and must not already have a decision (guards against TOCTOU races
			// where a concurrent request recorded a decision between our
			// validation step and this locked update).
			tc := findToolCallInExecution(updated, toolCallId)
			if tc == nil {
				return fmt.Errorf("tool call %s no longer exists in execution %s", toolCallId, executionID)
			}
			if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
				return fmt.Errorf("tool call %s already has approval action %s (concurrent approval won the race)",
					toolCallId, tc.GetApprovalAction().String())
			}

			if updated.Status == nil {
				updated.Status = &agentexecutionv1.AgentExecutionStatus{}
			}

			// Author REQUESTED events BEFORE recording the decision, while every
			// gated tool call is still WAITING. This seeds the persisted stream
			// for executions that predate the field, so a decision event always
			// has a preceding request even for an execution parked at the gate
			// across the deploy. See approval.EnsureApprovalRequests.
			approval.EnsureApprovalRequests(updated.Status, executionID)

			tc.ApprovalAction = action
			tc.ApprovalDecidedAt = now
			tc.ApprovedBy = decidedBy
			// Author the rich decision event (decided_by + the user's comment) in
			// the same locked write that records the decision on the scan, so it
			// can never be duplicated or clobbered by a coarse re-derivation.
			approval.RecordDecisionEvent(updated.Status, tc, decidedBy, comment)

			// APPROVE_ALL ("approve all of this kind") grants a run-lifetime lease
			// scoped to the clicked tool's class: every co-pending tool call of
			// the SAME class (root and sub-agents) is auto-approved; co-pending
			// calls of a different class stay WAITING_APPROVAL. The clicked tool
			// keeps APPROVE_ALL as its recorded action — that single entry marks
			// where the user opted into trusting that class for the rest of the
			// run; the matched co-pending tools carry a plain APPROVE so the audit
			// trail stays honest (every executed tool shows an explicit decision).
			// The runner detects the APPROVE_ALL decision in history and derives
			// the same scope to auto-approve only that class going forward.
			if action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL {
				for _, bulkTc := range bulkApproveCoPendingToolCalls(updated, toolCallId, now, decidedBy) {
					// Co-pending tools carry a plain APPROVE and no comment — the
					// escalation comment belongs to the clicked tool.
					approval.RecordDecisionEvent(updated.Status, bulkTc, decidedBy, "")
				}
			}

			// Recompute pending_approvals — the approved entry disappears because
			// its approval_action is now set (no longer UNSPECIFIED). Via the single
			// projection seam (a pure read that also runs the event-stream parity check).
			updated.Status.PendingApprovals = approval.ProjectPendingApprovals(
				updated.Status.GetMessages(),
				updated.Status.GetSubAgentExecutions(),
				updated.Status.GetApprovalEventStream(),
			)

			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("agent_execution", executionID)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Str("tool_call_id", toolCallId).
			Msg("Failed to atomically record approval decision")
		return grpclib.InternalError(err, "failed to persist approval decision")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("tool_call_id", toolCallId).
		Str("action", action.String()).
		Int("pending_approvals_remaining", len(updated.GetStatus().GetPendingApprovals())).
		Msg("Recorded approval decision on ToolCall, recomputed pending_approvals")

	if s.streamBroker != nil {
		s.streamBroker.Broadcast(updated)
	}

	ctx.Set(steps.TargetResourceKey, updated)

	return nil
}

// signalWorkflowStep conditionally sends an approvalGateResolved signal to the
// running Temporal workflow when the approval gate has fully resolved.
//
// The signal is sent when either:
//   - The submitted action is REJECT (immediate resume — Python auto-skips remaining)
//   - All pending tool calls have received decisions (pending_approvals is empty)
//
// If neither condition is met, no signal is sent — the workflow continues waiting
// for the remaining approvals.
//
// If the workflow is no longer running (WorkflowNotFound), this step reconciles
// the execution status in the database to FAILED.
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
	if isIdempotent, ok := ctx.Get(IsIdempotentRequestKey).(bool); ok && isIdempotent {
		log.Debug().Msg("Skipping workflow signal for idempotent request")
		return nil
	}

	if s.workflowCreator == nil {
		log.Warn().Msg("Workflow creator not available - skipping Temporal signal")
		return nil
	}

	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()
	action := input.GetAction()
	pendingRemaining := len(execution.GetStatus().GetPendingApprovals())

	isReject := action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	allDecided := pendingRemaining == 0

	if !isReject && !allDecided {
		log.Info().
			Str("execution_id", executionID).
			Str("tool_call_id", input.GetToolCallId()).
			Str("action", action.String()).
			Int("pending_approvals_remaining", pendingRemaining).
			Msg("Approval recorded, gate not yet resolved — waiting for remaining approvals")
		return nil
	}

	reason := "all tool calls decided"
	if isReject {
		reason = "REJECT triggers immediate resume"
	}

	log.Info().
		Str("execution_id", executionID).
		Str("tool_call_id", input.GetToolCallId()).
		Str("action", action.String()).
		Str("reason", reason).
		Int("pending_approvals_remaining", pendingRemaining).
		Msg("Approval gate resolved — sending approvalGateResolved signal")

	err := s.workflowCreator.SignalApprovalGateResolved(executionID)
	if err != nil {
		if errors.Is(err, agentexecutiontemporal.ErrWorkflowNotFound) {
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
		Str("reason", reason).
		Msg("Successfully sent approvalGateResolved signal to workflow")

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

	reconciledExecution := &agentexecutionv1.AgentExecution{
		ApiVersion: execution.GetApiVersion(),
		Kind:       execution.GetKind(),
		Metadata:   execution.GetMetadata(),
		Spec:       execution.GetSpec(),
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error:    "Workflow backing this execution is no longer running. Execution has been marked as failed.",
			Messages: execution.GetStatus().GetMessages(),
			Audit:    execution.GetStatus().GetAudit(),
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

// bulkApproveCoPendingToolCalls implements the gate-resolving half of an
// APPROVE_ALL decision, SCOPED to the clicked tool's lease class. It scans the
// same surface as findToolCallInExecution (root messages and sub-agent messages)
// and sets every co-pending tool call (still WAITING_APPROVAL, no decision)
// whose lease scope MATCHES the clicked tool's scope to APPROVE. Co-pending tool
// calls of a DIFFERENT class stay WAITING_APPROVAL.
//
// This scoping is required for correctness, not cosmetics. APPROVE_ALL now means
// "approve all of THIS kind" (the clicked tool's built-in category, or its MCP
// server — see approval.DeriveLeaseScope), not "approve everything". If a write
// and a shell are co-pending and the user approves-all the shell, the write must
// remain pending: pending_approvals must still list it, and the
// approvalGateResolved signal must NOT fire (the SignalWorkflow step keys off a
// non-empty pending_approvals), so the workflow keeps waiting for the write.
//
// The tool the user clicked (clickedToolCallID) is skipped here — its action is
// already set to APPROVE_ALL by the caller. Recording APPROVE on the matched
// co-pending tools (rather than APPROVE_ALL) keeps the audit trail unambiguous:
// exactly one tool carries APPROVE_ALL, marking the user's escalation point.
// bulkApproveCoPendingToolCalls auto-approves every co-pending tool call of the
// clicked tool's lease class and returns the calls it approved, so the caller can
// author a decision event for each. decidedBy stamps approved_by for the audit
// trail; OSS passes empty (no auth principal).
func bulkApproveCoPendingToolCalls(execution *agentexecutionv1.AgentExecution, clickedToolCallID, decidedAt, decidedBy string) []*agentexecutionv1.ToolCall {
	clicked := findToolCallInExecution(execution, clickedToolCallID)
	if clicked == nil {
		return nil
	}
	clickedScope, ok := approval.DeriveLeaseScope(clicked)
	if !ok {
		// The clicked tool has no leasable scope (an unknown/ungated name that
		// somehow carried APPROVE_ALL). Nothing else can match it, so approve no
		// co-pending tools. Defensive — a gated tool always has a scope.
		return nil
	}

	var approved []*agentexecutionv1.ToolCall
	approveIfWaitingInScope := func(tc *agentexecutionv1.ToolCall) {
		if tc.GetId() == clickedToolCallID {
			return
		}
		if tc.GetStatus() != agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL {
			return
		}
		if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
			return
		}
		// Only co-pending tools of the SAME lease class are auto-approved.
		if scope, ok := approval.DeriveLeaseScope(tc); !ok || scope != clickedScope {
			return
		}
		tc.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
		tc.ApprovalDecidedAt = decidedAt
		tc.ApprovedBy = decidedBy
		approved = append(approved, tc)
	}

	for _, msg := range execution.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			approveIfWaitingInScope(tc)
		}
	}
	for _, sa := range execution.GetStatus().GetSubAgentExecutions() {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				approveIfWaitingInScope(tc)
			}
		}
	}
	return approved
}

// findToolCallInExecution searches for a ToolCall by ID in messages (root and
// sub-agent). Tool calls live exclusively in messages[].tool_calls since T02/T03.
func findToolCallInExecution(execution *agentexecutionv1.AgentExecution, toolCallID string) *agentexecutionv1.ToolCall {
	for _, msg := range execution.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() == toolCallID {
				return tc
			}
		}
	}
	for _, sa := range execution.GetStatus().GetSubAgentExecutions() {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if tc.GetId() == toolCallID {
					return tc
				}
			}
		}
	}
	return nil
}
