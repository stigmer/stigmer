"""
Sub-agent reference for agent configuration.
"""

from dataclasses import dataclass
from typing import Optional, List, Dict


@dataclass
class SubAgent:
    """
    Reference to a sub-agent that can be delegated to.
    
    Sub-agents can be either inline definitions or references to existing AgentInstance resources.
    
    Example:
        ```python
        # Reference existing instance
        sub_agent = SubAgent.ref(
            name="security-checker",
            agent_instance_ref="sec-checker-prod"
        )
        
        # Inline sub-agent
        sub_agent = SubAgent.inline(
            name="code-analyzer",
            instructions="Analyze code for bugs",
            mcp_servers=["github"]
        )
        ```
    """
    
    name: str
    """Name of the sub-agent."""
    
    # For referenced sub-agents
    agent_instance_ref: Optional[str] = None
    """Reference to an existing AgentInstance (mutually exclusive with inline fields)."""
    
    # For inline sub-agents
    description: Optional[str] = None
    """Description of what this sub-agent does (inline only)."""
    
    instructions: Optional[str] = None
    """Behavior instructions for this sub-agent (inline only)."""
    
    mcp_servers: Optional[List[str]] = None
    """MCP server names this sub-agent can use (inline only)."""
    
    mcp_tool_selections: Optional[Dict[str, List[str]]] = None
    """Tool selections per MCP server (inline only)."""
    
    skill_refs: Optional[List["Skill"]] = None
    """Skills for this sub-agent (inline only)."""
    
    @classmethod
    def ref(cls, name: str, agent_instance_ref: str) -> "SubAgent":
        """
        Create a reference to an existing AgentInstance.
        
        Args:
            name: Name of the sub-agent
            agent_instance_ref: ID or name of the AgentInstance
            
        Returns:
            SubAgent reference
            
        Example:
            ```python
            sub = SubAgent.ref("security", "sec-checker-prod")
            ```
        """
        return cls(name=name, agent_instance_ref=agent_instance_ref)
    
    @classmethod
    def inline(
        cls,
        name: str,
        instructions: str,
        description: Optional[str] = None,
        mcp_servers: Optional[List[str]] = None,
        skill_refs: Optional[List["Skill"]] = None,
    ) -> "SubAgent":
        """
        Create an inline sub-agent definition.
        
        Args:
            name: Name of the sub-agent
            instructions: Behavior instructions
            description: Description (optional)
            mcp_servers: MCP server names (optional)
            skill_refs: Skills (optional)
            
        Returns:
            SubAgent with inline definition
            
        Example:
            ```python
            sub = SubAgent.inline(
                name="analyzer",
                instructions="Analyze code for bugs",
                mcp_servers=["github"]
            )
            ```
        """
        return cls(
            name=name,
            instructions=instructions,
            description=description,
            mcp_servers=mcp_servers,
            skill_refs=skill_refs,
        )
    
    @property
    def is_inline(self) -> bool:
        """Whether this is an inline sub-agent definition."""
        return self.instructions is not None
    
    @property
    def is_reference(self) -> bool:
        """Whether this is a reference to an existing AgentInstance."""
        return self.agent_instance_ref is not None
    
    def __str__(self) -> str:
        """String representation."""
        if self.is_reference:
            return f"SubAgent({self.name} -> {self.agent_instance_ref})"
        return f"SubAgent({self.name} inline)"
