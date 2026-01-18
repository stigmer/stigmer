"""gRPC client for Skill API."""

import grpc
from ai.stigmer.agentic.skill.v1 import query_pb2_grpc
from ai.stigmer.agentic.skill.v1.io_pb2 import SkillId
from ai.stigmer.agentic.skill.v1.api_pb2 import Skill
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor
import logging
import asyncio

logger = logging.getLogger(__name__)


class SkillClient:
    """Client for fetching skills from Stigmer backend."""
    
    def __init__(self, api_key: str):
        """
        Initialize SkillClient with authentication.
        
        Args:
            api_key: Stigmer API key for authentication
        """
        config = Config.load_from_env()
        endpoint = config.stigmer_backend_endpoint
        
        # Create interceptor with API key
        interceptor = AuthClientInterceptor(api_key)
        
        # Create channel with interceptor
        if endpoint.endswith(":443"):
            self.channel = grpc.aio.secure_channel(
                endpoint,
                grpc.ssl_channel_credentials(),
                interceptors=[interceptor]
            )
        else:
            self.channel = grpc.aio.insecure_channel(
                endpoint,
                interceptors=[interceptor]
            )
        
        self.stub = query_pb2_grpc.SkillQueryControllerStub(self.channel)
    
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
        
        # Fetch all skills in parallel using get() RPC
        async def fetch_skill(skill_id: str) -> Skill:
            """Fetch a single skill by ID."""
            request = SkillId(value=skill_id)
            try:
                return await self.stub.get(request)
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
            # Fetch all skills in parallel
            skills = await asyncio.gather(*[fetch_skill(skill_id) for skill_id in skill_ids])
            
            logger.info(
                f"Successfully fetched {len(skills)} skills: "
                f"{[s.metadata.name for s in skills]}"
            )
            
            return list(skills)
            
        except ValueError:
            # Re-raise ValueError (skill not found)
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
            return await self.stub.getByReference(ref)
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
            # Fetch all skills in parallel
            skills = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(skills)} skills: "
                f"{[s.metadata.name for s in skills]}"
            )
            
            return list(skills)
            
        except ValueError:
            # Re-raise ValueError (skill not found)
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch skills: {e}")
            raise
