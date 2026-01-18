# Agent SDK Examples

This directory contains practical examples demonstrating how to use the Stigmer Agent SDK to define agent blueprints.

## Philosophy: Proto-First, Blueprint-Focused

The Stigmer SDK follows a **proto-first approach** where users define **Agent blueprints** (like Pulumi modules), and deployments are managed via **YAML configurations** (like Pulumi stack configs).

**What the SDK provides:**
- **Agent**: Blueprint definition (instructions, skills, MCP servers, environment variables)

**What the CLI handles:**
- **Agent Instances**: Deployed agent configurations (managed via YAML files)
- **Sessions**: Runtime invocations (CLI commands)

This separation follows the Pulumi pattern:
- **SDK** = Define infrastructure as code (Agent blueprints)
- **YAML** = Configure deployments (agent instances with secrets/env vars)
- **CLI** = Execute deployments and invocations

## Examples Overview

1. **[01_basic_agent.py](01_basic_agent.py)** - Simple agent definition
   - Minimal configuration
   - Basic instructions
   - Agent blueprint structure

2. **[02_agent_with_skills.py](02_agent_with_skills.py)** - Using skill references
   - Platform skills
   - Organization-specific skills
   - Multiple skill composition

3. **[03_agent_with_mcp_servers.py](03_agent_with_mcp_servers.py)** - External tool integration
   - Stdio MCP servers
   - Environment variable placeholders
   - Multiple MCP configurations

## Running Examples

Each example is a standalone Python script that can be executed directly:

```bash
# Run an example to see the proto output
python examples/agents/01_basic_agent.py

# Or using the SDK directory
cd sdk/python
poetry run python examples/agents/01_basic_agent.py
```

## Deployment Workflow

The deployment flow separates **blueprints** (code) from **configuration** (YAML):

### Step 1: Define Agent Blueprint (Python/SDK)

```python
# my_agent.py
from stigmer.agent import Agent, Skill, McpServer

agent = Agent(
    name="code-reviewer",
    instructions="Review code and suggest improvements",
    skills=[Skill.ref("coding-best-practices")],
    mcp_servers=[
        McpServer.stdio(
            name="github",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-github"],
            env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
        )
    ]
)

# Convert to proto for CLI
proto = agent.to_proto()
```

### Step 2: Create Instance Configuration (YAML)

```yaml
# agent-instances/code-reviewer-prod.yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: code-reviewer-prod
spec:
  agentRef: code-reviewer
  configuration:
    REPO_NAME: stigmer/platform
    DEFAULT_BRANCH: main
  secrets:
    GITHUB_TOKEN: ${GITHUB_TOKEN}  # from environment or secrets manager
```

### Step 3: Deploy and Invoke (CLI)

```bash
# Deploy agent blueprint
stigmer agent create my_agent.py

# Deploy agent instance from YAML
stigmer agent-instance create agent-instances/code-reviewer-prod.yaml

# Invoke agent (creates session)
stigmer agent invoke code-reviewer-prod --message "Review PR #123"
```

## Architecture

The Agent SDK follows a **proto-first, blueprint-focused** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ USER SPACE (SDK)                                            │
│                                                             │
│  Python Code                                                │
│  └── Agent Blueprint Definition                             │
│      └── .to_proto() → Proto Message                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CLI SPACE                                                   │
│                                                             │
│  YAML Configuration Files                                   │
│  ├── agent-instances/*.yaml  (env vars, secrets)           │
│  └── agent invoke commands   (runtime invocations)         │
│                                                             │
│  CLI Operations:                                            │
│  ├── Read proto from SDK                                    │
│  ├── Read YAML configs                                      │
│  └── Make gRPC calls → Backend                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**

- **SDK**: Define Agent blueprints (immutable logic)
- **YAML**: Configure instances (env vars, secrets, configs)
- **CLI**: Deploy blueprints + configs, invoke agents
- Users never interact with proto or gRPC directly

## Common Patterns

### Pattern 1: Agent Blueprint with Multiple Instances

**Agent Blueprint (Python/SDK):**
```python
# agents/my_agent.py
agent = Agent(
    name="my-agent",
    instructions="Do something useful",
    mcp_servers=[...],
)
```

**Instance Configs (YAML):**
```yaml
# instances/my-agent-prod.yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: my-agent-prod
spec:
  agentRef: my-agent
  secrets:
    API_KEY: ${PROD_API_KEY}
---
# instances/my-agent-dev.yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: my-agent-dev
spec:
  agentRef: my-agent
  secrets:
    API_KEY: ${DEV_API_KEY}
```

### Pattern 2: MCP Server with Environment Variables

**Agent Blueprint (Python/SDK):**
```python
agent = Agent(
    name="github-agent",
    instructions="GitHub operations",
    mcp_servers=[
        McpServer.stdio(
            name="github",
            command="npx",
            args=["-y", "@mcp/server-github"],
            env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"},
        )
    ],
    environment_variables=[
        EnvironmentVariable(
            name="GITHUB_TOKEN",
            is_secret=True,
            description="GitHub API token"
        )
    ]
)
```

**Instance Config (YAML):**
```yaml
# instances/github-agent-prod.yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-agent-prod
spec:
  agentRef: github-agent
  secrets:
    GITHUB_TOKEN: ghp_xxxxxxxxxxxxx
```

### Pattern 3: Skills and Sub-Agents

**Agent with Skills (Python/SDK):**
```python
agent = Agent(
    name="code-agent",
    instructions="Code review and analysis",
    skills=[
        Skill.ref("coding"),           # Platform skill
        Skill.ref("custom", org="my-org"),  # Org skill
    ],
)
```

**Orchestrator with Sub-Agents (Python/SDK):**
```python
orchestrator = Agent(
    name="orchestrator",
    instructions="Coordinate multiple agents",
    sub_agents=[
        SubAgent.ref("code-agent"),
        SubAgent.ref("test-agent"),
    ],
)
```

## Why This Architecture?

### Blueprint vs Configuration Separation

**Agent blueprints** (Python/SDK) contain:
- Instructions and behavior logic
- Skill requirements
- MCP server declarations
- Environment variable schema

**Agent instance configs** (YAML) contain:
- Actual environment variable values
- Secrets (API keys, tokens)
- Environment-specific overrides
- Deployment metadata

This separation provides:
1. **Version control**: Blueprints in code, secrets in secure storage
2. **Reusability**: One blueprint → many instances (prod, staging, dev)
3. **Security**: Secrets never in SDK code
4. **Simplicity**: SDK focuses on logic, CLI handles deployment

### Like Pulumi Modules

Think of it like Pulumi:
- **Pulumi Module** (Python/TS) = **Agent Blueprint** (Python/SDK)
- **Pulumi Stack Config** (YAML) = **Agent Instance Config** (YAML)
- **Pulumi CLI** = **Stigmer CLI**

Users define infrastructure logic in code, configure deployments in YAML, and use CLI to deploy.

## Resources

- **SDK Reference**: See `/sdk/python/stigmer/agent/` for implementation
- **Proto Contracts**: See `/apis/ai/stigmer/agentic/agent/v1/` for proto definitions
- **Integration Tests**: See `/sdk/python/tests/agent/integration/` for test examples

## Need Help?

- Run the examples to see proto output
- Check the integration tests for comprehensive usage patterns
- Review the proto contracts to understand the data model
- See the SDK implementation for available options and validation rules

---

**Note**: These examples demonstrate SDK usage for defining Agent blueprints. Deployment and execution are handled by the Stigmer CLI.
