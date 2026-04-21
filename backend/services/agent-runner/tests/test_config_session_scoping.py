"""Unit tests for Config.get_workspace_config() session-scoped directories.

Covers the ``session_id`` parameter that scopes workspace roots to
``{workspace_root_dir}/sessions/{session_id}/``.
"""

from pathlib import Path

import pytest

from worker.config import CheckpointerConfig, Config, ExecutionMode, LLMConfig


def _make_config(*, mode: str = "local", workspace_root_dir: str = "/tmp/workspace") -> Config:
    """Build a minimal Config for testing get_workspace_config()."""
    return Config(
        mode=mode,
        temporal_namespace="default",
        temporal_service_address="localhost:7233",
        task_queue="test-queue",
        max_concurrency=1,
        stigmer_backend_endpoint="localhost:50051",
        stigmer_token="test-key",
        workspace_root_dir=workspace_root_dir,
        stigmer_proxy_endpoint=None,
        llm=LLMConfig(provider="ollama", model_name="test", base_url="http://localhost:11434"),
        checkpointer=CheckpointerConfig(type="memory"),
        execution_mode=ExecutionMode.LOCAL,
        sandbox_image="test:latest",
        sandbox_auto_pull=False,
        sandbox_cleanup=True,
        sandbox_ttl=60,
        artifact_storage=_stub_artifact_storage(),
    )


def _stub_artifact_storage():
    """Return a minimal artifact storage config for test construction."""
    from unittest.mock import MagicMock
    return MagicMock()


class TestGetWorkspaceConfig:
    """get_workspace_config() session-scoped directories."""

    def test_no_session_id_returns_flat_root(self):
        cfg = _make_config(workspace_root_dir="/tmp/workspace")
        result = cfg.get_workspace_config()

        assert result == {"type": "filesystem", "root_dir": "/tmp/workspace"}

    def test_session_id_returns_scoped_path(self):
        cfg = _make_config(workspace_root_dir="/tmp/workspace")
        result = cfg.get_workspace_config(session_id="abc-123-def")

        expected_root = str(Path("/tmp/workspace") / "sessions" / "abc-123-def")
        assert result == {"type": "filesystem", "root_dir": expected_root}

    def test_session_id_with_forward_slash_raises(self):
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_workspace_config(session_id="bad/id")

    def test_session_id_with_backslash_raises(self):
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_workspace_config(session_id="bad\\id")

    def test_session_id_with_dotdot_raises(self):
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_workspace_config(session_id="..evil")

    def test_none_session_id_is_backward_compatible(self):
        cfg = _make_config(workspace_root_dir="/workspace")
        result = cfg.get_workspace_config(session_id=None)

        assert result == {"type": "filesystem", "root_dir": "/workspace"}

    def test_cloud_mode_uses_same_filesystem_backend(self):
        """Cloud mode now also returns filesystem config (runner is inside sandbox)."""
        cfg = _make_config(mode="cloud", workspace_root_dir="/workspace")
        result = cfg.get_workspace_config(session_id="sess-123")

        expected_root = str(Path("/workspace") / "sessions" / "sess-123")
        assert result == {"type": "filesystem", "root_dir": expected_root}
