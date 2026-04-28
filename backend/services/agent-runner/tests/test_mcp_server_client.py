"""Unit tests for McpServerClient.

Tests cover:
- get() method for fetching single MCP servers by ID
- get_by_reference() method for fetching by ApiResourceReference
- list_by_ids() method for parallel fetching by IDs
- list_by_refs() method for parallel fetching by references
- Channel initialization (secure vs insecure)
- Error handling (NOT_FOUND, other gRPC errors)
"""

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

# =============================================================================
# TestMcpServerClientGet - Tests for get() method
# =============================================================================


class TestMcpServerClientGet:
    """Tests for McpServerClient.get() method."""

    @pytest.fixture
    def mcp_client_with_mock_stub(self, mock_mcp_server_stub):
        """Create McpServerClient with mocked stub and channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            # Mock config
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            # Mock channel
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            
            # Mock stub creation
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            client = McpServerClient(token="test-api-key")
            
            return client

    @pytest.mark.asyncio
    async def test_get_success(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test successful fetch of single MCP server by ID."""
        # Arrange
        mcp_server_id = "mcp-server-123"
        mock_mcp_server_stub.get.return_value = mock_mcp_server
        
        # Act
        result = await mcp_client_with_mock_stub.get(mcp_server_id)
        
        # Assert
        assert result == mock_mcp_server
        mock_mcp_server_stub.get.assert_called_once()
        
        # Verify the request was created with the correct ID
        call_args = mock_mcp_server_stub.get.call_args
        request = call_args[0][0]
        assert request.value == mcp_server_id

    @pytest.mark.asyncio
    async def test_get_not_found(self, mcp_client_with_mock_stub, mock_mcp_server_stub):
        """Test that NOT_FOUND raises ValueError with descriptive message."""
        # Arrange
        mcp_server_id = "nonexistent-server-id"
        
        # Create a mock RpcError with NOT_FOUND status
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.NOT_FOUND,
            initial_metadata=None,
            trailing_metadata=None,
            details="MCP server not found",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.NOT_FOUND)
        mock_mcp_server_stub.get.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            await mcp_client_with_mock_stub.get(mcp_server_id)
        
        assert "not found" in str(exc_info.value).lower()
        assert mcp_server_id in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_grpc_error_propagates(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub
    ):
        """Test that other gRPC errors are propagated."""
        # Arrange
        mcp_server_id = "mcp-server-123"
        
        # Create a mock RpcError with INTERNAL status
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.INTERNAL,
            initial_metadata=None,
            trailing_metadata=None,
            details="Internal server error",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.INTERNAL)
        mock_mcp_server_stub.get.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(grpc.aio.AioRpcError):
            await mcp_client_with_mock_stub.get(mcp_server_id)


# =============================================================================
# TestMcpServerClientGetByReference - Tests for get_by_reference() method
# =============================================================================


class TestMcpServerClientGetByReference:
    """Tests for McpServerClient.get_by_reference() method."""

    @pytest.fixture
    def mcp_client_with_mock_stub(self, mock_mcp_server_stub):
        """Create McpServerClient with mocked stub and channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            return McpServerClient(token="test-api-key")

    @pytest.mark.asyncio
    async def test_get_by_reference_success(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, 
        mock_mcp_server, mock_api_resource_reference
    ):
        """Test successful fetch by ApiResourceReference."""
        # Arrange
        mock_mcp_server_stub.getByReference.return_value = mock_mcp_server
        
        # Act
        result = await mcp_client_with_mock_stub.get_by_reference(mock_api_resource_reference)
        
        # Assert
        assert result == mock_mcp_server
        mock_mcp_server_stub.getByReference.assert_called_once_with(mock_api_resource_reference, timeout=10.0)

    @pytest.mark.asyncio
    async def test_get_by_reference_not_found(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_api_resource_reference
    ):
        """Test that NOT_FOUND raises ValueError with slug in message."""
        # Arrange
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.NOT_FOUND,
            initial_metadata=None,
            trailing_metadata=None,
            details="MCP server not found",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.NOT_FOUND)
        mock_mcp_server_stub.getByReference.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            await mcp_client_with_mock_stub.get_by_reference(mock_api_resource_reference)
        
        assert "not found" in str(exc_info.value).lower()
        assert mock_api_resource_reference.slug in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_by_reference_grpc_error(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_api_resource_reference
    ):
        """Test that other gRPC errors are propagated."""
        # Arrange
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.UNAVAILABLE,
            initial_metadata=None,
            trailing_metadata=None,
            details="Service unavailable",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.UNAVAILABLE)
        mock_mcp_server_stub.getByReference.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(grpc.aio.AioRpcError):
            await mcp_client_with_mock_stub.get_by_reference(mock_api_resource_reference)


# =============================================================================
# TestMcpServerClientListByIds - Tests for list_by_ids() method
# =============================================================================


class TestMcpServerClientListByIds:
    """Tests for McpServerClient.list_by_ids() method."""

    @pytest.fixture
    def mcp_client_with_mock_stub(self, mock_mcp_server_stub):
        """Create McpServerClient with mocked stub and channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            return McpServerClient(token="test-api-key")

    @pytest.mark.asyncio
    async def test_list_by_ids_empty_list(self, mcp_client_with_mock_stub):
        """Test empty IDs list returns empty result."""
        result = await mcp_client_with_mock_stub.list_by_ids([])
        assert result == []

    @pytest.mark.asyncio
    async def test_list_by_ids_success(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test successful parallel fetch of multiple servers by IDs."""
        # Arrange
        mock_mcp_server_stub.get.return_value = mock_mcp_server
        server_ids = ["server-1", "server-2", "server-3"]
        
        # Act
        result = await mcp_client_with_mock_stub.list_by_ids(server_ids)
        
        # Assert
        assert len(result) == 3
        assert mock_mcp_server_stub.get.call_count == 3

    @pytest.mark.asyncio
    async def test_list_by_ids_partial_failure(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test that if one server fetch fails, the entire operation fails."""
        # Arrange
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.NOT_FOUND,
            initial_metadata=None,
            trailing_metadata=None,
            details="Server not found",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.NOT_FOUND)
        
        # First call succeeds, second fails
        mock_mcp_server_stub.get.side_effect = [mock_mcp_server, mock_error]
        server_ids = ["server-1", "nonexistent-server"]
        
        # Act & Assert
        with pytest.raises(ValueError):
            await mcp_client_with_mock_stub.list_by_ids(server_ids)


# =============================================================================
# TestMcpServerClientListByRefs - Tests for list_by_refs() method
# =============================================================================


class TestMcpServerClientListByRefs:
    """Tests for McpServerClient.list_by_refs() method."""

    @pytest.fixture
    def mcp_client_with_mock_stub(self, mock_mcp_server_stub):
        """Create McpServerClient with mocked stub and channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            return McpServerClient(token="test-api-key")

    @pytest.mark.asyncio
    async def test_list_by_refs_empty_list(self, mcp_client_with_mock_stub):
        """Test empty refs list returns empty result."""
        result = await mcp_client_with_mock_stub.list_by_refs([])
        assert result == []

    @pytest.mark.asyncio
    async def test_list_by_refs_success(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test successful parallel fetch of multiple servers by refs."""
        # Arrange
        mock_mcp_server_stub.getByReference.return_value = mock_mcp_server
        
        ref1 = MagicMock()
        ref1.slug = "github"
        ref2 = MagicMock()
        ref2.slug = "custom-api"
        
        # Act
        result = await mcp_client_with_mock_stub.list_by_refs([ref1, ref2])
        
        # Assert
        assert len(result) == 2
        assert mock_mcp_server_stub.getByReference.call_count == 2

    @pytest.mark.asyncio
    async def test_list_by_refs_parallel_fetch(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test that refs are fetched in parallel using asyncio.gather."""
        # Arrange
        mock_mcp_server_stub.getByReference.return_value = mock_mcp_server
        
        refs = [MagicMock(slug=f"server-{i}") for i in range(5)]
        
        # Act
        result = await mcp_client_with_mock_stub.list_by_refs(refs)
        
        # Assert
        assert len(result) == 5
        # All 5 calls should have been made
        assert mock_mcp_server_stub.getByReference.call_count == 5

    @pytest.mark.asyncio
    async def test_list_by_refs_partial_failure(
        self, mcp_client_with_mock_stub, mock_mcp_server_stub, mock_mcp_server
    ):
        """Test that if one ref fetch fails, the entire operation fails."""
        # Arrange
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.NOT_FOUND,
            initial_metadata=None,
            trailing_metadata=None,
            details="Server not found",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.NOT_FOUND)
        
        mock_mcp_server_stub.getByReference.side_effect = [mock_mcp_server, mock_error]
        
        ref1 = MagicMock(slug="existing")
        ref2 = MagicMock(slug="nonexistent")
        
        # Act & Assert
        with pytest.raises(ValueError):
            await mcp_client_with_mock_stub.list_by_refs([ref1, ref2])


# =============================================================================
# TestMcpServerClientChannel - Tests for channel initialization
# =============================================================================


class TestMcpServerClientChannel:
    """Tests for channel initialization (secure vs insecure)."""

    def test_secure_channel_for_port_443(self, mock_mcp_server_stub):
        """Test that port 443 endpoints use secure channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "api.stigmer.ai:443"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            McpServerClient(token="test-api-key")
            
            # Assert secure_channel was called
            mock_grpc_aio.secure_channel.assert_called_once()
            mock_grpc_aio.insecure_channel.assert_not_called()

    def test_insecure_channel_for_other_ports(self, mock_mcp_server_stub):
        """Test that non-443 endpoints use insecure channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            McpServerClient(token="test-api-key")
            
            # Assert insecure_channel was called
            mock_grpc_aio.insecure_channel.assert_called_once()
            mock_grpc_aio.secure_channel.assert_not_called()

    @pytest.mark.asyncio
    async def test_close_channel(self, mock_mcp_server_stub):
        """Test that close() properly closes the channel."""
        with patch('stigmer_runner.grpc_client.mcp_server_client.Config') as mock_config_class, \
             patch('stigmer_runner.grpc_client.mcp_server_client.grpc.aio') as mock_grpc_aio, \
             patch('stigmer_runner.grpc_client.mcp_server_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_channel = MagicMock()
            mock_channel.close = AsyncMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            mock_pb2_grpc.McpServerQueryControllerStub.return_value = mock_mcp_server_stub
            
            from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
            client = McpServerClient(token="test-api-key")
            
            # Act
            await client.close()
            
            # Assert
            mock_channel.close.assert_called_once()
