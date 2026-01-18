"""
Agent class for defining AI agent templates.
"""

from dataclasses import dataclass, field
from typing import Optional, List

from stigmer.agent.config.skill import Skill
from stigmer.agent.config.mcp_server import McpServer
from stigmer.agent.config.environment import EnvironmentVariable
from stigmer.agent.config.sub_agent import SubAgent


@dataclass
class Agent:
    """
    Defines an AI agent template with LLM model, skills, and MCP servers.
    
    The Agent is the "template" layer - it defines the immutable logic and requirements
    for an agent. Actual configuration with secrets happens at the AgentInstance level.
    
    Example:
        ```python
        from stigmer.agent import Agent, Skill, McpServer
        
        agent = Agent(
            name="code-reviewer",
            instructions="Review code and suggest improvements",
            description="AI code reviewer",
            icon_url="https://example.com/icon.png",
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
        
        # Convert to proto (CLI will call this)
        proto = agent.to_proto()
        ```
    
    Attributes:
        name: Agent name (lowercase alphanumeric with hyphens)
        instructions: Behavior instructions (min 10 characters)
        description: Human-readable description (optional)
        icon_url: Icon URL for UI display (optional)
        skills: List of skill references (optional)
        mcp_servers: List of MCP server definitions (optional)
        sub_agents: List of sub-agents that can be delegated to (optional)
        environment_variables: List of environment variables (optional)
    """
    
    name: str
    """Agent name (lowercase alphanumeric with hyphens)."""
    
    instructions: str
    """Behavior instructions defining the agent's personality (min 10 characters)."""
    
    description: Optional[str] = None
    """Human-readable description for UI and marketplace display."""
    
    icon_url: Optional[str] = None
    """Icon URL for marketplace and UI display."""
    
    skills: List[Skill] = field(default_factory=list)
    """References to Skill resources providing agent knowledge."""
    
    mcp_servers: List[McpServer] = field(default_factory=list)
    """MCP server definitions declaring required servers."""
    
    sub_agents: List[SubAgent] = field(default_factory=list)
    """Sub-agents that can be delegated to (inline or referenced)."""
    
    environment_variables: List[EnvironmentVariable] = field(default_factory=list)
    """Environment variables required by the agent."""
    
    # Metadata fields (set by user or default)
    org: Optional[str] = None
    """Organization that owns this agent (optional)."""
    
    def __post_init__(self):
        """Validate after initialization."""
        from stigmer.agent.validation.agent_validator import AgentValidator
        AgentValidator.validate(self)
    
    def to_proto(self):
        """
        Convert this Agent to a proto message.
        
        Returns:
            ai.stigmer.agentic.agent.v1.Agent proto message
            
        Raises:
            ConversionError: If conversion fails
            
        Example:
            ```python
            agent = Agent(name="test", instructions="Test instructions")
            proto = agent.to_proto()
            ```
        """
        from stigmer.agent.converters.agent_converter import AgentConverter
        return AgentConverter.to_proto(self)
    
    def __str__(self) -> str:
        """String representation."""
        skills_count = len(self.skills) if self.skills else 0
        mcp_count = len(self.mcp_servers) if self.mcp_servers else 0
        return (
            f"Agent(name={self.name}, "
            f"skills={skills_count}, "
            f"mcp_servers={mcp_count})"
        )
    
    def __repr__(self) -> str:
        """Developer representation."""
        return self.__str__()
