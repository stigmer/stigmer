"""Unit tests for Config.get_sandbox_config() session-scoped directories.

Covers T01 changes: the ``session_id`` parameter that scopes local-mode
workspace roots to ``{SANDBOX_ROOT_DIR}/sessions/{session_id}/``.
"""

from pathlib import Path

import pytest

from worker.config import CheckpointerConfig, Config, ExecutionMode, LLMConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(*, mode: str = "local", sandbox_root_dir: str = "/tmp/workspace") -> Config:
    """Build a minimal Config for testing get_sandbox_config()."""
    return Config(
        mode=mode,
        temporal_namespace="default",
        temporal_service_address="localhost:7233",
        task_queue="test-queue",
        max_concurrency=1,
        stigmer_backend_endpoint="localhost:50051",
        stigmer_token="test-key",
        sandbox_type="filesystem" if mode == "local" else "daytona",
        sandbox_root_dir=sandbox_root_dir if mode == "local" else None,
        redis_host=None,
        redis_port=None,
        redis_password=None,
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


# ===========================================================================
# Local mode — session_id scoping
# ===========================================================================


class TestGetSandboxConfigLocal:
    """get_sandbox_config() in local mode."""

    def test_no_session_id_returns_flat_root(self):
        """Without session_id, returns the flat SANDBOX_ROOT_DIR."""
        cfg = _make_config(sandbox_root_dir="/tmp/workspace")
        result = cfg.get_sandbox_config()

        assert result == {"type": "filesystem", "root_dir": "/tmp/workspace"}

    def test_session_id_returns_scoped_path(self):
        """With a valid session_id, root_dir is scoped under sessions/."""
        cfg = _make_config(sandbox_root_dir="/tmp/workspace")
        result = cfg.get_sandbox_config(session_id="abc-123-def")

        expected_root = str(Path("/tmp/workspace") / "sessions" / "abc-123-def")
        assert result == {"type": "filesystem", "root_dir": expected_root}

    def test_session_id_with_forward_slash_raises(self):
        """session_id containing '/' is rejected."""
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_sandbox_config(session_id="bad/id")

    def test_session_id_with_backslash_raises(self):
        """session_id containing '\\' is rejected."""
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_sandbox_config(session_id="bad\\id")

    def test_session_id_with_dotdot_raises(self):
        """session_id containing '..' is rejected (path traversal guard)."""
        cfg = _make_config()
        with pytest.raises(ValueError, match="must not contain path separators"):
            cfg.get_sandbox_config(session_id="..evil")

    def test_none_session_id_is_backward_compatible(self):
        """Explicitly passing None behaves the same as omitting it."""
        cfg = _make_config(sandbox_root_dir="/workspace")
        result = cfg.get_sandbox_config(session_id=None)

        assert result == {"type": "filesystem", "root_dir": "/workspace"}


# ===========================================================================
# Cloud mode — session_id is ignored
# ===========================================================================


class TestGetSandboxConfigCloud:
    """get_sandbox_config() in cloud mode."""

    def test_cloud_mode_ignores_session_id(self):
        """In cloud mode, session_id does not affect the returned config."""
        cfg = _make_config(mode="cloud")
        result = cfg.get_sandbox_config(session_id="sess-should-be-ignored")

        assert result["type"] == "daytona"
        assert "root_dir" not in result

    def test_cloud_mode_without_session_id(self):
        """Cloud mode without session_id returns basic daytona config."""
        cfg = _make_config(mode="cloud")
        result = cfg.get_sandbox_config()

        assert result["type"] == "daytona"

    def test_cloud_mode_with_snapshot_env(self, monkeypatch):
        """Cloud mode picks up DAYTONA_DEV_TOOLS_SNAPSHOT_ID from env."""
        monkeypatch.setenv("DAYTONA_DEV_TOOLS_SNAPSHOT_ID", "snap-007")
        cfg = _make_config(mode="cloud")
        result = cfg.get_sandbox_config()

        assert result == {"type": "daytona", "snapshot_id": "snap-007"}
