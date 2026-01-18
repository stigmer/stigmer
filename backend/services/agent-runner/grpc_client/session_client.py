"""gRPC client for fetching and updating Session resources."""

import grpc
from ai.stigmer.agentic.session.v1 import command_pb2_grpc, query_pb2_grpc
from ai.stigmer.agentic.session.v1.api_pb2 import Session
from ai.stigmer.agentic.session.v1.io_pb2 import SessionId
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor


class SessionClient:
    """Client for interacting with SessionCommandController and SessionQueryController."""
    
    def __init__(self, api_key: str):
        """
        Initialize Session client with authentication.
        
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
        
        self.command_stub = command_pb2_grpc.SessionCommandControllerStub(self.channel)
        self.query_stub = query_pb2_grpc.SessionQueryControllerStub(self.channel)
    
    async def get(self, session_id: str) -> Session:
        """
        Fetch session by ID.
        
        Args:
            session_id: The session ID to fetch
            
        Returns:
            Session protobuf object
        """
        if not session_id:
            raise ValueError("session_id cannot be empty")
        request = SessionId(value=session_id)
        return await self.query_stub.get(request)
    
    async def update(self, session: Session) -> Session:
        """
        Update session.
        
        Args:
            session: The updated Session protobuf to persist
            
        Returns:
            Updated Session protobuf object
        """
        return await self.command_stub.update(session)
