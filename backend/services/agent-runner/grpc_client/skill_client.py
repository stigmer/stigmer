"""gRPC client for Skill API."""

from __future__ import annotations

import asyncio
import logging

import grpc
from ai.stigmer.agentic.skill.v1 import query_pb2_grpc
from ai.stigmer.agentic.skill.v1.api_pb2 import Skill
from ai.stigmer.agentic.skill.v1.io_pb2 import SkillId
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

logger = logging.getLogger(__name__)


_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class SkillClient:
    """Client for fetching skills from Stigmer backend."""
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize SkillClient with authentication.
        
        Args:
            token: Stigmer auth token (JWT or API key).
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
            interceptor = AuthClientInterceptor(token)
            self.channel = create_channel(
                config.stigmer_backend_endpoint, interceptors=[interceptor],
            )
            self._owns_channel = True
        
        self.stub = query_pb2_grpc.SkillQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def list_by_ids(self, skill_ids: list[str]) -> list[Skill]:
        """Fetch multiple skills by IDs.
        
        Note: Skills API doesn't have a batch listByIds RPC, so we fetch
        skills individually and gather results.
        
        Args:
            skill_ids: List of skill IDs (UUIDs)
            
        Returns:
            List of Skill proto messages
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If any skill not found or access denied
        """
        if not skill_ids:
            return []
        
        logger.info(f"Fetching {len(skill_ids)} skills: {skill_ids}")
        
        async def fetch_skill(skill_id: str) -> Skill:
            """Fetch a single skill by ID."""
            request = SkillId(value=skill_id)
            try:
                return await self.stub.get(request, timeout=self._timeout)
            except grpc.RpcError as e:
                if e.code() == grpc.StatusCode.NOT_FOUND:
                    logger.error(f"Skill {skill_id} not found")
                    raise ValueError(
                        f"Skill {skill_id} not found or access denied. "
                        "Ensure skill exists and you have permission to access it."
                    ) from e
                else:
                    logger.error(f"Failed to fetch skill {skill_id}: {e}")
                    raise
        
        try:
            skills = await asyncio.gather(*[fetch_skill(skill_id) for skill_id in skill_ids])
            
            logger.info(
                f"Successfully fetched {len(skills)} skills: "
                f"{[s.metadata.name for s in skills]}"
            )
            
            return list(skills)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch skills: {e}")
            raise
    
    async def get_by_reference(self, ref: ApiResourceReference) -> Skill:
        """Fetch skill by ApiResourceReference.
        
        Args:
            ref: ApiResourceReference with scope, org, kind, and slug
            
        Returns:
            Skill proto message
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If skill not found or access denied
        """
        try:
            return await self.stub.getByReference(ref, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"Skill {ref.slug} not found")
                raise ValueError(
                    f"Skill '{ref.slug}' not found or access denied. "
                    "Ensure skill exists and you have permission to access it."
                ) from e
            else:
                logger.error(f"Failed to fetch skill {ref.slug}: {e}")
                raise
    
    async def list_by_refs(self, refs: list[ApiResourceReference]) -> list[Skill]:
        """Fetch multiple skills by ApiResourceReference.
        
        Args:
            refs: List of ApiResourceReference objects
            
        Returns:
            List of Skill proto messages
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If any skill not found or access denied
        """
        if not refs:
            return []
        
        logger.info(f"Fetching {len(refs)} skills: {[ref.slug for ref in refs]}")
        
        try:
            skills = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(skills)} skills: "
                f"{[s.metadata.name for s in skills]}"
            )
            
            return list(skills)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch skills: {e}")
            raise
    
    async def get_artifact(self, artifact_storage_key: str) -> bytes:
        """Download skill artifact from storage.
        
        Downloads the ZIP file containing SKILL.md and implementation files
        from R2 storage. This is used by the agent-runner to extract skills
        into the sandbox at /bin/skills/{version_hash}/.
        
        Args:
            artifact_storage_key: Storage key from skill.status.artifact_storage_key
            
        Returns:
            Artifact content as bytes (ZIP file)
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If artifact not found
        """
        from ai.stigmer.agentic.skill.v1.io_pb2 import GetArtifactRequest
        
        logger.info(f"Downloading skill artifact - key: {artifact_storage_key}")
        
        request = GetArtifactRequest(artifact_storage_key=artifact_storage_key)
        
        try:
            response = await self.stub.getArtifact(request, timeout=self._timeout)
            
            artifact_bytes = response.artifact
            logger.info(
                f"Successfully downloaded artifact - key: {artifact_storage_key}, "
                f"size: {len(artifact_bytes)} bytes"
            )
            
            return artifact_bytes
            
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"Artifact not found - key: {artifact_storage_key}")
                raise ValueError(
                    f"Skill artifact not found: {artifact_storage_key}"
                ) from e
            else:
                logger.error(f"Failed to download artifact - key: {artifact_storage_key}: {e}")
                raise
