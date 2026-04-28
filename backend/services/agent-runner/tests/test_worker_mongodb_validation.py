"""Tests for Runner MongoDB connectivity validation.

Covers the _validate_mongodb_connectivity startup check that runs in
cloud mode when the checkpointer type is mongodb.  Verifies:

1. Successful ping — connectivity confirmed, log emitted
2. ConnectionFailure — clear RuntimeError with network guidance
3. OperationFailure — clear RuntimeError with provisioning guidance
4. Skipped for non-mongodb checkpointer types
5. Missing URI raises ValueError
"""

from unittest.mock import MagicMock, patch

import pytest


def _make_runner(checkpointer_type="mongodb", mongodb_uri="mongodb://localhost:27017", mongodb_db_name="stigmer_checkpoints"):
    """Build a Runner with cloud-mode config, bypassing other init steps.

    Patches Redis, Daytona, and MongoDB validation so we can test
    _validate_mongodb_connectivity in isolation afterward.
    """
    from stigmer_runner.worker.config import CheckpointerConfig

    checkpointer_config = CheckpointerConfig(
        type=checkpointer_type,
        mongodb_uri=mongodb_uri,
        mongodb_db_name=mongodb_db_name,
    )

    config = MagicMock()
    config.mode = "cloud"
    config.is_local_mode.return_value = False
    config.checkpointer = checkpointer_config
    config.stigmer_token = "test-key"
    config.redis_host = "localhost"
    config.redis_port = 6379
    config.redis_password = None

    with (
        patch("worker.worker.configure_auth"),
        patch("worker.worker.Runner._validate_mongodb_connectivity"),
    ):
        from stigmer_runner.worker.worker import Runner
        runner = Runner(config)

    return runner


class TestValidateMongoDBConnectivity:
    """Tests for Runner._validate_mongodb_connectivity."""

    def test_successful_ping(self):
        """Ping succeeds — no exception, info log emitted."""
        runner = _make_runner()

        mock_client = MagicMock()
        mock_client.admin.command.return_value = {"ok": 1}

        with patch("pymongo.MongoClient", return_value=mock_client):
            runner._validate_mongodb_connectivity()

        mock_client.admin.command.assert_called_once_with("ping")
        mock_client.close.assert_called_once()

    def test_connection_failure_raises_runtime_error(self):
        """ConnectionFailure produces a RuntimeError with network guidance."""
        runner = _make_runner()

        from pymongo.errors import ConnectionFailure

        mock_client = MagicMock()
        mock_client.admin.command.side_effect = ConnectionFailure("connection refused")

        with patch("pymongo.MongoClient", return_value=mock_client):
            with pytest.raises(RuntimeError, match="MongoDB unreachable"):
                runner._validate_mongodb_connectivity()

        mock_client.close.assert_called_once()

    def test_operation_failure_raises_runtime_error(self):
        """OperationFailure produces a RuntimeError with provisioning guidance."""
        runner = _make_runner()

        from pymongo.errors import OperationFailure

        mock_client = MagicMock()
        mock_client.admin.command.side_effect = OperationFailure("Authentication failed")

        with patch("pymongo.MongoClient", return_value=mock_client):
            with pytest.raises(RuntimeError, match="authentication failed"):
                runner._validate_mongodb_connectivity()

        mock_client.close.assert_called_once()

    def test_skipped_for_memory_checkpointer(self):
        """No-op when checkpointer type is not mongodb."""
        runner = _make_runner(checkpointer_type="memory", mongodb_uri=None)

        with patch("pymongo.MongoClient") as mock_cls:
            runner._validate_mongodb_connectivity()
            mock_cls.assert_not_called()

    def test_skipped_for_sqlite_checkpointer(self):
        """No-op when checkpointer type is sqlite."""
        runner = _make_runner(
            checkpointer_type="sqlite",
            mongodb_uri=None,
            mongodb_db_name="unused",
        )

        with patch("pymongo.MongoClient") as mock_cls:
            runner._validate_mongodb_connectivity()
            mock_cls.assert_not_called()

    def test_missing_uri_raises_value_error(self):
        """Missing mongodb_uri raises ValueError before attempting connection."""
        runner = _make_runner(mongodb_uri=None)

        with pytest.raises(ValueError, match="STIGMER_CHECKPOINTER_MONGODB_URI"):
            runner._validate_mongodb_connectivity()

    def test_client_closed_even_on_unexpected_error(self):
        """Client is always closed, even on unexpected exceptions."""
        runner = _make_runner()

        mock_client = MagicMock()
        mock_client.admin.command.side_effect = TypeError("unexpected")

        with patch("pymongo.MongoClient", return_value=mock_client):
            with pytest.raises(TypeError):
                runner._validate_mongodb_connectivity()

        mock_client.close.assert_called_once()
