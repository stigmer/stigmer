"""Filesystem backend with shell execution support.

This module provides an enhanced FilesystemBackend that supports both file operations
and shell command execution for local agent runtime (ENV=local mode).
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ExecutionResult:
    """Result of a shell command execution.
    
    Attributes:
        exit_code: Command exit code (0 for success)
        stdout: Standard output from the command
        stderr: Standard error from the command
    """
    exit_code: int
    stdout: str
    stderr: str


class FilesystemBackend:
    """Enhanced filesystem backend with shell execution support.
    
    This backend provides both file operations and shell command execution
    for local agent runtime. It executes commands directly on the host machine
    in a specified workspace directory.
    
    Attributes:
        root_dir: Root directory for file operations and command execution
    """
    
    def __init__(self, root_dir: str | Path = ".") -> None:
        """Initialize filesystem backend.
        
        Args:
            root_dir: Root directory for operations (defaults to current directory)
        """
        self.root_dir = Path(root_dir).resolve()
        
        # Create workspace directory if it doesn't exist
        self.root_dir.mkdir(parents=True, exist_ok=True)
    
    def execute(
        self,
        command: str,
        timeout: int = 120,
        **kwargs: Any,  # noqa: ANN401
    ) -> ExecutionResult:
        """Execute shell command on the host machine.
        
        Commands are executed in the workspace directory (self.root_dir) with
        environment variables inherited from the current process. This allows
        API keys and other secrets to be passed through the environment.
        
        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds (defaults to 120)
            **kwargs: Additional arguments (reserved for future use)
        
        Returns:
            ExecutionResult with exit code, stdout, and stderr
        
        Raises:
            No exceptions are raised - all errors are captured in ExecutionResult
        
        Examples:
            >>> backend = FilesystemBackend(root_dir="/workspace")
            >>> result = backend.execute("echo 'Hello World'")
            >>> print(result.stdout)
            Hello World
            >>> print(result.exit_code)
            0
            
            >>> result = backend.execute("pip install requests")
            >>> if result.exit_code != 0:
            ...     print(f"Installation failed: {result.stderr}")
        
        Security Notes:
            - Commands run with the same permissions as the parent process
            - Commands can access the entire host filesystem
            - Use only in trusted local development environments
            - For production, use sandboxed backends like Daytona
        """
        try:
            # Prepare environment: inherit current process env and ensure unbuffered output
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            
            # Execute command in workspace directory
            result = subprocess.run(
                command,
                shell=True,
                cwd=self.root_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            
            return ExecutionResult(
                exit_code=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
            )
        
        except subprocess.TimeoutExpired as e:
            # Command exceeded timeout
            stdout = e.stdout.decode("utf-8") if e.stdout else ""
            stderr = e.stderr.decode("utf-8") if e.stderr else ""
            error_msg = f"Command timed out after {timeout} seconds"
            
            return ExecutionResult(
                exit_code=124,  # Standard timeout exit code
                stdout=stdout,
                stderr=f"{stderr}\n{error_msg}" if stderr else error_msg,
            )
        
        except Exception as e:
            # Catch all other errors (permission denied, invalid command, etc.)
            return ExecutionResult(
                exit_code=1,
                stdout="",
                stderr=f"Command execution failed: {type(e).__name__}: {e}",
            )
    
    # File operation methods (compatible with deepagents.backends.FilesystemBackend)
    
    def read(self, path: str) -> str:
        """Read file contents (deepagents compatible interface).
        
        Args:
            path: Relative path from root_dir
        
        Returns:
            File contents as string
        """
        return self.read_file(path)
    
    def read_file(self, path: str) -> str:
        """Read file contents.
        
        Args:
            path: Relative path from root_dir
        
        Returns:
            File contents as string
        """
        file_path = self.root_dir / path
        return file_path.read_text()
    
    def write(self, path: str, content: str) -> None:
        """Write content to file (deepagents compatible interface).
        
        Args:
            path: Relative path from root_dir
            content: Content to write
        """
        self.write_file(path, content)
    
    def write_file(self, path: str, content: str) -> None:
        """Write content to file.
        
        Args:
            path: Relative path from root_dir
            content: Content to write
        """
        file_path = self.root_dir / path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content)
    
    def list_files(self, path: str = ".") -> list[str]:
        """List files in directory.
        
        Args:
            path: Relative path from root_dir (defaults to root)
        
        Returns:
            List of file/directory names
        """
        dir_path = self.root_dir / path
        if not dir_path.exists():
            return []
        return [item.name for item in dir_path.iterdir()]
