"""System prompt enhancement for Deep Agent capabilities and resilience.

This module provides functionality to automatically enrich user-provided instructions
with awareness of Deep Agents' capabilities AND comprehensive error recovery strategies.

The enhancement follows Cursor-style patterns:
- Resilience preamble comes FIRST (error recovery philosophy)
- Capability sections are conditional (based on enabled features)
- Error recovery strategies are tool-specific
- User instructions are appended LAST (highest LLM priority)

This structure ensures agents are self-correcting and don't give up on first failure.
"""

# =============================================================================
# RESILIENCE PREAMBLE - Always included (~300 words)
# Core philosophy on error handling, never giving up, trying alternatives
# =============================================================================

RESILIENCE_PREAMBLE = """
## Error Recovery Philosophy

You are a resilient, autonomous agent. Errors are information, not defeat.

### Core Principles

1. **Never give up on first failure** — adapt and try a different approach.
2. **Analyze before retrying** — understand WHY it failed; check error messages for root causes.
3. **Try alternative strategies** — if direct fails, go indirect: read the file first, use `glob` to discover paths, create missing directories.
4. **Validate assumptions** — verify files exist (`ls`), paths are correct (`glob`), and prerequisites are met before acting.
5. **Read before writing** — always understand current state before modifications.

### When a Tool Returns an Error

1. **Parse the error message** for specifics
2. Identify the **root cause** (path? permission? format?)
3. Try a different approach; after 3+ failures, break the problem into smaller pieces

### Never Do This

- Give up after a single failure
- Retry the exact same action without changes
- Assume a path exists without checking
- Edit a file without reading it first
"""

# =============================================================================
# CAPABILITY SECTIONS - Conditional (~50-80 words each)
# Only included when the relevant capability is enabled
# =============================================================================

PLANNING_CAPABILITY = """
**Planning System**: For complex or multi-step tasks, you have access to a planning
system (`write_todos`, `read_todos`). Use it to:
- Break down complex work into manageable steps
- Track progress across multiple operations
- Maintain context when tasks span many tool calls

Skip planning for simple single-step tasks. Use it when the task has 3+ distinct steps.
"""

FILESYSTEM_CAPABILITY = """
**File System**: You have file system tools (`ls`, `read`, `write`, `edit`,
`glob`, `grep`, `search`) for managing information. Always use these canonical
tool names. Do not use `read_file`, `write_file`, or `edit_file` — they are
internal overrides with identical behavior. Use the file system to:
- Store large content that doesn't fit in context
- Maintain state between operations
- Search and discover files across directories

File paths should be workspace-relative (e.g., `.stigmer/inputs/data.txt`,
`.stigmer/skills/my-skill/SKILL.md`). Use the paths exactly as shown in the
Available Skills and Input Files sections.

**Output Discipline**: When you read files, their contents are captured in tool
results already present in your context. NEVER echo, reprint, list, or summarize
file contents in your response text. Proceed directly to analysis and action.

**Context Efficiency**: Every file you read consumes context window budget. Be
strategic:
- Use `search` to find code definitions by concept (classes, functions, types,
  interfaces).  Use `grep` for exact text patterns.
- Use `grep` to locate relevant sections before reading entire files
- Use `glob` to find specific files rather than listing directories manually
- For large files, pass `offset` and `limit` to `read` to fetch only the lines
  you need instead of the entire file
- Prefer targeted reads over broad exploration

**Editing Efficiency**: When modifying existing files, prefer `edit` over
`write`. The `edit` tool replaces only the targeted section — you specify
`old_text` (enough context to locate it uniquely) and `new_text`. This
avoids regenerating unchanged content. Use multiple `edit` calls for
multiple changes in the same file. Reserve `write` for creating new files
or complete rewrites where the structure changes fundamentally.
"""

MCP_TOOLS_CAPABILITY = """
**MCP Tools**: You have access to MCP (Model Context Protocol) tools configured for
specialized operations. These domain-specific tools integrate with external systems.
Use them for tasks requiring:
- External API interactions
- Domain-specific operations
- System integrations beyond file operations

Check tool descriptions to understand their specific capabilities and required parameters.
"""

EXECUTE_CAPABILITY = """
**Execute Tool**: You have access to a secure sandbox environment where you can run
shell commands using the `execute` tool. Use this for:
- Running scripts and tests
- Package installations (`pip install`, `npm install`)
- Build processes and compilation
- Git operations and version control

The sandbox is isolated - changes don't affect the host system. Check command output
for errors and handle them appropriately.

**Pull Request Tool**: When git credentials are configured, you can create GitHub
pull requests with `create_pull_request`. First push your branch via `execute`,
then call `create_pull_request` with a title and body. It discovers the repo and
credentials automatically.
"""

THINK_CAPABILITY = """
**Think Tool**: You have a `think` tool for structured reasoning. It does not read
files or make changes — it simply records your thought so you can reason step-by-step
before acting. Use it when:

- You have just read files or received tool output and need to analyse the results
  before deciding what to do next.
- You are about to perform a complex or multi-step operation and want to plan your
  approach first.
- You need to choose between several strategies and want to weigh the trade-offs.
- You are debugging and need to reason about possible causes before testing a fix.

Do NOT call `think` for every step — only when careful reasoning will meaningfully
improve the quality of your next action.
"""

# =============================================================================
# ERROR RECOVERY STRATEGIES - Conditional per tool type (~150-200 words each)
# Specific recovery patterns for common failure scenarios
# =============================================================================

FILE_RECOVERY_STRATEGIES = """
## File Operation Recovery Strategies

When file operations fail, use these recovery patterns:

### Cannot Edit File
1. **Read first**: Use `read` to see current content and structure
2. **Verify path**: Confirm the file exists with `ls` on the parent directory
3. **Check format**: Ensure your edit matches the file's format (JSON, YAML, etc.)
4. If `edit` fails repeatedly, read the full file and use `write` to replace entirely

### File Not Found
1. **Search with glob**: Use `glob` with patterns like `**/*.py` to find files
2. **Check parent directory**: Use `ls` to verify the directory structure

### Permission Denied
1. **Verify path correctness**: Double-check for typos
2. **Check if it's a directory**: You might be trying to read a directory as a file
3. Try an alternative location if the target is read-only
"""

MCP_RECOVERY_STRATEGIES = """
## MCP Tool Recovery Strategies

When MCP tools fail, use these recovery patterns:

### Authentication Errors
- Verify all required parameters are provided; retry once for transient issues
- If authentication fails repeatedly, report the access issue to the user

### Invalid Parameters
- Review the tool description for required parameters and expected types
- Try with only required parameters, omitting optional ones

### Resource Not Found
- Double-check resource IDs or names; use list/search tools to discover valid resources
- The resource might exist in a different namespace or context

### Rate Limiting / Quota Errors
- Wait and retry (some limits are per-minute); reduce scope if needed

### Timeout Errors
- Retry with a simpler request; report to the user if the service is unresponsive
"""

EXECUTION_RECOVERY_STRATEGIES = """
## Command Execution Recovery Strategies

When shell commands fail, use these recovery patterns:

### Command Not Found
- The tool may not be installed — try installing it first
- Try the full path (`/usr/bin/command`) or check the PATH

### Permission Denied
- Use `ls -la` to check permissions; verify working directory
- The sandbox does not support `sudo`

### Exit Code Non-Zero
- Read stderr for error details; check prerequisites and dependencies

### Timeout / Hung Process
- Add command-specific timeout flags; check if the command is waiting for input

### Missing Dependencies
- Install first (`pip install`, `npm install`); check version requirements
"""


def enhance_user_instructions(
    user_instructions: str,
    has_mcp_tools: bool = False,
    has_sandbox: bool = False,
    has_native_thinking: bool = False,
) -> str:
    """Enhance user instructions with resilience guidance and capability awareness.
    
    This function builds a comprehensive system prompt following Cursor-style patterns:
    1. Resilience preamble (always included) - Error recovery philosophy
    2. Capability sections (conditional) - What tools are available
    3. Error recovery strategies (conditional) - How to handle failures
    4. User instructions (appended last) - Highest priority for the LLM
    
    The resulting prompt ensures agents are self-correcting and resilient,
    trying alternative approaches when initial attempts fail.
    
    Args:
        user_instructions: The user's original instructions for the agent.
            These are preserved exactly and placed LAST in the result for
            maximum LLM attention.
        has_mcp_tools: Whether the agent has MCP tools configured. When True,
            adds MCP capability awareness and MCP-specific recovery strategies.
        has_sandbox: Whether the agent has sandbox backend configured. When True,
            adds execute tool awareness and command execution recovery strategies.
        has_native_thinking: Whether the model has native extended thinking
            enabled (e.g. Anthropic's ``thinking`` parameter).  When True,
            the think tool guidance is omitted because the model reasons
            natively and the explicit think tool is not injected.
    
    Returns:
        Enhanced instructions combining resilience guidance, capabilities,
        recovery strategies, and user content.
        
        Structure:
        [Resilience Preamble]
        [Capability Sections - conditional]
        [Recovery Strategies - conditional]
        [User Instructions]
    
    Examples:
        Basic enhancement (file operations only):
        
        >>> instructions = "You are a helpful research assistant."
        >>> enhanced = enhance_user_instructions(instructions)
        >>> "never give up" in enhanced.lower()
        True
        >>> "file operation recovery" in enhanced.lower()
        True
        
        Enhancement with all capabilities:
        
        >>> instructions = "You help manage cloud resources."
        >>> enhanced = enhance_user_instructions(instructions, has_mcp_tools=True, has_sandbox=True)
        >>> "mcp tool recovery" in enhanced.lower()
        True
        >>> "command execution recovery" in enhanced.lower()
        True
    
    Note:
        The enhanced prompt is ~600-900 words depending on enabled features.
        Guidance is compressed for signal density while preserving recovery
        effectiveness.  LLMs handle this context efficiently (<1% of context window).
    """
    if not user_instructions or not user_instructions.strip():
        raise ValueError("user_instructions cannot be empty")
    
    # Build the enhanced prompt in order of priority (resilience first, user last)
    sections = []
    
    # 1. Resilience preamble - ALWAYS included
    sections.append(RESILIENCE_PREAMBLE.strip())
    
    # 2. Capability sections - conditional based on enabled features
    capabilities = []
    
    # Planning is always available
    capabilities.append(PLANNING_CAPABILITY.strip())
    
    # File system is always available (core capability)
    capabilities.append(FILESYSTEM_CAPABILITY.strip())
    
    # Think tool guidance — only when the explicit tool is injected (i.e. no
    # native thinking).  Models with native extended thinking reason
    # automatically and don't need a tool or prompt instructions for it.
    if not has_native_thinking:
        capabilities.append(THINK_CAPABILITY.strip())
    
    # MCP tools - conditional
    if has_mcp_tools:
        capabilities.append(MCP_TOOLS_CAPABILITY.strip())
    
    # Execute tool - conditional on sandbox
    if has_sandbox:
        capabilities.append(EXECUTE_CAPABILITY.strip())
    
    sections.append("## Your Capabilities\n\n" + "\n\n".join(capabilities))
    
    # 3. Error recovery strategies - conditional per tool type
    recovery_sections = []
    
    # File recovery is always included (core operations)
    recovery_sections.append(FILE_RECOVERY_STRATEGIES.strip())
    
    # MCP recovery - conditional
    if has_mcp_tools:
        recovery_sections.append(MCP_RECOVERY_STRATEGIES.strip())
    
    # Execution recovery - conditional on sandbox
    if has_sandbox:
        recovery_sections.append(EXECUTION_RECOVERY_STRATEGIES.strip())
    
    sections.append("\n\n".join(recovery_sections))
    
    # 4. User instructions - LAST (highest LLM priority)
    sections.append("## Your Task\n\n" + user_instructions.strip())
    
    return "\n\n---\n\n".join(sections)
