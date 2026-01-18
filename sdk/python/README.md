# Stigmer Python SDK

Python SDK for Stigmer - Define agents, workflows, and automation as code.

## What is Stigmer SDK?

Stigmer SDK provides two main capabilities:

1. **Agent SDK** - Define AI agent blueprints (proto-first approach)
2. **Workflow SDK** - Write workflows that synthesize to CNCF Serverless Workflow DSL

## Installation

```bash
pip install stigmer-sdk
```

---

## Agent SDK

Define AI agent **blueprints** programmatically (like Pulumi modules). Agent instances and invocations are managed via **YAML configs** and **CLI commands**.

### Philosophy: Proto-First, Blueprint-Focused

The Agent SDK follows a **proto-first approach** inspired by Pulumi:

- **SDK (Python)**: Define agent blueprints (logic, skills, MCP servers)
- **YAML**: Configure agent instances (env vars, secrets)
- **CLI**: Deploy blueprints + configs, invoke agents

This separates **immutable logic** (code) from **configuration** (YAML).

### Quick Start

**Step 1: Define Agent Blueprint (Python/SDK)**

```python
from stigmer.agent import Agent, Skill, McpServer, EnvironmentVariable

# Define agent blueprint
agent = Agent(
    name="code-reviewer",
    instructions="Review code and provide constructive feedback",
    skills=[Skill.ref("coding-best-practices")],
    mcp_servers=[
        McpServer.stdio(
            name="github",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-github"],
            env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
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

# Convert to proto for CLI
proto = agent.to_proto()
```

**Step 2: Configure Agent Instance (YAML)**

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
    GITHUB_TOKEN: ${GITHUB_TOKEN}  # from environment
```

**Step 3: Deploy and Invoke (CLI)**

```bash
# Deploy agent blueprint
$ stigmer agent create my_agent.py

# Deploy agent instance from YAML
$ stigmer agent-instance create agent-instances/code-reviewer-prod.yaml

# Invoke agent (creates session)
$ stigmer agent invoke code-reviewer-prod --message "Review PR #123"
```

### Agent SDK Features

- ✅ **Agent Blueprints** - Define reusable agent logic as code
- ✅ **Skills** - Reference platform and organization skills
- ✅ **MCP Servers** - Integrate external tools (GitHub, filesystem, APIs)
- ✅ **Sub-Agents** - Build multi-agent orchestration
- ✅ **Environment Variables** - Declare required configuration
- ✅ **Proto Conversion** - Automatic conversion to proto messages
- ✅ **Validation** - Catch errors before deployment

**Not in SDK** (handled by YAML + CLI):
- ❌ Agent Instances (YAML configs)
- ❌ Sessions (CLI invocations)
- ❌ Secrets management (YAML + secrets manager)

### Agent SDK Examples

See [examples/agents/](examples/agents/) for practical examples:

1. **[01_basic_agent.py](examples/agents/01_basic_agent.py)** - Simple agent blueprint
2. **[02_agent_with_skills.py](examples/agents/02_agent_with_skills.py)** - Using skill references
3. **[03_agent_with_mcp_servers.py](examples/agents/03_agent_with_mcp_servers.py)** - External tool integration

### Agent Architecture

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
- SDK: Define Agent blueprints (immutable logic)
- YAML: Configure instances (env vars, secrets)
- CLI: Deploy + invoke agents
- Like Pulumi: code for logic, YAML for config

---

## Workflow SDK

Write workflows as code that synthesize to CNCF Serverless Workflow DSL 1.0.0 YAML.

### Quick Start

```python
from stigmer import Workflow
from stigmer.tasks import HttpTask, SetTask

# Create workflow
wf = Workflow(
    name="hello-world",
    version="1.0.0",
    namespace="examples"
)

# Add tasks
wf.add_task("initialize", SetTask({"started": True}))

wf.add_task("greet", HttpTask(
    method="POST",
    uri="https://api.example.com/greet",
    body={"message": "Hello from Stigmer!"}
))

wf.add_task("finalize", SetTask({"completed": True}))

# Generate YAML
yaml_output = wf.synth()
print(yaml_output)
```

**Output**:
```yaml
document:
  dsl: '1.0.0'
  namespace: examples
  name: hello-world
  version: '1.0.0'

do:
  - initialize:
      set:
        started: true
  
  - greet:
      call: http
      with:
        method: POST
        endpoint:
          uri: https://api.example.com/greet
        body:
          message: "Hello from Stigmer!"
  
  - finalize:
      set:
        completed: true
```

### Workflow SDK Features

- ✅ **Type-safe** - Full type hints for IDE autocomplete
- ✅ **Pythonic** - Clean, familiar API
- ✅ **CNCF DSL 1.0.0** - Standards-compliant YAML output
- ✅ **Validated** - Catch errors before deployment
- ✅ **Fluent API** - Optional method chaining

### Workflow Task Types

- ✅ `SetTask` - Variable assignment
- ✅ `HttpTask` - HTTP calls
- ✅ `GrpcTask` - gRPC calls
- ✅ `SwitchTask` - Conditional branching
- ✅ `ForkTask` - Parallel execution
- ✅ `ForTask` - Iteration
- ✅ `TryTask` - Error handling
- ✅ `ListenTask` - Event waiting
- ✅ `RaiseTask` - Error raising
- ✅ `RunTask` - Script execution
- ✅ `WaitTask` - Delays
- ✅ `CallActivityTask` - Workflow composition

### Workflow Examples

See [examples/](examples/) for workflow examples:
- `01_basic_example.py` - Basic workflow
- `02_http_and_switch.py` - HTTP with conditional logic
- `03_iteration_example.py` - Loops and iteration
- `04_parallel_example.py` - Parallel task execution
- More examples available...

---

## Development

### Setup

```bash
# Install dependencies
poetry install

# Run tests
poetry run pytest

# Run specific test
poetry run pytest tests/agent/integration/test_agent_e2e.py

# Type checking
poetry run mypy stigmer/

# Code coverage
poetry run pytest --cov=stigmer tests/
```

### Running Examples

```bash
# Run agent examples
poetry run python examples/agents/01_basic_agent.py

# Run workflow examples
poetry run python examples/01_basic_example.py
```

## Project Status

**Current Version**: 0.1.0 (Alpha)

### Agent SDK Status

- ✅ **Agent Blueprint Implementation** (Complete)
  - Core Agent class (blueprint definition)
  - Proto converter (Agent → proto)
  - Unit tests (agent validation and conversion)
  - Integration tests (e2e proto generation)
  - Examples (3 practical blueprints)
  - Documentation (proto-first architecture)

- 🚧 **Simplified Architecture** (Proto-First Pivot)
  - Removed: AgentInstance (moved to YAML + CLI)
  - Removed: Session (moved to CLI invocations)
  - Focus: Agent blueprints only (like Pulumi modules)

### Workflow SDK Status

- 🚧 **In Development**
  - Protos not fully implemented
  - Will be added after Agent SDK stabilizes
  - 12 task types prototyped
  - CNCF DSL 1.0.0 target

## Documentation

### Agent SDK Documentation

- **[Agent Examples](examples/agents/)** - 7 practical examples
- **[Integration Tests](tests/agent/integration/)** - End-to-end test examples
- **[Project Documentation](../../_projects/2026-01/20260112.04.stigmer-sdk-agent-implementation/)** - Complete project docs

### Workflow SDK Documentation

- **[Workflow Examples](examples/)** - Multiple workflow examples
- **[Project Documentation](../../_projects/2026-01/20260110.03.stigmer-sdk-python/)** - Complete workflow docs

## Contributing

This SDK is part of the Stigmer monorepo. See the main repository for contribution guidelines.

## License

Apache 2.0
