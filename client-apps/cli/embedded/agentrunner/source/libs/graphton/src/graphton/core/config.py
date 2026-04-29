"""Configuration models for agent creation.

This module provides Pydantic models for validating agent configuration.
It accepts raw MCP server configurations without enforcing specific structure,
allowing the framework to work with any MCP server format and authentication method.
"""

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

if TYPE_CHECKING:
    pass


class AgentConfig(BaseModel):
    """Top-level configuration for agent creation.
    
    This model validates all parameters for create_deep_agent() and provides
    helpful error messages with suggestions for common mistakes.
    
    Attributes:
        model: Model name string or LangChain model instance
        system_prompt: System prompt defining agent behavior
        mcp_servers: Optional dict of raw MCP server configurations. Accepts any
            format compatible with the MCP client. Supports template variables
            like {{VAR_NAME}} for dynamic token injection at runtime.
        mcp_tools: Optional dict mapping server names to tool lists.
            Server names must match those in mcp_servers.
        tools: Optional list of additional tools
        middleware: Optional list of middleware
        context_schema: Optional state schema for the agent
        sandbox_config: Optional dict configuring sandbox backend for terminal execution.
            When provided, enables the 'execute' tool for running shell commands.
            Format: {"type": "filesystem", "root_dir": "/workspace"}
        recursion_limit: Maximum recursion depth (default: 1000)
        max_tokens: Override default max_tokens for the model
        temperature: Override default temperature for the model
        subagents: Optional list of sub-agent specifications for task delegation
        general_purpose_agent: Whether to include general-purpose sub-agent (default: True)
        loop_history_size: Number of recent tool calls to track for loop detection (default: 20)
        loop_consecutive_threshold: Consecutive identical calls before warning (default: 7)
        loop_total_threshold: Total repetitions before forced stop (default: 20)
        checkpointer: Optional LangGraph checkpointer for interrupt/resume support.
            Required for HITL approval flow. Supports MemorySaver for testing or
            PostgresSaver for production.
    
    Example:
        >>> config = AgentConfig(
        ...     model="gpt-4",
        ...     system_prompt="You are a helpful assistant",
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

    """
    
    model: str | BaseChatModel
    system_prompt: str
    mcp_servers: dict[str, dict[str, Any]] | None = None
    mcp_tools: dict[str, list[str]] | None = None
    tools: Sequence[BaseTool] | None = None
    middleware: Sequence[Any] | None = None
    context_schema: type[Any] | None = None
    sandbox_config: dict[str, Any] | None = None
    recursion_limit: int | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    auto_enhance_prompt: bool = True
    subagents: list[dict[str, Any]] | None = None
    general_purpose_agent: bool = True
    # Loop detection configuration - tuned for self-correcting agents
    loop_history_size: int = 20
    loop_consecutive_threshold: int = 7
    loop_total_threshold: int = 20
    # Execution budget warning — percentage of recursion limit at which the
    # model is asked to wrap up (injected via ExecutionBudgetMiddleware).
    budget_warning_pct: int = 80
    # Checkpointer for interrupt/resume support (HITL approval flow)
    checkpointer: Any | None = None  # Type is BaseCheckpointSaver but using Any for flexibility
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    @field_validator("system_prompt")
    @classmethod
    def validate_system_prompt(cls, v: str) -> str:
        """Validate system prompt is non-empty and meaningful.
        
        Args:
            v: System prompt string
            
        Returns:
            Validated system prompt
            
        Raises:
            ValueError: If prompt is empty or too short
        
        """
        if not v or not v.strip():
            raise ValueError(
                "system_prompt cannot be empty. Provide a clear description "
                "of the agent's role and capabilities."
            )
        if len(v.strip()) < 10:
            raise ValueError(
                f"system_prompt is too short ({len(v)} chars). "
                "Provide at least 10 characters describing the agent's purpose."
            )
        return v
    
    @field_validator("mcp_tools")
    @classmethod
    def validate_mcp_tools_structure(
        cls, v: dict[str, list[str]] | None
    ) -> dict[str, list[str]] | None:
        """Validate MCP tools configuration structure.
        
        Args:
            v: Tools dictionary to validate
            
        Returns:
            Validated tools dictionary
            
        Raises:
            ValueError: If configuration is invalid

        """
        if v is None:
            return v
        
        if not v:
            raise ValueError(
                "mcp_tools cannot be empty. "
                "Specify at least one server with tools or remove mcp_tools parameter."
            )
        
        for server_name, tool_list in v.items():
            # Validate non-empty tool list
            if not tool_list:
                raise ValueError(
                    f"Server '{server_name}' has empty tool list. "
                    "Specify at least one tool to load or remove the server entry."
                )
            
            # Validate tool names are strings
            for tool_name in tool_list:
                if not isinstance(tool_name, str):
                    raise ValueError(
                        f"Tool name must be string, got {type(tool_name).__name__}: {tool_name}"
                    )
                
                if not tool_name or not tool_name.strip():
                    raise ValueError(f"Empty tool name in server '{server_name}'")
            
            # Check for duplicate tool names within server
            if len(tool_list) != len(set(tool_list)):
                duplicates = [t for t in tool_list if tool_list.count(t) > 1]
                raise ValueError(
                    f"Duplicate tool names in server '{server_name}': {set(duplicates)}"
                )
        
        return v
    
    @field_validator("recursion_limit")
    @classmethod
    def validate_recursion_limit(cls, v: int | None) -> int | None:
        """Validate recursion limit is reasonable.
        
        ``None`` (default) means unlimited — loop detection middleware is
        the primary safety mechanism.  When a positive integer is provided,
        LangGraph enforces it as a hard super-step ceiling.
        
        Args:
            v: Recursion limit value, or None for unlimited.
            
        Returns:
            Validated recursion limit (or None).
            
        Raises:
            ValueError: If recursion limit is zero or negative.
        
        """
        if v is None:
            return v
        if v <= 0:
            raise ValueError(
                f"recursion_limit must be positive or None (unlimited), got {v}."
            )
        return v
    
    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, v: float | None) -> float | None:
        """Validate temperature is in valid range.
        
        Args:
            v: Temperature value
            
        Returns:
            Validated temperature
            
        Raises:
            ValueError: If temperature is out of range
        
        """
        if v is not None and (v < 0.0 or v > 2.0):
            raise ValueError(
                f"temperature must be between 0.0 and 2.0, got {v}. "
                "Use 0.0-0.3 for deterministic output, 0.7-1.0 for creative output."
            )
        return v
    
    @field_validator("sandbox_config")
    @classmethod
    def validate_sandbox_config(
        cls, v: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """Validate sandbox configuration structure.
        
        Args:
            v: Sandbox configuration dictionary
            
        Returns:
            Validated sandbox configuration
            
        Raises:
            ValueError: If configuration is invalid
        
        """
        if v is None:
            return v
        
        if not isinstance(v, dict):
            raise ValueError(
                f"sandbox_config must be a dictionary, got {type(v).__name__}"
            )
        
        if not v:
            raise ValueError(
                "sandbox_config cannot be empty. "
                "Specify at least {'type': 'filesystem'} or remove sandbox_config parameter."
            )
        
        if "type" not in v:
            raise ValueError(
                "sandbox_config must include 'type' key. "
                "Supported types: filesystem, modal, runloop, daytona, harbor"
            )
        
        sandbox_type = v["type"]
        if not isinstance(sandbox_type, str):
            raise ValueError(
                f"sandbox_config 'type' must be a string, got {type(sandbox_type).__name__}"
            )
        
        supported_types = {"filesystem", "modal", "runloop", "daytona", "harbor"}
        if sandbox_type not in supported_types:
            raise ValueError(
                f"Unsupported sandbox type: {sandbox_type}. "
                f"Supported types: {', '.join(sorted(supported_types))}"
            )
        
        return v
    
    @field_validator("subagents")
    @classmethod
    def validate_subagents(
        cls, v: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]] | None:
        """Validate sub-agent specifications.
        
        Args:
            v: List of sub-agent specifications
            
        Returns:
            Validated sub-agent list
            
        Raises:
            ValueError: If sub-agent configuration is invalid
        
        """
        if v is None:
            return v
        
        if not isinstance(v, list):
            raise ValueError(
                f"subagents must be a list, got {type(v).__name__}"
            )
        
        # Validate each sub-agent specification
        for i, subagent in enumerate(v):
            if not isinstance(subagent, dict):
                raise ValueError(
                    f"Sub-agent {i} must be a dict, got {type(subagent).__name__}"
                )
            
            # Check required fields
            if "name" not in subagent:
                raise ValueError(
                    f"Sub-agent {i} missing required field 'name'. "
                    "Each sub-agent must have: name, description, system_prompt"
                )
            
            if "description" not in subagent:
                raise ValueError(
                    f"Sub-agent {i} missing required field 'description'. "
                    "Each sub-agent must have: name, description, system_prompt"
                )
            
            if "system_prompt" not in subagent:
                raise ValueError(
                    f"Sub-agent {i} missing required field 'system_prompt'. "
                    "Each sub-agent must have: name, description, system_prompt"
                )
            
            # Validate field types
            if not isinstance(subagent["name"], str) or not subagent["name"].strip():
                raise ValueError(
                    f"Sub-agent {i} 'name' must be a non-empty string"
                )
            
            if not isinstance(subagent["description"], str) or not subagent["description"].strip():
                raise ValueError(
                    f"Sub-agent {i} 'description' must be a non-empty string"
                )
            
            if not isinstance(subagent["system_prompt"], str) or not subagent["system_prompt"].strip():
                raise ValueError(
                    f"Sub-agent {i} 'system_prompt' must be a non-empty string"
                )
        
        # Check for duplicate sub-agent names
        if len(v) > 1:
            names = [s["name"] for s in v]
            if len(names) != len(set(names)):
                duplicates = [name for name in names if names.count(name) > 1]
                raise ValueError(
                    f"Duplicate sub-agent names found: {set(duplicates)}. "
                    "Each sub-agent must have a unique name."
                )
        
        return v
    
    @field_validator("loop_history_size")
    @classmethod
    def validate_loop_history_size(cls, v: int) -> int:
        """Validate loop history size is reasonable.
        
        Args:
            v: History size value
            
        Returns:
            Validated history size
            
        Raises:
            ValueError: If history size is invalid
        
        """
        if v < 5:
            raise ValueError(
                f"loop_history_size must be at least 5, got {v}. "
                "Smaller values provide insufficient context for loop detection."
            )
        if v > 100:
            import warnings
            warnings.warn(
                f"loop_history_size of {v} is very high. "
                "This uses more memory. Recommended range: 10-50.",
                UserWarning,
                stacklevel=2
            )
        return v
    
    @field_validator("loop_consecutive_threshold")
    @classmethod
    def validate_loop_consecutive_threshold(cls, v: int) -> int:
        """Validate consecutive threshold is reasonable.
        
        Args:
            v: Consecutive threshold value
            
        Returns:
            Validated threshold
            
        Raises:
            ValueError: If threshold is invalid
        
        """
        if v < 2:
            raise ValueError(
                f"loop_consecutive_threshold must be at least 2, got {v}. "
                "A value of 1 would trigger on every repeated tool call."
            )
        if v > 20:
            import warnings
            warnings.warn(
                f"loop_consecutive_threshold of {v} is very high. "
                "The agent may get stuck in loops. Recommended range: 3-10.",
                UserWarning,
                stacklevel=2
            )
        return v
    
    @field_validator("loop_total_threshold")
    @classmethod
    def validate_loop_total_threshold(cls, v: int) -> int:
        """Validate total threshold is reasonable.
        
        Args:
            v: Total threshold value
            
        Returns:
            Validated threshold
            
        Raises:
            ValueError: If threshold is invalid
        
        """
        if v < 3:
            raise ValueError(
                f"loop_total_threshold must be at least 3, got {v}. "
                "Smaller values would stop agents too quickly."
            )
        if v > 100:
            import warnings
            warnings.warn(
                f"loop_total_threshold of {v} is very high. "
                "The agent may waste resources on futile retries. Recommended range: 10-50.",
                UserWarning,
                stacklevel=2
            )
        return v
    
    @field_validator("budget_warning_pct")
    @classmethod
    def validate_budget_warning_pct(cls, v: int) -> int:
        """Validate budget warning percentage is in a useful range.
        
        Args:
            v: Warning percentage value
            
        Returns:
            Validated warning percentage
            
        Raises:
            ValueError: If value is outside the 50-95 range
        
        """
        if v < 50 or v > 95:
            raise ValueError(
                f"budget_warning_pct must be between 50 and 95, got {v}. "
                "Values below 50 warn too early; values above 95 leave no "
                "room for the model to wrap up."
            )
        return v
    
    @model_validator(mode="after")
    def validate_loop_thresholds_relationship(self) -> "AgentConfig":
        """Validate that loop thresholds are logically consistent.
        
        Returns:
            Validated AgentConfig instance
            
        Raises:
            ValueError: If threshold relationship is invalid
        
        """
        if self.loop_total_threshold < self.loop_consecutive_threshold:
            raise ValueError(
                f"loop_total_threshold ({self.loop_total_threshold}) must be >= "
                f"loop_consecutive_threshold ({self.loop_consecutive_threshold}). "
                "The total threshold is a hard limit that should be higher than "
                "the warning threshold."
            )
        return self
    
    @model_validator(mode="after")
    def validate_mcp_configuration(self) -> "AgentConfig":
        """Validate MCP server and tools are provided together.
        
        Returns:
            Validated AgentConfig instance
            
        Raises:
            ValueError: If MCP configuration is invalid
        
        """
        has_servers = self.mcp_servers is not None and bool(self.mcp_servers)
        has_tools = self.mcp_tools is not None and bool(self.mcp_tools)
        
        if has_servers and not has_tools:
            raise ValueError(
                "mcp_servers provided but mcp_tools is missing. "
                "Specify which tools to load: mcp_tools={'server-name': ['tool1', 'tool2']}"
            )
        
        if has_tools and not has_servers:
            raise ValueError(
                "mcp_tools provided but mcp_servers is missing. "
                "Configure MCP servers with raw config dicts. "
                "Example: mcp_servers={'server-name': {'url': '...', 'transport': '...'}}"
            )
        
        # Validate server names match between mcp_servers and mcp_tools
        if has_servers and has_tools:
            # Type narrowing: at this point we know both are not None
            assert self.mcp_servers is not None
            assert self.mcp_tools is not None
            
            server_names = set(self.mcp_servers.keys())
            tool_server_names = set(self.mcp_tools.keys())
            
            missing_in_tools = server_names - tool_server_names
            missing_in_servers = tool_server_names - server_names
            
            if missing_in_tools:
                raise ValueError(
                    f"Server(s) configured but no tools specified: {missing_in_tools}. "
                    f"Add tools for these servers in mcp_tools."
                )
            
            if missing_in_servers:
                raise ValueError(
                    f"Tools specified for undefined server(s): {missing_in_servers}. "
                    f"Add server configurations in mcp_servers."
                )
        
        return self
