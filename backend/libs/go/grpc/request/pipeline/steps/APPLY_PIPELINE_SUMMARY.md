# Apply Operation Pipeline - Implementation Summary

## Overview

We've implemented a **generic, reusable Apply operation infrastructure** that mirrors the Java `ApplyOperationPipeline` pattern. This allows any resource controller to provide declarative "apply" semantics (like `kubectl apply`) with minimal custom code.

## Architecture

### 1. Generic Pipeline Step: `LoadForApplyStep`

**File**: `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go`

**Purpose**: Optionally loads an existing resource to determine whether to CREATE or UPDATE.

**Behavior**:
- Searches for existing resource by slug (using `findBySlug` helper that scans all resources)
- If found:
  - Sets `ShouldCreateKey = false` (route to UPDATE)
  - Stores existing resource in context
  - Populates input ID with existing resource ID
- If not found:
  - Sets `ShouldCreateKey = true` (route to CREATE)
- **Never fails** - NotFound is a valid outcome for apply

**Key Difference from LoadExistingStep**:
- `LoadExistingStep`: Fails with NotFound error (for Update/Delete operations)
- `LoadForApplyStep`: Returns success with flag indicating create vs update (for Apply operations)

### 2. Controller Apply Method Pattern

**File**: `backend/services/stigmer-server/pkg/controllers/agent/apply.go`

**Structure**:
```go
func (c *AgentController) Apply(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // 1. Build minimal pipeline
    p := c.buildApplyPipeline()
    
    // 2. Execute pipeline
    reqCtx := pipeline.NewRequestContext(ctx, agent)
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    
    // 3. Check shouldCreate flag
    shouldCreate := reqCtx.Get(steps.ShouldCreateKey).(bool)
    
    // 4. Delegate to Create or Update
    if shouldCreate {
        return c.Create(ctx, agent)
    }
    return c.Update(ctx, agent)
}
```

**Pipeline Definition**:
```go
func (c *AgentController) buildApplyPipeline() *pipeline.Pipeline[*agentv1.Agent] {
    return pipeline.NewPipeline[*agentv1.Agent]("agent-apply").
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()). // Validate input
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).    // Generate slug
        AddStep(steps.NewLoadForApplyStep[*agentv1.Agent](c.store)). // Check existence
        Build()
}
```

## Comparison with Java Implementation

### Java (Stigmer Cloud)

```java
@Component
public class AgentApplyHandler extends ApplyOperationHandlerV2<Agent> {
    private final ApplyOperationPipeline<Agent> applyOperationPipeline;
    private final AgentCreateHandler createHandler;
    private final AgentUpdateHandler updateHandler;

    @Override
    protected RequestPipelineV2<ApplyContextV2<Agent>> pipeline() {
        return applyOperationPipeline.toBuilder(this.getClass().getSimpleName())
                .build();
    }

    @Override
    protected CreateOperationHandlerV2<Agent> getCreateHandler() {
        return createHandler;
    }

    @Override
    protected UpdateOperationHandlerV2<Agent> getUpdateHandler() {
        return updateHandler;
    }
}
```

### Go (Stigmer OSS) - Our Implementation

```go
func (c *AgentController) Apply(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    reqCtx := pipeline.NewRequestContext(ctx, agent)
    p := c.buildApplyPipeline()
    
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    
    shouldCreate := reqCtx.Get(steps.ShouldCreateKey).(bool)
    if shouldCreate {
        return c.Create(ctx, agent)
    }
    return c.Update(ctx, agent)
}
```

**Key Similarities**:
1. ✅ Generic pipeline step for existence checking (`LoadForApplyStep` = `ApplyOperationLoadExistingStepV2`)
2. ✅ Delegates to existing Create/Update handlers (no code duplication)
3. ✅ Minimal pipeline focused only on existence check
4. ✅ Context flags determine create vs update (`ShouldCreateKey` = `shouldCreate()`)

**Differences** (OSS simplifications):
- Go version is more direct (no base class abstraction needed)
- No owner-scope awareness (OSS doesn't have multi-tenancy)
- Simpler context structure (no separate ApplyContext type needed)

## Usage Example

### Before (Without Apply)

Users had to manually check existence and choose create vs update:

```bash
# Manual workflow
stigmer get agent my-agent  # Check if exists
if [ $? -eq 0 ]; then
    stigmer update agent my-agent ...
else
    stigmer create agent my-agent ...
fi
```

### After (With Apply)

Declarative apply - system figures it out:

```bash
# Apply works whether resource exists or not
stigmer apply agent my-agent.yaml
```

## Extending to Other Resources

To add apply support to any resource:

```go
func (c *YourController) Apply(ctx context.Context, resource *YourResource) (*YourResource, error) {
    reqCtx := pipeline.NewRequestContext(ctx, resource)
    
    p := pipeline.NewPipeline[*YourResource]("your-resource-apply").
        AddStep(steps.NewValidateProtoStep[*YourResource]()).
        AddStep(steps.NewResolveSlugStep[*YourResource]()).
        AddStep(steps.NewLoadForApplyStep[*YourResource](c.store)).
        Build()
    
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    
    shouldCreate := reqCtx.Get(steps.ShouldCreateKey).(bool)
    if shouldCreate {
        return c.Create(ctx, resource)
    }
    return c.Update(ctx, resource)
}
```

**That's it!** The generic `LoadForApplyStep` handles all the complexity.

## Testing

Comprehensive tests cover:
- ✅ Resource exists → routes to UPDATE
- ✅ Resource doesn't exist → routes to CREATE
- ✅ No slug → defaults to CREATE
- ✅ No metadata → defaults to CREATE
- ✅ Integration with full pipeline
- ✅ ID population from existing resource

**Test File**: `backend/libs/go/grpc/request/pipeline/steps/load_for_apply_test.go`

## Benefits

1. **No Code Duplication**: Reuses existing Create/Update logic
2. **Generic & Reusable**: Works for any resource type
3. **Declarative Semantics**: Users don't need to track existence
4. **Consistent Pattern**: Same approach across all resources
5. **Testable**: Generic step is tested once, works everywhere
6. **Maintainable**: Changes to apply logic happen in one place

## Comparison Summary

| Aspect | Java (Cloud) | Go (OSS) |
|--------|-------------|----------|
| Generic step | ✅ `ApplyOperationLoadExistingStepV2` | ✅ `LoadForApplyStep` |
| Delegates to create/update | ✅ Yes | ✅ Yes |
| Context flags | ✅ `shouldCreate()` | ✅ `ShouldCreateKey` |
| No code duplication | ✅ Yes | ✅ Yes |
| Reusable across resources | ✅ Yes | ✅ Yes |

Both implementations achieve the same goal: **generic, reusable apply operation with zero code duplication**.
