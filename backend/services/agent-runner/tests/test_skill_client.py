"""Unit tests for SkillClient.get_artifact() method."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import grpc


class TestSkillClientGetArtifact:
    """Tests for SkillClient.get_artifact() method."""

    @pytest.fixture
    def mock_response(self, sample_artifact_zip):
        """Create a mock GetArtifactResponse."""
        response = MagicMock()
        response.artifact = sample_artifact_zip
        return response

    @pytest.fixture
    def skill_client_with_mock_stub(self, mock_skill_stub):
        """Create SkillClient with mocked stub and channel."""
        with patch('grpc_client.skill_client.Config') as mock_config_class, \
             patch('grpc_client.skill_client.grpc.aio') as mock_grpc_aio, \
             patch('grpc_client.skill_client.query_pb2_grpc') as mock_pb2_grpc:
            
            # Mock config
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            # Mock channel
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            
            # Mock stub creation
            mock_pb2_grpc.SkillQueryControllerStub.return_value = mock_skill_stub
            
            from grpc_client.skill_client import SkillClient
            client = SkillClient(api_key="test-api-key")
            
            return client

    @pytest.mark.asyncio
    async def test_get_artifact_success(
        self, skill_client_with_mock_stub, mock_skill_stub, mock_response, sample_artifact_zip
    ):
        """Test successful artifact download."""
        # Arrange
        storage_key = "skills/test-org/test-skill/abc123.zip"
        mock_skill_stub.getArtifact.return_value = mock_response
        
        # Act
        result = await skill_client_with_mock_stub.get_artifact(storage_key)
        
        # Assert
        assert result == sample_artifact_zip
        mock_skill_stub.getArtifact.assert_called_once()
        
        # Verify the request was created with the correct storage key
        call_args = mock_skill_stub.getArtifact.call_args
        request = call_args[0][0]
        assert request.artifact_storage_key == storage_key

    @pytest.mark.asyncio
    async def test_get_artifact_not_found(self, skill_client_with_mock_stub, mock_skill_stub):
        """Test artifact not found raises ValueError."""
        # Arrange
        storage_key = "skills/test-org/nonexistent/xyz.zip"
        
        # Create a mock RpcError with NOT_FOUND status
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.NOT_FOUND,
            initial_metadata=None,
            trailing_metadata=None,
            details="Artifact not found",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.NOT_FOUND)
        mock_skill_stub.getArtifact.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            await skill_client_with_mock_stub.get_artifact(storage_key)
        
        assert "not found" in str(exc_info.value).lower()
        assert storage_key in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_artifact_grpc_error_propagates(
        self, skill_client_with_mock_stub, mock_skill_stub
    ):
        """Test other gRPC errors are propagated."""
        # Arrange
        storage_key = "skills/test-org/test-skill/abc123.zip"
        
        # Create a mock RpcError with INTERNAL status
        mock_error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.INTERNAL,
            initial_metadata=None,
            trailing_metadata=None,
            details="Internal server error",
            debug_error_string=None
        )
        mock_error.code = MagicMock(return_value=grpc.StatusCode.INTERNAL)
        mock_skill_stub.getArtifact.side_effect = mock_error
        
        # Act & Assert
        with pytest.raises(grpc.aio.AioRpcError):
            await skill_client_with_mock_stub.get_artifact(storage_key)

    @pytest.mark.asyncio
    async def test_get_artifact_logs_download_info(
        self, skill_client_with_mock_stub, mock_skill_stub, mock_response, sample_artifact_zip
    ):
        """Test that artifact download is logged properly."""
        # Arrange
        storage_key = "skills/test-org/test-skill/abc123.zip"
        mock_skill_stub.getArtifact.return_value = mock_response
        
        with patch('grpc_client.skill_client.logger') as mock_logger:
            # Act
            result = await skill_client_with_mock_stub.get_artifact(storage_key)
            
            # Assert - verify logging calls
            assert mock_logger.info.call_count >= 1
            
            # Check that download start was logged
            log_messages = [str(call) for call in mock_logger.info.call_args_list]
            assert any(storage_key in msg for msg in log_messages)

    @pytest.mark.asyncio
    async def test_get_artifact_returns_correct_bytes(
        self, skill_client_with_mock_stub, mock_skill_stub
    ):
        """Test that the exact artifact bytes are returned."""
        # Arrange
        expected_bytes = b"PK\x03\x04" + b"\x00" * 100  # Fake ZIP header + padding
        storage_key = "skills/test-org/test-skill/abc123.zip"
        
        mock_response = MagicMock()
        mock_response.artifact = expected_bytes
        mock_skill_stub.getArtifact.return_value = mock_response
        
        # Act
        result = await skill_client_with_mock_stub.get_artifact(storage_key)
        
        # Assert
        assert result == expected_bytes
        assert isinstance(result, bytes)


class TestSkillClientListByRefs:
    """Tests for SkillClient.list_by_refs() method."""

    @pytest.fixture
    def skill_client_with_mock_stub(self, mock_skill_stub):
        """Create SkillClient with mocked stub."""
        with patch('grpc_client.skill_client.Config') as mock_config_class, \
             patch('grpc_client.skill_client.grpc.aio') as mock_grpc_aio, \
             patch('grpc_client.skill_client.query_pb2_grpc') as mock_pb2_grpc:
            
            mock_config = MagicMock()
            mock_config.stigmer_backend_endpoint = "localhost:9090"
            mock_config_class.load_from_env.return_value = mock_config
            
            mock_channel = MagicMock()
            mock_grpc_aio.insecure_channel.return_value = mock_channel
            mock_pb2_grpc.SkillQueryControllerStub.return_value = mock_skill_stub
            
            from grpc_client.skill_client import SkillClient
            return SkillClient(api_key="test-api-key")

    @pytest.mark.asyncio
    async def test_list_by_refs_empty_list(self, skill_client_with_mock_stub):
        """Test empty refs list returns empty result."""
        result = await skill_client_with_mock_stub.list_by_refs([])
        assert result == []

    @pytest.mark.asyncio
    async def test_list_by_refs_success(
        self, skill_client_with_mock_stub, mock_skill_stub, mock_skill
    ):
        """Test successful fetching of multiple skills by refs."""
        # Arrange
        mock_skill_stub.getByReference.return_value = mock_skill
        
        ref1 = MagicMock()
        ref1.slug = "skill-1"
        ref2 = MagicMock()
        ref2.slug = "skill-2"
        
        # Act
        result = await skill_client_with_mock_stub.list_by_refs([ref1, ref2])
        
        # Assert
        assert len(result) == 2
        assert mock_skill_stub.getByReference.call_count == 2
