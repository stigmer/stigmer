# Pipeline Steps

Common reusable steps for request processing pipelines.

## Overview

This package contains pre-built pipeline steps that can be used across different resource types and operations. Each step implements the `PipelineStep[T]` interface and performs a specific, well-defined operation.

## Available Steps

### ValidateProtoStep

Validates protobuf messages against their validation rules defined with `buf.build/validate`.

**Usage:**

```go
validateStep, err := steps.NewValidateProtoStep[*agentv1.Agent]()
if err != nil {
    return err
}

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(validateStep).
    Build()
```

**What it validates:**
- Required fields
- String patterns (regex)
- Numeric ranges (min/max)
- String length constraints
- Enum values
- Custom validation rules defined in proto files

**Example proto validation rules:**

```protobuf
message Agent {
  // Name is required and must be 3-50 characters
  string name = 1 [(buf.validate.field).string = {
    min_len: 3,
    max_len: 50,
    pattern: "^[a-z0-9-]+$"
  }];
  
  // Replicas must be between 1 and 10
  int32 replicas = 2 [(buf.validate.field).int32 = {
    gte: 1,
    lte: 10
  }];
}
```

## Creating Custom Steps

To create a new pipeline step:

1. **Define a struct** that will hold any configuration or dependencies:

```go
type MyCustomStep[T proto.Message] struct {
    config *MyConfig
}
```

2. **Implement the PipelineStep interface**:

```go
func (s *MyCustomStep[T]) Name() string {
    return "MyCustomStep"
}

func (s *MyCustomStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    // Get input
    input := ctx.Input()
    
    // Do work...
    
    // Pass data to next steps if needed
    ctx.Set("my_data", someValue)
    
    // Return error to halt pipeline, or nil to continue
    return nil
}
```

3. **Add a constructor function**:

```go
func NewMyCustomStep[T proto.Message](config *MyConfig) *MyCustomStep[T] {
    return &MyCustomStep[T]{config: config}
}
```

## Common Step Patterns

### Validation Steps

Verify that data meets certain criteria before proceeding:

```go
func (s *CheckDuplicateStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    name := extractName(ctx.Input())
    
    exists, err := s.store.Exists(name)
    if err != nil {
        return fmt.Errorf("failed to check for duplicates: %w", err)
    }
    
    if exists {
        return fmt.Errorf("resource with name %s already exists", name)
    }
    
    return nil
}
```

### Transformation Steps

Modify the resource being built:

```go
func (s *ResolveSlugStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    resource := ctx.NewState()
    if resource == nil {
        resource = proto.Clone(ctx.Input()).(T)
    }
    
    // Transform the resource
    setSlug(resource, generateSlug(getName(resource)))
    
    // Store updated state
    ctx.SetNewState(resource)
    
    return nil
}
```

### Enrichment Steps

Add additional data to the context for later steps:

```go
func (s *LoadOrgStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    orgId := extractOrgId(ctx.Input())
    
    org, err := s.orgStore.Get(orgId)
    if err != nil {
        return fmt.Errorf("failed to load organization: %w", err)
    }
    
    // Store in context for later steps
    ctx.Set("organization", org)
    
    return nil
}
```

### Persistence Steps

Save data to storage (typically the last step):

```go
func (s *PersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    resource := ctx.NewState()
    if resource == nil {
        return fmt.Errorf("no resource to persist")
    }
    
    if err := s.store.Save(resource); err != nil {
        return fmt.Errorf("failed to persist resource: %w", err)
    }
    
    return nil
}
```

## Step Best Practices

1. **Single Responsibility** - Each step should do one thing well
2. **Idempotent** - Steps should be safe to retry
3. **Clear Names** - Use descriptive names that explain what the step does
4. **Proper Errors** - Return clear, actionable error messages
5. **Minimal Side Effects** - Avoid side effects outside of persistence steps
6. **Context Usage** - Use context.Set() to share data between steps
7. **Fail Fast** - Return errors immediately on failure
8. **Logging** - The pipeline framework handles logging, steps don't need to log

## Testing Steps

Test steps in isolation:

```go
func TestValidateProtoStep(t *testing.T) {
    step, err := steps.NewValidateProtoStep[*agentv1.Agent]()
    require.NoError(t, err)
    
    tests := []struct {
        name    string
        input   *agentv1.Agent
        wantErr bool
    }{
        {
            name: "valid agent",
            input: &agentv1.Agent{
                Name: "test-agent",
                Replicas: 1,
            },
            wantErr: false,
        },
        {
            name: "empty name - should fail",
            input: &agentv1.Agent{
                Name: "",
                Replicas: 1,
            },
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            ctx := pipeline.NewRequestContext(context.Background(), tt.input)
            err := step.Execute(ctx)
            
            if tt.wantErr {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

### ResolveSlugStep

Generates a URL-friendly slug from the resource name.

**Usage:**

```go
slugStep := steps.NewResolveSlugStep[*agentv1.Agent]()

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(slugStep).
    Build()
```

**Slug Generation Rules:**
- Convert to lowercase
- Replace spaces with hyphens
- Remove special characters (keep only alphanumeric and hyphens)
- Collapse multiple consecutive hyphens into one
- Trim leading and trailing hyphens
- Limit to 63 characters (Kubernetes DNS label limit)

**Examples:**
- "My Cool Agent" → "my-cool-agent"
- "Agent@123!" → "agent123"
- "Test___Agent" → "test-agent"

**Behavior:**
- Idempotent: If `metadata.slug` is already set, the step is a no-op
- Requires `metadata.name` to be set

---

### CheckDuplicateStep

Verifies that no resource with the same slug exists in the same scope.

**Usage:**

```go
checkDupStep := steps.NewCheckDuplicateStep[*agentv1.Agent](store, "Agent")

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(checkDupStep).
    Build()
```

**Scope Checking:**
- **Organization-scoped resources**: Checks within the same organization (uses `metadata.org`)
- **Platform-scoped resources**: Checks globally (when `metadata.org` is empty)

**Error Handling:**
- Returns `ALREADY_EXISTS` error if duplicate found
- Error message includes the existing resource ID

**Dependencies:**
- Requires `sqlite.Store` instance
- Should run after `ResolveSlugStep` to ensure slug is set

---

### SetAuditFieldsStep

Sets audit fields for tracking resource creation and updates.

**Usage:**

```go
// For create operations
auditStep := steps.NewSetAuditFieldsStep[*agentv1.Agent]()

// For update operations
auditStep := steps.NewSetAuditFieldsStepForUpdate[*agentv1.Agent]()

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(auditStep).
    Build()
```

**Fields Set (Create):**
- `metadata.created_at`: Current timestamp
- `metadata.updated_at`: Current timestamp (same as created_at)
- `metadata.version`: 1

**Fields Set (Update):**
- `metadata.updated_at`: Current timestamp (updated)
- `metadata.version`: Incremented by 1
- `metadata.created_at`: Unchanged

**Behavior:**
- Idempotent for create operations: Won't override existing values
- Always updates for update operations

---

### SetDefaultsStep

Sets default values for resource fields, primarily the resource ID.

**Usage:**

```go
defaultsStep := steps.NewSetDefaultsStep[*agentv1.Agent]("agent")

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(defaultsStep).
    Build()
```

**Fields Set:**
- `metadata.id`: Generated from prefix + Unix nanosecond timestamp
  - Format: `{prefix}-{timestamp}`
  - Example: `agent-1705678901234567890`

**Note:** `kind` and `api_version` should be set by the controller before entering the pipeline, as they are resource-specific and cannot be set generically without proto reflection.

**Behavior:**
- Idempotent: If `metadata.id` is already set, it will not be overwritten

**ID Uniqueness:**
- Uses Unix nanoseconds for uniqueness
- Safe for concurrent creation within same millisecond
- Prefix is always lowercase

---

### PersistStep

Saves the resource to the SQLite database.

**Usage:**

```go
persistStep := steps.NewPersistStep[*agentv1.Agent](store, "Agent")

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(persistStep).
    Build()
```

**Requirements:**
- `metadata.id` must be set (typically by `SetDefaultsStep`)
- Resource should be fully populated with all required fields

**Dependencies:**
- Requires `sqlite.Store` instance
- Uses the resource kind for storage organization

**Error Handling:**
- Returns detailed error if save fails
- Wraps underlying store errors with context

**Behavior:**
- Works for both create and update operations
- For updates, the existing resource is overwritten

---

## Complete Pipeline Example

Here's how to build a complete create pipeline with all common steps:

```go
package controllers

import (
    "context"
    "github.com/stigmer/stigmer/backend/libs/go/telemetry"
    "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
    "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline/steps"
    agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // Set kind and apiVersion before pipeline
    agent.Kind = "Agent"
    agent.ApiVersion = "ai.stigmer.agentic.agent/v1"

    // Build pipeline
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
        WithTracer(telemetry.NewNoOpTracer()).
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
        AddStep(steps.NewCheckDuplicateStep(c.store, "Agent")).
        AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
        AddStep(steps.NewSetAuditFieldsStep[*agentv1.Agent]()).
        AddStep(steps.NewPersistStep(c.store, "Agent")).
        Build()

    // Execute pipeline
    pipelineCtx := p.NewRequestContext(ctx, agent)
    if err := p.Execute(pipelineCtx); err != nil {
        return nil, err
    }

    return pipelineCtx.NewState(), nil
}
```

## Update Pipeline Example

For update operations, use a different set of steps:

```go
func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // Build update pipeline (no slug resolution, no duplicate check, no ID generation)
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-update").
        WithTracer(telemetry.NewNoOpTracer()).
        AddStep(steps.NewSetAuditFieldsStepForUpdate[*agentv1.Agent]()).
        AddStep(steps.NewPersistStep(c.store, "Agent")).
        Build()

    // Execute pipeline
    pipelineCtx := p.NewRequestContext(ctx, agent)
    if err := p.Execute(pipelineCtx); err != nil {
        return nil, err
    }

    return pipelineCtx.NewState(), nil
}
```

## Future Steps

Planned steps to be implemented:

- **PublishEventStep** - Publish domain events for async processing (no-op initially)
