"""Proxy-backed artifact storage for cloud deployments.

Routes artifact upload/download through the Stigmer Side-Channel Proxy
(proxy.stigmer.ai) using presigned URLs. The runner never holds R2/S3
credentials — it calls the proxy to get a presigned URL, then uses
plain HTTPS for the actual data transfer.
"""

import logging

import httpx

logger = logging.getLogger(__name__)


class ProxyArtifactStorage:
    """Artifact storage backed by the Stigmer proxy's presigned URL API.

    Replaces R2ArtifactStorage for cloud deployments. Instead of
    direct boto3/R2 access, all storage operations go through:
    1. Proxy call to get a presigned URL (authenticated with user JWT)
    2. Plain HTTPS PUT/GET using the presigned URL (no credentials needed)
    """

    def __init__(self, proxy_endpoint: str, auth_token: str):
        self._base_url = f"{proxy_endpoint.rstrip('/')}/v1/proxy/artifacts"
        self._auth_token = auth_token
        self._client = httpx.Client(
            headers={"Authorization": f"Bearer {auth_token}"},
            timeout=30.0,
        )
        logger.info("ProxyArtifactStorage initialized (endpoint=%s)", proxy_endpoint)

    def upload(self, key: str, content: bytes, content_type: str | None = None) -> str:
        """Upload content via presigned URL.

        1. Calls proxy to get a presigned upload URL
        2. PUTs the content to the presigned URL
        """
        ct = content_type or "application/octet-stream"

        resp = self._client.post(
            f"{self._base_url}/presigned-upload-url",
            json={"key": key, "content_type": ct},
        )
        resp.raise_for_status()
        data = resp.json()

        upload_url = data["url"]
        headers = {k: v for k, v in data.get("headers", {}).items()}
        headers["Content-Type"] = ct

        put_resp = httpx.put(upload_url, content=content, headers=headers, timeout=120.0)
        put_resp.raise_for_status()

        logger.debug("Uploaded %d bytes via presigned URL: %s", len(content), key)
        return key

    def download(self, key: str) -> bytes:
        """Download content via presigned URL.

        1. Calls proxy to get a presigned download URL
        2. GETs the content from the presigned URL
        """
        resp = self._client.post(
            f"{self._base_url}/presigned-download-url",
            json={"key": key},
        )
        resp.raise_for_status()
        data = resp.json()

        download_url = data["url"]
        get_resp = httpx.get(download_url, timeout=120.0)
        if get_resp.status_code == 404:
            raise FileNotFoundError(f"Artifact not found: {key}")
        get_resp.raise_for_status()

        logger.debug("Downloaded %d bytes via presigned URL: %s", len(get_resp.content), key)
        return get_resp.content

    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        """Get a presigned download URL for an artifact."""
        resp = self._client.post(
            f"{self._base_url}/presigned-download-url",
            json={"key": key},
        )
        resp.raise_for_status()
        return resp.json()["url"]

    def delete(self, key: str) -> None:
        """Delete is not supported via proxy presigned URLs.

        Artifact deletion is a server-side concern handled by lifecycle
        policies on the R2 bucket, not by the runner.
        """
        logger.debug("Delete via proxy not implemented (key=%s) — handled by lifecycle policies", key)

    def exists(self, key: str) -> bool:
        """Check existence by attempting to get a download URL.

        If the proxy returns a URL, the object exists. If it returns 404,
        it doesn't.
        """
        try:
            resp = self._client.post(
                f"{self._base_url}/presigned-download-url",
                json={"key": key},
            )
            return resp.status_code == 200
        except Exception:
            return False
