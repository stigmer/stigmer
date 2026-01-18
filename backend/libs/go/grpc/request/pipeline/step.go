package pipeline

import (
	"time"

	"google.golang.org/protobuf/proto"
)

// PipelineStep represents a single step in request processing.
// Each step performs a specific operation (validation, transformation, persistence, etc.)
// and can pass data to subsequent steps via the request context.
//
// Steps must be idempotent and should not have side effects outside of the
// context unless they are persistence steps.
type PipelineStep[T proto.Message] interface {
	// Execute runs the step logic on the given request context.
	// It should return an error if the step fails, which will halt the pipeline.
	Execute(ctx *RequestContext[T]) error

	// Name returns a human-readable name for this step.
	// Used for logging, tracing, and error messages.
	Name() string
}

// StepResult represents the outcome of a step execution.
// This is used for observability and debugging.
type StepResult struct {
	// StepName is the name of the step that was executed
	StepName string

	// Success indicates whether the step completed without error
	Success bool

	// Error contains the error if the step failed, nil otherwise
	Error error

	// Duration is how long the step took to execute
	Duration time.Duration
}
