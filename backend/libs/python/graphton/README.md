# Graphton

[![CI](https://github.com/plantoncloud/graphton/actions/workflows/ci.yml/badge.svg)](https://github.com/plantoncloud/graphton/actions/workflows/ci.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Declarative agent creation framework for LangGraph**

Graphton eliminates boilerplate when creating LangGraph agents with MCP tools. Create production-ready agents in **3-10 lines instead of 100+**.

## Features

- **Declarative Agent Creation**: Minimal boilerplate - just specify model and behavior
- **Automatic Prompt Enhancement**: Agents automatically understand available capabilities (planning, file system, MCP tools)
- **Universal MCP Authentication**: Support for any MCP server configuration with both static and dynamic authentication modes
- **Intelligent Loop Detection**: Automatically detects and prevents infinite loops in autonomous agents
- **Production Ready**: Works in both local and remote LangGraph deployments
- **Type-Safe Configuration**: Pydantic validation with helpful error messages
- **IDE Support**: Full autocomplete and type hints for better developer experience

## Quick Start

### Installation

```bash
pip install graphton
```

### Simple Agent

Create a basic agent in just 3 lines:

```python
from graphton import create_deep_agent

SYSTEM_PROMPT = """You are a helpful assistant that answers questions concisely.
When answering questions:
- Be direct and to the point
- Provide accurate information
- If you're not sure, say so
"""

# Create agent with just model and prompt
agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt=SYSTEM_PROMPT,
)

# Invoke the agent
result = agent.invoke({
    "messages": [{"role": "user", "content": "What is the capital of France?"}]
})
```

### Agent with MCP Tools

Integrate MCP tools with dynamic per-user authentication:

```python
from graphton import create_deep_agent
import os

# Agent with dynamic MCP authentication
agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt="You are a Planton Cloud assistant helping users manage cloud resources.",
    
    # MCP integration with template variables
    mcp_servers={
        "planton-cloud": {
            "transport": "streamable_http",
            "url": "https://mcp.planton.ai/",
            "headers": {
                "Authorization": "Bearer {{USER_TOKEN}}"  # Substituted at runtime
            }
        }
    },
    mcp_tools={
        "planton-cloud": [
            "list_organizations",
            "search_cloud_resources",
            "create_cloud_resource",
        ]
    },
    
    # Optional parameters
    recursion_limit=150,
    temperature=0.3,
)

# Invoke with user-specific token
result = agent.invoke(
    {"messages": [{"role": "user", "content": "List my organizations"}]},
    config={
        "configurable": {
            "USER_TOKEN": os.getenv("PLANTON_API_KEY")
        }
    }
)
```

### Static MCP Configuration

For shared credentials, use static configuration (tools loaded once at creation time):

```python
agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt="You are an API assistant.",
    
    mcp_servers={
        "public-api": {
            "transport": "http",
            "url": "https://api.example.com/mcp",
            "headers": {
                "X-API-Key": "hardcoded-key-123"  # No templates = static
            }
        }
    },
    mcp_tools={
        "public-api": ["search", "fetch"]
    }
)

# Invoke without auth config - credentials already in config
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Search for Python"}]}
)
```

### Agent with Sub-agents

Delegate complex tasks to specialized sub-agents with isolated context:

```python
from graphton import create_deep_agent

agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt="You are a research coordinator that delegates specialized tasks.",
    
    # Define specialized sub-agents
    subagents=[
        {
            "name": "deep-researcher",
            "description": "Conducts thorough research on complex topics with comprehensive analysis",
            "system_prompt": "You are a research specialist. Conduct thorough research, cite sources, and provide comprehensive analysis.",
        },
        {
            "name": "code-reviewer",
            "description": "Reviews code for quality, security, and best practices",
            "system_prompt": "You are a code review expert. Analyze code for bugs, security issues, and improvement opportunities.",
        }
    ],
    
    # Include general-purpose sub-agent for other tasks
    general_purpose_agent=True,
)

# The agent can now delegate tasks to sub-agents
result = agent.invoke({
    "messages": [{"role": "user", "content": "Research quantum computing and review the attached code"}]
})
```

**When to use sub-agents:**
- Complex multi-step tasks that can be delegated
- Independent parallel tasks  
- Tasks requiring focused reasoning without context bloat
- Specialized domains (research, code review, data analysis)

**Benefits:**
- **Context isolation**: Each sub-agent has its own context window
- **Token efficiency**: Main agent gets concise summaries, not full task history
- **Parallel execution**: Launch multiple sub-agents simultaneously
- **Specialization**: Different sub-agents with domain-specific tools

## Automatic Prompt Enhancement

Graphton automatically enhances your instructions with awareness of Deep Agents capabilities. This ensures agents understand what tools they have and when to use them.

### What Gets Enhanced

When you provide simple instructions like:

```python
agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt="You are a helpful research assistant.",
)
```

Graphton automatically adds context about:
- **Planning System**: For breaking down complex multi-step tasks
- **File System**: For storing and managing information across operations
- **MCP Tools**: When configured, awareness of domain-specific capabilities

### Why This Matters

Deep Agents come with powerful built-in tools (planning, file system, subagents), but agents won't use them effectively unless they know they exist. Graphton bridges this gap by automatically informing agents about available capabilities.

### Control and Flexibility

- **Automatic by default**: Enhancement happens automatically for all agents
- **Redundancy is fine**: If your instructions already mention planning or file system, some overlap will occur. This is intentional - LLMs handle redundancy gracefully, and reinforcement is better than missing critical context
- **Can be disabled**: Use `auto_enhance_prompt=False` to pass instructions as-is

```python
# Disable enhancement if you've already included all context
agent = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt="Detailed instructions with all tool context...",
    auto_enhance_prompt=False,  # Use prompt as-is
)
```

## Documentation

- **[Configuration Guide](docs/CONFIGURATION.md)** - Complete reference for all configuration options
- **[API Documentation](docs/API.md)** - Full API reference
- **[Examples](examples/)** - More usage examples including:
  - `simple_agent.py` - Basic agent without MCP
  - `mcp_agent.py` - Dynamic MCP authentication
  - `static_mcp_agent.py` - Static MCP configuration
  - `multi_auth_agent.py` - Multiple servers with mixed authentication

## Universal MCP Authentication

Graphton supports any MCP server configuration format and authentication method through template-based token injection:

**Dynamic Mode** (with `{{VAR}}` templates):
- Templates substituted from `config['configurable']` at invocation time
- Tools loaded per-request with user-specific authentication
- Use for multi-tenant systems or per-user tokens

**Static Mode** (no template variables):
- Tools loaded once at agent creation time
- Zero runtime overhead
- Use for hardcoded credentials or public servers

Supported authentication methods:
- Bearer tokens (OAuth, JWT)
- API Keys
- Basic Auth
- Custom headers
- Any authentication format supported by your MCP server

## Requirements

- Python 3.11 or higher
- Poetry (for development)

## License

Apache-2.0 - See [LICENSE](LICENSE) for details

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Links

- **Repository**: https://github.com/plantoncloud/graphton
- **Documentation**: https://github.com/plantoncloud/graphton#readme
- **Issues**: https://github.com/plantoncloud/graphton/issues
