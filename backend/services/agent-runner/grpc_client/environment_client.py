"""gRPC client for fetching Environment resources."""

from __future__ import annotations

import asyncio
import logging

import grpc
from ai.stigmer.agentic.environment.v1 import query_pb2_grpc
from ai.stigmer.agentic.environment.v1.api_pb2 import Environment
from ai.stigmer.agentic.environment.v1.io_pb2 import (
    EnvironmentList,
    EnvironmentSecretValueInput,
    ListEnvironmentsRequest,
)
from ai.stigmer.agentic.environment.v1.spec_pb2 import EnvironmentValue
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

logger = logging.getLogger(__name__)


_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class EnvironmentClient:
    """Client for fetching environments from Stigmer backend."""
    
    def __init__(
        self,
        api_key: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize EnvironmentClient with authentication.
        
        Args:
            api_key: Stigmer API key for authentication.
            timeout: Per-call gRPC deadline in seconds (must stay well under
                     Temporal's 30s heartbeat timeout to allow graceful recovery).
            channel: Optional shared gRPC channel (from ChannelProvider). When
                     provided, the client does not create or own a channel.
        """
        if channel is not None:
            self.channel = channel
            self._owns_channel = False
        else:
            config = Config.load_from_env()
            interceptor = AuthClientInterceptor(api_key)
            self.channel = create_channel(
                config.stigmer_backend_endpoint, interceptors=[interceptor],
            )
            self._owns_channel = True
        
        self.stub = query_pb2_grpc.EnvironmentQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get_by_reference(self, ref: ApiResourceReference) -> Environment:
        """Fetch environment by ApiResourceReference.
        
        Args:
            ref: ApiResourceReference with scope, org, kind, and slug
            
        Returns:
            Environment proto message
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If environment not found or access denied
        """
        try:
            return await self.stub.getByReference(ref, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"Environment {ref.slug} not found")
                raise ValueError(
                    f"Environment '{ref.slug}' not found or access denied. "
                    "Ensure environment exists and you have permission to access it."
                ) from e
            else:
                logger.error(f"Failed to fetch environment {ref.slug}: {e}")
                raise
    
    async def list_by_refs(self, refs: list[ApiResourceReference]) -> list[Environment]:
        """Fetch multiple environments by ApiResourceReference.
        
        Environments are returned in the same order as refs for proper merging.
        
        Args:
            refs: List of ApiResourceReference objects
            
        Returns:
            List of Environment proto messages (in same order as refs)
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If any environment not found or access denied
        """
        if not refs:
            return []
        
        logger.info(f"Fetching {len(refs)} environments: {[ref.slug for ref in refs]}")
        
        try:
            environments = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(environments)} environments: "
                f"{[env.metadata.name for env in environments]}"
            )
            
            return list(environments)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch environments: {e}")
            raise

    async def list_environments(
        self,
        org: str,
        labels: dict[str, str] | None = None,
    ) -> EnvironmentList:
        """List environments filtered by organization and optional labels.

        Mirrors the Go downstream client's ``List`` method. Used by the
        MCP discovery activity to locate the caller's personal environment
        (``labels={"stigmer.ai/personal": "true"}``).

        Args:
            org: Organization slug (required by the backend).
            labels: Optional label filter with AND semantics.

        Returns:
            ``EnvironmentList`` proto with ``total_count`` and ``items``.

        Raises:
            grpc.RpcError: If the gRPC call fails.
        """
        req = ListEnvironmentsRequest(org=org)
        if labels:
            for k, v in labels.items():
                req.labels[k] = v

        try:
            return await self.stub.list(req, timeout=self._timeout)
        except grpc.RpcError as e:
            logger.error("Failed to list environments for org '%s': %s", org, e)
            raise

    async def get_secret_value(
        self,
        environment_id: str,
        key: str,
    ) -> EnvironmentValue:
        """Retrieve the unredacted value of a single secret key.

        Mirrors the Go downstream client's ``GetSecretValue`` method.
        The backend decrypts the value server-side and returns it in
        the response. Requires creator-level permission on the
        environment (enforced via FGA in cloud, unrestricted in OSS).

        Args:
            environment_id: System-generated ID of the environment.
            key: The key within ``EnvironmentSpec.data`` to decrypt.

        Returns:
            ``EnvironmentValue`` proto with the decrypted ``value`` field.

        Raises:
            grpc.RpcError: If the gRPC call fails.
            ValueError: If the key is not found in the environment.
        """
        req = EnvironmentSecretValueInput(
            environment_id=environment_id,
            key=key,
        )
        try:
            return await self.stub.getSecretValue(req, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise ValueError(
                    f"Secret key '{key}' not found in environment '{environment_id}'."
                ) from e
            logger.error(
                "Failed to get secret value for key '%s' in env '%s': %s",
                key, environment_id, e,
            )
            raise
