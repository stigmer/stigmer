"""
Skill reference helper for agent configuration.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class Skill:
    """
    Reference to a Skill resource.
    
    Skills provide knowledge and capabilities to agents.
    
    Example:
        ```python
        # Reference by name (org-scoped)
        skill = Skill.ref("coding-best-practices")
        
        # Reference from specific org
        skill = Skill.ref("security-analysis", org="security-team")
        ```
    """
    
    name: str
    """Name of the skill."""
    
    org: Optional[str] = None
    """Organization that owns the skill (optional)."""
    
    @classmethod
    def ref(cls, name: str, org: Optional[str] = None) -> "Skill":
        """
        Create a skill reference.
        
        Args:
            name: Name of the skill
            org: Organization that owns the skill (optional)
            
        Returns:
            Skill reference
            
        Example:
            ```python
            skill = Skill.ref("coding-best-practices")
            ```
        """
        return cls(name=name, org=org)
    
    def __str__(self) -> str:
        """String representation."""
        if self.org:
            return f"Skill({self.name} @ {self.org})"
        return f"Skill({self.name})"
