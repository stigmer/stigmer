---
name: Fix All Broken SDK Examples
overview: Fix all 7 broken SDK example files (5 agent + 2 workflow) to use the current struct-args API pattern. This brings the entire examples directory into compliance with the Pulumi-aligned API design.
todos:
  - id: fix-example-02
    content: Fix 02_agent_with_skills.go - Replace skill.New/Platform/Organization with skillref, update AddSkill to AddSkillRef
    status: completed
  - id: fix-example-04
    content: Fix 04_agent_with_subagents.go - Replace mcpserver.With*() functional options with struct-args pattern
    status: completed
  - id: fix-example-05
    content: Fix 05_agent_with_environment_variables.go - Replace both environment.With*() and mcpserver.With*() with struct-args
    status: completed
  - id: fix-example-06
    content: Fix 06_agent_with_inline_content.go - Replace skill.New/Platform with skillref, update AddSkill methods
    status: completed
  - id: fix-example-12
    content: Fix 12_agent_with_typed_context.go - Replace skill, environment, and mcpserver APIs with current patterns
    status: completed
  - id: fix-example-07
    content: Fix 07_basic_workflow.go - Replace environment.With*() with struct-args pattern
    status: completed
  - id: fix-example-13
    content: Fix 13_workflow_and_agent_shared_context.go - Replace environment.With*() with struct-args pattern
    status: completed
  - id: verify-builds
    content: Verify all 7 examples compile individually and full SDK builds with go build ./sdk/go/...
    status: completed
isProject: false
---

# Fix All Broken SDK Examples

## Problem Statement

The SDK underwent a major API migration from functional options to Pulumi-aligned struct args, but **7 example files** were not updated. These examples currently use obsolete APIs that don't compile without `//go:build ignore`. This creates a poor developer experience - examples should be the canonical reference for how to use the SDK.

## Scope

**Files to Fix (7 total):**

| File | Issues | Estimated Changes |

|------|--------|-------------------|

| [02_agent_with_skills.go](sdk/go/examples/02_agent_with_skills.go) | `skill.New()`, `skill.Platform()`, `AddSkill()` | ~60 lines |

| [04_agent_with_subagents.go](sdk/go/examples/04_agent_with_subagents.go) | `mcpserver.With*()` functional options | ~40 lines |

| [05_agent_with_environment_variables.go](sdk/go/examples/05_agent_with_environment_variables.go) | `environment.With*()`, `mcpserver.With*()` | ~80 lines |

| [06_agent_with_inline_content.go](sdk/go/examples/06_agent_with_inline_content.go) | `skill.New()`, `skill.Platform()`, `AddSkill()` | ~30 lines |

| [12_agent_with_typed_context.go](sdk/go/examples/12_agent_with_typed_context.go) | All three: skill, environment, mcpserver | ~30 lines |

| [07_basic_workflow.go](sdk/go/examples/07_basic_workflow.go) | `environment.With*()` | ~10 lines |

| [13_workflow_and_agent_shared_context.go](sdk/go/examples/13_workflow_and_agent_shared_context.go) | `environment.With*()` | ~10 lines |

**Already Fixed (reference):**

- [03_agent_with_mcp_servers.go](sdk/go/examples/03_agent_with_mcp_servers.go) - Complete struct-args + skillref implementation

## API Migration Reference

### 1. skill to skillref (Design: SDK references skills, doesn't create them)

```go
// REMOVE - SDK no longer creates inline skills
skill.New("name", &skill.SkillArgs{...})

// CHANGE - Platform skill references
skill.Platform("slug")      -> skillref.Platform("slug")
skill.Organization(o, s)    -> skillref.Organization(o, s)

// CHANGE - Agent methods
agent.AddSkill(...)         -> agent.AddSkillRef(...)
agent.AddSkills(...)        -> agent.AddSkillRefs(...)
agent.Skills                -> agent.SkillRefs
```

### 2. mcpserver: Functional Options to Struct Args

```go
// BEFORE (broken)
mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "..."),
    mcpserver.WithEnvPlaceholder("TOKEN", "${TOKEN}"),
)

// AFTER (current)
server, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
    Command: "npx",
    Args:    []string{"-y", "..."},
    EnvPlaceholders: map[string]string{"TOKEN": "${TOKEN}"},
})
server.EnableTools("tool1", "tool2")  // Builder method for enabled tools
```

### 3. environment: Functional Options to Struct Args

```go
// BEFORE (broken)
environment.New(
    environment.WithName("GITHUB_TOKEN"),
    environment.WithSecret(true),
    environment.WithDescription("GitHub API token"),
)

// AFTER (current)
env, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
    IsSecret:    true,
    Description: "GitHub API token",
})
```

## Implementation Strategy

### Phase 1: Agent Examples (5 files)

**Example 02 (skills):** Complete redesign required

- Remove all `skill.New()` calls (inline skill creation is obsolete)
- Replace `skill.Platform/Organization()` with `skillref.Platform/Organization()`
- Update example narrative to explain "SDK references skills, doesn't create them"
- Change `AddSkill/AddSkills` to `AddSkillRef/AddSkillRefs`
- Update field access from `agent.Skills` to `agent.SkillRefs`

**Example 04 (subagents):** MCP server migration

- Replace all `mcpserver.With*()` calls with struct-args pattern
- Use `mcpserver.Stdio(ctx, name, &StdioArgs{...})` pattern
- Preserve subagent patterns (they're already correct)

**Example 05 (environment):** Most complex - both APIs

- Replace all `environment.With*()` with struct-args
- Replace all `mcpserver.With*()` with struct-args
- Update validation examples to use new API
- Preserve comprehensive documentation comments

**Example 06 (inline content):** Skill migration

- Remove `skill.New()` - redesign to use skillref only
- Update narrative: "Define content in files, push skills via CLI, reference here"
- Replace `skill.Platform()` with `skillref.Platform()`

**Example 12 (typed context):** All three migrations

- Environment, mcpserver, and skill APIs all need updating
- Smallest changes per API since it's a focused example

### Phase 2: Workflow Examples (2 files)

**Example 07 (basic workflow):** Simple environment fix

- Replace `environment.With*()` with struct-args

**Example 13 (shared context):** Simple environment fix

- Replace `environment.With*()` with struct-args

### Phase 3: Verification

After all changes:

```bash
# Verify each example compiles
go build ./sdk/go/examples/02_agent_with_skills.go
go build ./sdk/go/examples/04_agent_with_subagents.go
go build ./sdk/go/examples/05_agent_with_environment_variables.go
go build ./sdk/go/examples/06_agent_with_inline_content.go
go build ./sdk/go/examples/07_basic_workflow.go
go build ./sdk/go/examples/12_agent_with_typed_context.go
go build ./sdk/go/examples/13_workflow_and_agent_shared_context.go

# Verify full SDK still builds
go build ./sdk/go/...
```

## Quality Standards

Each fixed example must:

- Use the exact Pulumi struct-args pattern from current SDK
- Include proper error handling (check every error)
- Have clear, educational comments explaining concepts
- Demonstrate idiomatic Go code (no unnecessary variables, clean imports)
- Be production-quality code worthy of a world-class platform
- Follow the patterns established in [03_agent_with_mcp_servers.go](sdk/go/examples/03_agent_with_mcp_servers.go)

## Success Criteria

- All 7 example files compile cleanly with `go build`
- Full SDK builds: `go build ./sdk/go/...`
- No obsolete `skill.`, `mcpserver.With*`, or `environment.With*` calls remain
- Examples serve as canonical reference for SDK usage
- Code is clean, educational, and production-ready