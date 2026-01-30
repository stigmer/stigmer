"""Authenticated MCP Tool Node for per-request client creation.

This module implements the Dynamic Client Factory pattern for secure
per-user MCP authentication in multi-tenant environments. Instead of
using global middleware to configure MCP clients, this creates a fresh
MCP client for each request with the user's specific credentials.

Architecture:
- Custom LangGraph node that replaces standard ToolNode
- Extracts user token from config["configurable"] at execution time
- Creates MultiServerMCPClient with dynamic headers per-request
- Executes tools with authenticated client
- Closes connection after execution

This pattern ensures:
- Thread-safety: No global state or race conditions
- Security: Client isolated per request with proper credentials
- Flexibility: Works with LangGraph Platform's config injection
- Standard: Aligns with LangGraph's Runtime architecture

Based on research findings in "LangGraph Per-User MCP Auth" (Section 6.3).
"""

import logging
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters import MultiServerMCPClient

logger = logging.getLogger(__name__)


def _enrich_error_message(tool_name: str, error: str) -> str:
    """Add contextual recovery hints based on tool type and error pattern.
    
    This function analyzes error messages and tool names to provide actionable
    recovery suggestions that help the LLM try alternative approaches instead
    of giving up or blindly retrying.
    
    Args:
        tool_name: Name of the tool that failed
        error: The error message from the tool execution
        
    Returns:
        Enriched error message with recovery suggestions
    
    Examples:
        >>> _enrich_error_message("read_file", "File not found: /path/to/file.txt")
        'Error: File not found: /path/to/file.txt\\n\\nRecovery suggestions:\\n- ...'
    """
    hints: list[str] = []
    error_lower = error.lower()
    tool_lower = tool_name.lower()
    
    # File/path related errors
    if "not found" in error_lower or "no such file" in error_lower:
        hints.append("Try using ls or glob to discover available files/resources")
        hints.append("Check if the path is correct - use ls on the parent directory")
        hints.append("The file might be in a different location - search with glob patterns")
    
    if "permission" in error_lower or "access denied" in error_lower:
        hints.append("Check if the path is correct and accessible")
        hints.append("Verify you have the right permissions for this operation")
        hints.append("Try an alternative location if the target is read-only")
    
    if "directory" in error_lower and ("not" in error_lower or "empty" in error_lower):
        hints.append("Use ls to verify the directory structure")
        hints.append("Create the directory first if it doesn't exist")
    
    # Edit/write specific errors
    if "edit" in tool_lower or "write" in tool_lower:
        hints.append("Try reading the target first to understand its current state")
        hints.append("If editing fails, try read + modify + write_file as a complete replacement")
        hints.append("Check that the file format matches your content (JSON, YAML, etc.)")
    
    # Authentication/authorization errors
    if "auth" in error_lower or "unauthorized" in error_lower or "403" in error_lower:
        hints.append("Verify authentication credentials are correct")
        hints.append("Check if the token has expired or lacks required permissions")
        hints.append("The resource may require different access levels")
    
    # Connection/network errors
    if "connection" in error_lower or "timeout" in error_lower or "unavailable" in error_lower:
        hints.append("This may be a transient error - wait a moment and retry")
        hints.append("Check if the service is available")
        hints.append("Try with a simpler request to verify connectivity")
    
    # Invalid input errors
    if "invalid" in error_lower or "malformed" in error_lower or "format" in error_lower:
        hints.append("Review the parameter format and types")
        hints.append("Check the tool documentation for expected input format")
        hints.append("Try with simplified or default parameters first")
    
    # Resource not found (API resources)
    if "resource" in error_lower and "not found" in error_lower:
        hints.append("Verify the resource ID or name is correct")
        hints.append("Use a list/search operation to discover valid resources")
        hints.append("The resource may have been deleted or renamed")
    
    # Rate limiting
    if "rate" in error_lower or "limit" in error_lower or "quota" in error_lower or "429" in error_lower:
        hints.append("Wait a moment before retrying - rate limits reset over time")
        hints.append("Try reducing the scope of your request")
        hints.append("Batch multiple small operations into fewer larger ones")
    
    # Build the enriched message
    if hints:
        recovery_section = "\n".join(f"- {hint}" for hint in hints)
        return f"Error: {error}\n\nRecovery suggestions:\n{recovery_section}"
    else:
        # Fallback generic hints if no specific pattern matched
        return (
            f"Error: {error}\n\n"
            "Recovery suggestions:\n"
            "- Analyze the error message for clues about what went wrong\n"
            "- Try a different approach or alternative tool\n"
            "- Verify your inputs and assumptions are correct"
        )


class AuthenticatedMcpToolNode:
    """Custom LangGraph node for executing MCP tools with per-request authentication.
    
    This node replaces the standard ToolNode when MCP tools require
    user-specific authentication. It creates a fresh MCP client for each
    invocation, configured with the user's token from runtime config.
    
    Example:
        >>> # Define base server configurations (no auth tokens yet)
        >>> server_configs = {
        ...     "planton-cloud": {
        ...         "url": "https://mcp.planton.ai/",
        ...         "transport": "streamable_http"
        ...     }
        ... }
        >>> 
        >>> # Create the authenticated tool node
        >>> tool_node = AuthenticatedMcpToolNode(server_configs)
        >>> 
        >>> # Later, in graph execution:
        >>> # The node extracts USER_TOKEN from config and creates authenticated client
        >>> result = await tool_node(state, config={"configurable": {"USER_TOKEN": "..."}})

    """
    
    def __init__(
        self,
        server_configs: dict[str, dict[str, Any]],
        auth_header_template: str = "Bearer {token}",
        token_config_key: str = "USER_TOKEN",
    ) -> None:
        """Initialize authenticated MCP tool node.
        
        Args:
            server_configs: Dict mapping server names to base config dicts.
                Should NOT include authentication headers - those are added dynamically.

                Example::

                    {
                        "planton-cloud": {
                            "url": "https://mcp.planton.ai/",
                            "transport": "streamable_http"
                        }
                    }

            auth_header_template: Template for Authorization header value.
                Default: "Bearer {token}" - {token} is replaced with user's token.
            token_config_key: Key name in config["configurable"] for user token.
                Default: "USER_TOKEN"

        """
        self.base_configs = server_configs
        self.auth_header_template = auth_header_template
        self.token_config_key = token_config_key
        
        logger.info(
            f"Initialized AuthenticatedMcpToolNode for {len(server_configs)} server(s): "
            f"{list(server_configs.keys())}"
        )
    
    async def __call__(
        self,
        state: dict[str, Any],
        config: RunnableConfig,
    ) -> dict[str, list[Any]]:
        """Execute tool calls with per-request authenticated MCP client.
        
        This is the main execution logic called by LangGraph when the node runs.
        
        Args:
            state: Current agent state containing messages
            config: Runtime config containing user credentials in config["configurable"]
            
        Returns:
            Dict with "messages" key containing ToolMessage results
            
        Raises:
            ValueError: If auth token not found in config
            RuntimeError: If MCP client creation or tool execution fails

        """
        # --------------------------------------------------------
        # 1. Identity Extraction & Validation
        # --------------------------------------------------------
        configurable = config.get("configurable", {})
        auth_token = configurable.get(self.token_config_key)
        user_id = configurable.get("user_id")  # Optional, for logging
        
        if not auth_token:
            # Security Decision: Fail if no auth token provided
            error_msg = (
                f"Security Error: No '{self.token_config_key}' found in request configuration. "
                f"Pass config={{'configurable': {{'{self.token_config_key}': 'your-token'}}}} "
                "when invoking the agent."
            )
            logger.error(error_msg)
            return self._fail_all_tools(state, error_msg)
        
        logger.info(
            f"Executing MCP tools for user {user_id or 'unknown'} "
            f"with authenticated client"
        )
        
        # --------------------------------------------------------
        # 2. Dynamic Configuration Construction
        # --------------------------------------------------------
        # Create per-request config with injected auth headers
        # Thread-safe: We copy base configs and don't modify self.base_configs
        run_configs = {}
        for name, server_cfg in self.base_configs.items():
            run_configs[name] = server_cfg.copy()
            
            # Merge existing headers with dynamic auth headers
            existing_headers = run_configs[name].get("headers", {})
            run_configs[name]["headers"] = {
                **existing_headers,
                "Authorization": self.auth_header_template.format(token=auth_token),
            }
            
            # Add user ID header if available (useful for server-side logging)
            if user_id:
                run_configs[name]["headers"]["X-User-ID"] = str(user_id)
        
        logger.debug(
            f"Constructed authenticated configs for {len(run_configs)} server(s)"
        )
        
        # --------------------------------------------------------
        # 3. Extract Tool Calls from State
        # --------------------------------------------------------
        # Get the last message which should contain tool calls
        messages = state.get("messages", [])
        if not messages:
            logger.warning("No messages in state, nothing to execute")
            return {"messages": []}
        
        last_message = messages[-1]
        
        # Verify last message is an AI message with tool calls
        if not isinstance(last_message, AIMessage):
            logger.debug(
                f"Last message is not AIMessage (type: {type(last_message).__name__}), "
                "no tools to execute"
            )
            return {"messages": []}
        
        if not last_message.tool_calls:
            logger.debug("Last AIMessage has no tool_calls, nothing to execute")
            return {"messages": []}
        
        logger.info(
            f"Executing {len(last_message.tool_calls)} tool call(s) "
            f"for user {user_id or 'unknown'}"
        )
        
        # --------------------------------------------------------
        # 4. Client Lifecycle & Tool Execution
        # --------------------------------------------------------
        results: list[ToolMessage] = []
        
        try:
            # Create MCP client with user-specific auth
            # Context manager handles connection setup and teardown
            async with MultiServerMCPClient(run_configs) as client:
                logger.debug("MCP client connected, executing tool calls...")
                
                # Execute each tool call
                for tool_call in last_message.tool_calls:
                    tc_name = tool_call["name"]
                    tc_args = tool_call["args"]
                    tc_id = tool_call["id"]
                    
                    try:
                        logger.info(
                            f"Executing tool '{tc_name}' for user {user_id or 'unknown'}"
                        )
                        logger.debug(f"Tool '{tc_name}' args: {tc_args}")
                        
                        # Execute: The client uses the authenticated transport
                        output = await client.call_tool(tc_name, tc_args)
                        
                        # Success - create tool message with result
                        results.append(
                            ToolMessage(
                                content=str(output),
                                name=tc_name,
                                tool_call_id=tc_id,
                            )
                        )
                        
                        logger.info(f"Tool '{tc_name}' executed successfully")
                        
                    except Exception as e:
                        # Application-level error (e.g., file not found, invalid args)
                        logger.warning(
                            f"Tool '{tc_name}' failed: {e}",
                            exc_info=True
                        )
                        # Enrich error message with recovery hints to help the agent
                        # try alternative approaches instead of giving up
                        enriched_error = _enrich_error_message(tc_name, str(e))
                        results.append(
                            ToolMessage(
                                content=enriched_error,
                                name=tc_name,
                                tool_call_id=tc_id,
                                status="error",  # type: ignore[call-arg]
                            )
                        )
                
                logger.info(
                    f"Completed execution of {len(results)} tool call(s) "
                    f"for user {user_id or 'unknown'}"
                )
        
        except Exception as e:
            # Infrastructure-level error (e.g., auth failed, connection refused)
            logger.error(
                f"MCP client connection/execution failed: {e}",
                exc_info=True
            )
            return self._fail_all_tools(
                state,
                f"MCP service unavailable: {str(e)}"
            )
        
        return {"messages": results}
    
    def _fail_all_tools(
        self,
        state: dict[str, Any],
        error_message: str,
    ) -> dict[str, list[ToolMessage]]:
        """Helper to fail all pending tool calls with an error message.
        
        Used when authentication fails or client creation fails.
        Ensures all tool calls get error responses so the agent can handle them.
        
        Args:
            state: Current agent state containing messages
            error_message: Error message to return for each tool call
            
        Returns:
            Dict with "messages" containing ToolMessage errors for each tool call

        """
        messages = state.get("messages", [])
        if not messages:
            return {"messages": []}
        
        last_message = messages[-1]
        
        # If last message doesn't have tool calls, return empty
        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            return {"messages": []}
        
        # Create error responses for all tool calls with enriched messages
        results: list[ToolMessage] = []
        for tool_call in last_message.tool_calls:
            enriched_error = _enrich_error_message(tool_call["name"], error_message)
            results.append(
                ToolMessage(
                    content=enriched_error,
                    name=tool_call["name"],
                    tool_call_id=tool_call["id"],
                    status="error",  # type: ignore[call-arg]
                )
            )
        
        logger.warning(
            f"Failed all {len(results)} tool call(s) with error: {error_message}"
        )
        
        return {"messages": results}
























