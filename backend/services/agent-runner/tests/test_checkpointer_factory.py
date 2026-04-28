"""Unit tests for checkpointer factory module.

Tests cover:
- Factory context manager behavior for all checkpointer types
- Error handling for missing dependencies
- Error handling for connection failures
- Resource lifecycle management (connection cleanup)
- URI masking for secure logging
- Graceful degradation patterns

Test Categories:
1. Memory Checkpointer Tests - MemorySaver creation
2. SQLite Checkpointer Tests - AsyncSqliteSaver creation with context manager
3. MongoDB Checkpointer Tests - MongoDBSaver creation with client cleanup
4. Error Handling Tests - Missing deps, connection failures
5. Utility Function Tests - URI masking
"""

from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import pytest

from stigmer_runner.worker.checkpointer.factory import (
    CheckpointerCreationError,
    _create_memory_checkpointer,
    _mask_mongodb_uri,
    create_checkpointer,
)
from stigmer_runner.worker.config import CheckpointerConfig

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


def _make_async_cm(return_value):
    """Create a mock async context manager that yields return_value.
    
    Helper for mocking AsyncSqliteSaver.from_conn_string() which is
    an @asynccontextmanager.
    """
    @asynccontextmanager
    async def _cm(*args, **kwargs):
        yield return_value
    return _cm


# =============================================================================
# Tests for Memory Checkpointer
# =============================================================================


class TestMemoryCheckpointer:
    """Tests for memory checkpointer creation."""

    @pytest.mark.asyncio
    async def test_creates_memory_saver(self, memory_config):
        """Test that memory config creates MemorySaver."""
        async with create_checkpointer(memory_config) as checkpointer:
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
        async with create_checkpointer(memory_config) as checkpointer:
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
            async with create_checkpointer(config) as _:
                pass
        
        assert "sqlite_path is required" in str(exc_info.value)
        assert exc_info.value.checkpointer_type == "sqlite"

    @pytest.mark.asyncio
    async def test_sqlite_import_error_handling(self, sqlite_config):
        """Test graceful handling when sqlite package not installed."""
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.sqlite": None,
            "langgraph.checkpoint.sqlite.aio": None,
        }):
            with pytest.raises(CheckpointerCreationError) as exc_info:
                async with create_checkpointer(sqlite_config) as _:
                    pass
            
            assert "not installed" in str(exc_info.value)
            assert exc_info.value.checkpointer_type == "sqlite"

    @pytest.mark.asyncio
    async def test_sqlite_creates_parent_directory(self, sqlite_config, tmp_path):
        """Test that parent directory is created if it doesn't exist."""
        nested_path = tmp_path / "subdir1" / "subdir2" / "checkpoints.db"
        config = CheckpointerConfig(
            type="sqlite",
            sqlite_path=str(nested_path),
        )
        
        mock_saver = MagicMock()
        mock_sqlite_aio = MagicMock()
        mock_sqlite_aio.AsyncSqliteSaver.from_conn_string = _make_async_cm(mock_saver)
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.sqlite": MagicMock(),
            "langgraph.checkpoint.sqlite.aio": mock_sqlite_aio,
        }):
            async with create_checkpointer(config) as checkpointer:
                assert nested_path.parent.exists()
                assert checkpointer is mock_saver

    @pytest.mark.asyncio
    async def test_sqlite_yields_proper_checkpointer(self, tmp_path):
        """Test that sqlite checkpointer yields a proper BaseCheckpointSaver, not a context manager."""
        db_path = tmp_path / "test.db"
        config = CheckpointerConfig(type="sqlite", sqlite_path=str(db_path))
        
        mock_saver = MagicMock()
        mock_saver.put = MagicMock()
        mock_saver.get = MagicMock()
        
        mock_sqlite_aio = MagicMock()
        mock_sqlite_aio.AsyncSqliteSaver.from_conn_string = _make_async_cm(mock_saver)
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.sqlite": MagicMock(),
            "langgraph.checkpoint.sqlite.aio": mock_sqlite_aio,
        }):
            async with create_checkpointer(config) as checkpointer:
                assert checkpointer is mock_saver
                assert hasattr(checkpointer, "put")
                assert hasattr(checkpointer, "get")
                assert not hasattr(checkpointer, "__aenter__") or isinstance(checkpointer, MagicMock)


# =============================================================================
# Tests for MongoDB Checkpointer
# =============================================================================


class TestMongoDBCheckpointer:
    """Tests for MongoDB checkpointer creation."""

    @pytest.mark.asyncio
    async def test_mongodb_requires_uri(self):
        """Test that mongodb without URI raises error."""
        config = CheckpointerConfig(type="mongodb", mongodb_uri=None)
        
        mock_mongodb = MagicMock()
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.mongodb": mock_mongodb,
        }):
            with pytest.raises(CheckpointerCreationError) as exc_info:
                async with create_checkpointer(config) as _:
                    pass
            
            assert "mongodb_uri is required" in str(exc_info.value)
            assert exc_info.value.checkpointer_type == "mongodb"

    @pytest.mark.asyncio
    async def test_mongodb_passes_config_to_saver(self, mongodb_config):
        """Test that mongodb config is passed correctly to MongoDBSaver."""
        mock_mongodb = MagicMock()
        mock_pymongo = MagicMock()
        
        mock_client = MagicMock()
        mock_client.close = MagicMock()
        mock_pymongo.MongoClient.return_value = mock_client
        mock_saver = MagicMock()
        mock_mongodb.MongoDBSaver.return_value = mock_saver
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.mongodb": mock_mongodb,
            "pymongo": mock_pymongo,
        }):
            async with create_checkpointer(mongodb_config) as checkpointer:
                mock_mongodb.MongoDBSaver.assert_called_once_with(
                    mock_client,
                    db_name="test_checkpoints",
                    ttl=3600,
                )
                assert checkpointer is mock_saver
            
            mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_mongodb_client_closed_on_exit(self, mongodb_config):
        """Test that MongoDB client is properly closed when context exits."""
        mock_mongodb = MagicMock()
        mock_pymongo = MagicMock()
        
        mock_client = MagicMock()
        mock_client.close = MagicMock()
        mock_pymongo.MongoClient.return_value = mock_client
        mock_mongodb.MongoDBSaver.return_value = MagicMock()
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.mongodb": mock_mongodb,
            "pymongo": mock_pymongo,
        }):
            async with create_checkpointer(mongodb_config):
                mock_client.close.assert_not_called()
            
            mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_mongodb_client_closed_on_error(self, mongodb_config):
        """Test that MongoDB client is closed even if an error occurs during use."""
        mock_mongodb = MagicMock()
        mock_pymongo = MagicMock()
        
        mock_client = MagicMock()
        mock_client.close = MagicMock()
        mock_pymongo.MongoClient.return_value = mock_client
        mock_mongodb.MongoDBSaver.return_value = MagicMock()
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.mongodb": mock_mongodb,
            "pymongo": mock_pymongo,
        }):
            with pytest.raises((RuntimeError, CheckpointerCreationError)):
                async with create_checkpointer(mongodb_config):
                    raise RuntimeError("simulated error")
            
            mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_mongodb_connection_failure_handling(self, mongodb_config):
        """Test graceful handling of MongoDB connection failures."""
        mock_mongodb = MagicMock()
        mock_pymongo = MagicMock()
        mock_pymongo.MongoClient.side_effect = Exception("Connection refused")
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.mongodb": mock_mongodb,
            "pymongo": mock_pymongo,
        }):
            with pytest.raises(CheckpointerCreationError) as exc_info:
                async with create_checkpointer(mongodb_config) as _:
                    pass
            
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
            async with create_checkpointer(config) as _:
                pass
        
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
        async with create_checkpointer(memory_config) as checkpointer:
            # Verify it has the expected interface
            assert hasattr(checkpointer, "put")
            assert hasattr(checkpointer, "get")

    @pytest.mark.asyncio
    async def test_config_type_determines_checkpointer(self):
        """Test that config type determines which checkpointer is created."""
        memory_config = CheckpointerConfig(type="memory")
        
        async with create_checkpointer(memory_config) as checkpointer:
            from langgraph.checkpoint.memory import MemorySaver
            assert isinstance(checkpointer, MemorySaver)

    @pytest.mark.asyncio
    async def test_different_configs_create_different_checkpointers(self, memory_config, sqlite_config):
        """Test that different configs create different checkpointer types."""
        async with create_checkpointer(memory_config) as memory_cp:
            memory_type = type(memory_cp).__name__
        
        mock_saver = MagicMock()
        mock_sqlite_aio = MagicMock()
        mock_sqlite_aio.AsyncSqliteSaver.from_conn_string = _make_async_cm(mock_saver)
        
        with patch.dict("sys.modules", {
            "langgraph.checkpoint.sqlite": MagicMock(),
            "langgraph.checkpoint.sqlite.aio": mock_sqlite_aio,
        }):
            async with create_checkpointer(sqlite_config) as sqlite_cp:
                sqlite_type = type(sqlite_cp).__name__
        
        # They should be different types
        assert "Saver" in memory_type or "Memory" in memory_type
        assert memory_type != sqlite_type
