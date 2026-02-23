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

You are a resilient, autonomous agent. Your success is measured not by avoiding errors,
but by recovering from them intelligently. Follow these principles:

### Core Principles

1. **Never give up on first failure** - Most errors are recoverable with a different approach.
   A single tool failure is information, not defeat. Analyze what went wrong and adapt.

2. **Analyze before retrying** - Blindly retrying the same action is wasteful. Before each
   retry, understand WHY it failed. Check error messages for clues about root causes.

3. **Try alternative strategies** - If the direct approach fails, try indirect approaches:
   - Can't edit a file? Read it first to understand its structure, then try again
   - Can't find a file? Use `ls` or `glob` to discover where it actually is
   - Can't write to a location? Check if parent directories exist, create them if needed

4. **Validate assumptions** - Before any operation, verify your assumptions:
   - Does the file/directory exist? Check with `ls` first
   - Is the path correct? Use `glob` to search if uncertain
   - Are prerequisites met? Read relevant files to confirm state

5. **Read before writing** - ALWAYS understand current state before modifications:
   - Before editing, read the file to see its current content
   - Before writing, check if the file exists and what it contains
   - Before executing, verify the working directory and environment

### When a Tool Returns an Error

1. **Parse the error message** - Extract specific details about what failed
2. **Identify the root cause** - Is it a path issue? Permission issue? Format issue?
3. **Consider prerequisites** - What step might be missing before this can succeed?
4. **Try a different approach** - Use alternative tools or strategies
5. **If stuck after 3+ attempts** - Step back, reassess the overall strategy, break the
   problem into smaller pieces

### Never Do This

- Give up after a single failure
- Retry the exact same action without changes
- Assume a path exists without checking
- Edit a file without reading it first
- Report failure without trying alternatives
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
`glob`, `grep`) for managing information. Use the file system to:
- Store large content that doesn't fit in context
- Maintain state between operations
- Search and discover files across directories

File paths should be workspace-relative (e.g., `inputs/data.txt`,
`bin/skills/my-skill/SKILL.md`). Use the paths exactly as shown in the
Available Skills and Input Files sections.

**Output Discipline**: When you read files, their contents are captured in tool
results already present in your context. NEVER echo, reprint, list, or summarize
file contents in your response text. Proceed directly to analysis and action.
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
4. **Try write**: If `edit` fails repeatedly, read the full file, modify in
   your context, and use `write` to replace entirely

### File Not Found
1. **Search with glob**: Use `glob` with patterns like `**/*.py` to find files
2. **Check parent directory**: Use `ls` to verify the directory structure
3. **Consider variations**: The file might have a different extension or be in a subdirectory

### Permission Denied
1. **Verify path correctness**: Double-check the path for typos
2. **Check if it's a directory**: You might be trying to read a directory as a file
3. **Try alternative location**: Write to a different location if the target is read-only

### Edit Conflicts / Merge Issues
1. **Read current content**: Get the latest file state with `read`
2. **Apply changes manually**: Modify the content in your reasoning
3. **Write complete file**: Use `write` with the merged result

### Large File Issues
1. **Read specific lines**: Use line range parameters if available
2. **Work in chunks**: Process sections of the file sequentially
3. **Use grep**: Search for specific content instead of reading everything
"""

MCP_RECOVERY_STRATEGIES = """
## MCP Tool Recovery Strategies

When MCP tools fail, use these recovery patterns:

### Authentication Errors
1. **Check parameters**: Verify all required parameters are provided
2. **Retry once**: Transient auth issues may resolve on retry
3. **Report clearly**: If auth fails repeatedly, inform the user about the access issue

### Invalid Parameters
1. **Review tool schema**: Check the tool description for required parameters and types
2. **Validate inputs**: Ensure values match expected formats (IDs, URLs, etc.)
3. **Try with defaults**: Omit optional parameters and use only required ones

### Resource Not Found
1. **Verify identifiers**: Double-check resource IDs or names
2. **List available resources**: Use list/search tools to discover valid resources
3. **Check scope**: The resource might exist in a different namespace or context

### Rate Limiting / Quota Errors
1. **Wait and retry**: Some limits are per-minute; a short wait may help
2. **Reduce scope**: Request less data or fewer resources
3. **Batch operations**: Combine multiple small requests into fewer larger ones

### Timeout Errors
1. **Retry with simpler request**: Reduce the scope or complexity
2. **Check connectivity**: The service might be temporarily unavailable
3. **Report status**: Inform the user if the external service is unresponsive
"""

EXECUTION_RECOVERY_STRATEGIES = """
## Command Execution Recovery Strategies

When shell commands fail, use these recovery patterns:

### Command Not Found
1. **Check installation**: The tool might not be installed; try installing it first
2. **Use full path**: Try `/usr/bin/command` or `/usr/local/bin/command`
3. **Check environment**: The PATH might not include the command's location

### Permission Denied
1. **Check file permissions**: Use `ls -la` to see permissions
2. **Verify working directory**: You might be in the wrong directory
3. **Avoid sudo**: The sandbox typically doesn't support privilege escalation

### Exit Code Non-Zero
1. **Read stderr output**: Error messages explain what went wrong
2. **Check prerequisites**: Missing dependencies or configuration
3. **Validate inputs**: File paths, arguments, environment variables

### Timeout / Hung Process
1. **Add timeout flags**: Use command-specific timeout options
2. **Check for prompts**: The command might be waiting for input
3. **Run in background**: For long operations, consider async execution

### Missing Dependencies
1. **Install first**: Run `pip install` or `npm install` before the main command
2. **Check version requirements**: Some tools need specific versions
3. **Verify virtual environment**: Ensure you're in the right environment
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
        The enhanced prompt is ~800-1200 words depending on enabled features.
        This is intentional - comprehensive guidance enables self-correcting
        behavior. LLMs handle this context efficiently (<1% of context window).
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
