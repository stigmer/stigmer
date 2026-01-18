package pipeline

import (
	"fmt"
	"log"
	"time"

	"github.com/stigmer/stigmer/backend/libs/go/telemetry"
	"google.golang.org/protobuf/proto"
)

// Pipeline executes a sequence of steps on a request.
// Each step is executed in order, and execution stops on the first error.
type Pipeline[T proto.Message] struct {
	// name is a human-readable identifier for this pipeline
	name string

	// steps are the operations to execute in order
	steps []PipelineStep[T]

	// tracer creates spans for distributed tracing
	tracer telemetry.Tracer
}

// PipelineBuilder provides a fluent API for constructing pipelines.
type PipelineBuilder[T proto.Message] struct {
	pipeline *Pipeline[T]
}

// NewPipeline creates a new pipeline builder with the given name.
func NewPipeline[T proto.Message](name string) *PipelineBuilder[T] {
	return &PipelineBuilder[T]{
		pipeline: &Pipeline[T]{
			name:   name,
			steps:  make([]PipelineStep[T], 0),
			tracer: telemetry.NewNoOpTracer(), // Default to no-op tracer
		},
	}
}

// WithTracer sets the tracer for the pipeline.
func (b *PipelineBuilder[T]) WithTracer(tracer telemetry.Tracer) *PipelineBuilder[T] {
	b.pipeline.tracer = tracer
	return b
}

// AddStep adds a step to the pipeline.
// Steps are executed in the order they are added.
func (b *PipelineBuilder[T]) AddStep(step PipelineStep[T]) *PipelineBuilder[T] {
	b.pipeline.steps = append(b.pipeline.steps, step)
	return b
}

// Build creates the final pipeline.
func (b *PipelineBuilder[T]) Build() *Pipeline[T] {
	return b.pipeline
}

// Execute runs the pipeline on the given request context.
// Steps are executed sequentially, and execution stops on the first error.
func (p *Pipeline[T]) Execute(ctx *RequestContext[T]) error {
	log.Printf("[Pipeline %s] Starting execution with %d steps", p.name, len(p.steps))

	// Create a span for the entire pipeline
	pipelineCtx, pipelineSpan := p.tracer.Start(ctx.Context(), p.name)
	ctx.SetContext(pipelineCtx)
	ctx.SetSpan(pipelineSpan)
	defer pipelineSpan.End()

	// Execute each step in sequence
	for i, step := range p.steps {
		stepName := step.Name()
		log.Printf("[Pipeline %s] Executing step %d/%d: %s", p.name, i+1, len(p.steps), stepName)

		// Create a span for this step
		stepCtx, stepSpan := p.tracer.Start(ctx.Context(), stepName)
		ctx.SetContext(stepCtx)
		originalSpan := ctx.Span()
		ctx.SetSpan(stepSpan)

		// Execute the step
		startTime := time.Now()
		err := step.Execute(ctx)
		duration := time.Since(startTime)

		// Record the result
		result := StepResult{
			StepName: stepName,
			Success:  err == nil,
			Error:    err,
			Duration: duration,
		}

		// Update span
		if err != nil {
			stepSpan.RecordError(err)
			stepSpan.End()
			ctx.SetSpan(originalSpan)

			log.Printf("[Pipeline %s] Step %s failed after %v: %v", p.name, stepName, duration, err)
			return StepError(stepName, err)
		}

		stepSpan.SetAttribute("duration_ms", duration.Milliseconds())
		stepSpan.End()
		ctx.SetSpan(originalSpan)

		log.Printf("[Pipeline %s] Step %s completed successfully in %v", p.name, stepName, duration)

		// Store the result in context for observability
		ctx.Set(fmt.Sprintf("result_%d", i), result)
	}

	log.Printf("[Pipeline %s] Completed successfully", p.name)
	return nil
}

// Name returns the pipeline name.
func (p *Pipeline[T]) Name() string {
	return p.name
}

// StepCount returns the number of steps in the pipeline.
func (p *Pipeline[T]) StepCount() int {
	return len(p.steps)
}
