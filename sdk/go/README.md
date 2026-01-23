# Stigmer SDK - Go

A Go SDK for defining AI agents and workflows for the Stigmer platform.

**Repository**: [github.com/leftbin/stigmer-sdk](https://github.com/leftbin/stigmer-sdk)  
**Go Package**: `github.com/leftbin/stigmer-sdk/go`

## Features

### Core Features
- **Agents & Workflows**: Define both AI agents and workflow orchestrations
- **Struct-based Args**: Pulumi-style configuration with excellent IDE support (v0.2.0+)
- **Proto-agnostic SDK**: Pure Go library with no proto dependencies
- **File-based content**: Load instructions and skills from markdown files
- **Inline resources**: Define skills and sub-agents directly in your repository
- **Type-safe**: Leverage Go's type system for compile-time safety
- **Well-tested**: Comprehensive unit and integration tests

### Developer Experience
- **IDE Autocomplete**: Full field discovery and type information
- **Nil-Safe**: All args optional with sensible defaults
- **Convenience Methods**: Shortcuts for common patterns (HttpGet, SetVars)
- **Helper Types**: Ergonomic runtime value access (ErrorRef, LoopVar)
- **Industry Standard**: Matches Pulumi, Terraform, and AWS SDK patterns

### Workflow Features
- **Pulumi-aligned API**: Professional infrastructure-as-code patterns
- **Typed Context System**: Compile-time checked configuration with IDE autocomplete
- **Implicit Dependencies**: Automatic dependency tracking through field references
- **Clean Builders**: Intuitive one-liner task creation (`wf.HttpGet()`, `wf.HttpPost()`)
- **Clear Data Flow**: Direct task output references (`fetchTask.Field("title")`)
- **Shared Context**: Configuration shared between workflows and agents

## Installation

```bash
go get github.com/leftbin/stigmer-sdk/go
```

## 🔄 Migrating to v0.2.0+

**v0.2.0 introduces struct-based args** (Pulumi pattern) replacing functional options.

**Benefits**:
- ✅ Better IDE autocomplete and field discovery
- ✅ Clearer, more maintainable code
- ✅ Industry-standard patterns
- ✅ Nil-safe with sensible defaults

**Migration guide**: See [Struct Args Migration Guide](docs/guides/struct-args-migration.md) for complete before/after examples and troubleshooting.

**Quick comparison**:
```go
// OLD (v0.1.x): Functional options
agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructions("..."),
    agent.WithSkills(skill),
)

// NEW (v0.2.0+): Struct args
agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
    Skills:       []*skill.Skill{skill},
})
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"
    
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
    "github.com/leftbin/stigmer-sdk/go/mcpserver"
    "github.com/leftbin/stigmer-sdk/go/stigmer"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create inline skill from markdown file
        securitySkill, err := skill.New("security-guidelines", &skill.SkillArgs{
            Description: "Security review guidelines",
            Markdown:    skill.LoadMarkdownFromFile("skills/security.md"),
        })
        if err != nil {
            return err
        }

        // Create MCP server
        githubMCP, err := mcpserver.Stdio(
            mcpserver.WithName("github"),
            mcpserver.WithCommand("npx"),
            mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
            mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
        )
        if err != nil {
            return err
        }

        // Create agent with struct-based args (v0.2.0+)
        myAgent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: agent.LoadInstructionsFromFile("instructions/reviewer.md"),
            Description:  "AI code reviewer with security expertise",
            IconURL:      "https://example.com/icon.png",
            Skills:       []*skill.Skill{securitySkill},
            MCPServers:   []*mcpserver.MCPServer{githubMCP},
        })
        if err != nil {
            return err
        }
        
        fmt.Printf("Agent created: %s\n", myAgent.Name)
        
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

## Core Concepts

### Agent

The `Agent` is the main blueprint that defines:
- Name and instructions (required) - load from files with `WithInstructionsFromFile()`
- Description and icon (optional)
- Skills (knowledge references) - inline or platform/org references
- MCP servers (tool providers)
- Sub-agents (delegatable agents)
- Environment variables (configuration)

**Key Features:**
- **File-based instructions**: Load from markdown files instead of inline strings
- **Builder pattern**: Add components after creation with `AddSkill()`, `AddMCPServer()`, etc.
- **Proto-agnostic**: No proto types or conversion - just pure Go

### Skills

Skills provide knowledge to agents. Three ways to use them:

#### 1. Inline Skills (Defined in Repository)
Create skills with markdown content from files:

```go
// Define skill in your repository
securitySkill, _ := skill.New(
    skill.WithName("security-guidelines"),
    skill.WithDescription("Security review guidelines"),
    skill.WithMarkdownFromFile("skills/security.md"),
)

// Add to agent
myAgent.AddSkill(*securitySkill)
```

**Benefits:**
- ✅ Version controlled with your agent code
- ✅ Easy to edit and update
- ✅ Sharable across agents in your repository

#### 2. Platform Skills (Shared)
Reference skills available platform-wide:

```go
myAgent.AddSkill(skill.Platform("coding-best-practices"))
```

#### 3. Organization Skills (Private)
Reference skills private to your organization:

```go
myAgent.AddSkill(skill.Organization("my-org", "internal-standards"))
```

### MCP Servers

MCP (Model Context Protocol) servers provide tools to agents. Three types:

#### 1. Stdio Servers
Subprocess-based servers (most common):

```go
agent.WithMCPServer(mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
    mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
))
```

#### 2. HTTP Servers
Remote HTTP + SSE servers:

```go
agent.WithMCPServer(mcpserver.HTTP(
    mcpserver.WithName("remote-mcp"),
    mcpserver.WithURL("https://mcp.example.com/github"),
    mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
    mcpserver.WithTimeout(30),
))
```

#### 3. Docker Servers
Containerized MCP servers:

```go
agent.WithMCPServer(mcpserver.Docker(
    mcpserver.WithName("custom-mcp"),
    mcpserver.WithImage("ghcr.io/org/custom-mcp:latest"),
    mcpserver.WithVolumeMount("/host/path", "/container/path", false),
    mcpserver.WithPortMapping(8080, 80, "tcp"),
))
```

### Sub-Agents

Sub-agents allow delegation to specialized agents:

#### Inline Sub-Agents
Defined within the parent agent:

```go
agent.WithSubAgent(subagent.Inline(
    subagent.WithName("code-analyzer"),
    subagent.WithInstructions("Analyze code quality"),
    subagent.WithMCPServer("github"),
    subagent.WithSkill(skill.Platform("static-analysis")),
))
```

#### Referenced Sub-Agents
Reference existing agents:

```go
agent.WithSubAgent(subagent.Reference("agent-instance-id"))
```

### Environment Variables

Define configuration and secret requirements for agents.

#### Secret Variables
Required secrets are encrypted at rest:

```go
apiKey, _ := environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
    environment.WithDescription("API key for external service"),
)
agent.WithEnvironmentVariable(apiKey)
```

#### Configuration with Defaults
Optional configuration values with sensible defaults:

```go
region, _ := environment.New(
    environment.WithName("AWS_REGION"),
    environment.WithDefaultValue("us-east-1"),
    environment.WithDescription("AWS deployment region"),
)
agent.WithEnvironmentVariable(region)
```

#### Key Features
- **Secrets**: Encrypted at rest, redacted in logs (use `WithSecret(true)`)
- **Configuration**: Plaintext values for non-sensitive data
- **Defaults**: Variables with defaults are automatically optional
- **Validation**: Names must be uppercase with underscores (e.g., `GITHUB_TOKEN`)
- **Required/Optional**: Control whether values must be provided

## Architecture

The SDK follows a **proto-agnostic architecture**:

```
User Repository (Your Code)
    ↓ uses
SDK (Pure Go, No Proto)
    ↓ reads
CLI (stigmer-cli)
    ↓ converts to proto
Platform (Stigmer API)
```

**Key Principles:**
- ✅ SDK is proto-ignorant - no proto dependencies
- ✅ Users write pure Go code
- ✅ CLI handles all proto conversion and deployment
- ✅ SDK and proto can evolve independently

See [docs/references/proto-mapping.md](docs/references/proto-mapping.md) for how CLI converts SDK types to proto messages.

## Validation

All inputs are validated at construction time:

- **Name**: lowercase alphanumeric + hyphens, max 63 chars
- **Instructions**: min 10 chars, max 10,000 chars
- **Description**: max 500 chars
- **URLs**: valid URL format

Validation errors provide clear, actionable feedback:

```go
agent, err := agent.New(agent.WithName("Invalid Name!"))
// err: validation failed for field "name": name must be lowercase...
```

## Workflows

Create workflow orchestrations with Pulumi-aligned patterns.

### Quick Start - Basic Workflow

```go
package main

import (
    "log"
    "github.com/leftbin/stigmer-sdk/go/stigmer"
    "github.com/leftbin/stigmer-sdk/go/workflow"
)

func main() {
    // Use stigmer.Run() for automatic context and synthesis management
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Context: ONLY for shared configuration (like Pulumi's Config)
        apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
        orgName := ctx.SetString("org", "my-org")
        
        // Create workflow with context
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("data-processing"),
            workflow.WithName("basic-data-fetch"),
            workflow.WithVersion("1.0.0"),
            workflow.WithOrg(orgName),  // Use context config
        )
        if err != nil {
            return err
        }
        
        // Build endpoint URL using context config
        endpoint := apiBase.Concat("/posts/1")
        
        // Task 1: Fetch data from API (clean, one-liner!)
        fetchTask := wf.HttpGet("fetchData", endpoint,
            workflow.Header("Content-Type", "application/json"),
            workflow.Timeout(30),
        )
        
        // Task 2: Process response using DIRECT task references
        // Dependencies are implicit - no manual wiring needed!
        processTask := wf.SetVars("processResponse",
            "postTitle", fetchTask.Field("title"),  // ✅ Clear: from fetchTask!
            "postBody", fetchTask.Field("body"),    // ✅ Clear: from fetchTask!
            "status", "success",
        )
        
        // No manual dependency management needed!
        // processTask automatically depends on fetchTask
        
        log.Printf("Created workflow with %d tasks", len(wf.Tasks))
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
    
    log.Println("✅ Workflow created and synthesized successfully!")
}
```

### Key Workflow Features

#### 1. Context for Configuration Only

```go
// Context stores shared configuration (NOT workflow data flow)
apiBase := ctx.SetString("apiBase", "https://api.example.com")
orgName := ctx.SetString("org", "my-org")

// Use config in workflow metadata or task inputs
wf.WithOrg(orgName)
endpoint := apiBase.Concat("/users/123")
```

**Like Pulumi's `pulumi.Config`** - for stack-level settings known before resources are created.

#### 2. Direct Task Output References

```go
// Task produces outputs
fetchTask := wf.HttpGet("fetch", endpoint)

// Other tasks use direct references (clear origin!)
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"),  // From fetchTask - obvious!
    "body", fetchTask.Field("body"),    // From fetchTask - obvious!
)
```

**Like Pulumi's `bucket.ID()`** - typed output references that make data flow explicit.

#### 3. Implicit Dependencies

```go
// Dependencies are automatic through field references
// No manual wiring needed!
// processTask automatically depends on fetchTask because it uses fetchTask.Field()
```

**Like Pulumi/Terraform** - 90% of dependencies inferred from references.

#### 4. Clean HTTP Builders

```go
// Simple, intuitive one-liners
wf.HttpGet(name, uri, options...)
wf.HttpPost(name, uri, options...)
wf.HttpPut(name, uri, options...)
wf.HttpDelete(name, uri, options...)
```

#### 5. Compile-Time Safety

```go
fetchTask := wf.HttpGet("fetch", endpoint)

// ✅ Task reference checked at compile time
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"),  // fetchTask is a Task type
)

// ❌ Compile error - not a task
wrongVar := "some-string"
processTask := wf.SetVars("process",
    "title", wrongVar.Field("title"),  // Type error!
)
```

### Workflow Migration

**Migrating from old API?** See [docs/guides/typed-context-migration.md](docs/guides/typed-context-migration.md) for a complete migration guide.

**Key changes:**
- Package: `stigmeragent` → `stigmer`
- Field refs: `workflow.FieldRef("field")` → `task.Field("field")`
- Dependencies: Manual `ThenRef()` → Implicit via references
- HTTP tasks: `WithHTTPGet() + WithURI()` → `wf.HttpGet(name, uri)`

---

## Examples

See the [examples/](examples/) directory for complete examples:

### Agent Examples (Core Patterns)
1. **Basic Agent** (`01_basic_agent.go`) - Simple agent with name and instructions
2. **Agent with Skills** (`02_agent_with_skills.go`) - Platform, organization, and inline skills
3. **Agent with MCP Servers** (`03_agent_with_mcp_servers.go`) - Full MCP server configuration (stdio, http, docker)
4. **Agent with Sub-Agents** (`04_agent_with_subagents.go`) - Inline and referenced sub-agents
5. **Agent with Environment Variables** (`05_agent_with_environment_variables.go`) - Secrets, configs, and validation
6. **Agent with Instructions from Files** (`06_agent_with_instructions_from_files.go`) - **⭐ Recommended pattern** - Load all content from files

### Workflow Examples (Basic)
7. **Basic Workflow** (`07_workflow_with_runtime_secrets.go`) - **⭐ START HERE** - Complete workflow with Pulumi-aligned patterns
8. **Agent with Typed Context** (`12_agent_with_typed_context.go`) - Typed context variables for configuration
9. **Workflow and Agent Shared Context** (`13_workflow_and_agent_shared_context.go`) - Sharing configuration between workflows and agents

### Workflow Examples (Advanced Features)
10. **Workflow with Conditionals** (`08_workflow_with_conditionals.go`) - Switch tasks for conditional logic (✅ test passing!)
11. **Workflow with Loops** (`09_workflow_with_loops.go`) - ForEach tasks for iteration
12. **Workflow with Error Handling** (`10_workflow_with_error_handling.go`) - Try/Catch/Finally for resilience
13. **Workflow with Parallel Execution** (`11_workflow_with_parallel_execution.go`) - Fork tasks for parallel branches
14. **Workflow with Runtime Secrets** (`14_workflow_with_runtime_secrets.go`) - Runtime secret and environment variable references
15. **Workflow Calling Simple Agent** (`15_workflow_calling_simple_agent.go`) - Basic agent call from workflow
16. **Workflow Calling Agent by Slug** (`16_workflow_calling_agent_by_slug.go`) - Reference agents by slug
17. **Workflow Agent with Runtime Secrets** (`17_workflow_agent_with_runtime_secrets.go`) - Agent calls with runtime configuration
18. **Workflow Multi-Agent Orchestration** (`18_workflow_multi_agent_orchestration.go`) - Complex CI/CD pipeline with 5 specialized agents
19. **Workflow Agent Execution Config** (`19_workflow_agent_execution_config.go`) - Agent execution parameters (model, temperature, timeout)

**Total**: 19 comprehensive examples covering all SDK features

**🌟 Recommended Starting Points**:
- **For agents**: Example 06 (file-based content - production pattern)
- **For workflows**: Example 07 (basic workflow - Pulumi-aligned)
- **For advanced workflows**: Example 08 (conditionals - proven working!)
- **For agent orchestration**: Example 18 (real-world CI/CD pipeline)

## Development

### Prerequisites

- Go 1.21 or higher
- golangci-lint (for linting)

### Build

```bash
make build
```

### Test

```bash
make test              # Run all tests
make test-coverage     # Generate coverage report
```

### Lint

```bash
make lint              # Run golangci-lint
```

### Verify

```bash
make verify            # Run fmt, vet, lint, and test
```

## API Documentation

Full API documentation is available on [pkg.go.dev](https://pkg.go.dev/github.com/leftbin/stigmer-sdk/go).

## Migration from Python SDK

If you're migrating from the Python SDK, see [docs/guides/migration-guide.md](docs/guides/migration-guide.md) for a side-by-side comparison and translation guide.

## Project Structure

```
sdk/go/
├── agent/           # Core agent builder
├── skill/           # Skill configuration
├── mcpserver/       # MCP server definitions
├── subagent/        # Sub-agent configuration
├── environment/     # Environment variables
├── examples/        # Usage examples
├── testdata/        # Test fixtures and golden files
└── Makefile         # Build targets
```

## Contributing

We welcome contributions! Please ensure:

1. All tests pass (`make test`)
2. Code is formatted (`make fmt`)
3. Linter passes (`make lint`)
4. Coverage remains high (90%+ target)

## License

Apache 2.0 - see [LICENSE](../LICENSE) for details.

## Support

For questions and support:
- GitHub Issues: [leftbin/stigmer-sdk](https://github.com/leftbin/stigmer-sdk/issues)
- Discussions: [GitHub Discussions](https://github.com/leftbin/stigmer-sdk/discussions)
- Documentation: [docs.stigmer.ai](https://docs.stigmer.ai)

## Version

**Current Version**: `v0.1.0` (Initial Public Release)

**Status**: ✅ Production Ready

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## Related Documentation

- **Multi-language SDK Overview**: [Main README](../README.md)
- **Complete Go SDK Documentation**: [docs/README.md](docs/README.md) - Full documentation index

### Architecture
- **Pulumi-Aligned Patterns**: [docs/architecture/pulumi-aligned-patterns.md](docs/architecture/pulumi-aligned-patterns.md) - Design principles and patterns
- **Synthesis Architecture**: [docs/architecture/synthesis-architecture.md](docs/architecture/synthesis-architecture.md) - Auto-synthesis model with defer pattern
- **Multi-Agent Support**: [docs/architecture/multi-agent-support.md](docs/architecture/multi-agent-support.md) - Multiple agents in one file

### Guides
- **Typed Context Migration Guide**: [docs/guides/typed-context-migration.md](docs/guides/typed-context-migration.md) - ⭐ **Migrating to new Pulumi-aligned API**
- **Migration Guide**: [docs/guides/migration-guide.md](docs/guides/migration-guide.md) - Migrating from proto-coupled design
- **Buf Dependency Guide**: [docs/guides/buf-dependency-guide.md](docs/guides/buf-dependency-guide.md) - Using Buf Schema Registry

### References
- **Proto Mapping**: [docs/references/proto-mapping.md](docs/references/proto-mapping.md) - CLI conversion reference

### Contributing
- **Contributing**: [../CONTRIBUTING.md](../CONTRIBUTING.md)
