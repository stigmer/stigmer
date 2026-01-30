"""Error message enrichment utilities for agent resilience.

This module provides functions to enrich error messages with contextual
recovery hints that help agents try alternative approaches instead of
giving up or blindly retrying failed operations.

The enrichment is based on error pattern detection and tool-specific
context, generating actionable suggestions for common failure scenarios.

This module has zero external dependencies, making it:
- Testable in isolation
- Reusable across different contexts
- Fast to import
"""


def enrich_error_message(tool_name: str, error: str) -> str:
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
        >>> enrich_error_message("read_file", "File not found: /path/to/file.txt")
        'Error: File not found: /path/to/file.txt\\n\\nRecovery suggestions:\\n- ...'
        
        >>> enrich_error_message("api_call", "429 Too Many Requests")
        'Error: 429 Too Many Requests\\n\\nRecovery suggestions:\\n- Wait a moment...'
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
