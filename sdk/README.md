# Stigmer SDK

Multi-language SDKs for defining AI agent blueprints for the Stigmer platform.

## Overview

Stigmer SDK provides idiomatic libraries for multiple programming languages to define agent configurations. Each SDK converts agent definitions into a standardized manifest format that the Stigmer CLI reads and deploys.

## Architecture: The Synthesis Model

The Stigmer SDK follows a **"Synthesis Model"** architecture:

1. **SDK = Config Generator**: Your code collects agent configuration (skills, MCP servers, sub-agents, environment)
2. **Automatic Serialization**: On program exit, SDK auto-writes `manifest.pb`
3. **CLI Reads & Deploys**: Stigmer CLI reads the manifest and deploys to the platform

```
┌─────────────────┐
│   Your Code     │  Define agent blueprint
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   SDK Library   │  Collect configuration
└────────┬────────┘
         │ (auto-synth on exit)
         ↓
┌─────────────────┐
│  manifest.pb    │  SDK-CLI contract
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Stigmer CLI    │  Deploy to platform
└─────────────────┘
```

**Key Benefits**:
- No manual serialization calls
- Type-safe, language-idiomatic APIs
- Single source of truth (your code)
- CLI handles all platform communication

## Available SDKs

### Go SDK

**Status**: ✅ **Ready for Production**  
**Location**: [`go/`](./go/)  
**Installation**:

```bash
go get github.com/stigmer/stigmer/sdk/go
```

**Quick Example**:

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skill"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    ctx := context.Background()
    
    myAgent, _ := agent.New(ctx,
        agent.WithName("code-reviewer"),
        agent.WithInstructionsFromFile("instructions.md"),
    )
    
    myAgent.AddSkill(skill.Platform("coding-standards"))
    
    stigmer.Run()
}
```

[**Go SDK Documentation →**](./go/README.md)

### Python SDK

**Status**: 🚧 **Coming Soon**  
**Location**: [`python/`](./python/)

Available in the SDK directory. See [python/README.md](./python/README.md) for details.

### TypeScript SDK

**Status**: 📋 **Planned**  
**Location**: [`typescript/`](./typescript/)

TypeScript SDK is planned for future development. Watch this repository for updates.

## SDK-CLI Contract: Manifest Proto

All SDKs communicate with the Stigmer CLI via a standardized **manifest proto** format:

**Buf Schema Registry**: [`buf.build/leftbin/stigmer`](https://buf.build/leftbin/stigmer)

The manifest proto defines:
- Agent blueprint (instructions, metadata)
- Skills (platform, org, or inline)
- MCP servers (stdio, Docker, HTTP)
- Sub-agents (inline or referenced)
- Environment variables

This contract allows:
- Multiple SDK languages with consistent behavior
- CLI independence from SDK implementation details
- Version compatibility guarantees via proto breaking change detection

## Getting Started

1. **Choose your language**: Go (available now), Python (coming soon), TypeScript (planned)
2. **Install the SDK**: Follow language-specific installation instructions
3. **Define your agent**: Use the SDK's idiomatic API
4. **Deploy with CLI**: Run `stigmer up` to deploy your agent

## Documentation

- **Complete Documentation Index**: [docs/README.md](./docs/README.md) - All SDK documentation
- **Go SDK**: [go/README.md](./go/README.md) - Go SDK quick start
  - [Go SDK Documentation](./go/docs/README.md) - Complete Go SDK docs
  - [Buf Dependency Guide](./go/docs/guides/buf-dependency-guide.md) - Using Buf Schema Registry
  - [Migration Guide](./go/docs/guides/migration-guide.md) - Proto-agnostic migration
  - [Proto Mapping Reference](./go/docs/references/proto-mapping.md) - CLI conversion reference
- **Python SDK**: [python/README.md](./python/README.md) - Python SDK overview
  - [Python SDK Documentation](./python/docs/README.md) - Complete Python SDK docs
- **Contributing**: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Features Across All SDKs

### Agent Configuration
- Load instructions from files or inline
- Icon and description metadata
- Organization scoping

### Skills
- **Platform skills**: Reference Stigmer's built-in skills
- **Org skills**: Reference your organization's skills
- **Inline skills**: Define skills directly in your repository

### MCP Servers
- **Stdio servers**: Node.js scripts, Python packages, binaries
- **Docker servers**: Containerized MCP servers
- **HTTP servers**: Remote MCP endpoints
- Environment placeholder support for secrets

### Sub-Agents
- **Inline sub-agents**: Define sub-agents with their own configuration
- **Referenced sub-agents**: Reference deployed agent instances
- Tool selection and skill inheritance

### Environment Variables
- Secret and non-secret variables
- Default values
- Runtime overrides via CLI

## Repository Structure

The Stigmer SDK is part of the main [stigmer/stigmer](https://github.com/stigmer/stigmer) repository:

```
stigmer/
├── sdk/                   # SDK root (this directory)
│   ├── README.md          # This file
│   ├── CONTRIBUTING.md    # Contribution guidelines
│   │
│   ├── go/                # Go SDK
│   │   ├── README.md      # Go SDK quick start
│   │   ├── go.mod         # Go module definition
│   │   ├── agent/         # Agent builder API
│   │   ├── workflow/      # Workflow builder API
│   │   ├── skill/         # Skills API
│   │   ├── mcpserver/     # MCP servers API
│   │   ├── subagent/      # Sub-agents API
│   │   ├── environment/   # Environment variables API
│   │   ├── templates/     # Code templates
│   │   └── examples/      # Example programs
│   │
│   └── python/            # Python SDK
│       ├── README.md      # Python SDK quick start
│       ├── pyproject.toml # Python package definition
│       ├── stigmer/       # Python package
│       ├── examples/      # Example programs
│       └── tests/         # Test suite
│
├── docs/sdk/              # SDK documentation
├── _changelog/sdk/        # SDK changelogs
└── .cursor/rules/sdk/     # SDK development rules
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development setup
- Testing guidelines
- Pull request process
- Code style conventions

## License

Apache 2.0 License - see [LICENSE](./LICENSE) for details.

## Links

- **Stigmer Platform**: [stigmer.ai](https://stigmer.ai)
- **Documentation**: [docs.stigmer.ai](https://docs.stigmer.ai)
- **Buf Schema Registry**: [buf.build/leftbin/stigmer](https://buf.build/leftbin/stigmer)
- **Main Repository**: [github.com/stigmer/stigmer](https://github.com/stigmer/stigmer)

## Support

- **Issues**: [GitHub Issues](https://github.com/stigmer/stigmer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/stigmer/stigmer/discussions)
- **Discord**: [Join our Discord](https://discord.gg/stigmer) (link TBD)

---

**Note**: This SDK is currently in active development. APIs may change before the 1.0 release. See [CHANGELOG.md](./CHANGELOG.md) for version history.
