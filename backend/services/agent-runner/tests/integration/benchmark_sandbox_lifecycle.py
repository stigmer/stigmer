"""Benchmark: Daytona sandbox lifecycle timings.

Measures actual wall-clock time for each sandbox lifecycle transition
to inform auto_stop_interval and auto_archive_interval configuration.

Also tests the ARCHIVING race condition: what happens when start() is
called while a sandbox is mid-archive.

Usage:
    DAYTONA_API_KEY=dtn_... python -m pytest tests/integration/benchmark_sandbox_lifecycle.py -v -s 2>&1
"""

from __future__ import annotations

import logging
import os
import time

import pytest

logger = logging.getLogger(__name__)

_SKIP_DAYTONA = not os.environ.get("DAYTONA_API_KEY")


def _skip_reason() -> str:
    return "Requires DAYTONA_API_KEY env var"


try:
    from daytona import Daytona, DaytonaConfig, SandboxState
    from daytona.common.daytona import CreateSandboxFromSnapshotParams
except ImportError:
    _SKIP_DAYTONA = True

    def _skip_reason() -> str:  # type: ignore[misc]
        return "daytona SDK not installed"


_SNAPSHOT_ID = os.environ.get("DAYTONA_DEV_TOOLS_SNAPSHOT_ID", "daytona-small")
_DATA_DIR = "/home/daytona"


def _wait_for_ready(sandbox, timeout_seconds: int = 180) -> float:
    """Poll until sandbox responds to exec. Returns elapsed seconds."""
    start = time.monotonic()
    poll_interval = 2
    max_attempts = timeout_seconds // poll_interval
    for attempt in range(max_attempts):
        try:
            result = sandbox.process.exec("echo ready", timeout=5)
            if result.exit_code == 0:
                return time.monotonic() - start
        except Exception:
            pass
        time.sleep(poll_interval)
    raise RuntimeError(f"Sandbox {sandbox.id} not ready within {timeout_seconds}s")


def _wait_for_state(sandbox, target_state, timeout_seconds: int = 600) -> float:
    """Poll until sandbox reaches target state. Returns elapsed seconds."""
    start = time.monotonic()
    poll_interval = 5
    max_attempts = timeout_seconds // poll_interval
    for attempt in range(max_attempts):
        sandbox.refresh_data()
        current = sandbox.state
        if current == target_state:
            return time.monotonic() - start
        if attempt % 6 == 0:
            logger.info(
                "Waiting for %s, currently %s (%.0fs elapsed)",
                target_state, current, time.monotonic() - start,
            )
        time.sleep(poll_interval)
    raise RuntimeError(
        f"Sandbox {sandbox.id} did not reach {target_state} within {timeout_seconds}s "
        f"(current: {sandbox.state})"
    )


def _write_test_data(sandbox, size_mb: int) -> None:
    """Write test data to sandbox filesystem to simulate workspace usage."""
    if size_mb <= 0:
        return

    sandbox.process.exec(f"mkdir -p {_DATA_DIR}/workspace", timeout=10)

    result = sandbox.process.exec(
        f"dd if=/dev/urandom of={_DATA_DIR}/workspace/testdata.bin "
        f"bs=1M count={size_mb} 2>&1",
        timeout=300,
    )
    assert result.exit_code == 0, f"dd failed: {result.result}"

    sandbox.process.exec(
        f"mkdir -p {_DATA_DIR}/workspace/many_files && "
        "for i in $(seq 1 500); do "
        f"  echo \"file content $i\" > {_DATA_DIR}/workspace/many_files/file_$i.txt; "
        "done",
        timeout=60,
    )

    verify = sandbox.process.exec(f"du -sh {_DATA_DIR}/", timeout=10)
    logger.info("Total size after seeding %d MB: %s", size_mb, verify.result.strip())


def _log_state(sandbox, label: str) -> str:
    """Log and return current sandbox state."""
    sandbox.refresh_data()
    state = sandbox.state
    logger.info("[%s] sandbox state = %s", label, state)
    return state


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSandboxLifecycleBenchmark:

    @pytest.fixture(autouse=True)
    def _setup(self):
        self.api_key = os.environ["DAYTONA_API_KEY"]
        self.daytona = Daytona(DaytonaConfig(api_key=self.api_key))

    def _create_sandbox(self):
        params = CreateSandboxFromSnapshotParams(
            snapshot=_SNAPSHOT_ID,
            auto_delete_interval=-1,
            auto_stop_interval=0,
        )
        sandbox = self.daytona.create(params=params)
        logger.info("Created sandbox: %s", sandbox.id)
        return sandbox

    def _run_lifecycle(self, data_size_mb: int) -> dict:
        results = {"data_size_mb": data_size_mb}
        sandbox = None

        try:
            # 1. Create from snapshot
            sandbox = self._create_sandbox()
            ready_elapsed = _wait_for_ready(sandbox)
            results["create_s"] = round(ready_elapsed, 2)
            logger.info("[%d MB] create_from_snapshot: %.2fs", data_size_mb, ready_elapsed)

            # 2. Seed data
            _write_test_data(sandbox, data_size_mb)
            _log_state(sandbox, "after seed")

            # 3. Stop
            t0 = time.monotonic()
            sandbox.stop(timeout=60)
            stop_elapsed = time.monotonic() - t0
            results["stop_s"] = round(stop_elapsed, 2)
            logger.info("[%d MB] stop: %.2fs", data_size_mb, stop_elapsed)
            _log_state(sandbox, "after stop")

            # 4. Start from STOPPED
            t0 = time.monotonic()
            sandbox.start(timeout=120)
            _wait_for_ready(sandbox)
            total_stopped = time.monotonic() - t0
            results["start_from_stopped_s"] = round(total_stopped, 2)
            logger.info("[%d MB] start_from_stopped: %.2fs", data_size_mb, total_stopped)

            # 5. Verify data survived stop/start
            if data_size_mb > 0:
                verify = sandbox.process.exec(f"du -sh {_DATA_DIR}/workspace/", timeout=10)
                results["data_after_stop_start"] = verify.result.strip()
                logger.info("[%d MB] data after stop/start: %s", data_size_mb, verify.result.strip())

            # 6. Stop again, then archive
            sandbox.stop(timeout=60)
            time.sleep(3)
            _log_state(sandbox, "before archive")

            t0 = time.monotonic()
            sandbox.archive()
            _wait_for_state(sandbox, SandboxState.ARCHIVED, timeout_seconds=900)
            archive_elapsed = time.monotonic() - t0
            results["archive_s"] = round(archive_elapsed, 2)
            logger.info("[%d MB] archive (to cold storage): %.2fs", data_size_mb, archive_elapsed)

            # 7. Start from ARCHIVED
            t0 = time.monotonic()
            sandbox.start(timeout=600)
            _wait_for_ready(sandbox)
            total_archived = time.monotonic() - t0
            results["start_from_archived_s"] = round(total_archived, 2)
            logger.info("[%d MB] start_from_archived: %.2fs", data_size_mb, total_archived)

            # 8. Verify data survived archive/restore
            if data_size_mb > 0:
                verify = sandbox.process.exec(f"du -sh {_DATA_DIR}/workspace/", timeout=10)
                results["data_after_archive_restore"] = verify.result.strip()
                logger.info("[%d MB] data after archive/restore: %s", data_size_mb, verify.result.strip())

                check = sandbox.process.exec(
                    f"cat {_DATA_DIR}/workspace/many_files/file_42.txt", timeout=5,
                )
                results["spot_check_survived"] = check.exit_code == 0

            # 9. Delete
            t0 = time.monotonic()
            sandbox.delete()
            delete_elapsed = time.monotonic() - t0
            results["delete_s"] = round(delete_elapsed, 2)
            logger.info("[%d MB] delete: %.2fs", data_size_mb, delete_elapsed)
            sandbox = None

        except Exception as e:
            logger.error("[%d MB] FAILED: %s", data_size_mb, e, exc_info=True)
            results["error"] = str(e)
        finally:
            if sandbox is not None:
                try:
                    sandbox.delete()
                except Exception:
                    pass

        return results

    def _print_summary(self, results: dict) -> None:
        logger.info("")
        logger.info("=" * 70)
        logger.info("  BENCHMARK: %d MB workspace data", results["data_size_mb"])
        logger.info("=" * 70)
        for key, value in results.items():
            if key != "data_size_mb":
                logger.info("  %-40s %s", key, value)
        logger.info("=" * 70)

    def test_lifecycle_empty(self):
        """Lifecycle: empty sandbox (0 MB)."""
        results = self._run_lifecycle(0)
        self._print_summary(results)
        assert "error" not in results

    def test_lifecycle_100mb(self):
        """Lifecycle: 100 MB workspace."""
        results = self._run_lifecycle(100)
        self._print_summary(results)
        assert "error" not in results

    def test_lifecycle_500mb(self):
        """Lifecycle: 500 MB workspace."""
        results = self._run_lifecycle(500)
        self._print_summary(results)
        assert "error" not in results


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestArchivingRaceCondition:
    """Test what happens when start() is called while sandbox is ARCHIVING.

    This simulates the scenario where a user approves HITL or initiates
    a new execution while the sandbox is mid-archive. We need to know
    whether Daytona:
      (a) queues the start and restores automatically,
      (b) raises an error/exception,
      (c) silently fails, or
      (d) something else.
    """

    @pytest.fixture(autouse=True)
    def _setup(self):
        self.api_key = os.environ["DAYTONA_API_KEY"]
        self.daytona = Daytona(DaytonaConfig(api_key=self.api_key))

    def _create_sandbox(self):
        params = CreateSandboxFromSnapshotParams(
            snapshot=_SNAPSHOT_ID,
            auto_delete_interval=-1,
            auto_stop_interval=0,
        )
        sandbox = self.daytona.create(params=params)
        logger.info("Created sandbox: %s", sandbox.id)
        return sandbox

    def test_start_during_archiving_empty(self):
        """Race: call start() on an empty sandbox while it is ARCHIVING."""
        self._run_archiving_race(data_size_mb=0)

    def test_start_during_archiving_100mb(self):
        """Race: call start() on a 100 MB sandbox while it is ARCHIVING."""
        self._run_archiving_race(data_size_mb=100)

    def _run_archiving_race(self, data_size_mb: int):
        sandbox = None
        try:
            # 1. Create and prepare
            sandbox = self._create_sandbox()
            _wait_for_ready(sandbox)
            _write_test_data(sandbox, data_size_mb)

            # 2. Stop
            sandbox.stop(timeout=60)
            time.sleep(2)
            state = _log_state(sandbox, "after stop")
            assert state == SandboxState.STOPPED

            # 3. Fire archive (async) -- do NOT wait for ARCHIVED
            logger.info("Firing archive()...")
            sandbox.archive()
            time.sleep(1)

            # 4. Confirm we are in ARCHIVING state
            sandbox.refresh_data()
            state_after_archive_call = sandbox.state
            logger.info(
                "State 1s after archive(): %s", state_after_archive_call,
            )

            if state_after_archive_call == SandboxState.ARCHIVED:
                logger.info(
                    "Sandbox already ARCHIVED (very fast archive). "
                    "Test is less meaningful but proceeding with start().",
                )
            elif state_after_archive_call != SandboxState.ARCHIVING:
                logger.warning(
                    "Unexpected state after archive(): %s", state_after_archive_call,
                )

            # 5. Attempt start() while ARCHIVING
            logger.info(
                "Calling start() while state=%s...", state_after_archive_call,
            )
            start_result = {"success": False, "error": None, "elapsed_s": 0}
            t0 = time.monotonic()
            try:
                sandbox.start(timeout=300)
                elapsed = time.monotonic() - t0
                start_result["success"] = True
                start_result["elapsed_s"] = round(elapsed, 2)
                logger.info(
                    "start() SUCCEEDED after %.2fs (state was %s)",
                    elapsed, state_after_archive_call,
                )
            except Exception as e:
                elapsed = time.monotonic() - t0
                start_result["error"] = str(e)
                start_result["elapsed_s"] = round(elapsed, 2)
                logger.info(
                    "start() RAISED after %.2fs: %s (state was %s)",
                    elapsed, e, state_after_archive_call,
                )

            # 6. Check final state
            sandbox.refresh_data()
            final_state = sandbox.state
            logger.info("Final state after start() attempt: %s", final_state)

            # 7. If it started, verify exec works
            sandbox_usable = False
            if final_state == SandboxState.STARTED:
                try:
                    result = sandbox.process.exec("echo alive", timeout=5)
                    sandbox_usable = result.exit_code == 0
                except Exception:
                    pass

            # 8. If it started and had data, verify data survived
            data_survived = None
            if sandbox_usable and data_size_mb > 0:
                verify = sandbox.process.exec(
                    f"du -sh {_DATA_DIR}/workspace/", timeout=10,
                )
                data_survived = verify.exit_code == 0
                logger.info(
                    "Data after archiving-race restart: %s",
                    verify.result.strip() if data_survived else "MISSING",
                )

            # Print summary
            logger.info("")
            logger.info("=" * 70)
            logger.info("  ARCHIVING RACE TEST: %d MB", data_size_mb)
            logger.info("=" * 70)
            logger.info("  state_when_start_called:     %s", state_after_archive_call)
            logger.info("  start_succeeded:             %s", start_result["success"])
            logger.info("  start_elapsed_s:             %s", start_result["elapsed_s"])
            logger.info("  start_error:                 %s", start_result["error"])
            logger.info("  final_state:                 %s", final_state)
            logger.info("  sandbox_usable:              %s", sandbox_usable)
            logger.info("  data_survived:               %s", data_survived)
            logger.info("=" * 70)

            # Clean up
            sandbox.delete()
            sandbox = None

        except Exception as e:
            logger.error("ARCHIVING race test failed: %s", e, exc_info=True)
            raise
        finally:
            if sandbox is not None:
                try:
                    sandbox.delete()
                except Exception:
                    pass
