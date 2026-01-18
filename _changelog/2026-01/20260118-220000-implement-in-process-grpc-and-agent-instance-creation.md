# Implement In-Process gRPC Calls and Agent Instance Creation

**Date**: 2026-01-18
**Type**: Feature Implementation
**Scope**: Backend Controllers, Store Interface
**Impact**: High - Completes agent creation pipeline with automatic default instance creation

## Summary

Implemented in-process gRPC pattern in Go (aligned with Stigmer Cloud's Java implementation) and completed the agent instance creation workflow. This enables automatic default instance creation when agents are created, matching the behavior of Stigmer Cloud.

## What Was Implemented

### 1. Agent Instance Controller

**Location**: `backend/services/stigmer-server/pkg/controllers/agentinstance/`

Created a complete gRPC controller for AgentInstance resources following the established pipeline pattern:

- **`agentinstance_controller.go`**: Controller struct with BadgerDB store
- **`create.go`**: Create pipeline with 5 standard steps
- **`README.md`**: Comprehensive documentation

**Pipeline**:
1. ValidateFieldConstraints - Validate proto constraints using buf
2. ResolveSlug - Generate slug from metadata.name  
3. CheckDuplicate - Ensure no duplicate instance exists
4. SetDefaults - Set ID, kind, api_version, timestamps
5. Persist - Save to BadgerDB

### 2. In-Process gRPC Client

**Location**: `backend/services/stigmer-server/pkg/downstream/agentinstance/`

Implemented downstream client pattern (equivalent to Java's `AgentInstanceGrpcRepoImpl`):

```go
type Client struct {
    controller agentinstancev1.AgentInstanceCommandControllerServer
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    // Direct call to controller (in-process, zero overhead)
    return c.controller.Create(ctx, instance)
}
```

**Key differences from Java**:
- **Java**: Uses in-process gRPC channel with interceptors
- **Go**: Direct controller method calls (simpler, zero overhead)
- **Both**: Achieve same goal - cross-domain calls with system privileges

### 3. Agent Creation Pipeline Steps

**Location**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`

Added two new pipeline steps (8 and 9) to complete agent creation:

#### Step 8: CreateDefaultInstance

- Builds AgentInstance request with default configuration
- Uses downstream client for in-process call
- Stores instance ID in context for next step

**Default instance characteristics**:
- Name: `{agent-slug}-default`
- No environment variables (empty configuration)
- Minimal working instance for testing/basic usage

#### Step 9: UpdateAgentStatusWithDefaultInstance

- Reads instance ID from context
- Updates `agent.status.default_instance_id`
- Persists updated agent to BadgerDB
- Updates context for response

### 4. Store Interface Update

**Location**: `backend/libs/go/store/interface.go`

Updated store interface to match BadgerDB's "Kind/ID" key pattern (from ADR-005-Revised):

**Changes**:
- `GetResource(ctx, kind, id, msg)` - Added `kind` parameter
- `DeleteResource(ctx, kind, id)` - Added `kind` parameter
- Removed `ListResourcesByOrg()` - Not needed for local-only BadgerDB

**Fixed**:
- `agent/delete.go` - Updated to use new signatures
- `agent/query.go` - Updated to use new signatures, removed org filtering

### 5. Main Wiring

**Location**: `backend/services/stigmer-server/cmd/server/main.go`

Wired all components together:

```go
// Create AgentInstance controller
agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)
agentinstancev1.RegisterAgentInstanceQueryServiceServer(grpcServer, agentInstanceController)

// Create in-process client
agentInstanceClient := agentinstanceclient.NewClient(agentInstanceController)

// Inject client into Agent controller
agentController := agent.NewAgentController(store, agentInstanceClient)
```

## Agent Creation Flow

When a user creates an agent:

```
1. User creates Agent via gRPC
   ↓
2. Agent Create Pipeline:
   - ValidateFieldConstraints
   - ResolveSlug
   - CheckDuplicate
   - SetDefaults (generates agent ID)
   - Persist (save agent to BadgerDB)
   ↓
3. CreateDefaultInstance:
   - Build AgentInstance request
   - Call agentInstanceClient.CreateAsSystem()
   - AgentInstance pipeline executes (Validate → Persist)
   - Store instance ID in context
   ↓
4. UpdateAgentStatusWithDefaultInstance:
   - Read instance ID from context
   - Update agent.status.default_instance_id
   - Persist updated agent
   ↓
5. Return Agent with default_instance_id populated
```

## Architecture Decisions

### In-Process Communication Pattern

**Decision**: Use direct controller method calls instead of in-process gRPC channels

**Rationale**:
- Simpler implementation (no channel setup needed)
- Zero overhead (direct function calls)
- Easier to test (no gRPC infrastructure)
- Migration-ready (interface stays same when moving to network gRPC)

**Trade-offs**:
- ✅ Simplicity and performance
- ❌ Requires refactoring when splitting to microservices (but interface doesn't change)

### Store Interface Update

**Decision**: Add `kind` parameter to GetResource and DeleteResource

**Rationale**:
- Aligns with BadgerDB's "Kind/ID" key pattern
- Makes queries more explicit and correct
- Prevents ambiguity in resource lookups

**Impact**:
- Updated agent controller methods to pass kind explicitly
- Removed org-based filtering (not needed for local-only database)

## Files Created

**New controllers**:
- `backend/services/stigmer-server/pkg/controllers/agentinstance/agentinstance_controller.go`
- `backend/services/stigmer-server/pkg/controllers/agentinstance/create.go`
- `backend/services/stigmer-server/pkg/controllers/agentinstance/README.md`

**New downstream client**:
- `backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`
- `backend/services/stigmer-server/pkg/downstream/agentinstance/README.md`

**Documentation**:
- `docs/adr/20260118-214000-in-process-grpc-calls-and-agent-instance-creation.md`

## Files Modified

**Controller updates**:
- `backend/services/stigmer-server/pkg/controllers/agent/agent_controller.go` - Added client field
- `backend/services/stigmer-server/pkg/controllers/agent/create.go` - Implemented steps 8-9
- `backend/services/stigmer-server/pkg/controllers/agent/delete.go` - Updated store calls
- `backend/services/stigmer-server/pkg/controllers/agent/query.go` - Updated store calls, removed org filtering

**Infrastructure**:
- `backend/services/stigmer-server/cmd/server/main.go` - Wired client and controllers
- `backend/libs/go/store/interface.go` - Updated for BadgerDB key pattern

## Testing

**Build verification**:
```bash
cd backend/services/stigmer-server && go build ./...
# Exit code: 0 ✓
```

**Integration testing needed**:
1. Start stigmer-server
2. Create an agent via gRPC
3. Verify default instance created in BadgerDB
4. Verify agent.status.default_instance_id populated

## Alignment with Stigmer Cloud

This implementation maintains architectural parity with Stigmer Cloud while adapting to Go idioms:

| Aspect | Stigmer Cloud (Java) | Stigmer OSS (Go) |
|--------|---------------------|------------------|
| Pattern | In-process gRPC with system channel | Direct controller calls |
| Overhead | Minimal | Zero |
| Complexity | Higher (interceptors, channels) | Lower (direct injection) |
| Goal | Cross-domain system calls | Cross-domain system calls |

## Benefits

1. **Feature parity** - Agent creation now matches Stigmer Cloud behavior
2. **Clean architecture** - Domain separation maintained via downstream client
3. **Zero overhead** - Direct function calls (no gRPC marshaling)
4. **Testability** - Easy to mock client interface
5. **Migration-ready** - Interface unchanged when moving to microservices

## Impact

**User experience**:
- Every agent automatically gets a working default instance
- No manual instance creation needed for basic usage
- Consistent behavior with Stigmer Cloud

**Developer experience**:
- Clear pattern for cross-domain calls
- Comprehensive documentation (READMEs + ADR)
- Easy to extend for other resource types

## Future Work

1. **Query methods** - Implement Get, GetByAgent, GetByReference for AgentInstance
2. **Update/Delete** - Implement remaining CRUD operations
3. **Authentication** - Add system context when auth system ready
4. **Network migration** - Replace direct calls with gRPC client stubs when splitting services

## Related

- **ADR-005-Revised**: BadgerDB schema with "Kind/ID" keys
- **ADR-20260118-214000**: In-Process gRPC Calls architecture decision
- **Proto**: `agent/v1/status.proto` (default_instance_id field)
- **Proto**: `agentinstance/v1/spec.proto` (agent_id reference)
- **Stigmer Cloud**: `AgentCreateHandler.java` (reference implementation)

---

**Status**: ✅ Complete - Build passing, ready for integration testing
