# gRPC Request Handling Framework

**Location:** `backend/libs/go/grpc/request/`

## Overview

The request handling framework provides structured, pipeline-based request processing for gRPC services in Go. This architecture mirrors the Java `grpc-request` framework in Stigmer Cloud, providing consistency across the polyglot platform.

## Architecture Alignment

This package is the **Go equivalent** of `backend/libs/java/grpc/grpc-request/` in Stigmer Cloud:

**Java:**
```
backend/libs/java/
└── grpc/
    └── grpc-request/          # Request handling framework
        ├── pipeline/          # Pipeline orchestration
        ├── context/           # Request contexts
        ├── handler/           # Operation handlers
        ├── interceptor/       # gRPC interceptors
        └── routing/           # Request routing
```

**Go (this package):**
```
backend/libs/go/
└── grpc/
    ├── server.go              # gRPC server wrapper
    └── request/               # Request handling framework
        ├── pipeline/          # Pipeline orchestration
        └── (future: context/, handler/, interceptor/)
```

## Why This Structure?

### 1. Architectural Parity

The pipeline is **part of the gRPC request handling framework**, not a standalone abstraction:

- **Java:** Pipeline is in `grpc-request` package alongside handlers and contexts
- **Go:** Pipeline is in `grpc/request` package following the same pattern

This ensures developers moving between Java and Go services find familiar patterns.

### 2. Cohesive Functionality

The pipeline framework is tightly coupled to gRPC request processing:

- Executes within gRPC interceptor context
- Operates on gRPC requests/responses
- Integrates with gRPC error codes and status
- Part of the request lifecycle management

Placing it in `grpc/request/` makes this relationship explicit.

### 3. Future Extensibility

As the Go backend grows, we'll add more request handling components:

```
backend/libs/go/grpc/request/
├── pipeline/           # ✅ Already implemented
├── context/            # 🔜 Request context types
├── handler/            # 🔜 Base handler interfaces
├── interceptor/        # 🔜 gRPC interceptors
└── routing/            # 🔜 Request routing (if needed)
```

All request handling concerns live together, just like in Java.

## Components

### Pipeline Framework

**Location:** `pipeline/`

Provides step-based request processing:

```go
import (
    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Build pipeline
p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
    AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
    AddStep(steps.NewPersistStep[*agentv1.Agent](store, "Agent")).
    Build()

// Execute
ctx := pipeline.NewRequestContext(context.Background(), agent)
ctx.SetNewState(agent)
if err := p.Execute(ctx); err != nil {
    return err
}
```

See `pipeline/README.md` for complete documentation.

### Common Steps

**Location:** `pipeline/steps/`

Reusable pipeline steps for common operations:

- **Validation:** Proto field constraint validation
- **Slug Resolution:** URL-friendly slug generation
- **Defaults:** Resource ID and metadata defaults
- **Duplicate Checking:** Prevent duplicate resources
- **Persistence:** Database save operations

See `pipeline/steps/README.md` for step documentation.

## Comparison with Java

| Component | Java Location | Go Location |
|-----------|---------------|-------------|
| Pipeline Framework | `grpc-request/pipeline/` | `grpc/request/pipeline/` |
| Request Context | `grpc-request/context/` | `grpc/request/pipeline/` (context.go) |
| Pipeline Steps | `grpc-request/pipeline/step/` | `grpc/request/pipeline/steps/` |
| Operation Handlers | `grpc-request/handler/` | (future) `grpc/request/handler/` |
| Interceptors | `grpc-request/interceptor/` | (future) `grpc/request/interceptor/` |

**Key Differences:**

1. **Go is simpler:** We started with just the pipeline; Java has full handler/interceptor framework
2. **Go uses generics:** `Pipeline[T proto.Message]` vs Java's `<T extends Message>`
3. **Go uses error returns:** No exceptions like Java
4. **No-op telemetry by default:** Java has OpenTelemetry always-on

## Usage Patterns

### In Service Controllers

Controllers use the pipeline to structure request handling:

```go
package controllers

import (
    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // Set kind and apiVersion
    agent.Kind = "Agent"
    agent.ApiVersion = "ai.stigmer.agentic.agent/v1"

    // Build pipeline
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
        AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent")).
        AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
        AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).
        Build()

    // Execute
    pipelineCtx := pipeline.NewRequestContext(ctx, agent)
    pipelineCtx.SetNewState(agent)
    
    if err := p.Execute(pipelineCtx); err != nil {
        return nil, err
    }

    return pipelineCtx.NewState(), nil
}
```

### Custom Steps

Add domain-specific steps alongside common steps:

```go
// Custom step for agent-specific logic
type ValidateAgentConfigStep struct{}

func (s *ValidateAgentConfigStep) Name() string {
    return "ValidateAgentConfig"
}

func (s *ValidateAgentConfigStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
    agent := ctx.NewState()
    // Custom validation logic...
    return nil
}

// Use in pipeline
p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
    AddStep(&ValidateAgentConfigStep{}).  // Custom step
    AddStep(steps.NewPersistStep[*agentv1.Agent](store, "Agent")).
    Build()
```

## Future Direction

As we migrate more controllers to the pipeline pattern, this package will grow to include:

1. **Handler Base Types** (`handler/`)
   - `CreateHandler`, `UpdateHandler`, `DeleteHandler`
   - Similar to Java's `CreateOperationHandlerV2`, etc.

2. **Request Contexts** (`context/`)
   - `CreateContext`, `UpdateContext`, `DeleteContext`
   - Currently minimal context in `pipeline/context.go`

3. **Interceptors** (`interceptor/`)
   - Authentication/authorization interceptors
   - Request tracing and logging
   - Error handling

4. **Routing** (if needed)
   - Auto-routing to handlers based on method
   - Currently controllers are manually wired

## Documentation

- **Pipeline Framework:** `pipeline/README.md`
- **Pipeline Steps:** `pipeline/steps/README.md`
- **Migration Guide:** `pipeline/MIGRATION.md`

## Related Packages

- `backend/libs/go/grpc/` - gRPC server wrapper
- `backend/libs/go/sqlite/` - Database storage
- `backend/libs/go/telemetry/` - Distributed tracing

---

**Status:** ✅ Pipeline framework implemented and ready for controller integration

**Java Equivalent:** `backend/libs/java/grpc/grpc-request/`
