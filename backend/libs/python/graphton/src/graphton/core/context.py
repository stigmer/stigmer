"""Context management for user authentication tokens.

This module uses Python's contextvars for thread-safe, coroutine-local token storage.
This approach works in both local and remote LangGraph deployments, unlike relying
on runtime.context which is not available in LangGraph Cloud remote environments.

The token flow:
1. Middleware extracts token from config['configurable']['_user_token']
2. Middleware calls set_user_token() to store in ContextVar
3. Tool wrappers call get_user_token() to retrieve for MCP calls
4. Middleware calls clear_user_token() after execution for cleanup
"""

from contextvars import ContextVar

# Context variable for storing user authentication token
# This is thread-safe and coroutine-local, working in both sync and async contexts
_user_token_var: ContextVar[str | None] = ContextVar("_user_token", default=None)


def set_user_token(token: str) -> None:
    """Set user authentication token in context.
    
    Called by middleware before agent execution to make token available
    to tool wrappers throughout the execution context.
    
    Args:
        token: User's JWT token or API key for authentication
        
    Example:
        >>> set_user_token("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")

    """
    _user_token_var.set(token)


def get_user_token() -> str:
    """Get user authentication token from context.
    
    Called by tool wrappers to retrieve the token for MCP tool invocations.
    This must be called within the execution context after set_user_token().
    
    Returns:
        User's authentication token
        
    Raises:
        ValueError: If token not set in context (middleware not configured)
        
    Example:
        >>> token = get_user_token()
        >>> # Use token for MCP authentication

    """
    token = _user_token_var.get()
    
    if not token:
        raise ValueError(
            "User token not available in context. "
            "Ensure McpToolsLoader middleware is properly configured and "
            "token is passed via config={'configurable': {'_user_token': token}}."
        )
    
    return token


def clear_user_token() -> None:
    """Clear user authentication token from context.
    
    Called by middleware after agent execution to clean up the context.
    This ensures tokens don't leak between executions.
    
    Example:
        >>> clear_user_token()

    """
    _user_token_var.set(None)


def has_user_token() -> bool:
    """Check if a user token is currently set in context.
    
    Returns:
        True if token is set, False otherwise
        
    Example:
        >>> if has_user_token():
        ...     token = get_user_token()

    """
    token = _user_token_var.get()
    return token is not None and token.strip() != ""

























