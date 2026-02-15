"""Unit tests for SandboxManager volume, mount wiring, and recovery chain.

Covers T02 (Daytona volume init + mount) and T03 (sandbox restart/recovery)
changes to sandbox_manager.py.  All tests are mock-based — no real Daytona
calls.
"""

import pytest
from unittest.mock import MagicMock, patch

from daytona import SandboxState

from worker.sandbox_manager import (
    DAYTONA_WORKSPACE_MOUNT_PATH,
    SandboxManager,
    get_daytona_volume_id,
    initialize_daytona_volume,
    set_daytona_volume_id,
)
from worker.config import ExecutionMode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sandbox_mock(
    *,
    state: SandboxState = SandboxState.STARTED,
    sandbox_id: str = "sbx-test-123",
    alive: bool = True,
    recoverable: bool = False,
    error_reason: str = "",
) -> MagicMock:
    """Build a mock Daytona sandbox with configurable state."""
    sandbox = MagicMock()
    sandbox.id = sandbox_id
    sandbox.state = state
    sandbox.recoverable = recoverable
    sandbox.error_reason = error_reason

    # Health-check mock: process.exec("echo alive") returns exit_code 0 or 1
    exec_result = MagicMock()
    exec_result.exit_code = 0 if alive else 1
    sandbox.process.exec.return_value = exec_result

    return sandbox


def _make_manager(
    *,
    volume_id: str | None = "vol-abc-123",
    api_key: str = "test-api-key",
) -> SandboxManager:
    """Build a SandboxManager with a pre-configured mock Daytona client."""
    mgr = SandboxManager(
        execution_mode=ExecutionMode.LOCAL,
        daytona_api_key=api_key,
        volume_id=volume_id,
    )
    # Pre-set the Daytona client so _create_daytona_sandbox doesn't try
    # to initialise a real one.
    mgr._daytona = MagicMock()
    return mgr


# ===========================================================================
# Module-level volume functions
# ===========================================================================


class TestVolumeIdStore:
    """get_daytona_volume_id / set_daytona_volume_id round-trip."""

    def test_round_trip(self):
        set_daytona_volume_id("vol-round-trip")
        assert get_daytona_volume_id() == "vol-round-trip"

    def test_initial_state_after_set(self):
        """Setting a value makes it immediately retrievable."""
        set_daytona_volume_id("vol-new")
        assert get_daytona_volume_id() == "vol-new"

    def test_overwrite(self):
        """A second set overwrites the first."""
        set_daytona_volume_id("vol-first")
        set_daytona_volume_id("vol-second")
        assert get_daytona_volume_id() == "vol-second"


class TestInitializeDaytonaVolume:
    """initialize_daytona_volume() — Daytona SDK interaction."""

    @patch("worker.sandbox_manager.Daytona")
    @patch("worker.sandbox_manager.DaytonaConfig")
    def test_creates_volume_and_stores_id(self, mock_config_cls, mock_daytona_cls):
        mock_volume = MagicMock()
        mock_volume.id = "vol-created-42"

        mock_daytona = MagicMock()
        mock_daytona.volume.get.return_value = mock_volume
        mock_daytona_cls.return_value = mock_daytona

        result = initialize_daytona_volume("key-123", volume_name="test-vol")

        assert result == "vol-created-42"
        assert get_daytona_volume_id() == "vol-created-42"
        mock_daytona.volume.get.assert_called_once_with("test-vol", create=True)
        mock_config_cls.assert_called_once_with(api_key="key-123")

    @patch("worker.sandbox_manager.Daytona")
    @patch("worker.sandbox_manager.DaytonaConfig")
    def test_uses_default_volume_name(self, mock_config_cls, mock_daytona_cls):
        mock_volume = MagicMock()
        mock_volume.id = "vol-default"
        mock_daytona = MagicMock()
        mock_daytona.volume.get.return_value = mock_volume
        mock_daytona_cls.return_value = mock_daytona

        initialize_daytona_volume("key-456")

        mock_daytona.volume.get.assert_called_once_with(
            "stigmer-workspaces", create=True,
        )

    @patch("worker.sandbox_manager.DAYTONA_AVAILABLE", False)
    def test_raises_when_sdk_unavailable(self):
        with pytest.raises(RuntimeError, match="Daytona SDK not available"):
            initialize_daytona_volume("key-789")


# ===========================================================================
# _create_daytona_sandbox — volume mount wiring
# ===========================================================================


class TestCreateDaytonaSandboxVolumeMount:
    """_create_daytona_sandbox() — volume mount construction."""

    def test_volume_mount_with_volume_id_and_session_id(self):
        """VolumeMount is passed when both volume_id and session_id are set."""
        mgr = _make_manager(volume_id="vol-abc")
        # Make sandbox ready immediately
        ready_result = MagicMock(exit_code=0)
        sandbox = MagicMock()
        sandbox.id = "sbx-new"
        sandbox.process.exec.return_value = ready_result
        mgr._daytona.create.return_value = sandbox

        result = mgr._create_daytona_sandbox(
            {"type": "daytona"}, session_id="sess-001",
        )

        assert result is sandbox
        # Verify create was called with params containing volume mount
        call_kwargs = mgr._daytona.create.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params")
        assert params is not None
        assert params.volumes is not None
        assert len(params.volumes) == 1

        mount = params.volumes[0]
        assert mount.volume_id == "vol-abc"
        assert mount.mount_path == DAYTONA_WORKSPACE_MOUNT_PATH
        assert mount.subpath == "sessions/sess-001"

    def test_no_volume_mount_without_session_id(self):
        """No VolumeMount when session_id is None (ephemeral sandbox)."""
        mgr = _make_manager(volume_id="vol-abc")
        sandbox = MagicMock()
        sandbox.id = "sbx-ephemeral"
        sandbox.process.exec.return_value = MagicMock(exit_code=0)
        mgr._daytona.create.return_value = sandbox

        mgr._create_daytona_sandbox({"type": "daytona"}, session_id=None)

        # Vanilla create (no params) because no volume mount
        mgr._daytona.create.assert_called_once_with()

    def test_no_volume_mount_without_volume_id(self):
        """No VolumeMount when manager has no volume_id."""
        mgr = _make_manager(volume_id=None)
        sandbox = MagicMock()
        sandbox.id = "sbx-no-vol"
        sandbox.process.exec.return_value = MagicMock(exit_code=0)
        mgr._daytona.create.return_value = sandbox

        mgr._create_daytona_sandbox(
            {"type": "daytona"}, session_id="sess-002",
        )

        # Vanilla create (no volume, even though session_id is present)
        mgr._daytona.create.assert_called_once_with()

    def test_auto_delete_disabled_with_snapshot(self):
        """auto_delete_interval=-1 when creating from snapshot + volume."""
        mgr = _make_manager(volume_id="vol-snap")
        sandbox = MagicMock()
        sandbox.id = "sbx-snap"
        sandbox.process.exec.return_value = MagicMock(exit_code=0)
        mgr._daytona.create.return_value = sandbox

        mgr._create_daytona_sandbox(
            {"type": "daytona", "snapshot_id": "snap-123"},
            session_id="sess-003",
        )

        call_kwargs = mgr._daytona.create.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params")
        assert params.auto_delete_interval == -1
        assert params.snapshot == "snap-123"

    def test_auto_delete_disabled_without_snapshot(self):
        """auto_delete_interval=-1 when creating with volume but no snapshot."""
        mgr = _make_manager(volume_id="vol-no-snap")
        sandbox = MagicMock()
        sandbox.id = "sbx-no-snap"
        sandbox.process.exec.return_value = MagicMock(exit_code=0)
        mgr._daytona.create.return_value = sandbox

        mgr._create_daytona_sandbox(
            {"type": "daytona"}, session_id="sess-004",
        )

        call_kwargs = mgr._daytona.create.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params")
        assert params.auto_delete_interval == -1

    def test_rejects_non_daytona_type(self):
        """Raises ValueError for non-daytona sandbox type."""
        mgr = _make_manager()
        with pytest.raises(ValueError, match="Only 'daytona' sandbox type supported"):
            mgr._create_daytona_sandbox({"type": "docker"})

    def test_rejects_non_dict_config(self):
        """Raises ValueError for non-dict config."""
        mgr = _make_manager()
        with pytest.raises(ValueError, match="sandbox_config must be a dictionary"):
            mgr._create_daytona_sandbox("not-a-dict")


# ===========================================================================
# _is_daytona_sandbox_alive — health check
# ===========================================================================


class TestIsDaytonaSandboxAlive:
    """_is_daytona_sandbox_alive() — sandbox responsiveness probe."""

    def test_alive_when_exit_code_zero(self):
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(alive=True)

        assert mgr._is_daytona_sandbox_alive(sandbox) is True
        sandbox.process.exec.assert_called_once_with("echo alive", timeout=5)

    def test_not_alive_when_exit_code_nonzero(self):
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(alive=False)

        assert mgr._is_daytona_sandbox_alive(sandbox) is False

    def test_not_alive_when_exec_raises(self):
        mgr = _make_manager()
        sandbox = _make_sandbox_mock()
        sandbox.process.exec.side_effect = RuntimeError("connection refused")

        assert mgr._is_daytona_sandbox_alive(sandbox) is False


# ===========================================================================
# _try_revive_daytona_sandbox — state machine
# ===========================================================================


class TestTryReviveDaytonaSandbox:
    """_try_revive_daytona_sandbox() — state-aware recovery chain (DD02)."""

    # -- STARTED ---------------------------------------------------------------

    def test_started_and_alive(self):
        """STARTED + responsive health check -> True (reuse)."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.STARTED, alive=True)

        assert mgr._try_revive_daytona_sandbox(sandbox) is True

    def test_started_but_not_alive(self):
        """STARTED + unresponsive health check -> False (unrecoverable)."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.STARTED, alive=False)

        assert mgr._try_revive_daytona_sandbox(sandbox) is False

    # -- STOPPED ---------------------------------------------------------------

    def test_stopped_start_succeeds(self):
        """STOPPED + start() succeeds -> True."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.STOPPED)

        assert mgr._try_revive_daytona_sandbox(sandbox) is True
        sandbox.start.assert_called_once_with(timeout=60)

    def test_stopped_start_fails(self):
        """STOPPED + start() raises -> False."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.STOPPED)
        sandbox.start.side_effect = RuntimeError("start failed")

        assert mgr._try_revive_daytona_sandbox(sandbox) is False

    # -- ARCHIVED --------------------------------------------------------------

    def test_archived_start_succeeds(self):
        """ARCHIVED + start() succeeds -> True (with 120s timeout)."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.ARCHIVED)

        assert mgr._try_revive_daytona_sandbox(sandbox) is True
        sandbox.start.assert_called_once_with(timeout=120)

    def test_archived_start_fails(self):
        """ARCHIVED + start() raises -> False."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.ARCHIVED)
        sandbox.start.side_effect = TimeoutError("restore timed out")

        assert mgr._try_revive_daytona_sandbox(sandbox) is False

    # -- ERROR -----------------------------------------------------------------

    def test_error_recoverable_recover_succeeds(self):
        """ERROR + recoverable + recover() succeeds -> True."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(
            state=SandboxState.ERROR,
            recoverable=True,
            error_reason="transient failure",
        )

        assert mgr._try_revive_daytona_sandbox(sandbox) is True
        sandbox.recover.assert_called_once_with(timeout=60)

    def test_error_recoverable_recover_fails(self):
        """ERROR + recoverable + recover() raises -> False."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(
            state=SandboxState.ERROR,
            recoverable=True,
            error_reason="transient failure",
        )
        sandbox.recover.side_effect = RuntimeError("recovery failed")

        assert mgr._try_revive_daytona_sandbox(sandbox) is False

    def test_error_non_recoverable(self):
        """ERROR + non-recoverable -> False (no recover attempt)."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(
            state=SandboxState.ERROR,
            recoverable=False,
            error_reason="fatal crash",
        )

        assert mgr._try_revive_daytona_sandbox(sandbox) is False
        sandbox.recover.assert_not_called()

    # -- DESTROYED -------------------------------------------------------------

    def test_destroyed(self):
        """DESTROYED -> False."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=SandboxState.DESTROYED)

        assert mgr._try_revive_daytona_sandbox(sandbox) is False

    # -- Transitional / unknown ------------------------------------------------

    @pytest.mark.parametrize(
        "state",
        [
            SandboxState.STARTING,
            SandboxState.STOPPING,
            SandboxState.CREATING,
            SandboxState.UNKNOWN,
        ],
    )
    def test_transitional_states(self, state):
        """Transitional/unknown states -> False."""
        mgr = _make_manager()
        sandbox = _make_sandbox_mock(state=state)

        assert mgr._try_revive_daytona_sandbox(sandbox) is False
