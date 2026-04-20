"""Artifact storage abstraction for agent-runner.

This module provides a storage abstraction layer that supports both:
- Local filesystem (for OSS/local deployments)
- Cloudflare R2 (for cloud/SaaS deployments)

The storage type is determined by the ARTIFACT_STORAGE_TYPE environment variable.

Usage:
    from worker.storage import create_artifact_storage
    
    # Create storage based on config
    storage = create_artifact_storage(config)
    
    # Use storage
    storage.upload("outputs/exec-123/file.zip", content)
    url = storage.get_download_url("outputs/exec-123/file.zip")

Configuration:
    ARTIFACT_STORAGE_TYPE: "local" (default) or "r2"
    
    Local storage:
        LOCAL_ARTIFACT_PATH: Base path for artifacts (default: /var/stigmer/artifacts)
        LOCAL_ARTIFACT_SERVE_URL: Base URL for serving (default: http://localhost:7235)
    
    R2 storage (for agent execution artifacts):
        AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT: R2 endpoint URL
        AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID: R2 access key
        AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY: R2 secret key
        AGENT_EXECUTION_ARTIFACT_R2_BUCKET: R2 bucket name
        AGENT_EXECUTION_ARTIFACT_R2_REGION: R2 region (default: "auto")
"""

import logging
import os
from dataclasses import dataclass

from worker.storage.base import ArtifactStorage
from worker.storage.local import LocalArtifactStorage

logger = logging.getLogger(__name__)

# Re-export for convenience
__all__ = [
    "ArtifactStorage",
    "LocalArtifactStorage",
    "R2ArtifactStorage",
    "ArtifactStorageConfig",
    "create_artifact_storage",
]


def __getattr__(name: str):
    """Lazy import for R2ArtifactStorage to avoid requiring boto3 in local mode."""
    if name == "R2ArtifactStorage":
        from worker.storage.r2 import R2ArtifactStorage
        return R2ArtifactStorage
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


@dataclass
class ArtifactStorageConfig:
    """Configuration for artifact storage.
    
    Attributes:
        storage_type: Storage backend type ("local", "r2", or "proxy")
        local_path: Base path for local storage
        local_serve_url: Base URL for serving local artifacts
        r2_endpoint: R2 endpoint URL
        r2_access_key: R2 access key ID
        r2_secret_key: R2 secret access key
        r2_bucket: R2 bucket name
        r2_region: R2 region (default: "auto")
        proxy_endpoint: Stigmer proxy endpoint (for proxy storage type)
        proxy_auth_token: Auth token for proxy (for proxy storage type)
    """
    storage_type: str = "local"
    
    # Local storage configuration
    local_path: str = "/var/stigmer/artifacts"
    local_serve_url: str = "http://localhost:7235"
    
    # R2 storage configuration (legacy direct access)
    r2_endpoint: str | None = None
    r2_access_key: str | None = None
    r2_secret_key: str | None = None
    r2_bucket: str | None = None
    r2_region: str = "auto"
    
    # Proxy storage configuration (Side-Channel Proxy)
    proxy_endpoint: str | None = None
    proxy_auth_token: str | None = None
    
    @classmethod
    def load_from_env(cls, mode: str = "cloud") -> "ArtifactStorageConfig":
        """Load storage configuration from environment variables.
        
        Args:
            mode: Execution mode ("local" or "cloud") for default selection
            
        Returns:
            ArtifactStorageConfig instance
            
        Environment Variables:
            ARTIFACT_STORAGE_TYPE: Storage type ("local" or "r2")
            LOCAL_ARTIFACT_PATH: Path for local artifact storage
            LOCAL_ARTIFACT_SERVE_URL: Base URL for serving local artifacts
            AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT: R2 endpoint URL
            AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID: R2 access key
            AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY: R2 secret key
            AGENT_EXECUTION_ARTIFACT_R2_BUCKET: R2 bucket name
            AGENT_EXECUTION_ARTIFACT_R2_REGION: R2 region (default: "auto")
        """
        # Default storage type based on mode
        default_type = "local" if mode == "local" else "r2"
        storage_type = os.getenv("ARTIFACT_STORAGE_TYPE", default_type)
        
        # Local storage defaults
        local_path = os.getenv("LOCAL_ARTIFACT_PATH", "/var/stigmer/artifacts")
        local_serve_url = os.getenv("LOCAL_ARTIFACT_SERVE_URL", "http://localhost:7235")
        
        # R2 storage configuration (agent execution artifacts)
        r2_endpoint = os.getenv("AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT")
        r2_access_key = os.getenv("AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID")
        r2_secret_key = os.getenv("AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY")
        r2_bucket = os.getenv("AGENT_EXECUTION_ARTIFACT_R2_BUCKET")
        r2_region = os.getenv("AGENT_EXECUTION_ARTIFACT_R2_REGION", "auto")
        
        config = cls(
            storage_type=storage_type,
            local_path=local_path,
            local_serve_url=local_serve_url,
            r2_endpoint=r2_endpoint,
            r2_access_key=r2_access_key,
            r2_secret_key=r2_secret_key,
            r2_bucket=r2_bucket,
            r2_region=r2_region,
        )
        
        # Validate configuration
        config.validate()
        
        return config
    
    def validate(self) -> None:
        """Validate storage configuration.
        
        Raises:
            ValueError: If configuration is invalid
        """
        valid_types = {"local", "r2", "proxy"}
        if self.storage_type not in valid_types:
            raise ValueError(
                f"Invalid ARTIFACT_STORAGE_TYPE: {self.storage_type}. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )
        
        if self.storage_type == "r2":
            missing = []
            if not self.r2_endpoint:
                missing.append("AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT")
            if not self.r2_access_key:
                missing.append("AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID")
            if not self.r2_secret_key:
                missing.append("AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY")
            if not self.r2_bucket:
                missing.append("AGENT_EXECUTION_ARTIFACT_R2_BUCKET")
            
            if missing:
                raise ValueError(
                    f"R2 storage requires: {', '.join(missing)}. "
                    "Set these environment variables or use ARTIFACT_STORAGE_TYPE=local"
                )
        
        if self.storage_type == "proxy":
            if not self.proxy_endpoint:
                raise ValueError(
                    "STIGMER_PROXY_ENDPOINT is required for proxy artifact storage."
                )
            if not self.proxy_auth_token:
                raise ValueError(
                    "STIGMER_API_KEY is required for proxy artifact storage."
                )


def create_artifact_storage(config: ArtifactStorageConfig) -> ArtifactStorage:
    """Create artifact storage backend based on configuration.
    
    Args:
        config: Storage configuration
        
    Returns:
        ArtifactStorage implementation (Local or R2)
        
    Raises:
        ValueError: If storage type is invalid
    """
    if config.storage_type == "proxy":
        logger.info("Creating proxy artifact storage")
        from worker.storage.proxy import ProxyArtifactStorage
        assert config.proxy_endpoint is not None
        assert config.proxy_auth_token is not None
        return ProxyArtifactStorage(
            proxy_endpoint=config.proxy_endpoint,
            auth_token=config.proxy_auth_token,
        )
    elif config.storage_type == "r2":
        logger.info("Creating R2 artifact storage")
        from worker.storage.r2 import R2ArtifactStorage
        assert config.r2_endpoint is not None
        assert config.r2_access_key is not None
        assert config.r2_secret_key is not None
        assert config.r2_bucket is not None
        return R2ArtifactStorage(
            endpoint=config.r2_endpoint,
            access_key=config.r2_access_key,
            secret_key=config.r2_secret_key,
            bucket=config.r2_bucket,
            region=config.r2_region,
        )
    else:
        logger.info(f"Creating local artifact storage at {config.local_path}")
        return LocalArtifactStorage(
            base_path=config.local_path,
            serve_url_base=config.local_serve_url,
        )
