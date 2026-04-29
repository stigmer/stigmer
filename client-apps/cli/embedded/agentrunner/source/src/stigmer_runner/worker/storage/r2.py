"""Cloudflare R2 storage for cloud deployments.

This storage backend uses Cloudflare R2 (S3-compatible) for artifact storage,
enabling persistent, scalable storage for cloud/SaaS deployments.

R2 is accessed via the S3 API using boto3, with presigned URLs for downloads.

Usage:
    storage = R2ArtifactStorage(
        endpoint="https://account-id.r2.cloudflarestorage.com",
        access_key="your-access-key",
        secret_key="your-secret-key",
        bucket="stigmer-artifacts"
    )
    
    # Upload to R2
    storage.upload("outputs/exec-123/result.zip", content, "application/zip")
    
    # Get presigned download URL (expires in 7 days)
    url = storage.get_download_url("outputs/exec-123/result.zip")
    
Configuration follows the existing Go pattern from:
workflow-runner/pkg/claimcheck/r2_store.go
"""

import logging

import boto3
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)


class R2ArtifactStorage:
    """Cloudflare R2 storage for cloud deployments.
    
    Uses boto3 with S3-compatible API to interact with Cloudflare R2.
    Generates presigned URLs for secure, time-limited downloads.
    
    Attributes:
        bucket: R2 bucket name
        client: boto3 S3 client configured for R2
    """
    
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "auto",
    ):
        """Initialize R2 artifact storage.
        
        Args:
            endpoint: R2 endpoint URL (e.g., "https://account-id.r2.cloudflarestorage.com")
            access_key: R2 access key ID
            secret_key: R2 secret access key
            bucket: R2 bucket name
            region: AWS region (default "auto" for R2)
        """
        self.bucket = bucket
        self.endpoint = endpoint
        
        self.client = boto3.client(
            's3',
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=BotoConfig(
                s3={'addressing_style': 'path'},
                signature_version='s3v4',
            ),
        )
        
        logger.info(f"R2ArtifactStorage initialized for bucket {bucket}")
    
    def upload(self, key: str, content: bytes, content_type: str | None = None) -> str:
        """Upload content to R2.
        
        Args:
            key: Storage key (object key in R2)
            content: File content as bytes
            content_type: Optional MIME type (stored as ContentType metadata)
            
        Returns:
            The storage key (same as input)
            
        Raises:
            IOError: If upload fails
        """
        params = {
            'Bucket': self.bucket,
            'Key': key,
            'Body': content,
        }
        
        if content_type:
            params['ContentType'] = content_type
        
        try:
            self.client.put_object(**params)
            logger.debug(f"Uploaded {len(content)} bytes to R2: {key}")
            return key
        except Exception as e:
            logger.error(f"Failed to upload to R2: {key}: {e}")
            raise OSError(f"R2 upload failed: {e}") from e
    
    def download(self, key: str) -> bytes:
        """Download content from R2.
        
        Args:
            key: Storage key to download
            
        Returns:
            File content as bytes
            
        Raises:
            FileNotFoundError: If object does not exist
            IOError: If download fails
        """
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            content = response['Body'].read()
            logger.debug(f"Downloaded {len(content)} bytes from R2: {key}")
            return content
        except self.client.exceptions.NoSuchKey:
            raise FileNotFoundError(f"Artifact not found in R2: {key}")
        except Exception as e:
            logger.error(f"Failed to download from R2: {key}: {e}")
            raise OSError(f"R2 download failed: {e}") from e
    
    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        """Generate a presigned download URL.
        
        Args:
            key: Storage key
            expires_in: URL expiration in seconds (default: 7 days = 604800)
            
        Returns:
            Presigned download URL
            
        Note:
            R2 presigned URLs have a maximum expiration of 7 days.
        """
        # R2 has a max presign expiration of 7 days
        max_expires = 7 * 24 * 3600  # 604800 seconds
        expires_in = min(expires_in, max_expires)
        
        url = self.client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket, 'Key': key},
            ExpiresIn=expires_in,
        )
        
        logger.debug(f"Generated presigned URL for {key}, expires in {expires_in}s")
        return url
    
    def delete(self, key: str) -> None:
        """Delete content from R2.
        
        Args:
            key: Storage key to delete
            
        Note:
            Does not raise if object does not exist (S3 delete is idempotent)
        """
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            logger.debug(f"Deleted from R2: {key}")
        except Exception as e:
            logger.error(f"Failed to delete from R2: {key}: {e}")
            # Don't raise - delete should be idempotent
    
    def exists(self, key: str) -> bool:
        """Check if a key exists in R2.
        
        Args:
            key: Storage key to check
            
        Returns:
            True if object exists, False otherwise
        """
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except self.client.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            raise
