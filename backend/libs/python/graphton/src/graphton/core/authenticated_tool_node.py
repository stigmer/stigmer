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
                        results.append(
                            ToolMessage(
                                content=f"Error executing tool: {str(e)}",
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
        
        # Create error responses for all tool calls
        results: list[ToolMessage] = []
        for tool_call in last_message.tool_calls:
            results.append(
                ToolMessage(
                    content=error_message,
                    name=tool_call["name"],
                    tool_call_id=tool_call["id"],
                    status="error",  # type: ignore[call-arg]
                )
            )
        
        logger.warning(
            f"Failed all {len(results)} tool call(s) with error: {error_message}"
        )
        
        return {"messages": results}
























