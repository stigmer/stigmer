package workflowexecution

import (
	"fmt"
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
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/proto"
)

// Context keys for lifecycle pipeline steps
const (
	// LoadedExecutionKey stores the loaded WorkflowExecution in the pipeline context
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

// LoadExecutionByIdStep loads a workflow execution from the database by ID
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
	execution := &workflowexecutionv1.WorkflowExecution{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution)
	if err != nil {
		log.Debug().Str("execution_id", executionID).Err(err).Msg("Execution not found")
		return grpclib.NotFoundError("workflow_execution", executionID)
	}

	// Store execution in pipeline context
	ctx.Set(LoadedExecutionKey, execution)

	log.Debug().
		Str("execution_id", executionID).
		Int32("phase", int32(execution.GetStatus().GetPhase())).
		Msg("Loaded execution for lifecycle operation")

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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already cancelled is success
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already cancelled, returning success (idempotent)")
		// Set a flag to skip Temporal call
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only cancel PENDING, IN_PROGRESS, or PAUSED
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
		return grpclib.FailedPreconditionError(
			"cannot cancel execution in phase %s; only PENDING, IN_PROGRESS, or PAUSED can be cancelled",
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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already terminated is success
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already terminated, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only terminate PENDING, IN_PROGRESS, or PAUSED
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
		return grpclib.FailedPreconditionError(
			"cannot terminate execution in phase %s; only PENDING, IN_PROGRESS, or PAUSED can be terminated",
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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: If already IN_PROGRESS (from previous recover), success
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already in progress, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only recover FAILED executions
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: Already paused is success
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already paused, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only pause PENDING or IN_PROGRESS
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Idempotency: If already IN_PROGRESS (from previous resume), success
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Msg("Execution already in progress, returning success (idempotent)")
		ctx.Set("alreadyInTargetState", true)
		return nil
	}

	// Can only resume PAUSED executions
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()
	reason := input.GetReason()

	if reason == "" {
		reason = "Paused by user"
	}

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Str("reason", reason).
		Msg("Sending pause signal to Temporal workflow")

	// Send pause signal to workflow
	err := s.temporalClient.SignalWorkflow(ctx.Context(), workflowID, "", "pause", reason)
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

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Sending resume signal to Temporal workflow")

	// Send resume signal to workflow (empty payload)
	err := s.temporalClient.SignalWorkflow(ctx.Context(), workflowID, "", "resume", nil)
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

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

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
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()
	reason := input.GetReason()

	if reason == "" {
		reason = "Terminated by user"
	}

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

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
// Terminate Existing Temporal Workflow Step (for Recover)
// =============================================================================

// TerminateExistingWorkflowStep terminates the existing Temporal orchestrator
// workflow before starting a fresh one. The previous workflow may be stuck in a
// Workflow-Task-Failed loop (caused by RECORD_MARKER replay bugs). Termination
// is synchronous and prevents the old workflow's cleanup from interfering with
// the new ExecutionContext.
//
// Handles NOT_FOUND gracefully (workflow already completed/terminated).
type TerminateExistingWorkflowStep[T LifecycleInputWithReason] struct {
	temporalClient client.Client
}

// NewTerminateExistingWorkflowStep creates a new TerminateExistingWorkflowStep
func NewTerminateExistingWorkflowStep[T LifecycleInputWithReason](tc client.Client) *TerminateExistingWorkflowStep[T] {
	return &TerminateExistingWorkflowStep[T]{temporalClient: tc}
}

func (s *TerminateExistingWorkflowStep[T]) Name() string {
	return "TerminateExistingWorkflow"
}

func (s *TerminateExistingWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.temporalClient == nil {
		return grpclib.FailedPreconditionError("Temporal is not available")
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Terminating existing Temporal workflow before recovery")

	err := s.temporalClient.TerminateWorkflow(ctx.Context(), workflowID, "",
		"Recovery: terminating before fresh workflow start")
	if err != nil {
		if _, ok := err.(*serviceerror.NotFound); ok {
			log.Info().
				Str("execution_id", executionID).
				Str("workflow_id", workflowID).
				Msg("Temporal workflow already completed/terminated (NOT_FOUND). Proceeding with recovery.")
			return nil
		}
		return grpclib.InternalError(err, "failed to terminate existing Temporal workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Msg("Successfully terminated existing Temporal workflow")

	return nil
}

// =============================================================================
// Start Fresh Temporal Workflow Step (for Recover)
// =============================================================================

// StartFreshWorkflowStep starts a brand-new Temporal orchestrator workflow for
// the recovered execution. Reuses InvokeWorkflowExecutionWorkflowCreator — the
// same path used by the original create pipeline. Temporal allows workflow ID
// reuse after the previous run was terminated (ALLOW_DUPLICATE policy).
type StartFreshWorkflowStep[T LifecycleInput] struct {
	workflowCreator *workflows.InvokeWorkflowExecutionWorkflowCreator
	temporalConfig  *wftemporal.Config
}

// NewStartFreshWorkflowStep creates a new StartFreshWorkflowStep
func NewStartFreshWorkflowStep[T LifecycleInput](
	creator *workflows.InvokeWorkflowExecutionWorkflowCreator,
	config *wftemporal.Config,
) *StartFreshWorkflowStep[T] {
	return &StartFreshWorkflowStep[T]{
		workflowCreator: creator,
		temporalConfig:  config,
	}
}

func (s *StartFreshWorkflowStep[T]) Name() string {
	return "StartFreshWorkflow"
}

func (s *StartFreshWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.workflowCreator == nil {
		return grpclib.FailedPreconditionError("Temporal is not available (workflow creator not set)")
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	dispatch := wftemporal.ResolveWorkflowTaskQueue(
		executionID,
		execution.GetSpec().GetExecutionTarget(),
		s.temporalConfig,
	)

	workflowInput := &wfactivities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        executionID,
		WorkflowInstanceID: execution.GetSpec().GetWorkflowInstanceId(),
		WorkflowID:         execution.GetSpec().GetWorkflowId(),
		OrgID:              execution.GetMetadata().GetOrg(),
	}

	if err := s.workflowCreator.Create(ctx.Context(), workflowInput, dispatch.TaskQueue); err != nil {
		return grpclib.InternalError(err, "failed to start fresh Temporal workflow for recovered execution")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("task_queue", dispatch.TaskQueue).
		Msg("Started fresh Temporal workflow for recovered execution")

	return nil
}

// =============================================================================
// Update Execution Phase Step
// =============================================================================

// UpdateExecutionPhaseStep updates the execution phase and timestamps
type UpdateExecutionPhaseStep[T LifecycleInput] struct {
	targetPhase workflowexecutionv1.ExecutionPhase
	setError    bool // Whether to set error field (for terminate)
	clearError  bool // Whether to clear error field (for recover)
}

// NewUpdateExecutionPhaseStep creates a new UpdateExecutionPhaseStep
func NewUpdateExecutionPhaseStep[T LifecycleInput](
	targetPhase workflowexecutionv1.ExecutionPhase,
	setError bool,
	clearError bool,
) *UpdateExecutionPhaseStep[T] {
	return &UpdateExecutionPhaseStep[T]{
		targetPhase: targetPhase,
		setError:    setError,
		clearError:  clearError,
	}
}

// Name returns the step name
func (s *UpdateExecutionPhaseStep[T]) Name() string {
	return "UpdateExecutionPhase"
}

// Execute updates the execution phase
func (s *UpdateExecutionPhaseStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)

	// Ensure status exists
	if execution.Status == nil {
		execution.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}

	// Update phase
	execution.Status.Phase = s.targetPhase

	// Set completed_at for terminal phases (RFC3339 format)
	// Note: PAUSED is NOT terminal, so we don't set completed_at for it
	if s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
		s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
		execution.Status.CompletedAt = time.Now().Format(time.RFC3339)
	}

	// Clear completed_at for recovery (back to IN_PROGRESS) or resume from PAUSED
	if s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		execution.Status.CompletedAt = ""
	}

	// PAUSED phase: don't set completed_at (execution is not finished, can be resumed)
	// No action needed - just leave completed_at as-is (should be empty)

	// Set error for terminate
	if s.setError {
		reason := ctx.Get(ReasonKey)
		if reason != nil {
			execution.Status.Error = fmt.Sprintf("Terminated: %s", reason.(string))
		} else {
			execution.Status.Error = "Terminated by user"
		}
	}

	// Clear error for recover
	if s.clearError {
		execution.Status.Error = ""
	}

	log.Debug().
		Str("execution_id", execution.GetMetadata().GetId()).
		Str("phase", s.targetPhase.String()).
		Msg("Updated execution phase")

	return nil
}

// =============================================================================
// Lifecycle Persist Step (named to avoid conflict with PersistExecutionStep in update_status.go)
// =============================================================================

// LifecyclePersistStep saves the execution to the database
type LifecyclePersistStep[T LifecycleInput] struct {
	store store.Store
}

// NewLifecyclePersistStep creates a new LifecyclePersistStep
func NewLifecyclePersistStep[T LifecycleInput](s store.Store) *LifecyclePersistStep[T] {
	return &LifecyclePersistStep[T]{store: s}
}

// Name returns the step name
func (s *LifecyclePersistStep[T]) Name() string {
	return "LifecyclePersist"
}

// Execute saves the execution to the database
func (s *LifecyclePersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Skip if already in target state
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	err := s.store.SaveResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_workflow_execution,
		executionID,
		execution,
	)
	if err != nil {
		return grpclib.InternalError(err, "failed to persist execution")
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Persisted execution to database")

	return nil
}

// =============================================================================
// Lifecycle Broadcast Step (named to avoid conflict)
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

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)

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
