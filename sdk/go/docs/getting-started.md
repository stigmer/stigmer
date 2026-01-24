# Getting Started with Stigmer Go SDK

**New to Stigmer?** This guide will get you building AI agents and workflows in 10 minutes.

## Prerequisites

- **Go 1.21+** installed ([download](https://go.dev/dl/))
- **Basic Go knowledge** (functions, structs, error handling)
- **Text editor** (VS Code recommended)

## Installation

### Step 1: Install the SDK

```bash
go get github.com/stigmer/stigmer/sdk/go
```

### Step 2: Install the Stigmer CLI

**macOS/Linux**:
```bash
curl -fsSL https://get.stigmer.ai/install.sh | sh
```

**Windows**:
```powershell
iwr https://get.stigmer.ai/install.ps1 -useb | iex
```

**Verify installation**:
```bash
stigmer version
```

### Step 3: Authenticate

```bash
stigmer login
```

This opens your browser to authenticate with Stigmer Cloud.

---

## Your First Agent (5 Minutes)

### Step 1: Create Project Structure

```bash
mkdir my-first-agent
cd my-first-agent
go mod init my-first-agent
```

### Step 2: Create Instructions File

Create `instructions/reviewer.md`:

```markdown
# Code Reviewer

You are an expert code reviewer. Your job is to:

1. Review code for bugs and issues
2. Check for best practices
3. Suggest improvements
4. Identify security concerns

Be thorough but constructive in your feedback.
```

### Step 3: Create the Agent

Create `main.go`:

```go
package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create agent
        codeReviewer, err := agent.New(ctx,
            agent.WithName("code-reviewer"),
            agent.WithInstructionsFromFile("instructions/reviewer.md"),
            agent.WithDescription("AI code reviewer"),
        )
        if err != nil {
            return err
        }
        
        log.Printf("✅ Created agent: %s", codeReviewer.Name)
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

### Step 4: Deploy

```bash
stigmer apply main.go --org my-org --env dev
```

**Congratulations!** 🎉 You just created and deployed your first AI agent!

---

## Your First Workflow (5 Minutes)

### Step 1: Create the Workflow

Create `workflow.go`:

```go
package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create workflow
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("examples"),
            workflow.WithName("hello-workflow"),
            workflow.WithVersion("1.0.0"),
        )
        if err != nil {
            return err
        }
        
        // Task 1: Fetch data from API
        fetchTask := wf.HttpGet("fetch-data",
            "https://jsonplaceholder.typicode.com/posts/1",
            workflow.Header("Content-Type", "application/json"),
        )
        
        // Task 2: Process the data
        wf.SetVars("process",
            "postTitle", fetchTask.Field("title"),
            "postBody", fetchTask.Field("body"),
            "status", "complete",
        )
        
        log.Printf("✅ Created workflow with %d tasks", len(wf.Tasks))
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

### Step 2: Deploy

```bash
stigmer apply workflow.go --org my-org --env dev
```

**Done!** 🎉 You just created a workflow that fetches and processes data.

---

## Core Concepts

### The `stigmer.Run()` Function

Everything starts here:

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Your resources go here
    return nil
})
```

**What it does**:
- Creates a context for resource management
- Tracks dependencies automatically
- Synthesizes resources to proto
- Handles cleanup on completion

**Think of it like**: `main()` for Stigmer resources

### The Context

The context (`ctx`) is your control center:

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Create agent (registers with context)
    agent, _ := agent.New(ctx, agent.WithName("my-agent"))
    
    // Create workflow (registers with context)
    wf, _ := workflow.New(ctx, workflow.WithName("my-workflow"))
    
    return nil
})
```

**The context**:
- ✅ Tracks all resources
- ✅ Manages dependencies
- ✅ Stores configuration
- ✅ Ensures correct ordering

### Resources

Three main types of resources:

1. **Agents** - AI assistants with instructions
2. **Workflows** - Orchestrated task sequences
3. **Skills** - Knowledge for agents

They register themselves automatically when created.

---

## Common Patterns

### Pattern 1: File-Based Content

**✅ Best Practice**: Keep content in files, not code

```
my-project/
├── main.go
├── instructions/
│   ├── code-reviewer.md
│   └── security-checker.md
└── skills/
    └── coding-guidelines.md
```

**Why**:
- Easy to edit (use your favorite Markdown editor)
- Version controlled
- Separate concerns (content vs code)
- Better collaboration

### Pattern 2: Agent with Skills

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Create skill
    skill, _ := skill.New(
        skill.WithName("coding-standards"),
        skill.WithMarkdownFromFile("skills/coding.md"),
    )
    
    // Create agent with skill
    agent, _ := agent.New(ctx,
        agent.WithName("code-reviewer"),
        agent.WithInstructionsFromFile("instructions/reviewer.md"),
        agent.WithSkills(skill),
    )
    
    return nil
})
```

### Pattern 3: Workflow with HTTP Tasks

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    wf, _ := workflow.New(ctx,
        workflow.WithNamespace("api-client"),
        workflow.WithName("data-fetch"),
        workflow.WithVersion("1.0.0"),
    )
    
    // Fetch data
    fetchTask := wf.HttpGet("fetch", "https://api.example.com/data",
        workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
        workflow.Timeout(30),
    )
    
    // Process data (depends on fetchTask automatically)
    wf.SetVars("process",
        "title", fetchTask.Field("title"),
        "body", fetchTask.Field("body"),
    )
    
    return nil
})
```

**Key insight**: Dependencies are automatic through field references!

---

## Development Workflow

### Local Development

```bash
# 1. Write code
vim main.go

# 2. Test locally
go run main.go

# 3. Deploy to dev environment
stigmer apply main.go --org my-org --env dev
```

### Testing

```bash
# Run Go tests
go test ./...

# Dry run (validate without deploying)
stigmer apply main.go --dry-run
```

### Iteration

```bash
# Make changes
vim instructions/reviewer.md

# Redeploy (Stigmer handles updates)
stigmer apply main.go --org my-org --env dev
```

---

## Next Steps

### Learn More

1. **Full Usage Guide**: [usage.md](usage.md) - Comprehensive API documentation
2. **Examples**: `sdk/go/examples/` - 19 working examples
3. **API Reference**: [pkg.go.dev](https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go)

### Build Something Real

**Starter Projects**:

1. **Code Review Bot**
   - Agent with coding skills
   - GitHub MCP server
   - Review PRs automatically

2. **Data Processing Pipeline**
   - Workflow with HTTP tasks
   - Fetch → Process → Store
   - Error handling

3. **Multi-Agent System**
   - Multiple specialized agents
   - Workflow orchestration
   - Agent-to-agent delegation

### Get Help

- **Documentation**: [docs.stigmer.ai](https://docs.stigmer.ai)
- **GitHub Issues**: [stigmer/stigmer](https://github.com/stigmer/stigmer/issues)
- **Discord**: [stigmer.ai/discord](https://stigmer.ai/discord)

---

## Quick Reference

### Agent Creation

```go
agent, err := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructionsFromFile("instructions/agent.md"),
)
```

### Skill Creation

```go
skill, err := skill.New(
    skill.WithName("my-skill"),
    skill.WithMarkdownFromFile("skills/skill.md"),
)
```

### Workflow Creation

```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("my-namespace"),
    workflow.WithName("my-workflow"),
    workflow.WithVersion("1.0.0"),
)
```

### HTTP Task

```go
task := wf.HttpGet("fetch", "https://api.example.com/data",
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

### SET Task

```go
wf.SetVars("variables",
    "key1", "value1",
    "key2", fetchTask.Field("field"),
)
```

### Field Reference

```go
// Reference output from another task
value := previousTask.Field("fieldName")
```

---

## Troubleshooting

### "cannot find package"

**Solution**: Run `go mod tidy` to download dependencies

```bash
go mod tidy
```

### "agent not registered with context"

**Problem**: Forgot to pass context

```go
// ❌ Wrong
agent, _ := agent.New(agent.WithName("my-agent"))

// ✅ Correct
agent, _ := agent.New(ctx, agent.WithName("my-agent"))
```

### "validation failed: name must be lowercase"

**Solution**: Use lowercase with hyphens

```go
// ❌ Wrong
agent.WithName("My Agent")

// ✅ Correct
agent.WithName("my-agent")
```

### "file not found"

**Solution**: Check file paths are relative to project root

```go
// Make sure file exists
agent.WithInstructionsFromFile("instructions/agent.md")
```

---

## Summary

You now know:

- ✅ How to install and setup the SDK
- ✅ How to create agents and workflows
- ✅ How to organize your project
- ✅ How to deploy resources
- ✅ Common patterns and best practices

**Ready to build?** Check out the [examples](../examples/) or dive into the [full usage guide](usage.md)!

---

**Questions?** Join our [Discord community](https://stigmer.ai/discord)!
