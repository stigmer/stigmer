"""
Environment variable definitions for agent configuration.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class EnvironmentVariable:
    """
    Defines an environment variable required by an agent.
    
    Example:
        ```python
        # Required secret
        github_token = EnvironmentVariable(
            name="GITHUB_TOKEN",
            is_secret=True,
            description="GitHub API token"
        )
        
        # Optional config value
        region = EnvironmentVariable(
            name="AWS_REGION",
            is_secret=False,
            default_value="us-east-1"
        )
        ```
    """
    
    name: str
    """Name of the environment variable."""
    
    is_secret: bool = False
    """Whether this is a secret (encrypted storage)."""
    
    description: Optional[str] = None
    """Human-readable description."""
    
    default_value: Optional[str] = None
    """Default value if not provided at instance level."""
    
    required: bool = True
    """Whether this variable is required."""
    
    def __str__(self) -> str:
        """String representation."""
        secret_marker = " (secret)" if self.is_secret else ""
        required_marker = "" if self.required else " (optional)"
        return f"EnvVar({self.name}{secret_marker}{required_marker})"
