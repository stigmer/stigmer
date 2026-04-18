"""Tool wrapper generator for MCP and platform tools.

This module dynamically creates @tool decorated wrapper functions for:

1. **MCP Tools**: Tools from MCP (Model Context Protocol) servers, loaded via middleware.
   The wrappers delegate to actual MCP tools loaded by the middleware.

2. **Platform Tools**: Sandbox/filesystem tools (read, write, edit, delete, execute, ls, glob, grep)
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

- **Dangerous tools** (require approval by default): write, edit, delete, execute
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
from typing import TYPE_CHECKING, Annotated, Any

from langchain_core.callbacks import dispatch_custom_event
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool

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
    3. Returns the tool result, or an enriched error string on failure
    
    Tool invocation errors (e.g. gRPC NotFound, permission denied) are
    returned as enriched error strings so the LLM can reason about them
    and self-correct.  Only setup errors (tool not found in middleware
    cache) raise.
    
    This eliminates the need to manually write wrapper functions for each MCP tool.
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance with cached tools
        
    Returns:
        A @tool decorated function that delegates to the MCP tool
        
    Raises:
        RuntimeError: If the tool does not exist in the middleware cache
            at wrapper creation time
        
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
            result_str = result if isinstance(result, str) else str(result)
            return truncate_tool_output(result_str, tool_name)
        except Exception as e:
            cause = _unwrap_exception(e)
            logger.warning(
                f"MCP tool '{tool_name}' invocation failed: {cause}",
                exc_info=True,
            )
            return enrich_error_message(tool_name, str(cause))
    
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


def _approval_tool_kwargs_to_actual_args(
    kwargs: dict[str, Any],
    *,
    tool_name: str,
    injected_keys: set[str] | frozenset[str] | None,
) -> Any:
    """Strip LangChain-injected keys, then unwrap legacy ``kwargs`` / ``input`` shells.

    ``InjectedToolCallId`` adds ``tool_call_id`` beside model args, so unwrapping must
    run on the non-injected subset only.

    When the MCP tool has no Pydantic schema, LangChain's ``@tool`` schema exposes a
    single ``kwargs`` bucket; tool arguments arrive as ``kwargs`` -> inner dict.  Nested
    ``input`` / ``kwargs`` wrappers (older call shapes) are peeled in a loop.
    """
    skip = set(injected_keys) if injected_keys else set()
    bare = {k: v for k, v in kwargs.items() if k not in skip}
    actual_args: Any = bare
    while isinstance(actual_args, dict) and len(actual_args) == 1:
        sole = next(iter(actual_args))
        if sole == "input":
            logger.debug(f"Unwrapping 'input' key for '{tool_name}'")
            actual_args = actual_args["input"]
        elif sole == "kwargs":
            logger.debug(f"Unwrapping 'kwargs' key for '{tool_name}'")
            actual_args = actual_args["kwargs"]
        else:
            break
    return actual_args


def _build_merged_schema(
    tool_name: str,
    actual_tool: Any,  # noqa: ANN401
    wrapper_tool: Any,  # noqa: ANN401
) -> type:
    """Build a Pydantic schema merging MCP tool params with InjectedToolCallId.

    The ``@tool`` decorator generates a schema that includes the
    ``InjectedToolCallId`` field — required for runtime injection.
    MCP tools carry their own ``args_schema`` describing the parameters
    the LLM should provide.  Naively overwriting ``args_schema`` on the
    wrapper destroys the injection metadata.

    This helper creates a new Pydantic model that contains **both** the
    MCP tool's fields (LLM-visible) and the ``InjectedToolCallId`` field
    (LLM-hidden, runtime-injected).  If the MCP tool has no usable
    schema, the wrapper's original schema is returned unchanged.
    """
    from pydantic import BaseModel, create_model

    mcp_schema = getattr(actual_tool, "args_schema", None)
    wrapper_schema = wrapper_tool.args_schema

    if mcp_schema is None:
        return wrapper_schema

    if not (isinstance(mcp_schema, type) and issubclass(mcp_schema, BaseModel)):
        return wrapper_schema

    mcp_fields: dict[str, Any] = {}
    for name, info in mcp_schema.model_fields.items():
        mcp_fields[name] = (info.annotation, info)

    injected_fields: dict[str, Any] = {}
    for name, info in wrapper_schema.model_fields.items():
        if name in (wrapper_tool._injected_args_keys or set()):
            injected_fields[name] = (info.annotation, info)

    if not injected_fields:
        return mcp_schema

    merged = create_model(
        f"{tool_name}_ApprovalSchema",
        **injected_fields,
        **mcp_fields,
    )
    return merged


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
    5. Returns the tool result, skip message, or enriched error string
    
    Tool invocation errors (e.g. gRPC NotFound, permission denied) are
    returned as enriched error strings so the LLM can reason about them
    and self-correct.  Only setup errors (tool not found in middleware
    cache) and deliberate user rejections raise.
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance with cached tools
        approval_checker: Optional callable that checks if tool requires approval.
            Signature: (tool_name, tool_args) -> ApprovalRequirement
            If None, tool executes without approval check.
        mcp_server_name: Name of the MCP server providing this tool (for context).
            Retained for streaming event metadata; not included in interrupt payloads.
        sub_agent_name: Name of the sub-agent if this tool is used by a sub-agent.
            Retained for streaming event metadata; not included in interrupt payloads.
        
    Returns:
        A @tool decorated function that checks approval before executing
        
    Raises:
        RuntimeError: If the tool does not exist in the middleware cache
            at wrapper creation time
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
    async def approval_wrapper(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        **kwargs: Any,
    ) -> Any:  # noqa: ANN401
        """Auto-generated approval-aware wrapper for MCP tool."""
        logger.debug(f"Invoking MCP tool '{tool_name}' (approval-aware mode)")

        injected = set(getattr(approval_wrapper, "_injected_args_keys", None) or ())
        actual_args = _approval_tool_kwargs_to_actual_args(
            kwargs,
            tool_name=tool_name,
            injected_keys=injected,
        )
        tool_args_for_approval: dict[str, Any] = (
            actual_args if isinstance(actual_args, dict) else {}
        )

        skip_result = _check_and_handle_approval(
            tool_name=tool_name,
            tool_args=tool_args_for_approval,
            approval_checker=approval_checker,
            tool_call_id=tool_call_id,
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
            result_str = result if isinstance(result, str) else str(result)
            return truncate_tool_output(result_str, tool_name)
        except Exception as e:
            cause = _unwrap_exception(e)
            logger.warning(
                f"MCP tool '{tool_name}' invocation failed: {cause}",
                exc_info=True,
            )
            return enrich_error_message(tool_name, str(cause))

    # Copy metadata from original tool for better LangChain integration.
    # IMPORTANT: We must NOT blindly copy args_schema — the @tool decorator
    # generated a schema that includes InjectedToolCallId, and overwriting it
    # would break tool_call_id injection.  Instead, we build a merged schema
    # that preserves both the MCP tool's parameters (LLM-visible) and the
    # InjectedToolCallId field (runtime-injected, LLM-hidden).
    try:
        approval_wrapper.name = tool_name  # type: ignore[attr-defined]
        approval_wrapper.description = actual_tool.description  # type: ignore[attr-defined]
        
        approval_wrapper.args_schema = _build_merged_schema(  # type: ignore[attr-defined]
            tool_name, actual_tool, approval_wrapper,
        )
        
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
        ...     "planton",
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


_ALIAS_DESCRIPTION_TEMPLATE = (
    "Internal override for '{canonical}'. Do not call directly "
    "-- use '{canonical}' instead (identical parameters and behavior)."
)


def _register_alias(
    factory: Callable[..., Any],
    alias_name: str,
    canonical_name: str,
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None,
    tools: list[Callable[..., Any]],
    sub_agent_name: str = "",
) -> None:
    """Register a tool alias that redirects the LLM to the canonical name.

    Creates a fully functional tool (same backend, same approval checking) but
    with a description that tells the LLM to prefer the canonical tool instead.
    The alias exists so that LangChain's ToolNode resolves to our approval-aware
    implementation even when the LLM (or deepagents middleware) uses the _file
    suffixed name.
    """
    alias_tool = factory(backend, approval_checker, sub_agent_name=sub_agent_name)
    alias_tool.name = alias_name  # type: ignore[attr-defined]
    alias_tool.description = _ALIAS_DESCRIPTION_TEMPLATE.format(  # type: ignore[attr-defined]
        canonical=canonical_name,
    )
    tools.append(alias_tool)


# =========================================================================
# Tool sets for built-in subagent types
#
# Each set lists the canonical platform tool names that the subagent type
# is allowed to use.  Tools not in the set are excluded entirely — the
# LLM never sees them, preventing accidental scope violations.
# =========================================================================

EXPLORE_TOOL_SET: frozenset[str] = frozenset({
    "read", "ls", "glob", "grep", "search",
})
"""Read-only tools for the explore subagent type."""

SHELL_TOOL_SET: frozenset[str] = frozenset({
    "read", "ls", "execute",
})
"""Minimal tools for the shell subagent type: execute + basic read."""

# Mapping from canonical tool name to its factory function name suffix.
# Used by create_filtered_platform_tools to selectively instantiate tools.
_TOOL_FACTORIES: dict[str, str] = {
    "read": "read",
    "ls": "ls",
    "glob": "glob",
    "grep": "grep",
    "search": "search",
    "write": "write",
    "edit": "edit",
    "delete": "delete",
    "execute": "execute",
}

# Aliases that should only be registered when their canonical tool is present.
_ALIAS_MAP: dict[str, tuple[str, str]] = {
    "read_file": ("read", "_create_read_tool"),
    "write_file": ("write", "_create_write_tool"),
    "edit_file": ("edit", "_create_edit_tool"),
    "delete_file": ("delete", "_create_delete_tool"),
}


def create_filtered_platform_tools(
    backend: Any,  # noqa: ANN401
    allowed_tools: frozenset[str] | set[str],
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> list[Callable[..., Any]]:
    """Create platform tools filtered to only allowed tool names.

    This function creates a restricted subset of platform tools for
    specialized subagent types (e.g. explore, shell). Only tools whose
    canonical names appear in *allowed_tools* are instantiated.  Aliases
    (read_file, write_file, etc.) are included only when their canonical
    tool is in the allowed set.

    Args:
        backend: Backend instance (FilesystemBackend, DaytonaBackend, etc.)
        allowed_tools: Set of canonical tool names to create (e.g. {"read", "ls", "grep"})
        approval_checker: Optional approval checker for HITL flow
        sub_agent_name: Name of the sub-agent using these tools

    Returns:
        List of @tool decorated functions for the allowed platform tools
    """
    factory_lookup: dict[str, Callable[..., Any]] = {
        "read": _create_read_tool,
        "ls": _create_ls_tool,
        "glob": _create_glob_tool,
        "grep": _create_grep_tool,
        "search": _create_search_tool,
        "write": _create_write_tool,
        "edit": _create_edit_tool,
        "delete": _create_delete_tool,
        "execute": _create_execute_tool,
    }

    safe_tools = {"read", "ls", "glob", "grep", "search"}
    dangerous_tools = {"write", "edit", "delete", "execute"}

    tools: list[Callable[..., Any]] = []

    for tool_name in allowed_tools:
        factory = factory_lookup.get(tool_name)
        if factory is None:
            logger.warning(
                "Unknown tool '%s' in allowed_tools for sub-agent '%s', skipping",
                tool_name, sub_agent_name,
            )
            continue

        if tool_name in safe_tools and tool_name not in {"read"}:
            tools.append(factory(backend))
        elif tool_name == "read":
            tools.append(factory(backend, approval_checker, sub_agent_name=sub_agent_name))
        elif tool_name in dangerous_tools:
            tools.append(factory(backend, approval_checker, sub_agent_name=sub_agent_name))

    # Register aliases for allowed canonical tools
    alias_factory_lookup: dict[str, Callable[..., Any]] = {
        "read": _create_read_tool,
        "write": _create_write_tool,
        "edit": _create_edit_tool,
        "delete": _create_delete_tool,
    }
    for alias_name, (canonical, _) in _ALIAS_MAP.items():
        if canonical in allowed_tools:
            _register_alias(
                alias_factory_lookup[canonical], alias_name, canonical,
                backend, approval_checker, tools,
                sub_agent_name=sub_agent_name,
            )

    tool_names_list = [getattr(t, "name", "unknown") for t in tools]
    logger.info(
        "Created %d filtered platform tool(s) for sub-agent '%s': %s",
        len(tools), sub_agent_name, tool_names_list,
    )

    return tools


def create_platform_tool_wrappers(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> list[Callable[..., Any]]:
    """Create approval-aware wrappers for platform tools (sandbox/filesystem tools).
    
    This function creates LangChain-compatible tool wrappers for all platform tools
    that delegate to a backend (FilesystemBackend, DaytonaBackend, etc.).
    
    Platform tools are divided into two categories:
    
    **Safe tools** (read-only operations, no approval needed by default):
    - read: Read file contents
    - ls: List directory contents
    - glob: Find files by pattern
    - grep: Search file contents
    - search: Find code definitions by concept/name (structural symbol search)
    
    **Dangerous tools** (write/execute operations, require approval by default):
    - write: Write content to a file
    - edit: Edit a file by replacing text
    - delete: Delete a file
    - execute: Execute shell commands
    
    **Aliases** (override deepagents' in-memory tools with filesystem-backed ones):
    - read_file: Alias for read (overrides deepagents' in-memory read_file)
    - write_file: Alias for write (overrides deepagents' in-memory write_file)
    - edit_file: Alias for edit (overrides deepagents' in-memory edit_file)
    - delete_file: Alias for delete
    
    When approval_checker is provided, the dangerous tool wrappers check if approval
    is required before executing, using the same interrupt/resume pattern as MCP tools.
    Safe tools may also be configured to require approval via the approval_checker.
    
    Args:
        backend: Backend instance with methods like read(), write(), delete(),
            execute(), list_files(). Must implement the backend protocol.
        approval_checker: Optional callable that checks if tool requires approval.
            Signature: (tool_name, tool_args) -> ApprovalRequirement
            If None, tools execute without approval check.
        
    Returns:
        List of 13 @tool decorated functions for platform tools (9 primary + 4 aliases)
        
    Example:
        >>> from graphton.core.sandbox_factory import create_sandbox_backend
        >>> from graphton.core.tool_wrappers import create_platform_tool_wrappers
        >>> 
        >>> backend = create_sandbox_backend({"type": "filesystem", "root_dir": "/workspace"})
        >>> tools = create_platform_tool_wrappers(backend, approval_checker=my_checker)
        >>> # tools contains: read, ls, glob, grep, search, write, edit, delete, execute,
        >>> #                  read_file, write_file, edit_file, delete_file
        >>> len(tools)
        13
    
    """
    tools: list[Callable[..., Any]] = []
    
    # =========================================================================
    # Safe tools (read-only operations, no approval needed by default)
    # =========================================================================
    
    # read: Read file contents
    tools.append(_create_read_tool(backend, approval_checker, sub_agent_name=sub_agent_name))
    
    # ls: List directory contents
    tools.append(_create_ls_tool(backend))
    
    # glob: Find files by pattern
    tools.append(_create_glob_tool(backend))
    
    # grep: Search file contents
    tools.append(_create_grep_tool(backend))
    
    # search: Structural symbol search (definitions by concept/name)
    tools.append(_create_search_tool(backend))
    
    # =========================================================================
    # Dangerous tools (write/execute operations, require approval by default)
    # =========================================================================
    
    # write: Write content to file
    tools.append(_create_write_tool(backend, approval_checker, sub_agent_name=sub_agent_name))
    
    # edit: Edit file by replacing text
    tools.append(_create_edit_tool(backend, approval_checker, sub_agent_name=sub_agent_name))
    
    # delete: Delete a file
    tools.append(_create_delete_tool(backend, approval_checker, sub_agent_name=sub_agent_name))
    
    # execute: Execute shell commands
    tools.append(_create_execute_tool(backend, approval_checker, sub_agent_name=sub_agent_name))
    
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
    #
    # Alias descriptions are set to redirect the LLM toward the canonical name
    # so it does not waste turns deliberating between duplicate tools.
    
    # =========================================================================
    # Git tools — REMOVED
    #
    # create_pull_request was previously exposed to the agent here. Now that
    # the platform owns the git write-back workflow (post-execution branch +
    # commit + push + PR via writeback.py), the agent no longer needs this
    # tool.  The underlying GitHub API logic in github_api.py is reused by
    # the platform write-back module directly.
    # =========================================================================

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
    #
    # Alias descriptions are set to redirect the LLM toward the canonical name
    # so it does not waste turns deliberating between duplicate tools.

    _register_alias(_create_read_tool, "read_file", "read", backend, approval_checker, tools, sub_agent_name=sub_agent_name)
    _register_alias(_create_write_tool, "write_file", "write", backend, approval_checker, tools, sub_agent_name=sub_agent_name)
    _register_alias(_create_edit_tool, "edit_file", "edit", backend, approval_checker, tools, sub_agent_name=sub_agent_name)
    _register_alias(_create_delete_tool, "delete_file", "delete", backend, approval_checker, tools, sub_agent_name=sub_agent_name)
    
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
    tool_call_id: str = "",
) -> str | None:
    """Unified approval handling for both MCP and platform tools.

    Checks if a tool requires approval and handles the interrupt/resume flow for
    HITL (human-in-the-loop) approval. Used by both MCP and platform tool wrappers.

    The interrupt payload carries only ``tool_call_id`` and ``message``. All display
    fields (tool_name, tool_args, mcp_server, sub_agent context) already exist on the
    ``ToolCall`` in ``messages[].tool_calls[]``, created before ``interrupt()`` fires.

    Args:
        tool_name: Name of the tool (used to call approval_checker and in user messages).
        tool_args: Arguments passed to the tool (used to call approval_checker).
        approval_checker: Optional function ``(tool_name, tool_args) -> ApprovalRequirement``.
            If None, returns None immediately (no approval check).
        tool_call_id: Model-assigned tool_call_id injected via ``InjectedToolCallId``.
            Used by ``InterruptCapture`` to directly match this interrupt to the
            corresponding ``ToolCall`` — no fuzzy matching needed.

    Returns:
        None if no approval needed or user approved (proceed with execution),
        or a str skip/reject message to return instead of executing the tool.

    Raises:
        RuntimeError: If langgraph is not available for HITL support.

    """
    if approval_checker is None:
        return None

    logger.info(
        f"[DIAG] _check_and_handle_approval entered: "
        f"tool={tool_name} tool_call_id={tool_call_id}"
    )

    requirement = approval_checker(tool_name, tool_args)

    if not requirement.requires_approval:
        return None

    logger.info(
        f"Tool '{tool_name}' requires approval "
        f"(source={requirement.source}, tool_call_id={tool_call_id})"
    )

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

    approval_request = {
        "tool_call_id": tool_call_id,
        "message": requirement.message,
    }

    logger.info(
        f"Interrupting execution for approval: "
        f"tool={tool_name}, tool_call_id={tool_call_id}, "
        f"message={requirement.message[:100]}..."
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
        reject_message = (
            f"Tool '{tool_name}' was REJECTED by the user. "
            "The user has explicitly indicated they do not want this operation. "
            "Do NOT retry this exact operation. "
            "Re-evaluate your approach and propose an alternative."
        )
        logger.info(f"❌ {reject_message}")
        return reject_message
    
    elif action == "approve":
        logger.info(f"✅ User approved execution of '{tool_name}'")
        return None  # Proceed with execution
    
    else:
        # Unknown action - treat as rejection for safety
        reject_message = (
            f"Tool '{tool_name}' received unknown approval action '{action}'. "
            "Treating as rejected for safety. "
            "Do NOT retry this exact operation. "
            "Re-evaluate your approach and propose an alternative."
        )
        logger.warning(
            f"⚠️  Unknown approval action '{action}' for '{tool_name}'. "
            "Treating as rejection for safety."
        )
        return reject_message


# =============================================================================
# Tool Output Size Limits
# =============================================================================
#
# LLMs do not benefit from unbounded tool output.  A `find` returning 47,000
# file paths or a `read` dumping a 2 MB log is noise, not signal.  These
# constants define a hard ceiling on what any single tool result may inject
# into the model's context window.
#
# The limit is expressed in characters (not tokens) because character length
# is available without calling a tokenizer, and the ratio of ~4 chars/token
# is stable enough for a safety threshold.
#
# Budget arithmetic (200K-token context window):
#   120,000 chars ≈ 30,000 tokens ≈ 15% of window per tool result.
#   Four parallel tool calls at max output ≈ 60% of window, leaving
#   room for system prompt, conversation history, and model response.

_MAX_TOOL_OUTPUT_CHARS: int = 120_000
"""Maximum characters returned by a single tool call to the LLM."""

_TRUNCATION_HEAD_LINES: int = 500
"""Lines kept from the beginning of truncated output."""

_TRUNCATION_TAIL_LINES: int = 100
"""Lines kept from the end of truncated output."""


def truncate_tool_output(
    output: str,
    tool_name: str,
    *,
    max_chars: int = _MAX_TOOL_OUTPUT_CHARS,
    head_lines: int = _TRUNCATION_HEAD_LINES,
    tail_lines: int = _TRUNCATION_TAIL_LINES,
) -> str:
    """Truncate tool output that exceeds the LLM context budget.

    When *output* fits within *max_chars* it is returned unchanged (fast
    path, no allocation).  Otherwise the text is split into lines and a
    head + tail window is returned with an informative notice in between.

    The notice tells the model how much was truncated and suggests
    strategies to narrow the query — the same behaviour an experienced
    developer uses when faced with overwhelming terminal output.

    Args:
        output: Raw tool result string.
        tool_name: Name of the tool that produced the output (for logging).
        max_chars: Character ceiling.  Defaults to ``_MAX_TOOL_OUTPUT_CHARS``.
        head_lines: Lines to keep from the beginning.
        tail_lines: Lines to keep from the end.

    Returns:
        The original *output* if it fits, otherwise a truncated version
        with a structured notice in the middle.
    """
    if len(output) <= max_chars:
        return output

    lines = output.splitlines(keepends=True)
    total_lines = len(lines)

    kept_head = lines[:head_lines]
    kept_tail = lines[-tail_lines:] if tail_lines and total_lines > head_lines + tail_lines else []
    omitted = total_lines - len(kept_head) - len(kept_tail)

    notice = (
        "\n--- OUTPUT TRUNCATED ---\n"
        f"Total output: {len(output):,} characters (~{total_lines:,} lines)\n"
        f"Showing: first {len(kept_head)} lines + last {len(kept_tail)} lines\n"
        f"Omitted: ~{omitted:,} lines from middle\n"
        "To see specific results, narrow your search with more specific filters,\n"
        "use grep with targeted patterns, or read specific files directly.\n"
        "--- END TRUNCATION NOTICE ---\n\n"
    )

    logger.warning(
        "[TRUNCATED] tool=%s original_chars=%d original_lines=%d "
        "truncated_chars=%d head_lines=%d tail_lines=%d",
        tool_name,
        len(output),
        total_lines,
        max_chars,
        len(kept_head),
        len(kept_tail),
    )

    return "".join(kept_head) + notice + "".join(kept_tail)


def _apply_line_range(content: str, offset: int, limit: int) -> str:
    """Slice file content to a line range and prepend a position header.

    Args:
        content: Full file text returned by the backend.
        offset: 1-indexed starting line (0 means "from the beginning").
        limit: Maximum number of lines to return (0 means "no limit").

    Returns:
        The (possibly sliced) content.  When slicing is applied, a compact
        ``[Lines ...]`` header is prepended so the caller knows its
        position within the file.
    """
    if offset <= 0 and limit <= 0:
        return content

    lines = content.splitlines(keepends=True)
    total = len(lines)

    start_idx = max(offset - 1, 0)  # 1-indexed → 0-indexed

    if start_idx >= total:
        return (
            f"[File has {total} line{'s' if total != 1 else ''}; "
            f"requested offset {offset} is beyond end of file]"
        )

    if limit > 0:
        end_idx = min(start_idx + limit, total)
    else:
        end_idx = total

    shown_start = start_idx + 1  # back to 1-indexed for display
    shown_end = end_idx
    header = f"[Lines {shown_start}-{shown_end} of {total} total]\n"
    return header + "".join(lines[start_idx:end_idx])


def _create_read_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create approval-aware read tool wrapper.

    Args:
        backend: Backend instance with read() method
        approval_checker: Optional approval checker
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        @tool decorated function for reading files
    """
    @tool
    async def read(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        path: str,
        offset: int = 0,
        limit: int = 0,
    ) -> str:
        """Read file contents from the workspace.

        Args:
            path: Relative path to the file within the workspace
            offset: 1-indexed line number to start reading from.
                    Use 0 (default) to start from the beginning.
            limit: Maximum number of lines to return.
                   Use 0 (default) to read the entire file.

        Returns:
            File contents as string, optionally sliced to the requested
            line range with a position header.
        """
        tool_args = {"path": path}

        skip_result = _check_and_handle_approval(
            "read", tool_args, approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result

        try:
            logger.info("GRAPHTON read tool invoked for path: %s", path)
            result = await asyncio.to_thread(backend.read, path)
            logger.info(
                "GRAPHTON read tool succeeded for path: %s (%d chars)", path, len(result),
            )
            ranged = _apply_line_range(result, offset, limit)
            return truncate_tool_output(ranged, "read")
        except Exception as e:
            logger.warning(f"⚠️  read tool failed for '{path}': {e}")
            return enrich_error_message("read", str(e))

    read.name = "read"  # type: ignore[attr-defined]
    return read  # type: ignore[return-value]


def _create_write_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create approval-aware write tool wrapper.

    Args:
        backend: Backend instance with write() method
        approval_checker: Optional approval checker
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        @tool decorated function for writing files
    """
    @tool
    async def write(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        path: str,
        content: str,
    ) -> str:
        """Create a new file or overwrite an entire file in the workspace.

        This replaces the ENTIRE file content. For targeted changes to an
        existing file (changing specific lines or sections), prefer the
        ``edit`` tool instead — it modifies only the changed section without
        regenerating unchanged content.

        Use ``write`` for: new file creation, complete rewrites, or
        generating files from scratch.

        Args:
            path: Relative path to the file within the workspace
            content: Full content to write to the file (replaces everything)

        Returns:
            Confirmation message
        """
        tool_args = {"path": path, "content": content}

        skip_result = _check_and_handle_approval(
            "write", tool_args, approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result
        
        try:
            logger.info(f"📝 Writing file: {path} ({len(content)} chars)")
            result = await asyncio.to_thread(backend.write, path, content)

            error = getattr(result, "error", None)
            if error:
                logger.warning(
                    "⚠️  write tool: backend.write returned error for '%s': %s",
                    path, error,
                )
                return enrich_error_message("write", str(error))

            logger.info(
                "Wrote file '%s' (%d chars, first_200=%r)",
                path, len(content), content[:200],
            )
            return f"Successfully wrote {len(content)} characters to '{path}'"
        except Exception as e:
            logger.warning(f"⚠️  write tool failed for '{path}': {e}")
            return enrich_error_message("write", str(e))
    
    write.name = "write"  # type: ignore[attr-defined]
    return write  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Shell output formatting helpers
# ---------------------------------------------------------------------------

def _format_shell_success(stdout: str, stderr: str) -> str:
    """Format shell output for a successful command (exit code 0).

    Returns just the raw output with no labels or metadata -- the same
    experience a human gets running a command in a terminal.  Output that
    exceeds ``_MAX_TOOL_OUTPUT_CHARS`` is truncated with a head+tail
    window so the model can refine its approach.
    """
    parts = [s for s in (stdout, stderr) if s]
    raw = "\n".join(parts) if parts else "(no output)"
    return truncate_tool_output(raw, "execute")


def _format_shell_failure(exit_code: int, stdout: str, stderr: str) -> str:
    """Format shell output for a failed command (exit code != 0).

    Surfaces the exit code prominently followed by stderr (the error) and
    then stdout (if any).  The LLM uses the exit code to reason about
    retries, so it must remain in the returned string.  Output that
    exceeds ``_MAX_TOOL_OUTPUT_CHARS`` is truncated with a head+tail
    window.
    """
    lines = [f"Command failed (exit code {exit_code})"]
    if stderr:
        lines.append(stderr)
    if stdout:
        lines.append(stdout)
    raw = "\n".join(lines) if len(lines) > 1 else lines[0]
    return truncate_tool_output(raw, "execute")


def _create_execute_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create approval-aware execute tool wrapper.

    When the backend supports ``execute_streaming()``, output is streamed
    live via ``tool_progress`` events as each line arrives from the
    subprocess.  Otherwise falls back to the sync ``execute()`` call
    (output appears all-at-once on completion).

    Args:
        backend: Backend instance with execute() method
        approval_checker: Optional approval checker
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        @tool decorated function for executing shell commands
    """
    _supports_streaming = callable(getattr(backend, "execute_streaming", None))

    @tool
    async def execute(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        command: str,
        timeout: int = 120,
    ) -> str:
        """Execute a shell command in the workspace.

        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds (default: 120)

        Returns:
            Command output (stdout + stderr combined)
        """
        tool_args = {"command": command, "timeout": timeout}

        skip_result = _check_and_handle_approval(
            "execute", tool_args, approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result
        
        try:
            logger.info(f"🔧 Executing command: {command[:100]}...")
            
            dispatch_custom_event(
                "tool_progress",
                {"chunk": f"$ {command}\n"},
            )

            if _supports_streaming:
                result = await backend.execute_streaming(
                    command,
                    timeout=timeout,
                    on_chunk=lambda chunk: dispatch_custom_event(
                        "tool_progress", {"chunk": chunk},
                    ),
                )
            else:
                result = await asyncio.to_thread(
                    backend.execute, command, timeout=timeout,
                )

            stdout = getattr(result, "stdout", "") or ""
            if not stdout:
                output_val = getattr(result, "output", "")
                if isinstance(output_val, str):
                    stdout = output_val
            stderr = getattr(result, "stderr", "") or ""

            if result.exit_code == 0:
                logger.info("✅ Command completed successfully")
                return _format_shell_success(stdout, stderr)
            else:
                logger.warning(f"⚠️  Command exited with code {result.exit_code}")
                return _format_shell_failure(
                    result.exit_code, stdout, stderr,
                )
        except Exception as e:
            logger.warning(f"⚠️  execute tool failed: {e}")
            return enrich_error_message("execute", str(e))
    
    execute.name = "execute"  # type: ignore[attr-defined]
    return execute  # type: ignore[return-value]


def _create_edit_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create approval-aware edit tool wrapper.

    The edit tool performs a text replacement in a file. It reads the file,
    replaces the first occurrence of old_text with new_text, and writes back.

    This is a DANGEROUS operation that requires approval by default.

    Args:
        backend: Backend instance with read() and write() methods
        approval_checker: Optional approval checker
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        @tool decorated function for editing files
    """
    @tool
    async def edit(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        path: str,
        old_text: str,
        new_text: str,
    ) -> str:
        """Make a targeted change to an existing file by replacing specific text.

        Finds the first occurrence of old_text and replaces it with new_text.
        This is the preferred way to modify existing files — you only specify
        the changed section, avoiding the cost of regenerating the entire file.

        Include just enough surrounding context in old_text to uniquely
        identify the location. For multiple changes to the same file, call
        ``edit`` multiple times rather than rewriting the whole file with
        ``write``.

        Args:
            path: Relative path to the file within the workspace
            old_text: Exact text to find and replace (must exist in file,
                include enough context to be unique)
            new_text: Text to replace old_text with

        Returns:
            Confirmation message with change details
        """
        tool_args = {"path": path, "old_text": old_text, "new_text": new_text}

        skip_result = _check_and_handle_approval(
            "edit", tool_args, approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result
        
        # Execute the edit operation
        try:
            logger.info(f"✏️  Editing file: {path}")
            
            content = await asyncio.to_thread(backend.read, path)
            
            if old_text not in content:
                error_msg = f"Text to replace not found in '{path}'"
                logger.warning(f"⚠️  {error_msg}")
                return enrich_error_message("edit", error_msg)
            
            new_content = content.replace(old_text, new_text, 1)

            result = await asyncio.to_thread(backend.write, path, new_content)
            error = getattr(result, "error", None)
            if error:
                logger.warning(
                    "⚠️  edit tool: backend.write returned error for '%s': %s",
                    path, error,
                )
                return enrich_error_message("edit", str(error))

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


def _create_delete_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create approval-aware delete tool wrapper.

    The delete tool removes a single file from the workspace.  Directory
    deletion is intentionally unsupported — recursive removal is a much
    more destructive operation that should go through the ``execute`` tool
    with its own approval gate.

    Args:
        backend: Backend instance with delete() method
        approval_checker: Optional approval checker
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        @tool decorated function for deleting files
    """
    @tool
    async def delete(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        path: str,
    ) -> str:
        """Delete a file from the workspace.

        Removes a single file at the given path.  Cannot delete
        directories — use the ``execute`` tool with ``rm -rf`` for that.

        Args:
            path: Relative path to the file within the workspace

        Returns:
            Confirmation message or error description
        """
        tool_args = {"path": path}

        skip_result = _check_and_handle_approval(
            "delete", tool_args, approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result

        try:
            logger.info("Deleting file: %s", path)
            await asyncio.to_thread(backend.delete, path)
            logger.info("Deleted file '%s'", path)
            return f"Deleted '{path}'"
        except Exception as e:
            logger.warning("delete tool failed for '%s': %s", path, e)
            return enrich_error_message("delete", str(e))

    delete.name = "delete"  # type: ignore[attr-defined]
    return delete  # type: ignore[return-value]


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
            files = await asyncio.to_thread(backend.list_files, path)
            
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

    Uses shell ``find`` when the backend supports ``execute()`` for O(1)
    network calls instead of recursive Python walks.  Falls back to
    Python ``fnmatch`` for backends without shell access.
    """
    import fnmatch
    import os
    import shlex

    _glob_max_depth = 15
    _has_execute = callable(getattr(backend, "execute", None))

    async def _glob_via_execute(pattern: str, path: str) -> list[str]:
        has_path_component = "/" in pattern
        name_part = pattern.rsplit("/", 1)[-1] if has_path_component else pattern

        cmd = (
            f"find {shlex.quote(path)} -maxdepth {_glob_max_depth}"
            f" -name {shlex.quote(name_part)}"
            f" -not -path '*/.git/*'"
            f" -type f 2>/dev/null | head -n 5000 | sort"
        )
        result = await asyncio.to_thread(backend.execute, cmd)
        stdout = result.stdout if hasattr(result, "stdout") else ""
        if not stdout or not stdout.strip():
            return []

        matches = [line for line in stdout.strip().splitlines() if line.strip()]
        matches = [m[2:] if m.startswith("./") else m for m in matches]

        if has_path_component:
            matches = [m for m in matches if fnmatch.fnmatch(m, pattern)]

        return matches

    async def _glob_via_walk(pattern: str, path: str) -> list[str]:
        all_files: list[str] = []
        _has_is_dir = hasattr(backend, "is_directory")

        def collect_files(dir_path: str, depth: int = 0) -> None:
            if depth > _glob_max_depth:
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

        def _do_glob() -> list[str]:
            collect_files(path)
            if "/" in pattern:
                return [f for f in all_files if fnmatch.fnmatch(f, pattern)]
            return [f for f in all_files if fnmatch.fnmatch(os.path.basename(f), pattern)]

        return await asyncio.to_thread(_do_glob)

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
            if _has_execute:
                matches = await _glob_via_execute(pattern, path)
            else:
                matches = await _glob_via_walk(pattern, path)

            if not matches:
                return f"No files matching pattern '{pattern}'"

            return truncate_tool_output("\n".join(sorted(matches)), "glob")
        except Exception as e:
            logger.warning("glob tool failed for pattern '%s': %s", pattern, e)
            return enrich_error_message("glob", str(e))

    glob.name = "glob"  # type: ignore[attr-defined]
    return glob  # type: ignore[return-value]


def _create_grep_tool(
    backend: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create grep (search content) tool wrapper.

    Uses shell ``grep`` when the backend supports ``execute()`` for O(1)
    network calls instead of recursive Python walks.  Falls back to
    Python ``re`` for backends without shell access.
    """
    import os
    import re
    import shlex

    _grep_max_depth = 15
    _has_execute = callable(getattr(backend, "execute", None))

    async def _grep_via_execute(pattern: str, path: str, include: str) -> str:
        max_results = 1000

        include_flag = (
            f" --include={shlex.quote(include)}" if include and include != "*" else ""
        )
        cmd = (
            f"grep -rn{include_flag}"
            f" --exclude-dir=.git"
            f" -E {shlex.quote(pattern)}"
            f" {shlex.quote(path)}"
            f" 2>/dev/null | head -n {max_results}"
        )
        result = await asyncio.to_thread(backend.execute, cmd)
        stdout = result.stdout if hasattr(result, "stdout") else ""

        if not stdout or not stdout.strip():
            return f"No matches for pattern '{pattern}'"

        lines = [ln for ln in stdout.strip().splitlines() if ln.strip()]
        lines = [ln[2:] if ln.startswith("./") else ln for ln in lines]

        truncated = len(lines) >= max_results
        summary = (
            f"Found {len(lines)}{'+ (truncated)' if truncated else ''} matches:"
        )
        return truncate_tool_output(f"{summary}\n\n" + "\n".join(lines), "grep")

    async def _grep_via_walk(pattern: str, path: str, include: str) -> str:
        import fnmatch

        regex = re.compile(pattern)
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
            if depth > _grep_max_depth:
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

        await asyncio.to_thread(collect_and_search, path)

        if not results:
            return f"No matches for pattern '{pattern}' in {files_searched} files searched"

        truncated = len(results) >= max_results
        summary = (
            f"Found {len(results)}{'+ (truncated)' if truncated else ''} matches "
            f"in {files_searched} files:"
        )
        return truncate_tool_output(f"{summary}\n\n" + "\n".join(results), "grep")

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
        try:
            try:
                re.compile(pattern)
            except re.error as e:
                return enrich_error_message(
                    "grep", f"Invalid regex pattern '{pattern}': {e}",
                )

            if _has_execute:
                return await _grep_via_execute(pattern, path, include)
            return await _grep_via_walk(pattern, path, include)
        except Exception as e:
            logger.warning("grep tool failed for pattern '%s': %s", pattern, e)
            return enrich_error_message("grep", str(e))

    grep.name = "grep"  # type: ignore[attr-defined]
    return grep  # type: ignore[return-value]


def _create_search_tool(
    backend: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create search (structural symbol lookup) tool wrapper.

    On first invocation the tool lazily builds a structural symbol index.
    Uses shell ``grep`` when the backend supports ``execute()`` for O(1)
    network calls instead of reading every file individually.  The index
    is cached in the closure for the lifetime of the execution.
    """
    from graphton.core.workspace_index import (
        WorkspaceIndex,
        build_workspace_index,
        build_workspace_index_via_grep,
        format_search_results,
    )

    _cached_index: list[WorkspaceIndex | None] = [None]
    _has_execute = callable(getattr(backend, "execute", None))

    def _build_index_sync() -> WorkspaceIndex:
        if _has_execute:
            logger.info(
                "Building workspace symbol index via grep (first search call)…"
            )
            return build_workspace_index_via_grep(backend)
        logger.info("Building workspace symbol index (first search call)…")
        return build_workspace_index(backend)

    async def _get_index() -> WorkspaceIndex:
        if _cached_index[0] is None:
            _cached_index[0] = await asyncio.to_thread(_build_index_sync)
        return _cached_index[0]

    @tool
    async def search(query: str) -> str:
        """Search for code definitions by concept or name.

        Finds structural elements (classes, functions, methods, types,
        structs, enums, interfaces, traits) whose names match the query.
        Use this when you know *what concept* to find.  Use ``grep`` when
        you know *what exact text* to find.

        Examples:
            search("authentication middleware")
            search("database connection")
            search("LoginController")
            search("parse_config")

        Args:
            query: Natural-language query or identifier name to search for.

        Returns:
            Ranked list of matching definitions with file paths, line
            numbers, and signatures.
        """
        try:
            logger.debug("search tool invoked with query: %r", query)

            if not query or not query.strip():
                return "Please provide a search query."

            index = await _get_index()
            results = index.search(query)

            output = format_search_results(results, query, index=index)
            logger.debug(
                "search tool returned %d result(s) for %r",
                len(results),
                query,
            )
            return output
        except Exception as e:
            logger.warning("search tool failed for query %r: %s", query, e)
            return enrich_error_message("search", str(e))

    search.name = "search"  # type: ignore[attr-defined]
    return search  # type: ignore[return-value]

