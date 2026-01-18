"""gRPC client interceptor for adding Stigmer API key authentication."""

import grpc
from typing import Any, Callable, Awaitable, Tuple, Optional, Sequence


class _ClientCallDetails:
    """Custom ClientCallDetails to allow metadata modification."""
    
    def __init__(
        self,
        method: str,
        timeout: Optional[float],
        metadata: Optional[Sequence[Tuple[str, str]]],
        credentials: Optional[grpc.CallCredentials],
        wait_for_ready: Optional[bool],
    ):
        self.method = method
        self.timeout = timeout
        self.metadata = metadata
        self.credentials = credentials
        self.wait_for_ready = wait_for_ready


class AuthClientInterceptor(
    grpc.aio.UnaryUnaryClientInterceptor,
    grpc.aio.UnaryStreamClientInterceptor,
    grpc.aio.StreamUnaryClientInterceptor,
    grpc.aio.StreamStreamClientInterceptor,
):
    """
    gRPC client interceptor that attaches Stigmer API key to all requests.
    
    This interceptor adds 'authorization' metadata with 'Bearer <api_key>' format.
    """
    
    def __init__(self, api_key: str):
        """
        Initialize interceptor with API key.
        
        Args:
            api_key: Stigmer API key for authentication
        """
        self.api_key = api_key
    
    def _augment_call_details(
        self, 
        client_call_details: grpc.aio.ClientCallDetails
    ) -> _ClientCallDetails:
        """
        Add authorization header to call metadata.
        
        Args:
            client_call_details: Original call details
            
        Returns:
            Modified call details with authorization metadata
        """
        # Get current metadata or create empty list
        metadata = list(client_call_details.metadata or [])
        
        # Add authorization header with API key
        metadata.append(("authorization", f"Bearer {self.api_key}"))
        
        # Create new call details with updated metadata
        return _ClientCallDetails(
            method=client_call_details.method,
            timeout=client_call_details.timeout,
            metadata=tuple(metadata),
            credentials=client_call_details.credentials,
            wait_for_ready=client_call_details.wait_for_ready,
        )
    
    async def intercept_unary_unary(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request: Any,
    ) -> Any:
        """Intercept unary-unary calls."""
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request)
    
    async def intercept_unary_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request: Any,
    ) -> Any:
        """Intercept unary-stream calls."""
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request)
    
    async def intercept_stream_unary(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        """Intercept stream-unary calls."""
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request_iterator)
    
    async def intercept_stream_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        """Intercept stream-stream calls."""
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request_iterator)
