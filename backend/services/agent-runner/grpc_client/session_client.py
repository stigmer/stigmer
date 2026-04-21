"""gRPC client for fetching and updating Session resources."""

from __future__ import annotations

import grpc
from ai.stigmer.agentic.session.v1 import command_pb2_grpc, query_pb2_grpc
from ai.stigmer.agentic.session.v1.api_pb2 import Session
from ai.stigmer.agentic.session.v1.io_pb2 import (
    SessionId,
    UpdateSessionSandboxIdRequest,
    UpdateSessionSubjectRequest,
)

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class SessionClient:
    """Client for interacting with SessionCommandController and SessionQueryController."""
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize Session client with authentication.
        
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
        
        self.command_stub = command_pb2_grpc.SessionCommandControllerStub(self.channel)
        self.query_stub = query_pb2_grpc.SessionQueryControllerStub(self.channel)
        self._timeout = timeout
    
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
        return await self.query_stub.get(request, timeout=self._timeout)
    
    async def update(self, session: Session) -> Session:
        """
        Update session (full resource replacement).
        
        Args:
            session: The updated Session protobuf to persist
            
        Returns:
            Updated Session protobuf object
        """
        return await self.command_stub.update(session, timeout=self._timeout)

    async def update_subject(self, session_id: str, subject: str) -> Session:
        """Set the session subject via a field-level update (race-safe).

        The server atomically loads the session, sets only spec.subject,
        and persists -- no other fields are touched.

        Args:
            session_id: The session ID to update.
            subject: New subject value.

        Returns:
            Updated Session protobuf object.
        """
        if not session_id:
            raise ValueError("session_id cannot be empty")
        request = UpdateSessionSubjectRequest(id=session_id, subject=subject)
        return await self.command_stub.updateSubject(request, timeout=self._timeout)

    async def update_sandbox_id(self, session_id: str, sandbox_id: str) -> Session:
        """Set the session sandbox ID via a field-level update (race-safe).

        The server atomically loads the session, sets only spec.sandbox_id,
        and persists -- no other fields are touched.

        Args:
            session_id: The session ID to update.
            sandbox_id: New Daytona sandbox ID.

        Returns:
            Updated Session protobuf object.
        """
        if not session_id:
            raise ValueError("session_id cannot be empty")
        request = UpdateSessionSandboxIdRequest(id=session_id, sandbox_id=sandbox_id)
        return await self.command_stub.updateSandboxId(request, timeout=self._timeout)
