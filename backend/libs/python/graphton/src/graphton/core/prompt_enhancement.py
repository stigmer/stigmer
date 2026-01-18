"""System prompt enhancement for Deep Agent capabilities.

This module provides functionality to automatically enrich user-provided instructions
with high-level awareness of Deep Agents' built-in capabilities, including planning
tools, file system operations, and MCP tool integration.

The enhancement philosophy:
- Always append (don't try to detect redundancy - LLMs handle overlap gracefully)
- Keep it minimal and high-level (under 150 words)
- Focus on WHEN/WHY to use capabilities, not HOW (middleware handles the details)
- User instructions come first, capability context added after
"""


def enhance_user_instructions(
    user_instructions: str,
    has_mcp_tools: bool = False,
    has_sandbox: bool = False,
) -> str:
    """Enhance user instructions with awareness of Deep Agents capabilities.
    
    This function automatically appends high-level context about available
    capabilities to user-provided instructions. This ensures agents understand
    what tools they have access to and when to use them, without requiring
    users to know Deep Agents framework internals.
    
    The enhancement is intentionally minimal and strategic:
    - Planning system: For breaking down multi-step work
    - File system: For context management and large content handling
    - MCP tools: Conditional mention when MCP tools are configured
    
    Args:
        user_instructions: The user's original instructions for the agent.
            These are preserved as-is and placed first in the result.
        has_mcp_tools: Whether the agent has MCP tools configured. When True,
            adds awareness about domain-specific MCP capabilities.
        has_sandbox: Whether the agent has sandbox backend configured. When True,
            adds awareness about execute tool for running shell commands.
    
    Returns:
        Enhanced instructions combining user content with capability awareness.
        Structure: [User Instructions] + [Capability Context]
    
    Examples:
        Basic enhancement without MCP tools:
        
        >>> instructions = "You are a helpful research assistant."
        >>> enhanced = enhance_user_instructions(instructions, has_mcp_tools=False)
        >>> "planning system" in enhanced.lower()
        True
        >>> "file system" in enhanced.lower()
        True
        
        Enhancement with MCP tools:
        
        >>> instructions = "You help manage cloud resources."
        >>> enhanced = enhance_user_instructions(instructions, has_mcp_tools=True)
        >>> "mcp tools" in enhanced.lower()
        True
    
    Note:
        If user instructions already mention planning or file system, some
        redundancy will occur. This is intentional and acceptable - LLMs
        handle redundant information gracefully, and reinforcement is better
        than missing critical context.

    """
    if not user_instructions or not user_instructions.strip():
        raise ValueError("user_instructions cannot be empty")
    
    # Build capability awareness section
    capability_sections = []
    
    # Always include planning system awareness
    capability_sections.append(
        "**Planning System**: For complex or multi-step tasks, you have access to a "
        "planning system (write_todos, read_todos). Use it to break down work, track "
        "progress, and manage task complexity. Skip it for simple single-step tasks."
    )
    
    # Always include file system awareness
    capability_sections.append(
        "**File System**: You have file system tools (ls, read_file, write_file, "
        "edit_file, glob, grep) for managing information across your work. Use the "
        "file system to store large content, offload context, and maintain state "
        "between operations. All file paths must start with '/'."
    )
    
    # Conditionally include MCP tools awareness
    if has_mcp_tools:
        capability_sections.append(
            "**MCP Tools**: You have access to MCP (Model Context Protocol) tools "
            "configured specifically for this agent. These are domain-specific tools "
            "for specialized operations. Use them to accomplish tasks that require "
            "external system integration or specialized capabilities."
        )
    
    # Conditionally include execute tool awareness
    if has_sandbox:
        capability_sections.append(
            "**Execute Tool**: You have access to a secure sandbox environment "
            "where you can run shell commands using the execute tool. Use this for "
            "running scripts, tests, builds, package installations, and other command-line "
            "operations. The sandbox is isolated and secure."
        )
    
    # Combine user instructions with capability awareness
    capability_context = "\n\n## Your Capabilities\n\n" + "\n\n".join(capability_sections)
    
    return user_instructions + "\n" + capability_context




