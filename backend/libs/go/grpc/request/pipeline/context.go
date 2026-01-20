package pipeline

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/telemetry"
	"google.golang.org/protobuf/proto"
)

// RequestContext carries state through the pipeline execution.
// It contains the original request, the resource being built/modified,
// metadata for inter-step communication, and telemetry integration.
//
// Input vs NewState:
//   - input: The original, immutable request from the client
//   - newState: A cloned copy that pipeline steps can safely modify
//
// This separation ensures the original request is never mutated,
// which is critical for debugging, logging, and idempotency.
type RequestContext[T proto.Message] struct {
	// ctx is the Go context for cancellation and deadlines
	ctx context.Context

	// input is the original, immutable request message
	input T

	// newState is a cloned copy of input that pipeline steps modify
	newState T

	// metadata stores arbitrary key-value data for passing information between steps
	metadata map[string]interface{}

	// span is the tracing span for this request
	span telemetry.Span
}

// NewRequestContext creates a new request context with automatic input cloning.
//
// The input is automatically cloned using proto.Clone() to create newState,
// ensuring the original input remains immutable throughout pipeline execution.
// Pipeline steps should read from and modify newState, never input.
//
// Example:
//
//	reqCtx := pipeline.NewRequestContext(ctx, agent)
//	// reqCtx.Input() returns the original request (immutable)
//	// reqCtx.NewState() returns a clone that steps can modify
func NewRequestContext[T proto.Message](ctx context.Context, input T) *RequestContext[T] {
	return &RequestContext[T]{
		ctx:      ctx,
		input:    input,
		newState: proto.Clone(input).(T), // Automatically clone for immutability
		metadata: make(map[string]interface{}),
	}
}

// Context returns the Go context.
func (c *RequestContext[T]) Context() context.Context {
	return c.ctx
}

// SetContext updates the Go context (e.g., after creating a span).
func (c *RequestContext[T]) SetContext(ctx context.Context) {
	c.ctx = ctx
}

// Input returns the original request message.
func (c *RequestContext[T]) Input() T {
	return c.input
}

// NewState returns the resource being built/modified.
func (c *RequestContext[T]) NewState() T {
	return c.newState
}

// SetNewState sets the resource being built/modified.
func (c *RequestContext[T]) SetNewState(state T) {
	c.newState = state
}

// Get retrieves a value from the metadata by key.
// Returns nil if the key doesn't exist.
func (c *RequestContext[T]) Get(key string) interface{} {
	return c.metadata[key]
}

// Set stores a value in the metadata.
func (c *RequestContext[T]) Set(key string, value interface{}) {
	c.metadata[key] = value
}

// Span returns the tracing span for this request.
func (c *RequestContext[T]) Span() telemetry.Span {
	return c.span
}

// SetSpan sets the tracing span.
func (c *RequestContext[T]) SetSpan(span telemetry.Span) {
	c.span = span
}
