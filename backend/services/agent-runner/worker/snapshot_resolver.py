"""Resolve the latest active MCP snapshot from Daytona.

This module provides a single-purpose resolver that discovers the current
active MCP snapshot by querying the Daytona snapshot API directly, using a
naming convention to identify Stigmer-managed snapshots. Daytona is the
single source of truth -- no external database is needed.

Naming convention: ``stigmer-mcp-YYYYMMDD-HHMMSS``

The resolver is managed as a process-lifetime singleton, initialized once
at worker startup via :func:`initialize_snapshot_resolver` and accessed
from ``Config.get_sandbox_config()`` via :func:`get_snapshot_resolver`.
This mirrors the ``_daytona_volume_id`` pattern in ``sandbox_manager.py``.

The resolver caches the result in-memory with a configurable TTL to avoid
per-sandbox-creation API calls. Thread-safety is ensured via a lock.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from daytona import Daytona

logger = logging.getLogger(__name__)

SNAPSHOT_NAME_PREFIX = "stigmer-mcp-"
SNAPSHOT_TIMESTAMP_FORMAT = "%Y%m%d-%H%M%S"
DEFAULT_CACHE_TTL_SECONDS = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Module-level singleton (initialized once at worker startup)
# ---------------------------------------------------------------------------

_resolver: SnapshotResolver | None = None


def get_snapshot_resolver() -> SnapshotResolver | None:
    """Return the process-level ``SnapshotResolver``, or ``None`` if not
    initialized (e.g. local mode, no ``DAYTONA_API_KEY``)."""
    return _resolver


def initialize_snapshot_resolver(
    daytona_api_key: str,
    cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
) -> SnapshotResolver:
    """Create the process-level ``SnapshotResolver``.

    Called once at worker startup when ``DAYTONA_API_KEY`` is available.
    Safe to call multiple times (idempotent -- replaces the previous
    instance).

    Args:
        daytona_api_key: Daytona API key for the snapshot list API.
        cache_ttl_seconds: How long to cache the resolved snapshot name.

    Returns:
        The initialized ``SnapshotResolver``.
    """
    from daytona import Daytona, DaytonaConfig

    global _resolver
    client = Daytona(DaytonaConfig(api_key=daytona_api_key))
    _resolver = SnapshotResolver(client, cache_ttl_seconds=cache_ttl_seconds)
    logger.info("Snapshot resolver initialized")
    return _resolver


def generate_snapshot_name() -> str:
    """Generate a snapshot name using the naming convention.

    Returns:
        A name like ``stigmer-mcp-20260409-153000``.
    """
    ts = datetime.now(timezone.utc).strftime(SNAPSHOT_TIMESTAMP_FORMAT)
    return f"{SNAPSHOT_NAME_PREFIX}{ts}"


class SnapshotResolver:
    """Discovers the latest active MCP snapshot from Daytona.

    Uses the ``stigmer-mcp-`` naming prefix and ``SnapshotState.ACTIVE``
    filter to find the most recently created snapshot. Results are cached
    in-memory with a configurable TTL.

    Args:
        daytona: An initialized ``Daytona`` client instance.
        cache_ttl_seconds: How long to cache the resolved snapshot name.
            Defaults to 300 (5 minutes).
    """

    def __init__(
        self,
        daytona: Daytona,
        cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        self._daytona = daytona
        self._cache_ttl = cache_ttl_seconds
        self._lock = threading.Lock()
        self._cached_name: str | None = None
        self._cached_at: float = 0.0

    def resolve(self) -> str | None:
        """Return the name of the latest active MCP snapshot, or ``None``.

        The result is cached for ``cache_ttl_seconds``. On Daytona API
        errors the cache is returned if still populated (stale-on-error),
        otherwise ``None`` is returned and the error is logged.
        """
        with self._lock:
            if self._cached_at and (time.monotonic() - self._cached_at) < self._cache_ttl:
                return self._cached_name

        name = self._fetch_latest()

        with self._lock:
            self._cached_name = name
            self._cached_at = time.monotonic()

        return name

    def invalidate(self) -> None:
        """Clear the cache so the next ``resolve()`` call queries Daytona."""
        with self._lock:
            self._cached_name = None
            self._cached_at = 0.0

    def _fetch_latest(self) -> str | None:
        """Query Daytona for the latest active snapshot with our prefix."""
        from daytona_api_client import SnapshotState

        try:
            page = 1
            best_name: str | None = None
            best_created_at: datetime | None = None

            while True:
                result = self._daytona.snapshot.list(page=page, limit=100)

                for snapshot in result.items:
                    if not snapshot.name.startswith(SNAPSHOT_NAME_PREFIX):
                        continue
                    if snapshot.state != SnapshotState.ACTIVE:
                        continue

                    if best_created_at is None or snapshot.created_at > best_created_at:
                        best_name = snapshot.name
                        best_created_at = snapshot.created_at

                if page >= result.total_pages:
                    break
                page += 1

            if best_name:
                logger.info("Resolved MCP snapshot: %s", best_name)
            else:
                logger.debug(
                    "No active snapshot found with prefix '%s'",
                    SNAPSHOT_NAME_PREFIX,
                )

            return best_name

        except Exception:
            with self._lock:
                stale = self._cached_name
            if stale:
                logger.warning(
                    "Daytona snapshot list failed; returning stale cached name '%s'",
                    stale,
                    exc_info=True,
                )
                return stale
            logger.warning(
                "Daytona snapshot list failed and no cached value available",
                exc_info=True,
            )
            return None
