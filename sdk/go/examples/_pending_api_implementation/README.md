# Pending API Implementation

These examples have been migrated to use the new `Set()` API, but require additional high-level workflow APIs that haven't been implemented yet.

## Examples in This Folder

### 08_workflow_with_conditionals.go
**Status**: API migration complete, awaiting Switch task API  
**Required APIs**:
- `wf.Switch(name, ...options)` - Switch task builder
- `workflow.SwitchOn(condition)` - Switch condition option  
- `workflow.Case(matcher, target)` - Case branch option
- `workflow.Equals(value)` - Equality matcher
- `workflow.DefaultCase(target)` - Default case option

**Proto Support**: ✅ Complete (SwitchTaskConfig exists in gen/)  
**Migration Status**: ✅ SetVars → Set (complete)  
**Estimated Work**: ~2 hours to implement high-level Switch API

---

### 09_workflow_with_loops.go
**Status**: API migration complete, awaiting ForEach task API  
**Required APIs**:
- `wf.ForEach(name, ...options)` - ForEach task builder
- `workflow.IterateOver(collection)` - Iteration source option
- `workflow.WithLoopBody(fn)` - Loop body builder
- `workflow.LoopVar` - Loop variable type

**Proto Support**: ✅ Complete (ForTaskConfig exists in gen/)  
**Migration Status**: ✅ SetVars → Set (complete)  
**Estimated Work**: ~2 hours to implement high-level ForEach API

---

### 10_workflow_with_error_handling.go
**Status**: API migration complete, awaiting Try/Catch task API  
**Required APIs**:
- `wf.Try(name, ...options)` - Try task builder
- `workflow.TryBlock(fn)` - Try block builder
- `workflow.CatchBlock(fn)` - Catch block builder
- `workflow.FinallyBlock(fn)` - Finally block builder
- `workflow.ErrorRef` - Error reference type

**Proto Support**: ✅ Complete (TryTaskConfig exists in gen/)  
**Migration Status**: ✅ SetVars → Set (complete)  
**Estimated Work**: ~3 hours to implement high-level Try/Catch API

---

### 11_workflow_with_parallel_execution.go
**Status**: API migration complete, awaiting Fork task API  
**Required APIs**:
- `wf.Fork(name, ...options)` - Fork task builder
- `workflow.ParallelBranches(...branches)` - Branches option
- `workflow.Branch(name, fn)` - Branch builder
- `workflow.WaitForAll()` - Wait strategy option
- Support for typed context variables (IntRef, StringRef)

**Proto Support**: ✅ Complete (ForkTaskConfig exists in gen/)  
**Migration Status**: ✅ SetVars → Set (complete)  
**Estimated Work**: ~3 hours to implement high-level Fork API

---

### 18_workflow_multi_agent_orchestration.go
**Status**: API migration complete, awaiting advanced features  
**Required APIs**:
- `workflow.Interpolate(...values)` - String interpolation builder
- `workflow.WithEnv(map)` - Environment variables option
- `workflow.AgentTimeout(seconds)` - Agent call timeout option
- `workflow.RuntimeSecret(key)` - Runtime secret reference
- `workflow.RuntimeEnv(key)` - Runtime environment variable reference
- `workflow.WithBody(map)` - HTTP request body option

**Proto Support**: ✅ Complete (all task configs exist)  
**Migration Status**: ✅ SetVars → Set (complete)  
**Estimated Work**: ~4 hours to implement all advanced features

---

## Total Implementation Effort

**Estimated time**: ~14 hours to implement all missing high-level APIs

### Implementation Strategy

1. **Phase 1** (~4 hours): Implement Switch and ForEach APIs
   - Enable examples 08 and 09
   - Pattern: Follow existing HttpGet/HttpPost/Set implementations
   
2. **Phase 2** (~6 hours): Implement Try/Catch and Fork APIs
   - Enable examples 10 and 11
   - More complex due to nested task structures
   
3. **Phase 3** (~4 hours): Implement advanced features
   - Enable example 18
   - Interpolation, runtime secrets/env, advanced options

### Notes

- All examples **compile successfully** with old SetVars API
- Proto conversion already works (ToProto() methods exist)
- Only high-level builder APIs are missing
- Examples demonstrate important real-world patterns
- Can be implemented incrementally (one feature at a time)

---

## Current Working Examples

These examples are fully functional in `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/examples/`:

1. ✅ 01_basic_agent.go - Basic agent creation
2. ✅ 02_agent_with_skills.go - Agent with skills  
3. ✅ 03_agent_with_mcp_servers.go - Agent with MCP servers
4. ✅ 04_agent_with_subagents.go - Agent with sub-agents
5. ✅ 05_agent_with_environment_variables.go - Agent with env vars
6. ✅ 06_agent_with_instructions_from_files.go - Agent with file-based instructions
7. ✅ 07_basic_workflow.go - Basic workflow (tested)
8. ✅ 12_agent_with_typed_context.go - Agent with typed context (tested)
9. ✅ 13_workflow_and_agent_shared_context.go - Workflow + Agent (tested)
10. ✅ 14_workflow_with_runtime_secrets.go - Workflow with runtime secrets
11. ✅ 15_workflow_calling_simple_agent.go - Workflow calling agent
12. ✅ 16_workflow_calling_agent_by_slug.go - Workflow calling agent by slug
13. ✅ 17_workflow_agent_with_runtime_secrets.go - Agent with runtime secrets
14. ✅ 19_workflow_agent_execution_config.go - Agent execution config

**Total**: 14 fully working examples (73% complete)

---

## To Implement These Examples

### Option A: Implement High-Level APIs (Recommended)

Follow the pattern from existing task builders:

```go
// In sdk/go/workflow/workflow.go

// Switch creates a SWITCH task for conditional logic
func (wf *Workflow) Switch(name string, opts ...SwitchOption) *Task {
    config := &SwitchTaskConfig{}
    for _, opt := range opts {
        opt(config)
    }
    task := &Task{
        Name: name,
        Kind: TaskKindSwitch,
        Config: config,
    }
    wf.Tasks = append(wf.Tasks, task)
    return task
}
```

Then create functional options in `sdk/go/workflow/switch_options.go`:

```go
type SwitchOption func(*SwitchTaskConfig)

func SwitchOn(condition interface{}) SwitchOption {
    return func(c *SwitchTaskConfig) {
        // Implementation
    }
}

func Case(matcher Matcher, target string) SwitchOption {
    return func(c *SwitchTaskConfig) {
        // Implementation
    }
}
```

### Option B: Use Low-Level API (Temporary)

Examples can be rewritten to use the generated task configs directly:

```go
// Instead of:
wf.Switch("routeByStatus",
    workflow.SwitchOn(checkTask.Field("statusCode")),
    workflow.Case(workflow.Equals(200), "deployProduction"),
)

// Use:
switchTask := &workflow.Task{
    Name: "routeByStatus",
    Kind: workflow.TaskKindSwitch,
    Config: &workflow.SwitchTaskConfig{
        // Configure directly
    },
}
wf.Tasks = append(wf.Tasks, switchTask)
```

This is more verbose but works immediately.

---

## Related Documentation

- **Code Generator**: `tools/codegen/generator/` - Generates low-level task configs
- **Workflow Package**: `sdk/go/workflow/` - High-level workflow builders
- **Task Options**: `sdk/go/workflow/*_options.go` - Functional option patterns
- **Proto Definitions**: `apis/ai/stigmer/agentic/workflow/v1/tasks/` - Task proto definitions

---

**Last Updated**: 2026-01-22  
**Status**: Awaiting high-level API implementation
