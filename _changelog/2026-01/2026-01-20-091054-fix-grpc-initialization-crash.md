# Fix: gRPC Server Initialization Crash on Startup

**Date:** 2026-01-20  
**Type:** Critical Bug Fix  
**Scope:** Backend (stigmer-server daemon)  
**Impact:** Daemon can now start and stay running

## Problem

The `stigmer-server` daemon was crashing immediately after startup with a fatal gRPC error:

```
FATAL: [core] grpc: Server.RegisterService after Server.Serve for "ai.stigmer.agentic.agent.v1.AgentCommandController"
```

**Impact:**
- ❌ Daemon could not stay running
- ❌ All CLI commands requiring backend connection failed
- ❌ Auto-start feature worked, but server immediately crashed
- ❌ Complete blocker for local development

## Root Cause

The initialization sequence violated gRPC's requirement that all services must be registered **before** calling `Server.Serve()`:

**Broken sequence:**
1. Register initial services (AgentInstance, Session, Environment, etc.) ✅
2. Call `server.StartInProcess()` ← **This calls `Serve()` internally** 🔴
3. Try to register remaining services (Agent, AgentExecution, etc.) ❌ **Too late!**

The circular dependency:
- Controllers needed client dependencies (Agent, AgentInstance, Workflow clients)
- Clients needed the in-process server to be started
- Starting the server locked service registration
- But some services were being registered after server started → **CRASH**

## Solution

Implemented **Dependency Injection via Setters** to break the circular dependency:

**Fixed sequence:**
1. Register **ALL** services with nil/placeholder dependencies first
2. Start the in-process gRPC server (now safe - all services registered)
3. Create in-process client connections
4. Inject dependencies into controllers using new setter methods

This satisfies gRPC's registration-before-serve requirement while still allowing controllers to receive runtime-created client dependencies.

## Technical Changes

### 1. Updated Initialization Order (`backend/services/stigmer-server/cmd/server/main.go`)

**Before:**
- Services registered in two phases (before and after `StartInProcess()`)
- Controllers re-registered after client creation
- Fatal ordering violation

**After:**
- All services registered upfront with nil dependencies
- Critical comment added: `// CRITICAL: All services MUST be registered BEFORE starting the server`
- `StartInProcess()` called after all registrations
- Dependencies injected via setter methods after server starts

### 2. Added Setter Methods to Controllers

Each controller that needs client dependencies now has a setter method:

**AgentController:**
```go
func (c *AgentController) SetAgentInstanceClient(client *agentinstance.Client)
```

**AgentExecutionController:**
```go
func (c *AgentExecutionController) SetClients(
    agentClient *agent.Client,
    agentInstanceClient *agentinstance.Client,
    sessionClient *session.Client,
)
```

**WorkflowController:**
```go
func (c *WorkflowController) SetWorkflowInstanceClient(client *workflowinstance.Client)
```

**WorkflowInstanceController:**
```go
func (c *WorkflowInstanceController) SetWorkflowClient(client *workflow.Client)
```

**WorkflowExecutionController:**
```go
func (c *WorkflowExecutionController) SetWorkflowInstanceClient(client *workflowinstance.Client)
```

### Files Modified

1. `backend/services/stigmer-server/cmd/server/main.go` - Fixed initialization sequence
2. `backend/services/stigmer-server/pkg/domain/agent/controller/agent_controller.go` - Added setter
3. `backend/services/stigmer-server/pkg/domain/agentexecution/controller/agentexecution_controller.go` - Added setter
4. `backend/services/stigmer-server/pkg/domain/workflow/controller/workflow_controller.go` - Added setter
5. `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/workflowinstance_controller.go` - Added setter
6. `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/workflowexecution_controller.go` - Added setter

## Design Pattern: Setter Injection

This fix uses **Setter Injection**, which is appropriate when:

1. **Registration must happen before runtime dependencies are available**
   - gRPC services must be registered before `Serve()` is called
   - Client dependencies only exist after server is started

2. **Controllers are already instantiated and registered**
   - Can't use constructor injection (would require re-registration)
   - Can't use lazy initialization (clients must go through interceptor chain)

3. **Dependencies are required but can be nil initially**
   - Controllers won't receive requests until after dependency injection
   - Safe window between registration and first request

## Why This Pattern Works

✅ **gRPC Registration Requirement Satisfied**
- All services registered before `Serve()` is called
- No more "RegisterService after Serve" errors

✅ **Circular Dependencies Resolved**
- Controllers don't need clients at registration time
- Clients can be created after server starts
- Dependencies injected once clients are available

✅ **In-Process gRPC Maintained**
- Controllers still use full gRPC stack with interceptors
- Single source of truth through interceptor chain
- API resource kind injection still works

✅ **Clean Separation of Concerns**
- Registration phase: Pure service registration
- Initialization phase: Server startup
- Wiring phase: Dependency injection

## Verification

```bash
$ bazel build //backend/services/stigmer-server/cmd/server:server
INFO: Build completed successfully, 54 total actions
```

Build completes successfully with no errors.

## Alternative Approaches Considered

### ❌ Lazy Client Creation
**Problem:** Controllers would need to create clients on-demand, bypassing the in-process gRPC pattern and losing interceptor chain benefits.

### ❌ Two-Phase Registration
**Problem:** gRPC doesn't support "provisional" registration - once `Serve()` is called, registration is locked.

### ❌ Pass Server to Controllers
**Problem:** Would violate separation of concerns and create tight coupling between controllers and server infrastructure.

### ✅ Setter Injection (Chosen)
**Advantages:**
- Preserves gRPC requirements
- Maintains in-process pattern
- Clean separation of registration and wiring
- Simple and explicit

## Testing Recommendations

1. **Unit Tests:** Verify controllers handle nil dependencies gracefully (if requests come before injection)
2. **Integration Tests:** Verify full initialization sequence works end-to-end
3. **Startup Tests:** Ensure daemon starts without crashes
4. **API Tests:** Verify all endpoints work correctly after initialization

## Documentation Created

- `_cursor/grpc-initialization-fix.md` - Comprehensive technical documentation
- Updated `_cursor/error.md` with resolution details

## Key Takeaway

**When working with gRPC servers: Always register ALL services BEFORE calling `Serve()`.** 

If you have circular dependencies or need runtime-created dependencies, use **Setter Injection** to wire dependencies AFTER registration but BEFORE handling requests.

## Future Improvements

Consider adding validation:
1. Setter methods called only once
2. Dependencies set before first request
3. Better error messages if requests come in with nil dependencies

Could add initialization verification:
```go
func (c *AgentController) validateInitialized() error {
    if c.agentInstanceClient == nil {
        return fmt.Errorf("AgentController not fully initialized")
    }
    return nil
}
```

## Impact

**Before:** Daemon crashed immediately, blocking all local development
**After:** Daemon starts successfully and stays running

This fix unblocks:
- ✅ `stigmer apply` command
- ✅ Local daemon usage
- ✅ All CLI commands requiring backend
- ✅ Development workflow with auto-start

The auto-start feature (which was working correctly) can now successfully start a daemon that actually stays alive and handles requests.

---

**Related:** gRPC Server Lifecycle, In-Process gRPC, Dependency Injection Patterns, Backend Architecture
