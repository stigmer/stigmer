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

## Future Steps

Planned steps to be implemented:

- **ResolveSlugStep** - Generate slug from resource name
- **CheckDuplicateStep** - Verify resource doesn't already exist
- **SetAuditFieldsStep** - Set created_at, updated_at, version
- **SetDefaultsStep** - Apply default values to optional fields
- **PersistStep** - Save resource to database
- **PublishEventStep** - Publish domain event for async processing
