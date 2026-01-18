# Migrate AgentExecution Controller to In-Process gRPC Calls

**Date**: 2026-01-18  
**Category**: Backend / Controllers  
**Impact**: Architecture - Single Source of Truth  
**Scope**: AgentExecution, Agent, Session controllers

## Summary

Migrated AgentExecutionController from direct BadgerDB store access to in-process gRPC calls for all cross-domain operations (Agent, Session). This ensures single source of truth, proper `api_resource_kind` injection, full validation, and consistent behavior across the system.

## Problem Statement

### Issue 1: Wrong api_resource_kind in Agent Updates

When AgentExecution controller updated agent state (e.g., setting `default_instance_id`), it used direct store access:

```go
// Line 231: Getting api_resource_kind from request context
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
// Returns: AGENT_EXECUTION (current request's kind)
// Expected: AGENT (agent domain's kind)

store.SaveResource(ctx, kind.String(), agentID, agent)
// Saved with wrong kind: "AgentExecution" instead of "Agent"
```

**Impact**: Agent resources were saved with incorrect `api_resource_kind` metadata, breaking queries and domain separation.

### Issue 2: Bypassed Validation and Business Logic

Direct store access bypassed the full gRPC interceptor chain:

```go
// Direct store access - no validation, no interceptors
store.GetResource(ctx, "Agent", agentID, agent)
store.SaveResource(ctx, "Session", sessionID, session)
```

**What was bypassed**:
- Proto field validation (buf validate rules)
- Slug resolution (auto-generation from name)
- ID generation (handler responsibility)
- Audit field population (timestamps, actors)
- Business logic in handlers
- Logging and tracing
- Error standardization

### Issue 3: Hardcoded String Values

Resource kind strings were hardcoded throughout:

```go
store.GetResource(ctx, "Agent", ...)      // Hardcoded "Agent"
store.SaveResource(ctx, "Session", ...)   // Hardcoded "Session"
```

**Problems**:
- Prone to typos
- No compile-time safety
- Manual maintenance
- Inconsistent with enum-based approach

## Solution: In-Process gRPC Calls

### Architecture Pattern

Replace direct store access with in-process gRPC calls that go through the full interceptor chain:

```
┌─────────────────────┐
│ AgentExecution      │
│ Controller          │
└──────────┬──────────┘
           │
           │ In-Process gRPC
           ▼
┌─────────────────────┐      Full Interceptor Chain      ┌─────────────────────┐
│ Agent/Session       │─────────────────────────────────▶│ Agent/Session       │
│ Client              │   (validation, logging, kind)    │ Controller          │
│ (downstream pkg)    │                                   │ (controllers pkg)   │
└─────────────────────┘                                   └─────────────────────┘
```

**Benefits**:
- ✅ Correct `api_resource_kind` injection (AGENT, not AGENT_EXECUTION)
- ✅ All validation rules enforced
- ✅ All business logic executes
- ✅ Consistent error handling
- ✅ Full observability (logging, tracing)
- ✅ No hardcoded strings

### Implementation Details

#### 1. Created Downstream Agent Client

**New package**: `backend/services/stigmer-server/pkg/downstream/agent/`

```go
type Client struct {
    conn        *grpc.ClientConn
    queryClient agentv1.AgentQueryControllerClient
    cmdClient   agentv1.AgentCommandControllerClient
}

func (c *Client) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error)
func (c *Client) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
```

**Purpose**: Provides in-process gRPC client for Agent service operations.

#### 2. Created Session Controller

**New package**: `backend/services/stigmer-server/pkg/controllers/session/`

**Why**: Session creation was using direct store access. Created minimal controller with:

```go
func (c *SessionController) Create(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error)
```

**Pipeline steps**:
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug from name
3. BuildNewState - Generate ID and audit fields
4. Persist - Save to BadgerDB

#### 3. Updated AgentExecutionController

**Added dependencies**:
```go
type AgentExecutionController struct {
    store               *badger.Store
    agentClient         *agent.Client         // NEW
    agentInstanceClient *agentinstance.Client
    sessionClient       *session.Client       // Now non-nil (was nil before)
}
```

**Migration changes in `create.go`**:

**Line 154: Load Agent (BEFORE)**
```go
agent := &agentv1.Agent{}
if err := s.controller.store.GetResource(ctx.Context(), "Agent", agentID, agent); err != nil {
    return grpclib.NotFoundError("Agent", agentID)
}
```

**Line 154: Load Agent (AFTER)**
```go
agent, err := s.controller.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
if err != nil {
    return err // Already a gRPC error
}
```

**Line 232: Update Agent Status (BEFORE)**
```go
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context()) // WRONG: returns AGENT_EXECUTION
store.SaveResource(ctx, kind.String(), agentID, agent)
```

**Line 232: Update Agent Status (AFTER)**
```go
// In-process gRPC ensures correct api_resource_kind (AGENT)
_, err = s.controller.agentClient.Update(ctx.Context(), agent)
```

**Line 307: Load Agent for Session Creation (BEFORE)**
```go
agent := &agentv1.Agent{}
if err := s.controller.store.GetResource(ctx.Context(), "Agent", agentID, agent); err != nil {
    return grpclib.NotFoundError("Agent", agentID)
}
```

**Line 307: Load Agent for Session Creation (AFTER)**
```go
agent, err := s.controller.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
if err != nil {
    return err
}
```

**Line 346: Create Session (BEFORE)**
```go
// Manual ID generation and direct store access
createdSession := sessionRequest
sessionID = fmt.Sprintf("ses_%d", time.Now().UnixNano())
createdSession.Metadata.Id = sessionID
store.SaveResource(ctx, "Session", sessionID, createdSession)
```

**Line 346: Create Session (AFTER)**
```go
// In-process gRPC - handler generates ID and persists
createdSession, err := s.controller.sessionClient.Create(ctx.Context(), sessionRequest)
if err != nil {
    return fmt.Errorf("failed to create session: %w", err)
}
sessionID = createdSession.GetMetadata().GetId()
```

#### 4. Updated Server Initialization

**Registered Session controller** in `cmd/server/main.go`:
```go
sessionController := sessioncontroller.NewSessionController(store)
sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionController)
sessionv1.RegisterSessionQueryControllerServer(grpcServer, sessionController)
```

**Created downstream clients**:
```go
// Create in-process gRPC connection
inProcessConn, _ := server.NewInProcessConnection(ctx)

// Create downstream clients
agentClient := agentclient.NewClient(inProcessConn)
agentInstanceClient := agentinstanceclient.NewClient(inProcessConn)
sessionClient := sessionclient.NewClient(inProcessConn)
```

**Updated AgentExecutionController constructor**:
```go
// BEFORE
agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
    store,
    agentInstanceClient,
    nil, // sessionClient was nil
)

// AFTER
agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
    store,
    agentClient,         // NEW
    agentInstanceClient,
    sessionClient,       // Now non-nil
)
```

## Technical Details

### In-Process gRPC Flow

When AgentExecution controller updates an agent:

```
1. AgentExecution.Create() needs to update agent status
   │
   ├─▶ 2. Calls agentClient.Update(ctx, agent)
   │      │
   │      ├─▶ 3. In-process gRPC connection (bufconn)
   │      │      │
   │      │      ├─▶ 4. api_resource_kind interceptor injects AGENT kind
   │      │      │
   │      │      ├─▶ 5. Validation interceptor runs
   │      │      │
   │      │      ├─▶ 6. Logging interceptor logs request
   │      │      │
   │      │      └─▶ 7. AgentController.Update() handler executes
   │      │             │
   │      │             ├─▶ 8. Update pipeline steps execute
   │      │             │
   │      │             └─▶ 9. Persist step saves with correct kind: "Agent"
   │      │
   │      └─▶ 10. Response returned through interceptor chain
   │
   └─▶ 11. AgentExecution continues with updated agent
```

### Why In-Process gRPC vs Direct Store Access

| Aspect | Direct Store Access | In-Process gRPC |
|--------|-------------------|----------------|
| **api_resource_kind** | Caller's kind (AGENT_EXECUTION) ❌ | Target domain's kind (AGENT) ✅ |
| **Validation** | Bypassed ❌ | Full buf validate ✅ |
| **Business Logic** | Bypassed ❌ | Handler logic executes ✅ |
| **ID Generation** | Manual ❌ | Handler responsibility ✅ |
| **Audit Fields** | Manual ❌ | Handler populates ✅ |
| **Logging** | Manual ❌ | Interceptor logs ✅ |
| **Error Handling** | Inconsistent ❌ | Standardized gRPC errors ✅ |
| **Network Overhead** | None | None (bufconn in-process) |

## Files Changed

### New Files (7)
1. `backend/services/stigmer-server/pkg/downstream/agent/client.go` - Agent downstream client
2. `backend/services/stigmer-server/pkg/downstream/agent/BUILD.bazel` - Build configuration
3. `backend/services/stigmer-server/pkg/downstream/agent/README.md` - Client documentation
4. `backend/services/stigmer-server/pkg/controllers/session/session_controller.go` - Session controller struct
5. `backend/services/stigmer-server/pkg/controllers/session/create.go` - Session create handler
6. `backend/services/stigmer-server/pkg/controllers/session/BUILD.bazel` - Build configuration
7. `backend/services/stigmer-server/pkg/controllers/agentexecution/IMPLEMENTATION_SUMMARY.md` - Implementation details

### Modified Files (5)
1. `backend/services/stigmer-server/pkg/controllers/agentexecution/agentexecution_controller.go` - Added agentClient field
2. `backend/services/stigmer-server/pkg/controllers/agentexecution/create.go` - Replaced 4 store calls with gRPC
3. `backend/services/stigmer-server/pkg/controllers/agentexecution/BUILD.bazel` - Added agent client dependency
4. `backend/services/stigmer-server/cmd/server/main.go` - Registered Session controller, created clients
5. `backend/services/stigmer-server/cmd/server/BUILD.bazel` - Added new dependencies

## Impact and Benefits

### Correctness

**Agent Updates**:
- Before: Saved with `api_resource_kind = "AgentExecution"` ❌
- After: Saved with `api_resource_kind = "Agent"` ✅

**Session Creation**:
- Before: Manual ID generation, no validation ❌
- After: Handler generates ID, validates fields ✅

### Single Source of Truth

All domain operations now go through domain controllers:
- ✅ Agent operations → AgentController
- ✅ Session operations → SessionController
- ✅ AgentInstance operations → AgentInstanceController

### Migration-Ready Architecture

When splitting to microservices:
```go
// Just replace in-process connection with network connection
// No code changes to clients needed!

// Before (monolith)
inProcessConn := server.NewInProcessConnection(ctx)
agentClient := agent.NewClient(inProcessConn)

// After (microservices)
networkConn := grpc.Dial("agent-service:50051")
agentClient := agent.NewClient(networkConn)
```

### Maintainability

- Changes to Agent/Session logic only happen in one place (their controllers)
- Easy to add authorization, events, auditing later
- Consistent error handling across all operations
- No scattered direct store access

## Testing

Build verification:
```bash
bazel build //backend/services/stigmer-server/pkg/controllers/agentexecution:agentexecution
bazel build //backend/services/stigmer-server/pkg/downstream/agent:agent
bazel build //backend/services/stigmer-server/pkg/controllers/session:session
bazel build //backend/services/stigmer-server/cmd/server:server
```

All builds successful ✅

## Next Steps

### Apply Pattern to Other Controllers

Wherever direct store access exists:
```go
store.GetResource(ctx, "SomeKind", id, resource)
store.SaveResource(ctx, "SomeKind", id, resource)
```

Replace with in-process gRPC:
```go
client.Get(ctx, &SomeId{Value: id})
client.Update(ctx, resource)
```

### Candidates for Migration

- AgentInstance controller (if it accesses other domains)
- Future controllers (Workflow, Execution, etc.)
- Any cross-domain operations

## Architecture Principle

> **Single Source of Truth:**
> All domain operations MUST go through the domain's gRPC handler via in-process gRPC calls.
> Direct store access bypasses validation, business logic, and proper metadata injection.

This ensures consistency, correctness, and maintainability across the entire system.

## Related

- **ADR**: See `docs/adr/20260118-190513-stigmer-local-deamon.md` for Stigmer OSS daemon architecture
- **Implementation**: See `backend/services/stigmer-server/pkg/controllers/agentexecution/IMPLEMENTATION_SUMMARY.md`
- **Agent Client**: See `backend/services/stigmer-server/pkg/downstream/agent/README.md`
- **Session Client**: See `backend/services/stigmer-server/pkg/downstream/session/IMPLEMENTATION_SUMMARY.md`
