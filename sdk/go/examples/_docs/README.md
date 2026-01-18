# Examples Documentation

This directory contains documentation for the Stigmer SDK Go examples.

## Current Examples (10 total)

### Agent Examples (6)
1. **01_basic_agent.go** - Basic agent creation with required and optional fields
2. **02_agent_with_skills.go** - Agent with inline, platform, and organization skills
3. **03_agent_with_mcp_servers.go** - Agent with MCP servers (Stdio, HTTP, Docker)
4. **04_agent_with_subagents.go** - Agent with sub-agents (inline and referenced)
5. **05_agent_with_environment_variables.go** - Agent with environment variables
6. **06_agent_with_instructions_from_files.go** - Agent loading instructions from files

### Workflow Examples (2)
7. **07_basic_workflow.go** - Basic workflow with HTTP GET and task field references
14. **14_workflow_with_runtime_secrets.go** ⭐ - **SECURITY**: Runtime secrets and environment variables

### Context Examples (2)
8. **08_agent_with_typed_context.go** - Agent using typed context variables
9. **09_workflow_and_agent_shared_context.go** - Workflow and agent sharing context

### Advanced Workflow Examples (Planned - Post-MVP)
10. **08_workflow_with_conditionals.go** - Switch/Case conditionals (not yet implemented)
11. **09_workflow_with_loops.go** - ForEach loops (not yet implemented)
12. **10_workflow_with_error_handling.go** - Try/Catch/Finally (not yet implemented)
13. **11_workflow_with_parallel_execution.go** - Fork/Join parallel execution (not yet implemented)

## API Pattern

All examples use the modern `stigmer.Run()` API:

```go
func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create agents
        agent, err := agent.New(ctx,
            agent.WithName("my-agent"),
            agent.WithInstructions("..."),
        )
        
        // Create workflows
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("my-org"),
            workflow.WithName("my-workflow"),
        )
        
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

## Key Features

- **Clean API**: `agent.New(ctx, ...)` and `workflow.New(ctx, ...)` - context as first parameter
- **Automatic synthesis**: Manifests generated when `stigmer.Run()` completes
- **Type safety**: Compile-time checks and IDE autocomplete
- **Pulumi-aligned**: Familiar patterns for infrastructure-as-code developers
- **Security-first**: Runtime secrets never appear in manifests or Temporal history

## 🔒 Security Pattern - Runtime Secrets (Example 14)

**CRITICAL CONCEPT**: Example 14 demonstrates the secure pattern for handling sensitive data.

### The Problem

Using compile-time secrets (❌ WRONG):
```go
apiKey := ctx.SetSecret("key", "sk-proj-abc123")
wf.HttpPost("api", endpoint, workflow.Header("Authorization", apiKey))

// Result: Manifest contains "sk-proj-abc123" ← EXPOSED IN TEMPORAL HISTORY! ❌
```

### The Solution

Using runtime secrets (✅ CORRECT):
```go
wf.HttpPost("api", endpoint, 
    workflow.Header("Authorization", 
        workflow.Interpolate("Bearer ", workflow.RuntimeSecret("OPENAI_API_KEY")),
    ),
)

// Result: Manifest contains "${.secrets.OPENAI_API_KEY}" ← SAFE PLACEHOLDER! ✅
// CLI: stigmer run my-workflow --runtime-env secret:OPENAI_API_KEY=sk-proj-abc123
// Activity: Resolves JIT, discards after execution ← NEVER IN HISTORY! ✅
```

### Example Scenarios Covered

1. **External API Authentication** - OpenAI, Stripe API keys
2. **Environment-Specific Configuration** - Dev/staging/prod endpoints
3. **Multiple Secrets in One Request** - Multiple auth headers
4. **Database Credentials** - Password protection
5. **Shell Scripts with Secrets** - AWS credentials as env vars
6. **Mixed Static and Runtime Config** - Combining fixed and dynamic values

### When to Use Each Pattern

**RuntimeSecret()**: API keys, tokens, passwords, OAuth secrets, private keys  
**RuntimeEnv()**: Environment names, regions, feature flags, non-secret config  
**ctx.SetString()**: Static configuration, public constants, non-secret metadata

## Instructions Directory

The `instructions/` directory contains sample markdown files used by example 06:
- `code-reviewer.md` - Sample agent instructions
- `security-guidelines.md` - Sample skill content
- `testing-best-practices.md` - Sample skill content

These demonstrate loading content from external files.

---

*Last Updated: 2026-01-17*
