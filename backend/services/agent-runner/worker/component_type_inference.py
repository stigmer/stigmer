"""Infer UI component types from tool names for frontend rendering."""


def infer_component_type(tool_name: str) -> str:
    """
    Infer UI component type from tool name.
    
    Maps tool names to component types for frontend rendering:
    - execute, Shell, bash → "terminal"
    - kubectl_* → "kubernetes"
    - Read, read_file → "preview"
    - Write, StrReplace, edit_file → "editor"
    - Grep, Glob, SemanticSearch → "search"
    - etc.
    
    Args:
        tool_name: The name of the tool being called
        
    Returns:
        Component type string for UI rendering
    """
    if not tool_name:
        return "tool"
    
    tool_lower = tool_name.lower()
    
    # Execute/Shell tools → terminal
    if tool_name.startswith("execute") or tool_name in ["Shell", "bash", "sh"]:
        return "terminal"
    
    # Kubernetes tools
    if "kubectl" in tool_lower or tool_name.startswith("k8s"):
        return "kubernetes"
    
    # File viewing/preview
    if tool_name in ["Read", "read_file", "view_file", "cat"]:
        return "preview"
    
    # File editing
    if tool_name in ["Write", "write_file", "edit_file", "StrReplace", "EditNotebook"]:
        return "editor"
    
    # Search tools
    if tool_name in ["Grep", "Glob", "SemanticSearch", "find"]:
        return "search"
    
    # Browser tools
    if "browser" in tool_lower or tool_name.startswith("cursor-ide-browser"):
        return "browser"
    
    # Git operations
    if tool_name.startswith("git_") or tool_lower.startswith("git"):
        return "git"
    
    # File system operations
    if tool_name in ["LS", "ls", "Delete", "Glob"]:
        return "filesystem"
    
    # Web search
    if "search" in tool_lower and "web" in tool_lower:
        return "web-search"
    
    # Task/sub-agent spawning
    if tool_name == "task":
        return "subagent"
    
    # Todo management
    if tool_name == "write_todos" or tool_name == "TodoWrite":
        return "todo"
    
    # Default generic tool
    return "tool"
