"""Transform execute tool names to show actual commands for better UX."""


def format_execute_tool_name(command: str) -> str:
    """
    Transform execute tool name to show actual command.
    
    Converts generic "execute" to more specific command names:
    - "kubectl get pods" → "kubectl get"
    - "docker build -t ..." → "docker build"
    - "npm install" → "npm install"
    - "git status" → "git status"
    
    Args:
        command: The command string being executed
        
    Returns:
        Formatted tool name for UI display
    """
    if not command:
        return "execute"
    
    # Extract first command word(s)
    parts = command.strip().split()
    if not parts:
        return "execute"
    
    first_cmd = parts[0].strip()
    
    # Common command patterns - show command + first argument/action
    if first_cmd == "kubectl":
        # kubectl get/apply/delete/etc
        action = parts[1] if len(parts) > 1 else ""
        return f"kubectl {action}".strip()
    
    elif first_cmd == "docker":
        action = parts[1] if len(parts) > 1 else ""
        return f"docker {action}".strip()
    
    elif first_cmd in ["npm", "yarn", "pnpm", "bun"]:
        action = parts[1] if len(parts) > 1 else ""
        return f"{first_cmd} {action}".strip()
    
    elif first_cmd == "git":
        action = parts[1] if len(parts) > 1 else ""
        return f"git {action}".strip()
    
    elif first_cmd in ["python", "python3", "node", "deno"]:
        script = parts[1] if len(parts) > 1 else ""
        if script and not script.startswith("-"):
            # Show script name if provided
            return f"{first_cmd} {script}".strip()
        return first_cmd
    
    elif first_cmd in ["make", "cargo", "go"]:
        action = parts[1] if len(parts) > 1 else ""
        return f"{first_cmd} {action}".strip()
    
    elif first_cmd in ["terraform", "tf"]:
        action = parts[1] if len(parts) > 1 else ""
        return f"terraform {action}".strip()
    
    elif first_cmd in ["helm"]:
        action = parts[1] if len(parts) > 1 else ""
        return f"helm {action}".strip()
    
    elif first_cmd in ["cd", "ls", "pwd", "cat", "grep", "find"]:
        # Common shell commands - just show the command
        return first_cmd
    
    else:
        # Default: show "execute: command"
        return f"execute: {first_cmd}"
