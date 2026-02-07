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
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/api/workflowservice/v1"
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

	// Can only cancel PENDING or IN_PROGRESS
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
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

	// Can only terminate PENDING or IN_PROGRESS
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING &&
		phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
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
// Reset Temporal Workflow Step (for Recover)
// =============================================================================

// ResetTemporalWorkflowStep resets a failed workflow to its last checkpoint
type ResetTemporalWorkflowStep[T LifecycleInputWithReason] struct {
	temporalClient client.Client
	namespace      string
}

// NewResetTemporalWorkflowStep creates a new ResetTemporalWorkflowStep
func NewResetTemporalWorkflowStep[T LifecycleInputWithReason](tc client.Client, namespace string) *ResetTemporalWorkflowStep[T] {
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

	input := ctx.NewState()
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()
	reason := input.GetReason()

	if reason == "" {
		reason = "Recovered by user"
	}

	// Build Temporal workflow ID
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_id", workflowID).
		Str("reason", reason).
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

	// 3. Reset the workflow
	_, err = workflowService.ResetWorkflowExecution(ctx.Context(), &workflowservice.ResetWorkflowExecutionRequest{
		Namespace: s.namespace,
		WorkflowExecution: &commonpb.WorkflowExecution{
			WorkflowId: workflowID,
		},
		WorkflowTaskFinishEventId: resetEventId,
		Reason:                    reason,
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
	if s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
		s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
		execution.Status.CompletedAt = time.Now().Format(time.RFC3339)
	}

	// Clear completed_at for recovery (back to IN_PROGRESS)
	if s.targetPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		execution.Status.CompletedAt = ""
	}

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
