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
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/filereview"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"google.golang.org/grpc/status"
)

// fileDecisionIdempotentKey marks a SubmitFileDecision request whose decision is
// already recorded, so the record step is a no-op.
const fileDecisionIdempotentKey = "isIdempotentFileDecision"

// SubmitFileDecision records a user's keep/discard decision on a file change set
// (apply-then-review HITL).
//
// It is the backend-owned writer of FILE_DECIDED events on the append-only
// file_review stream; FileChangeSet.decisions is the derived projection. The
// runner's reconcile (Phase 2) applies the approved bytes — this RPC records the
// decision and enforces that expected_digest still matches the captured content
// the user reviewed ("what you approve is what gets applied"). Like
// SubmitApproval, it then signals the workflow (see the pipeline's step 5,
// signalFileDecisionWorkflowStep): the turn paused on file review resumes once
// the unified HITL gate fully clears, via the same approvalGateResolved signal.
//
// ## Preconditions
//
//   - Execution exists and is non-terminal
//   - change_set_id matches a status.file_change_sets[].id; for FILE scope,
//     file_change_id matches a CapturedFileChange.id within it
//   - expected_digest matches the target's current digest
//
// ## Idempotency
//
// Re-submitting the same decision is a no-op and returns current state — appends
// are keyed by the deterministic FileReviewEvent.event_id.
func (c *AgentExecutionController) SubmitFileDecision(ctx context.Context, input *agentexecutionv1.SubmitFileDecisionInput) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildSubmitFileDecisionPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	execution := reqCtx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	return execution, nil
}

// buildSubmitFileDecisionPipeline mirrors the approval pipeline, including the
// workflow-signal step that resumes the turn through the unified HITL gate.
//
//  1. ValidateProto       - input constraints (ids, scope/action not UNSPECIFIED, digest)
//  2. LoadExisting        - load AgentExecution
//  3. ValidateDecision    - phase, change set / file existence, digest match, idempotency
//  4. RecordFileDecision  - author FILE_DECIDED, recompute file_change_sets, persist, broadcast
//  5. SignalWorkflow      - resume the workflow once the unified gate fully clears
//  6. BuildResponse       - return current execution state
func (c *AgentExecutionController) buildSubmitFileDecisionPipeline() *pipeline.Pipeline[*agentexecutionv1.SubmitFileDecisionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.SubmitFileDecisionInput]("agent-execution-submit-file-decision").
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.SubmitFileDecisionInput]()).
		AddStep(newLoadExistingForFileDecisionStep(c.store)).
		AddStep(newValidateFileDecisionStep()).
		AddStep(newRecordFileDecisionStep(c.store, c.streamBroker)).
		AddStep(newSignalFileDecisionWorkflowStep(c.workflowCreator, c.store)).
		AddStep(newBuildFileDecisionResponseStep()).
		Build()
}

// =============================================================================
// Pipeline Steps
// =============================================================================

type loadExistingForFileDecisionStep struct {
	store store.Store
}

func newLoadExistingForFileDecisionStep(s store.Store) *loadExistingForFileDecisionStep {
	return &loadExistingForFileDecisionStep{store: s}
}

func (s *loadExistingForFileDecisionStep) Name() string { return "LoadExisting" }

func (s *loadExistingForFileDecisionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitFileDecisionInput]) error {
	executionID := ctx.Input().GetAgentExecutionId()
	if executionID == "" {
		return grpclib.InvalidArgumentError("agent_execution_id is required")
	}

	execution := &agentexecutionv1.AgentExecution{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, execution)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("agent_execution", executionID)
		}
		return grpclib.InternalError(err, "failed to load agent execution")
	}

	ctx.Set(steps.TargetResourceKey, execution)
	return nil
}

type validateFileDecisionStep struct{}

func newValidateFileDecisionStep() *validateFileDecisionStep { return &validateFileDecisionStep{} }

func (s *validateFileDecisionStep) Name() string { return "ValidateDecision" }

func (s *validateFileDecisionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitFileDecisionInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	if err := validateFileDecisionTarget(execution, input); err != nil {
		return err
	}

	// Idempotency: a decision with the same deterministic event id already on the
	// stream means this exact decision was recorded — return current state.
	if streamHasFileDecision(execution.GetStatus().GetFileReviewEventStream(), input) {
		log.Info().
			Str("execution_id", executionID).
			Str("change_set_id", input.GetChangeSetId()).
			Str("file_change_id", input.GetFileChangeId()).
			Msg("IDEMPOTENT: file decision already recorded")
		ctx.Set(fileDecisionIdempotentKey, true)
	}
	return nil
}

// validateFileDecisionTarget enforces the preconditions against the current
// projection: non-terminal execution, change set (and file) existence, the
// FILE-scope file_change_id requirement, and the expected_digest enforcement
// gate. Shared by the pre-lock validate step and the under-lock re-check.
func validateFileDecisionTarget(execution *agentexecutionv1.AgentExecution, input *agentexecutionv1.SubmitFileDecisionInput) error {
	executionID := execution.GetMetadata().GetId()
	phase := execution.GetStatus().GetPhase()

	changeSets := filereview.ProjectFileChangeSets(phase, execution.GetStatus().GetFileReviewEventStream())
	if changeSets == nil {
		return grpclib.FailedPreconditionError(
			"execution %s has no actionable file change sets (phase %s)", executionID, phase.String(),
		)
	}

	cs := filereview.FindChangeSet(changeSets, input.GetChangeSetId())
	if cs == nil {
		return grpclib.FailedPreconditionError(
			"change set %s not found for execution %s", input.GetChangeSetId(), executionID,
		)
	}

	if input.GetScope() == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		if input.GetFileChangeId() == "" {
			return grpclib.InvalidArgumentError("file_change_id is required for FILE scope")
		}
		if filereview.FindChange(cs, input.GetFileChangeId()) == nil {
			return grpclib.FailedPreconditionError(
				"file change %s not found in change set %s", input.GetFileChangeId(), input.GetChangeSetId(),
			)
		}
	}

	// Completeness precondition: a non-COMPLETE diff can never be approved as if
	// complete (report rule). Gated before the digest check — it holds even with a
	// fresh digest — and only for APPROVE, so an unreviewable change stays
	// discardable (REJECT) and the turn can still resume.
	if input.GetAction() == agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE {
		if reason := filereview.ApproveBlockedReason(cs, input.GetScope(), input.GetFileChangeId()); reason != "" {
			return grpclib.FailedPreconditionError("%s", reason)
		}
	}

	target := filereview.TargetDigest(cs, input.GetScope(), input.GetFileChangeId())
	if input.GetExpectedDigest() != target {
		return grpclib.InvalidArgumentError(
			"expected_digest mismatch for change set %s: the captured content changed since it was reviewed",
			input.GetChangeSetId(),
		)
	}
	return nil
}

func streamHasFileDecision(stream *agentexecutionv1.FileReviewEventStream, input *agentexecutionv1.SubmitFileDecisionInput) bool {
	scopeID := input.GetChangeSetId()
	if input.GetScope() == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		scopeID = input.GetFileChangeId()
	}
	eventID := filereview.EventID(
		input.GetChangeSetId(), scopeID,
		agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED,
	)
	for _, ev := range stream.GetEvents() {
		if ev.GetEventId() == eventID {
			return true
		}
	}
	return false
}

type recordFileDecisionStep struct {
	store        store.Store
	streamBroker *StreamBroker
}

func newRecordFileDecisionStep(s store.Store, broker *StreamBroker) *recordFileDecisionStep {
	return &recordFileDecisionStep{store: s, streamBroker: broker}
}

func (s *recordFileDecisionStep) Name() string { return "RecordFileDecision" }

func (s *recordFileDecisionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitFileDecisionInput]) error {
	if isIdempotent, ok := ctx.Get(fileDecisionIdempotentKey).(bool); ok && isIdempotent {
		return nil
	}

	input := ctx.Input()
	executionID := input.GetAgentExecutionId()
	now := time.Now().UTC().Format(time.RFC3339)

	// OSS is single-user with no multi-tenant auth context, so the reviewer is
	// empty; the Cloud edition populates reviewer_id from the authenticated caller.
	reviewerID := ""

	updated := &agentexecutionv1.AgentExecution{}
	err := s.store.UpdateResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		updated,
		func() error {
			// Re-validate under the write lock against the freshly-loaded state
			// (guards against a capture/decision that landed between the pre-lock
			// validation and this update).
			if err := validateFileDecisionTarget(updated, input); err != nil {
				return err
			}
			if updated.Status == nil {
				updated.Status = &agentexecutionv1.AgentExecutionStatus{}
			}

			decision := filereview.BuildFileDecision(
				input.GetChangeSetId(),
				input.GetFileChangeId(),
				input.GetScope(),
				input.GetAction(),
				input.GetExpectedDigest(),
				reviewerID,
				now,
				input.GetReason(),
			)
			filereview.RecordFileDecisionEvent(updated.Status, executionID, decision)

			// Recompute file_change_sets from the authored ledger via the single
			// projection seam (a pure read), so the new decision is reflected
			// immediately and consistently with the source of truth.
			updated.Status.FileChangeSets = filereview.ProjectFileChangeSets(
				updated.Status.GetPhase(),
				updated.Status.GetFileReviewEventStream(),
			)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("agent_execution", executionID)
		}
		// A precondition failure re-detected under the lock is already a gRPC
		// status error (client fault); surface it verbatim rather than masking it
		// as INTERNAL.
		if _, ok := status.FromError(err); ok {
			return err
		}
		log.Error().Err(err).Str("execution_id", executionID).Msg("Failed to record file decision")
		return grpclib.InternalError(err, "failed to persist file decision")
	}

	if s.streamBroker != nil {
		s.streamBroker.Broadcast(updated)
	}
	ctx.Set(steps.TargetResourceKey, updated)
	return nil
}

// signalFileDecisionWorkflowStep resumes the agent-execution workflow once the
// unified HITL gate fully clears. It is the file-review twin of the approval
// signalWorkflowStep and sends the SAME approvalGateResolved signal: the gate is
// shared, so a turn blocked on file review (and possibly tool approvals too)
// resumes through one signal and one wait.
//
// The signal fires only when filereview.GateResolved is true — no pending
// approvals AND no change set awaiting review — so a partially-decided set, or a
// fully-decided set while tool approvals remain, keeps the workflow waiting.
//
// If the workflow is no longer running (WorkflowNotFound), this reconciles the
// stale execution to FAILED, mirroring the approval path.
type signalFileDecisionWorkflowStep struct {
	workflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator
	store           store.Store
}

func newSignalFileDecisionWorkflowStep(creator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator, s store.Store) *signalFileDecisionWorkflowStep {
	return &signalFileDecisionWorkflowStep{workflowCreator: creator, store: s}
}

func (s *signalFileDecisionWorkflowStep) Name() string { return "SignalWorkflow" }

func (s *signalFileDecisionWorkflowStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitFileDecisionInput]) error {
	if isIdempotent, ok := ctx.Get(fileDecisionIdempotentKey).(bool); ok && isIdempotent {
		log.Debug().Msg("Skipping workflow signal for idempotent file decision")
		return nil
	}
	if s.workflowCreator == nil {
		log.Warn().Msg("Workflow creator not available - skipping Temporal signal")
		return nil
	}

	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	// Resume only when the WHOLE gate is clear: no change set awaiting review and
	// no tool approval pending. Unlike approvals, a file REJECT has no
	// immediate-resume shortcut — every file in the set must be decided (or one
	// CHANGE_SET-scoped decision must cover them) before the runner reconciles.
	if !filereview.GateResolved(execution.GetStatus()) {
		log.Info().
			Str("execution_id", executionID).
			Str("change_set_id", input.GetChangeSetId()).
			Int("pending_approvals_remaining", len(execution.GetStatus().GetPendingApprovals())).
			Int("change_sets_awaiting_review", filereview.CountAwaitingReview(execution.GetStatus().GetFileChangeSets())).
			Msg("File decision recorded, HITL gate not yet resolved — waiting")
		return nil
	}

	log.Info().
		Str("execution_id", executionID).
		Str("change_set_id", input.GetChangeSetId()).
		Msg("HITL gate resolved by file decision — sending approvalGateResolved signal")

	if err := s.workflowCreator.SignalApprovalGateResolved(executionID); err != nil {
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
		log.Error().Err(err).Str("execution_id", executionID).Msg("Failed to signal workflow")
		return grpclib.UnavailableError("failed to signal workflow: %v", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Msg("Successfully sent approvalGateResolved signal to workflow")
	return nil
}

// reconcileStaleExecution marks an execution FAILED when its backing workflow is
// gone. Best-effort, mirroring the approval path; both append-only ledgers are
// preserved verbatim for the audit trail, the projections left empty (terminal).
func (s *signalFileDecisionWorkflowStep) reconcileStaleExecution(ctx context.Context, execution *agentexecutionv1.AgentExecution) {
	executionID := execution.GetMetadata().GetId()

	reconciledExecution := &agentexecutionv1.AgentExecution{
		ApiVersion: execution.GetApiVersion(),
		Kind:       execution.GetKind(),
		Metadata:   execution.GetMetadata(),
		Spec:       execution.GetSpec(),
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:                 agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error:                 "Workflow backing this execution is no longer running. Execution has been marked as failed.",
			Messages:              execution.GetStatus().GetMessages(),
			Audit:                 execution.GetStatus().GetAudit(),
			ApprovalEventStream:   execution.GetStatus().GetApprovalEventStream(),
			FileReviewEventStream: execution.GetStatus().GetFileReviewEventStream(),
		},
	}
	reconciledExecution.Status.Messages = append(reconciledExecution.Status.Messages, &agentexecutionv1.AgentMessage{
		Type:    agentexecutionv1.MessageType_MESSAGE_SYSTEM,
		Content: "The workflow backing this execution is no longer running. This can happen due to infrastructure issues or manual termination. The execution has been marked as failed.",
	})

	if err := s.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, reconciledExecution); err != nil {
		log.Error().Err(err).Str("execution_id", executionID).
			Msg("Failed to reconcile stale execution status - execution will remain in WAITING_FOR_APPROVAL until next attempt")
		return
	}
	log.Info().Str("execution_id", executionID).
		Msg("RECONCILIATION: Updated stale file-review execution status to FAILED")
}

type buildFileDecisionResponseStep struct{}

func newBuildFileDecisionResponseStep() *buildFileDecisionResponseStep {
	return &buildFileDecisionResponseStep{}
}

func (s *buildFileDecisionResponseStep) Name() string { return "BuildResponse" }

func (s *buildFileDecisionResponseStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.SubmitFileDecisionInput]) error {
	input := ctx.Input()
	execution := ctx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution)

	log.Info().
		Str("execution_id", execution.GetMetadata().GetId()).
		Str("org", execution.GetMetadata().GetOrg()).
		Str("change_set_id", input.GetChangeSetId()).
		Str("file_change_id", input.GetFileChangeId()).
		Str("scope", input.GetScope().String()).
		Str("action", input.GetAction().String()).
		Msg("AUDIT: File decision submitted")

	return nil
}
