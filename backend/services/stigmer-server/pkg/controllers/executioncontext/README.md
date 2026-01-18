# ExecutionContext Controller

gRPC controller for managing ExecutionContext resources in Stigmer OSS.

## Overview

The ExecutionContext controller implements CRUD operations for ephemeral runtime configuration and secrets that:
- Contain runtime configuration and secrets injected at execution time
- Are created by the execution engine when execution starts
- Are deleted when execution completes (workflow/agent execution)
- Are platform-scoped (operator-only resources)

## Architecture

### Resource Characteristics

**ExecutionContext is:**
- **Ephemeral** - Created at execution start, deleted at execution end
- **Operator-only** - Only platform operators can create/read/delete
- **Platform-scoped** - owner_scope=unspecified (not org or environment scoped)
- **Create-only** - No update operations (apply only creates, doesn't update)
- **Secret-capable** - Can store sensitive data (API keys, credentials, tokens)

### File Organization

```
executioncontext/
├── executioncontext_controller.go  # Controller struct + constructor
├── create.go                       # Create handler + pipeline
├── apply.go                        # Apply handler (create-only, no update)
├── delete.go                       # Delete handler + pipeline
├── get.go                          # Get by ID handler + pipeline
├── get_by_reference.go             # Get by slug handler + pipeline
└── README.md                       # This file
```

## Handler Implementations

### Create

Creates a new execution context for a workflow or agent execution.

**Pipeline:**
1. **ValidateProto** - Validate field constraints (owner_scope must be unspecified)
2. **ResolveSlug** - Generate slug from metadata.name
3. **CheckDuplicate** - Verify no duplicate exists
4. **BuildNewState** - Generate ID, timestamps, audit fields
5. **Persist** - Save to BadgerDB

**Usage:**
```go
executionContext := &executioncontextv1.ExecutionContext{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind: "ExecutionContext",
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "workflow-exec-123-ctx",
        OwnerScope: apiresource.ApiResourceOwnerScope_owner_scope_unspecified,
    },
    Spec: &executioncontextv1.ExecutionContextSpec{
        ExecutionId: "workflow-exec-123",
        Data: map[string]*executioncontextv1.ExecutionValue{
            "AWS_ACCESS_KEY_ID": {
                Value: "AKIA...",
                IsSecret: true,
            },
            "REGION": {
                Value: "us-west-2",
                IsSecret: false,
            },
        },
    },
}

created, err := controller.Create(ctx, executionContext)
```

### Apply

Applies an execution context (create-only, no update support).

**Behavior:**
- If context doesn't exist → delegates to Create()
- If context exists → returns AlreadyExists error

**Why no update?**
ExecutionContext is immutable once created. If execution needs different config, it should create a new context with a different name.

**Pipeline:**
1. **ValidateProto** - Validate input
2. **ResolveSlug** - Generate slug
3. **LoadForApply** - Check if exists
4. **Delegate** - Create if not exists, error if exists

### Delete

Deletes an execution context (typically called when execution completes).

**Pipeline:**
1. **ValidateProto** - Validate delete input
2. **ExtractResourceId** - Extract ID from ApiResourceDeleteInput
3. **LoadExistingForDelete** - Load context before deletion
4. **DeleteResource** - Remove from BadgerDB

**Usage:**
```go
deleteInput := &apiresource.ApiResourceDeleteInput{
    Id: "ec-abc123",
}

deleted, err := controller.Delete(ctx, deleteInput)
```

### Get

Retrieves an execution context by ID.

**Pipeline:**
1. **ValidateProto** - Validate ExecutionContextId
2. **LoadTarget** - Load from BadgerDB by ID

**Usage:**
```go
executionContextId := &executioncontextv1.ExecutionContextId{
    Value: "ec-abc123",
}

executionContext, err := controller.Get(ctx, executionContextId)
```

### GetByReference

Retrieves an execution context by slug (name).

**Pipeline:**
1. **ValidateProto** - Validate ApiResourceReference
2. **LoadByReference** - Load from BadgerDB by slug

**Usage:**
```go
ref := &apiresource.ApiResourceReference{
    Kind: apiresourcekind.ApiResourceKind_execution_context,
    Slug: "workflow-exec-123-ctx",
}

executionContext, err := controller.GetByReference(ctx, ref)
```

## Pipeline Pattern

All handlers use the **pipeline pattern** for consistency, observability, and reusability.

### Why Pipeline for Everything?

- ✅ **Consistency** - All handlers follow the same pattern
- ✅ **Observability** - Built-in tracing and logging
- ✅ **Reusability** - Common steps shared across resources
- ✅ **Extensibility** - Easy to add/remove/reorder steps
- ✅ **Testability** - Each step can be tested independently

### Standard Pipeline Steps

All steps are from `backend/libs/go/grpc/request/pipeline/steps/`:

- **ValidateProtoStep** - Validates buf.validate constraints
- **ResolveSlugStep** - Generates slug from metadata.name
- **CheckDuplicateStep** - Verifies no duplicate slug exists
- **BuildNewStateStep** - Sets ID, kind, api_version, timestamps
- **PersistStep** - Saves to BadgerDB
- **LoadTargetStep** - Loads resource by ID
- **LoadByReferenceStep** - Loads resource by slug
- **LoadExistingForDeleteStep** - Loads before deletion
- **DeleteResourceStep** - Deletes from BadgerDB
- **ExtractResourceIdStep** - Extracts ID from wrapper types

## Differences from Stigmer Cloud

| Aspect | Stigmer Cloud (Java) | Stigmer OSS (Go) |
|--------|---------------------|------------------|
| **Authorization** | Platform operator check | None (single-user local) |
| **IAM Policies** | None (operator-only resource) | None |
| **Event Publishing** | Publishes events | None |
| **Response Transform** | Applies transformations | None |
| **Storage** | MongoDB | BadgerDB |
| **Context Pattern** | Specialized contexts per operation | Single RequestContext |

## Use Cases

### 1. Workflow Execution with Runtime Secrets

```go
// Execution engine creates context at workflow start
executionContext := &executioncontextv1.ExecutionContext{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: fmt.Sprintf("wf-exec-%s-ctx", workflowExecutionId),
        OwnerScope: apiresource.ApiResourceOwnerScope_owner_scope_unspecified,
    },
    Spec: &executioncontextv1.ExecutionContextSpec{
        ExecutionId: workflowExecutionId,
        Data: map[string]*executioncontextv1.ExecutionValue{
            "PLANTON_CLOUD_API_KEY": {Value: "...", IsSecret: true},
            "ENVIRONMENT": {Value: "production", IsSecret: false},
        },
    },
}

created, _ := controller.Create(ctx, executionContext)

// ... workflow executes, accesses secrets via context ...

// Execution engine deletes context at workflow completion
deleteInput := &apiresource.ApiResourceDeleteInput{Id: created.Metadata.Id}
controller.Delete(ctx, deleteInput)
```

### 2. Agent Execution with B2B Credentials

```go
// B2B platform injects customer credentials
executionContext := &executioncontextv1.ExecutionContext{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: fmt.Sprintf("agent-exec-%s-ctx", agentExecutionId),
        OwnerScope: apiresource.ApiResourceOwnerScope_owner_scope_unspecified,
    },
    Spec: &executioncontextv1.ExecutionContextSpec{
        ExecutionId: agentExecutionId,
        Data: map[string]*executioncontextv1.ExecutionValue{
            "CUSTOMER_API_TOKEN": {Value: customerToken, IsSecret: true},
            "CUSTOMER_ORG_ID": {Value: customerOrgId, IsSecret: false},
        },
    },
}

created, _ := controller.Create(ctx, executionContext)

// Agent execution retrieves context
retrieved, _ := controller.Get(ctx, &executioncontextv1.ExecutionContextId{
    Value: created.Metadata.Id,
})

// Access secrets from retrieved.Spec.Data
apiToken := retrieved.Spec.Data["CUSTOMER_API_TOKEN"].Value
```

## Security Considerations

### Platform-Scoped Only

ExecutionContext **must** have `owner_scope=unspecified` (platform-scoped).
Proto validation enforces this constraint.

### Operator-Only Access

In Stigmer Cloud, only platform operators can create/read/delete execution contexts.
In Stigmer OSS (single-user local), there's no authorization check.

### Ephemeral Lifecycle

Execution contexts should be:
- Created at execution start
- Deleted at execution completion
- Never persisted long-term

### Secret Storage

Secrets in `ExecutionContextSpec.Data` are:
- Stored in BadgerDB (local file-based storage)
- Not encrypted at rest in OSS (single-user local environment)
- Marked with `is_secret: true` for visibility/tooling

**Production Note:** If deploying Stigmer OSS in production, consider:
- Encrypting BadgerDB storage at rest
- Using external secret management (Vault, AWS Secrets Manager)
- Implementing proper access controls

## Testing

### Unit Tests

Test each handler independently:

```go
func TestExecutionContextController_Create(t *testing.T) {
    store := setupTestStore(t)
    defer store.Close()
    
    ctrl := NewExecutionContextController(store)
    
    executionContext := &executioncontextv1.ExecutionContext{
        Metadata: &apiresource.ApiResourceMetadata{
            Name: "test-ctx",
            OwnerScope: apiresource.ApiResourceOwnerScope_owner_scope_unspecified,
        },
        Spec: &executioncontextv1.ExecutionContextSpec{
            ExecutionId: "exec-123",
            Data: map[string]*executioncontextv1.ExecutionValue{
                "KEY": {Value: "value", IsSecret: false},
            },
        },
    }
    
    result, err := ctrl.Create(context.Background(), executionContext)
    
    assert.NoError(t, err)
    assert.NotNil(t, result)
    assert.NotEmpty(t, result.Metadata.Id)
}
```

### Integration Tests

Test full lifecycle (create → get → delete):

```go
func TestExecutionContextLifecycle(t *testing.T) {
    store := setupTestStore(t)
    defer store.Close()
    
    ctrl := NewExecutionContextController(store)
    
    // 1. Create
    created, err := ctrl.Create(ctx, executionContext)
    require.NoError(t, err)
    
    // 2. Get by ID
    retrieved, err := ctrl.Get(ctx, &executioncontextv1.ExecutionContextId{
        Value: created.Metadata.Id,
    })
    require.NoError(t, err)
    assert.Equal(t, created.Metadata.Id, retrieved.Metadata.Id)
    
    // 3. Get by reference
    byRef, err := ctrl.GetByReference(ctx, &apiresource.ApiResourceReference{
        Slug: created.Metadata.Name,
    })
    require.NoError(t, err)
    assert.Equal(t, created.Metadata.Id, byRef.Metadata.Id)
    
    // 4. Delete
    deleted, err := ctrl.Delete(ctx, &apiresource.ApiResourceDeleteInput{
        Id: created.Metadata.Id,
    })
    require.NoError(t, err)
    assert.Equal(t, created.Metadata.Id, deleted.Metadata.Id)
    
    // 5. Verify deleted
    _, err = ctrl.Get(ctx, &executioncontextv1.ExecutionContextId{
        Value: created.Metadata.Id,
    })
    assert.Error(t, err) // Should return NotFound
}
```

## Future Enhancements

### 1. TTL-based Auto-Cleanup

Add automatic deletion of stale execution contexts:
- Track creation timestamp
- Background job deletes contexts older than TTL (e.g., 24 hours)
- Prevents accumulation of orphaned contexts

### 2. Encryption at Rest

Encrypt secret values in BadgerDB:
- Use libsodium or age for encryption
- Store encrypted values, decrypt on read
- Derive encryption key from platform master key

### 3. Audit Logging

Log all access to execution contexts:
- Who created the context
- When secrets were accessed
- When context was deleted

### 4. Secret Rotation

Support secret rotation during execution:
- Update operation for secrets only
- Notify running executions of rotation
- Graceful handling of stale credentials

## Related Resources

- **Workflow** - Defines workflow templates
- **WorkflowExecution** - Represents running workflow instances
- **Agent** - Defines agent templates
- **AgentExecution** - Represents running agent instances

## References

- [Stigmer OSS Implementation Guide](../../_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc)
- [Pipeline Architecture](../../../../libs/go/grpc/request/pipeline/README.md)
- [BadgerDB Documentation](https://dgraph.io/docs/badger/)
