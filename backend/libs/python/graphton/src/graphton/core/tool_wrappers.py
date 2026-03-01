"""Tool wrapper generator for MCP and platform tools.

This module dynamically creates @tool decorated wrapper functions for:

1. **MCP Tools**: Tools from MCP (Model Context Protocol) servers, loaded via middleware.
   The wrappers delegate to actual MCP tools loaded by the middleware.

2. **Platform Tools**: Sandbox/filesystem tools (read, write, edit, execute, ls, glob, grep)
   that are provided to agents with sandbox access. These tools interact with the
   backend (FilesystemBackend, DaytonaBackend, etc.) for file and command operations.

For dynamic MCP configurations (with template variables), this module provides
lazy tool wrappers that defer tool loading until first invocation, allowing
graphs to be created at module import time without requiring user credentials.

**HITL (Human-in-the-Loop) Approval Flow:**

Both MCP and platform tools support approval-aware wrappers that call interrupt()
before executing tools that require user approval. The approval flow:

1. Check if approval is required via the approval_checker callback
2. If required, call interrupt() to pause execution and wait for user decision
3. Handle the response: approve (continue), skip (return message), reject (raise error)

**Platform Tools:**

Platform tools are divided into two categories based on risk:

- **Safe tools** (no approval by default): read, ls, glob, grep
  Read-only operations that don't modify files or execute commands.

- **Dangerous tools** (require approval by default): write, edit, execute
  Operations that can modify the filesystem or execute arbitrary commands.

Example:
    >>> from graphton.core.tool_wrappers import create_platform_tool_wrappers
    >>> 
    >>> # Create all 7 platform tools with approval checking
    >>> tools = create_platform_tool_wrappers(backend, approval_checker=my_checker)
    >>> # Returns: read, ls, glob, grep, write, edit, execute
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from langchain_core.callbacks import dispatch_custom_event
from langchain_core.tools import tool

from graphton.core.error_hints import enrich_error_message

if TYPE_CHECKING:
    pass  # For future type imports

logger = logging.getLogger(__name__)


def _unwrap_exception(exc: BaseException) -> BaseException:
    """Extract the first meaningful cause from an exception.

    ``anyio`` wraps failures inside ``ExceptionGroup`` (Python 3.11+) or
    the backport ``exceptiongroup.ExceptionGroup``.  The outer wrapper
    reads "unhandled errors in a TaskGroup (1 sub-exception)" which is
    uninformative.  This helper digs out the actual root cause so that
    error messages shown to the user (and logged) are actionable.
    """
    if isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        return _unwrap_exception(exc.exceptions[0])
    if exc.__cause__ is not None and isinstance(exc.__cause__, BaseExceptionGroup):
        return _unwrap_exception(exc.__cause__)
    return exc


# =============================================================================
# Exception Classes for HITL Approval Flow
# =============================================================================


class ToolExecutionRejectedError(Exception):
    """Raised when a user rejects tool execution during HITL approval flow.
    
    This exception indicates that the user explicitly rejected the tool execution,
    and the agent should fail gracefully with an appropriate error message.
    
    Attributes:
        tool_name: Name of the tool that was rejected
        message: User-facing rejection message
    
    """
    
    def __init__(self, tool_name: str, message: str | None = None):
        """Initialize the rejection error.
        
        Args:
            tool_name: Name of the tool that was rejected
            message: Optional custom message explaining the rejection
        
        """
        self.tool_name = tool_name
        self.message = message or f"User rejected execution of tool '{tool_name}'"
        super().__init__(self.message)


# =============================================================================
# Data Classes for Approval Flow
# =============================================================================


@dataclass
class ApprovalRequirement:
    """Result of checking whether a tool requires approval.
    
    This dataclass is returned by approval checker functions to indicate
    whether approval is needed and provide context for the approval request.
    
    Attributes:
        requires_approval: True if user approval is needed before execution
        message: Human-readable message explaining why approval is needed
        mcp_server: Name of the MCP server providing the tool (for context)
        source: Where the approval requirement came from (for debugging)
    
    """
    
    requires_approval: bool = False
    message: str = ""
    mcp_server: str = ""
    source: str = "none"  # "auto_approve_all", "agent_override", "mcp_default", "none"


def create_tool_wrapper(
    tool_name: str,
    middleware_instance: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create a wrapper function for an MCP tool.
    
    The generated wrapper:
    1. Gets the actual MCP tool from middleware cache
    2. Invokes the tool with provided arguments
    3. Returns the tool result
    
    This eliminates the need to manually write wrapper functions for each MCP tool.
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance with cached tools
        
    Returns:
        A @tool decorated function that delegates to the MCP tool
        
    Raises:
        RuntimeError: If tool metadata cannot be copied from original
        
    Example:
        >>> from graphton.core.middleware import McpToolsLoader
        >>> from graphton.core.tool_wrappers import create_tool_wrapper
        >>> 
        >>> # Assume middleware is initialized and tools are loaded
        >>> wrapper = create_tool_wrapper("list_organizations", middleware)
        >>> result = wrapper()  # Invokes actual MCP tool

    """
    # Pre-validate that tool exists in middleware cache
    # This will raise clear error if tool not found
    try:
        actual_tool = middleware_instance.get_tool(tool_name)
    except (RuntimeError, ValueError) as e:
        logger.error(f"Failed to create wrapper for '{tool_name}': {e}")
        raise RuntimeError(
            f"Cannot create wrapper for tool '{tool_name}': {e}"
        ) from e
    
    # Create the wrapper function
    @tool
    async def wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        """Auto-generated wrapper for MCP tool.
        
        This wrapper:
        - Gets the actual MCP tool from middleware
        - Invokes the tool with arguments
        - Returns the result
        """
        logger.debug(f"Invoking MCP tool '{tool_name}'")
        
        # Get actual MCP tool from middleware cache
        try:
            mcp_tool = middleware_instance.get_tool(tool_name)
        except (RuntimeError, ValueError) as e:
            logger.error(f"Failed to get tool '{tool_name}' from cache: {e}")
            raise RuntimeError(
                f"Tool '{tool_name}' not available. "
                "Ensure middleware loaded tools successfully."
            ) from e
        
        # Invoke the actual MCP tool with provided arguments
        try:
            actual_args = kwargs
            if isinstance(kwargs, dict):
                if len(kwargs) == 1 and 'input' in kwargs:
                    logger.debug(f"Unwrapping 'input' key for '{tool_name}'")
                    actual_args = kwargs['input']
                elif len(kwargs) == 1 and 'kwargs' in kwargs:
                    logger.debug(f"Unwrapping 'kwargs' key for '{tool_name}'")
                    actual_args = kwargs['kwargs']

            logger.debug(f"Calling mcp_tool.ainvoke() for '{tool_name}'")
            result = await mcp_tool.ainvoke(actual_args)
            logger.debug(f"MCP tool '{tool_name}' returned successfully")
            return result
        except Exception as e:
            cause = _unwrap_exception(e)
            logger.error(
                f"MCP tool '{tool_name}' invocation failed: {cause}",
                exc_info=True,
            )
            raise RuntimeError(
                f"MCP tool '{tool_name}' invocation failed: {cause}"
            ) from e
    
    # Copy metadata from original tool for better LangChain integration
    try:
        # Set the tool name
        wrapper.name = tool_name  # type: ignore[attr-defined]
        wrapper.description = actual_tool.description  # type: ignore[attr-defined]
        
        # If the tool has additional metadata, preserve it
        if hasattr(actual_tool, 'args_schema'):
            wrapper.args_schema = actual_tool.args_schema  # type: ignore[attr-defined]
        
        logger.debug(
            f"Created wrapper for MCP tool '{tool_name}' with "
            f"description: {actual_tool.description[:100] if actual_tool.description else 'None'}..."
        )
        
    except Exception as e:
        logger.warning(
            f"Failed to copy metadata from tool '{tool_name}': {e}. "
            "Wrapper will work but may have incomplete metadata."
        )
    
    return wrapper  # type: ignore[return-value]


def create_approval_aware_tool_wrapper(
    tool_name: str,
    middleware_instance: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    mcp_server_name: str = "",
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create a wrapper that checks approval before executing an MCP tool.
    
    This function creates an approval-aware wrapper for HITL (human-in-the-loop)
    approval flow. When approval is required, the wrapper calls interrupt() to
    pause execution and wait for user approval before proceeding.
    
    The generated wrapper:
    1. Checks if the tool requires approval using the approval_checker
    2. If approval required: calls interrupt() with approval request payload
    3. Handles the resume response (approve/skip/reject)
    4. If approved or no approval needed: executes the actual MCP tool
    5. Returns the tool result or skip message
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance with cached tools
        approval_checker: Optional callable that checks if tool requires approval.
            Signature: (tool_name, tool_args) -> ApprovalRequirement
            If None, tool executes without approval check.
        mcp_server_name: Name of the MCP server providing this tool (for context)
        sub_agent_name: Name of the sub-agent if this tool is used by a sub-agent.
            When non-empty, the interrupt payload includes from_sub_agent=True.
        
    Returns:
        A @tool decorated function that checks approval before executing
        
    Raises:
        RuntimeError: If tool metadata cannot be copied from original
        ToolExecutionRejectedError: If user rejects tool execution
        
    Example:
        >>> from graphton.core.tool_wrappers import (
        ...     create_approval_aware_tool_wrapper,
        ...     ApprovalRequirement,
        ... )
        >>> 
        >>> def my_checker(tool_name: str, args: dict) -> ApprovalRequirement:
        ...     if tool_name == "delete_resource":
        ...         return ApprovalRequirement(
        ...             requires_approval=True,
        ...             message="Delete operation requires approval",
        ...         )
        ...     return ApprovalRequirement(requires_approval=False)
        >>> 
        >>> wrapper = create_approval_aware_tool_wrapper(
        ...     "delete_resource",
        ...     middleware,
        ...     approval_checker=my_checker,
        ... )
        >>> # When invoked, will pause for approval before executing

    """
    # Pre-validate that tool exists in middleware cache
    # This will raise clear error if tool not found
    try:
        actual_tool = middleware_instance.get_tool(tool_name)
    except (RuntimeError, ValueError) as e:
        logger.error(f"Failed to create approval-aware wrapper for '{tool_name}': {e}")
        raise RuntimeError(
            f"Cannot create approval-aware wrapper for tool '{tool_name}': {e}"
        ) from e
    
    # Create the approval-aware wrapper function
    @tool
    async def approval_wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        """Auto-generated approval-aware wrapper for MCP tool.
        
        This wrapper:
        - Checks if approval is required before execution
        - Calls interrupt() if approval needed
        - Handles approve/skip/reject decisions
        - Executes the actual MCP tool if approved
        """
        logger.debug(f"Invoking MCP tool '{tool_name}' (approval-aware mode)")
        
        # Unwrap double-nested arguments if present
        actual_args = kwargs
        if isinstance(kwargs, dict):
            if len(kwargs) == 1 and 'input' in kwargs:
                logger.debug(f"Unwrapping 'input' key for '{tool_name}'")
                actual_args = kwargs['input']
            elif len(kwargs) == 1 and 'kwargs' in kwargs:
                logger.debug(f"Unwrapping 'kwargs' key for '{tool_name}'")
                actual_args = kwargs['kwargs']
        
        # Check if approval is required using the shared approval handler
        # This handles interrupt/resume for HITL flow
        is_sub_agent = bool(sub_agent_name)
        skip_result = _check_and_handle_approval(
            tool_name=tool_name,
            tool_args=actual_args,
            approval_checker=approval_checker,
            mcp_server=mcp_server_name,
            from_sub_agent=is_sub_agent,
            sub_agent_name=sub_agent_name if is_sub_agent else "",
        )
        if skip_result is not None:
            return skip_result
        
        # Execute the actual tool (either no approval needed, or user approved)
        try:
            mcp_tool = middleware_instance.get_tool(tool_name)
        except (RuntimeError, ValueError) as e:
            logger.error(f"Failed to get tool '{tool_name}' from cache: {e}")
            raise RuntimeError(
                f"Tool '{tool_name}' not available. "
                "Ensure middleware loaded tools successfully."
            ) from e
        
        # Invoke the actual MCP tool
        try:
            logger.info(f"Executing MCP tool '{tool_name}'")
            result = await mcp_tool.ainvoke(actual_args)
            logger.info(f"MCP tool '{tool_name}' completed successfully")
            return result
        except Exception as e:
            cause = _unwrap_exception(e)
            logger.error(
                f"MCP tool '{tool_name}' invocation failed: {cause}",
                exc_info=True,
            )
            raise RuntimeError(
                f"MCP tool '{tool_name}' invocation failed: {cause}"
            ) from e
    
    # Copy metadata from original tool for better LangChain integration
    try:
        approval_wrapper.name = tool_name  # type: ignore[attr-defined]
        approval_wrapper.description = actual_tool.description  # type: ignore[attr-defined]
        
        if hasattr(actual_tool, 'args_schema'):
            approval_wrapper.args_schema = actual_tool.args_schema  # type: ignore[attr-defined]
        
        logger.debug(
            f"Created approval-aware wrapper for MCP tool '{tool_name}' "
            f"(approval_checker={'enabled' if approval_checker else 'disabled'})"
        )
        
    except Exception as e:
        logger.warning(
            f"Failed to copy metadata from tool '{tool_name}': {e}. "
            "Wrapper will work but may have incomplete metadata."
        )
    
    return approval_wrapper  # type: ignore[return-value]


def create_lazy_tool_wrapper(
    tool_name: str,
    middleware_instance: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create a lazy wrapper for an MCP tool in dynamic mode.
    
    Unlike create_tool_wrapper, this function does NOT attempt to access the
    tool during wrapper creation. Instead, it creates a placeholder that resolves
    the actual tool on first invocation. This allows graphs to be created at module
    import time even when MCP tools aren't loaded yet (dynamic authentication).
    
    The generated wrapper:
    1. On first invocation: Gets the actual tool from middleware (now loaded)
    2. Invokes the tool with provided arguments
    3. Returns the tool result
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance (tools loaded at runtime)
        
    Returns:
        A @tool decorated function that lazily resolves to the MCP tool
        
    Example:
        >>> from graphton.core.middleware import McpToolsLoader
        >>> from graphton.core.tool_wrappers import create_lazy_tool_wrapper
        >>> 
        >>> # Create wrapper before tools are loaded (OK in lazy mode)
        >>> middleware = McpToolsLoader(servers, tool_filter)
        >>> wrapper = create_lazy_tool_wrapper("list_organizations", middleware)
        >>> 
        >>> # Later, when agent is invoked with config:
        >>> # middleware.before_agent() loads tools
        >>> # wrapper() now works because tools are loaded
        >>> result = wrapper()
    
    """
    # Create the lazy wrapper function
    # Note: We do NOT access middleware_instance.get_tool() here
    # That would fail in dynamic mode since tools aren't loaded yet
    @tool
    async def lazy_wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        """Auto-generated lazy wrapper for MCP tool (dynamic mode).
        
        This wrapper:
        - Resolves the actual tool on first invocation (after middleware loads it)
        - Invokes the tool with arguments
        - Returns the result
        """
        logger.debug(f"Invoking MCP tool '{tool_name}' (lazy mode)")
        
        # NOW get the actual MCP tool from middleware cache
        # At this point, middleware.before_agent() has run and loaded tools
        try:
            mcp_tool = middleware_instance.get_tool(tool_name)
        except (RuntimeError, ValueError) as e:
            logger.error(
                f"Failed to get tool '{tool_name}' from cache in lazy mode: {e}. "
                f"This likely means middleware.before_agent() hasn't been called yet."
            )
            raise RuntimeError(
                f"Tool '{tool_name}' not available. "
                "Ensure middleware loaded tools successfully before invoking."
            ) from e
        
        # Invoke the actual MCP tool with provided arguments
        try:
            actual_args = kwargs
            if isinstance(kwargs, dict):
                if len(kwargs) == 1 and 'input' in kwargs:
                    logger.debug(f"Unwrapping 'input' key for '{tool_name}' (lazy)")
                    actual_args = kwargs['input']
                elif len(kwargs) == 1 and 'kwargs' in kwargs:
                    logger.debug(f"Unwrapping 'kwargs' key for '{tool_name}' (lazy)")
                    actual_args = kwargs['kwargs']

            logger.debug(f"Calling mcp_tool.ainvoke() for '{tool_name}' (lazy)")
            result = await mcp_tool.ainvoke(actual_args)
            logger.debug(f"MCP tool '{tool_name}' returned successfully (lazy)")
            return result
        except Exception as e:
            cause = _unwrap_exception(e)
            logger.error(
                f"MCP tool '{tool_name}' invocation failed (lazy): {cause}",
                exc_info=True,
            )
            raise RuntimeError(
                f"MCP tool '{tool_name}' invocation failed: {cause}"
            ) from e
    
    # Set basic metadata for the lazy wrapper
    # We can't copy from actual tool yet (not loaded), so use minimal metadata
    try:
        lazy_wrapper.name = tool_name  # type: ignore[attr-defined]
        lazy_wrapper.description = (  # type: ignore[attr-defined]
            f"MCP tool '{tool_name}' (loaded dynamically at invocation)"
        )
        
        logger.debug(
            f"Created lazy wrapper for MCP tool '{tool_name}' (dynamic mode). "
            "Tool will be resolved on first invocation."
        )
        
    except Exception as e:
        logger.warning(
            f"Failed to set metadata on lazy wrapper for '{tool_name}': {e}. "
            "Wrapper will still work."
        )
    
    return lazy_wrapper  # type: ignore[return-value]


def create_tool_wrappers_for_server(
    server_name: str,
    tool_names: list[str],
    middleware_instance: Any,  # noqa: ANN401
) -> list[Callable[..., Any]]:
    """Create wrapper functions for all tools from an MCP server.
    
    Convenience function to create multiple wrappers at once.
    
    Args:
        server_name: Name of the MCP server (for logging)
        tool_names: List of tool names to create wrappers for
        middleware_instance: McpToolsLoader instance with cached tools
        
    Returns:
        List of wrapper functions
        
    Raises:
        RuntimeError: If any wrapper fails to be created
        
    Example:
        >>> wrappers = create_tool_wrappers_for_server(
        ...     "planton-cloud",
        ...     ["list_organizations", "create_cloud_resource"],
        ...     middleware
        ... )
        >>> len(wrappers)
        2

    """
    wrappers = []
    
    for tool_name in tool_names:
        try:
            wrapper = create_tool_wrapper(tool_name, middleware_instance)
            wrappers.append(wrapper)
        except Exception as e:
            logger.error(
                f"Failed to create wrapper for '{tool_name}' from server '{server_name}': {e}"
            )
            raise RuntimeError(
                f"Failed to create tool wrappers for server '{server_name}': {e}"
            ) from e
    
    logger.info(
        f"Created {len(wrappers)} tool wrapper(s) for server '{server_name}': "
        f"{tool_names}"
    )
    
    return wrappers


# =============================================================================
# Platform Tool Wrappers (for sandbox/filesystem tools)
# =============================================================================


def create_platform_tool_wrappers(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
) -> list[Callable[..., Any]]:
    """Create approval-aware wrappers for platform tools (sandbox/filesystem tools).
    
    This function creates LangChain-compatible tool wrappers for all 7 platform tools
    that delegate to a backend (FilesystemBackend, DaytonaBackend, etc.).
    
    Platform tools are divided into two categories:
    
    **Safe tools** (read-only operations, no approval needed by default):
    - read: Read file contents
    - ls: List directory contents
    - glob: Find files by pattern
    - grep: Search file contents
    
    **Dangerous tools** (write/execute operations, require approval by default):
    - write: Write content to a file
    - edit: Edit a file by replacing text
    - execute: Execute shell commands
    
    **Aliases** (override deepagents' in-memory tools with filesystem-backed ones):
    - read_file: Alias for read (overrides deepagents' in-memory read_file)
    - write_file: Alias for write (overrides deepagents' in-memory write_file)
    - edit_file: Alias for edit (overrides deepagents' in-memory edit_file)
    
    When approval_checker is provided, the dangerous tool wrappers check if approval
    is required before executing, using the same interrupt/resume pattern as MCP tools.
    Safe tools may also be configured to require approval via the approval_checker.
    
    Args:
        backend: Backend instance with methods like read(), write(), execute(),
            list_files(). Must implement the backend protocol.
        approval_checker: Optional callable that checks if tool requires approval.
            Signature: (tool_name, tool_args) -> ApprovalRequirement
            If None, tools execute without approval check.
        
    Returns:
        List of 10 @tool decorated functions for platform tools (7 primary + 3 aliases)
        
    Example:
        >>> from graphton.core.sandbox_factory import create_sandbox_backend
        >>> from graphton.core.tool_wrappers import create_platform_tool_wrappers
        >>> 
        >>> backend = create_sandbox_backend({"type": "filesystem", "root_dir": "/workspace"})
        >>> tools = create_platform_tool_wrappers(backend, approval_checker=my_checker)
        >>> # tools contains: read, ls, glob, grep, write, edit, execute,
        >>> #                  read_file, write_file, edit_file
        >>> len(tools)
        10
    
    """
    tools: list[Callable[..., Any]] = []
    
    # =========================================================================
    # Safe tools (read-only operations, no approval needed by default)
    # =========================================================================
    
    # read: Read file contents
    tools.append(_create_read_tool(backend, approval_checker))
    
    # ls: List directory contents
    tools.append(_create_ls_tool(backend))
    
    # glob: Find files by pattern
    tools.append(_create_glob_tool(backend))
    
    # grep: Search file contents
    tools.append(_create_grep_tool(backend))
    
    # =========================================================================
    # Dangerous tools (write/execute operations, require approval by default)
    # =========================================================================
    
    # write: Write content to file
    tools.append(_create_write_tool(backend, approval_checker))
    
    # edit: Edit file by replacing text
    tools.append(_create_edit_tool(backend, approval_checker))
    
    # execute: Execute shell commands
    tools.append(_create_execute_tool(backend, approval_checker))
    
    # =========================================================================
    # Aliases matching deepagents tool names (read_file, write_file, edit_file)
    # =========================================================================
    #
    # deepagents 0.4.x internally creates its own FilesystemMiddleware with an
    # in-memory StateBackend, registering tools named read_file, write_file,
    # edit_file.  Those in-memory tools do NOT have access to files written to
    # the real filesystem (e.g. skills written by SkillWriter).
    #
    # By registering our own filesystem-backed tools with the SAME names, we
    # ensure that LangChain's ToolNode resolves to our versions (explicit tools
    # take precedence over middleware-created tools).  This eliminates the tool
    # selection conflict regardless of which name the LLM picks.
    
    # read_file alias -> same filesystem backend as "read"
    read_file_alias = _create_read_tool(backend, approval_checker)
    read_file_alias.name = "read_file"  # type: ignore[attr-defined]
    tools.append(read_file_alias)
    
    # write_file alias -> same filesystem backend as "write"
    write_file_alias = _create_write_tool(backend, approval_checker)
    write_file_alias.name = "write_file"  # type: ignore[attr-defined]
    tools.append(write_file_alias)
    
    # edit_file alias -> same filesystem backend as "edit"
    edit_file_alias = _create_edit_tool(backend, approval_checker)
    edit_file_alias.name = "edit_file"  # type: ignore[attr-defined]
    tools.append(edit_file_alias)
    
    tool_names = [getattr(t, 'name', 'unknown') for t in tools]
    logger.info(
        f"Created {len(tools)} platform tool wrapper(s): {tool_names} "
        f"(approval_checker={'enabled' if approval_checker else 'disabled'})"
    )
    
    return tools


def _check_and_handle_approval(
    tool_name: str,
    tool_args: dict[str, Any],
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None,
    mcp_server: str = "__platform__",
    from_sub_agent: bool = False,
    sub_agent_name: str = "",
) -> str | None:
    """Unified approval handling for both MCP and platform tools.
    
    This function checks if a tool requires approval and handles the interrupt/resume
    flow for HITL (human-in-the-loop) approval. It is used by both MCP tool wrappers
    and platform tool wrappers to ensure consistent approval behavior.
    
    If approval is required, calls interrupt() and handles the response.
    
    Args:
        tool_name: Name of the tool
        tool_args: Arguments passed to the tool
        approval_checker: Optional approval checker function.
            Signature: (tool_name, tool_args) -> ApprovalRequirement
            If None, returns None immediately (no approval check).
        mcp_server: Name of the MCP server providing this tool.
            Use "__platform__" for platform/sandbox tools.
        from_sub_agent: True if this tool is being invoked by a sub-agent.
        sub_agent_name: Name of the sub-agent if from_sub_agent is True.
        
    Returns:
        - None: No approval needed OR user approved - proceed with execution
        - str: Skip message - return this instead of executing the tool
        
    Raises:
        ToolExecutionRejectedError: If user rejected the tool execution
        RuntimeError: If langgraph is not available for HITL support
        
    Example:
        >>> # For platform tools
        >>> skip_msg = _check_and_handle_approval("write", {"path": "foo.txt"}, checker)
        >>> if skip_msg:
        ...     return skip_msg  # User skipped
        >>> # Proceed with execution...
        
        >>> # For MCP tools with sub-agent context
        >>> skip_msg = _check_and_handle_approval(
        ...     "delete_file", args, checker,
        ...     mcp_server="filesystem",
        ...     from_sub_agent=True,
        ...     sub_agent_name="code_assistant"
        ... )
    
    """
    if approval_checker is None:
        return None
    
    requirement = approval_checker(tool_name, tool_args)
    
    if not requirement.requires_approval:
        return None
    
    # Determine effective MCP server (use requirement's if available, else parameter)
    effective_server = requirement.mcp_server or mcp_server
    
    context_info = f"sub_agent={sub_agent_name}" if from_sub_agent else "main_agent"
    logger.info(
        f"🔐 Tool '{tool_name}' requires approval "
        f"(source={requirement.source}, server={effective_server}, context={context_info})"
    )
    
    # Import interrupt here to avoid circular imports
    # and to only require langgraph when actually using HITL
    try:
        from langgraph.types import interrupt
    except ImportError as e:
        logger.error(
            "langgraph.types.interrupt not available. "
            "Ensure langgraph>=0.2.0 is installed for HITL support."
        )
        raise RuntimeError(
            "HITL approval flow requires langgraph>=0.2.0. "
            f"Import error: {e}"
        ) from e
    
    # Prepare approval request payload
    approval_request = {
        "tool_name": tool_name,
        "tool_args": tool_args,
        "message": requirement.message,
        "mcp_server": effective_server,
        "source": requirement.source,
        "from_sub_agent": from_sub_agent,
        "sub_agent_name": sub_agent_name if from_sub_agent else "",
    }
    
    logger.info(
        f"⏸️  Interrupting execution for approval: "
        f"tool={tool_name}, context={context_info}, message={requirement.message[:100]}..."
    )
    
    # Call interrupt() - this checkpoints state and pauses execution
    # Resume will provide the decision as the return value
    response = interrupt(approval_request)
    
    # Handle the approval decision from resume
    action = response.get("action", "").lower() if isinstance(response, dict) else ""
    approved_by = response.get("approved_by", "") if isinstance(response, dict) else ""
    
    logger.info(
        f"📋 Received approval decision for '{tool_name}': "
        f"action={action}, approved_by={approved_by}"
    )
    
    if action == "skip":
        skip_message = (
            f"Tool '{tool_name}' was skipped by user. "
            "Please proceed without this operation."
        )
        logger.info(f"⏭️  {skip_message}")
        return skip_message
    
    elif action == "reject":
        logger.warning(f"❌ User rejected execution of '{tool_name}'")
        raise ToolExecutionRejectedError(
            tool_name=tool_name,
            message=f"User rejected execution of tool '{tool_name}'",
        )
    
    elif action == "approve":
        logger.info(f"✅ User approved execution of '{tool_name}'")
        return None  # Proceed with execution
    
    else:
        # Unknown action - treat as rejection for safety
        logger.warning(
            f"⚠️  Unknown approval action '{action}' for '{tool_name}'. "
            "Treating as rejection for safety."
        )
        raise ToolExecutionRejectedError(
            tool_name=tool_name,
            message=f"Unknown approval action '{action}'. Execution rejected.",
        )


def _create_read_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
) -> Callable[..., Any]:
    """Create approval-aware read tool wrapper.
    
    Args:
        backend: Backend instance with read() method
        approval_checker: Optional approval checker
        
    Returns:
        @tool decorated function for reading files
    """
    @tool
    async def read(path: str) -> str:
        """Read file contents from the workspace.
        
        Args:
            path: Relative path to the file within the workspace
            
        Returns:
            File contents as string
        """
        tool_args = {"path": path}
        
        # Check approval (read is typically auto-approved but respects config)
        skip_result = _check_and_handle_approval("read", tool_args, approval_checker)
        if skip_result is not None:
            return skip_result
        
        # Execute the read operation
        try:
            logger.info("GRAPHTON read tool invoked for path: %s", path)
            result = backend.read(path)
            logger.info("GRAPHTON read tool succeeded for path: %s (%d chars)", path, len(result))
            return result
        except Exception as e:
            logger.warning(f"⚠️  read tool failed for '{path}': {e}")
            return enrich_error_message("read", str(e))
    
    read.name = "read"  # type: ignore[attr-defined]
    return read  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Write-tool streaming helpers
# ---------------------------------------------------------------------------

# Files shorter than this threshold are emitted as a single chunk (no
# artificial delay). Keeps trivial writes snappy.
_WRITE_STREAMING_THRESHOLD = 15

# Target number of streaming chunks for larger files. Combined with
# _WRITE_CHUNK_DELAY_S this controls the total visual streaming duration
# (~1 second regardless of file size).
_WRITE_TARGET_CHUNKS = 20

# Seconds to sleep between emitting chunks. This yields control to the
# asyncio event loop so the StatusBuilder can process each tool_progress
# event and the StreamingUpdateScheduler can push gRPC updates.
_WRITE_CHUNK_DELAY_S = 0.05


async def _stream_write_content(content: str) -> None:
    """Emit file content progressively via tool_progress events.

    For small files (< ``_WRITE_STREAMING_THRESHOLD`` lines) the entire
    content is dispatched as a single chunk — no delay is introduced.

    For larger files the content is split into line-based chunks whose size
    is adaptive: ``max(3, total_lines // _WRITE_TARGET_CHUNKS)``.  A short
    ``asyncio.sleep`` between chunks yields to the event loop so intermediate
    updates reach the TUI and the user sees a live typewriter effect.

    The ``StatusBuilder._handle_tool_progress_event`` handler on the backend
    appends each chunk to ``tool_call.result`` and sets ``is_streaming=True``.
    When the tool completes, ``_handle_tool_end_event`` replaces the
    accumulated content with the final return value and clears the flag.
    """
    lines = content.split("\n")
    total_lines = len(lines)

    if total_lines < _WRITE_STREAMING_THRESHOLD:
        # Small file — one shot, no delay.
        dispatch_custom_event("tool_progress", {"chunk": content})
        return

    chunk_size = max(3, total_lines // _WRITE_TARGET_CHUNKS)

    for i in range(0, total_lines, chunk_size):
        chunk_lines = lines[i : i + chunk_size]
        chunk = "\n".join(chunk_lines)

        # After the first chunk, prepend a newline so successive chunks
        # concatenate cleanly when the StatusBuilder appends them.
        if i > 0:
            chunk = "\n" + chunk

        dispatch_custom_event("tool_progress", {"chunk": chunk})

        # Yield between chunks (skip after the final one — nothing to
        # wait for and it avoids a needless 50ms tail).
        if i + chunk_size < total_lines:
            await asyncio.sleep(_WRITE_CHUNK_DELAY_S)


def _create_write_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
) -> Callable[..., Any]:
    """Create approval-aware write tool wrapper.
    
    Args:
        backend: Backend instance with write() method
        approval_checker: Optional approval checker
        
    Returns:
        @tool decorated function for writing files
    """
    @tool
    async def write(path: str, content: str) -> str:
        """Write content to a file in the workspace.
        
        Args:
            path: Relative path to the file within the workspace
            content: Content to write to the file
            
        Returns:
            Confirmation message
        """
        tool_args = {"path": path, "content": content}
        
        # Check approval (write typically requires approval)
        skip_result = _check_and_handle_approval("write", tool_args, approval_checker)
        if skip_result is not None:
            return skip_result
        
        # Execute the write operation
        try:
            logger.info(f"📝 Writing file: {path} ({len(content)} chars)")
            
            # Stream content progressively so the TUI shows a live
            # typewriter effect while the file is being written. The
            # streaming pipeline (StatusBuilder -> gRPC -> TUI) already
            # handles tool_progress events: chunks accumulate in
            # tool_call.result with is_streaming=True, the scheduler
            # pushes gRPC updates every ~500ms, and renderStreamingTool()
            # displays the latest lines with a cursor indicator.
            await _stream_write_content(content)
            
            backend.write(path, content)
            logger.info(f"✅ Wrote file '{path}'")
            return f"Successfully wrote {len(content)} characters to '{path}'"
        except Exception as e:
            logger.warning(f"⚠️  write tool failed for '{path}': {e}")
            return enrich_error_message("write", str(e))
    
    write.name = "write"  # type: ignore[attr-defined]
    return write  # type: ignore[return-value]


def _create_execute_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
) -> Callable[..., Any]:
    """Create approval-aware execute tool wrapper.
    
    Args:
        backend: Backend instance with execute() method
        approval_checker: Optional approval checker
        
    Returns:
        @tool decorated function for executing shell commands
    """
    @tool
    async def execute(command: str, timeout: int = 120) -> str:
        """Execute a shell command in the workspace.
        
        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds (default: 120)
            
        Returns:
            Command output (stdout + stderr combined)
        """
        tool_args = {"command": command, "timeout": timeout}
        
        # Check approval (execute typically requires approval)
        skip_result = _check_and_handle_approval("execute", tool_args, approval_checker)
        if skip_result is not None:
            return skip_result
        
        # Execute the command
        try:
            logger.info(f"🔧 Executing command: {command[:100]}...")
            
            # Emit progress event so the UI shows the command being executed.
            # dispatch_custom_event inherits the current tool's run_id, which
            # the StatusBuilder uses to correlate with the correct ToolCall.
            dispatch_custom_event(
                "tool_progress",
                {"chunk": f"$ {command}\n"},
            )
            
            result = backend.execute(command, timeout=timeout)
            
            # Format output
            output_parts = []
            if result.stdout:
                output_parts.append(f"STDOUT:\n{result.stdout}")
            if result.stderr:
                output_parts.append(f"STDERR:\n{result.stderr}")
            output = "\n".join(output_parts) if output_parts else "(no output)"
            
            if result.exit_code == 0:
                logger.info("✅ Command completed successfully")
            else:
                logger.warning(f"⚠️  Command exited with code {result.exit_code}")
            
            return f"Exit code: {result.exit_code}\n{output}"
        except Exception as e:
            logger.warning(f"⚠️  execute tool failed: {e}")
            return enrich_error_message("execute", str(e))
    
    execute.name = "execute"  # type: ignore[attr-defined]
    return execute  # type: ignore[return-value]


def _create_edit_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
) -> Callable[..., Any]:
    """Create approval-aware edit tool wrapper.
    
    The edit tool performs a text replacement in a file. It reads the file,
    replaces the first occurrence of old_text with new_text, and writes back.
    
    This is a DANGEROUS operation that requires approval by default.
    
    Args:
        backend: Backend instance with read() and write() methods
        approval_checker: Optional approval checker
        
    Returns:
        @tool decorated function for editing files
    """
    @tool
    async def edit(path: str, old_text: str, new_text: str) -> str:
        """Edit a file by replacing text.
        
        Finds the first occurrence of old_text in the file and replaces it
        with new_text. The file must exist and contain the old_text.
        
        Args:
            path: Relative path to the file within the workspace
            old_text: Text to find and replace (must exist in file)
            new_text: Text to replace old_text with
            
        Returns:
            Confirmation message with change details
            
        Raises:
            ValueError: If old_text is not found in the file
            RuntimeError: If file operations fail
        """
        tool_args = {"path": path, "old_text": old_text, "new_text": new_text}
        
        # Check approval (edit is dangerous - requires approval by default)
        skip_result = _check_and_handle_approval("edit", tool_args, approval_checker)
        if skip_result is not None:
            return skip_result
        
        # Execute the edit operation
        try:
            logger.info(f"✏️  Editing file: {path}")
            
            # Read current content
            content = backend.read(path)
            
            # Verify old_text exists
            if old_text not in content:
                error_msg = f"Text to replace not found in '{path}'"
                logger.warning(f"⚠️  {error_msg}")
                return enrich_error_message("edit", error_msg)
            
            # Replace first occurrence only
            new_content = content.replace(old_text, new_text, 1)
            
            # Write back
            backend.write(path, new_content)
            
            logger.info(f"✅ Edited file '{path}'")
            return (
                f"Successfully edited '{path}': "
                f"replaced {len(old_text)} chars with {len(new_text)} chars"
            )
        except Exception as e:
            logger.warning(f"⚠️  edit tool failed for '{path}': {e}")
            return enrich_error_message("edit", str(e))
    
    edit.name = "edit"  # type: ignore[attr-defined]
    return edit  # type: ignore[return-value]


def _create_ls_tool(
    backend: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create ls (list files) tool wrapper.
    
    This is a SAFE read-only operation that does not require approval.
    
    Args:
        backend: Backend instance with list_files() method
        
    Returns:
        @tool decorated function for listing directory contents
    """
    @tool
    async def ls(path: str = ".") -> str:
        """List files and directories in the workspace.
        
        Args:
            path: Relative path to the directory (default: current directory)
            
        Returns:
            Newline-separated list of files and directories
        """
        try:
            logger.debug(f"📂 Listing directory: {path}")
            files = backend.list_files(path)
            
            if not files:
                logger.debug(f"Directory '{path}' is empty")
                return f"Directory '{path}' is empty"
            
            logger.debug(f"✅ Listed {len(files)} items in '{path}'")
            return "\n".join(files)
        except Exception as e:
            logger.warning(f"⚠️  ls tool failed for '{path}': {e}")
            return enrich_error_message("ls", str(e))
    
    ls.name = "ls"  # type: ignore[attr-defined]
    return ls  # type: ignore[return-value]


def _create_glob_tool(
    backend: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create glob (pattern matching) tool wrapper.
    
    This is a SAFE read-only operation that does not require approval.
    Uses Python's glob module for pattern matching.
    
    Args:
        backend: Backend instance (used to get workspace root if available)
        
    Returns:
        @tool decorated function for finding files by pattern
    """
    import fnmatch
    import os

    _GLOB_MAX_DEPTH = 15
    
    @tool
    async def glob(pattern: str, path: str = ".") -> str:
        """Find files matching a glob pattern.
        
        Recursively searches for files matching the pattern.
        Supports standard glob patterns: *, ?, [seq], [!seq], **
        
        Args:
            pattern: Glob pattern to match (e.g., "*.py", "**/*.txt")
            path: Starting directory for the search (default: current directory)
            
        Returns:
            Newline-separated list of matching file paths
        """
        try:
            logger.debug(f"🔍 Searching for pattern '{pattern}' in '{path}'")
            
            all_files: list[str] = []
            _has_is_dir = hasattr(backend, "is_directory")
            
            def collect_files(dir_path: str, depth: int = 0) -> None:
                if depth > _GLOB_MAX_DEPTH:
                    return
                try:
                    items = backend.list_files(dir_path)
                except Exception:
                    return
                for item in items:
                    item_path = os.path.join(dir_path, item) if dir_path != "." else item
                    item_path = item_path.replace("\\", "/")
                    all_files.append(item_path)
                    if _has_is_dir:
                        if backend.is_directory(item_path):
                            collect_files(item_path, depth + 1)
                    else:
                        try:
                            collect_files(item_path, depth + 1)
                        except NotADirectoryError:
                            pass
            
            collect_files(path)
            
            # Filter by glob pattern
            # Handle ** for recursive matching
            if "**" in pattern:
                # Use fnmatch with the full path
                matches = [f for f in all_files if fnmatch.fnmatch(f, pattern)]
            else:
                # Match just the filename
                matches = [f for f in all_files if fnmatch.fnmatch(os.path.basename(f), pattern)]
            
            if not matches:
                logger.debug(f"No files matching '{pattern}'")
                return f"No files matching pattern '{pattern}'"
            
            logger.debug(f"✅ Found {len(matches)} files matching '{pattern}'")
            return "\n".join(sorted(matches))
        except Exception as e:
            logger.warning(f"⚠️  glob tool failed for pattern '{pattern}': {e}")
            return enrich_error_message("glob", str(e))
    
    glob.name = "glob"  # type: ignore[attr-defined]
    return glob  # type: ignore[return-value]


def _create_grep_tool(
    backend: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create grep (search content) tool wrapper.
    
    This is a SAFE read-only operation that does not require approval.
    Searches file contents for a pattern using regular expressions.
    
    Args:
        backend: Backend instance with read() and list_files() methods
        
    Returns:
        @tool decorated function for searching file contents
    """
    import os
    import re

    _GREP_MAX_DEPTH = 15
    
    @tool
    async def grep(pattern: str, path: str = ".", include: str = "*") -> str:
        """Search for a pattern in file contents.
        
        Recursively searches files for lines matching the pattern.
        Returns matching lines with file paths and line numbers.
        
        Args:
            pattern: Regular expression pattern to search for
            path: Starting directory for the search (default: current directory)
            include: Glob pattern to filter which files to search (default: all files)
            
        Returns:
            Matching lines in format: "filepath:line_number:line_content"
        """
        import fnmatch
        
        try:
            logger.debug(f"🔎 Searching for '{pattern}' in '{path}' (include={include})")
            
            try:
                regex = re.compile(pattern)
            except re.error as e:
                return f"Invalid regex pattern '{pattern}': {e}"
            
            results: list[str] = []
            files_searched = 0
            max_results = 1000
            _has_is_dir = hasattr(backend, "is_directory")
            
            def search_file(file_path: str) -> None:
                nonlocal files_searched
                if not fnmatch.fnmatch(os.path.basename(file_path), include):
                    return
                try:
                    content = backend.read(file_path)
                    files_searched += 1
                    for line_num, line in enumerate(content.splitlines(), 1):
                        if len(results) >= max_results:
                            return
                        if regex.search(line):
                            results.append(f"{file_path}:{line_num}:{line.rstrip()}")
                except Exception:
                    pass
            
            def collect_and_search(dir_path: str, depth: int = 0) -> None:
                if depth > _GREP_MAX_DEPTH:
                    return
                try:
                    items = backend.list_files(dir_path)
                except Exception:
                    return
                for item in items:
                    if len(results) >= max_results:
                        return
                    item_path = os.path.join(dir_path, item) if dir_path != "." else item
                    item_path = item_path.replace("\\", "/")

                    if _has_is_dir and backend.is_directory(item_path):
                        collect_and_search(item_path, depth + 1)
                    elif not _has_is_dir:
                        search_file(item_path)
                        try:
                            collect_and_search(item_path, depth + 1)
                        except NotADirectoryError:
                            pass
                    else:
                        search_file(item_path)
            
            collect_and_search(path)
            
            if not results:
                logger.debug(f"No matches for '{pattern}' in {files_searched} files")
                return f"No matches for pattern '{pattern}' in {files_searched} files searched"
            
            truncated = len(results) >= max_results
            summary = (
                f"Found {len(results)}{'+ (truncated)' if truncated else ''} matches "
                f"in {files_searched} files:"
            )
            logger.debug(f"✅ {summary}")
            
            return f"{summary}\n\n" + "\n".join(results)
        except Exception as e:
            logger.warning(f"⚠️  grep tool failed for pattern '{pattern}': {e}")
            return enrich_error_message("grep", str(e))
    
    grep.name = "grep"  # type: ignore[attr-defined]
    return grep  # type: ignore[return-value]

