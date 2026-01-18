# Implement Agent Call SDK Support

**Date**: 2026-01-17  
**Type**: Feature Implementation  
**Scope**: SDK (Go)  
**Related**: Agent Task Integration Project (T02)

## Summary

Implemented comprehensive SDK support for calling agents from workflows in the Go SDK. Developers can now invoke Stigmer agents as workflow tasks using clean, Pulumi-style APIs with type-safe configuration options.

## What Changed

### 1. Core SDK Types

**Agent References** (`workflow/agent_ref.go` - NEW):
- Created `AgentRef` type for Pulumi-style agent references
- `workflow.Agent(agent)` - Reference by instance
- `workflow.AgentBySlug("name", "scope")` - Reference by slug
- Automatic scope inference (platform vs organization)

**Task Configuration** (`workflow/task_agent_call.go` - NEW):
- `AgentCallTaskConfig` - Main task configuration struct
- `AgentExecutionConfig` - Execution parameters (model, timeout, temperature)
- Task builder with functional options pattern
- Agent-prefixed option names to avoid conflicts (`AgentModel`, `AgentTimeout`, `AgentTemperature`)

### 2. Workflow Integration

**Workflow Helper** (`workflow/workflow.go`):
- Added `wf.CallAgent()` method
- Follows existing SDK patterns (HttpGet, SetVars, etc.)
- Auto-adds task to workflow

**Task Kind** (`workflow/task.go`):
- Added `TaskKindAgentCall` constant

### 3. Synthesis Layer

**Proto Conversion** (`internal/synth/workflow_converter.go`):
- Added `TaskKindAgentCall` to enum mapping
- Added synthesis case for AGENT_CALL tasks
- Converts SDK types to proto struct format
- Handles optional scope and execution config

### 4. Testing & Examples

**Unit Tests** (`workflow/task_agent_call_test.go` - NEW):
- Comprehensive test coverage for all features
- Tests for AgentBySlug with scopes
- Tests for functional options
- Tests for workflow integration
- Mock context pattern for testing

**Example Update** (`stigmer-project/main.go`):
- Added code review agent example
- Demonstrated agent call workflow
- Showed all major features (env vars, model override, timeout)

### 5. Proto Dependency Management

**BSR Updates**:
- Updated proto dependency from `v1.36.11-20260116195247` to `v1.36.11-20260117165112`
- Now using proper `WORKFLOW_TASK_KIND_AGENT_CALL` constant (no hardcoded values)
- SDK and example project both use latest BSR version

## API Design

### Usage Example

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Create agent
    reviewer, _ := agent.New(ctx,
        agent.WithName("code-reviewer"),
        agent.WithInstructions("Review code and provide feedback"),
    )
    
    // Create workflow
    wf, _ := workflow.New(ctx,
        workflow.WithNamespace("demo"),
        workflow.WithName("pr-review"),
    )
    
    // Call agent from workflow
    task := wf.CallAgent(
        "review",
        workflow.AgentOption(workflow.Agent(reviewer)),
        workflow.Message("Review: ${.input.prUrl}"),
        workflow.WithEnv(map[string]string{
            "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
        }),
        workflow.AgentModel("claude-3-5-sonnet"),
        workflow.AgentTimeout(300),
    )
    task.ExportAs = "reviewResult"
    
    return nil
})
```

## Design Decisions

### 1. Separate AgentRef Type
**Decision**: Created dedicated `AgentRef` type instead of passing `*agent.Agent` directly  
**Rationale**: Enables both instance-based and slug-based references with scope control

### 2. Functional Options Pattern
**Decision**: Used functional options for task configuration  
**Rationale**: Consistent with existing SDK patterns, provides flexibility

### 3. Agent-Prefixed Option Names
**Decision**: Named options as `AgentModel()`, `AgentTimeout()`, `AgentTemperature()`  
**Rationale**: Prevents naming conflicts with HTTP task options (`WithTimeout` already exists for HTTP)

### 4. Automatic Scope Inference
**Decision**: Infer scope from agent.Org field  
**Rationale**: Org set = organization scope, Org empty = platform scope (sensible defaults)

## Files Changed

### New Files (3)
- `go/workflow/agent_ref.go` - Agent reference type (97 lines)
- `go/workflow/task_agent_call.go` - Task config and builders (220 lines)
- `go/workflow/task_agent_call_test.go` - Unit tests (231 lines)

### Modified Files (5)
- `go/workflow/task.go` - Added TaskKindAgentCall constant
- `go/workflow/workflow.go` - Added CallAgent() method
- `go/internal/synth/workflow_converter.go` - Added AGENT_CALL synthesis
- `go/workflow/task_test.go` - Fixed syntax error (unrelated cleanup)
- `go.mod` - Updated BSR proto dependency

### Example Updates (2)
- `stigmer-project/main.go` - Added agent call example
- `stigmer-project/go.mod` - Updated BSR proto dependency

## Testing

### Verification
- ✅ Workflow package builds successfully
- ✅ Synthesis package builds successfully
- ✅ Example project builds successfully
- ✅ Example runs and demonstrates agent call
- ✅ All new code follows Go SDK patterns
- ✅ Comprehensive unit test coverage

### Output
```
✅ Created code review agent:
   Name: code-reviewer

✅ Created PR review workflow with agent call:
   Workflow: pr-review-workflow
   Tasks: 2
     - review-code (calls agent: code-reviewer)
     - summarize (processes result)
```

## Impact

### For Developers
- Clean, type-safe API for calling agents from workflows
- Pulumi-style references familiar to SDK users
- Proper proto constant usage (no hardcoded values)
- Comprehensive examples to follow

### For Agent Task Integration Project
- ✅ Task 02 (SDK Implementation) complete
- Ready for Task 03 (CLI Orchestration)
- SDK layer fully functional

## Next Steps

**Task 03: CLI Orchestration**
- Implement two-phase deployment (agents before workflows)
- Add resource type detection and sorting
- Update CLI apply command

## Technical Notes

### Proto Dependency Resolution
Initially attempted to use local proto stubs with `replace` directive, but discovered internal cross-module dependencies in local stubs. Reverted to BSR (Buf Schema Registry) which was updated with WORKFLOW_TASK_KIND_AGENT_CALL constant.

### Naming Conflict Resolution
Original option names (`WithTimeout`, `WithModel`) conflicted with HTTP task options. Renamed to `AgentTimeout`, `AgentModel`, `AgentTemperature` for clarity and to prevent ambiguity.

---

**Lines Added**: ~650  
**Lines Modified**: ~50  
**Test Coverage**: Comprehensive  
**Documentation**: Inline godocs + working example
