"""Placeholder resolution service for MCP server configurations.

This module provides a service for resolving ${VAR_NAME} placeholders in
MCP server configurations. It supports both strict mode (raises errors
for missing variables) and lenient mode (logs warnings).

The placeholder syntax follows the standard pattern: ${VARIABLE_NAME}
where VARIABLE_NAME must match [A-Za-z_][A-Za-z0-9_]*.

Examples:
    Basic usage with strict validation:
    
        >>> resolver = PlaceholderResolver(strict=True)
        >>> resolver.resolve("Bearer ${TOKEN}", {"TOKEN": "abc123"})
        'Bearer abc123'
        
        >>> resolver.resolve("Bearer ${MISSING}", {})
        PlaceholderResolutionError: Missing required variable: MISSING
    
    Lenient mode (logs warnings, preserves unresolved):
    
        >>> resolver = PlaceholderResolver(strict=False)
        >>> resolver.resolve("Bearer ${MISSING}", {})
        'Bearer ${MISSING}'  # Warning logged
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Regex pattern for ${VAR_NAME} placeholders
# Matches: ${VALID_NAME} where name starts with letter/underscore, followed by alphanumeric/underscore
PLACEHOLDER_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class PlaceholderResolutionError(Exception):
    """Raised when placeholder resolution fails in strict mode.
    
    Attributes:
        variable_name: The name of the missing or invalid variable.
        context: Optional context about where the error occurred (e.g., "header 'Authorization'").
        message: Human-readable error message.
    """
    
    def __init__(
        self,
        variable_name: str,
        context: str | None = None,
        message: str | None = None,
    ) -> None:
        self.variable_name = variable_name
        self.context = context
        if message:
            self.message = message
        elif context:
            self.message = (
                f"Missing required environment variable '${{{variable_name}}}' "
                f"in {context}. Ensure this variable is provided in the environment."
            )
        else:
            self.message = (
                f"Missing required environment variable '${{{variable_name}}}'. "
                "Ensure this variable is provided in the environment."
            )
        super().__init__(self.message)


@dataclass
class PlaceholderResolutionResult:
    """Result of placeholder resolution with metadata.
    
    Attributes:
        value: The resolved string value.
        resolved_variables: Set of variable names that were resolved.
        unresolved_variables: Set of variable names that could not be resolved.
    """
    
    value: str
    resolved_variables: set[str] = field(default_factory=set)
    unresolved_variables: set[str] = field(default_factory=set)
    
    @property
    def fully_resolved(self) -> bool:
        """Whether all placeholders were successfully resolved."""
        return len(self.unresolved_variables) == 0


class PlaceholderResolver:
    """Service for resolving ${VAR_NAME} placeholders in strings.
    
    This resolver supports two modes:
    - Strict mode (strict=True): Raises PlaceholderResolutionError for missing variables
    - Lenient mode (strict=False): Logs warnings and preserves unresolved placeholders
    
    The resolver is stateless and thread-safe.
    
    Attributes:
        strict: If True, missing variables raise errors. If False, warnings are logged.
    """
    
    def __init__(self, strict: bool = False) -> None:
        """Initialize the placeholder resolver.
        
        Args:
            strict: If True, raise errors for missing variables.
                   If False, log warnings and preserve unresolved placeholders.
        """
        self.strict = strict
    
    def resolve(
        self,
        template: str,
        env_vars: dict[str, str],
        context: str | None = None,
    ) -> str:
        """Resolve placeholders in a single string.
        
        Args:
            template: String potentially containing ${VAR_NAME} placeholders.
            env_vars: Dictionary mapping variable names to their values.
            context: Optional context for error messages (e.g., "header 'Authorization'").
            
        Returns:
            String with placeholders resolved.
            
        Raises:
            PlaceholderResolutionError: In strict mode, if a variable is missing.
            
        Examples:
            >>> resolver = PlaceholderResolver(strict=True)
            >>> resolver.resolve("Bearer ${TOKEN}", {"TOKEN": "abc"})
            'Bearer abc'
        """
        if not template or "${" not in template:
            return template
        
        result = self._resolve_with_tracking(template, env_vars, context)
        return result.value
    
    def resolve_with_metadata(
        self,
        template: str,
        env_vars: dict[str, str],
        context: str | None = None,
    ) -> PlaceholderResolutionResult:
        """Resolve placeholders and return detailed result.
        
        Unlike resolve(), this method returns metadata about which variables
        were resolved and which were not.
        
        Args:
            template: String potentially containing ${VAR_NAME} placeholders.
            env_vars: Dictionary mapping variable names to their values.
            context: Optional context for error messages.
            
        Returns:
            PlaceholderResolutionResult with resolved value and metadata.
            
        Raises:
            PlaceholderResolutionError: In strict mode, if a variable is missing.
        """
        if not template or "${" not in template:
            return PlaceholderResolutionResult(value=template)
        
        return self._resolve_with_tracking(template, env_vars, context)
    
    def resolve_map(
        self,
        template_map: dict[str, str],
        env_vars: dict[str, str],
        context_prefix: str | None = None,
    ) -> dict[str, str]:
        """Resolve placeholders in all values of a dictionary.
        
        Args:
            template_map: Dictionary with string values containing placeholders.
            env_vars: Dictionary mapping variable names to their values.
            context_prefix: Optional prefix for error context (e.g., "header").
            
        Returns:
            New dictionary with all placeholder values resolved.
            
        Raises:
            PlaceholderResolutionError: In strict mode, if any variable is missing.
            
        Examples:
            >>> resolver = PlaceholderResolver(strict=True)
            >>> resolver.resolve_map(
            ...     {"Auth": "Bearer ${TOKEN}", "Version": "v1"},
            ...     {"TOKEN": "abc"}
            ... )
            {'Auth': 'Bearer abc', 'Version': 'v1'}
        """
        if not template_map:
            return {}
        
        resolved: dict[str, str] = {}
        for key, value in template_map.items():
            context = f"{context_prefix} '{key}'" if context_prefix else f"key '{key}'"
            resolved[key] = self.resolve(value, env_vars, context)
        
        return resolved
    
    def resolve_http_config(
        self,
        headers: dict[str, str] | None,
        query_params: dict[str, str] | None,
        env_vars: dict[str, str],
    ) -> tuple[dict[str, str], dict[str, str]]:
        """Resolve placeholders in HTTP configuration.
        
        Convenience method for resolving both headers and query params
        in an HTTP MCP server configuration.
        
        Args:
            headers: HTTP headers with potential placeholders.
            query_params: Query parameters with potential placeholders.
            env_vars: Dictionary mapping variable names to their values.
            
        Returns:
            Tuple of (resolved_headers, resolved_query_params).
            
        Raises:
            PlaceholderResolutionError: In strict mode, if any variable is missing.
        """
        resolved_headers = self.resolve_map(
            headers or {},
            env_vars,
            context_prefix="header",
        )
        resolved_params = self.resolve_map(
            query_params or {},
            env_vars,
            context_prefix="query parameter",
        )
        return resolved_headers, resolved_params
    
    def find_placeholders(self, template: str) -> set[str]:
        """Find all placeholder variable names in a string.
        
        Args:
            template: String potentially containing ${VAR_NAME} placeholders.
            
        Returns:
            Set of variable names found in placeholders.
            
        Examples:
            >>> resolver = PlaceholderResolver()
            >>> resolver.find_placeholders("${A} and ${B}")
            {'A', 'B'}
        """
        if not template or "${" not in template:
            return set()
        
        return set(PLACEHOLDER_PATTERN.findall(template))
    
    def find_all_placeholders(self, template_map: dict[str, str]) -> set[str]:
        """Find all placeholder variable names in a dictionary's values.
        
        Args:
            template_map: Dictionary with string values.
            
        Returns:
            Set of all variable names found across all values.
        """
        all_vars: set[str] = set()
        for value in template_map.values():
            all_vars.update(self.find_placeholders(value))
        return all_vars
    
    def validate_all_resolved(
        self,
        template_map: dict[str, str],
        env_vars: dict[str, str],
        context: str | None = None,
    ) -> list[str]:
        """Validate that all placeholders can be resolved.
        
        This method does not modify the templates - it only checks if all
        required variables are present.
        
        Args:
            template_map: Dictionary with string values containing placeholders.
            env_vars: Dictionary mapping variable names to their values.
            context: Optional context for error reporting.
            
        Returns:
            List of missing variable names. Empty if all can be resolved.
        """
        required = self.find_all_placeholders(template_map)
        available = set(env_vars.keys())
        missing = required - available
        return sorted(missing)
    
    def _resolve_with_tracking(
        self,
        template: str,
        env_vars: dict[str, str],
        context: str | None,
    ) -> PlaceholderResolutionResult:
        """Internal method that resolves placeholders while tracking metadata.
        
        Args:
            template: String containing placeholders.
            env_vars: Environment variables for resolution.
            context: Optional context for error messages.
            
        Returns:
            PlaceholderResolutionResult with value and metadata.
            
        Raises:
            PlaceholderResolutionError: In strict mode, if variable missing.
        """
        resolved_vars: set[str] = set()
        unresolved_vars: set[str] = set()
        
        def replace_match(match: re.Match[str]) -> str:
            var_name = match.group(1)
            if var_name in env_vars:
                resolved_vars.add(var_name)
                return env_vars[var_name]
            else:
                unresolved_vars.add(var_name)
                if self.strict:
                    raise PlaceholderResolutionError(
                        variable_name=var_name,
                        context=context,
                    )
                else:
                    logger.warning(
                        f"Unresolved placeholder ${{{var_name}}} - "
                        "ensure this variable is provided in the environment"
                        + (f" ({context})" if context else "")
                    )
                    return match.group(0)  # Return original placeholder
        
        resolved_value = PLACEHOLDER_PATTERN.sub(replace_match, template)
        
        return PlaceholderResolutionResult(
            value=resolved_value,
            resolved_variables=resolved_vars,
            unresolved_variables=unresolved_vars,
        )


# Module-level convenience functions (backward compatible)

def resolve_placeholders(value: str, env_vars: dict[str, str]) -> str:
    """Resolve ${VAR_NAME} placeholders in a string (lenient mode).
    
    This function provides backward compatibility with the existing API.
    For more control, use the PlaceholderResolver class directly.
    
    Args:
        value: String potentially containing ${VAR_NAME} placeholders.
        env_vars: Dictionary mapping variable names to their values.
        
    Returns:
        String with placeholders resolved where possible.
        Unresolved placeholders are preserved with a warning.
    """
    resolver = PlaceholderResolver(strict=False)
    return resolver.resolve(value, env_vars)


def resolve_placeholders_strict(
    value: str,
    env_vars: dict[str, str],
    context: str | None = None,
) -> str:
    """Resolve ${VAR_NAME} placeholders in a string (strict mode).
    
    Args:
        value: String potentially containing ${VAR_NAME} placeholders.
        env_vars: Dictionary mapping variable names to their values.
        context: Optional context for error messages.
        
    Returns:
        String with all placeholders resolved.
        
    Raises:
        PlaceholderResolutionError: If any variable is missing.
    """
    resolver = PlaceholderResolver(strict=True)
    return resolver.resolve(value, env_vars, context)
