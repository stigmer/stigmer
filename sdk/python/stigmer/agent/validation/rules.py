"""
Common validation rules shared across validators.
"""

import re
from typing import Pattern

# Name validation pattern: lowercase alphanumeric with hyphens
_NAME_PATTERN: Pattern = re.compile(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')

# Maximum lengths
_MAX_NAME_LENGTH = 63
_MAX_DESCRIPTION_LENGTH = 500
_MAX_INSTRUCTIONS_LENGTH = 10000
_MIN_INSTRUCTIONS_LENGTH = 10


def validate_name(name: str, field_name: str = "name") -> None:
    """
    Validate a resource name.
    
    Args:
        name: Name to validate
        field_name: Name of the field being validated (for error messages)
        
    Raises:
        ValueError: If name is invalid
    """
    from stigmer.agent.exceptions import ValidationError
    
    if not name:
        raise ValidationError(f"{field_name} is required", field=field_name)
    
    if len(name) > _MAX_NAME_LENGTH:
        raise ValidationError(
            f"{field_name} must be {_MAX_NAME_LENGTH} characters or less, "
            f"got {len(name)}",
            field=field_name
        )
    
    if not _NAME_PATTERN.match(name):
        raise ValidationError(
            f"{field_name} must contain only lowercase alphanumeric characters "
            f"and hyphens, and must start and end with an alphanumeric character",
            field=field_name
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
    from stigmer.agent.exceptions import ValidationError
    
    if description and len(description) > _MAX_DESCRIPTION_LENGTH:
        raise ValidationError(
            f"{field_name} must be {_MAX_DESCRIPTION_LENGTH} characters or less, "
            f"got {len(description)}",
            field=field_name
        )


def validate_instructions(instructions: str, field_name: str = "instructions") -> None:
    """
    Validate agent instructions.
    
    Args:
        instructions: Instructions to validate
        field_name: Name of the field being validated (for error messages)
        
    Raises:
        ValidationError: If instructions are invalid
    """
    from stigmer.agent.exceptions import ValidationError
    
    if not instructions:
        raise ValidationError(f"{field_name} is required", field=field_name)
    
    if len(instructions) < _MIN_INSTRUCTIONS_LENGTH:
        raise ValidationError(
            f"{field_name} must be at least {_MIN_INSTRUCTIONS_LENGTH} characters, "
            f"got {len(instructions)}",
            field=field_name
        )
    
    if len(instructions) > _MAX_INSTRUCTIONS_LENGTH:
        raise ValidationError(
            f"{field_name} must be {_MAX_INSTRUCTIONS_LENGTH} characters or less, "
            f"got {len(instructions)}",
            field=field_name
        )


def validate_non_empty(value: str, field_name: str) -> None:
    """
    Validate that a field is non-empty.
    
    Args:
        value: Value to validate
        field_name: Name of the field being validated
        
    Raises:
        ValidationError: If value is empty
    """
    from stigmer.agent.exceptions import ValidationError
    
    if not value or not value.strip():
        raise ValidationError(f"{field_name} cannot be empty", field=field_name)


def validate_url(url: str, field_name: str = "url") -> None:
    """
    Validate a URL.
    
    Args:
        url: URL to validate
        field_name: Name of the field being validated
        
    Raises:
        ValidationError: If URL is invalid
    """
    from stigmer.agent.exceptions import ValidationError
    
    if not url:
        raise ValidationError(f"{field_name} is required", field=field_name)
    
    # Basic URL validation
    if not url.startswith(("http://", "https://")):
        raise ValidationError(
            f"{field_name} must start with http:// or https://",
            field=field_name
        )
