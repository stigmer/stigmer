package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe"
	wftemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	wfactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"google.golang.org/protobuf/proto"
)

// =============================================================================
// Interface constraint for SendSignal pipeline
// =============================================================================

// SignalInput is the interface for inputs that have execution_id, signal_name, and optional idempotency_key
type SignalInput interface {
	proto.Message
	GetExecutionId() string
	GetSignalName() string
	GetIdempotencyKey() string // Added for Gap B2 (Event Dedupe)
}

// =============================================================================
// Context Keys for Pipeline
// =============================================================================

// DedupeClaimedKey is the pipeline context key indicating dedupe was claimed.
// If set to true, the DedupeMarkDeliveredStep should update the record.
const DedupeClaimedKey = "dedupe_claimed"

// DedupeSkippedKey is the pipeline context key indicating dedupe was skipped.
// Set when no idempotency_key was provided (backward compatible behavior).
const DedupeSkippedKey = "dedupe_skipped"

// =============================================================================
// SendSignal RPC Handler
// =============================================================================

// SendSignal sends a signal to a running workflow execution.
//
// This RPC uses Temporal's SignalWithStart API for race-proof signal delivery.
// If the workflow hasn't started yet, it will be started first and then receive
// the signal, preventing WorkflowNotFound errors in race conditions.
//
// Pipeline Steps:
// 1. ValidateSignalInput - Check execution_id and signal_name are present
// 2. LoadExecutionByExecutionId - Load execution from database
// 3. ValidateSignalable - Ensure execution is in a signalable phase
// 4. SendSignalToWorkflow - Send signal via workflow creator's SignalWithStart
//
// Use Cases:
// - Unblocking LISTEN tasks waiting for external events
// - Delivering webhook payloads to workflows
// - Human-in-the-loop approvals from external systems
// - Integration with third-party callbacks
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is in a terminal phase
// - INVALID_ARGUMENT: execution_id or signal_name is empty
func (c *WorkflowExecutionController) SendSignal(
	ctx context.Context,
	input *workflowexecutionv1.SendSignalInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetExecutionId()).
		Str("signal_name", input.GetSignalName()).
		Msg("SendSignal workflow execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildSendSignalPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetExecutionId()).
			Str("signal_name", input.GetSignalName()).
			Err(err).
			Msg("SendSignal workflow execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after send signal pipeline")
	}

	log.Info().
		Str("execution_id", input.GetExecutionId()).
		Str("signal_name", input.GetSignalName()).
		Str("phase", execution.(*workflowexecutionv1.WorkflowExecution).GetStatus().GetPhase().String()).
		Msg("SendSignal workflow execution completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildSendSignalPipeline constructs the pipeline for send signal operations.
//
// Pipeline Steps (Gap B2 updated):
// 1. ValidateSignalInput - Check execution_id and signal_name are present
// 2. LoadExecutionByExecutionId - Load execution from database
// 3. ValidateSignalable - Ensure execution is in a signalable phase
// 4. DedupeClaimStep - Claim idempotency key (if provided) [NEW - Gap B2]
// 5. SendSignalToWorkflow - Send signal via workflow creator's SignalWithStart
// 6. DedupeMarkDeliveredStep - Mark idempotency key as delivered [NEW - Gap B2]
func (c *WorkflowExecutionController) buildSendSignalPipeline() *pipeline.Pipeline[*workflowexecutionv1.SendSignalInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.SendSignalInput]("workflowexecution-send-signal").
		AddStep(NewValidateSignalInputStep[*workflowexecutionv1.SendSignalInput]()).
		AddStep(NewLoadExecutionByExecutionIdStep[*workflowexecutionv1.SendSignalInput](c.store)).
		AddStep(NewValidateSignalableStep[*workflowexecutionv1.SendSignalInput]()).
		AddStep(NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](c.signalDedupeStore)). // Gap B2
		AddStep(NewSendSignalToWorkflowStep[*workflowexecutionv1.SendSignalInput](c.workflowCreator, c.temporalConfig)).
		AddStep(NewDedupeMarkDeliveredStep[*workflowexecutionv1.SendSignalInput](c.signalDedupeStore)). // Gap B2
		Build()
}

// =============================================================================
// Validate Signal Input Step
// =============================================================================

// ValidateSignalInputStep validates that required fields are present
type ValidateSignalInputStep[T SignalInput] struct{}

// NewValidateSignalInputStep creates a new ValidateSignalInputStep
func NewValidateSignalInputStep[T SignalInput]() *ValidateSignalInputStep[T] {
	return &ValidateSignalInputStep[T]{}
}

// Name returns the step name
func (s *ValidateSignalInputStep[T]) Name() string {
	return "ValidateSignalInput"
}

// Execute validates the input fields
func (s *ValidateSignalInputStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.NewState()

	if input.GetExecutionId() == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	if input.GetSignalName() == "" {
		return grpclib.InvalidArgumentError("signal_name is required")
	}

	log.Debug().
		Str("execution_id", input.GetExecutionId()).
		Str("signal_name", input.GetSignalName()).
		Msg("Signal input validation passed")

	return nil
}

// =============================================================================
// Load Execution By Execution ID Step
// =============================================================================

// LoadExecutionByExecutionIdStep loads a workflow execution from the database
// by execution_id (for inputs that use execution_id instead of id)
type LoadExecutionByExecutionIdStep[T SignalInput] struct {
	store store.Store
}

// NewLoadExecutionByExecutionIdStep creates a new LoadExecutionByExecutionIdStep
func NewLoadExecutionByExecutionIdStep[T SignalInput](s store.Store) *LoadExecutionByExecutionIdStep[T] {
	return &LoadExecutionByExecutionIdStep[T]{store: s}
}

// Name returns the step name
func (s *LoadExecutionByExecutionIdStep[T]) Name() string {
	return "LoadExecutionByExecutionId"
}

// Execute loads the execution by ID
func (s *LoadExecutionByExecutionIdStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.NewState()
	executionID := input.GetExecutionId()

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
		Msg("Loaded execution for signal operation")

	return nil
}

// =============================================================================
// Validate Signalable Step
// =============================================================================

// ValidateSignalableStep validates that the execution can receive signals
type ValidateSignalableStep[T SignalInput] struct{}

// NewValidateSignalableStep creates a new ValidateSignalableStep
func NewValidateSignalableStep[T SignalInput]() *ValidateSignalableStep[T] {
	return &ValidateSignalableStep[T]{}
}

// Name returns the step name
func (s *ValidateSignalableStep[T]) Name() string {
	return "ValidateSignalable"
}

// Execute validates the execution phase for signaling
func (s *ValidateSignalableStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	phase := execution.GetStatus().GetPhase()

	// Can signal to workflows in these phases:
	// - PENDING: Workflow may not have started yet (SignalWithStart handles this)
	// - IN_PROGRESS: Workflow is running and may be at a LISTEN task
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		// Valid for signaling
		log.Debug().
			Str("execution_id", execution.GetMetadata().GetId()).
			Str("phase", phase.String()).
			Msg("Execution is in signalable phase")
		return nil

	default:
		// Terminal phases cannot receive signals
		return grpclib.FailedPreconditionError(
			"cannot send signal to execution in phase %s; only PENDING or IN_PROGRESS executions can receive signals",
			phase.String(),
		)
	}
}

// =============================================================================
// Send Signal To Workflow Step
// =============================================================================

// SendSignalToWorkflowStep sends a signal to the workflow via Temporal
type SendSignalToWorkflowStep[T SignalInput] struct {
	workflowCreator *workflows.InvokeWorkflowExecutionWorkflowCreator
	temporalConfig  *wftemporal.Config
}

// NewSendSignalToWorkflowStep creates a new SendSignalToWorkflowStep
func NewSendSignalToWorkflowStep[T SignalInput](
	wc *workflows.InvokeWorkflowExecutionWorkflowCreator,
	temporalConfig *wftemporal.Config,
) *SendSignalToWorkflowStep[T] {
	return &SendSignalToWorkflowStep[T]{workflowCreator: wc, temporalConfig: temporalConfig}
}

// Name returns the step name
func (s *SendSignalToWorkflowStep[T]) Name() string {
	return "SendSignalToWorkflow"
}

// Execute sends the signal to Temporal using SignalWithStart
func (s *SendSignalToWorkflowStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if s.workflowCreator == nil {
		return grpclib.FailedPreconditionError("workflow creator is not available")
	}

	input := ctx.NewState()
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()

	// Get signal input with payload
	signalInput, ok := any(input).(*workflowexecutionv1.SendSignalInput)
	if !ok {
		return grpclib.InternalError(nil, "unexpected input type for send signal")
	}

	signalName := signalInput.GetSignalName()

	// Convert payload to map for Temporal
	var signalPayload interface{}
	if signalInput.GetPayload() != nil {
		signalPayload = signalInput.GetPayload().AsMap()
	}

	log.Info().
		Str("execution_id", executionID).
		Str("signal_name", signalName).
		Msg("Sending signal to Temporal workflow via SignalWithStart")

	// Build slim workflow input from execution.
	// OSS does not have multi-tenant identity, so invoker identity is empty.
	workflowInput := &wfactivities.InvokeWorkflowExecutionWorkflowInput{
		ExecutionID:        executionID,
		WorkflowInstanceID: execution.GetSpec().GetWorkflowInstanceId(),
		WorkflowID:         execution.GetSpec().GetWorkflowId(),
		OrgID:              execution.GetMetadata().GetOrg(),
	}

	// The signal channels for signal-receiving tasks (listen, human_input) are
	// registered in the TS child workflow, not the Go outer orchestrator. The
	// orchestrator exposes a single generic "relaySignal" handler that forwards a
	// RelaySignalPayload to the child; sending the raw user signal name straight to
	// the orchestrator leaves it buffered with no handler and the listen gate never
	// resolves. So we wrap the user's signal in the relay envelope and target the
	// "relaySignal" channel — mirroring SubmitWorkflowTaskApproval, the other
	// relay-based signal sender.
	relayPayload := workflows.RelaySignalPayload{
		SignalName: signalName,
		Payload:    signalPayload,
	}

	// Route the SignalWithStart to the same task queue the execution dispatched on
	// (sandbox/edition affinity), matching the approval path. When SignalWithStart
	// has to start the workflow first (PENDING execution), the queue must be correct.
	dispatch := wftemporal.ResolveWorkflowTaskQueue(
		executionID,
		execution.GetSpec().GetExecutionTarget(),
		s.temporalConfig,
	)

	// Use SignalWithStart for race-proof delivery (slim input keeps secrets out of history).
	err := s.workflowCreator.SignalWithStart(ctx.Context(), workflowInput, "relaySignal", relayPayload, dispatch.TaskQueue)
	if err != nil {
		return grpclib.InternalError(err, "failed to send signal to workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("signal_name", signalName).
		Msg("Signal sent successfully via SignalWithStart")

	return nil
}

// =============================================================================
// Dedupe Claim Step (Gap B2)
// =============================================================================

// DedupeClaimStep attempts to claim an idempotency key before signal delivery.
// If the key was already used, rejects the request with ALREADY_EXISTS.
// If no idempotency_key is provided, skips deduplication (backward compatible).
//
// @since Gap B2 (Event Dedupe)
type DedupeClaimStep[T SignalInput] struct {
	dedupeStore dedupe.SignalDedupeStore
}

// NewDedupeClaimStep creates a new DedupeClaimStep
func NewDedupeClaimStep[T SignalInput](dedupeStore dedupe.SignalDedupeStore) *DedupeClaimStep[T] {
	return &DedupeClaimStep[T]{dedupeStore: dedupeStore}
}

// Name returns the step name
func (s *DedupeClaimStep[T]) Name() string {
	return "DedupeClaimStep"
}

// Execute attempts to claim the idempotency key
func (s *DedupeClaimStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.NewState()
	idempotencyKey := input.GetIdempotencyKey()

	// If no idempotency key provided, skip deduplication (backward compatible)
	if idempotencyKey == "" {
		log.Debug().
			Str("execution_id", input.GetExecutionId()).
			Msg("No idempotency_key provided, skipping deduplication")
		ctx.Set(DedupeSkippedKey, true)
		return nil
	}

	// If dedupe store not available, skip (graceful degradation)
	if s.dedupeStore == nil {
		log.Warn().
			Str("execution_id", input.GetExecutionId()).
			Str("idempotency_key", idempotencyKey).
			Msg("Signal dedupe store not available, skipping deduplication")
		ctx.Set(DedupeSkippedKey, true)
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	org := execution.GetMetadata().GetOrg()
	executionID := execution.GetMetadata().GetId()
	signalName := input.GetSignalName()

	log.Debug().
		Str("execution_id", executionID).
		Str("org", org).
		Str("idempotency_key", idempotencyKey).
		Str("signal_name", signalName).
		Msg("Attempting to claim idempotency key for signal")

	// Attempt to claim the key
	result, err := s.dedupeStore.Claim(
		ctx.Context(),
		org,
		idempotencyKey,
		executionID,
		signalName,
		dedupe.DefaultSignalDedupeTTL,
	)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Str("idempotency_key", idempotencyKey).
			Msg("Failed to claim idempotency key")
		// Don't fail the request - continue without dedupe protection
		ctx.Set(DedupeSkippedKey, true)
		return nil
	}

	// Check claim result
	if result.Status == dedupe.ClaimStatusDuplicate {
		log.Info().
			Str("execution_id", executionID).
			Str("idempotency_key", idempotencyKey).
			Str("original_execution_id", result.Record.ExecutionID).
			Str("original_status", string(result.Record.Status)).
			Msg("Duplicate signal detected - rejecting with ALREADY_EXISTS")

		// Duplicates are rejected with ALREADY_EXISTS — nothing is cached or
		// replayed. Same contract as the cloud edition's DedupeClaimStep.
		return grpclib.AlreadyExistsError(
			"signal_with_idempotency_key",
			idempotencyKey,
		)
	}

	// Claim successful - mark that we need to update on completion
	log.Info().
		Str("execution_id", executionID).
		Str("idempotency_key", idempotencyKey).
		Msg("Successfully claimed idempotency key")
	ctx.Set(DedupeClaimedKey, true)

	return nil
}

// =============================================================================
// Dedupe Mark Delivered Step (Gap B2)
// =============================================================================

// DedupeMarkDeliveredStep marks an idempotency key as delivered after successful
// signal delivery. Only runs if DedupeClaimStep successfully claimed the key.
//
// @since Gap B2 (Event Dedupe)
type DedupeMarkDeliveredStep[T SignalInput] struct {
	dedupeStore dedupe.SignalDedupeStore
}

// NewDedupeMarkDeliveredStep creates a new DedupeMarkDeliveredStep
func NewDedupeMarkDeliveredStep[T SignalInput](dedupeStore dedupe.SignalDedupeStore) *DedupeMarkDeliveredStep[T] {
	return &DedupeMarkDeliveredStep[T]{dedupeStore: dedupeStore}
}

// Name returns the step name
func (s *DedupeMarkDeliveredStep[T]) Name() string {
	return "DedupeMarkDeliveredStep"
}

// Execute marks the idempotency key as delivered
func (s *DedupeMarkDeliveredStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Check if dedupe was skipped
	if skipped, ok := ctx.Get(DedupeSkippedKey).(bool); ok && skipped {
		return nil
	}

	// Check if we claimed the key
	if claimed, ok := ctx.Get(DedupeClaimedKey).(bool); !ok || !claimed {
		return nil
	}

	// If dedupe store not available, skip
	if s.dedupeStore == nil {
		return nil
	}

	input := ctx.NewState()
	idempotencyKey := input.GetIdempotencyKey()
	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	org := execution.GetMetadata().GetOrg()

	log.Debug().
		Str("execution_id", execution.GetMetadata().GetId()).
		Str("org", org).
		Str("idempotency_key", idempotencyKey).
		Msg("Marking idempotency key as delivered")

	err := s.dedupeStore.MarkDelivered(ctx.Context(), org, idempotencyKey)
	if err != nil {
		// Log but don't fail - the signal was already delivered
		log.Warn().
			Err(err).
			Str("execution_id", execution.GetMetadata().GetId()).
			Str("idempotency_key", idempotencyKey).
			Msg("Failed to mark idempotency key as delivered (signal was sent)")
	} else {
		log.Info().
			Str("execution_id", execution.GetMetadata().GetId()).
			Str("idempotency_key", idempotencyKey).
			Msg("Marked idempotency key as delivered")
	}

	return nil
}
