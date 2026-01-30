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
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


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
    tool_approval_overrides: List[Any] = field(default_factory=list)
    default_tool_approvals: Dict[str, List[Any]] = field(default_factory=dict)
    tool_to_mcp_server: Dict[str, str] = field(default_factory=dict)
    
    def get_mcp_server_for_tool(self, tool_name: str) -> str:
        """
        Get the MCP server slug for a given tool name.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            MCP server slug, or empty string if not found
        """
        return self.tool_to_mcp_server.get(tool_name, "")
    
    def get_default_policies_for_tool(self, tool_name: str) -> List[Any]:
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


@dataclass(frozen=True)
class ApprovalRequirement:
    """
    Result of approval policy resolution for a specific tool.
    
    Attributes:
        requires_approval: Whether the tool requires user approval before execution.
        message: Human-readable message to display when requesting approval.
                 May contain rendered {{args.field}} placeholders.
        source: Where this requirement came from (for debugging/logging).
                One of: "auto_approve_all", "agent_override", "mcp_default", "none"
    """
    requires_approval: bool
    message: str
    source: str


# Default message template when no custom message is provided
DEFAULT_APPROVAL_MESSAGE_TEMPLATE = "Execute tool: {tool_name}"


def resolve_tool_approval(
    tool_name: str,
    mcp_server_name: str,
    auto_approve_all: bool,
    tool_approval_overrides: List[Any],
    default_tool_approvals: List[Any],
) -> ApprovalRequirement:
    """
    Resolve whether a tool requires approval based on the policy chain.
    
    Evaluates policies in order of precedence (highest to lowest):
    1. auto_approve_all - Runtime bypass (if True, no approval needed)
    2. tool_approval_overrides - Per-agent customization
    3. default_tool_approvals - MCP server defaults
    
    Args:
        tool_name: Name of the tool being invoked (e.g., "delete_repository")
        mcp_server_name: Slug of the MCP server providing this tool
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
    """
    # Priority 1: auto_approve_all bypasses everything
    if auto_approve_all:
        logger.debug(
            f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
            f"result=BYPASS source=auto_approve_all"
        )
        return ApprovalRequirement(
            requires_approval=False,
            message="",
            source="auto_approve_all",
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
            
            logger.debug(
                f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
                f"result=REQUIRED source=agent_override"
            )
            return ApprovalRequirement(
                requires_approval=True,
                message=message,
                source="agent_override",
            )
        else:
            # Override explicitly disables approval
            logger.debug(
                f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
                f"result=DISABLED source=agent_override"
            )
            return ApprovalRequirement(
                requires_approval=False,
                message="",
                source="agent_override",
            )
    
    # Priority 3: Check MCP server defaults
    mcp_policy = _find_mcp_policy(tool_name, default_tool_approvals)
    if mcp_policy is not None:
        message = _get_policy_message(mcp_policy)
        if not message:
            message = DEFAULT_APPROVAL_MESSAGE_TEMPLATE.format(tool_name=tool_name)
        
        logger.debug(
            f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
            f"result=REQUIRED source=mcp_default"
        )
        return ApprovalRequirement(
            requires_approval=True,
            message=message,
            source="mcp_default",
        )
    
    # No policy matched - tool does not require approval
    logger.debug(
        f"[APPROVAL] tool={tool_name} server={mcp_server_name} "
        f"result=NOT_REQUIRED source=none"
    )
    return ApprovalRequirement(
        requires_approval=False,
        message="",
        source="none",
    )


def render_approval_message(
    template: str,
    tool_name: str,
    tool_args: Dict[str, Any],
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
    overrides: List[Any],
) -> Optional[Any]:
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
    policies: List[Any],
) -> Optional[Any]:
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


def _get_nested_value(data: Dict[str, Any], field_path: str) -> Optional[Any]:
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
    current = data
    
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
