# Agent Execution Controller - In-Process gRPC Migration

## Summary

Migrated AgentExecutionController from direct store access to in-process gRPC calls for all domain operations (Agent, Session), ensuring single source of truth and proper interceptor chain execution.

## Changes Made

### 1. Created Downstream Agent Client

**New Files:**
- `backend/services/stigmer-server/pkg/downstream/agent/client.go`
- `backend/services/stigmer-server/pkg/downstream/agent/BUILD.bazel`
- `backend/services/stigmer-server/pkg/downstream/agent/README.md`

**Purpose:** Provides in-process gRPC client for Agent service with:
- `Get(ctx, *AgentId) (*Agent, error)` - Retrieve agent by ID
- `Update(ctx, *Agent) (*Agent, error)` - Update agent state

**Why:** Ensures all Agent operations go through the full gRPC interceptor chain, including proper `api_resource_kind` injection (AGENT, not AGENT_EXECUTION).

### 2. Created Session Controller

**New Files:**
- `backend/services/stigmer-server/pkg/controllers/session/session_controller.go`
- `backend/services/stigmer-server/pkg/controllers/session/create.go`
- `backend/services/stigmer-server/pkg/controllers/session/BUILD.bazel`

**Purpose:** Minimal Session controller implementing:
- `Create(ctx, *Session) (*Session, error)` - Create new session

**Pipeline Steps:**
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug from name
3. BuildNewState - Generate ID and audit fields
4. Persist - Save to BadgerDB

### 3. Updated AgentExecutionController

**Modified Files:**
- `backend/services/stigmer-server/pkg/controllers/agentexecution/agentexecution_controller.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/create.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/BUILD.bazel`

**Changes:**

#### Controller Struct (agentexecution_controller.go)
```go
// BEFORE
type AgentExecutionController struct {
    store               *badger.Store
    agentInstanceClient *agentinstance.Client
    sessionClient       *session.Client  // Was nil
}

// AFTER
type AgentExecutionController struct {
    store               *badger.Store
    agentClient         *agent.Client         // NEW
    agentInstanceClient *agentinstance.Client
    sessionClient       *session.Client       // Now non-nil
}
```

#### Create Handler - createDefaultInstanceIfNeededStep (create.go)

**Line 153-161: Load Agent (BEFORE)**
```go
// ❌ Direct store access
agent := &agentv1.Agent{}
if err := s.controller.store.GetResource(ctx.Context(), "Agent", agentID, agent); err != nil {
    return grpclib.NotFoundError("Agent", agentID)
}
```

**Line 153-161: Load Agent (AFTER)**
```go
// ✅ In-process gRPC call
agent, err := s.controller.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
if err != nil {
    return err // Already a gRPC error
}
```

**Line 223-239: Update Agent Status (BEFORE)**
```go
// ❌ Direct store access with wrong api_resource_kind
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context()) // Returns AGENT_EXECUTION!
if err := s.controller.store.SaveResource(ctx.Context(), kind.String(), agentID, agent); err != nil {
    return fmt.Errorf("failed to persist agent: %w", err)
}
```

**Line 229-239: Update Agent Status (AFTER)**
```go
// ✅ In-process gRPC call with correct api_resource_kind
_, err = s.controller.agentClient.Update(ctx.Context(), agent)
if err != nil {
    return fmt.Errorf("failed to persist agent: %w", err)
}
```

#### Create Handler - createSessionIfNeededStep (create.go)

**Line 306-313: Load Agent (BEFORE)**
```go
// ❌ Direct store access
agent := &agentv1.Agent{}
if err := s.controller.store.GetResource(ctx.Context(), "Agent", agentID, agent); err != nil {
    return grpclib.NotFoundError("Agent", agentID)
}
```

**Line 306-314: Load Agent (AFTER)**
```go
// ✅ In-process gRPC call
agent, err := s.controller.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
if err != nil {
    return err
}
```

**Line 344-362: Create Session (BEFORE)**
```go
// ❌ Direct store access - manual ID generation and persistence
createdSession := sessionRequest
sessionID = fmt.Sprintf("ses_%d", time.Now().UnixNano())
if createdSession.Metadata == nil {
    createdSession.Metadata = &apiresource.ApiResourceMetadata{}
}
createdSession.Metadata.Id = sessionID

if err := s.controller.store.SaveResource(ctx.Context(), "Session", sessionID, createdSession); err != nil {
    return fmt.Errorf("failed to create session: %w", err)
}
```

**Line 345-355: Create Session (AFTER)**
```go
// ✅ In-process gRPC call - handler generates ID and persists
createdSession, err := s.controller.sessionClient.Create(ctx.Context(), sessionRequest)
if err != nil {
    return fmt.Errorf("failed to create session: %w", err)
}

sessionID = createdSession.GetMetadata().GetId()
```

### 4. Updated Server Initialization

**Modified File:**
- `backend/services/stigmer-server/cmd/server/main.go`
- `backend/services/stigmer-server/cmd/server/BUILD.bazel`

**Changes:**

#### Imports Added
```go
import (
    sessioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/session"
    agentclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
    sessionclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
    sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)
```

#### Controller Registration (BEFORE)
```go
// AgentInstance controller
agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)

// TODO: Session controller not implemented

// Create in-process connection
inProcessConn, _ := server.NewInProcessConnection(ctx)
agentInstanceClient := agentinstanceclient.NewClient(inProcessConn)

// Agent controller
agentController := agent.NewAgentController(store, agentInstanceClient)
agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)

// AgentExecution controller
agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
    store,
    agentInstanceClient,
    nil, // sessionClient not available
)
```

#### Controller Registration (AFTER)
```go
// AgentInstance controller
agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)

// Session controller (NEW)
sessionController := sessioncontroller.NewSessionController(store)
sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionController)
sessionv1.RegisterSessionQueryControllerServer(grpcServer, sessionController)

// Create in-process connection and clients
inProcessConn, _ := server.NewInProcessConnection(ctx)
agentClient := agentclient.NewClient(inProcessConn)              // NEW
agentInstanceClient := agentinstanceclient.NewClient(inProcessConn)
sessionClient := sessionclient.NewClient(inProcessConn)          // NEW

// Agent controller
agentController := agent.NewAgentController(store, agentInstanceClient)
agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)

// AgentExecution controller
agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
    store,
    agentClient,         // NEW
    agentInstanceClient,
    sessionClient,       // NEW (non-nil)
)
```

## Problems Solved

### 1. Wrong api_resource_kind in Agent Updates

**Problem:**
```go
// In AgentExecution.Create(), when updating agent:
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
// Returns: AGENT_EXECUTION (current request's kind)
// Expected: AGENT (agent domain's kind)

store.SaveResource(ctx, kind.String(), agentID, agent)
// Saved with wrong kind: "AgentExecution" instead of "Agent"
```

**Solution:**
```go
// In-process gRPC call to Agent.Update()
agentClient.Update(ctx, agent)
// The agent controller's interceptor sets api_resource_kind = AGENT
// Saved with correct kind: "Agent"
```

### 2. Bypassed Validation and Business Logic

**Problem:**
```go
// Direct store access bypasses:
// - Proto field validation
// - Handler business logic
// - Interceptor chain
store.SaveResource(ctx, "Session", sessionID, session)
```

**Solution:**
```go
// In-process gRPC call executes full pipeline:
// 1. ValidateProto (buf validate rules)
// 2. ResolveSlug (generate from name)
// 3. BuildNewState (ID, timestamps, audit fields)
// 4. Persist (save to store)
sessionClient.Create(ctx, sessionRequest)
```

### 3. Hardcoded String Values

**Problem:**
```go
store.GetResource(ctx, "Agent", agentID, agent)  // Hardcoded "Agent"
store.SaveResource(ctx, "Session", sessionID, session)  // Hardcoded "Session"
```

**Solution:**
```go
// In-process gRPC - no hardcoded strings needed
agentClient.Get(ctx, &agentv1.AgentId{Value: agentID})
sessionClient.Create(ctx, sessionRequest)
```

## Benefits

### 1. Single Source of Truth

All domain operations go through handlers, ensuring:
- ✅ Correct `api_resource_kind` injection
- ✅ All validation rules enforced
- ✅ All business logic executes
- ✅ Consistent error handling
- ✅ Full observability (logging, tracing)

### 2. Correctness

**Agent Updates:**
- Before: Saved with `api_resource_kind = "AgentExecution"` ❌
- After: Saved with `api_resource_kind = "Agent"` ✅

**Session Creation:**
- Before: Manual ID generation, no validation ❌
- After: Handler generates ID, validates fields ✅

### 3. Maintainability

- No direct store access scattered across domains
- Changes to Agent/Session logic only happen in one place
- Easy to add authorization, events, etc. later

### 4. Migration-Ready

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

## Testing

Build verified:
```bash
bazel build //backend/services/stigmer-server/pkg/controllers/agentexecution:agentexecution
bazel build //backend/services/stigmer-server/pkg/downstream/agent:agent
bazel build //backend/services/stigmer-server/pkg/controllers/session:session
bazel build //backend/services/stigmer-server/cmd/server:server
```

All builds successful ✅

## Files Changed

### New Files (7)
1. `backend/services/stigmer-server/pkg/downstream/agent/client.go`
2. `backend/services/stigmer-server/pkg/downstream/agent/BUILD.bazel`
3. `backend/services/stigmer-server/pkg/downstream/agent/README.md`
4. `backend/services/stigmer-server/pkg/controllers/session/session_controller.go`
5. `backend/services/stigmer-server/pkg/controllers/session/create.go`
6. `backend/services/stigmer-server/pkg/controllers/session/BUILD.bazel`
7. `backend/services/stigmer-server/pkg/controllers/agentexecution/IMPLEMENTATION_SUMMARY.md` (this file)

### Modified Files (5)
1. `backend/services/stigmer-server/pkg/controllers/agentexecution/agentexecution_controller.go`
2. `backend/services/stigmer-server/pkg/controllers/agentexecution/create.go`
3. `backend/services/stigmer-server/pkg/controllers/agentexecution/BUILD.bazel`
4. `backend/services/stigmer-server/cmd/server/main.go`
5. `backend/services/stigmer-server/cmd/server/BUILD.bazel`

## Next Steps

### Apply Same Pattern to Other Controllers

Wherever you see direct store access like:
```go
store.GetResource(ctx, "SomeKind", id, resource)
store.SaveResource(ctx, "SomeKind", id, resource)
```

Replace with in-process gRPC:
```go
client.Get(ctx, &SomeId{Value: id})
client.Update(ctx, resource)
```

### Guidelines

1. **Create downstream client** in `pkg/downstream/{domain}/`
2. **Inject client** into controllers that need it
3. **Replace direct store calls** with client method calls
4. **Remove hardcoded strings** (handled by interceptors)
5. **Update BUILD.bazel** files with new dependencies

## Architecture Principle

> **Single Source of Truth:**
> All domain operations MUST go through the domain's gRPC handler via in-process gRPC calls.
> Direct store access bypasses validation, business logic, and proper metadata injection.

This ensures consistency, correctness, and maintainability across the entire system.
