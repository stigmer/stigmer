# ADR: In-Process gRPC Calls and Agent Instance Creation

**Date**: 2026-01-18
**Status**: Implemented
**Related**: ADR-005-Revised (BadgerDB Schema)

## Context

When creating an Agent, we need to automatically create a default AgentInstance. This requires:

1. **Cross-domain communication** - Agent controller needs to call AgentInstance controller
2. **System-level privileges** - Default instance creation should bypass user permissions
3. **Domain separation** - Agent domain shouldn't directly depend on AgentInstance domain
4. **Alignment with Stigmer Cloud** - Match Java implementation patterns

In Stigmer Cloud (Java), this is handled via `AgentInstanceGrpcRepo` using in-process gRPC channels with system credentials.

## Decision

Implement in-process gRPC pattern in Go using direct controller method calls.

### Pattern

```
Agent Creation Pipeline
  │
  ├─ Step 8: CreateDefaultInstance
  │    └─ Uses: agentinstance.Client (downstream)
  │         └─ Calls: AgentInstanceController.Create()
  │
  └─ Step 9: UpdateAgentStatusWithDefaultInstance
       └─ Updates agent.status.default_instance_id
       └─ Persists updated agent to BadgerDB
```

### Key Differences from Java

| Aspect | Java (Stigmer Cloud) | Go (Stigmer OSS) |
|--------|---------------------|------------------|
| **Mechanism** | In-process gRPC channel (`inProcessChannelAsSystem`) | Direct controller method call |
| **Overhead** | Minimal (in-process) | Zero (direct function call) |
| **Authentication** | Interceptor injects machine account token | Context-based (future) |
| **Complexity** | Higher (channel setup, interceptors) | Lower (direct injection) |

Both achieve the same goal: **zero-overhead cross-domain calls with system privileges**.

## Implementation

### 1. Agent Instance Controller

**File**: `backend/services/stigmer-server/pkg/controllers/agentinstance/`

Created a standard gRPC controller following the same pattern as Agent:

```go
type AgentInstanceController struct {
    agentinstancev1.UnimplementedAgentInstanceCommandControllerServer
    agentinstancev1.UnimplementedAgentInstanceQueryServiceServer
    store *badger.Store
}

func (c *AgentInstanceController) Create(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    reqCtx := pipeline.NewRequestContext(ctx, instance)
    p := c.buildCreatePipeline()
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    return reqCtx.NewState(), nil
}
```

**Pipeline**:
1. ValidateFieldConstraints
2. ResolveSlug
3. CheckDuplicate
4. SetDefaults
5. Persist

### 2. Downstream Client

**File**: `backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`

Provides in-process calls to AgentInstance controller:

```go
type Client struct {
    controller agentinstancev1.AgentInstanceCommandControllerServer
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    // Direct call to controller (in-process, system context)
    return c.controller.Create(ctx, instance)
}
```

This is analogous to `AgentInstanceGrpcRepoImpl` in Java.

### 3. Agent Pipeline Steps

**File**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`

Added two new pipeline steps:

#### Step 8: CreateDefaultInstance

```go
type createDefaultInstanceStep struct {
    controller *AgentController
}

func (s *createDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
    agent := ctx.NewState()
    
    // 1. Build default instance request
    defaultInstanceName := agent.GetMetadata().GetName() + "-default"
    instanceRequest := &agentinstancev1.AgentInstance{
        ApiVersion: "agentic.stigmer.ai/v1",
        Kind:       "AgentInstance",
        Metadata:   &apiresource.ApiResourceMetadata{
            Name:       defaultInstanceName,
            OwnerScope: agent.GetMetadata().GetOwnerScope(),
        },
        Spec: &agentinstancev1.AgentInstanceSpec{
            AgentId:     agent.GetMetadata().GetId(),
            Description: "Default instance (auto-created, no custom configuration)",
        },
    }
    
    // 2. Create via downstream client (in-process, system credentials)
    createdInstance, err := s.controller.agentInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
    if err != nil {
        return fmt.Errorf("failed to create default instance: %w", err)
    }
    
    // 3. Store instance ID in context for next step
    ctx.Set(DefaultInstanceIDKey, createdInstance.GetMetadata().GetId())
    
    return nil
}
```

#### Step 9: UpdateAgentStatusWithDefaultInstance

```go
type updateAgentStatusWithDefaultInstanceStep struct {
    controller *AgentController
}

func (s *updateAgentStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
    agent := ctx.NewState()
    
    // 1. Read default instance ID from context
    defaultInstanceID := ctx.Get(DefaultInstanceIDKey).(string)
    
    // 2. Update agent status
    if agent.Status == nil {
        agent.Status = &agentv1.AgentStatus{}
    }
    agent.Status.DefaultInstanceId = defaultInstanceID
    
    // 3. Persist updated agent
    kind := apiresourcekind.ApiResourceKind_agent.String()
    if err := s.controller.store.SaveResource(ctx.Context(), kind, agent.GetMetadata().GetId(), agent); err != nil {
        return fmt.Errorf("failed to persist agent with default instance: %w", err)
    }
    
    // 4. Update context for response
    ctx.SetNewState(agent)
    
    return nil
}
```

### 4. Wiring in main.go

```go
// Create AgentInstance controller
agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)
agentinstancev1.RegisterAgentInstanceQueryServiceServer(grpcServer, agentInstanceController)

// Create in-process client for downstream calls
agentInstanceClient := agentinstanceclient.NewClient(agentInstanceController)

// Inject client into Agent controller
agentController := agent.NewAgentController(store, agentInstanceClient)
agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)
```

### 5. Store Interface Update

**File**: `backend/libs/go/store/interface.go`

Updated to match BadgerDB implementation:

```go
type Store interface {
    SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error
    GetResource(ctx context.Context, kind string, id string, msg proto.Message) error  // Added kind param
    ListResources(ctx context.Context, kind string) ([][]byte, error)
    DeleteResource(ctx context.Context, kind string, id string) error  // Added kind param
    DeleteResourcesByKind(ctx context.Context, kind string) error
    Close() error
}
```

This aligns with the "Kind/ID" key pattern from ADR-005-Revised.

## Agent Creation Flow

```
User creates Agent
  ↓
1. ValidateFieldConstraints
2. ResolveSlug
3. CheckDuplicate
4. SetDefaults (generates agent ID)
5. Persist (save agent to BadgerDB)
  ↓
6. CreateDefaultInstance
   ├─ Build AgentInstance request
   │  └─ Name: {agent-slug}-default
   │  └─ Spec: agent_id={agent-id}, no environments
   ├─ Call agentInstanceClient.CreateAsSystem()
   │  └─ Runs AgentInstance creation pipeline
   │     ├─ Validate, ResolveSlug, CheckDuplicate
   │     ├─ SetDefaults (generates instance ID)
   │     └─ Persist (save instance to BadgerDB)
   └─ Store instance ID in context
  ↓
7. UpdateAgentStatusWithDefaultInstance
   ├─ Read instance ID from context
   ├─ Update agent.status.default_instance_id
   └─ Persist updated agent to BadgerDB
  ↓
8. Return created agent (with default_instance_id in status)
```

## Example

```
Agent Created:
{
  "metadata": {
    "id": "agent-abc123",
    "name": "code-reviewer",
    ...
  },
  "status": {
    "default_instance_id": "agentinstance-xyz789",
    ...
  }
}

Default Instance Created:
{
  "metadata": {
    "id": "agentinstance-xyz789",
    "name": "code-reviewer-default",
    ...
  },
  "spec": {
    "agent_id": "agent-abc123",
    "description": "Default instance (auto-created, no custom configuration)",
    "environment_refs": []  // Empty - no custom config
  }
}
```

## Benefits

1. **Clean domain separation** - Agent doesn't import AgentInstance domain
2. **Zero overhead** - Direct function calls (no gRPC marshaling)
3. **Testability** - Easy to mock the client interface
4. **Migration-ready** - Can swap with network gRPC when splitting to microservices
5. **Aligned with Stigmer Cloud** - Same architectural pattern, adapted for Go

## Trade-offs

### vs Direct Import
- **Pro**: Maintains domain boundaries, easier to split to microservices
- **Con**: Slightly more code (client + interface)

### vs Network gRPC
- **Pro**: Zero overhead, simpler setup
- **Con**: Requires refactoring when splitting services (but interface stays the same)

## Future Work

1. **Authentication context**: Pass system identity in context (when auth system ready)
2. **Network migration**: Replace direct calls with gRPC client stubs
3. **Error handling**: Custom error types for better debugging
4. **Metrics**: Track in-process call performance

## Migration to Microservices

When splitting Agent and AgentInstance into separate services:

**Before (current)**:
```go
type Client struct {
    controller agentinstancev1.AgentInstanceCommandControllerServer
}
```

**After (microservices)**:
```go
type Client struct {
    conn *grpc.ClientConn
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    stub := agentinstancev1.NewAgentInstanceCommandControllerClient(c.conn)
    return stub.Create(ctx, instance)
}
```

Calling code remains unchanged - only the client implementation changes.

## References

- **Stigmer Cloud**: `AgentCreateHandler.java` (lines 222-304)
- **Stigmer Cloud**: `AgentInstanceGrpcRepoImpl.java`
- **ADR-005-Revised**: BadgerDB schema with "Kind/ID" keys
- **Proto**: `agent/v1/status.proto` (default_instance_id field)
- **Proto**: `agentinstance/v1/spec.proto` (agent_id reference)

## Implementation Status

- ✅ AgentInstance controller created
- ✅ Downstream client implemented
- ✅ Agent pipeline steps added (CreateDefaultInstance, UpdateAgentStatusWithDefaultInstance)
- ✅ Store interface updated for BadgerDB
- ✅ Main.go wiring completed
- ✅ Build verified (no compilation errors)
- ✅ Documentation (READMEs for new packages)

## Files Changed

**New files**:
- `backend/services/stigmer-server/pkg/controllers/agentinstance/agentinstance_controller.go`
- `backend/services/stigmer-server/pkg/controllers/agentinstance/create.go`
- `backend/services/stigmer-server/pkg/controllers/agentinstance/README.md`
- `backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`
- `backend/services/stigmer-server/pkg/downstream/agentinstance/README.md`

**Modified files**:
- `backend/services/stigmer-server/pkg/controllers/agent/agent_controller.go` (added client field)
- `backend/services/stigmer-server/pkg/controllers/agent/create.go` (implemented steps 8-9)
- `backend/services/stigmer-server/pkg/controllers/agent/delete.go` (updated store calls)
- `backend/services/stigmer-server/pkg/controllers/agent/query.go` (updated store calls)
- `backend/services/stigmer-server/cmd/server/main.go` (wired client and controller)
- `backend/libs/go/store/interface.go` (updated for BadgerDB)

## Testing

Builds successfully:
```bash
cd backend/services/stigmer-server && go build ./...
# Exit code: 0 ✓
```

Next steps for manual testing:
1. Start stigmer-server
2. Create an agent via gRPC
3. Verify default instance created in BadgerDB
4. Verify agent.status.default_instance_id populated

---

**Author**: Claude (with user Suresh)
**Implementation Date**: 2026-01-18
**Build Status**: ✅ Passing
