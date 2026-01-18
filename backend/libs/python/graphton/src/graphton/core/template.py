"""Template substitution engine for MCP server configurations.

This module provides utilities for extracting and substituting template variables
in MCP server configurations. It supports the `{{VAR_NAME}}` syntax for dynamic
value injection at runtime.

Example:
    >>> config = {
    ...     "url": "https://api.example.com",
    ...     "headers": {
    ...         "Authorization": "Bearer {{USER_TOKEN}}",
    ...         "X-API-Key": "{{API_KEY}}"
    ...     }
    ... }
    >>> vars = extract_template_vars(config)
    >>> vars
    {'USER_TOKEN', 'API_KEY'}
    >>> values = {"USER_TOKEN": "token123", "API_KEY": "key456"}
    >>> result = substitute_templates(config, values)
    >>> result["headers"]["Authorization"]
    'Bearer token123'

"""

import re
from typing import Any

# Regex pattern to match {{VAR_NAME}} with optional whitespace
TEMPLATE_PATTERN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def extract_template_vars(config: Any) -> set[str]:  # noqa: ANN401
    """Extract all template variable names from a configuration.
    
    Recursively traverses the config structure (dicts, lists, strings) and
    extracts all template variable names matching the pattern {{VAR_NAME}}.
    
    Args:
        config: Configuration dict, list, string, or other value
        
    Returns:
        Set of variable names found in template placeholders
        
    Example:
        >>> config = {
        ...     "url": "{{BASE_URL}}/api",
        ...     "headers": {
        ...         "Authorization": "Bearer {{TOKEN}}"
        ...     },
        ...     "timeout": 30
        ... }
        >>> extract_template_vars(config)
        {'BASE_URL', 'TOKEN'}

    """
    variables: set[str] = set()
    
    if isinstance(config, dict):
        # Recursively process all dict values
        for value in config.values():
            variables.update(extract_template_vars(value))
    
    elif isinstance(config, list):
        # Recursively process all list items
        for item in config:
            variables.update(extract_template_vars(item))
    
    elif isinstance(config, str):
        # Extract variable names from template placeholders
        matches = TEMPLATE_PATTERN.findall(config)
        variables.update(matches)
    
    # For other types (int, bool, None, etc.), no templates possible
    
    return variables


def has_templates(config: Any) -> bool:  # noqa: ANN401
    """Check if a configuration contains any template variables.
    
    Args:
        config: Configuration dict, list, string, or other value
        
    Returns:
        True if config contains any {{VAR}} placeholders, False otherwise
        
    Example:
        >>> has_templates({"url": "https://api.example.com"})
        False
        >>> has_templates({"url": "{{BASE_URL}}/api"})
        True

    """
    return bool(extract_template_vars(config))


def substitute_templates(config: Any, values: dict[str, str]) -> Any:  # noqa: ANN401
    """Substitute template variables with actual values.
    
    Recursively traverses the config structure and replaces all {{VAR_NAME}}
    placeholders with corresponding values from the values dict.
    
    Args:
        config: Configuration dict, list, string, or other value
        values: Dictionary mapping variable names to their values
        
    Returns:
        New config structure with all templates substituted
        
    Raises:
        ValueError: If required variables are missing from values dict
        
    Example:
        >>> config = {
        ...     "url": "{{BASE_URL}}/api",
        ...     "headers": {"Authorization": "Bearer {{TOKEN}}"}
        ... }
        >>> values = {"BASE_URL": "https://api.example.com", "TOKEN": "abc123"}
        >>> result = substitute_templates(config, values)
        >>> result["url"]
        'https://api.example.com/api'
        >>> result["headers"]["Authorization"]
        'Bearer abc123'

    """
    # Check for missing variables upfront
    required_vars = extract_template_vars(config)
    provided_vars = set(values.keys())
    missing_vars = required_vars - provided_vars
    
    if missing_vars:
        raise ValueError(
            f"Missing required template variables: {sorted(missing_vars)}. "
            f"Provide these variables in config['configurable']: "
            f"{', '.join(sorted(missing_vars))}"
        )
    
    # Perform substitution
    return _substitute_recursive(config, values)


def _substitute_recursive(config: Any, values: dict[str, str]) -> Any:  # noqa: ANN401
    """Recursively substitute templates in config structure.
    
    Internal helper function that performs the actual substitution.
    
    Args:
        config: Configuration value to process
        values: Dictionary mapping variable names to their values
        
    Returns:
        New config value with templates substituted

    """
    if isinstance(config, dict):
        # Create new dict with substituted values
        return {
            key: _substitute_recursive(value, values)
            for key, value in config.items()
        }
    
    elif isinstance(config, list):
        # Create new list with substituted items
        return [
            _substitute_recursive(item, values)
            for item in config
        ]
    
    elif isinstance(config, str):
        # Substitute all template variables in string
        def replacer(match: re.Match[str]) -> str:
            var_name = match.group(1)
            # Values dict should contain the variable (validated upfront)
            return values.get(var_name, match.group(0))
        
        return TEMPLATE_PATTERN.sub(replacer, config)
    
    else:
        # For other types (int, bool, None, etc.), return as-is
        return config


def validate_template_syntax(config: Any) -> list[str]:  # noqa: ANN401
    """Validate template syntax in configuration.
    
    Checks for common template syntax errors like malformed placeholders.
    
    Args:
        config: Configuration to validate
        
    Returns:
        List of error messages (empty if valid)
        
    Example:
        >>> config = {"url": "{{BASE_URL}}/api", "key": "{{INVALID-KEY}}"}
        >>> errors = validate_template_syntax(config)
        >>> len(errors)
        0

    """
    errors: list[str] = []
    
    # Check for potential malformed templates
    if isinstance(config, str):
        # Look for single braces that might be typos
        if '{' in config and not TEMPLATE_PATTERN.search(config):
            if config.count('{') != config.count('}'):
                errors.append(
                    f"Malformed template in '{config}': "
                    "unbalanced braces. Use {{{{VAR_NAME}}}} syntax."
                )
    
    elif isinstance(config, dict):
        for key, value in config.items():
            errors.extend(validate_template_syntax(value))
    
    elif isinstance(config, list):
        for item in config:
            errors.extend(validate_template_syntax(item))
    
    return errors
























