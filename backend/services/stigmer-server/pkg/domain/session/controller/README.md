# Session Controller

Session handler implementation for Stigmer OSS using the pipeline framework.

## Overview

The Session controller manages conversation sessions with agents. Sessions represent multi-turn conversation threads running against an AgentInstance.

## Architecture

### Pipeline Pattern (ALL Handlers)

**MANDATORY**: Every handler in this controller uses the pipeline pattern - NO EXCEPTIONS.

All handlers follow the composable pipeline architecture:
- **Reusable steps** - Common pipeline steps shared across all resources
- **Custom steps** - Session-specific logic in `steps/` sub-package
- **Observability** - Built-in tracing and logging
- **Testability** - Each step can be tested independently

### File Organization

```
session/
├── session_controller.go        # Controller struct + constructor
├── create.go                     # Create handler + pipeline
├── update.go                     # Update handler + pipeline
├── delete.go                     # Delete handler + pipeline
├── apply.go                      # Apply (upsert) handler + pipeline
├── get.go                        # Get by ID handler + pipeline
├── get_by_reference.go           # Get by slug handler + pipeline
├── list.go                       # List all sessions handler + pipeline
├── list_by_agent.go              # List by agent instance handler + pipeline
├── steps/                        # Session-specific pipeline steps
│   └── filter_by_agent_instance.go
└── README.md                     # This file
```

### Handler Patterns

All handlers follow this structure:

```go
func (c *SessionController) Operation(ctx context.Context, input *Input) (*Output, error) {
    // 1. Create request context
    reqCtx := pipeline.NewRequestContext(ctx, input)
    
    // 2. Build pipeline
    p := c.buildOperationPipeline()
    
    // 3. Execute pipeline
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    
    // 4. Return result from context
    return reqCtx.NewState(), nil  // or retrieve from context
}

func (c *SessionController) buildOperationPipeline() *pipeline.Pipeline[*Input] {
    return pipeline.NewPipeline[*Input]("session-operation").
        AddStep(steps.NewStepOne[*Input]()).
        AddStep(steps.NewStepTwo[*Input]()).
        Build()
}
```

## Operations

### Create

Creates a new session.

**Pipeline:**
1. ValidateProto - Validate buf.validate constraints
2. ResolveSlug - Generate slug from metadata.name
3. CheckDuplicate - Verify no duplicate slug exists
4. BuildNewState - Generate ID, timestamps, audit fields
5. Persist - Save to BadgerDB

**Example:**
```go
session := &sessionv1.Session{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "code-review-session",
        OwnerScope: apiresource.ApiResourceOwnerScope_organization,
        Org: "acme-corp",
    },
    Spec: &sessionv1.SessionSpec{
        AgentInstanceId: "agent-instance-123",
        Subject: "Review PR #456",
    },
}
createdSession, err := controller.Create(ctx, session)
```

**Key Points:**
- Session name becomes slug (normalized, lowercase, hyphenated)
- Agent instance must exist (not validated by pipeline, assumed valid)
- Owner scope can be `organization` or `identity_account` (validated by proto)
- No default instance creation (unlike agents)

### Update

Updates an existing session.

**Pipeline:**
1. ValidateProto - Validate input
2. ResolveSlug - Resolve slug (for fallback lookup)
3. LoadExisting - Load current session from database
4. BuildUpdateState - Merge spec, preserve IDs, update timestamps
5. Persist - Save updated session

**Example:**
```go
session := &sessionv1.Session{
    Metadata: &apiresource.ApiResourceMetadata{
        Id: "session-123",
    },
    Spec: &sessionv1.SessionSpec{
        AgentInstanceId: "agent-instance-123",
        Subject: "Updated subject",
    },
}
updatedSession, err := controller.Update(ctx, session)
```

**Key Points:**
- ID is required for update
- Spec is fully replaced (not field-by-field merge)
- Metadata (ID, slug, timestamps) preserved
- Status preserved

### Delete

Deletes a session by ID.

**Pipeline:**
1. ValidateProto - Validate SessionId
2. ExtractResourceId - Extract ID from wrapper
3. LoadExistingForDelete - Load session before deletion
4. DeleteResource - Delete from database

**Example:**
```go
deletedSession, err := controller.Delete(ctx, &sessionv1.SessionId{Value: "session-123"})
```

**Key Points:**
- Returns the deleted session (gRPC convention)
- No IAM policy cleanup (no IAM in OSS)
- No cascade deletion of child resources (no child resources for sessions)

### Apply (Create or Update)

Upsert operation - creates if not exists, updates if exists.

**Pipeline:**
1. ValidateProto - Validate input
2. ResolveSlug - Generate slug
3. LoadForApply - Try to load existing (by ID or slug)
4. BuildApplyState - Determine create vs update, build state
5. Persist - Save session

**Example:**
```go
session := &sessionv1.Session{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "persistent-session",
    },
    Spec: &sessionv1.SessionSpec{
        AgentInstanceId: "agent-instance-123",
        Subject: "Long-running session",
    },
}
appliedSession, err := controller.Apply(ctx, session)
```

**Key Points:**
- Idempotent - safe to call multiple times
- Useful for declarative configuration
- If ID provided: updates existing or fails
- If no ID: creates or updates by slug

### Get

Retrieves a session by ID.

**Pipeline:**
1. ValidateProto - Validate SessionId
2. LoadTarget - Load from database

**Example:**
```go
session, err := controller.Get(ctx, &sessionv1.SessionId{Value: "session-123"})
```

**Key Points:**
- Fast lookup by ID (primary key)
- Returns NotFound error if missing

### GetByReference

Retrieves a session by slug (name).

**Pipeline:**
1. ValidateProto - Validate ApiResourceReference
2. LoadByReference - Query by slug with org filtering

**Example:**
```go
ref := &apiresource.ApiResourceReference{
    Slug: "code-review-session",
    Org: "acme-corp",  // Optional - filters by org
}
session, err := controller.GetByReference(ctx, ref)
```

**Key Points:**
- Queries by metadata.name (slug)
- If org provided: filters by org
- If org empty: queries platform-scoped sessions
- Slower than Get (not indexed by slug in OSS)

### List

Lists all sessions.

**Pipeline:**
1. ValidateProto - Validate ListSessionsRequest
2. ListAll - Load all sessions from database
3. BuildListResponse - Build SessionList response

**Example:**
```go
sessionList, err := controller.List(ctx, &sessionv1.ListSessionsRequest{})
```

**Key Points:**
- No authorization filtering (OSS is single-user)
- No pagination (returns all sessions)
- Production multi-tenant would filter by IAM permissions

### ListByAgent

Lists sessions for a specific agent instance.

**Pipeline:**
1. ValidateProto - Validate ListSessionsByAgentRequest
2. FilterByAgentInstance - Filter by agent_instance_id (custom step)
3. BuildListResponse - Build SessionList response

**Example:**
```go
sessionList, err := controller.ListByAgent(ctx, &sessionv1.ListSessionsByAgentRequest{
    AgentId: "agent-instance-123",
})
```

**Key Points:**
- Filters sessions where spec.agent_instance_id matches
- In-memory filtering (acceptable for OSS local usage)
- Production would use database query with IAM filtering
- Custom step in `steps/filter_by_agent_instance.go`

## Custom Pipeline Steps

### FilterByAgentInstance

**Location:** `steps/filter_by_agent_instance.go`

**Purpose:** Filter sessions by agent_instance_id for ListByAgent operation.

**Logic:**
1. Extract agent_id from request
2. List all sessions from database
3. Filter where spec.agent_instance_id matches
4. Store filtered list in context

**Production Improvement:**
- Replace in-memory filtering with database query
- Combine with IAM authorization filtering
- Add pagination support

## Comparison: Stigmer Cloud vs Stigmer OSS

### Steps EXCLUDED in OSS (present in Cloud)

| Step | Purpose | Why Excluded |
|------|---------|--------------|
| **Authorize** | Verify caller has permission (can_create/can_edit/can_delete) | OSS is local/single-user |
| **CreateIamPolicies** | Establish ownership in OpenFGA | OSS has no IAM/FGA |
| **CleanupIamPolicies** | Remove FGA tuples on delete | OSS has no IAM/FGA |
| **Publish** | Publish domain events to event bus | OSS has no event system |
| **TransformResponse** | Apply response transformations | OSS returns full resource |

### Steps INCLUDED in both Cloud and OSS

| Step | Purpose | Implementation |
|------|---------|---------------|
| **ValidateProto** | Validate buf.validate constraints | Same |
| **ResolveSlug** | Generate slug from metadata.name | Same |
| **CheckDuplicate** | Verify no duplicate slug | Same (different storage) |
| **BuildNewState** | Generate ID, timestamps, audit fields | Same |
| **Persist** | Save to database | MongoDB (Cloud) vs BadgerDB (OSS) |
| **LoadExisting** | Load resource for update | Same (different storage) |
| **LoadTarget** | Load resource for get | Same (different storage) |

## Session-Specific Characteristics

### No Default Instance Creation

Unlike agents, sessions do NOT create default instances:
- Sessions reference an existing AgentInstance via `spec.agent_instance_id`
- The instance must exist before creating a session
- No additional resources are created during session creation

### Owner Scope Validation

Sessions support two owner scopes (validated by proto):
- `organization` - Scoped to an organization
- `identity_account` - Scoped to an individual user

Platform-scoped sessions are NOT allowed (enforced by buf.validate).

### Thread and Sandbox IDs

Sessions track execution state:
- `spec.thread_id` - Temporal thread ID (generated on first execution)
- `spec.sandbox_id` - Daytona sandbox ID (created on first execution)

These fields are set by the execution controller, not the session controller.

## Error Handling

All errors use `grpclib` helpers for consistent gRPC status codes:

```go
// Invalid input
return nil, grpclib.InvalidArgumentError("field is required")

// Resource not found
return nil, grpclib.NotFoundError("Session", id)

// Resource already exists
return nil, grpclib.AlreadyExistsError("Session", slug)

// Internal server error
return nil, grpclib.InternalError(err, "operation failed")
```

## Testing

### Unit Test Pattern

```go
func TestSessionController_Create(t *testing.T) {
    // Setup
    store := setupTestStore(t)
    defer store.Close()
    
    ctrl := NewSessionController(store)
    
    // Test case
    session := &sessionv1.Session{
        Metadata: &apiresource.ApiResourceMetadata{
            Name: "test-session",
            OwnerScope: apiresource.ApiResourceOwnerScope_organization,
            Org: "test-org",
        },
        Spec: &sessionv1.SessionSpec{
            AgentInstanceId: "agent-instance-123",
            Subject: "Test conversation",
        },
    }
    
    // Execute
    result, err := ctrl.Create(context.Background(), session)
    
    // Assert
    assert.NoError(t, err)
    assert.NotNil(t, result)
    assert.NotEmpty(t, result.Metadata.Id)
    assert.Equal(t, "test-session", result.Metadata.Name)
}
```

## Dependencies

- **BadgerDB Store** - For persistence
- **Pipeline Framework** - For composable request processing
- **gRPC Lib** - For error handling
- **API Resource Interceptor** - For automatic kind extraction

## Registration

In `cmd/server/main.go`:

```go
// Create session controller
sessionCtrl := session.NewSessionController(store)

// Register gRPC services
sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionCtrl)
sessionv1.RegisterSessionQueryControllerServer(grpcServer, sessionCtrl)
```

## Future Enhancements

### When Adding Multi-Tenant Support

1. **Add Authorization**
   - Integrate with OpenFGA or similar
   - Add Authorize steps to all pipelines
   - Filter List operations by authorized IDs

2. **Add IAM Policy Management**
   - CreateIamPolicies step in Create pipeline
   - CleanupIamPolicies step in Delete pipeline
   - Link sessions to owners and organizations

3. **Add Event Publishing**
   - Publish create/update/delete events
   - Enable real-time notifications
   - Support event-driven integrations

### When Scaling

1. **Add Pagination**
   - Support page_size and page_token in List operations
   - Implement cursor-based pagination
   - Add total count tracking

2. **Optimize Queries**
   - Replace in-memory filtering with database queries
   - Add indexes for common query patterns (agent_instance_id, org, etc.)
   - Implement efficient authorization filtering

3. **Add Caching**
   - Cache frequently accessed sessions
   - Invalidate on updates
   - Consider read-through caching

## Related Documentation

- [Agent Controller](../agent/README.md) - Similar resource with more complex creation
- [Pipeline Framework](../../../../libs/go/grpc/request/pipeline/README.md) - Core pipeline architecture
- [Pipeline Steps](../../../../libs/go/grpc/request/pipeline/steps/README.md) - Common reusable steps

## Philosophy

This controller demonstrates the **pipeline pattern applied consistently**:
- Every handler uses pipelines (even simple ones like Delete)
- Steps are composable and reusable
- Custom logic isolated in dedicated steps
- Clear separation of concerns
- Testable at each step level

**Why this matters:**
- Consistency - All handlers follow the same pattern
- Observability - Built-in tracing at each step
- Extensibility - Easy to add/remove/reorder steps
- Maintainability - Clear responsibilities, easy to understand

**This is the foundation for a scalable, maintainable codebase.**
