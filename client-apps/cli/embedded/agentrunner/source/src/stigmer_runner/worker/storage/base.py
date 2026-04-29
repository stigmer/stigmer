"""Base protocol for artifact storage backends.

This module defines the ArtifactStorage protocol that abstracts
storage operations for agent execution artifacts (attachments and outputs).

Stigmer supports two deployment modes:
- Cloud/SaaS: Uses Cloudflare R2 for artifact storage
- Local/OSS: Uses local filesystem (no cloud dependencies)

The protocol follows the existing Go pattern from:
workflow-runner/pkg/claimcheck/store.go
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class ArtifactStorage(Protocol):
    """Protocol for artifact storage backends.
    
    Implementations must provide upload, download, URL generation,
    and deletion capabilities. The protocol is storage-agnostic,
    supporting both local filesystem and cloud object storage.
    
    Usage:
        storage = create_artifact_storage(config)
        
        # Upload
        key = storage.upload("outputs/exec-123/result.zip", content, "application/zip")
        
        # Download
        content = storage.download(key)
        
        # Get download URL
        url = storage.get_download_url(key, expires_in=604800)  # 7 days
        
        # Cleanup
        storage.delete(key)
    """
    
    def upload(self, key: str, content: bytes, content_type: str | None = None) -> str:
        """Upload content to storage.
        
        Args:
            key: Storage key (path-like, e.g., "outputs/exec-123/file.zip")
            content: File content as bytes
            content_type: Optional MIME type (e.g., "application/zip")
            
        Returns:
            The storage key (same as input key)
            
        Raises:
            IOError: If upload fails
        """
        ...
    
    def download(self, key: str) -> bytes:
        """Download content from storage.
        
        Args:
            key: Storage key to download
            
        Returns:
            File content as bytes
            
        Raises:
            FileNotFoundError: If key does not exist
            IOError: If download fails
        """
        ...
    
    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        """Generate a download URL for the given key.
        
        For cloud storage (R2), this generates a presigned URL.
        For local storage, this returns a direct file URL served by stigmer-server.
        
        Args:
            key: Storage key
            expires_in: URL expiration in seconds (default: 7 days)
                        Note: Local storage ignores this parameter
                        
        Returns:
            Download URL (presigned for R2, direct for local)
        """
        ...
    
    def delete(self, key: str) -> None:
        """Delete content from storage.
        
        Args:
            key: Storage key to delete
            
        Note:
            Does not raise if key does not exist (idempotent)
        """
        ...
    
    def exists(self, key: str) -> bool:
        """Check if a key exists in storage.
        
        Args:
            key: Storage key to check
            
        Returns:
            True if key exists, False otherwise
        """
        ...
