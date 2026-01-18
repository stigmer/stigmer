"""
Common utility types and constants for the agent SDK.
"""

import re
from typing import Pattern

# Name validation pattern: lowercase alphanumeric with hyphens
NAME_PATTERN: Pattern = re.compile(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')

# Maximum lengths
MAX_NAME_LENGTH = 63
MAX_DESCRIPTION_LENGTH = 500

# API constants
AGENT_API_VERSION = "agentic.stigmer.ai/v1"
AGENT_KIND = "Agent"


def validate_name(name: str, field_name: str = "name") -> None:
    """
    Validate a resource name.
    
    Args:
        name: Name to validate
        field_name: Name of the field being validated (for error messages)
        
    Raises:
        ValueError: If name is invalid
    """
    if not name:
        raise ValueError(f"{field_name} is required")
    
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(
            f"{field_name} must be {MAX_NAME_LENGTH} characters or less, "
            f"got {len(name)}"
        )
    
    if not NAME_PATTERN.match(name):
        raise ValueError(
            f"{field_name} must contain only lowercase alphanumeric characters "
            f"and hyphens, and must start and end with an alphanumeric character"
        )


def validate_description(description: str, field_name: str = "description") -> None:
    """
    Validate a description field.
    
    Args:
        description: Description to validate
        field_name: Name of the field being validated (for error messages)
        
    Raises:
        ValueError: If description is invalid
    """
    if description and len(description) > MAX_DESCRIPTION_LENGTH:
        raise ValueError(
            f"{field_name} must be {MAX_DESCRIPTION_LENGTH} characters or less, "
            f"got {len(description)}"
        )
