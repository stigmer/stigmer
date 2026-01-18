"""
Stigmer Agent SDK

Provides Python classes for defining Stigmer agent blueprints.
This SDK follows a proto-first architecture inspired by Pulumi:

- SDK (Python): Define agent blueprints (logic, skills, MCP servers)
- YAML: Configure agent instances (env vars, secrets)
- CLI: Deploy blueprints + configs, invoke agents

Example:
    ```python
    from stigmer.agent import Agent, Skill, McpServer, EnvironmentVariable
    
    # Define agent blueprint
    agent = Agent(
        name="code-reviewer",
        instructions="Review code and provide feedback",
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
    
    Deploy via CLI:
    ```bash
    # Deploy agent blueprint
    $ stigmer agent create my_agent.py
    
    # Deploy agent instance from YAML
    $ stigmer agent-instance create agent-instances/code-reviewer-prod.yaml
    
    # Invoke agent
    $ stigmer agent invoke code-reviewer-prod --message "Review PR #123"
    ```
"""

from stigmer.agent.agent import Agent
from stigmer.agent.config.skill import Skill
from stigmer.agent.config.mcp_server import McpServer
from stigmer.agent.config.environment import EnvironmentVariable
from stigmer.agent.config.sub_agent import SubAgent
from stigmer.agent.exceptions import (
    AgentError,
    ValidationError,
    ConversionError,
)

__all__ = [
    # Core class
    "Agent",
    # Config helpers
    "Skill",
    "McpServer",
    "EnvironmentVariable",
    "SubAgent",
    # Exceptions
    "AgentError",
    "ValidationError",
    "ConversionError",
]

__version__ = "0.1.0"
