"""Graphton: Declarative agent creation for LangGraph.

Graphton eliminates boilerplate when creating LangGraph agents with MCP tools.
Create production-ready agents in 3-10 lines instead of 100+.

Key Features:
- Declarative agent creation with minimal boilerplate
- Auto-loading MCP tools with per-user authentication
- Works in both local and remote LangGraph deployments
- Type-safe configuration with Pydantic validation
"""

from graphton.core.agent import create_deep_agent
from graphton.core.config import AgentConfig
from graphton.core.middleware import McpToolsLoader
from graphton.core.template import (
    extract_template_vars,
    has_templates,
    substitute_templates,
)

__version__ = "0.1.0"
__all__ = [
    "__version__",
    "create_deep_agent",
    "AgentConfig",
    "McpToolsLoader",
    "extract_template_vars",
    "has_templates",
    "substitute_templates",
]

