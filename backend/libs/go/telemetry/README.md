# Telemetry Package

Provides distributed tracing abstractions for the Stigmer backend services.

## Overview

This package defines clean interfaces for distributed tracing that can be implemented with OpenTelemetry or other tracing systems. For OSS deployments, a no-op implementation is provided that has zero performance overhead.

## Components

### Tracer Interface

The `Tracer` interface creates spans for tracing operations:

```go
type Tracer interface {
    Start(ctx context.Context, name string) (context.Context, Span)
}
```

### Span Interface

The `Span` interface represents a single traced operation:

```go
type Span interface {
    End()
    RecordError(err error)
    SetAttribute(key string, value interface{})
}
```

### No-Op Implementation

The `NoOpTracer` and `NoOpSpan` implementations do nothing and are used for local/OSS deployments:

```go
tracer := telemetry.NewNoOpTracer()
ctx, span := tracer.Start(context.Background(), "operation-name")
defer span.End()

// Do work...
if err != nil {
    span.RecordError(err)
    return err
}

span.SetAttribute("result", "success")
```

## Usage in Pipelines

The pipeline framework uses the tracer to automatically create spans for each pipeline step:

```go
pipeline := NewPipeline[*agentv1.Agent]("agent-create").
    WithTracer(telemetry.NewNoOpTracer()).
    AddStep(validateStep).
    AddStep(persistStep).
    Build()
```

Each step execution automatically gets its own span with the step name.

## Future OpenTelemetry Integration

To integrate with OpenTelemetry in the future:

1. Create a new `OTelTracer` type that wraps `trace.Tracer`
2. Create an `OTelSpan` type that wraps `trace.Span`
3. Implement the `Tracer` and `Span` interfaces
4. No changes needed to pipeline code - just swap the tracer implementation

Example future implementation:

```go
type OTelTracer struct {
    tracer trace.Tracer
}

func (t *OTelTracer) Start(ctx context.Context, name string) (context.Context, Span) {
    ctx, span := t.tracer.Start(ctx, name)
    return ctx, &OTelSpan{span: span}
}

type OTelSpan struct {
    span trace.Span
}

func (s *OTelSpan) End() {
    s.span.End()
}

func (s *OTelSpan) RecordError(err error) {
    s.span.RecordError(err)
}

func (s *OTelSpan) SetAttribute(key string, value interface{}) {
    s.span.SetAttributes(attribute.Any(key, value))
}
```

## Design Philosophy

The telemetry package follows these principles:

1. **Clean abstraction** - Simple interfaces that hide implementation details
2. **Zero overhead for OSS** - No-op implementation has no performance cost
3. **Future-proof** - Easy to add real tracing later without changing consuming code
4. **Standard patterns** - Follows common distributed tracing patterns
