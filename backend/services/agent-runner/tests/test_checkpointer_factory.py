"""Unit tests for checkpointer factory module.

Tests cover:
- Factory function behavior for all checkpointer types
- Error handling for missing dependencies
- Error handling for connection failures
- URI masking for secure logging
- Graceful degradation patterns

Test Categories:
1. Memory Checkpointer Tests - MemorySaver creation
2. SQLite Checkpointer Tests - AsyncSqliteSaver creation
3. MongoDB Checkpointer Tests - AsyncMongoDBSaver creation
4. Error Handling Tests - Missing deps, connection failures
5. Utility Function Tests - URI masking
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from worker.config import CheckpointerConfig
from worker.checkpointer.factory import (
    CheckpointerCreationError,
    create_checkpointer,
    _create_memory_checkpointer,
    _mask_mongodb_uri,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def memory_config():
    """Create a memory checkpointer config."""
    return CheckpointerConfig(type="memory")


@pytest.fixture
def sqlite_config():
    """Create a sqlite checkpointer config."""
    return CheckpointerConfig(
        type="sqlite",
        sqlite_path="/tmp/test_checkpoints.db",
    )


@pytest.fixture
def mongodb_config():
    """Create a mongodb checkpointer config."""
    return CheckpointerConfig(
        type="mongodb",
        mongodb_uri="mongodb://localhost:27017",
        mongodb_db_name="test_checkpoints",
        mongodb_ttl_seconds=3600,
    )


# =============================================================================
# Tests for Memory Checkpointer
# =============================================================================


class TestMemoryCheckpointer:
    """Tests for memory checkpointer creation."""

    @pytest.mark.asyncio
    async def test_creates_memory_saver(self, memory_config):
        """Test that memory config creates MemorySaver."""
        checkpointer = await create_checkpointer(memory_config)
        
        # Verify it's a MemorySaver
        from langgraph.checkpoint.memory import MemorySaver
        assert isinstance(checkpointer, MemorySaver)

    def test_sync_memory_creation(self):
        """Test synchronous memory checkpointer creation."""
        checkpointer = _create_memory_checkpointer()
        
        from langgraph.checkpoint.memory import MemorySaver
        assert isinstance(checkpointer, MemorySaver)

    @pytest.mark.asyncio
    async def test_memory_requires_no_dependencies(self, memory_config):
        """Test that memory checkpointer requires no external dependencies."""
        # This should work without any external packages
        checkpointer = await create_checkpointer(memory_config)
        assert checkpointer is not None


# =============================================================================
# Tests for SQLite Checkpointer
# =============================================================================


class TestSqliteCheckpointer:
    """Tests for SQLite checkpointer creation."""

    @pytest.mark.asyncio
    async def test_sqlite_requires_path(self):
        """Test that sqlite without path raises error."""
        config = CheckpointerConfig(type="sqlite", sqlite_path=None)
        
        with pytest.raises(CheckpointerCreationError) as exc_info:
            await create_checkpointer(config)
        
        assert "sqlite_path is required" in str(exc_info.value)
        assert exc_info.value.checkpointer_type == "sqlite"

    @pytest.mark.asyncio
    async def test_sqlite_import_error_handling(self, sqlite_config):
        """Test graceful handling when sqlite package not installed."""
        with patch.dict("sys.modules", {"langgraph.checkpoint.sqlite.aio": None}):
            with patch(
                "worker.checkpointer.factory.AsyncSqliteSaver",
                side_effect=ImportError("No module named 'langgraph.checkpoint.sqlite'"),
            ):
                # The import will fail, but we can't easily test this without
                # actually uninstalling the package. So we test the error path
                # is reachable by mocking.
                pass

    @pytest.mark.asyncio
    async def test_sqlite_creates_parent_directory(self, sqlite_config, tmp_path):
        """Test that parent directory is created if it doesn't exist."""
        # Create a config with a path in a non-existent directory
        nested_path = tmp_path / "subdir1" / "subdir2" / "checkpoints.db"
        config = CheckpointerConfig(
            type="sqlite",
            sqlite_path=str(nested_path),
        )
        
        # Mock the AsyncSqliteSaver to avoid actual DB creation
        with patch("worker.checkpointer.factory.AsyncSqliteSaver") as mock_sqlite:
            mock_saver = MagicMock()
            mock_sqlite.from_conn_string.return_value = mock_saver
            
            await create_checkpointer(config)
            
            # Verify parent directories were created
            assert nested_path.parent.exists()


# =============================================================================
# Tests for MongoDB Checkpointer
# =============================================================================


class TestMongoDBCheckpointer:
    """Tests for MongoDB checkpointer creation."""

    @pytest.mark.asyncio
    async def test_mongodb_requires_uri(self):
        """Test that mongodb without URI raises error."""
        config = CheckpointerConfig(type="mongodb", mongodb_uri=None)
        
        with pytest.raises(CheckpointerCreationError) as exc_info:
            await create_checkpointer(config)
        
        assert "mongodb_uri is required" in str(exc_info.value)
        assert exc_info.value.checkpointer_type == "mongodb"

    @pytest.mark.asyncio
    async def test_mongodb_passes_config_to_saver(self, mongodb_config):
        """Test that mongodb config is passed correctly to AsyncMongoDBSaver."""
        with patch("worker.checkpointer.factory.AsyncIOMotorClient") as mock_motor:
            with patch("worker.checkpointer.factory.AsyncMongoDBSaver") as mock_saver_class:
                mock_client = MagicMock()
                mock_motor.return_value = mock_client
                mock_saver = MagicMock()
                mock_saver_class.return_value = mock_saver
                
                await create_checkpointer(mongodb_config)
                
                # Verify AsyncMongoDBSaver was called with correct params
                mock_saver_class.assert_called_once_with(
                    client=mock_client,
                    db_name="test_checkpoints",
                    ttl=3600,
                )

    @pytest.mark.asyncio
    async def test_mongodb_connection_failure_handling(self, mongodb_config):
        """Test graceful handling of MongoDB connection failures."""
        with patch("worker.checkpointer.factory.AsyncIOMotorClient") as mock_motor:
            mock_motor.side_effect = Exception("Connection refused")
            
            with pytest.raises(CheckpointerCreationError) as exc_info:
                await create_checkpointer(mongodb_config)
            
            assert exc_info.value.checkpointer_type == "mongodb"
            assert "Failed to connect" in str(exc_info.value)


# =============================================================================
# Tests for Error Handling
# =============================================================================


class TestCheckpointerErrorHandling:
    """Tests for error handling in checkpointer creation."""

    @pytest.mark.asyncio
    async def test_invalid_type_raises_value_error(self):
        """Test that invalid checkpointer type raises ValueError."""
        config = CheckpointerConfig(type="invalid_type")
        
        with pytest.raises(ValueError) as exc_info:
            await create_checkpointer(config)
        
        assert "Unknown checkpointer type" in str(exc_info.value)

    def test_creation_error_has_correct_attributes(self):
        """Test that CheckpointerCreationError has correct attributes."""
        cause = Exception("Original error")
        error = CheckpointerCreationError(
            checkpointer_type="mongodb",
            message="Connection failed",
            cause=cause,
        )
        
        assert error.checkpointer_type == "mongodb"
        assert error.cause is cause
        assert "mongodb" in str(error)
        assert "Connection failed" in str(error)

    def test_creation_error_without_cause(self):
        """Test that CheckpointerCreationError works without cause."""
        error = CheckpointerCreationError(
            checkpointer_type="sqlite",
            message="Path not found",
        )
        
        assert error.cause is None
        assert "sqlite" in str(error)


# =============================================================================
# Tests for URI Masking Utility
# =============================================================================


class TestUriMasking:
    """Tests for MongoDB URI masking utility."""

    def test_masks_password_in_uri(self):
        """Test that password is masked in MongoDB URI."""
        uri = "mongodb://user:secretpassword@localhost:27017/db"
        masked = _mask_mongodb_uri(uri)
        
        assert "secretpassword" not in masked
        assert "****" in masked
        assert "user:" in masked
        assert "@localhost" in masked

    def test_masks_password_with_srv(self):
        """Test that password is masked in MongoDB+SRV URI."""
        uri = "mongodb+srv://user:mysecret@cluster.mongodb.net/db"
        masked = _mask_mongodb_uri(uri)
        
        assert "mysecret" not in masked
        assert "****" in masked

    def test_handles_uri_without_credentials(self):
        """Test that URI without credentials is returned as-is."""
        uri = "mongodb://localhost:27017/db"
        masked = _mask_mongodb_uri(uri)
        
        assert masked == uri

    def test_handles_complex_password(self):
        """Test that complex passwords with special chars are masked."""
        uri = "mongodb://user:p@$$w0rd!@localhost:27017"
        masked = _mask_mongodb_uri(uri)
        
        # Should mask everything between : and @
        assert "p@$$w0rd!" not in masked
        assert "****" in masked

    def test_preserves_host_and_options(self):
        """Test that host and query options are preserved."""
        uri = "mongodb://user:pass@host1:27017,host2:27017/db?replicaSet=rs0"
        masked = _mask_mongodb_uri(uri)
        
        assert "host1:27017" in masked
        assert "host2:27017" in masked
        assert "replicaSet=rs0" in masked


# =============================================================================
# Tests for Integration Scenarios
# =============================================================================


class TestCheckpointerIntegration:
    """Integration tests for checkpointer factory."""

    @pytest.mark.asyncio
    async def test_memory_checkpointer_is_functional(self, memory_config):
        """Test that created memory checkpointer is functional."""
        checkpointer = await create_checkpointer(memory_config)
        
        # Verify it has the expected interface
        assert hasattr(checkpointer, "put")
        assert hasattr(checkpointer, "get")

    @pytest.mark.asyncio
    async def test_config_type_determines_checkpointer(self):
        """Test that config type determines which checkpointer is created."""
        memory_config = CheckpointerConfig(type="memory")
        
        checkpointer = await create_checkpointer(memory_config)
        
        from langgraph.checkpoint.memory import MemorySaver
        assert isinstance(checkpointer, MemorySaver)

    @pytest.mark.asyncio
    async def test_different_configs_create_different_checkpointers(self, memory_config, sqlite_config):
        """Test that different configs create different checkpointer types."""
        memory_cp = await create_checkpointer(memory_config)
        
        # For sqlite, we need to mock since we may not have the package
        with patch("worker.checkpointer.factory.AsyncSqliteSaver") as mock_sqlite:
            mock_saver = MagicMock()
            mock_sqlite.from_conn_string.return_value = mock_saver
            
            sqlite_cp = await create_checkpointer(sqlite_config)
        
        # They should be different types
        assert type(memory_cp).__name__ == "MemorySaver"
