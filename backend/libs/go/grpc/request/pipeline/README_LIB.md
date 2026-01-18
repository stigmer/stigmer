# Pipeline Library

**Location:** `backend/libs/go/pipeline/`

## Overview

The pipeline package is a **common, reusable library** for building step-based request processing pipelines in Go services. It provides a generic, type-safe framework for orchestrating sequential operations with proper error handling, telemetry, and context passing.

This library can be used by **any Go service** in the Stigmer ecosystem that needs structured request processing.

## Why in libs/go?

This package lives in `backend/libs/go/` (not in a service-specific `pkg/`) because:

1. **Reusable across services** - Any Go backend service can import and use this pipeline framework
2. **Domain-agnostic** - The core pipeline logic has no business logic or service-specific dependencies
3. **Common abstraction** - Multiple services benefit from the same pipeline patterns (validation, transformation, persistence)

## Quick Example

```go
import (
    "github.com/stigmer/stigmer/backend/libs/go/pipeline"
    "github.com/stigmer/stigmer/backend/libs/go/pipeline/steps"
)

// Build a pipeline
p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
    AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
    Build()

// Execute it
ctx := pipeline.NewRequestContext(context.Background(), agent)
if err := p.Execute(ctx); err != nil {
    return err
}
```

## Documentation

See `README.md` for complete documentation on:
- Pipeline architecture and design
- Creating custom steps
- Built-in steps
- Testing patterns
- Best practices

## Structure

```
backend/libs/go/pipeline/
├── README.md                 # Full documentation
├── README_LIB.md            # This file - library overview
├── pipeline.go              # Core pipeline orchestrator
├── context.go               # Request context for state passing
├── step.go                  # PipelineStep interface
├── error.go                 # Pipeline error types
└── steps/                   # Common reusable steps
    ├── README.md            # Step documentation
    ├── validation.go        # Proto validation step
    ├── slug.go             # Slug generation step
    ├── defaults.go         # Default value step
    ├── duplicate.go        # Duplicate checking step
    └── persist.go          # Database persistence step
```

## Who Uses This?

Current consumers:
- `backend/services/stigmer-server` - Agent controller, workflow controller

Future consumers:
- Any new Go backend service that needs request processing pipelines
- Microservices built in the Stigmer ecosystem

## Design Philosophy

1. **Generic and type-safe** - Uses Go generics (`[T proto.Message]`)
2. **Single responsibility** - Each step does one thing
3. **Composable** - Mix and match steps to build custom pipelines
4. **Testable** - Steps can be tested in isolation
5. **Observable** - Built-in telemetry and logging support

## See Also

- `backend/libs/go/grpc/` - gRPC server library
- `backend/libs/go/sqlite/` - SQLite storage library
- `backend/libs/go/telemetry/` - Distributed tracing library
