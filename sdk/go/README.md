# Stigmer SDK - Go

A Go SDK for defining AI agents and workflows for the Stigmer platform.

**Repository**: [github.com/leftbin/stigmer-sdk](https://github.com/leftbin/stigmer-sdk)  
**Go Package**: `github.com/leftbin/stigmer-sdk/go`

## Features

### Core Features
- **Agents & Workflows**: Define both AI agents and workflow orchestrations
- **Struct-based Args**: Pulumi-style configuration with excellent IDE support (v0.2.0+)
- **Proto-agnostic SDK**: Pure Go library with no proto dependencies
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
})
agent.AddSkill(skill)
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"
    
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/commons/ref"
    "github.com/leftbin/stigmer-sdk/go/mcpserver"
    "github.com/leftbin/stigmer-sdk/go/stigmer"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create MCP server with struct-based args
        githubMCP, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
            Command: "npx",
            Args:    []string{"-y", "@modelcontextprotocol/server-github"},
            EnvPlaceholders: map[string]string{
                "GITHUB_TOKEN": "${GITHUB_TOKEN}",
            },
        })
        if err != nil {
            return err
        }

        // Create agent with struct-based args
        myAgent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: "Review code for security, performance, and best practices.",
            Description:  "AI code reviewer with security expertise",
            IconUrl:      "https://example.com/icon.png",
        })
        if err != nil {
            return err
        }
        
        // Add skill references and MCP servers using builder methods
        // Use commons/ref package for creating resource references
        myAgent.
            AddSkillRef(ref.Skill("stigmer", "security-analysis")).
            AddMcpServerUsage(ref.McpServer("stigmer", "github"))
        
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
- Name and instructions (required) - load from files using `os.ReadFile()`
- Description and icon (optional)
- Skills (knowledge references) - use `commons/ref` package
- MCP servers (tool providers)
- Sub-agents (delegatable agents) - use `agent.NewSubAgent()`
- Environment variables (configuration)

**Key Features:**
- **File-based instructions**: Load from markdown files using `os.ReadFile()`
- **Builder pattern**: Add components after creation with `AddSkillRef()`, `AddMcpServerUsage()`, etc.
- **Proto-agnostic**: No proto types or conversion - just pure Go

### Skills

Skills provide knowledge to agents. The SDK references existing skills - it doesn't create them inline. Skills are managed separately (via CLI or UI) and referenced here.

#### 1. Platform Skills (Shared)
Reference skills available platform-wide using the `org/slug` format:

```go
// Use "stigmer/" prefix for platform skills
import "github.com/leftbin/stigmer-sdk/go/commons/ref"

myAgent.AddSkillRef(ref.Skill("stigmer", "coding-best-practices"))
```

#### 2. Organization Skills (Private)
Reference skills private to your organization:

```go
// Use "org/slug" format for organization skills
import "github.com/leftbin/stigmer-sdk/go/commons/ref"

myAgent.AddSkillRef(ref.Skill("my-org", "internal-standards"))
```

#### 3. Multiple Skills at Once
Add multiple skill references in one call:

```go
import "github.com/leftbin/stigmer-sdk/go/commons/ref"

myAgent.
    AddSkillRef(ref.Skill("stigmer", "coding-best-practices")).
    AddSkillRef(ref.Skill("stigmer", "security-analysis")).
    AddSkillRef(ref.Skill("my-org", "internal-standards"))
```

#### 4. Versioned Skills
Reference specific versions of skills:

```go
import "github.com/leftbin/stigmer-sdk/go/commons/ref"

// With version suffix
myAgent.AddSkillRef(ref.Skill("stigmer", "coding-best-practices", ref.WithVersion("v2.0")))

// Or using separate version parameter
myAgent.AddSkillRef(ref.Skill("stigmer", "coding-best-practices", ref.WithVersion("v2.0")))
```

**Benefits:**
- ✅ Skills are centrally managed
- ✅ Easy to share across agents
- ✅ Clean separation of concerns
- ✅ Simple `org/slug` format for all references

### MCP Servers

MCP (Model Context Protocol) servers provide tools to agents. Three types:

#### 1. Stdio Servers
Subprocess-based servers (most common):

```go
githubServer, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
    Command: "npx",
    Args:    []string{"-y", "@modelcontextprotocol/server-github"},
    EnvPlaceholders: map[string]string{
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
    },
})
// Reference the MCP server in an agent
agent.AddMcpServerUsage(ref.McpServer("stigmer", "github"))
```

#### 2. HTTP Servers
Remote HTTP + SSE servers:

```go
httpServer, err := mcpserver.HTTP(ctx, "remote-mcp", &mcpserver.HTTPArgs{
    Url: "https://mcp.example.com/github",
    Headers: map[string]string{
        "Authorization": "Bearer ${API_TOKEN}",
    },
    TimeoutSeconds: 30,
})
// Reference the MCP server in an agent
agent.AddMcpServerUsage(ref.McpServer("stigmer", "remote-mcp"))
```

#### 3. Docker Servers
Containerized MCP servers:

```go
dockerServer, err := mcpserver.Docker(ctx, "custom-mcp", &mcpserver.DockerArgs{
    Image: "ghcr.io/org/custom-mcp:latest",
    Volumes: []*types.VolumeMount{
        {HostPath: "/host/path", ContainerPath: "/container/path", ReadOnly: false},
    },
    Ports: []*types.PortMapping{
        {HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
    },
})
// Reference the MCP server in an agent
agent.AddMcpServerUsage(ref.McpServer("my-org", "custom-mcp"))
```

### Sub-Agents

Sub-agents allow delegation to specialized agents. Sub-agents are inline value objects within the parent agent.

#### Creating Inline Sub-Agents

```go
import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/commons/ref"
)

// Create a sub-agent (inline value object, not a separate resource)
analyzer := agent.NewSubAgent("code-analyzer", &agent.SubAgentArgs{
    Instructions: "Analyze code quality and provide detailed feedback",
    Description:  "Specialized code analyzer",
})

// Add skill and MCP server references to sub-agent
analyzer.
    AddSkillRef(ref.Skill("stigmer", "static-analysis")).
    AddMcpServerUsage(ref.McpServer("stigmer", "github"))

// Add sub-agent to parent agent
parentAgent.AddSubAgent(analyzer)
```

**Note**: Sub-agents are part of the agent package and use the same builder methods for adding skills and MCP servers.

### Environment Variables

Agents and workflows can declare required environment variables using builder methods.

#### Secret Variables
Required secrets are encrypted at rest:

```go
// On agents - use RequireSecret builder method
myAgent.RequireSecret("API_KEY", "API key for external service")

// On workflows - use RequireSecret builder method
wf.RequireSecret("DATABASE_URL", "Database connection string")
```

#### Configuration with Defaults
Optional configuration values with sensible defaults:

```go
// On agents - use RequireConfig builder method
myAgent.RequireConfig("AWS_REGION", "us-east-1", "AWS deployment region")

// On workflows - use RequireConfig builder method
wf.RequireConfig("LOG_LEVEL", "info", "Application log level")
```

#### Environment Resource (First-Class API Resource)

For defining actual environment values (not just requirements), use the Environment resource:

```go
import "github.com/leftbin/stigmer-sdk/go/environment"

env, err := environment.New(ctx, "production-aws", &environment.EnvironmentArgs{
    Description: "Production AWS credentials",
})
env.
    SetConfig("AWS_REGION", "us-west-2").
    SetSecret("AWS_ACCESS_KEY_ID", "${secrets.aws_key}").
    SetSecret("AWS_SECRET_ACCESS_KEY", "${secrets.aws_secret}")
```

#### Key Features
- **Secrets**: Encrypted at rest, redacted in logs (use `RequireSecret()` or `SetSecret()`)
- **Configuration**: Plaintext values for non-sensitive data (use `RequireConfig()` or `SetConfig()`)
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
agent, err := agent.New(ctx, "Invalid Name!", &agent.AgentArgs{
    Instructions: "Test instructions",
})
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
        apiBase := ctx.SetString("apiBase", "https://api.github.com")
        _ = ctx.SetString("org", "my-org")
        
        // Create workflow with struct-based args
        wf, err := workflow.New(ctx, "data-processing/basic-data-fetch", &workflow.WorkflowArgs{
            Description: "Fetch pull request data from GitHub API",
        })
        if err != nil {
            return err
        }
        
        // Build endpoint URL using context config - real GitHub API!
        endpoint := apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1")
        
        // Task 1: Fetch pull request from GitHub API (clean, one-liner!)
        fetchTask := wf.HttpGet("fetchPullRequest", endpoint,
            workflow.Header("Accept", "application/vnd.github.v3+json"),
            workflow.Header("User-Agent", "Stigmer-SDK-Example"),
            workflow.Timeout(30),
        )
        
        // Task 2: Process response using DIRECT task references
        // Dependencies are implicit - no manual wiring needed!
        processTask := wf.SetVars("processResponse",
            "prTitle", fetchTask.Field("title"),      // ✅ Clear: from fetchTask!
            "prBody", fetchTask.Field("body"),        // ✅ Clear: from fetchTask!
            "prAuthor", fetchTask.Field("user.login"), // ✅ GitHub username
            "status", "success",
        )
        
        // No manual dependency management needed!
        // processTask automatically depends on fetchTask
        
        log.Printf("Created workflow with %d tasks", len(wf.Args.Tasks))
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
7. **Basic Workflow** (`07_basic_workflow.go`) - **⭐ START HERE** - Complete workflow with Pulumi-aligned patterns and real GitHub API
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

**🚀 Real GitHub API Integration**:
- Examples 07-11 use **real GitHub API** endpoints from the public `stigmer/hello-stigmer` repository
- ✅ No authentication required - work as E2E tests
- ✅ Demonstrate realistic integration patterns
- ✅ Production-ready code with actual API responses
- See [examples/URL_MIGRATION_ANALYSIS.md](examples/URL_MIGRATION_ANALYSIS.md) for details

**🌟 Recommended Starting Points**:
- **For agents**: Example 06 (file-based content - production pattern)
- **For workflows**: Example 07 (basic workflow - Pulumi-aligned, real GitHub API)
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
├── agent/           # Agent builder (includes SubAgent)
├── skill/           # Skill definitions (content artifacts)
├── mcpserver/       # MCP server definitions
├── workflow/        # Workflow orchestration
├── environment/     # Environment resource (first-class API resource)
├── commons/         # Shared utilities
│   └── ref/         # Resource reference factories
├── stigmer/         # Context and synthesis
├── gen/             # Generated Args from proto (DO NOT EDIT)
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
