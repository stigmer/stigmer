"""Agent factory for creating Deep Agents with minimal boilerplate.

This module provides the main entry point for creating LangGraph Deep Agents
using Graphton's declarative API.
"""

from collections.abc import Sequence
from typing import Any

from deepagents import (  # type: ignore[import-untyped]
    create_deep_agent as deepagents_create_deep_agent,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from graphton.core.loop_detection import LoopDetectionMiddleware
from graphton.core.models import parse_model_string
from graphton.core.prompt_enhancement import enhance_user_instructions


def create_deep_agent(
    model: str | BaseChatModel,
    system_prompt: str,
    mcp_servers: dict[str, dict[str, Any]] | None = None,
    mcp_tools: dict[str, list[str]] | None = None,
    tools: Sequence[BaseTool] | None = None,
    middleware: Sequence[Any] | None = None,
    context_schema: type[Any] | None = None,
    sandbox_config: dict[str, Any] | None = None,
    recursion_limit: int = 100,
    max_tokens: int | None = None,
    temperature: float | None = None,
    auto_enhance_prompt: bool = True,
    subagents: list[dict[str, Any]] | None = None,
    general_purpose_agent: bool = True,
    **model_kwargs: Any,  # noqa: ANN401
) -> CompiledStateGraph:
    """Create a Deep Agent with minimal boilerplate.
    
    This is the main entry point for Graphton. It eliminates boilerplate by:
    - Accepting model name strings instead of requiring model instantiation
    - Providing sensible defaults for model parameters
    - Automatically applying recursion limits
    - Supporting both string-based and instance-based model configuration
    - Auto-loading MCP tools with per-user authentication (Phase 3)
    - Auto-enhancing prompts with capability awareness (Phase 5)
    - Auto-injecting loop detection to prevent infinite loops
    
    Args:
        model: Model name string (e.g., "claude-sonnet-4.5", "gpt-4o") or
            a LangChain model instance. String format supports friendly names
            that map to full model IDs.
        system_prompt: The system prompt for the agent. This defines the agent's
            role, capabilities, and behavior. When auto_enhance_prompt is True
            (default), this will be automatically enriched with awareness of
            Deep Agents capabilities (planning, file system, MCP tools).
        mcp_servers: Optional dict of raw MCP server configurations. Accepts any format
            compatible with the MCP client. Supports template variables like {{VAR_NAME}}
            for dynamic token injection at runtime.
            Example (dynamic): {"planton-cloud": {
                "transport": "streamable_http",
                "url": "https://mcp.planton.ai/",
                "headers": {"Authorization": "Bearer {{USER_TOKEN}}"}
            }}
            Example (static): {"public-api": {
                "transport": "http",
                "url": "https://api.example.com/",
                "headers": {"X-API-Key": "hardcoded-key-123"}
            }}
        mcp_tools: Optional dict mapping server names to lists of tool names to load.
            Example: {"planton-cloud": ["list_organizations", "create_cloud_resource"]}
            Requires mcp_servers to be provided.
        tools: Optional list of additional tools the agent can use. MCP tools will
            be added automatically if mcp_servers and mcp_tools are provided.
        middleware: Optional list of middleware to run before/after agent execution.
            MCP tool loading middleware will be auto-injected if MCP configured.
        context_schema: Optional state schema for the agent. Defaults to FilesystemState
            from deepagents, which provides file system operations.
        sandbox_config: Optional dict configuring sandbox backend for file operations.
            Enables file system tools (read, write, edit, ls, glob, grep).
            Configuration format: {"type": "filesystem", "root_dir": "/workspace"}
            Supported types: filesystem (file ops only), modal, runloop, daytona, harbor.
            Note: 'filesystem' type provides file operations but execute tool returns error.
            If not provided, uses default ephemeral state backend.
        recursion_limit: Maximum recursion depth for the agent (default: 100).
            This prevents infinite loops in agent reasoning.
        max_tokens: Override default max_tokens for the model. Defaults depend on
            the model provider (Anthropic: 20000, OpenAI: model default).
        temperature: Override default temperature for the model. Higher values
            (e.g., 0.7-1.0) make output more creative, lower values (e.g., 0.0-0.3)
            make it more deterministic.
        auto_enhance_prompt: Whether to automatically enhance the system_prompt with
            awareness of Deep Agents capabilities (default: True). When enabled,
            high-level context about planning system, file system, and MCP tools
            is appended to user instructions. This helps agents effectively use
            available capabilities without requiring users to know framework internals.
            Set to False to use system_prompt as-is without enhancement.
        auto_enhance_prompt: Automatically enhance system_prompt with awareness of
            available capabilities (planning, file system, execute, MCP tools).
            Default is True. Set to False to use system_prompt exactly as provided.
        subagents: Optional list of sub-agent specifications for task delegation.
            Each sub-agent is a dict with keys: name (str), description (str),
            system_prompt (str), and optionally tools (list), middleware (list),
            model (str or instance). Sub-agents enable context isolation and
            parallel execution of independent tasks.
        general_purpose_agent: Whether to include a general-purpose sub-agent
            (default: True). The general-purpose sub-agent has the same tools
            and model as the main agent, useful for breaking down tasks without
            defining specialized sub-agents.
        **model_kwargs: Additional model-specific parameters to pass to the model
            constructor (e.g., top_p, top_k for Anthropic).
    
    Returns:
        A compiled LangGraph agent ready to invoke with messages.
    
    Raises:
        ValueError: If system_prompt is empty or recursion_limit is invalid
        ValueError: If model string is invalid or unsupported
        ValueError: If MCP configuration is invalid or incomplete
    
    Examples:
        Basic agent with model string:
        
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="You are a helpful assistant.",
        ... )
        >>> result = agent.invoke({"messages": [{"role": "user", "content": "Hello"}]})
        
        Agent with custom parameters:
        
        >>> agent = create_deep_agent(
        ...     model="gpt-4o",
        ...     system_prompt="You are a code reviewer.",
        ...     temperature=0.3,
        ...     max_tokens=5000,
        ...     recursion_limit=50,
        ... )
        
        Agent with model instance (advanced):
        
        >>> from langchain_anthropic import ChatAnthropic
        >>> model = ChatAnthropic(model="claude-opus-4", max_tokens=30000)
        >>> agent = create_deep_agent(
        ...     model=model,
        ...     system_prompt="You are a research assistant.",
        ... )
        
        Agent with MCP tools (dynamic auth with templates):
        
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="You are a Planton Cloud assistant.",
        ...     mcp_servers={
        ...         "planton-cloud": {
        ...             "transport": "streamable_http",
        ...             "url": "https://mcp.planton.ai/",
        ...             "headers": {
        ...                 "Authorization": "Bearer {{USER_TOKEN}}"
        ...             }
        ...         }
        ...     },
        ...     mcp_tools={
        ...         "planton-cloud": ["list_organizations", "create_cloud_resource"]
        ...     }
        ... )
        >>> # Invoke with user token - will be substituted into {{USER_TOKEN}}
        >>> result = agent.invoke(
        ...     {"messages": [{"role": "user", "content": "List organizations"}]},
        ...     config={"configurable": {"USER_TOKEN": "your-token-here"}}
        ... )
        
        Agent with prompt enhancement disabled:
        
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="Detailed instructions with all context already included.",
        ...     auto_enhance_prompt=False,  # Use prompt as-is
        ... )
        
        Agent with sub-agents for specialized tasks:
        
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="You are a research coordinator.",
        ...     subagents=[
        ...         {
        ...             "name": "deep-researcher",
        ...             "description": "Conducts thorough research on complex topics",
        ...             "system_prompt": "You are a research specialist...",
        ...         },
        ...         {
        ...             "name": "code-reviewer",
        ...             "description": "Reviews code for quality and security",
        ...             "system_prompt": "You are a code review expert...",
        ...         }
        ...     ],
        ...     general_purpose_agent=True,  # Also include general-purpose sub-agent
        ... )
        >>> # Main agent can delegate to sub-agents via task tool
        >>> result = agent.invoke({
        ...     "messages": [{"role": "user", "content": "Research X and review code Y"}]
        ... })
    
    Note:
        System prompt enhancement is automatic by default. If your system_prompt
        already mentions planning or file system capabilities, some redundancy
        will occur. This is intentional and acceptable - LLMs handle redundant
        information gracefully, and reinforcement is better than missing critical
        context about available capabilities.
        
        Agent with filesystem backend:
        
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="You are a file management assistant.",
        ...     sandbox_config={
        ...         "type": "filesystem",
        ...         "root_dir": "/workspace"
        ...     }
        ... )
        >>> # Agent can perform file operations (read, write, edit, ls, glob, grep)
        >>> result = agent.invoke(
        ...     {"messages": [{"role": "user", "content": "List files in current directory"}]}
        ... )
    
    """
    # Validate configuration using AgentConfig model
    # This provides early error detection with helpful messages
    from graphton.core.config import AgentConfig
    
    try:
        # Validate configuration (validation happens in constructor)
        _ = AgentConfig(
            model=model,
            system_prompt=system_prompt,
            mcp_servers=mcp_servers,
            mcp_tools=mcp_tools,
            tools=tools,
            middleware=middleware,
            context_schema=context_schema,
            sandbox_config=sandbox_config,
            recursion_limit=recursion_limit,
            max_tokens=max_tokens,
            temperature=temperature,
            subagents=subagents,
            general_purpose_agent=general_purpose_agent,
        )
    except ValidationError as e:
        # Re-raise with context about configuration validation
        raise ValueError(
            f"Configuration validation failed:\n{e}"
        ) from e
    
    # Parse model if string, otherwise use instance directly
    if isinstance(model, str):
        model_instance = parse_model_string(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            **model_kwargs,
        )
    else:
        # Model instance provided directly
        model_instance = model
        
        # Warn if model parameters were provided but will be ignored
        if max_tokens is not None or temperature is not None or model_kwargs:
            import warnings
            warnings.warn(
                "Model instance provided with additional parameters. "
                "Additional parameters (max_tokens, temperature, **model_kwargs) "
                "are ignored when passing a model instance. "
                "To use these parameters, pass a model name string instead.",
                UserWarning,
                stacklevel=2,
            )
    
    # Default empty sequences if None provided
    tools_list = list(tools or [])
    middleware_list = list(middleware or [])
    
    # Auto-inject loop detection middleware for autonomous agents
    # This prevents infinite loops by tracking tool invocations and intervening
    # when repetitive patterns are detected. Enabled by default.
    loop_detection = LoopDetectionMiddleware(
        history_size=10,
        consecutive_threshold=3,
        total_threshold=5,
        enabled=True,
    )
    middleware_list.append(loop_detection)
    
    # Transform subagents to DeepAgents format if provided
    # DeepAgents SubAgent type expects 'system_prompt' key (matching our format)
    transformed_subagents = None
    if subagents is not None:
        # DeepAgents format matches ours, just pass through
        # No transformation needed except ensuring it's properly formatted
        transformed_subagents = subagents
    
    # MCP integration (Universal Authentication Framework)
    if mcp_servers and mcp_tools:
        # Import MCP modules only when needed
        from graphton.core.middleware import McpToolsLoader
        from graphton.core.tool_wrappers import create_tool_wrapper
        
        # Validate that both parameters are provided together
        if not mcp_servers:
            raise ValueError(
                "mcp_servers required when mcp_tools is provided. "
                "Specify MCP server configurations."
            )
        if not mcp_tools:
            raise ValueError(
                "mcp_tools required when mcp_servers is provided. "
                "Specify which tools to load from each server."
            )
        
        # Create MCP tools loader middleware with raw server configs
        # The middleware will automatically detect static vs dynamic configs
        # and handle template substitution if needed
        mcp_middleware = McpToolsLoader(
            servers=mcp_servers,  # Pass raw configs directly
            tool_filter=mcp_tools,
        )
        
        # If tools were deferred due to async context, load them now
        # This ensures tools are available for eager wrapper creation
        # (Fixes: Dec 11 removal of lazy wrappers broke async contexts)
        if mcp_middleware._deferred_loading:
            import asyncio

            import nest_asyncio  # type: ignore[import-untyped]
            
            # Allow nested event loops (needed when called from async context)
            nest_asyncio.apply()
            
            # Load tools asynchronously before creating wrappers
            asyncio.get_event_loop().run_until_complete(
                mcp_middleware._load_tools_async()
            )
            mcp_middleware._deferred_loading = False
        
        # Generate tool wrappers for all requested tools
        # Use eager wrappers now that tools are loaded at creation time
        mcp_tool_wrappers: list[BaseTool] = []
        for server_name, tool_names in mcp_tools.items():
            for tool_name in tool_names:
                # Tools are always loaded (or deferred), so use eager wrappers
                wrapper = create_tool_wrapper(tool_name, mcp_middleware)
                mcp_tool_wrappers.append(wrapper)  # type: ignore[arg-type]
        
        # Add MCP tools and middleware to the agent
        tools_list.extend(mcp_tool_wrappers)
        # MCP middleware must run first to load tools before agent uses them
        middleware_list.insert(0, mcp_middleware)
    
    elif mcp_servers or mcp_tools:
        # One provided but not the other - error
        raise ValueError(
            "Both mcp_servers and mcp_tools must be provided together. "
            "Cannot configure one without the other."
        )
    
    # Enhance system prompt with capability awareness (unless disabled)
    if auto_enhance_prompt:
        enhanced_prompt = enhance_user_instructions(
            system_prompt,
            has_mcp_tools=bool(mcp_servers and mcp_tools),
            has_sandbox=bool(sandbox_config),
        )
    else:
        enhanced_prompt = system_prompt
    
    # Create sandbox backend if configured (for terminal execution support)
    backend = None
    if sandbox_config:
        from graphton.core.sandbox_factory import create_sandbox_backend
        backend = create_sandbox_backend(sandbox_config)
    
    # Create the Deep Agent using deepagents library
    # DeepAgents automatically adds SubAgentMiddleware when subagents are provided
    agent = deepagents_create_deep_agent(
        model=model_instance,
        tools=tools_list,
        system_prompt=enhanced_prompt,
        middleware=middleware_list,
        subagents=transformed_subagents,  # Pass transformed subagents to DeepAgents
        context_schema=context_schema,
        backend=backend,
    )
    
    # Apply recursion limit configuration
    configured_agent = agent.with_config({"recursion_limit": recursion_limit})
    
    return configured_agent  # type: ignore[no-any-return]

