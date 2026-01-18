# Pipeline Package

Step-based request processing framework for the Stigmer backend.

## Overview

The pipeline package provides a generic, reusable framework for processing gRPC requests through a sequence of steps. It's inspired by the Java pipeline implementation in Stigmer Cloud and provides:

- **Sequential execution** - Steps run in order, stopping on first error
- **Type-safe generics** - Works with any protobuf message type
- **Telemetry integration** - Automatic tracing spans for each step
- **Context passing** - Steps can share data via request context
- **Clean error handling** - Errors preserve step context for debugging

## Architecture

```
Pipeline
├── Step 1 (Validate)
├── Step 2 (Transform)
├── Step 3 (Enrich)
└── Step 4 (Persist)
```

Each step:
1. Receives a `RequestContext[T]` containing the request and shared state
2. Performs a single, well-defined operation
3. Can pass data to subsequent steps via context metadata
4. Returns an error to halt the pipeline, or nil to continue

## Quick Start

### Creating a Pipeline

```go
import (
    "github.com/stigmer/stigmer/backend/libs/go/pipeline"
    "github.com/stigmer/stigmer/backend/libs/go/pipeline/steps"
    "github.com/stigmer/stigmer/backend/libs/go/telemetry"
    agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Create validation step
validateStep, err := steps.NewValidateProtoStep[*agentv1.Agent]()
if err != nil {
    return err
}

// Build pipeline
p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    WithTracer(telemetry.NewNoOpTracer()).
    AddStep(validateStep).
    AddStep(myCustomStep).
    Build()

// Execute
ctx := pipeline.NewRequestContext(context.Background(), agent)
if err := p.Execute(ctx); err != nil {
    return err
}

result := ctx.NewState() // Get the final resource
```

### Creating Custom Steps

Implement the `PipelineStep[T]` interface:

```go
type MyStep[T proto.Message] struct {
    config *Config
}

func (s *MyStep[T]) Name() string {
    return "MyStep"
}

func (s *MyStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    // Get input
    input := ctx.Input()
    
    // Do work...
    
    // Pass data to next steps
    ctx.Set("my_key", "my_value")
    
    // Update the resource being built
    state := ctx.NewState()
    // ... modify state ...
    ctx.SetNewState(state)
    
    return nil // or return error to halt pipeline
}
```

## Core Components

### Pipeline

The pipeline orchestrator that executes steps sequentially.

**Methods:**
- `NewPipeline[T](name)` - Create a new pipeline builder
- `WithTracer(tracer)` - Set the distributed tracer
- `AddStep(step)` - Add a step to the pipeline
- `Build()` - Create the final pipeline
- `Execute(ctx)` - Run the pipeline

**Features:**
- Automatic span creation for each step
- Comprehensive logging
- Error wrapping with step context
- Step result tracking in context metadata

### RequestContext

Carries state through pipeline execution.

**Methods:**
- `NewRequestContext(ctx, input)` - Create a new context
- `Context()` / `SetContext()` - Go context for cancellation
- `Input()` - Get the original request message
- `NewState()` / `SetNewState()` - Resource being built/modified
- `Get(key)` / `Set(key, value)` - Metadata for inter-step communication
- `Span()` / `SetSpan()` - Tracing span

**Usage:**
```go
// Pass data between steps
ctx.Set("organization", org)

// Later step retrieves it
org := ctx.Get("organization").(*models.Organization)
```

### PipelineStep Interface

```go
type PipelineStep[T proto.Message] interface {
    Execute(ctx *RequestContext[T]) error
    Name() string
}
```

Every step must:
1. Implement `Execute()` to perform its operation
2. Implement `Name()` to return a descriptive name
3. Be idempotent (safe to retry)
4. Have a single responsibility

### Error Handling

The pipeline uses `PipelineError` to wrap step failures:

```go
type PipelineError struct {
    StepName string
    Err      error
}
```

**Helper functions:**
- `StepError(stepName, err)` - Wrap an error with step context
- `ValidationError(stepName, msg)` - Create a validation error

**Error propagation:**
```go
if err := pipeline.Execute(ctx); err != nil {
    var pipelineErr *pipeline.PipelineError
    if errors.As(err, &pipelineErr) {
        log.Printf("Step %s failed: %v", pipelineErr.StepName, pipelineErr.Err)
    }
}
```

## Built-in Steps

The `steps/` subpackage provides common steps:

### ValidateProtoStep

Validates protobuf messages using `buf.build/validate`.

```go
validateStep, err := steps.NewValidateProtoStep[*agentv1.Agent]()
```

Validates:
- Required fields
- String patterns (regex)
- Numeric ranges
- String length constraints
- Enum values
- Custom validation rules

See `steps/README.md` for more details and additional steps.

## Telemetry Integration

The pipeline integrates with distributed tracing via the `telemetry` package.

**No-op tracer (default):**
```go
pipeline := NewPipeline[T]("my-pipeline").Build()
```

**Custom tracer:**
```go
pipeline := NewPipeline[T]("my-pipeline").
    WithTracer(myTracer).
    Build()
```

Each step automatically gets its own span:
- Span name = step name
- Errors are recorded to span
- Duration is tracked as span attribute

## Example: Agent Create Pipeline

```go
func CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // Create steps
    validateStep, _ := steps.NewValidateProtoStep[*agentv1.Agent]()
    resolveSlugStep := NewResolveSlugStep()
    checkDuplicateStep := NewCheckDuplicateStep(store)
    setDefaultsStep := NewSetDefaultsStep()
    setAuditStep := NewSetAuditFieldsStep()
    persistStep := NewPersistStep(store)
    
    // Build pipeline
    pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
        AddStep(validateStep).
        AddStep(resolveSlugStep).
        AddStep(checkDuplicateStep).
        AddStep(setDefaultsStep).
        AddStep(setAuditStep).
        AddStep(persistStep).
        Build()
    
    // Execute
    requestCtx := pipeline.NewRequestContext(ctx, agent)
    if err := pipeline.Execute(requestCtx); err != nil {
        return nil, err
    }
    
    return requestCtx.NewState(), nil
}
```

## Testing

Test pipelines and steps in isolation:

```go
func TestMyStep(t *testing.T) {
    step := NewMyStep()
    
    ctx := pipeline.NewRequestContext(context.Background(), input)
    err := step.Execute(ctx)
    
    assert.NoError(t, err)
    assert.NotNil(t, ctx.NewState())
}

func TestPipeline(t *testing.T) {
    p := pipeline.NewPipeline[*agentv1.Agent]("test").
        AddStep(step1).
        AddStep(step2).
        Build()
    
    ctx := pipeline.NewRequestContext(context.Background(), agent)
    err := p.Execute(ctx)
    
    assert.NoError(t, err)
}
```

## Best Practices

### Step Design

1. **Single Responsibility** - Each step does one thing
2. **Idempotent** - Safe to execute multiple times
3. **No Side Effects** - Except for persistence steps
4. **Clear Names** - Descriptive names for logging/tracing
5. **Proper Errors** - Return actionable error messages

### Pipeline Design

1. **Order Matters** - Validate before transform, transform before persist
2. **Fail Fast** - Put validation steps early
3. **Reuse Steps** - Build a library of common steps
4. **Keep It Simple** - Don't over-engineer for future needs
5. **Test Thoroughly** - Test steps in isolation and integrated

### Performance

1. **Avoid Allocation** - Reuse objects where possible
2. **Batch Operations** - Combine database operations when safe
3. **Use Context** - Pass Go context for cancellation
4. **Monitor Spans** - Use telemetry to find slow steps

## Migration from Monolithic Controllers

To migrate existing controller code to pipelines:

1. **Identify discrete operations** in the current code
2. **Create a step for each operation**
3. **Build a pipeline** that chains them together
4. **Replace controller logic** with pipeline execution
5. **Add tests** for each step and the full pipeline

**Before:**
```go
func (c *Controller) Create(ctx context.Context, agent *Agent) (*Agent, error) {
    // 100+ lines of validation, transformation, persistence...
}
```

**After:**
```go
func (c *Controller) Create(ctx context.Context, agent *Agent) (*Agent, error) {
    requestCtx := pipeline.NewRequestContext(ctx, agent)
    if err := c.createPipeline.Execute(requestCtx); err != nil {
        return nil, err
    }
    return requestCtx.NewState(), nil
}
```

## Comparison with Java Implementation

This Go implementation matches the Java Stigmer Cloud pipeline:

| Feature | Java | Go |
|---------|------|-----|
| Generic type support | ✅ `<T>` | ✅ `[T proto.Message]` |
| Builder pattern | ✅ | ✅ |
| Step interface | ✅ | ✅ |
| Context passing | ✅ | ✅ |
| Telemetry | ✅ OpenTelemetry | ✅ Interface (no-op default) |
| Error handling | ✅ Exceptions | ✅ Error wrapping |

**Key differences:**
- Go uses error returns instead of exceptions
- Go has no-op telemetry by default (vs. always-on in Java)
- Go uses `context.Context` for cancellation

## Future Enhancements

Planned improvements:

- [ ] Conditional steps (skip if condition met)
- [ ] Parallel step execution (where safe)
- [ ] Step retry with backoff
- [ ] Circuit breaker integration
- [ ] Metrics collection (success rate, duration)
- [ ] Real OpenTelemetry integration
- [ ] Step configuration validation

## See Also

- `steps/README.md` - Built-in steps documentation
- `backend/libs/go/telemetry/README.md` - Telemetry integration
- `backend/services/stigmer-server/pkg/controllers/` - Controllers using pipelines
