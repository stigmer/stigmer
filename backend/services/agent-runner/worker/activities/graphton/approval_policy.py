"""
Tool approval policy resolution for HITL (Human-in-the-Loop) approval flow.

This module provides pure functions to determine whether a tool requires
user approval before execution, based on the policy chain:

    1. AgentExecution.auto_approve_all (highest priority - runtime bypass)
    2. Agent.McpServerUsage.tool_approval_overrides (per-agent customization)
    3. McpServer.default_tool_approvals (platform/org defaults)

The policy chain allows fine-grained control at each level:
- Platform admins set safe defaults on MCP servers
- Agent authors customize for their specific use cases
- Users can bypass all approvals at execution time when appropriate

Example policy resolution:

    # GitHub MCP server has default approval for "delete_repository"
    # Agent overrides to disable approval (trusted deployment agent)
    # Result: No approval required

    # Database MCP server has no default for "execute_sql"
    # Agent adds approval requirement
    # Result: Approval required with custom message

Design principles:
- Pure functions with no I/O for easy testing
- Explicit evaluation order matching the documented policy chain
- Safe defaults: when in doubt, don't require approval (let config decide)
"""

import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphton.core.tool_wrappers import ApprovalRequirement as GraphtonApprovalRequirement

logger = logging.getLogger(__name__)


# =============================================================================
# Platform Tool Defaults
# =============================================================================
# 
# Platform tools are sandbox/filesystem tools provided by the deepagents library.
# These tools bypass MCP server configuration but still need approval policies.
# 
# For MVP, we hardcode sensible defaults:
# - Safe tools (read, ls, glob, grep): No approval needed
# - Dangerous tools (write, edit, execute): Require approval by default
#
# `auto_approve_all: true` on AgentExecutionSpec bypasses all platform tool approvals.
#
# Future enhancement: Allow user configuration via AgentSpec.platform_tool_approvals

PLATFORM_TOOL_DEFAULTS: dict[str, dict[str, Any]] = {
    # Safe tools - no approval needed (read-only operations)
    "read": {"requires_approval": False},
    "ls": {"requires_approval": False},
    "glob": {"requires_approval": False},
    "grep": {"requires_approval": False},
    
    # Dangerous tools - require approval by default (write/execute operations)
    "write": {
        "requires_approval": True,
        "message": "Write file: {{args.path}}",
    },
    "edit": {
        "requires_approval": True,
        "message": "Edit file: {{args.path}}",
    },
    "execute": {
        "requires_approval": True,
        "message": "Execute command: {{args.command}}",
    },
    
    # Agent-internal tools (no external side effects)
    "think": {"requires_approval": False},
}

# Aliases for platform tools.  deepagents registers tools named read_file,
# write_file, edit_file — they share the same implementation (and approval
# policy) as their canonical counterparts read, write, edit.  The aliases
# must be resolved before looking up PLATFORM_TOOL_DEFAULTS so that both
# the status_builder (which sees the LangGraph event tool name, e.g.
# "write_file") and the tool wrapper (which uses the canonical name "write")
# agree on whether approval is required.
PLATFORM_TOOL_ALIASES: dict[str, str] = {
    "read_file": "read",
    "write_file": "write",
    "edit_file": "edit",
}

# Special server name for platform tools (used internally)
PLATFORM_SERVER_NAME = "__platform__"


def resolve_platform_tool_name(tool_name: str) -> str:
    """Resolve a platform tool alias to its canonical name.
    
    For example, "write_file" resolves to "write".
    Non-alias names are returned unchanged.
    
    Args:
        tool_name: Name of the tool (may be an alias)
        
    Returns:
        Canonical platform tool name
    """
    return PLATFORM_TOOL_ALIASES.get(tool_name, tool_name)


def is_platform_tool(tool_name: str) -> bool:
    """Check if a tool is a platform tool (sandbox/filesystem tool).
    
    Resolves aliases first, so both "write" and "write_file" return True.
    
    Args:
        tool_name: Name of the tool (may be an alias)
        
    Returns:
        True if the tool is a known platform tool (or an alias of one)
    """
    return resolve_platform_tool_name(tool_name) in PLATFORM_TOOL_DEFAULTS


@dataclass
class ApprovalConfig:
    """
    Configuration for tool approval policies.
    
    This dataclass holds the approval policy configuration needed by StatusBuilder
    to determine whether tools require approval before execution.
    
    The configuration is assembled from:
    - AgentExecutionSpec: auto_approve_all flag
    - Agent spec: tool_approval_overrides per MCP server
    - MCP server specs: default_tool_approvals
    
    Attributes:
        auto_approve_all: If True, bypass all approval requirements
        tool_approval_overrides: Per-agent tool approval overrides (ToolApprovalOverride protos)
        default_tool_approvals: MCP server default policies, keyed by server slug
        tool_to_mcp_server: Mapping of tool name to MCP server slug (for policy lookup)
    """
    auto_approve_all: bool = False
    tool_approval_overrides: list[Any] = field(default_factory=list)
    default_tool_approvals: dict[str, list[Any]] = field(default_factory=dict)
    tool_to_mcp_server: dict[str, str] = field(default_factory=dict)
    
    def get_mcp_server_for_tool(self, tool_name: str) -> str:
        """
        Get the MCP server slug for a given tool name.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            MCP server slug, or empty string if not found
        """
        return self.tool_to_mcp_server.get(tool_name, "")
    
    def get_default_policies_for_tool(self, tool_name: str) -> list[Any]:
        """
        Get the default approval policies for the MCP server providing a tool.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            List of ToolApprovalPolicy protos for the tool's MCP server
        """
        mcp_server = self.get_mcp_server_for_tool(tool_name)
        if not mcp_server:
            return []
        return self.default_tool_approvals.get(mcp_server, [])


def build_approval_config(
    execution: Any,
    mcp_server_usages: list[Any],
    mcp_servers: list[Any],
    mcp_tools_config: Mapping[str, list[str] | None],
) -> ApprovalConfig:
    """
    Build ApprovalConfig from execution context.
    
    Assembles the approval policy chain configuration from multiple sources:
    
    1. execution.spec.auto_approve_all - Runtime bypass flag (highest priority)
    2. mcp_server_usages[].tool_approval_overrides - Per-agent customization
    3. mcp_servers[].spec.default_tool_approvals - Platform/org defaults
    4. mcp_tools_config - Tool-to-MCP-server mapping (inverted for lookup)
    
    The resulting ApprovalConfig is passed to StatusBuilder to enable
    tool approval detection during execution.
    
    This function is designed to be pure with no I/O, accepting proto objects
    or mock objects for easy testing.
    
    Args:
        execution: The AgentExecution protobuf containing spec.auto_approve_all
        mcp_server_usages: List of McpServerUsage protos from agent spec
        mcp_servers: List of McpServer protos fetched via gRPC
        mcp_tools_config: Mapping of server slug to list of enabled tool names
        
    Returns:
        ApprovalConfig with assembled policy data
        
    Example:
        >>> config = build_approval_config(
        ...     execution=execution,
        ...     mcp_server_usages=agent.spec.mcp_server_usages,
        ...     mcp_servers=fetched_servers,
        ...     mcp_tools_config={"github": ["list_repos", "delete_repo"]},
        ... )
        >>> config.auto_approve_all
        False
        >>> config.get_mcp_server_for_tool("delete_repo")
        "github"
    """
    # 1. Extract auto_approve_all from execution spec
    # Safe access - defaults to False if not set
    auto_approve_all = False
    try:
        auto_approve_all = bool(execution.spec.auto_approve_all)
    except AttributeError:
        pass  # Field not present, use default
    
    # 2. Collect tool_approval_overrides from all MCP server usages
    # Each usage can have per-tool overrides for its MCP server
    tool_approval_overrides: list[Any] = []
    for usage in mcp_server_usages:
        try:
            if hasattr(usage, 'tool_approval_overrides') and usage.tool_approval_overrides:
                tool_approval_overrides.extend(usage.tool_approval_overrides)
        except (AttributeError, TypeError):
            pass  # Skip if field doesn't exist or isn't iterable
    
    # 3. Build default_tool_approvals dict keyed by server slug
    # Maps MCP server slug -> list of ToolApprovalPolicy protos
    default_tool_approvals: dict[str, list[Any]] = {}
    for server in mcp_servers:
        try:
            # Get the server slug from metadata
            slug = ""
            if hasattr(server, 'metadata') and hasattr(server.metadata, 'slug'):
                slug = server.metadata.slug
            elif hasattr(server, 'metadata') and hasattr(server.metadata, 'name'):
                # Fallback to name if slug not available
                slug = server.metadata.name
            
            if not slug:
                continue
            
            # Get default_tool_approvals from spec
            if hasattr(server, 'spec') and hasattr(server.spec, 'default_tool_approvals'):
                policies = server.spec.default_tool_approvals
                if policies:
                    default_tool_approvals[slug] = list(policies)
        except (AttributeError, TypeError):
            pass  # Skip malformed server
    
    # 4. Build tool_to_mcp_server mapping by inverting mcp_tools_config
    # mcp_tools_config: {server_slug: [tool1, tool2, ...]}
    # tool_to_mcp_server: {tool_name: server_slug}
    tool_to_mcp_server: dict[str, str] = {}
    for server_slug, tool_names in mcp_tools_config.items():
        if tool_names:
            for tool_name in tool_names:
                tool_to_mcp_server[tool_name] = server_slug
    
    logger.debug(
        f"Built ApprovalConfig: auto_approve_all={auto_approve_all}, "
        f"overrides={len(tool_approval_overrides)}, "
        f"default_policies={len(default_tool_approvals)} servers, "
        f"tool_mapping={len(tool_to_mcp_server)} tools"
    )
    
    return ApprovalConfig(
        auto_approve_all=auto_approve_all,
        tool_approval_overrides=tool_approval_overrides,
        default_tool_approvals=default_tool_approvals,
        tool_to_mcp_server=tool_to_mcp_server,
    )


@dataclass(frozen=True)
class ApprovalRequirement:
    """
    Result of approval policy resolution for a specific tool.
    
    Attributes:
        requires_approval: Whether the tool requires user approval before execution.
        message: Human-readable message to display when requesting approval.
                 May contain rendered {{args.field}} placeholders.
        source: Where this requirement came from (for debugging/logging).
                One of: "auto_approve_all", "agent_override", "mcp_default", "platform_default", "none"
        mcp_server: Name of the MCP server providing this tool (or "__platform__" for sandbox tools).
    """
    requires_approval: bool
    message: str
    source: str
    mcp_server: str = ""


# Default message template when no custom message is provided
DEFAULT_APPROVAL_MESSAGE_TEMPLATE = "Execute tool: {tool_name}"


def resolve_tool_approval(
    tool_name: str,
    mcp_server_name: str,
    auto_approve_all: bool,
    tool_approval_overrides: list[Any],
    default_tool_approvals: list[Any],
) -> ApprovalRequirement:
    """
    Resolve whether a tool requires approval based on the policy chain.
    
    Evaluates policies in order of precedence (highest to lowest):
    1. auto_approve_all - Runtime bypass (if True, no approval needed)
    2. tool_approval_overrides - Per-agent customization
    3. default_tool_approvals - MCP server defaults
    4. platform_default - Hardcoded defaults for sandbox/platform tools (NEW)
    
    Args:
        tool_name: Name of the tool being invoked (e.g., "delete_repository")
        mcp_server_name: Slug of the MCP server providing this tool (or "__platform__" for platform tools)
        auto_approve_all: If True, bypass all approval requirements
        tool_approval_overrides: List of ToolApprovalOverride protos from Agent spec
        default_tool_approvals: List of ToolApprovalPolicy protos from MCP server spec
    
    Returns:
        ApprovalRequirement with resolved approval status and message
    
    Example:
        >>> requirement = resolve_tool_approval(
        ...     tool_name="delete_repository",
        ...     mcp_server_name="github",
        ...     auto_approve_all=False,
        ...     tool_approval_overrides=[],  # No agent overrides
        ...     default_tool_approvals=[policy],  # MCP default requires approval
        ... )
        >>> requirement.requires_approval
        True
        >>> requirement.source
        'mcp_default'
        
        >>> # Platform tool example
        >>> requirement = resolve_tool_approval(
        ...     tool_name="write",
        ...     mcp_server_name="__platform__",
        ...     auto_approve_all=False,
        ...     tool_approval_overrides=[],
        ...     default_tool_approvals=[],
        ... )
        >>> requirement.requires_approval
        True
        >>> requirement.source
        'platform_default'
    """
    # Priority 1: auto_approve_all bypasses everything
    if auto_approve_all:
        return ApprovalRequirement(
            requires_approval=False,
            message="",
            source="auto_approve_all",
            mcp_server=mcp_server_name,
        )
    
    # Priority 2: Check agent-level overrides
    override = _find_tool_override(tool_name, tool_approval_overrides)
    if override is not None:
        requires_approval = _get_override_requires_approval(override)
        if requires_approval:
            # Get message from override, fall back to MCP default, then auto-generate
            message = _get_override_message(override)
            if not message:
                # Try to get message from MCP default
                mcp_policy = _find_mcp_policy(tool_name, default_tool_approvals)
                if mcp_policy is not None:
                    message = _get_policy_message(mcp_policy)
            if not message:
                message = DEFAULT_APPROVAL_MESSAGE_TEMPLATE.format(tool_name=tool_name)
            
            logger.info(
                f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
                f"result=REQUIRED source=agent_override"
            )
            return ApprovalRequirement(
                requires_approval=True,
                message=message,
                source="agent_override",
                mcp_server=mcp_server_name,
            )
        else:
            return ApprovalRequirement(
                requires_approval=False,
                message="",
                source="agent_override",
                mcp_server=mcp_server_name,
            )
    
    # Priority 3: Check MCP server defaults
    mcp_policy = _find_mcp_policy(tool_name, default_tool_approvals)
    if mcp_policy is not None:
        message = _get_policy_message(mcp_policy)
        if not message:
            message = DEFAULT_APPROVAL_MESSAGE_TEMPLATE.format(tool_name=tool_name)
        
        logger.info(
            f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
            f"result=REQUIRED source=mcp_default"
        )
        return ApprovalRequirement(
            requires_approval=True,
            message=message,
            source="mcp_default",
            mcp_server=mcp_server_name,
        )
    
    # Priority 4: Check platform tool defaults (sandbox/filesystem tools)
    # Resolve aliases (e.g. "write_file" -> "write") so that both the
    # status_builder (which sees the LangGraph event name) and the tool
    # wrapper (which uses the canonical name) hit the same policy entry.
    resolved_name = resolve_platform_tool_name(tool_name)
    if resolved_name in PLATFORM_TOOL_DEFAULTS:
        platform_config = PLATFORM_TOOL_DEFAULTS[resolved_name]
        requires_approval = platform_config.get("requires_approval", False)
        
        if requires_approval:
            message = platform_config.get("message", "")
            if not message:
                message = DEFAULT_APPROVAL_MESSAGE_TEMPLATE.format(tool_name=tool_name)
            
            logger.info(
                f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
                f"result=REQUIRED source=platform_default"
            )
            return ApprovalRequirement(
                requires_approval=True,
                message=message,
                source="platform_default",
                mcp_server=PLATFORM_SERVER_NAME,
            )
        else:
            return ApprovalRequirement(
                requires_approval=False,
                message="",
                source="platform_default",
                mcp_server=PLATFORM_SERVER_NAME,  # Use platform server marker
            )
    
    return ApprovalRequirement(
        requires_approval=False,
        message="",
        source="none",
        mcp_server=mcp_server_name,
    )


def render_approval_message(
    template: str,
    tool_name: str,
    tool_args: dict[str, Any],
) -> str:
    """
    Render approval message template with tool arguments.
    
    Replaces {{args.field}} placeholders with actual argument values.
    Missing arguments are replaced with "<unknown>".
    
    Supported placeholders:
        {{tool_name}} - The tool name (always available)
        {{args.field_name}} - Tool argument value
        {{args.nested.field}} - Nested argument value (dot notation)
    
    Args:
        template: Message template with {{placeholders}}
        tool_name: Name of the tool (for {{tool_name}} placeholder)
        tool_args: Tool arguments dictionary
    
    Returns:
        Rendered message with placeholders replaced
    
    Example:
        >>> render_approval_message(
        ...     "Delete {{args.repo}} from {{args.owner}}",
        ...     "delete_repository",
        ...     {"repo": "my-repo", "owner": "acme"}
        ... )
        'Delete my-repo from acme'
        
        >>> render_approval_message(
        ...     "Send to {{args.recipient}}",
        ...     "send_email",
        ...     {}  # Missing argument
        ... )
        'Send to <unknown>'
    """
    if not template:
        return DEFAULT_APPROVAL_MESSAGE_TEMPLATE.format(tool_name=tool_name)
    
    result = template
    
    # Replace {{tool_name}} placeholder
    result = result.replace("{{tool_name}}", tool_name)
    
    # Find and replace all {{args.xxx}} placeholders
    # Pattern matches: {{args.field}} or {{args.nested.field}}
    pattern = r"\{\{args\.([a-zA-Z0-9_.]+)\}\}"
    
    def replace_arg(match: re.Match) -> str:
        """Replace a single {{args.xxx}} placeholder."""
        field_path = match.group(1)
        value = _get_nested_value(tool_args, field_path)
        if value is None:
            return "<unknown>"
        return _format_value(value)
    
    result = re.sub(pattern, replace_arg, result)
    
    return result


def _find_tool_override(
    tool_name: str,
    overrides: list[Any],
) -> Any | None:
    """
    Find a ToolApprovalOverride for the given tool name.
    
    Args:
        tool_name: Name of the tool to find
        overrides: List of ToolApprovalOverride protos
    
    Returns:
        Matching override proto, or None if not found
    """
    for override in overrides:
        override_tool_name = _get_override_tool_name(override)
        if override_tool_name == tool_name:
            return override
    return None


def _find_mcp_policy(
    tool_name: str,
    policies: list[Any],
) -> Any | None:
    """
    Find a ToolApprovalPolicy for the given tool name.
    
    Args:
        tool_name: Name of the tool to find
        policies: List of ToolApprovalPolicy protos
    
    Returns:
        Matching policy proto, or None if not found
    """
    for policy in policies:
        policy_tool_name = _get_policy_tool_name(policy)
        if policy_tool_name == tool_name:
            return policy
    return None


def _get_nested_value(data: dict[str, Any], field_path: str) -> Any | None:
    """
    Get a nested value from a dictionary using dot notation.
    
    Args:
        data: Dictionary to search
        field_path: Dot-separated path (e.g., "user.email")
    
    Returns:
        Value at path, or None if not found
    
    Example:
        >>> _get_nested_value({"user": {"email": "a@b.com"}}, "user.email")
        'a@b.com'
        >>> _get_nested_value({"name": "test"}, "missing")
        None
    """
    parts = field_path.split(".")
    current: Any = data
    
    for part in parts:
        if not isinstance(current, dict):
            return None
        if part not in current:
            return None
        current = current[part]
    
    return current


def _format_value(value: Any) -> str:
    """
    Format a value for display in approval message.
    
    Handles various types:
    - Strings are returned as-is
    - Numbers are converted to string
    - Lists are joined with commas
    - Dicts show key count
    - None becomes "<unknown>"
    
    Args:
        value: Value to format
    
    Returns:
        Formatted string representation
    """
    if value is None:
        return "<unknown>"
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        if len(value) == 0:
            return "[]"
        if len(value) <= 3:
            return ", ".join(_format_value(v) for v in value)
        return f"{_format_value(value[0])}, ... ({len(value)} items)"
    if isinstance(value, dict):
        return f"{{...}} ({len(value)} keys)"
    return str(value)


# ─────────────────────────────────────────────────────────────────────────────
# Proto Field Accessors
#
# These helper functions abstract proto field access, supporting both:
# - Proto message objects (attributes)
# - Dict representations (keys)
#
# This enables easier testing with mock data while working with real protos.
# ─────────────────────────────────────────────────────────────────────────────

def _get_override_tool_name(override: Any) -> str:
    """Get tool_name from ToolApprovalOverride (proto or dict)."""
    if isinstance(override, dict):
        return override.get("tool_name", "")
    return getattr(override, "tool_name", "")


def _get_override_requires_approval(override: Any) -> bool:
    """Get requires_approval from ToolApprovalOverride (proto or dict)."""
    if isinstance(override, dict):
        return override.get("requires_approval", False)
    return getattr(override, "requires_approval", False)


def _get_override_message(override: Any) -> str:
    """Get message from ToolApprovalOverride (proto or dict)."""
    if isinstance(override, dict):
        return override.get("message", "")
    return getattr(override, "message", "")


def _get_policy_tool_name(policy: Any) -> str:
    """Get tool_name from ToolApprovalPolicy (proto or dict)."""
    if isinstance(policy, dict):
        return policy.get("tool_name", "")
    return getattr(policy, "tool_name", "")


def _get_policy_message(policy: Any) -> str:
    """Get message from ToolApprovalPolicy (proto or dict)."""
    if isinstance(policy, dict):
        return policy.get("message", "")
    return getattr(policy, "message", "")


# =============================================================================
# Approval Checker Factory (Phase 3B - HITL Tool Approval)
# =============================================================================


def create_approval_checker(
    approval_config: ApprovalConfig,
) -> "Callable[[str, dict[str, Any]], GraphtonApprovalRequirement]":
    """
    Create an approval checker function from ApprovalConfig.
    
    This factory creates a callable that can be passed to graphton's
    create_deep_agent to enable HITL (human-in-the-loop) tool approval flow.
    
    The returned checker evaluates the approval policy chain:
    1. auto_approve_all - Bypasses all approvals
    2. tool_approval_overrides - Per-agent customization
    3. default_tool_approvals - MCP server defaults
    
    Args:
        approval_config: ApprovalConfig containing policy data
        
    Returns:
        A callable (tool_name, tool_args) -> ApprovalRequirement
        
    Example:
        >>> config = build_approval_config(execution, usages, servers, tools_config)
        >>> checker = create_approval_checker(config)
        >>> 
        >>> # Pass to graphton agent creation
        >>> agent = create_deep_agent(
        ...     model="claude-sonnet-4.5",
        ...     system_prompt="...",
        ...     approval_checker=checker,  # Enable HITL approval
        ... )
        
        >>> # The checker is called for each tool invocation
        >>> requirement = checker("delete_resource", {"id": "res-123"})
        >>> requirement.requires_approval
        True
    """
    def _check_tool_approval(
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> "GraphtonApprovalRequirement":
        """
        Check if a tool requires approval based on the approval config.
        
        This is the callable returned by create_approval_checker.
        """
        # Get MCP server for this tool
        mcp_server = approval_config.get_mcp_server_for_tool(tool_name)
        
        # Get default policies for this tool's MCP server
        default_policies = approval_config.get_default_policies_for_tool(tool_name)
        
        # Resolve approval requirement using policy chain
        requirement = resolve_tool_approval(
            tool_name=tool_name,
            mcp_server_name=mcp_server,
            auto_approve_all=approval_config.auto_approve_all,
            tool_approval_overrides=approval_config.tool_approval_overrides,
            default_tool_approvals=default_policies,
        )
        
        # Render message template with actual tool arguments
        if requirement.requires_approval and requirement.message:
            rendered_message = render_approval_message(
                template=requirement.message,
                tool_name=tool_name,
                tool_args=tool_args,
            )
            # Create new requirement with rendered message
            requirement = ApprovalRequirement(
                requires_approval=True,
                message=rendered_message,
                source=requirement.source,
            )
        
        # Convert to graphton's ApprovalRequirement format
        # graphton expects: requires_approval, message, mcp_server, source
        # We need to add mcp_server to the result
        from graphton.core.tool_wrappers import ApprovalRequirement as GraphtonRequirement
        
        return GraphtonRequirement(
            requires_approval=requirement.requires_approval,
            message=requirement.message,
            mcp_server=mcp_server,
            source=requirement.source,
        )
    
    return _check_tool_approval
