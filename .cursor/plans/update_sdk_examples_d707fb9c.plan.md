---
name: Update SDK Examples
overview: Update all 19 Go SDK examples to use the unified API patterns, fixing breaking changes from the workflow restructuring and agent accessor methods.
todos:
  - id: fix-workflow-control
    content: "Fix examples 08-11: Update workflow creation to struct-based Args pattern"
    status: completed
  - id: fix-workflow-agents
    content: "Fix examples 15-19: Update agent call patterns (AgentBySlug to string, Agent() to .Slug)"
    status: completed
  - id: fix-env-example
    content: "Rewrite example 05: Replace environment.VariableArgs with RequireSecret/RequireConfig"
    status: completed
  - id: fix-agent-accessors
    content: "Fix examples 02, 03, 12: Update agent field access to method calls"
    status: completed
  - id: fix-basic-workflow
    content: "Fix examples 07, 13: Update WorkflowArgs fields and environment pattern"
    status: completed
  - id: verify-working
    content: Verify examples 01, 04, 06 still compile and work correctly
    status: completed
  - id: validate-all
    content: Run go test ./examples/... and ensure all 19 tests pass
    status: completed
isProject: false
---

# Task 4.2: Update SDK Examples to Use Unified API

## Problem Summary

After applying the unified Name/Slug/Args pattern across SDK resources, 17 of 19 example files fail to compile due to API changes. The examples reference removed APIs and outdated patterns.

## Key API Changes to Address

### 1. Workflow Creation Pattern (Affected: 11 examples)

**Old (removed):**

```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("ns"),
    workflow.WithName("name"),
    workflow.WithVersion("1.0.0"),
    workflow.WithDescription("desc"),
)
```

**New (struct-based Args):**

```go
wf, err := workflow.New(ctx, "ns/name", &workflow.WorkflowArgs{
    Description: "desc",
})
// Version defaults to "0.1.0", can override via Args.Document.Version
```

### 2. Workflow Field Access (Affected: 5 examples)


| Old Pattern                    | New Pattern                                                               |
| ------------------------------ | ------------------------------------------------------------------------- |
| `wf.Document.Name`             | `wf.Name` or `wf.Args.Document.Name`                                      |
| `wf.Tasks`                     | `wf.Args.Tasks`                                                           |
| `wf.AddEnvironmentVariable(v)` | `wf.RequireSecret(name, desc)` or `wf.RequireConfig(name, default, desc)` |


### 3. Agent Call Patterns (Affected: 6 examples)

**Old (helper functions):**

```go
Agent: workflow.Agent(agentInstance).Slug()
Agent: workflow.AgentBySlug("code-reviewer")
Agent: workflow.AgentByOrgSlug("org", "slug")
```

**New (direct string):**

```go
Agent: agentInstance.Slug  // For local agent instances
Agent: "code-reviewer"     // Slug-only (uses workflow's org)
Agent: "org/slug"          // Explicit org/slug format
```

### 4. Agent Accessor Methods (Affected: 5 examples)


| Old (field)             | New (method)              |
| ----------------------- | ------------------------- |
| `agent.Instructions`    | `agent.Instructions()`    |
| `agent.Description`     | `agent.Description()`     |
| `agent.IconURL`         | `agent.IconURL()`         |
| `agent.SkillRefs`       | `agent.SkillRefs()`       |
| `agent.McpServerUsages` | `agent.McpServerUsages()` |


### 5. Environment Variables (Affected: 4 examples)

**Old pattern (removed):**

```go
envVar, _ := environment.New(ctx, "VAR_NAME", &environment.VariableArgs{...})
agent.AddEnvironmentVariable(*envVar)
```

**New pattern:**

```go
// Declare required env vars directly on resources
agent.RequireSecret("VAR_NAME", "description")
agent.RequireConfig("VAR_NAME", "default", "description")
wf.RequireSecret("VAR_NAME", "description")
```

## Files to Update

### Group A: Workflow Creation Pattern (High Priority)

These use removed functional options:

- [08_workflow_with_conditionals.go](sdk/go/examples/08_workflow_with_conditionals.go)
- [09_workflow_with_loops.go](sdk/go/examples/09_workflow_with_loops.go)
- [10_workflow_with_error_handling.go](sdk/go/examples/10_workflow_with_error_handling.go)
- [11_workflow_with_parallel_execution.go](sdk/go/examples/11_workflow_with_parallel_execution.go)
- [14_workflow_with_runtime_secrets.go](sdk/go/examples/14_workflow_with_runtime_secrets.go)
- [15_workflow_calling_simple_agent.go](sdk/go/examples/15_workflow_calling_simple_agent.go)
- [16_workflow_calling_agent_by_slug.go](sdk/go/examples/16_workflow_calling_agent_by_slug.go)
- [17_workflow_agent_with_runtime_secrets.go](sdk/go/examples/17_workflow_agent_with_runtime_secrets.go)
- [18_workflow_multi_agent_orchestration.go](sdk/go/examples/18_workflow_multi_agent_orchestration.go)
- [19_workflow_agent_execution_config.go](sdk/go/examples/19_workflow_agent_execution_config.go)

### Group B: Agent Accessor Methods

These use fields instead of methods:

- [02_agent_with_skills.go](sdk/go/examples/02_agent_with_skills.go)
- [03_agent_with_mcp_servers.go](sdk/go/examples/03_agent_with_mcp_servers.go)
- [12_agent_with_typed_context.go](sdk/go/examples/12_agent_with_typed_context.go)

### Group C: Environment Variable Pattern

These use the removed `environment.VariableArgs`:

- [05_agent_with_environment_variables.go](sdk/go/examples/05_agent_with_environment_variables.go) - Major rewrite needed
- [07_basic_workflow.go](sdk/go/examples/07_basic_workflow.go)
- [13_workflow_and_agent_shared_context.go](sdk/go/examples/13_workflow_and_agent_shared_context.go)

### Group D: Already Working (Verify Only)

- [01_basic_agent.go](sdk/go/examples/01_basic_agent.go) - May need accessor updates
- [04_agent_with_subagents.go](sdk/go/examples/04_agent_with_subagents.go) - Uses correct patterns
- [06_agent_with_inline_content.go](sdk/go/examples/06_agent_with_inline_content.go) - Verify still works

## Implementation Strategy

### Phase 1: Fix Critical Workflow Examples

Fix examples 08-11 (control flow demos) first - these are foundational patterns.

### Phase 2: Fix Agent Integration Examples

Fix examples 15-19 (workflow-agent integration) - these demonstrate the unified API.

### Phase 3: Fix Environment Examples

Complete rewrite of example 05 (environment variables) to demonstrate `RequireSecret/RequireConfig` pattern.

### Phase 4: Fix Agent Accessor Examples

Update examples 02, 03, 12 to use method accessors instead of field access.

### Phase 5: Validation

Run full test suite: `go test ./examples/...`

## Quality Standards

Each updated example must:

- Demonstrate ONE clear concept
- Use consistent import patterns
- Include helpful comments explaining the pattern
- Compile and pass tests
- Follow the unified Args pattern

## Validation Command

```bash
cd sdk/go && go test ./examples/... -v
```

All 19 tests must pass with no compilation errors.