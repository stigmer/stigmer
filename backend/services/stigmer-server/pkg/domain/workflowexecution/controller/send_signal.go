package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"google.golang.org/protobuf/proto"
)

// =============================================================================
// Interface constraint for SendSignal pipeline
// =============================================================================

// SignalInput is the interface for inputs that have execution_id and signal_name
type SignalInput interface {
	proto.Message
	GetExecutionId() string
	GetSignalName() string
}

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

// buildSendSignalPipeline constructs the pipeline for send signal operations
func (c *WorkflowExecutionController) buildSendSignalPipeline() *pipeline.Pipeline[*workflowexecutionv1.SendSignalInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.SendSignalInput]("workflowexecution-send-signal").
		AddStep(NewValidateSignalInputStep[*workflowexecutionv1.SendSignalInput]()).
		AddStep(NewLoadExecutionByExecutionIdStep[*workflowexecutionv1.SendSignalInput](c.store)).
		AddStep(NewValidateSignalableStep[*workflowexecutionv1.SendSignalInput]()).
		AddStep(NewSendSignalToWorkflowStep[*workflowexecutionv1.SendSignalInput](c.workflowCreator)).
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
}

// NewSendSignalToWorkflowStep creates a new SendSignalToWorkflowStep
func NewSendSignalToWorkflowStep[T SignalInput](wc *workflows.InvokeWorkflowExecutionWorkflowCreator) *SendSignalToWorkflowStep[T] {
	return &SendSignalToWorkflowStep[T]{workflowCreator: wc}
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

	// Use SignalWithStart for race-proof delivery
	err := s.workflowCreator.SignalWithStart(ctx.Context(), execution, signalName, signalPayload)
	if err != nil {
		return grpclib.InternalError(err, "failed to send signal to workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("signal_name", signalName).
		Msg("Signal sent successfully via SignalWithStart")

	return nil
}
