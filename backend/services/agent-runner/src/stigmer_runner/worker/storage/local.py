"""Local filesystem storage for OSS/local deployments.

This storage backend stores artifacts on the local filesystem,
enabling Stigmer to run without cloud dependencies.

Files are stored under a configurable base path and served
via stigmer-server's static file serving endpoint.

Usage:
    storage = LocalArtifactStorage(
        base_path="/var/stigmer/artifacts",
        serve_url_base="http://localhost:8080"
    )
    
    # Upload creates: /var/stigmer/artifacts/outputs/exec-123/result.zip
    storage.upload("outputs/exec-123/result.zip", content)
    
    # Download URL: http://localhost:7235/outputs/exec-123/result.zip
    url = storage.get_download_url("outputs/exec-123/result.zip")
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class LocalArtifactStorage:
    """Local filesystem storage for OSS deployments.
    
    Stores artifacts on the local filesystem and generates
    direct URLs for download via stigmer-server.
    
    Attributes:
        base_path: Root directory for artifact storage
        serve_url_base: Base URL for serving artifacts (e.g., "http://localhost:7235")
    """
    
    def __init__(self, base_path: str, serve_url_base: str):
        """Initialize local artifact storage.
        
        Args:
            base_path: Root directory for artifact storage.
                       Will be created if it doesn't exist.
            serve_url_base: Base URL for serving artifacts.
                           The full URL will be: {serve_url_base}/{key}
        """
        self.base_path = Path(base_path)
        self.serve_url_base = serve_url_base.rstrip('/')
        
        # Ensure base directory exists
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"LocalArtifactStorage initialized at {self.base_path}")
    
    def upload(self, key: str, content: bytes, content_type: str | None = None) -> str:
        """Upload content to local filesystem.
        
        Args:
            key: Storage key (used as relative path)
            content: File content as bytes
            content_type: Ignored for local storage (no metadata support)
            
        Returns:
            The storage key (same as input)
            
        Raises:
            IOError: If write fails
        """
        file_path = self.base_path / key
        
        # Create parent directories
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content
        file_path.write_bytes(content)
        logger.debug(f"Uploaded {len(content)} bytes to {file_path}")
        
        return key
    
    def download(self, key: str) -> bytes:
        """Download content from local filesystem.
        
        Args:
            key: Storage key to download
            
        Returns:
            File content as bytes
            
        Raises:
            FileNotFoundError: If file does not exist
        """
        file_path = self.base_path / key
        
        if not file_path.exists():
            raise FileNotFoundError(f"Artifact not found: {key}")
        
        content = file_path.read_bytes()
        logger.debug(f"Downloaded {len(content)} bytes from {file_path}")
        
        return content
    
    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        """Generate a direct download URL.
        
        For local storage, returns a direct file URL served by stigmer-server.
        The expires_in parameter is ignored (local URLs don't expire).
        
        Args:
            key: Storage key
            expires_in: Ignored for local storage
            
        Returns:
            Direct download URL: {serve_url_base}/{key}
        """
        # Local URLs don't expire - they're served directly by stigmer-server's
        # HTTP file server. The key already contains the full relative path
        # (e.g., "artifacts/{execution_id}/{filename}").
        return f"{self.serve_url_base}/{key}"
    
    def delete(self, key: str) -> None:
        """Delete content from local filesystem.
        
        Args:
            key: Storage key to delete
            
        Note:
            Does not raise if file does not exist (idempotent)
        """
        file_path = self.base_path / key
        
        if file_path.exists():
            file_path.unlink()
            logger.debug(f"Deleted {file_path}")
            
            # Clean up empty parent directories
            self._cleanup_empty_parents(file_path.parent)
    
    def exists(self, key: str) -> bool:
        """Check if a key exists in local filesystem.
        
        Args:
            key: Storage key to check
            
        Returns:
            True if file exists, False otherwise
        """
        return (self.base_path / key).exists()
    
    def _cleanup_empty_parents(self, path: Path) -> None:
        """Remove empty parent directories up to base_path.
        
        Args:
            path: Directory path to start cleanup from
        """
        try:
            while path != self.base_path and path.is_dir():
                if any(path.iterdir()):
                    break  # Directory not empty
                path.rmdir()
                path = path.parent
        except OSError:
            # Ignore errors during cleanup
            pass
