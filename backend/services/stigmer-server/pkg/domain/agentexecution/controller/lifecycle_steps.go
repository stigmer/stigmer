package agentexecution

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/proto"
)

// Context keys for lifecycle pipeline steps
const (
	// LoadedExecutionKey stores the loaded AgentExecution in the pipeline context
	LoadedExecutionKey = "loadedExecution"

	// TemporalClientKey stores the Temporal client in the pipeline context
	TemporalClientKey = "temporalClient"

	// StreamBrokerKey stores the StreamBroker in the pipeline context
	StreamBrokerKey = "streamBroker"

	// StoreKey stores the store in the pipeline context
	StoreKey = "store"

	// TargetPhaseKey stores the target phase for the operation
	TargetPhaseKey = "targetPhase"

	// ReasonKey stores the reason for the operation
	ReasonKey = "reason"
)

// =============================================================================
// Interface constraints for lifecycle pipeline steps
// =============================================================================

// LifecycleInput is an interface for input types that have an ID field
// and satisfy proto.Message requirements for pipeline compatibility.
type LifecycleInput interface {
	proto.Message
	GetId() string
}

// LifecycleInputWithReason extends LifecycleInput with a Reason field
type LifecycleInputWithReason interface {
	LifecycleInput
	GetReason() string
}

// =============================================================================
// Load Execution By ID Step
// =============================================================================

// LoadExecutionByIdStep loads an agent execution from the database by ID
type LoadExecutionByIdStep[T LifecycleInput] struct {
	store store.Store
}

// NewLoadExecutionByIdStep creates a new LoadExecutionByIdStep
func NewLoadExecutionByIdStep[T LifecycleInput](s store.Store) *LoadExecutionByIdStep[T] {
	return &LoadExecutionByIdStep[T]{store: s}
}

// Name returns the step name
func (s *LoadExecutionByIdStep[T]) Name() string {
	return "LoadExecutionById"
}

// Execute loads the execution by ID
func (s *LoadExecutionByIdStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.NewState()
	executionID := input.GetId()

	if executionID == "" {
		return grpclib.InvalidArgumentError("execution id is required")
	}

	// Load execution from database
	execution := &agentexecutionv1.AgentExecution{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, execution)
	if err != nil {
		log.Debug().Str("execution_id", executionID).Err(err).Msg("Execution not found")
		return grpclib.NotFoundError("agent_execution", executionID)
	}

	// Store execution in pipeline context
	ctx.Set(LoadedExecutionKey, execution)

	log.Debug().
		Str("execution_id", executionID).
		Int32("phase", int32(execution.GetStatus().GetPhase())).
		Msg("Loaded agent execution for lifecycle operation")

	return nil
}

// =============================================================================
// Validate Cancellable Step
// =============================================================================

// ValidateCancellableStep validates that the execution can be cancelled
type ValidateCancellableStep[T LifecycleInput] struct{}

// NewValidateCancellableStep creates a new ValidateCancellableStep
func NewValidateCancellableStep[T LifecycleInput]() *ValidateCancellableStep[T] {
	return &ValidateCancellableStep[T]{}
}

// Name returns the step name
func (s *ValidateCancellableStep[T]) Name() string {
	return "ValidateCancellable"
}

// Execute validates the execution phase for cancellation
func (s *ValidateCancellableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already cancelled is success
	if phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already cancelled, returning success (idempotent)")
		// Set a flag to skip Temporal call
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only cancel PENDING or IN_PROGRESS
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		return grpclib.FailedPreconditionError(
			"cannot cancel execution in phase %s; only PENDING or IN_PROGRESS can be cancelled",
			phase.String(),
		)
	}

	return nil
}

// =============================================================================
// Validate Terminable Step
// =============================================================================

// ValidateTerminableStep validates that the execution can be terminated
type ValidateTerminableStep[T LifecycleInput] struct{}

// NewValidateTerminableStep creates a new ValidateTerminableStep
func NewValidateTerminableStep[T LifecycleInput]() *ValidateTerminableStep[T] {
	return &ValidateTerminableStep[T]{}
}

// Name returns the step name
func (s *ValidateTerminableStep[T]) Name() string {
	return "ValidateTerminable"
}

// Execute validates the execution phase for termination
func (s *ValidateTerminableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already terminated is success
	if phase == agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already terminated, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only terminate PENDING or IN_PROGRESS
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		return grpclib.FailedPreconditionError(
			"cannot terminate execution in phase %s; only PENDING or IN_PROGRESS can be terminated",
			phase.String(),
		)
	}

	return nil
}

// =============================================================================
// Validate Recoverable Step
// =============================================================================

// ValidateRecoverableStep validates that the execution can be recovered
type ValidateRecoverableStep[T LifecycleInput] struct{}

// NewValidateRecoverableStep creates a new ValidateRecoverableStep
func NewValidateRecoverableStep[T LifecycleInput]() *ValidateRecoverableStep[T] {
	return &ValidateRecoverableStep[T]{}
}

// Name returns the step name
func (s *ValidateRecoverableStep[T]) Name() string {
	return "ValidateRecoverable"
}

// Execute validates the execution phase for recovery
func (s *ValidateRecoverableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: If already IN_PROGRESS (from previous recover), success
	if phase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already in progress, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only recover FAILED executions
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		return grpclib.FailedPreconditionError(
			"cannot recover execution in phase %s; only FAILED executions can be recovered",
			phase.String(),
		)
	}

	return nil
}

// =============================================================================
// Validate Pausable Step
// =============================================================================

// ValidatePausableStep validates that the execution can be paused
type ValidatePausableStep[T LifecycleInput] struct{}

// NewValidatePausableStep creates a new ValidatePausableStep
func NewValidatePausableStep[T LifecycleInput]() *ValidatePausableStep[T] {
	return &ValidatePausableStep[T]{}
}

// Name returns the step name
func (s *ValidatePausableStep[T]) Name() string {
	return "ValidatePausable"
}

// Execute validates the execution phase for pausing
func (s *ValidatePausableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already paused is success
	if phase == agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already paused, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only pause PENDING or IN_PROGRESS
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		return grpclib.FailedPreconditionError(
			"cannot pause execution in phase %s; only PENDING or IN_PROGRESS can be paused",
			phase.String(),
		)
	}

	return nil
}

// =============================================================================
// Validate Resumable Step
// =============================================================================

// ValidateResumableStep validates that the execution can be resumed
type ValidateResumableStep[T LifecycleInput] struct{}

// NewValidateResumableStep creates a new ValidateResumableStep
func NewValidateResumableStep[T LifecycleInput]() *ValidateResumableStep[T] {
	return &ValidateResumableStep[T]{}
}

// Name returns the step name
func (s *ValidateResumableStep[T]) Name() string {
	return "ValidateResumable"
}

// Execute validates the execution phase for resuming
func (s *ValidateResumableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: If already IN_PROGRESS (from previous resume), success
	if phase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already in progress, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only resume PAUSED executions
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
		return grpclib.FailedPreconditionError(
			"cannot resume execution in phase %s; only PAUSED executions can be resumed",
			phase.String(),
		)
	}

	return nil
}

// =============================================================================
// Signal Pause To Temporal Step
// =============================================================================

// SignalPauseToTemporalStep sends a pause signal to the Temporal workflow
type SignalPauseToTemporalStep[T LifecycleInputWithReason] struct {
	temporalClient client.Client
}

// NewSignalPauseToTemporalStep creates a new SignalPauseToTemporalStep
func NewSignalPauseToTemporalStep[T LifecycleInputWithReason](tc client.Client) *SignalPauseToTemporalStep[T] {
	return &SignalPauseToTemporalStep[T]{temporalClient: tc}
}

// Name returns the step name
func (s *SignalPauseToTemporalStep[T]) Name() string {
	return "SignalPauseToTemporal"
}

// Execute sends a pause signal to the Temporal workflow
func (s *SignalPauseToTemporalStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	input := ctx.NewState()
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()
	reason := input.GetReason()

	if reason == "" {
		reason = "Paused by user"
	}

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Str("reason", reason).
		Msg("Sending pause signal to Temporal workflow")

	// Send pause signal to workflow
	err := s.temporalClient.SignalWorkflow(ctx.Context(), workflowID, "", workflows.SignalPause, reason)
	if err != nil {
		// Handle workflow not found (already completed/terminated)
		if _, ok := err.(*serviceerror.NotFound); ok {
			log.Warn().
				Str("execution_id", executionID).
				Str("workflow_id", workflowID).
				Msg("Temporal workflow not found, may have already completed")
			// Continue anyway - update local state
			return nil
		}
		return grpclib.InternalError(err, "failed to send pause signal to Temporal workflow")
	}

	// Store reason for audit purposes
	ctx.Set(ReasonKey, reason)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Pause signal sent to Temporal workflow")

	return nil
}

// =============================================================================
// Signal Resume To Temporal Step
// =============================================================================

// SignalResumeToTemporalStep sends a resume signal to the Temporal workflow
type SignalResumeToTemporalStep[T LifecycleInput] struct {
	temporalClient client.Client
}

// NewSignalResumeToTemporalStep creates a new SignalResumeToTemporalStep
func NewSignalResumeToTemporalStep[T LifecycleInput](tc client.Client) *SignalResumeToTemporalStep[T] {
	return &SignalResumeToTemporalStep[T]{temporalClient: tc}
}

// Name returns the step name
func (s *SignalResumeToTemporalStep[T]) Name() string {
	return "SignalResumeToTemporal"
}

// Execute sends a resume signal to the Temporal workflow
func (s *SignalResumeToTemporalStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Sending resume signal to Temporal workflow")

	// Send resume signal to workflow (empty payload)
	err := s.temporalClient.SignalWorkflow(ctx.Context(), workflowID, "", workflows.SignalResume, nil)
	if err != nil {
		// Handle workflow not found (already completed/terminated)
		if _, ok := err.(*serviceerror.NotFound); ok {
			log.Warn().
				Str("execution_id", executionID).
				Str("workflow_id", workflowID).
				Msg("Temporal workflow not found, may have already completed")
			// Continue anyway - update local state
			return nil
		}
		return grpclib.InternalError(err, "failed to send resume signal to Temporal workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Resume signal sent to Temporal workflow")

	return nil
}

// =============================================================================
// Cancel Temporal Workflow Step
// =============================================================================

// CancelTemporalWorkflowStep cancels the workflow in Temporal
type CancelTemporalWorkflowStep[T LifecycleInput] struct {
	temporalClient client.Client
}

// NewCancelTemporalWorkflowStep creates a new CancelTemporalWorkflowStep
func NewCancelTemporalWorkflowStep[T LifecycleInput](tc client.Client) *CancelTemporalWorkflowStep[T] {
	return &CancelTemporalWorkflowStep[T]{temporalClient: tc}
}

// Name returns the step name
func (s *CancelTemporalWorkflowStep[T]) Name() string {
	return "CancelTemporalWorkflow"
}

// Execute cancels the workflow in Temporal
func (s *CancelTemporalWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Cancelling Temporal workflow")

	// Cancel the workflow (empty run ID = latest run)
	err := s.temporalClient.CancelWorkflow(ctx.Context(), workflowID, "")
	if err != nil {
		// Handle workflow not found (already completed/terminated)
		if _, ok := err.(*serviceerror.NotFound); ok {
			log.Warn().
				Str("execution_id", executionID).
				Str("workflow_id", workflowID).
				Msg("Temporal workflow not found, may have already completed")
			// Continue anyway - update local state
			return nil
		}
		return grpclib.InternalError(err, "failed to cancel Temporal workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Temporal workflow cancellation signal sent")

	return nil
}

// =============================================================================
// Terminate Temporal Workflow Step
// =============================================================================

// TerminateTemporalWorkflowStep terminates the workflow in Temporal
type TerminateTemporalWorkflowStep[T LifecycleInputWithReason] struct {
	temporalClient client.Client
}

// NewTerminateTemporalWorkflowStep creates a new TerminateTemporalWorkflowStep
func NewTerminateTemporalWorkflowStep[T LifecycleInputWithReason](tc client.Client) *TerminateTemporalWorkflowStep[T] {
	return &TerminateTemporalWorkflowStep[T]{temporalClient: tc}
}

// Name returns the step name
func (s *TerminateTemporalWorkflowStep[T]) Name() string {
	return "TerminateTemporalWorkflow"
}

// Execute terminates the workflow in Temporal
func (s *TerminateTemporalWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	input := ctx.NewState()
	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()
	reason := input.GetReason()

	if reason == "" {
		reason = "Terminated by user"
	}

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Str("reason", reason).
		Msg("Terminating Temporal workflow")

	// Terminate the workflow (empty run ID = latest run)
	err := s.temporalClient.TerminateWorkflow(ctx.Context(), workflowID, "", reason)
	if err != nil {
		// Handle workflow not found (already completed/terminated)
		if _, ok := err.(*serviceerror.NotFound); ok {
			log.Warn().
				Str("execution_id", executionID).
				Str("workflow_id", workflowID).
				Msg("Temporal workflow not found, may have already completed")
			// Continue anyway - update local state
			return nil
		}
		return grpclib.InternalError(err, "failed to terminate Temporal workflow")
	}

	// Store reason for later use in phase update
	ctx.Set(ReasonKey, reason)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Temporal workflow terminated")

	return nil
}

// =============================================================================
// Reset Temporal Workflow Step (for Recover)
// =============================================================================

// ResetTemporalWorkflowStep resets a failed workflow to its last checkpoint
type ResetTemporalWorkflowStep[T LifecycleInput] struct {
	temporalClient client.Client
	namespace      string
}

// NewResetTemporalWorkflowStep creates a new ResetTemporalWorkflowStep
func NewResetTemporalWorkflowStep[T LifecycleInput](tc client.Client, namespace string) *ResetTemporalWorkflowStep[T] {
	return &ResetTemporalWorkflowStep[T]{
		temporalClient: tc,
		namespace:      namespace,
	}
}

// Name returns the step name
func (s *ResetTemporalWorkflowStep[T]) Name() string {
	return "ResetTemporalWorkflow"
}

// Execute resets the workflow in Temporal
func (s *ResetTemporalWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Resetting Temporal workflow")

	// Get the workflow service for lower-level operations
	workflowService := s.temporalClient.WorkflowService()

	// 1. Get workflow history to find reset point
	historyResp, err := workflowService.GetWorkflowExecutionHistory(ctx.Context(), &workflowservice.GetWorkflowExecutionHistoryRequest{
		Namespace: s.namespace,
		Execution: &commonpb.WorkflowExecution{
			WorkflowId: workflowID,
		},
	})
	if err != nil {
		if _, ok := err.(*serviceerror.NotFound); ok {
			return grpclib.NotFoundError("temporal_workflow", workflowID)
		}
		return grpclib.InternalError(err, "failed to get workflow history")
	}

	// 2. Find the last WorkflowTaskCompleted event (reset point)
	var resetEventId int64 = 0
	for _, event := range historyResp.History.Events {
		if event.EventType == enums.EVENT_TYPE_WORKFLOW_TASK_COMPLETED {
			resetEventId = event.EventId
		}
	}

	if resetEventId == 0 {
		return grpclib.FailedPreconditionError(
			"no reset point found in workflow history; workflow may not have started executing",
		)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Int64("reset_event_id", resetEventId).
		Msg("Found reset point in workflow history")

	// 3. Reset the workflow. Temporal requires a RequestId for idempotent dedupe of
	// the reset; without it the service rejects the call with "RequestId is not set
	// on request". A fresh UUID per recover attempt is the intended semantics (each
	// recover is a distinct reset).
	_, err = workflowService.ResetWorkflowExecution(ctx.Context(), &workflowservice.ResetWorkflowExecutionRequest{
		Namespace: s.namespace,
		WorkflowExecution: &commonpb.WorkflowExecution{
			WorkflowId: workflowID,
		},
		WorkflowTaskFinishEventId: resetEventId,
		Reason:                    "Recovered by user",
		RequestId:                 uuid.NewString(),
	})
	if err != nil {
		if _, ok := err.(*serviceerror.NotFound); ok {
			return grpclib.NotFoundError("temporal_workflow", workflowID)
		}
		return grpclib.InternalError(err, "failed to reset workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Int64("reset_event_id", resetEventId).
		Msg("Temporal workflow reset successfully")

	return nil
}

// =============================================================================
// Update Execution Phase And Persist Step
// =============================================================================

// applyLifecyclePhaseTransition applies a lifecycle phase transition to execution
// in place: it sets the target phase plus the phase-dependent fields (completed_at,
// error, the terminal sub-agent cascade, and the terminal pending_approvals clear).
//
// It is the body run inside the UpdateExecutionPhaseAndPersistStep's
// store.UpdateResource closure (and exercised directly by the lifecycle unit
// tests), so execution carries the freshly-loaded, locked state — the transition
// is computed against the very snapshot that will be persisted. This mirrors the
// applyUpdateStatusMerge discipline on the UpdateStatus path; lifecycle is simply
// a writer that authors no approval events, so it never touches the
// approval_event_stream and the projection is left as-is for non-terminal phases.
//
// reason is only consulted when setError is true (terminate); callers pass the
// resolved audit reason from the pipeline context.
func applyLifecyclePhaseTransition(
	execution *agentexecutionv1.AgentExecution,
	targetPhase agentexecutionv1.ExecutionPhase,
	setError bool,
	clearError bool,
	reason string,
) {
	// Ensure status exists
	if execution.Status == nil {
		execution.Status = &agentexecutionv1.AgentExecutionStatus{}
	}

	// Update phase
	execution.Status.Phase = targetPhase

	// Set completed_at for terminal phases (RFC3339 format)
	// Note: PAUSED is NOT terminal, so we don't set completed_at for it
	if targetPhase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
		targetPhase == agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
		now := time.Now().Format(time.RFC3339)
		execution.Status.CompletedAt = now

		// Cascade the terminal transition to in-flight sub-agents. A cancelled
		// or terminated parent leaves no live delegation, so any IN_PROGRESS or
		// PENDING sub-agent must move to CANCELLED — otherwise the final
		// snapshot shows a permanent "Running" zombie sub-agent. This is the
		// authoritative place to do it: the runner's own cancellation persist
		// is best-effort and can be lost to the cancellation race.
		cancelInProgressSubAgents(execution.GetStatus().GetSubAgentExecutions(), now)

		// A terminal execution has no actionable approvals (the workflow that
		// would resume a gated call is gone), so it must never carry
		// pending_approvals. This blind clear bypasses the phase-aware
		// projection seam (approval.ProjectPendingApprovals); the graceful-cancel
		// case is also cleared later by the workflow cleanup running the seam, but
		// clearing here keeps the invariant on the bypass paths too,
		// edition-consistently with the Cloud terminal handlers.
		execution.Status.PendingApprovals = nil
	}

	// Clear completed_at for recovery (back to IN_PROGRESS) or resume from PAUSED
	if targetPhase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		execution.Status.CompletedAt = ""
	}

	// PAUSED phase: don't set completed_at (execution is not finished, can be resumed)
	// No action needed - just leave completed_at as-is (should be empty)

	// Set error for terminate
	if setError {
		if reason != "" {
			execution.Status.Error = fmt.Sprintf("Terminated: %s", reason)
		} else {
			execution.Status.Error = "Terminated by user"
		}
	}

	// Clear error for recover
	if clearError {
		execution.Status.Error = ""
	}
}

// UpdateExecutionPhaseAndPersistStep applies a lifecycle phase transition and
// persists it in a single atomic read-modify-write under the store's per-resource
// write lock (store.UpdateResource), shared by cancel/terminate/pause/resume/
// recover.
//
// Doing the mutation and the save as one atomic unit — rather than a mutate step
// followed by a separate whole-resource save — is what keeps the append-only
// approval_event_stream correct by construction now that it is the source of truth
// for pending_approvals: an approval event a concurrent SubmitApproval appends in
// the window between the load and the write can never be lost to a stale-read
// overwrite. (pause/cancel/terminate are all reachable from
// WAITING_FOR_APPROVAL, so that window is real.) This is the lifecycle counterpart
// of the UpdateStatus MergeAndPersistExecutionStep; lifecycle simply authors no
// new approval events.
type UpdateExecutionPhaseAndPersistStep[T LifecycleInput] struct {
	store       store.Store
	targetPhase agentexecutionv1.ExecutionPhase
	setError    bool // Whether to set error field (for terminate)
	clearError  bool // Whether to clear error field (for recover)
}

// NewUpdateExecutionPhaseAndPersistStep creates a new UpdateExecutionPhaseAndPersistStep
func NewUpdateExecutionPhaseAndPersistStep[T LifecycleInput](
	s store.Store,
	targetPhase agentexecutionv1.ExecutionPhase,
	setError bool,
	clearError bool,
) *UpdateExecutionPhaseAndPersistStep[T] {
	return &UpdateExecutionPhaseAndPersistStep[T]{
		store:       s,
		targetPhase: targetPhase,
		setError:    setError,
		clearError:  clearError,
	}
}

// Name returns the step name
func (s *UpdateExecutionPhaseAndPersistStep[T]) Name() string {
	return "UpdateExecutionPhaseAndPersist"
}

// Execute applies the phase transition and persists it atomically.
func (s *UpdateExecutionPhaseAndPersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state (no transition, nothing to persist)
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	// Resolve the audit reason recorded by the Temporal signal/terminate steps;
	// only consulted when setError is true.
	reason := ""
	if r := ctx.Get(ReasonKey); r != nil {
		reason, _ = r.(string)
	}

	// Atomic read-modify-write under the store's per-resource write lock. The
	// transition is applied to the freshly-loaded resource INSIDE the closure, so
	// it cannot clobber an approval_event_stream event a concurrent SubmitApproval
	// appended between the earlier load step and this persist. Unlike the prior
	// non-atomic load-then-SaveResource, UpdateResource requires the resource to
	// exist (no upsert), so a lifecycle op racing a delete returns NOT_FOUND
	// rather than resurrecting a half-built document.
	updated := &agentexecutionv1.AgentExecution{}
	err := s.store.UpdateResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		updated,
		func() error {
			applyLifecyclePhaseTransition(updated, s.targetPhase, s.setError, s.clearError, reason)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("agent_execution", executionID)
		}
		return grpclib.InternalError(err, "failed to persist execution")
	}

	// Hand the persisted result to the broadcast step and the handler's return
	// value (both read LoadedExecutionKey).
	ctx.Set(LoadedExecutionKey, updated)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", s.targetPhase.String()).
		Msg("Applied lifecycle phase transition and persisted execution")

	return nil
}

// =============================================================================
// Lifecycle Broadcast Step
// =============================================================================

// LifecycleBroadcastStep publishes the execution update via StreamBroker
type LifecycleBroadcastStep[T LifecycleInput] struct {
	streamBroker *StreamBroker
}

// NewLifecycleBroadcastStep creates a new LifecycleBroadcastStep
func NewLifecycleBroadcastStep[T LifecycleInput](sb *StreamBroker) *LifecycleBroadcastStep[T] {
	return &LifecycleBroadcastStep[T]{streamBroker: sb}
}

// Name returns the step name
func (s *LifecycleBroadcastStep[T]) Name() string {
	return "LifecycleBroadcast"
}

// Execute broadcasts the execution update
func (s *LifecycleBroadcastStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state (no change to broadcast)
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.streamBroker == nil {
		// Graceful degradation - no streaming available
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)

	// Broadcast update to subscribers
	s.streamBroker.Broadcast(execution)

	log.Debug().
		Str("execution_id", execution.GetMetadata().GetId()).
		Str("phase", execution.GetStatus().GetPhase().String()).
		Msg("Broadcast execution update to subscribers")

	return nil
}

// =============================================================================
// Utility function to get namespace from config
// =============================================================================

// GetTemporalNamespace returns the Temporal namespace from environment or default
func GetTemporalNamespace() string {
	// This would typically come from config, but for now use default
	return "default"
}

// cancelInProgressSubAgents transitions any non-terminal sub-agent (IN_PROGRESS
// or PENDING) to CANCELLED with a completion timestamp, in place. Used when a
// parent execution reaches a terminal cancellation/termination phase so no
// sub-agent is left permanently "Running". completedAt is only set when empty,
// preserving any timestamp the runner already recorded.
func cancelInProgressSubAgents(subAgents []*agentexecutionv1.SubAgentExecution, completedAt string) {
	for _, sa := range subAgents {
		if sa == nil {
			continue
		}
		if sa.GetStatus() == agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS ||
			sa.GetStatus() == agentexecutionv1.SubAgentStatus_SUB_AGENT_PENDING {
			sa.Status = agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED
			if sa.GetCompletedAt() == "" {
				sa.CompletedAt = completedAt
			}
		}
	}
}
