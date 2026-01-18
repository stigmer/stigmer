# T01: Pipeline Framework Foundation - Initial Plan

**Status:** PENDING REVIEW  
**Created:** 2026-01-18  
**Phase:** Phase 1 - Pipeline Framework Foundation

## Overview

Implement the foundational pipeline framework that will enable step-based request processing for the Stigmer OSS agent controller. This task establishes the core abstractions, execution model, and integration points that all future steps will build upon.

## Goals

1. Create a generic, reusable pipeline framework
2. Define clear interfaces for pipeline steps
3. Implement context management for data flow between steps
4. Add OpenTelemetry integration (no-op tracer initially)
5. Establish error handling patterns
6. Set up proper package structure following Planton CLI standards

## Reference Implementation

The Java implementation we're matching:
- `ai.stigmer.grpcrequest.pipeline.RequestPipelineV2`
- `ai.stigmer.grpcrequest.pipeline.step.RequestPipelineStepV2`
- `ai.stigmer.grpcrequest.context.CreateContextV2`

Java pattern:
```java
RequestPipelineV2.<CreateContextV2<Agent>>builder()
    .withTracer(tracer)
    .addStep(validateFieldConstraints)
    .addStep(resolveSlug)
    .addStep(checkDuplicate)
    .addStep(buildNewState)
    .addStep(persist)
    .build()
    .execute(context);
```

## Task Breakdown

### 1. Package Structure Setup

**Location:** `backend/services/stigmer-server/pkg/pipeline/`

**Files to Create:**
```
pkg/pipeline/
├── pipeline.go           # Pipeline builder and executor
├── context.go           # Request context types
├── step.go              # Step interface and result types
├── error.go             # Pipeline-specific errors
└── README.md            # Package documentation

pkg/pipeline/steps/      # Common reusable steps
├── validation.go        # Proto validation step
├── slug.go              # Slug resolution step
├── duplicate.go         # Duplicate check step
├── audit.go             # Audit fields step
├── persist.go           # Persistence step
└── README.md

backend/libs/go/telemetry/  # Telemetry abstractions
├── tracer.go            # Tracer interface and no-op impl
├── span.go              # Span interface and no-op impl
└── README.md
```

**Acceptance Criteria:**
- [ ] All directories created
- [ ] README.md files explain purpose and usage
- [ ] Package structure follows Go conventions

### 2. Core Pipeline Abstractions

**File:** `pkg/pipeline/step.go`

**Define:**
```go
// PipelineStep represents a single step in request processing
type PipelineStep[T any] interface {
    // Execute runs the step logic
    Execute(ctx *RequestContext[T]) error
    
    // Name returns a human-readable step name for logging/tracing
    Name() string
}

// StepResult represents the outcome of a step execution
type StepResult struct {
    StepName string
    Success  bool
    Error    error
    Duration time.Duration
}
```

**Acceptance Criteria:**
- [ ] Generic interface supporting any protobuf message type
- [ ] Clear separation of concerns
- [ ] Proper error handling contract
- [ ] Documentation comments

### 3. Request Context

**File:** `pkg/pipeline/context.go`

**Define:**
```go
// RequestContext carries state through the pipeline
type RequestContext[T proto.Message] struct {
    ctx         context.Context      // Go context for cancellation
    input       T                     // Original request
    newState    T                     // Resource being built/modified
    metadata    map[string]any        // Step-to-step data passing
    span        telemetry.Span        // Tracing span
    caller      *Caller               // Who made the request (future)
}

// Helper methods:
// - Get/Set for metadata
// - WithSpan for telemetry
// - GetNewState/SetNewState for resource
```

**Acceptance Criteria:**
- [ ] Type-safe generic implementation
- [ ] Proper encapsulation (private fields, public methods)
- [ ] Support for arbitrary metadata passing
- [ ] Integration with telemetry

### 4. Pipeline Builder and Executor

**File:** `pkg/pipeline/pipeline.go`

**Define:**
```go
// Pipeline executes a sequence of steps
type Pipeline[T proto.Message] struct {
    name   string
    steps  []PipelineStep[T]
    tracer telemetry.Tracer
}

// Builder pattern:
func NewPipeline[T proto.Message](name string) *PipelineBuilder[T]

type PipelineBuilder[T proto.Message] struct {
    pipeline *Pipeline[T]
}

func (b *PipelineBuilder[T]) WithTracer(tracer telemetry.Tracer) *PipelineBuilder[T]
func (b *PipelineBuilder[T]) AddStep(step PipelineStep[T]) *PipelineBuilder[T]
func (b *PipelineBuilder[T]) Build() *Pipeline[T]

// Execution:
func (p *Pipeline[T]) Execute(ctx *RequestContext[T]) error
```

**Acceptance Criteria:**
- [ ] Fluent builder API
- [ ] Sequential step execution
- [ ] Automatic span creation per step
- [ ] Error handling stops pipeline
- [ ] Comprehensive logging
- [ ] File under 250 lines

### 5. OpenTelemetry Integration (No-Op)

**File:** `backend/libs/go/telemetry/tracer.go`

**Define:**
```go
// Tracer creates spans for distributed tracing
type Tracer interface {
    Start(ctx context.Context, name string) (context.Context, Span)
}

// Span represents a tracing span
type Span interface {
    End()
    RecordError(err error)
    SetAttribute(key string, value any)
}

// NoOpTracer for local/OSS deployment
type NoOpTracer struct{}

func NewNoOpTracer() *NoOpTracer { return &NoOpTracer{} }

func (t *NoOpTracer) Start(ctx context.Context, name string) (context.Context, Span) {
    return ctx, &NoOpSpan{}
}

type NoOpSpan struct{}
func (s *NoOpSpan) End() {}
func (s *NoOpSpan) RecordError(err error) {}
func (s *NoOpSpan) SetAttribute(key string, value any) {}
```

**Acceptance Criteria:**
- [ ] Clean interface for future OpenTelemetry integration
- [ ] No-op implementation has zero overhead
- [ ] Can be swapped for real tracer later
- [ ] Proper documentation on integration path

### 6. Error Handling

**File:** `pkg/pipeline/error.go`

**Define:**
```go
// PipelineError wraps step execution errors
type PipelineError struct {
    StepName string
    Err      error
}

func (e *PipelineError) Error() string {
    return fmt.Sprintf("pipeline step %s failed: %v", e.StepName, e.Err)
}

func (e *PipelineError) Unwrap() error {
    return e.Err
}

// Helper constructors:
func StepError(stepName string, err error) error
func ValidationError(stepName string, msg string) error
```

**Acceptance Criteria:**
- [ ] Proper error wrapping (works with errors.Is/As)
- [ ] Preserves step context
- [ ] Integrates with gRPC error handling
- [ ] Clear error messages

### 7. Basic Step Implementation (Proof of Concept)

**File:** `pkg/pipeline/steps/validation.go`

Implement one simple step to validate the framework:

```go
// ValidateProtoStep validates protobuf field constraints
type ValidateProtoStep[T proto.Message] struct {
    validator *protovalidate.Validator
}

func NewValidateProtoStep[T proto.Message]() (*ValidateProtoStep[T], error) {
    v, err := protovalidate.New()
    if err != nil {
        return nil, err
    }
    return &ValidateProtoStep[T]{validator: v}, nil
}

func (s *ValidateProtoStep[T]) Name() string {
    return "ValidateProtoConstraints"
}

func (s *ValidateProtoStep[T]) Execute(ctx *RequestContext[T]) error {
    if err := s.validator.Validate(ctx.input); err != nil {
        return fmt.Errorf("validation failed: %w", err)
    }
    return nil
}
```

**Acceptance Criteria:**
- [ ] Uses `buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go`
- [ ] Proper error handling
- [ ] Demonstrates step interface usage
- [ ] Can be tested in isolation

### 8. Unit Tests

**Files:**
- `pkg/pipeline/pipeline_test.go`
- `pkg/pipeline/context_test.go`
- `pkg/pipeline/steps/validation_test.go`

**Coverage:**
- [ ] Pipeline builder creates pipeline correctly
- [ ] Pipeline executes steps in order
- [ ] Pipeline stops on first error
- [ ] Context metadata get/set works
- [ ] Validation step catches proto violations
- [ ] Tracer integration (no-op) doesn't crash

**Acceptance Criteria:**
- [ ] Table-driven tests where appropriate
- [ ] Error cases covered
- [ ] Mock steps for testing framework
- [ ] Tests run with `go test ./pkg/pipeline/...`

### 9. Documentation

**Files:**
- `pkg/pipeline/README.md`
- `pkg/pipeline/steps/README.md`
- `backend/libs/go/telemetry/README.md`

**Content:**
- [ ] Architecture overview
- [ ] How to create custom steps
- [ ] Example pipeline usage
- [ ] Telemetry integration guide
- [ ] Error handling patterns

## Dependencies

**New Go Modules:**
```bash
go get buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go
go get github.com/bufbuild/protovalidate-go
```

**Existing:**
- `google.golang.org/protobuf`
- `github.com/pkg/errors` (for error wrapping)

## Success Criteria

### Functional:
1. Pipeline can execute multiple steps sequentially
2. Steps can pass data via context metadata
3. Proto validation works with buf.build/validate
4. Errors halt pipeline execution properly
5. No-op tracer integrates cleanly

### Non-Functional:
1. All files under 250 lines
2. Functions under 50 lines
3. Clear separation of concerns
4. Proper Go idioms and conventions
5. Comprehensive tests (>80% coverage)
6. Zero external dependencies except proto validation

## Testing Strategy

### Unit Tests:
- Test each component in isolation
- Mock step implementations for pipeline tests
- Verify error propagation

### Integration Test:
Create a simple end-to-end test:
```go
func TestAgentPipeline(t *testing.T) {
    // Create a test agent
    agent := &agentv1.Agent{...}
    
    // Build pipeline
    pipeline := NewPipeline[*agentv1.Agent]("test-pipeline").
        WithTracer(telemetry.NewNoOpTracer()).
        AddStep(validationStep).
        AddStep(mockPersistStep).
        Build()
    
    // Execute
    ctx := NewRequestContext(context.Background(), agent)
    err := pipeline.Execute(ctx)
    
    // Verify
    assert.NoError(t, err)
}
```

## File Size Estimates

| File | Estimated Lines | Status |
|------|----------------|--------|
| pipeline.go | 150-200 | Within limits |
| context.go | 80-120 | Within limits |
| step.go | 40-60 | Within limits |
| error.go | 50-80 | Within limits |
| telemetry/tracer.go | 100-150 | Within limits |
| steps/validation.go | 60-100 | Within limits |

All files comfortably under the 250-line limit.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Generics complexity** | Keep type parameters simple, use clear constraints |
| **Over-abstraction** | Start with minimal viable interface, extend as needed |
| **Performance overhead** | Benchmark critical paths, avoid unnecessary allocations |
| **Testing difficulty** | Create mock step implementations, use table-driven tests |

## Next Steps After This Task

Once T01 is complete:
- **T02:** Implement common steps (slug resolution, duplicate check, audit fields)
- **T03:** Implement agent-specific steps (default instance creation)
- **T04:** Refactor agent_controller.go to use pipeline
- **T05:** Integration tests and documentation

## Questions for Review

1. **Generics approach**: Is `Pipeline[T proto.Message]` the right level of abstraction?
2. **Context metadata**: Should we use `map[string]any` or a more type-safe approach?
3. **Error handling**: Should pipeline continue on non-critical errors, or always stop?
4. **Telemetry**: Is no-op tracer sufficient for now, or should we integrate real OpenTelemetry?
5. **Testing**: Should we require benchmarks, or just unit/integration tests?

## Review Checklist

Please review and confirm:
- [ ] Package structure makes sense
- [ ] Interface design is clean and extensible
- [ ] Task breakdown is appropriately sized
- [ ] Dependencies are acceptable
- [ ] Testing strategy is comprehensive
- [ ] File size estimates are reasonable
- [ ] Ready to proceed with implementation

---

**After review, this plan will be revised based on feedback and approved before execution begins.**
