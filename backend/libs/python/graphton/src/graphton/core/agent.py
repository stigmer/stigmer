"""Agent factory for creating Deep Agents with minimal boilerplate.

This module provides the main entry point for creating LangGraph Deep Agents
using Graphton's declarative API.
"""

import logging
import re
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

from deepagents import (  # type: ignore[import-untyped]
    create_deep_agent as deepagents_create_deep_agent,
)
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from graphton.core.cost_cap import CostCapMiddleware
from graphton.core.execution_budget import ExecutionBudgetMiddleware
from graphton.core.loop_detection import LoopDetectionMiddleware
from graphton.core.models import parse_model_string
from graphton.core.prompt_enhancement import enhance_user_instructions
from graphton.core.think_tool import create_think_tool
from graphton.core.tool_truncation import ToolTruncationMiddleware

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

    from graphton.core.summarization_callback import SummarizationCallback
    from graphton.core.summarization_config import SummarizationConfig

logger = logging.getLogger(__name__)

# Regex patterns for prompt sections that must be stripped from the GP
# sub-agent's system prompt.  Each pattern matches a ``## <Heading>``
# block through the next ``## `` heading or end-of-string.
_SKILLS_SECTION_RE = re.compile(
    r"\n\n## Available Skills\n.*?(?=\n\n## |\Z)",
    re.DOTALL,
)
_SUBAGENT_RULES_SECTION_RE = re.compile(
    r"\n\n## Sub-agent delegation rules\n.*?(?=\n\n## |\Z)",
    re.DOTALL,
)

_GP_SCOPE_PREAMBLE = """\
You are a delegated general-purpose sub-agent. Your ONLY responsibility \
is to complete the specific task described in the user message below.

STRICT BOUNDARIES:
- Stay within your delegated task scope
- Do NOT follow skill activation instructions from the system context
- Do NOT create, scaffold, or write deliverables unless the task \
specifically asks for it
- Do NOT initiate workflows, run initialization scripts, or perform \
setup operations that go beyond the delegated task
- Do NOT act on information outside your task scope — report it instead

If you discover information relevant to the broader project but outside \
your task scope, include it in your report — do NOT act on it.

"""


def _build_gp_system_prompt(parent_prompt: str) -> str:
    """Build a scoped system prompt for the general-purpose sub-agent.

    Strips sections from the parent's system prompt that could cause
    the GP sub-agent to exceed its delegated task scope:

    - ``## Available Skills`` -- skills are activated by the main agent,
      not sub-agents.  Leaving activation breadcrumbs in the GP prompt
      caused a production scope violation where a sub-agent followed
      skill instructions instead of completing its exploration task.
    - ``## Sub-agent delegation rules`` -- the GP sub-agent is compiled
      via ``create_agent`` (not ``create_deep_agent``), so it has no
      ``task`` tool and cannot spawn sub-sub-agents.

    Prepends a scope-boundary preamble that explicitly constrains the
    sub-agent to its delegated task.
    """
    stripped = _SKILLS_SECTION_RE.sub("", parent_prompt)
    stripped = _SUBAGENT_RULES_SECTION_RE.sub("", stripped)
    return _GP_SCOPE_PREAMBLE + stripped


def create_deep_agent(
    model: str | BaseChatModel,
    system_prompt: str,
    mcp_servers: dict[str, dict[str, Any]] | None = None,
    mcp_tools: dict[str, list[str]] | None = None,
    tools: Sequence[BaseTool] | None = None,
    middleware: Sequence[Any] | None = None,
    context_schema: type[Any] | None = None,
    sandbox_config: dict[str, Any] | None = None,
    recursion_limit: int | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    auto_enhance_prompt: bool = True,
    subagents: list[dict[str, Any]] | None = None,
    general_purpose_agent: bool = True,
    # Loop detection configuration - tuned for autonomous, self-correcting agents
    loop_history_size: int = 20,
    loop_consecutive_threshold: int = 7,
    loop_total_threshold: int = 20,
    # Execution budget warning — percentage of recursion limit at which
    # the model receives a wrap-up SystemMessage (default: 80).
    budget_warning_pct: int = 80,
    # Checkpointer for interrupt/resume support (HITL approval flow)
    checkpointer: "BaseCheckpointSaver | None" = None,
    # Approval checker for HITL tool approval (optional)
    approval_checker: "Callable[[str, dict[str, Any]], Any] | None" = None,
    # Context summarization configuration
    summarization_config: "SummarizationConfig | None" = None,
    # Callback for summarization events (Phase 3)
    summarization_callback: "SummarizationCallback | None" = None,
    # Tool result truncation (Phase 3B)
    max_tool_result_chars: int = 0,
    tool_truncation_callback: "Callable[[str, int], None] | None" = None,
    # Cost cap (Phase 3B)
    max_cost_usd: float = 0.0,
    cost_pricing: "dict[str, float] | None" = None,
    # Pre-built MCP client for alternative transports (e.g. Daytona sandbox).
    # Duck-typed: must expose session(server_name) async context manager.
    mcp_client: Any | None = None,
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
            Example (dynamic): {"planton": {
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
            Example: {"planton": ["list_organizations", "create_cloud_resource"]}
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
        recursion_limit: Maximum super-steps for the agent graph.  ``None``
            (default) means unlimited — the agent runs until loop detection
            or the task completes.  When set to a positive integer, LangGraph
            raises ``GraphRecursionError`` if that many super-steps are used.
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
        loop_history_size: Number of recent tool calls to track for loop detection
            (default: 20). Higher values provide better pattern detection but use
            more memory. Recommended range: 10-50.
        loop_consecutive_threshold: Number of consecutive identical tool calls before
            the agent receives a warning intervention (default: 7). This allows the
            agent to retry failed operations while still catching infinite loops.
            Set higher (10-15) for very autonomous agents, lower (3-5) for cautious ones.
        loop_total_threshold: Total repetitions of a tool+params combination before
            forcing graceful stop (default: 20). This is the hard limit that prevents
            runaway agents. Should be higher than consecutive_threshold.
            Set higher (25-50) for complex tasks, lower (10-15) for simple ones.
        budget_warning_pct: Percentage of the recursion limit at which the model
            receives a SystemMessage asking it to wrap up (default: 80).  Only
            applies in threshold mode (when ``recursion_limit`` is set).  Must
            be between 50 and 95.  When ``recursion_limit`` is ``None``
            (unlimited), the middleware switches to periodic mode — advisory
            nudges every 50 model rounds with escalating urgency.
        checkpointer: Optional LangGraph checkpointer for interrupt/resume support.
            Required for HITL (human-in-the-loop) approval flow where tool execution
            can be paused for user approval. Supports MemorySaver for testing or
            PostgresSaver for production persistence. When provided, the graph state
            is automatically checkpointed, enabling interrupt() calls to pause
            execution and Command(resume=...) to continue after approval.
        approval_checker: Optional callable for HITL tool approval policy checking.
            Signature: (tool_name: str, tool_args: dict) -> ApprovalRequirement
            When provided, MCP tools are wrapped with approval checks. If a tool
            requires approval, the wrapper calls interrupt() to pause execution.
            The returned ApprovalRequirement should have requires_approval, message,
            mcp_server, and source attributes.
        summarization_config: Optional SummarizationConfig for automatic context
            window management. When provided, the agent automatically summarizes
            conversation history when token count exceeds configured thresholds.
            Use SummarizationConfig.for_model() to create model-appropriate config.
            Example: summarization_config=SummarizationConfig.for_model("claude-sonnet-4.5")
        summarization_callback: Optional callback for receiving summarization events.
            Must implement the SummarizationCallback protocol with methods:
            - on_summarization_complete(event: SummarizationEventData) -> None
            - on_token_count_updated(token_count: int) -> None
            Used for observability integration (e.g., StatusBuilder in agent-runner).
        max_tool_result_chars: Maximum characters per tool result before
            truncation.  0 (default) uses the platform default (30 000 chars
            ≈ 7 500 tokens).  Always active — protects against context blowup
            from uncapped MCP tools and large shell output.
        tool_truncation_callback: Optional callback invoked on each truncation.
            Receives ``(tool_name: str, chars_truncated: int)``.  Used by
            agent-runner to accumulate ``UsageMetrics.tool_result_chars_truncated``.
        max_cost_usd: Maximum estimated cost in USD for this execution.
            0.0 (default) means no cost cap.  When set, a warning is injected
            at 80 % of the budget and tools are blocked at 100 %.
        cost_pricing: Pricing rates for cost cap estimation.  Required when
            ``max_cost_usd > 0``.  Dict with keys: ``input_price_per_million``,
            ``output_price_per_million``, and optionally
            ``cache_read_price_per_million``.
        **model_kwargs: Additional model-specific parameters to pass to the model
            constructor (e.g., top_p, top_k for Anthropic).
    
    Returns:
        A compiled LangGraph agent ready to invoke with messages.
    
    Raises:
        ValueError: If system_prompt is empty or configuration is invalid
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
        ...     recursion_limit=300,
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
        ...     system_prompt="You are a Planton assistant.",
        ...     mcp_servers={
        ...         "planton": {
        ...             "transport": "streamable_http",
        ...             "url": "https://mcp.planton.ai/",
        ...             "headers": {
        ...                 "Authorization": "Bearer {{USER_TOKEN}}"
        ...             }
        ...         }
        ...     },
        ...     mcp_tools={
        ...         "planton": ["list_organizations", "create_cloud_resource"]
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
        
        Agent with checkpointer for HITL approval flow:
        
        >>> from langgraph.checkpoint.memory import MemorySaver
        >>> 
        >>> # Create checkpointer for interrupt/resume support
        >>> checkpointer = MemorySaver()
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="You are a cloud assistant.",
        ...     checkpointer=checkpointer,  # Enable HITL approval flow
        ... )
        >>> # Agent tools can now use interrupt() for approval
        >>> # Resume with Command(resume={"action": "approve"}) after user approves
    
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
            loop_history_size=loop_history_size,
            loop_consecutive_threshold=loop_consecutive_threshold,
            loop_total_threshold=loop_total_threshold,
            budget_warning_pct=budget_warning_pct,
            checkpointer=checkpointer,
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
    
    # Detect native extended thinking so we can skip the explicit think tool
    # and prompt guidance when the model already reasons natively.
    # Works for both string models (parse_model_string sets thinking for
    # supported Anthropic models) and pre-built instances (caller configured
    # thinking themselves).
    has_native_thinking = (
        isinstance(model_instance, ChatAnthropic)
        and getattr(model_instance, "thinking", None) is not None
    )
    
    # Default empty sequences if None provided
    tools_list = list(tools or [])
    middleware_list = list(middleware or [])

    # Tracks the MCP tools middleware (if created) so callers can close its
    # AsyncExitStack on forced shutdown.  Set inside the MCP block below.
    mcp_middleware_ref: Any = None
    
    # Auto-inject loop detection middleware for autonomous agents
    # This prevents infinite loops by tracking tool invocations and intervening
    # when repetitive patterns are detected. Enabled by default.
    # Default thresholds are tuned for self-correcting agents that need room
    # to retry and try alternative approaches before being stopped.
    loop_detection = LoopDetectionMiddleware(
        history_size=loop_history_size,
        consecutive_threshold=loop_consecutive_threshold,
        total_threshold=loop_total_threshold,
        enabled=True,
    )
    middleware_list.append(loop_detection)
    
    # Auto-inject execution budget middleware.
    #
    # When recursion_limit is set: threshold mode — single warning at
    # budget_warning_pct% of the estimated model rounds.
    #
    # When unlimited (None): periodic mode — advisory nudges every 50
    # model rounds (up to 4 times) with escalating urgency.  This keeps
    # the model aware of elapsed work and encourages efficient task
    # completion without imposing a hard ceiling.
    main_agent_advisory_interval = 50
    main_agent_max_advisories = 4

    if recursion_limit is not None:
        execution_budget = ExecutionBudgetMiddleware(
            recursion_limit=recursion_limit,
            warning_pct=budget_warning_pct,
        )
    else:
        execution_budget = ExecutionBudgetMiddleware(
            warning_interval=main_agent_advisory_interval,
            max_warnings=main_agent_max_advisories,
        )
    middleware_list.append(execution_budget)
    
    # Auto-inject tool truncation middleware (Phase 3B).
    # Always active — enforces a per-tool-result character ceiling to prevent
    # context blowup.  max_tool_result_chars=0 means "use platform default
    # (30K)", not "disable".
    from graphton.core.tool_truncation import _DEFAULT_MAX_CHARS as _DEFAULT_TRUNCATION
    effective_max_chars = max_tool_result_chars if max_tool_result_chars > 0 else _DEFAULT_TRUNCATION
    tool_truncation = ToolTruncationMiddleware(
        max_chars=effective_max_chars,
        on_truncation=tool_truncation_callback,
    )
    middleware_list.append(tool_truncation)
    logger.info(
        "Tool truncation middleware enabled: max_chars=%d%s",
        effective_max_chars,
        " (platform default)" if max_tool_result_chars == 0 else "",
    )

    # Auto-inject cost cap middleware when max_cost_usd is configured (Phase 3B).
    # Only injected when a positive cost cap is set.  Warns at 80% of the
    # budget, blocks tools at 100%, and gives the model one final round to
    # summarise before the graph terminates naturally.
    #
    # The instance is stored in _cost_cap so sub-agents can share the same
    # budget via cost_cap.for_sub_agent() — a lightweight view that
    # delegates cost tracking without resetting on abefore_agent.
    _cost_cap: CostCapMiddleware | None = None
    if max_cost_usd > 0.0:
        if not cost_pricing:
            logger.warning(
                "max_cost_usd=$%.2f set but no cost_pricing provided — "
                "cost cap middleware will NOT be injected. "
                "Provide cost_pricing with input/output rates.",
                max_cost_usd,
            )
        else:
            _cost_cap = CostCapMiddleware(
                max_cost_usd=max_cost_usd,
                input_price_per_million=cost_pricing["input_price_per_million"],
                output_price_per_million=cost_pricing["output_price_per_million"],
                cache_read_price_per_million=cost_pricing.get(
                    "cache_read_price_per_million", 0.0,
                ),
            )
            middleware_list.append(_cost_cap)
            logger.info(
                "Cost cap middleware enabled: max_cost=$%.2f",
                max_cost_usd,
            )

    # Auto-inject summarization middleware if configured
    # This manages context window size by summarizing conversation history
    # when token count exceeds the model's threshold.
    if summarization_config is not None and summarization_config.enabled:
        from graphton.core.summarization_middleware import ContextSummarizationMiddleware
        
        summarization_middleware = ContextSummarizationMiddleware(
            config=summarization_config,
            callback=summarization_callback,  # Pass callback for observability (Phase 3)
        )
        # Insert at beginning so it runs before other middleware
        middleware_list.insert(0, summarization_middleware)
        
        logger.info(
            "Summarization middleware enabled: trigger=%d, target=%d, model='%s', callback=%s",
            summarization_config.trigger_threshold,
            summarization_config.target_tokens,
            summarization_config.summarization_model,
            "present" if summarization_callback is not None else "none",
        )
    
    # Transform subagents to DeepAgents format.
    #
    # HITL path (checkpointer + approval_checker present):
    #   All sub-agents — both explicit and the general-purpose agent — are
    #   compiled with checkpointer=None (LangGraph native per-invocation
    #   mode) and wrapped in SubAgentGate for concurrency limiting.
    #   Sub-agent interrupt() calls propagate natively to the parent
    #   checkpoint with the direct value shape — no proxy layer needed.
    #
    #   The general-purpose sub-agent is always injected as an explicit
    #   CompiledSubAgent named "general-purpose".  deepagents auto-creates
    #   an ungated general-purpose clone when no subagent with that name is
    #   present; by providing our own gated version we override that
    #   behaviour and ensure the general-purpose agent shares the same
    #   concurrency gate and HITL approval flow as all other sub-agents.
    #
    # Non-HITL path (no checkpointer or no approval_checker):
    #   Explicit sub-agents are passed through with optional summarization
    #   middleware.  deepagents auto-creates its own general-purpose agent
    #   (ungated), which is acceptable for non-HITL usage.
    #
    # Sub-agents passed as CompiledSubAgent (with 'runnable' key) are used
    # by deepagents as-is, bypassing its internal compilation.
    # Outer-scope state for deferred GP sub-agent compilation.  The HITL
    # branch compiles explicit sub-agents eagerly but defers GP compilation
    # until sandbox platform tools and MCP tools are available later.
    _hitl_gate: Any = None
    _pending_gp_config: dict[str, Any] | None = None

    transformed_subagents = None
    if checkpointer is not None and approval_checker is not None:
        from graphton.core.subagent import compile_subagent
        from graphton.core.subagent_limiter import SubAgentGate

        _hitl_gate = SubAgentGate()
        gate = _hitl_gate
        compiled_subagents: list[dict[str, Any]] = []

        # 1. Compile explicit sub-agents (if any).
        if subagents is not None:
            for sa in subagents:
                if "runnable" in sa:
                    sa["runnable"] = gate.wrap(sa["runnable"], name=sa.get("name", "pre-compiled"))
                    compiled_subagents.append(sa)
                    continue

                sa_tools = sa.get("tools", list(tools or []))
                sa_name = sa.get("name", "unnamed")
                sa_desc = sa.get("description", f"Sub-agent: {sa_name}")
                sa_prompt = sa.get("system_prompt", "")
                sa_middleware = list(sa.get("middleware", []))

                # Resolve per-sub-agent model override.  When the sub-agent
                # dict carries a "model" key (set by subagent_transformer
                # from SubAgent.model_override), use it instead of the
                # parent's model.  Strings are resolved through
                # parse_model_string() which applies ModelRegistry
                # resolution, provider inference, and Anthropic thinking
                # configuration — the same path as the parent model.
                sa_model_spec = sa.get("model")
                if sa_model_spec is not None:
                    if isinstance(sa_model_spec, str):
                        sa_model = parse_model_string(
                            model=sa_model_spec,
                            max_tokens=max_tokens,
                            temperature=temperature,
                        )
                        logger.info(
                            "Sub-agent '%s' using model override: %s",
                            sa_name,
                            sa_model_spec,
                        )
                    else:
                        sa_model = sa_model_spec
                        logger.info(
                            "Sub-agent '%s' using pre-built model instance: %s",
                            sa_name,
                            type(sa_model_spec).__name__,
                        )
                else:
                    sa_model = model_instance

                if summarization_config is not None and summarization_config.enabled:
                    from graphton.core.summarization_middleware import (
                        ContextSummarizationMiddleware,
                    )
                    sa_middleware.insert(0, ContextSummarizationMiddleware(
                        config=summarization_config,
                        callback=summarization_callback,
                    ))
                    logger.info(
                        "Injected summarization middleware into sub-agent '%s' "
                        "(trigger=%d, target=%d, callback=%s)",
                        sa_name,
                        summarization_config.trigger_threshold,
                        summarization_config.target_tokens,
                        "present" if summarization_callback is not None else "none",
                    )

                compiled_sa = compile_subagent(
                    model=sa_model,
                    tools=sa_tools,
                    system_prompt=sa_prompt,
                    name=sa_name,
                    description=sa_desc,
                    middleware=sa_middleware,
                    recursion_limit=recursion_limit,
                    cost_cap=_cost_cap.for_sub_agent() if _cost_cap is not None else None,
                )
                compiled_sa["runnable"] = gate.wrap(compiled_sa["runnable"], name=sa_name)
                compiled_subagents.append(compiled_sa)

        # 2. Defer general-purpose sub-agent compilation.
        #
        # The GP sub-agent needs the same platform tools (shell, read,
        # write, etc.) and MCP tools as the main agent, but those are
        # created later in this function.  Compiling here with
        # tools=list(tools or []) would produce a sub-agent with ZERO
        # tools (since `tools` is typically None from execute_graphton),
        # causing the model to emit tool calls as raw XML text instead
        # of using native function calling.
        #
        # We store the injection intent and compile after sandbox
        # platform tools and MCP tools are available.
        #
        # compile_subagent uses create_agent (not create_deep_agent),
        # so the GP sub-agent has no `task` tool and cannot recursively
        # spawn sub-sub-agents.
        #
        # We use `system_prompt` (not `enhanced_prompt`) because prompt
        # enhancement adds graphton-specific capability awareness that
        # doesn't apply to sub-agents compiled via create_agent().
        if general_purpose_agent:
            gp_middleware: list[Any] = []
            if summarization_config is not None and summarization_config.enabled:
                from graphton.core.summarization_middleware import (
                    ContextSummarizationMiddleware,
                )
                gp_middleware.insert(0, ContextSummarizationMiddleware(
                    config=summarization_config,
                    callback=summarization_callback,
                ))

            _pending_gp_config = {
                "model": model_instance,
                "system_prompt": _build_gp_system_prompt(system_prompt),
                "middleware": gp_middleware,
                "recursion_limit": recursion_limit,
                "cost_cap": _cost_cap.for_sub_agent() if _cost_cap is not None else None,
            }

        transformed_subagents = compiled_subagents
        logger.info(
            "Compiled %d sub-agent(s) with native interrupt propagation "
            "+ concurrency gate (max %d concurrent) for HITL approval",
            len(compiled_subagents),
            gate._max,
        )
    elif subagents is not None:
        needs_summarization = (
            summarization_config is not None and summarization_config.enabled
        )
        needs_cost_cap = _cost_cap is not None

        if needs_summarization or needs_cost_cap:
            augmented_subagents = []
            for sa in subagents:
                if "runnable" in sa:
                    augmented_subagents.append(sa)
                    continue
                sa_copy = dict(sa)
                sa_mw = list(sa_copy.get("middleware", []))
                if needs_summarization:
                    from graphton.core.summarization_middleware import (
                        ContextSummarizationMiddleware,
                    )
                    sa_mw.insert(0, ContextSummarizationMiddleware(
                        config=summarization_config,
                        callback=summarization_callback,
                    ))
                if needs_cost_cap:
                    sa_mw.append(_cost_cap.for_sub_agent())
                sa_copy["middleware"] = sa_mw
                augmented_subagents.append(sa_copy)
            transformed_subagents = augmented_subagents
            logger.info(
                "Injected middleware into %d sub-agent(s) "
                "(non-HITL path, summarization=%s, cost_cap=%s)",
                len(augmented_subagents),
                needs_summarization,
                needs_cost_cap,
            )
        else:
            transformed_subagents = subagents
    
    # Tracks MCP tool wrappers so the deferred GP sub-agent compilation
    # can include them.  Populated inside the MCP block below.
    mcp_tool_wrappers: list[Any] = []

    # MCP integration (Universal Authentication Framework)
    if mcp_servers and mcp_tools:
        # Import MCP modules only when needed
        from graphton.core.middleware import McpToolsLoader
        from graphton.core.tool_wrappers import (
            create_approval_aware_tool_wrapper,
            create_tool_wrapper,
        )
        
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
            servers=mcp_servers,
            tool_filter=mcp_tools,
            client=mcp_client,
        )
        mcp_middleware_ref = mcp_middleware
        
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
        
        # Generate tool wrappers for requested tools that are actually available.
        # Tools listed in enabled_tools may not exist on the MCP server at runtime
        # (e.g., the server was updated, or resource template names were mistakenly
        # included). Skip missing tools with a warning instead of crashing.
        mcp_tool_wrappers: list[BaseTool] = []
        skipped_tools: list[str] = []
        for server_name, tool_names in mcp_tools.items():
            for tool_name in tool_names:
                if tool_name not in mcp_middleware._tools_cache:
                    skipped_tools.append(tool_name)
                    logger.warning(
                        f"Skipping tool '{tool_name}' from server '{server_name}': "
                        f"not found in MCP server's tools list. This may indicate "
                        f"a resource template name was included in enabled_tools, "
                        f"or the tool was removed from the server."
                    )
                    continue
                if approval_checker is not None:
                    wrapper = create_approval_aware_tool_wrapper(
                        tool_name=tool_name,
                        middleware_instance=mcp_middleware,
                        approval_checker=approval_checker,
                        mcp_server_name=server_name,
                    )
                else:
                    wrapper = create_tool_wrapper(tool_name, mcp_middleware)
                mcp_tool_wrappers.append(wrapper)  # type: ignore[arg-type]
        if skipped_tools:
            logger.warning(
                f"Skipped {len(skipped_tools)} unavailable tool(s): {skipped_tools}. "
                f"Agent will proceed with {len(mcp_tool_wrappers)} available tool(s)."
            )
        
        # Add MCP tools and middleware to the agent
        tools_list.extend(mcp_tool_wrappers)
        # MCP middleware must run first to load tools before agent uses them
        middleware_list.insert(0, mcp_middleware)
        
        # Create resource tools for MCP resource discovery and reading.
        # Always registered when MCP servers are configured (no filtering --
        # all resources are accessible as read-only reference data).
        from graphton.core.resource_tools import create_resource_tools
        
        resource_tools = create_resource_tools(servers=mcp_servers)
        tools_list.extend(resource_tools)
        logger.info(
            "Created %d MCP resource tool(s) for resource discovery and reading",
            len(resource_tools),
        )
    
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
            has_native_thinking=has_native_thinking,
        )
    else:
        enhanced_prompt = system_prompt
    
    # Create sandbox platform tool wrappers if sandbox is configured.
    #
    # Graphton always creates its own platform tool wrappers for sandbox access
    # (read, write, edit, execute, ls, glob, grep) and passes them as explicit
    # tools to deepagents. When approval_checker is provided, these wrappers
    # include HITL approval checks; otherwise they execute directly.
    #
    # deepagents 0.4.x also creates its own FilesystemMiddleware internally.
    # Without a backend, it defaults to in-memory StateBackend which does NOT
    # implement SandboxBackendProtocol.  This causes FilesystemMiddleware to
    # actively STRIP the execute tool from the model's tool set — even
    # graphton's real sandbox-backed execute tool — because the middleware
    # filters by tool name ("execute") without distinguishing providers.
    #
    # To prevent this, we wrap graphton's backend in a DeepAgentsBackendAdapter
    # that implements SandboxBackendProtocol and pass it as `backend` to
    # deepagents.  This ensures:
    #   1. FilesystemMiddleware._supports_execution() returns True
    #   2. The execute tool is NOT filtered from the model's tool set
    #   3. Sub-agents inherit the real backend through middleware propagation
    #   4. deepagents' own filesystem tools are backed by the real workspace
    #
    # Graphton's explicit tools (read, write, edit, execute + aliases) still
    # take precedence over middleware-created tools in LangChain's ToolNode.
    deepagents_backend = None
    sandbox_backend = None
    if sandbox_config:
        from graphton.core.backends.deepagents_adapter import DeepAgentsBackendAdapter
        from graphton.core.sandbox_factory import create_sandbox_backend
        from graphton.core.tool_wrappers import create_platform_tool_wrappers
        
        sandbox_backend = create_sandbox_backend(sandbox_config)
        platform_tools = create_platform_tool_wrappers(
            backend=sandbox_backend,
            approval_checker=approval_checker,
        )
        tools_list.extend(platform_tools)
        
        deepagents_backend = DeepAgentsBackendAdapter(sandbox_backend)
        
        from deepagents.backends.protocol import (  # type: ignore[import-untyped]
            SandboxBackendProtocol as _SandboxProto,
        )
        
        if not isinstance(deepagents_backend, _SandboxProto):
            raise TypeError(
                f"DeepAgentsBackendAdapter ({type(deepagents_backend).__mro__}) "
                f"does not satisfy SandboxBackendProtocol. "
                f"FilesystemMiddleware will strip the execute tool."
            )
        
        logger.info(
            "Created %d platform tool wrapper(s) for sandbox "
            "(approval_checker=%s, deepagents_backend=%s, "
            "protocol_compliant=True)",
            len(platform_tools),
            "enabled" if approval_checker else "disabled",
            type(deepagents_backend).__name__,
        )
    
    # Auto-inject think tool for structured reasoning — only when the model
    # does NOT have native extended thinking.  When native thinking is active,
    # reasoning is handled by the Anthropic API itself and the agent-runner's
    # StatusBuilder translates the resulting thinking blocks into synthetic
    # think ToolCalls, giving the same downstream visibility without the
    # extra tool-call round-trip.
    if not has_native_thinking:
        think_tool = create_think_tool()
        tools_list.append(think_tool)
        logger.info("Auto-injected think tool for structured reasoning")
    else:
        logger.info(
            "Skipping think tool injection — model has native extended thinking"
        )

    # ── Deferred GP sub-agent compilation ──────────────────────────────
    # The HITL branch stored the GP injection intent above.  Now that
    # sandbox platform tools and MCP tools are available, compile the
    # GP sub-agent with the full tool set.  This ensures the model uses
    # native function calling instead of outputting raw XML text.
    if _pending_gp_config is not None and _hitl_gate is not None:
        from graphton.core.subagent import compile_subagent

        gp_tools: list[Any] = []

        if sandbox_backend is not None:
            from graphton.core.tool_wrappers import create_platform_tool_wrappers
            gp_platform_tools = create_platform_tool_wrappers(
                backend=sandbox_backend,
                approval_checker=approval_checker,
                sub_agent_name="general-purpose",
            )
            gp_tools.extend(gp_platform_tools)

        if mcp_tool_wrappers:
            gp_tools.extend(mcp_tool_wrappers)

        if not has_native_thinking:
            gp_tools.append(create_think_tool())

        if gp_tools:
            gp_sa = compile_subagent(
                model=_pending_gp_config["model"],
                tools=gp_tools,
                system_prompt=_pending_gp_config["system_prompt"],
                name="general-purpose",
                description=(
                    "General-purpose sub-agent with the same capabilities "
                    "as the main agent. Use for multi-step tasks that "
                    "benefit from context isolation or parallelism."
                ),
                middleware=_pending_gp_config["middleware"],
                recursion_limit=_pending_gp_config.get("recursion_limit"),
                cost_cap=_pending_gp_config.get("cost_cap"),
            )
            gp_sa["runnable"] = _hitl_gate.wrap(
                gp_sa["runnable"], name="general-purpose",
            )
            if transformed_subagents is not None:
                transformed_subagents.append(gp_sa)
            logger.info(
                "Injected gated general-purpose sub-agent "
                "(tools=%d, model=%s)",
                len(gp_tools),
                type(_pending_gp_config["model"]).__name__,
            )
        else:
            logger.warning(
                "Skipping general-purpose sub-agent injection — "
                "no sandbox or MCP tools available. Without tools, "
                "the GP sub-agent would output raw text instead of "
                "using native function calling."
            )

    # ── Tool count observability ────────────────────────────────────────
    # Shared with compile_subagent via audit_tool_set: warns when tool
    # count is high (>25) and truncates overly verbose descriptions.
    from graphton.core.subagent import audit_tool_set

    audit_tool_set(tools_list, context_label="main-agent")

    # Create the Deep Agent using deepagents library.
    #
    # deepagents 0.4.x internally creates SubAgentMiddleware and
    # FilesystemMiddleware.  When `backend` is provided,
    # FilesystemMiddleware uses it instead of the default StateBackend.
    # This is critical: without a SandboxBackendProtocol-compliant
    # backend, the middleware strips the execute tool from the model's
    # tool set (both main agent and sub-agents).
    #
    # General-purpose sub-agent handling:
    #   deepagents auto-creates an ungated general-purpose sub-agent
    #   when no subagent named "general-purpose" is present.  In the
    #   HITL path above, we inject our own gated "general-purpose"
    #   CompiledSubAgent so deepagents skips auto-creation.  In the
    #   non-HITL path, deepagents' default behaviour is acceptable.
    #
    # The recursion_limit for subagent graphs defaults to
    # DEFAULT_RECURSION_LIMIT (10,000 as of langgraph 1.0.x).
    # Graphton applies an explicit recursion_limit via with_config()
    # below to control the top-level graph's limit independently.
    agent = deepagents_create_deep_agent(
        model=model_instance,
        tools=tools_list,
        system_prompt=enhanced_prompt,
        middleware=middleware_list,
        subagents=transformed_subagents or [],
        context_schema=context_schema,
        checkpointer=checkpointer,
        backend=deepagents_backend,
    )
    
    # Apply recursion limit to the top-level graph.
    #
    # When recursion_limit is None (default), we set a very high value
    # (10,000,000) to be effectively unlimited.  We MUST explicitly call
    # with_config because deepagents internally sets its own recursion_limit
    # which would otherwise apply a much lower ceiling.
    #
    # LangGraph's merge_configs strips values equal to
    # DEFAULT_RECURSION_LIMIT (10,000), so we avoid that exact value.
    # 10,000,000 is not equal to 10,000 and will be preserved.
    unlimited = 10_000_000
    effective_limit = recursion_limit if recursion_limit is not None else unlimited
    configured_agent = agent.with_config({"recursion_limit": effective_limit})
    logger.info(
        "Graphton agent configured: recursion_limit=%d%s",
        effective_limit,
        " (unlimited)" if recursion_limit is None else "",
    )

    # Expose MCP middleware (if any) so callers can explicitly close its
    # AsyncExitStack during forced shutdown.  During normal execution the
    # middleware's aafter_agent hook handles cleanup, but when Temporal
    # cancels an activity (e.g. worker SIGTERM) that hook is skipped and
    # the exit stack leaks.  See MCP SDK issue #577.
    configured_agent._graphton_mcp_middleware = mcp_middleware_ref  # type: ignore[attr-defined]

    return configured_agent  # type: ignore[no-any-return]

