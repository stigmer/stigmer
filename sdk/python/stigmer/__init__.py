"""Stigmer Python SDK - Define AI agent blueprints.

This SDK allows developers to define Stigmer agent blueprints in Python,
following a proto-first architecture inspired by Pulumi.

Example:
    >>> from stigmer.agent import Agent, McpServer, EnvironmentVariable
    >>> 
    >>> agent = Agent(
    ...     name="code-reviewer",
    ...     instructions="Review code and provide feedback",
    ...     mcp_servers=[
    ...         McpServer.stdio(
    ...             name="github",
    ...             command="npx",
    ...             args=["-y", "@modelcontextprotocol/server-github"],
    ...             env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
    ...         )
    ...     ]
    ... )
    >>> proto = agent.to_proto()
"""

from stigmer.exceptions import StigmerError, ValidationError

__version__ = "0.1.0"
__all__ = [
    "StigmerError",
    "ValidationError",
]
