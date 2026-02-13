"""Tool for publishing files/directories from sandbox as downloadable outputs.

This tool enables agents to make files and directories they create available
for download by users. It supports both single files and directories (which
are automatically zipped).

The tool works with both local filesystem and cloud (R2) storage backends,
making it compatible with both OSS and cloud deployments.

Usage:
    # During agent execution
    result = await publish_output(
        sandbox=sandbox,
        storage=artifact_storage,
        execution_id="exec-123",
        path="/workspace/my-skill",
        name="my-skill",
    )
    
    # Result is an ExecutionOutput proto with download URL
    print(f"Download at: {result.download_url}")
"""

import logging
import mimetypes
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Any

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ExecutionOutput
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionOutputKind

if TYPE_CHECKING:
    from worker.storage.base import ArtifactStorage
    from worker.activities.graphton.status_builder import StatusBuilder

logger = logging.getLogger(__name__)

# Default expiration for download URLs (7 days in seconds)
DEFAULT_EXPIRES_IN = 7 * 24 * 3600


def _guess_content_type(filename: str) -> str:
    """Guess MIME type from filename.
    
    Args:
        filename: Name of the file
        
    Returns:
        MIME type string (defaults to application/octet-stream)
    """
    content_type, _ = mimetypes.guess_type(filename)
    return content_type or "application/octet-stream"


async def publish_output(
    sandbox,
    storage: "ArtifactStorage",
    execution_id: str,
    path: str,
    name: str,
    local_root: str | None = None,
) -> ExecutionOutput:
    """Publish a file or directory from sandbox as a downloadable output.
    
    For directories: Creates a ZIP archive before uploading.
    Works with both local storage (OSS) and R2 (cloud).
    
    Args:
        sandbox: Daytona sandbox instance (None for local mode)
        storage: ArtifactStorage for uploading outputs
        execution_id: ID of the current execution (used in storage key)
        path: Path in sandbox to the file or directory to publish
        name: Display name for the output
        local_root: Root path for local filesystem mode (when sandbox is None)
        
    Returns:
        ExecutionOutput proto with download URL
        
    Raises:
        FileNotFoundError: If path does not exist in sandbox
        IOError: If upload fails
    """
    logger.info(f"Publishing output: path={path}, name={name}, execution_id={execution_id}")
    
    if sandbox is not None:
        # Cloud mode - use Daytona sandbox
        return await _publish_from_sandbox(
            sandbox=sandbox,
            storage=storage,
            execution_id=execution_id,
            path=path,
            name=name,
        )
    else:
        # Local mode - use local filesystem
        if not local_root:
            raise ValueError("local_root required for local filesystem mode")
        return await _publish_from_local(
            local_root=local_root,
            storage=storage,
            execution_id=execution_id,
            path=path,
            name=name,
        )


async def _publish_from_sandbox(
    sandbox,
    storage: "ArtifactStorage",
    execution_id: str,
    path: str,
    name: str,
) -> ExecutionOutput:
    """Publish output from Daytona sandbox.
    
    Downloads file/directory from sandbox, uploads to storage,
    and returns ExecutionOutput with download URL.
    """
    # Check if path exists and get info
    try:
        file_info = sandbox.fs.get_file_info(path)
    except Exception as e:
        raise FileNotFoundError(f"Path not found in sandbox: {path}") from e
    
    if file_info.is_dir:
        # ZIP directory and download
        zip_path = f"/tmp/{name}.zip"
        logger.info(f"Zipping directory {path} to {zip_path}")
        
        # Create zip in sandbox
        result = sandbox.process.exec(f"cd {path} && zip -r {zip_path} .", timeout=60)
        if result.exit_code != 0:
            raise IOError(f"Failed to zip directory: {result.stderr}")
        
        # Download zip from sandbox
        content = sandbox.fs.download_file(zip_path)
        
        # Cleanup temp zip
        try:
            sandbox.process.exec(f"rm {zip_path}", timeout=5)
        except Exception:
            pass  # Best effort cleanup
        
        kind = ExecutionOutputKind.EXECUTION_OUTPUT_KIND_DIRECTORY
        filename = f"{name}.zip"
        content_type = "application/zip"
    else:
        # Download single file
        content = sandbox.fs.download_file(path)
        kind = ExecutionOutputKind.EXECUTION_OUTPUT_KIND_FILE
        filename = name
        content_type = _guess_content_type(filename)
    
    # Upload to storage
    storage_key = f"outputs/{execution_id}/{filename}"
    logger.info(f"Uploading {len(content)} bytes to storage: {storage_key}")
    storage.upload(storage_key, content, content_type)
    
    # Generate download URL
    download_url = storage.get_download_url(storage_key, DEFAULT_EXPIRES_IN)
    
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=DEFAULT_EXPIRES_IN)
    
    output = ExecutionOutput(
        name=name,
        sandbox_path=path,
        kind=kind,
        size_bytes=len(content),
        storage_key=storage_key,
        download_url=download_url,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
    )
    
    logger.info(
        f"Published output: name={name}, kind={ExecutionOutputKind.Name(kind)}, "
        f"size={len(content)} bytes, expires={expires_at.isoformat()}"
    )
    
    return output


async def _publish_from_local(
    local_root: str,
    storage: "ArtifactStorage",
    execution_id: str,
    path: str,
    name: str,
) -> ExecutionOutput:
    """Publish output from local filesystem.
    
    Reads file/directory from local filesystem, uploads to storage,
    and returns ExecutionOutput with download URL.
    """
    import shutil
    import tempfile
    
    # Resolve path relative to local_root
    full_path = Path(local_root) / path.lstrip('/')
    
    if not full_path.exists():
        raise FileNotFoundError(f"Path not found: {full_path}")
    
    if full_path.is_dir():
        # ZIP directory
        logger.info(f"Zipping directory {full_path}")
        
        # Create temp zip file
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp:
            zip_path = tmp.name
        
        try:
            # Create zip archive
            shutil.make_archive(
                zip_path.replace('.zip', ''),
                'zip',
                root_dir=full_path,
            )
            
            # Read zip content
            content = Path(zip_path).read_bytes()
        finally:
            # Cleanup temp file
            try:
                Path(zip_path).unlink()
            except Exception:
                pass
        
        kind = ExecutionOutputKind.EXECUTION_OUTPUT_KIND_DIRECTORY
        filename = f"{name}.zip"
        content_type = "application/zip"
    else:
        # Read single file
        content = full_path.read_bytes()
        kind = ExecutionOutputKind.EXECUTION_OUTPUT_KIND_FILE
        filename = name
        content_type = _guess_content_type(filename)
    
    # Upload to storage
    storage_key = f"outputs/{execution_id}/{filename}"
    logger.info(f"Uploading {len(content)} bytes to storage: {storage_key}")
    storage.upload(storage_key, content, content_type)
    
    # Generate download URL
    download_url = storage.get_download_url(storage_key, DEFAULT_EXPIRES_IN)
    
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=DEFAULT_EXPIRES_IN)
    
    output = ExecutionOutput(
        name=name,
        sandbox_path=path,
        kind=kind,
        size_bytes=len(content),
        storage_key=storage_key,
        download_url=download_url,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
    )
    
    logger.info(
        f"Published output: name={name}, kind={ExecutionOutputKind.Name(kind)}, "
        f"size={len(content)} bytes, expires={expires_at.isoformat()}"
    )
    
    return output


class PublishOutputTool:
    """Internal wrapper class for publish_output tool with injected dependencies.
    
    This class captures the sandbox, storage, execution_id, and status_builder
    dependencies. Use create_publish_output_tool() to create a LangChain-compatible
    BaseTool for registration with the agent.
    """
    
    def __init__(
        self,
        sandbox,
        storage: "ArtifactStorage",
        execution_id: str,
        status_builder: "StatusBuilder",
        local_root: str | None = None,
    ):
        """Initialize publish_output tool with dependencies.
        
        Args:
            sandbox: Daytona sandbox instance (None for local mode)
            storage: ArtifactStorage for uploading outputs
            execution_id: ID of the current execution
            status_builder: StatusBuilder to track outputs
            local_root: Root path for local filesystem mode
        """
        self.sandbox = sandbox
        self.storage = storage
        self.execution_id = execution_id
        self.status_builder = status_builder
        self.local_root = local_root
    
    async def run(self, path: str, name: str) -> str:
        """Publish a file or directory as a downloadable output.
        
        Args:
            path: Path in sandbox to the file or directory to publish
            name: Display name for the output
            
        Returns:
            JSON string with output details including download URL
        """
        import json
        
        output = await publish_output(
            sandbox=self.sandbox,
            storage=self.storage,
            execution_id=self.execution_id,
            path=path,
            name=name,
            local_root=self.local_root,
        )
        
        # Track output in status builder
        self.status_builder.add_output(output)
        
        result = {
            "success": True,
            "name": output.name,
            "download_url": output.download_url,
            "size_bytes": output.size_bytes,
            "kind": "directory" if output.kind == ExecutionOutputKind.EXECUTION_OUTPUT_KIND_DIRECTORY else "file",
            "expires_at": output.expires_at,
            "message": f"Successfully published '{name}' as a downloadable output.",
        }
        
        return json.dumps(result)


def create_publish_output_tool(
    sandbox,
    storage: "ArtifactStorage",
    execution_id: str,
    status_builder: "StatusBuilder",
    local_root: str | None = None,
):
    """Factory function to create a LangChain-compatible publish_output tool.
    
    Creates a StructuredTool that can be passed to create_deep_agent's tools parameter.
    The tool allows agents to publish files and directories as downloadable outputs.
    
    Args:
        sandbox: Daytona sandbox instance (None for local mode)
        storage: ArtifactStorage for uploading outputs
        execution_id: ID of the current execution
        status_builder: StatusBuilder to track outputs
        local_root: Root path for local filesystem mode
        
    Returns:
        LangChain StructuredTool instance ready for registration
    """
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field
    
    # Create the internal handler with captured dependencies
    handler = PublishOutputTool(
        sandbox=sandbox,
        storage=storage,
        execution_id=execution_id,
        status_builder=status_builder,
        local_root=local_root,
    )
    
    # Define the input schema using Pydantic
    class PublishOutputInput(BaseModel):
        """Input schema for publish_output tool."""
        path: str = Field(
            description="Path in the sandbox to the file or directory to publish. "
                       "Examples: '/workspace/my-skill', '/workspace/output.txt'"
        )
        name: str = Field(
            description="Display name for the output. This name will be shown to the user. "
                       "For directories, the output will be zipped with this name."
        )
    
    # Create the async wrapper function
    async def _publish_output_async(path: str, name: str) -> str:
        """Async wrapper for publish_output."""
        return await handler.run(path, name)
    
    # Create the sync wrapper (LangChain will handle async conversion)
    def _publish_output_sync(path: str, name: str) -> str:
        """Sync wrapper for publish_output - raises if called synchronously."""
        raise RuntimeError(
            "publish_output must be called asynchronously. "
            "Use await or the async version of agent.invoke()."
        )
    
    # Create and return the StructuredTool
    return StructuredTool(
        name="publish_output",
        description=(
            "Publish a file or directory as a downloadable output. "
            "Use this when you've created something the user should be able to download, "
            "such as generated code, created files, or completed work. "
            "For directories, the contents will be automatically zipped. "
            "Returns a download URL that the user can use to retrieve the artifact."
        ),
        func=_publish_output_sync,
        coroutine=_publish_output_async,
        args_schema=PublishOutputInput,
    )
