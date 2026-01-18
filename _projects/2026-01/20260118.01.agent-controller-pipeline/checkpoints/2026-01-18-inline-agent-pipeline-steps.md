# Checkpoint: Inline Agent Pipeline Steps

**Date**: 2026-01-18  
**Type**: Refactoring  
**Status**: Complete ✅  
**Cloud Parity**: 58% (7/12 steps - unchanged)

## Overview

Refactored the Go agent controller to inline agent-specific pipeline steps directly into `create.go`, following the Java pattern used in `stigmer-cloud/AgentCreateHandler`. This eliminates the separate `steps/` directory and makes the handler self-contained.

## What Changed

### Before: Separate Step Files

```
pkg/controllers/agent/
├── agent_controller.go
├── create.go              # 62 lines - builds pipeline, references external steps
└── steps/
    ├── create_default_instance.go      # 64 lines
    └── update_agent_status.go          # 61 lines
```

**Problems**:
- Agent-specific steps scattered across multiple files
- File navigation required to understand complete flow
- Inconsistent with Java codebase pattern

### After: Inline Steps

```
pkg/controllers/agent/
├── agent_controller.go
├── create.go              # 210 lines - builds pipeline + defines inline steps
├── delete.go
├── query.go
└── update.go
```

**Benefits**:
- Complete create flow visible in single file
- Matches Java `AgentCreateHandler` inner class pattern
- Easier to understand and maintain
- Clear separation: common vs handler-specific steps

## Refactoring Details

### 1. Inlined Step Type Definitions

Created private step types in `create.go`:

```go
// createDefaultInstanceStep - Private type in create.go
type createDefaultInstanceStep struct {
    // agentInstanceClient AgentInstanceCommandControllerClient // TODO
}

// updateAgentStatusWithDefaultInstanceStep - Private type in create.go  
type updateAgentStatusWithDefaultInstanceStep struct {
    controller *AgentController
}
```

### 2. Factory Methods on Controller

Added factory methods following Go idioms:

```go
func (c *AgentController) newCreateDefaultInstanceStep() *createDefaultInstanceStep {
    return &createDefaultInstanceStep{
        // agentInstanceClient: c.agentInstanceClient, // TODO: inject when ready
    }
}

func (c *AgentController) newUpdateAgentStatusWithDefaultInstanceStep() *updateAgentStatusWithDefaultInstanceStep {
    return &updateAgentStatusWithDefaultInstanceStep{controller: c}
}
```

### 3. Updated Pipeline Builder

Changed from external package imports to factory methods:

```go
// Before
AddStep(agentsteps.NewCreateDefaultInstanceStep())
AddStep(agentsteps.NewUpdateAgentStatusWithDefaultInstanceStep(c.store))

// After  
AddStep(c.newCreateDefaultInstanceStep())
AddStep(c.newUpdateAgentStatusWithDefaultInstanceStep())
```

### 4. Removed Imports

Eliminated import of separate steps package:

```go
// Removed:
// agentsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agent/steps"
```

## Pattern Alignment with Java

### Java Pattern (AgentCreateHandler.java)

```java
@Component
public class AgentCreateHandler extends CreateOperationHandlerV2<Agent> {
    
    // Inner static classes for handler-specific steps
    @Component
    @RequiredArgsConstructor
    static class CreateDefaultInstance implements RequestPipelineStepV2 {
        private final AgentInstanceGrpcRepo agentInstanceGrpcRepo;
        
        @Override
        public RequestPipelineStepResultV2 execute(CreateContextV2<Agent> context) {
            // Implementation
        }
    }
    
    @Component
    static class UpdateAgentStatusWithDefaultInstance implements RequestPipelineStepV2 {
        private final AgentRepo agentRepo;
        
        @Override
        public RequestPipelineStepResultV2 execute(CreateContextV2<Agent> context) {
            // Implementation
        }
    }
}
```

### Go Pattern (create.go) - Now Aligned

```go
package agent

func (c *AgentController) Create(...) {
    // Build pipeline with inline steps
}

// Private types for handler-specific steps (equivalent to inner classes)
type createDefaultInstanceStep struct {
    // agentInstanceClient AgentInstanceCommandControllerClient
}

type updateAgentStatusWithDefaultInstanceStep struct {
    controller *AgentController
}
```

## In-Process gRPC Pattern Documentation

The refactored code documents the future in-process gRPC pattern (when AgentInstance controller is implemented):

### Go Pattern (Documented in TODOs)

```go
type createDefaultInstanceStep struct {
    agentInstanceClient AgentInstanceCommandControllerClient
}

func (s *createDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
    // 1. Build AgentInstance request
    instanceRequest := &agentinstancev1.AgentInstance{...}
    
    // 2. Create instance via downstream gRPC (in-process, system credentials)
    createdInstance, err := s.agentInstanceClient.Create(ctx.Context(), instanceRequest)
    
    // 3. Store instance ID in context for next step
    ctx.Set(DefaultInstanceIDKey, createdInstance.Metadata.Id)
}
```

### Java Pattern (Reference Implementation)

```java
@Component
static class CreateDefaultInstance implements RequestPipelineStepV2 {
    private final AgentInstanceGrpcRepo agentInstanceGrpcRepo;
    
    public RequestPipelineStepResultV2 execute(CreateContextV2<Agent> context) {
        // 1. Build instance request
        AgentInstance instanceRequest = AgentInstance.newBuilder()...build();
        
        // 2. Create via in-process gRPC (system credentials)
        AgentInstance created = agentInstanceGrpcRepo.createAsSystem(instanceRequest);
        
        // 3. Store in context
        context.put(DEFAULT_INSTANCE_ID_KEY, created.getMetadata().getId());
    }
}
```

## Decision Rationale

### When to Use Separate Files (Common Steps)

Located in `backend/libs/go/grpc/request/pipeline/steps/`:

- `ValidateProtoStep` - Used by ALL controllers
- `ResolveSlugStep` - Used by ALL controllers
- `CheckDuplicateStep` - Used by ALL controllers
- `SetDefaultsStep` - Used by ALL controllers
- `PersistStep` - Used by ALL controllers

### When to Inline (Handler-Specific Steps)

Located in same file as handler:

- `createDefaultInstanceStep` - ONLY used by agent create handler
- `updateAgentStatusWithDefaultInstanceStep` - ONLY used by agent create handler

**Rule**: If a step is used by only one handler, inline it. If used by multiple handlers, make it a common step.

## Files Changed

### Modified
- `backend/services/stigmer-server/pkg/controllers/agent/create.go`
  - From: 62 lines
  - To: 210 lines
  - Change: +148 lines (added inline step implementations)

### Deleted
- `backend/services/stigmer-server/pkg/controllers/agent/steps/create_default_instance.go` (64 lines)
- `backend/services/stigmer-server/pkg/controllers/agent/steps/update_agent_status.go` (61 lines)

### Removed
- `backend/services/stigmer-server/pkg/controllers/agent/steps/` directory (now empty)

### Net Change
- 3 files → 1 file
- Total lines: 187 → 210 (+23 lines, but better organized)
- Directory structure: Simplified (no steps/ subdirectory)

## Build Verification

```bash
# Compile check
$ go build ./backend/services/stigmer-server/pkg/controllers/agent/...
# Exit code: 0 ✅

# Linter check
$ golangci-lint run backend/services/stigmer-server/pkg/controllers/agent/...
# No issues found ✅
```

## Impact Analysis

### Code Organization
- ✅ **Improved** - Complete create flow in single file
- ✅ **Simplified** - No need to navigate to steps/ directory
- ✅ **Aligned** - Matches Java codebase pattern

### Maintainability
- ✅ **Better** - All create logic colocated
- ✅ **Clearer** - Obvious which steps are handler-specific vs common
- ✅ **Consistent** - Same pattern as Java implementation

### Cloud Parity
- **Unchanged** - Still 58% (7/12 steps implemented)
- No functional changes, purely structural refactoring

### Next Steps for Implementation
When implementing AgentInstance controller:
1. Add `agentInstanceClient` field to `AgentController` struct
2. Inject client in `NewAgentController()` constructor  
3. Uncomment TODO code in step implementations
4. Follow Java's `AgentInstanceGrpcRepoImpl` for in-process gRPC pattern

## Quality Metrics

- ✅ Single Responsibility: Each step has one clear purpose
- ✅ File Size: create.go at 210 lines (within 50-250 guideline)
- ✅ Function Size: All functions < 50 lines
- ✅ Error Handling: All errors wrapped with context
- ✅ Documentation: Comprehensive comments and TODOs
- ✅ Build Status: Clean compile, no linter errors

## Related Documentation

- **Java Reference**: `stigmer-cloud/.../AgentCreateHandler.java`
- **In-Process gRPC**: `stigmer-cloud/.../AgentInstanceGrpcRepoImpl.java`
- **Pipeline Framework**: `@backend/libs/go/grpc/request/pipeline/README.md`
- **Common Steps**: `@backend/libs/go/grpc/request/pipeline/steps/`
- **Package Structure**: `@backend/services/stigmer-server/pkg/controllers/agent/README.md`

## Lessons Learned

1. **Pattern Consistency Matters**: Aligning Go and Java patterns improves cross-codebase understanding
2. **Inline When Specific**: Handler-specific steps don't need separate files
3. **Factory Methods Work**: Go's factory method pattern (`newXxxStep()`) mirrors Java's dependency injection
4. **Documentation in TODOs**: Comprehensive TODO comments serve as implementation guide
5. **Build Verification Essential**: Always verify refactoring doesn't break compilation

## Summary

Successfully refactored agent controller to match Java's inline step pattern, reducing file count from 3 to 1 while maintaining clean architecture and comprehensive documentation. Ready for future AgentInstance implementation with clear in-process gRPC pattern documented.

**Status**: ✅ Complete  
**Cloud Parity**: 58% (unchanged)  
**Quality**: All metrics passing  
**Next**: AgentInstance controller implementation
