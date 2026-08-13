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

### ValidateVisibilityStep

Rejects visibility levels the resource kind does not support, derived from the
kind's proto `VisibilityConfig` (`apiresource.SupportsVisibility`). PRIVATE and
UNSPECIFIED always pass. The Go analog of Cloud's `ValidateVisibilityStep`,
emitting the same INVALID_ARGUMENT message so both editions share one error
contract.

**Usage:**

```go
pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
    AddStep(steps.NewValidateVisibilityStep[*agentv1.Agent]()). // directly after proto validation, as in Cloud
    ...
```

**Where it is wired:** every create pipeline — and only create pipelines.
Plain updates preserve the stored visibility unconditionally
(`preserveImmutableFields`, oss#573), so there is no update-side level to
validate; the `updateVisibility` RPC is the only door for visibility changes.
It reads the request's embedded metadata, so it only fits pipelines whose
request IS the resource; UpdateVisibility pipelines use
`ValidateVisibilityUpdateStep` instead.

**Deliberate divergences from Cloud** (recorded in the step doc): no
platform-anchor check (OSS has no IdentityProvider domain) and no wiring in
skill push (Cloud's push handler doesn't validate either, and skills support
every level — a check there would be dead code).

### ValidateVisibilityUpdateStep

The UpdateVisibility counterpart: validates `UpdateVisibilityInput.visibility`
(the input carries no metadata, so the create-side step would be a silent
no-op). Place it AFTER the handler's load step so an unknown resource_id
returns NOT_FOUND before INVALID_ARGUMENT — Cloud's ordering.

**Usage:**

```go
pipeline := pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("agent-update-visibility").
    AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
    AddStep(c.newLoadAgentForVisibilityUpdateStep()).
    AddStep(steps.NewValidateVisibilityUpdateStep()).
    ...
```

**Deliberate divergence from Cloud** (recorded in the step doc): the
default-instance guard is not folded into this step. It lives as a domain
step in the two instance controllers (`RejectDefaultInstanceVisibilityUpdate`,
shipped for oss#556), placed BEFORE this step to preserve Cloud's error
precedence.

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

Verify that data meets certain criteria before proceeding. Return a **typed
gRPC status error** for any client-reachable condition — never a bare
`fmt.Errorf`, which the transport would surface as `codes.Unknown`. See the
[Error contract](#error-contract) below.

```go
func (s *CheckDuplicateStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    name := extractName(ctx.Input())

    exists, err := s.store.Exists(name)
    if err != nil {
        // Infrastructure failure the caller cannot act on -> Internal.
        return grpclib.InternalError(err, "failed to check for duplicates")
    }

    if exists {
        // Client-facing contract condition -> AlreadyExists.
        return grpclib.AlreadyExistsError("Resource", name)
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

    org, err := s.orgStore.Get(ctx.Context(), orgId)
    if err != nil {
        // A missing referenced org is a client-facing condition -> NotFound.
        return grpclib.NotFoundError("Organization", orgId)
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
        // Invariant violation: an earlier step must have produced state. This
        // is a server bug, not bad input. A bare fmt.Errorf is acceptable here
        // ONLY because PipelineError maps un-statused errors to Internal (never
        // Unknown) -- see the Error contract. Prefer grpclib.InternalError for
        // an explicit code.
        return grpclib.InternalError(errors.New("no resource to persist"), "persist")
    }

    if err := s.store.SaveResource(ctx.Context(), kind, id, resource); err != nil {
        return grpclib.InternalError(err, "failed to persist resource")
    }

    return nil
}
```

## Step Best Practices

1. **Single Responsibility** - Each step should do one thing well
2. **Idempotent** - Steps should be safe to retry
3. **Clear Names** - Use descriptive names that explain what the step does
4. **Typed Errors** - Return a typed gRPC status error (see [Error contract](#error-contract)) for every client-reachable condition, never a bare `fmt.Errorf`
5. **Minimal Side Effects** - Avoid side effects outside of persistence steps
6. **Context Usage** - Use context.Set() to share data between steps
7. **Fail Fast** - Return errors immediately on failure
8. **Logging** - The pipeline framework handles logging, steps don't need to log

## Error contract

A step's return value becomes the RPC's gRPC status. The rule is simple and
non-negotiable:

- **Client-reachable conditions must return a typed status error** via the
  `grpclib` helpers, so the caller (CLI, web, SDK) gets an actionable code:
  - `grpclib.AlreadyExistsError` for duplicates -> `codes.AlreadyExists`
  - `grpclib.InvalidArgumentError` for bad input -> `codes.InvalidArgument`
  - `grpclib.NotFoundError` for a missing referenced resource -> `codes.NotFound`
  - `grpclib.FailedPreconditionError` for a violated precondition -> `codes.FailedPrecondition`
  - `grpclib.InternalError` for infrastructure/IO failures -> `codes.Internal`
- **A bare `fmt.Errorf` is acceptable only for should-never-happen invariants**
  (e.g. "resource metadata is nil", "…must run first"). These are server bugs,
  not client input.

Why this matters: the pipeline wraps every step error in `PipelineError`, which
implements `GRPCStatus()`. It **preserves** any typed status a step returns and
**maps un-statused errors to `codes.Internal`** — so a bare error can never leak
to the client as `codes.Unknown` (gRPC's "an error escaped without a status"
sentinel). Prefer an explicit `grpclib.InternalError` over relying on this
fallback; the fallback exists as defense in depth, not as license to skip typing.

This was the root cause of a real, broad contract bug: a shared step returning
`fmt.Errorf("...already exists")` surfaced as `Unknown` instead of
`AlreadyExists` across every domain's create path. Do not reintroduce it.

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
- Replace dots (namespace separators) with hyphens
- Collapse multiple consecutive hyphens into one
- Trim leading and trailing hyphens
- **No length truncation** — the full slug is preserved to avoid silent collisions where two different names truncate to the same slug (matches the cloud Java generator)

**Examples:**
- "My Cool Agent" → "my-cool-agent"
- "platform.planton-architecture" → "platform-planton-architecture"

**Behavior:**
- Idempotent: If `metadata.slug` is already set, the step is a no-op
- Requires `metadata.name` to be set; an empty name returns `InvalidArgument`

---

### CheckDuplicateStep

Verifies that no resource with the same slug exists in the same scope.

**Usage:**

```go
checkDupStep := steps.NewCheckDuplicateStep[*agentv1.Agent](store)

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(checkDupStep).
    Build()
```

**Scope Checking:**
- **Organization-scoped resources**: Checks within the same organization (uses `metadata.org`)
- **Platform-scoped resources**: Checks globally (when `metadata.org` is empty)

**Error Handling:**
- Returns a typed `codes.AlreadyExists` error if a duplicate is found (message includes the existing resource's slug, org, and id)

**Dependencies:**
- Requires a `store.Store` instance
- Should run after `ResolveSlugStep` to ensure the slug is set
- `api_resource_kind` is auto-extracted from the request context by the apiresource interceptor — it is not a constructor argument

---

### BuildNewStateStep

Builds the new state for a resource during creation: clears the system-managed
`status`, generates `metadata.id`, and sets the audit fields. (This consolidates
what were previously separate `SetDefaults` and `SetAuditFields` steps.)

**Usage:**

```go
buildStep := steps.NewBuildNewStateStep[*agentv1.Agent]()

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(buildStep).
    Build()
```

**Fields Set:**
- Clears `status` (status is system-managed, not client-modifiable)
- `metadata.id`: generated from the kind's prefix + a ULID
  - Format: `{prefix}_{ulid}`
  - Example: `agt_01arz3ndektsv4rrffq69g5fav`
- Audit fields in `status.audit`: `created_by` / `created_at` / `updated_by` / `updated_at` and `event = created`

**Behavior:**
- Idempotent for `metadata.id`: if it is already set, it is not overwritten
- `api_resource_kind` (for the id prefix) is auto-extracted from the request context

---

### PersistStep

Saves the resource to the store (SQLite in OSS).

**Usage:**

```go
persistStep := steps.NewPersistStep[*agentv1.Agent](store)

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(persistStep).
    Build()
```

**Requirements:**
- `metadata.id` must be set (typically by `BuildNewStateStep`)
- Resource should be fully populated with all required fields

**Dependencies:**
- Requires a `store.Store` instance
- Uses the resource kind (from the request context) for storage organization

**Error Handling:**
- Returns `codes.Internal` if the save fails (an infrastructure failure the caller cannot act on)

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

    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
    "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
)

func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    // Set kind and apiVersion before the pipeline
    agent.Kind = "Agent"
    agent.ApiVersion = "agentic.stigmer.ai/v1"

    // Build pipeline. api_resource_kind is auto-extracted from the request
    // context by the apiresource interceptor, so steps take only the store.
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
        AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store)).
        AddStep(steps.NewBuildNewStateStep[*agentv1.Agent]()).
        AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).
        Build()

    // Execute pipeline
    reqCtx := pipeline.NewRequestContext(ctx, agent)
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }

    return reqCtx.NewState(), nil
}
```

## Update Pipeline Example

For update operations, use a different set of steps (no slug resolution, no
duplicate check, no ID generation; load the existing resource and merge):

```go
func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-update").
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
        AddStep(steps.NewLoadExistingStep[*agentv1.Agent](c.store)).
        AddStep(steps.NewBuildUpdateStateStep[*agentv1.Agent]()).
        AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).
        Build()

    reqCtx := pipeline.NewRequestContext(ctx, agent)
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }

    return reqCtx.NewState(), nil
}
```

## Future Steps

Planned steps to be implemented:

- **PublishEventStep** - Publish domain events for async processing (no-op initially)
