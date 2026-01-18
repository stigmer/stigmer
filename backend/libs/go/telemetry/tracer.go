package telemetry

import "context"

// Tracer creates spans for distributed tracing.
// This interface provides a clean abstraction for tracing that can be
// implemented with OpenTelemetry or other tracing systems in the future.
type Tracer interface {
	// Start creates a new span with the given name and returns a new context
	// containing the span and the span itself.
	Start(ctx context.Context, name string) (context.Context, Span)
}

// Span represents a single operation in a distributed trace.
// Spans can be nested to represent hierarchical operations.
type Span interface {
	// End completes the span. After calling End, the span should not be used.
	End()

	// RecordError records an error that occurred during the span's operation.
	RecordError(err error)

	// SetAttribute sets a key-value attribute on the span for additional context.
	SetAttribute(key string, value interface{})
}

// NoOpTracer is a tracer implementation that does nothing.
// It's used for local/OSS deployments where distributed tracing is not needed.
// This implementation has zero performance overhead.
type NoOpTracer struct{}

// NewNoOpTracer creates a new no-op tracer.
func NewNoOpTracer() *NoOpTracer {
	return &NoOpTracer{}
}

// Start implements Tracer.Start by returning the context unchanged and a no-op span.
func (t *NoOpTracer) Start(ctx context.Context, name string) (context.Context, Span) {
	return ctx, &NoOpSpan{}
}

// NoOpSpan is a span implementation that does nothing.
type NoOpSpan struct{}

// End implements Span.End as a no-op.
func (s *NoOpSpan) End() {}

// RecordError implements Span.RecordError as a no-op.
func (s *NoOpSpan) RecordError(err error) {}

// SetAttribute implements Span.SetAttribute as a no-op.
func (s *NoOpSpan) SetAttribute(key string, value interface{}) {}
