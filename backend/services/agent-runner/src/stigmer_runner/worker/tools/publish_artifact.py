"""Tool for publishing files/directories from sandbox as downloadable artifacts.

This tool enables agents to make files and directories they create available
for download by users. It supports both single files and directories (which
are automatically zipped).

The tool works with both local filesystem and cloud (R2) storage backends,
making it compatible with both OSS and cloud deployments.

Usage:
    # During agent execution
    result = await publish_artifact(
        sandbox=sandbox,
        storage=artifact_storage,
        execution_id="exec-123",
        path="/workspace/my-skill",
        name="my-skill",
    )
    
    # Result is an ExecutionArtifact proto with download URL
    print(f"Download at: {result.download_url}")
"""

import hashlib
import logging
import mimetypes
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionArtifactKind

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder
    from stigmer_runner.worker.storage.base import ArtifactStorage

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


async def publish_artifact(
    sandbox,
    storage: "ArtifactStorage",
    execution_id: str,
    path: str,
    name: str,
    local_root: str | None = None,
) -> ExecutionArtifact:
    """Publish a file or directory from sandbox as a downloadable artifact.
    
    For directories: Creates a ZIP archive before uploading.
    Works with both local storage (OSS) and R2 (cloud).
    
    Args:
        sandbox: Daytona sandbox instance (None for local mode)
        storage: ArtifactStorage for uploading artifacts
        execution_id: ID of the current execution (used in storage key)
        path: Path in sandbox to the file or directory to publish
        name: Display name for the artifact
        local_root: Root path for local filesystem mode (when sandbox is None)
        
    Returns:
        ExecutionArtifact proto with download URL
        
    Raises:
        FileNotFoundError: If path does not exist in sandbox
        IOError: If upload fails
    """
    logger.info(f"Publishing artifact: path={path}, name={name}, execution_id={execution_id}")
    
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
) -> ExecutionArtifact:
    """Publish artifact from Daytona sandbox.
    
    Downloads file/directory from sandbox, uploads to storage,
    and returns ExecutionArtifact with download URL.
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
            raise OSError(f"Failed to zip directory: {result.result}")
        
        # Collect file entries from the archive for the proto entries field
        entries = _list_zip_entries_sandbox(sandbox, zip_path)
        
        # Download zip from sandbox
        content = sandbox.fs.download_file(zip_path)
        
        # Cleanup temp zip
        try:
            sandbox.process.exec(f"rm {zip_path}", timeout=5)
        except Exception:
            pass  # Best effort cleanup
        
        kind = ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY
        filename = f"{name}.zip"
        content_type = "application/zip"
    else:
        # Download single file
        content = sandbox.fs.download_file(path)
        kind = ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_FILE
        filename = name
        content_type = _guess_content_type(filename)

        # Diagnostic: log the first 200 bytes of content read from the
        # sandbox so operators can verify the artifact matches what the
        # write tool intended (helps diagnose path-mismatch or stale-read
        # issues where the published artifact differs from what was written).
        try:
            preview = content[:200] if isinstance(content, bytes) else content.encode()[:200]
            logger.info(
                "Artifact content preview (first 200 bytes): "
                "path=%s, size=%d, preview=%r",
                path, len(content), preview,
            )
        except Exception:
            pass
    
    # Upload to storage
    content_hash = hashlib.sha256(content).hexdigest()
    storage_key = f"artifacts/{execution_id}/{filename}"
    logger.info(f"Uploading {len(content)} bytes to storage: {storage_key}")
    storage.upload(storage_key, content, content_type)
    
    # Generate download URL
    download_url = storage.get_download_url(storage_key, DEFAULT_EXPIRES_IN)
    
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=DEFAULT_EXPIRES_IN)
    
    artifact = ExecutionArtifact(
        name=name,
        sandbox_path=path,
        kind=kind,
        size_bytes=len(content),
        storage_key=storage_key,
        download_url=download_url,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
        content_hash=content_hash,
    )
    
    if file_info.is_dir:
        artifact.entries.extend(entries)
    
    logger.info(
        f"Published artifact: name={name}, kind={ExecutionArtifactKind.Name(kind)}, "
        f"size={len(content)} bytes, expires={expires_at.isoformat()}"
    )
    
    return artifact


def _list_zip_entries_sandbox(sandbox, zip_path: str) -> list[str]:
    """List regular file entries in a ZIP archive inside a sandbox.
    
    Uses ``zipinfo -1`` which lists one entry per line. Directory entries
    (paths ending with ``/``) are excluded — only regular files are returned.
    """
    result = sandbox.process.exec(f"zipinfo -1 {zip_path}", timeout=10)
    if result.exit_code != 0:
        logger.warning(f"zipinfo failed (exit={result.exit_code}), entries will be empty")
        return []
    
    return [
        line for line in result.result.strip().splitlines()
        if line and not line.endswith("/")
    ]


async def _publish_from_local(
    local_root: str,
    storage: "ArtifactStorage",
    execution_id: str,
    path: str,
    name: str,
) -> ExecutionArtifact:
    """Publish artifact from local filesystem.
    
    Reads file/directory from local filesystem, uploads to storage,
    and returns ExecutionArtifact with download URL.
    """
    import shutil
    import tempfile
    
    # Resolve path relative to local_root
    full_path = Path(local_root) / path.lstrip('/')
    
    if not full_path.exists():
        raise FileNotFoundError(f"Path not found: {full_path}")
    
    if full_path.is_dir():
        # Collect file entries before archiving
        entries = _list_dir_entries(full_path)
        
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
        
        kind = ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY
        filename = f"{name}.zip"
        content_type = "application/zip"
    else:
        # Read single file
        content = full_path.read_bytes()
        kind = ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_FILE
        filename = name
        content_type = _guess_content_type(filename)
    
    # Upload to storage
    content_hash = hashlib.sha256(content).hexdigest()
    storage_key = f"artifacts/{execution_id}/{filename}"
    logger.info(f"Uploading {len(content)} bytes to storage: {storage_key}")
    storage.upload(storage_key, content, content_type)
    
    # Generate download URL
    download_url = storage.get_download_url(storage_key, DEFAULT_EXPIRES_IN)
    
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=DEFAULT_EXPIRES_IN)
    
    artifact = ExecutionArtifact(
        name=name,
        sandbox_path=path,
        kind=kind,
        size_bytes=len(content),
        storage_key=storage_key,
        download_url=download_url,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
        content_hash=content_hash,
    )
    
    if full_path.is_dir():
        artifact.entries.extend(entries)
    
    logger.info(
        f"Published artifact: name={name}, kind={ExecutionArtifactKind.Name(kind)}, "
        f"size={len(content)} bytes, expires={expires_at.isoformat()}"
    )
    
    return artifact


def _list_dir_entries(directory: Path) -> list[str]:
    """List regular file paths relative to a directory root.
    
    Uses forward slashes for cross-platform consistency in the proto field.
    Directory entries are excluded — only regular files are returned.
    """
    entries = []
    for file_path in sorted(directory.rglob("*")):
        if file_path.is_file():
            relative = file_path.relative_to(directory)
            entries.append(relative.as_posix())
    return entries


class PublishArtifactTool:
    """Internal wrapper class for publish_artifact tool with injected dependencies.
    
    This class captures the sandbox, storage, execution_id, and status_builder
    dependencies. Use create_publish_artifact_tool() to create a LangChain-compatible
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
        """Initialize publish_artifact tool with dependencies.
        
        Args:
            sandbox: Daytona sandbox instance (None for local mode)
            storage: ArtifactStorage for uploading artifacts
            execution_id: ID of the current execution
            status_builder: StatusBuilder to track artifacts
            local_root: Root path for local filesystem mode
        """
        self.sandbox = sandbox
        self.storage = storage
        self.execution_id = execution_id
        self.status_builder = status_builder
        self.local_root = local_root
    
    async def run(self, path: str, name: str) -> str:
        """Publish a file or directory as a downloadable artifact.
        
        Args:
            path: Path in sandbox to the file or directory to publish
            name: Display name for the artifact
            
        Returns:
            JSON string with artifact details including download URL
        """
        import json
        
        artifact = await publish_artifact(
            sandbox=self.sandbox,
            storage=self.storage,
            execution_id=self.execution_id,
            path=path,
            name=name,
            local_root=self.local_root,
        )
        
        # Track artifact in status builder
        self.status_builder.add_artifact(artifact)
        
        result = {
            "success": True,
            "name": artifact.name,
            "download_url": artifact.download_url,
            "size_bytes": artifact.size_bytes,
            "kind": "directory" if artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY else "file",
            "expires_at": artifact.expires_at,
            "message": f"Successfully published '{name}' as a downloadable artifact.",
        }
        
        return json.dumps(result)


def create_publish_artifact_tool(
    sandbox,
    storage: "ArtifactStorage",
    execution_id: str,
    status_builder: "StatusBuilder",
    local_root: str | None = None,
):
    """Factory function to create a LangChain-compatible publish_artifact tool.
    
    Creates a StructuredTool that can be passed to create_deep_agent's tools parameter.
    The tool allows agents to publish files and directories as downloadable artifacts.
    
    Args:
        sandbox: Daytona sandbox instance (None for local mode)
        storage: ArtifactStorage for uploading artifacts
        execution_id: ID of the current execution
        status_builder: StatusBuilder to track artifacts
        local_root: Root path for local filesystem mode
        
    Returns:
        LangChain StructuredTool instance ready for registration
    """
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field
    
    # Create the internal handler with captured dependencies
    handler = PublishArtifactTool(
        sandbox=sandbox,
        storage=storage,
        execution_id=execution_id,
        status_builder=status_builder,
        local_root=local_root,
    )
    
    # Define the input schema using Pydantic
    class PublishArtifactInput(BaseModel):
        """Input schema for publish_artifact tool."""
        path: str = Field(
            description="Path in the sandbox to the file or directory to publish. "
                       "Examples: '/workspace/my-skill', '/workspace/output.txt'"
        )
        name: str = Field(
            description="Display name for the artifact. This name will be shown to the user. "
                       "For directories, the artifact will be zipped with this name."
        )
    
    # Create the async wrapper function
    async def _publish_artifact_async(path: str, name: str) -> str:
        """Async wrapper for publish_artifact."""
        return await handler.run(path, name)
    
    # Create the sync wrapper (LangChain will handle async conversion)
    def _publish_artifact_sync(path: str, name: str) -> str:
        """Sync wrapper for publish_artifact - raises if called synchronously."""
        raise RuntimeError(
            "publish_artifact must be called asynchronously. "
            "Use await or the async version of agent.invoke()."
        )
    
    # Create and return the StructuredTool
    return StructuredTool(
        name="publish_artifact",
        description=(
            "Publish a file or directory as a downloadable artifact. "
            "Use this when you've created something the user should be able to download, "
            "such as generated code, created files, or completed work. "
            "For directories, the contents will be automatically zipped. "
            "Returns a download URL that the user can use to retrieve the artifact."
        ),
        func=_publish_artifact_sync,
        coroutine=_publish_artifact_async,
        args_schema=PublishArtifactInput,
    )
