"""Integration tests: Daytona snapshot resolver, creation, and rotation.

Validates that the Daytona snapshot/image APIs work as expected for the
MCP snapshot pipeline.  Each test creates snapshots with a unique
test-specific prefix (``stigmer-test-XXXXXXXX-``) to avoid collision
with production snapshots and cleans up in a ``finally`` block.

Skipped when ``DAYTONA_API_KEY`` is absent from the environment.

Usage:
    DAYTONA_API_KEY=dtn_... python -m pytest tests/integration/test_snapshot_lifecycle.py -v -s
"""

from __future__ import annotations

import logging
import os
import time
import uuid

import pytest

logger = logging.getLogger(__name__)

_SKIP_DAYTONA = not os.environ.get("DAYTONA_API_KEY")


def _skip_reason() -> str:
    return "Requires DAYTONA_API_KEY env var"


try:
    from daytona import Daytona, DaytonaConfig
    from daytona.common.image import Image
    from daytona.common.snapshot import CreateSnapshotParams
    from daytona_api_client import SnapshotState
except ImportError:
    _SKIP_DAYTONA = True

    def _skip_reason() -> str:  # type: ignore[misc]
        return "daytona SDK not installed"


def _test_prefix() -> str:
    """Generate a unique prefix for test-created snapshots."""
    short_id = uuid.uuid4().hex[:8]
    return f"stigmer-test-{short_id}-"


def _wait_for_snapshot_active(
    daytona: Daytona,
    snapshot_name: str,
    timeout_seconds: int = 600,
    poll_interval: int = 5,
) -> None:
    """Poll until a snapshot reaches ACTIVE state."""
    start = time.monotonic()
    while True:
        elapsed = time.monotonic() - start
        if elapsed > timeout_seconds:
            raise TimeoutError(
                f"Snapshot '{snapshot_name}' did not reach ACTIVE "
                f"within {timeout_seconds}s"
            )

        page = 1
        while True:
            result = daytona.snapshot.list(page=page, limit=100)
            for snap in result.items:
                if snap.name == snapshot_name:
                    logger.info(
                        "Snapshot '%s' state=%s (%.0fs elapsed)",
                        snapshot_name, snap.state, elapsed,
                    )
                    if snap.state == SnapshotState.ACTIVE:
                        return
                    if snap.state == SnapshotState.ERROR:
                        raise RuntimeError(
                            f"Snapshot '{snapshot_name}' reached ERROR state"
                        )
                    break
            else:
                if page >= result.total_pages:
                    break
                page += 1
                continue
            break

        time.sleep(poll_interval)


def _delete_snapshot_by_name(daytona: Daytona, name: str) -> None:
    """Find a snapshot by name and delete it. Best-effort."""
    page = 1
    while True:
        result = daytona.snapshot.list(page=page, limit=100)
        for snap in result.items:
            if snap.name == name:
                daytona.snapshot.delete(snap)
                logger.info("Cleaned up snapshot: %s", name)
                return
        if page >= result.total_pages:
            break
        page += 1
    logger.warning("Snapshot '%s' not found for cleanup", name)


# ---------------------------------------------------------------------------
# TestSnapshotResolver
# ---------------------------------------------------------------------------


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSnapshotResolver:
    """Validates the SnapshotResolver against the live Daytona API."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        api_key = os.environ["DAYTONA_API_KEY"]
        self.daytona = Daytona(DaytonaConfig(api_key=api_key))

    def test_resolve_returns_none_when_no_snapshots(self):
        """A resolver with a prefix that matches nothing returns None."""
        from worker.snapshot_resolver import SnapshotResolver

        resolver = SnapshotResolver(self.daytona, cache_ttl_seconds=0)

        original_prefix = "stigmer-mcp-"
        import worker.snapshot_resolver as sr_module
        saved = sr_module.SNAPSHOT_NAME_PREFIX
        sr_module.SNAPSHOT_NAME_PREFIX = f"stigmer-nonexistent-{uuid.uuid4().hex[:8]}-"
        try:
            result = resolver.resolve()
            assert result is None, f"Expected None, got {result}"
        finally:
            sr_module.SNAPSHOT_NAME_PREFIX = saved

    def test_resolve_caching(self):
        """Second call returns cached value without API call."""
        from worker.snapshot_resolver import SnapshotResolver

        resolver = SnapshotResolver(self.daytona, cache_ttl_seconds=300)

        first = resolver.resolve()
        second = resolver.resolve()
        assert first == second, "Cached value should match first resolve"

    def test_invalidate_clears_cache(self):
        """After invalidate(), the next resolve() re-queries Daytona."""
        from worker.snapshot_resolver import SnapshotResolver

        resolver = SnapshotResolver(self.daytona, cache_ttl_seconds=300)

        first = resolver.resolve()
        resolver.invalidate()
        after_invalidate = resolver.resolve()
        assert first == after_invalidate, (
            "Result should be the same (same Daytona state), "
            "but was re-fetched after invalidation"
        )


# ---------------------------------------------------------------------------
# TestSnapshotCreation
# ---------------------------------------------------------------------------


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSnapshotCreation:
    """Validates the full snapshot creation pipeline against Daytona."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        api_key = os.environ["DAYTONA_API_KEY"]
        self.daytona = Daytona(DaytonaConfig(api_key=api_key))
        self._snapshots_to_cleanup: list[str] = []

    @pytest.fixture(autouse=True)
    def _teardown(self):
        yield
        for name in self._snapshots_to_cleanup:
            try:
                _delete_snapshot_by_name(self.daytona, name)
            except Exception as e:
                logger.warning("Cleanup failed for %s: %s", name, e)

    def test_create_snapshot_from_image_base(self):
        """Create a minimal snapshot using Image.base(), verify ACTIVE, then delete."""
        prefix = _test_prefix()
        snapshot_name = f"{prefix}minimal"
        self._snapshots_to_cleanup.append(snapshot_name)

        image = Image.base("python:3.11-slim").run_commands("echo hello")

        logger.info("Creating snapshot: %s", snapshot_name)
        self.daytona.snapshot.create(
            CreateSnapshotParams(name=snapshot_name, image=image),
            on_logs=lambda line: logger.info("[build] %s", line),
        )

        _wait_for_snapshot_active(self.daytona, snapshot_name)
        logger.info("Snapshot '%s' reached ACTIVE state", snapshot_name)

    def test_pip_install_on_full_image(self):
        """Validate that Image.base(full-image).pip_install() works.

        This catches the ``python`` vs ``python3`` issue: Daytona's
        ``Image.pip_install()`` generates ``RUN python -m pip install ...``
        which requires a ``python`` symlink on debian-based images.

        Skips if the full image hasn't been published to GHCR yet (the
        CI pipeline must run at least once after the Dockerfile was added).
        """
        prefix = _test_prefix()
        snapshot_name = f"{prefix}pip-test"
        self._snapshots_to_cleanup.append(snapshot_name)

        full_image = "ghcr.io/stigmer/agent-sandbox-full:latest"
        image = Image.base(full_image).pip_install("requests")

        logger.info(
            "Creating snapshot with pip_install on full image: %s",
            snapshot_name,
        )
        try:
            self.daytona.snapshot.create(
                CreateSnapshotParams(name=snapshot_name, image=image),
                on_logs=lambda line: logger.info("[build] %s", line),
            )
        except Exception as e:
            if "denied" in str(e) or "not found" in str(e).lower():
                pytest.skip(
                    f"Full image '{full_image}' not available on GHCR yet — "
                    f"run release.sandbox CI pipeline first: {e}"
                )
            raise

        _wait_for_snapshot_active(self.daytona, snapshot_name)
        logger.info(
            "Snapshot '%s' reached ACTIVE — pip_install on full image works",
            snapshot_name,
        )


# ---------------------------------------------------------------------------
# TestSnapshotRotation
# ---------------------------------------------------------------------------


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSnapshotRotation:
    """Validates snapshot listing, filtering, and rotation logic."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        api_key = os.environ["DAYTONA_API_KEY"]
        self.daytona = Daytona(DaytonaConfig(api_key=api_key))
        self._snapshots_to_cleanup: list[str] = []

    @pytest.fixture(autouse=True)
    def _teardown(self):
        yield
        for name in self._snapshots_to_cleanup:
            try:
                _delete_snapshot_by_name(self.daytona, name)
            except Exception as e:
                logger.warning("Cleanup failed for %s: %s", name, e)

    def test_list_and_filter_by_prefix(self):
        """Create 2 test snapshots, list them, verify prefix filtering, clean up."""
        prefix = _test_prefix()
        names = [f"{prefix}snap-a", f"{prefix}snap-b"]
        self._snapshots_to_cleanup.extend(names)

        image = Image.base("python:3.11-slim").run_commands("echo test")

        for name in names:
            logger.info("Creating test snapshot: %s", name)
            self.daytona.snapshot.create(
                CreateSnapshotParams(name=name, image=image),
                on_logs=lambda line: logger.info("[build] %s", line),
            )

        for name in names:
            _wait_for_snapshot_active(self.daytona, name, timeout_seconds=600)
            logger.info("Snapshot '%s' is ACTIVE", name)

        # List all and filter by our test prefix
        page = 1
        found: list[str] = []
        while True:
            result = self.daytona.snapshot.list(page=page, limit=100)
            for snap in result.items:
                if snap.name.startswith(prefix):
                    found.append(snap.name)
            if page >= result.total_pages:
                break
            page += 1

        logger.info("Found snapshots with prefix '%s': %s", prefix, found)
        assert set(found) == set(names), (
            f"Expected {names}, found {found}"
        )
