# Inline Agent Pipeline Steps into Controller

**Date**: 2026-01-18  
**Type**: Refactor  
**Scope**: `backend/services/stigmer-server/pkg/controllers/agent`  
**Impact**: Code organization, maintainability

## Summary

Refactored the Go agent controller to inline agent-specific pipeline steps directly into `create.go`, following the Java pattern used in `stigmer-cloud/AgentCreateHandler`. Steps are now defined as private types within the same file instead of separate files in a `steps/` subdirectory.

## Motivation

The user requested alignment with the Java codebase pattern:
- In Java (`AgentCreateHandler.java`), steps are defined as inner static classes within the handler
- Steps that are specific to one handler should not be separated unless commonly reused
- This reduces file sprawl and makes the handler self-contained
- Easier to understand the complete flow without jumping between files

## Changes Made

### Code Structure

**Before**:
```
pkg/controllers/agent/
├── agent_controller.go
├── create.go              (builds pipeline, references external steps)
└── steps/
    ├── create_default_instance.go
    └── update_agent_status.go
```

**After**:
```
pkg/controllers/agent/
├── agent_controller.go
├── create.go              (builds pipeline + defines inline steps)
├── delete.go
├── query.go
└── update.go
```

### Implementation Details

1. **Inlined Pipeline Steps**:
   - `createDefaultInstanceStep` - Private type defined in `create.go`
   - `updateAgentStatusWithDefaultInstanceStep` - Private type defined in `create.go`

2. **Factory Methods on Controller**:
   - `newCreateDefaultInstanceStep()` - Returns configured step instance
   - `newUpdateAgentStatusWithDefaultInstanceStep()` - Returns configured step instance

3. **Maintained Pattern Alignment**:
   - Steps implement the `pipeline.Step` interface (`Name()`, `Execute()`)
   - Use context for inter-step communication (`DefaultInstanceIDKey`)
   - Include comprehensive TODO comments showing in-process gRPC pattern

### In-Process gRPC Pattern Documentation

The refactored code documents how to use in-process gRPC calls (similar to Java's `AgentInstanceGrpcRepoImpl`):

```go
// Future pattern (when AgentInstance controller is ready):
type createDefaultInstanceStep struct {
    agentInstanceClient AgentInstanceCommandControllerClient
}

// Will be injected from controller
func (c *AgentController) newCreateDefaultInstanceStep() *createDefaultInstanceStep {
    return &createDefaultInstanceStep{
        agentInstanceClient: c.agentInstanceClient,
    }
}
```

This matches the Java pattern:
```java
@Component
static class CreateDefaultInstance implements RequestPipelineStepV2 {
    private final AgentInstanceGrpcRepo agentInstanceGrpcRepo;
    
    public AgentInstance createAsSystem(AgentInstance instance) {
        // In-process gRPC call
        var stub = AgentInstanceCommandControllerGrpc.newBlockingStub(systemChannel);
        return stub.create(instance);
    }
}
```

## Files Changed

- **Modified**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`
  - Added inline step type definitions
  - Added factory methods for steps
  - Updated pipeline builder to use new factory methods
  - Removed import of `agentsteps` package
  
- **Deleted**: `backend/services/stigmer-server/pkg/controllers/agent/steps/create_default_instance.go`
- **Deleted**: `backend/services/stigmer-server/pkg/controllers/agent/steps/update_agent_status.go`
- **Removed**: `steps/` directory (now empty)

## Benefits

1. **Consistency with Java codebase** - Both use inline steps for handler-specific logic
2. **Reduced file sprawl** - 3 files → 1 file (2 deleted, 1 enhanced)
3. **Self-contained handlers** - Complete flow visible in single file
4. **Clear separation** - Common steps stay in `pipeline/steps`, handler-specific steps are inline
5. **Easier maintenance** - Don't need to navigate multiple files for handler-specific logic

## Pattern Decision

**When to use separate files (common steps)**:
- `ValidateProtoStep` - Used by all controllers
- `ResolveSlugStep` - Used by all controllers  
- `CheckDuplicateStep` - Used by all controllers
- `SetDefaultsStep` - Used by all controllers
- `PersistStep` - Used by all controllers

**When to inline (handler-specific steps)**:
- `createDefaultInstanceStep` - Only used by agent create handler
- `updateAgentStatusWithDefaultInstanceStep` - Only used by agent create handler
- Future handler-specific steps that aren't reused

## Verification

```bash
# Build succeeds
go build ./backend/services/stigmer-server/pkg/controllers/agent/...
# Exit code: 0

# No linter errors
golangci-lint run backend/services/stigmer-server/pkg/controllers/agent/...
# No issues found
```

## Next Steps

When implementing AgentInstance controller:

1. Add `agentInstanceClient` field to `AgentController`
2. Inject client in constructor
3. Uncomment TODO code in `createDefaultInstanceStep.Execute()`
4. Uncomment TODO code in `updateAgentStatusWithDefaultInstanceStep.Execute()`
5. Follow Java's `AgentInstanceGrpcRepoImpl` pattern for in-process gRPC

## Related Work

- Java implementation: `stigmer-cloud/.../AgentCreateHandler.java`
- In-process gRPC pattern: `stigmer-cloud/.../AgentInstanceGrpcRepoImpl.java`
- Pipeline framework: `backend/libs/go/grpc/request/pipeline/`
- Common steps: `backend/libs/go/grpc/request/pipeline/steps/`

---

**Outcome**: Agent controller now follows the same inline step pattern as Java, reducing file count and improving code locality while maintaining clear separation between common and handler-specific steps.
