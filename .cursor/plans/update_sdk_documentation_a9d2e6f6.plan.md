---
name: Update SDK Documentation
overview: Update all SDK documentation to reflect the unified Name/Slug/Args pattern, correct API signatures, and remove references to deprecated patterns like functional options and the deleted subagent package.
todos:
  - id: phase1-readme
    content: Update README.md - Quick Start, Project Structure, SubAgent, Environment sections with correct struct args patterns
    status: completed
  - id: phase1-getting-started
    content: Rewrite docs/getting-started.md - Replace all functional options with struct args patterns for agent, workflow, skill
    status: completed
  - id: phase2-stigmer-doc
    content: Update stigmer/doc.go - Fix Quick Start examples to use struct args
    status: completed
  - id: phase2-workflow-doc
    content: Update workflow/doc.go - Update examples to use AddTask() and struct args
    status: completed
  - id: phase2-agent-doc
    content: Update agent/doc.go - Update examples to show AddSkillRef(), AddMcpServerUsage(), SubAgent
    status: completed
  - id: phase3-architecture
    content: Update docs/architecture/struct-args-pattern.md - Add unified Name/Slug/Args pattern documentation
    status: completed
  - id: phase3-docs-readme
    content: Update docs/README.md - Fix Quick Reference section and example references
    status: completed
  - id: validation
    content: Validate all documentation code examples compile and match actual API signatures
    status: completed
isProject: false
---

# Task 4.3: Update SDK Documentation

## Context

The SDK has undergone significant architectural changes through Tasks 3.1-4.1:

- All resources now follow the unified **Name/Slug/Org/Args** pattern
- **Args is the single source of truth** (no duplicate fields)
- **SubAgent consolidated** into the agent package (subagent/ deleted)
- **commons/ref/** package provides resource reference factories
- Workflow uses immediate proto conversion (fail-fast)
- Skill has a unique architecture (content artifact vs configuration)

The documentation currently contains many outdated patterns and references.

---

## Documentation Gap Analysis

### 1. Main README.md ([README.md](sdk/go/README.md)) - MAJOR UPDATES NEEDED

**Issues Found:**

- Uses old functional options pattern (`agent.WithName()`, `agent.WithInstructions()`)
- References deleted `subagent/` package in project structure
- Quick start shows wrong API signatures
- Environment section uses old `environment.New(ctx, name, &VariableArgs{})` pattern
- Project structure is outdated

**Changes Required:**

- Update Quick Start to struct args pattern: `agent.New(ctx, name, &agent.AgentArgs{})`
- Update all code examples to new APIs
- Fix project structure (remove subagent/, add commons/ref/)
- Update SubAgent section to show `agent.NewSubAgent()` pattern
- Update Environment section to show first-class resource pattern

### 2. Getting Started Guide ([docs/getting-started.md](sdk/go/docs/getting-started.md)) - MAJOR UPDATES NEEDED

**Issues Found:**

- Uses completely OLD functional options pattern throughout
- `agent.WithName()`, `agent.WithInstructionsFromFile()` - doesn't exist
- `workflow.WithNamespace()`, `workflow.WithName()` - old pattern
- `skill.WithName()`, `skill.WithMarkdownFromFile()` - doesn't exist

**Changes Required:**

- Rewrite agent examples with struct args pattern
- Rewrite workflow examples with new `workflow.New(ctx, name, &WorkflowArgs{})` pattern
- Update skill examples to show `skill.FromDir()` / `skill.FromGit()` pattern
- Fix Quick Reference section

### 3. Package doc.go Files - MODERATE UPDATES NEEDED


| File                 | Status         | Changes                                                          |
| -------------------- | -------------- | ---------------------------------------------------------------- |
| `agent/doc.go`       | Mostly correct | Update examples to show `AddSkillRef()`, `AddMcpServerUsage()`   |
| `workflow/doc.go`    | Mixed patterns | Update examples to use `AddTask()` instead of deprecated methods |
| `environment/doc.go` | Correct        | Minor verification                                               |
| `mcpserver/doc.go`   | Correct        | Minor verification                                               |
| `skill/doc.go`       | Correct        | Already updated                                                  |
| `commons/ref/doc.go` | Correct        | Already updated                                                  |
| `stigmer/doc.go`     | Old patterns   | Update to show struct args patterns                              |


### 4. Architecture Documentation - NEW DOCUMENTATION NEEDED

**Create/Update:**

- Update [struct-args-pattern.md](sdk/go/docs/architecture/struct-args-pattern.md) to document **unified Name/Slug/Args pattern**
- Document **Args as single source of truth** principle
- Document **commons/ref/** package architecture
- Document **fail-fast validation** approach

### 5. docs/README.md - MINOR UPDATES NEEDED

**Issues Found:**

- Quick Reference section shows old patterns
- Some example references may be incorrect

---

## Implementation Approach

### Priority Order (Dependencies)

1. **Phase 1: Core Documentation** (Highest Impact)
  - [README.md](sdk/go/README.md) - Main entry point, most visible
  - [docs/getting-started.md](sdk/go/docs/getting-started.md) - New user experience
2. **Phase 2: Package Documentation**
  - [stigmer/doc.go](sdk/go/stigmer/doc.go) - Core orchestration docs
  - [workflow/doc.go](sdk/go/workflow/doc.go) - Workflow API docs
  - [agent/doc.go](sdk/go/agent/doc.go) - Agent API docs
3. **Phase 3: Architecture Documentation**
  - [docs/architecture/struct-args-pattern.md](sdk/go/docs/architecture/struct-args-pattern.md) - Pattern documentation
  - [docs/README.md](sdk/go/docs/README.md) - Index updates

---

## Detailed Changes

### README.md Changes

**Quick Start Section:**

```go
// BEFORE (functional options - WRONG)
myAgent, err := agent.New(ctx,
    agent.WithName("code-reviewer"),
    agent.WithInstructions("Review code..."),
)

// AFTER (struct args - CORRECT)
myAgent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code for security, performance, and best practices.",
    Description:  "AI code reviewer with security expertise",
})
```

**Project Structure:**

```
// BEFORE (outdated)
├── subagent/        # Sub-agent configuration  <-- DELETED

// AFTER (correct)
├── agent/           # Agent + SubAgent (consolidated)
├── commons/         # Shared utilities
│   └── ref/         # Resource reference factories
```

**SubAgent Section:**

```go
// BEFORE (wrong - separate package)
analyzer, err := subagent.New(ctx, "code-analyzer", &subagent.SubAgentArgs{...})

// AFTER (correct - within agent package)
analyzer := agent.NewSubAgent("code-analyzer", &agent.SubAgentArgs{
    Instructions: "Analyze code quality",
})
parentAgent.AddSubAgent(analyzer)
```

### docs/getting-started.md Changes

**Agent Creation:**

```go
// BEFORE (functional options - doesn't work)
agent.New(ctx, agent.WithName("code-reviewer"), agent.WithInstructionsFromFile("..."))

// AFTER (struct args pattern)
import "os"

instructions, _ := os.ReadFile("instructions/reviewer.md")
ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: string(instructions),
    Description:  "AI code reviewer",
})
```

**Workflow Creation:**

```go
// BEFORE (functional options - doesn't work)  
wf, err := workflow.New(ctx,
    workflow.WithNamespace("examples"),
    workflow.WithName("hello-workflow"),
    workflow.WithVersion("1.0.0"),
)

// AFTER (struct args pattern)
wf, err := workflow.New(ctx, "examples/hello-workflow", &workflow.WorkflowArgs{
    Description: "Hello world workflow",
})
```

### stigmer/doc.go Updates

Update Quick Start examples to use struct args:

```go
// Current (uses old WithName pattern)
ag, err := agent.New(ctx,
    agent.WithName("code-reviewer"),
    ...
)

// Updated
ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements",
})
```

### Architecture Documentation Updates

Add to struct-args-pattern.md:

```markdown
## Unified Resource Pattern

All SDK resources follow the **Name/Slug/Org/Args** pattern:

| Resource | Constructor | Args Type |
|----------|-------------|-----------|
| Agent | `agent.New(ctx, name, &AgentArgs{})` | AgentArgs |
| Workflow | `workflow.New(ctx, name, &WorkflowArgs{})` | WorkflowArgs |
| Environment | `environment.New(ctx, name, &EnvironmentArgs{})` | EnvironmentArgs |
| MCPServer | `mcpserver.Stdio(ctx, name, &McpServerArgs{})` | McpServerArgs |
| Skill | `skill.FromDir(ctx, path, opts...)` | N/A (content artifact) |

### Args as Single Source of Truth

- Args struct holds ALL configuration
- No duplicate fields on resource struct
- Builder methods modify Args directly
```

---

## Quality Standards

- All code examples MUST compile
- Examples should reflect actual current API signatures
- Verify against actual `agent.go`, `workflow.go`, etc. implementations
- Cross-reference with updated examples (01_basic_agent.go, 07_basic_workflow.go)
- Ensure consistency across all documentation files

---

## Validation

After updates:

1. Review all code examples for correctness
2. Ensure package imports match actual structure
3. Verify API signatures match implementations
4. Check that deleted packages (subagent/) are not referenced
5. Confirm commons/ref/ usage is documented correctly

