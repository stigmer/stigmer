"""Temporal activity helper utilities for Graphton execution.

Pure utilities with no domain coupling. Handles:
  - Slim status construction for Temporal payloads
  - Setup-phase timing and diagnostics
  - Heartbeat delivery between setup steps
  - Async-to-sync bridge with periodic heartbeats

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time
from collections.abc import Callable
from typing import Any, TypeVar

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from temporalio import activity

_T = TypeVar("_T")

_HEARTBEAT_INTERVAL_S: float = 30.0
"""Default interval (seconds) between heartbeats while waiting for a
synchronous callable.  Must be well below the Temporal HeartbeatTimeout
(currently 2 minutes) to guarantee at least 3 heartbeats per window."""

_heartbeat_logger = logging.getLogger(f"{__name__}.sync_heartbeat")


def slim_status_for_temporal(status: AgentExecutionStatus) -> AgentExecutionStatus:
    """Build a slim copy of the status for the Temporal activity return value.

    The full status is already persisted via progressive gRPC updates.
    Returning only workflow-critical fields keeps the Temporal payload
    well under the ~2 MB limit.
    """
    slim = AgentExecutionStatus(
        phase=status.phase,
        error=status.error,
        started_at=status.started_at,
        completed_at=status.completed_at,
    )
    for pa in status.pending_approvals:
        slim.pending_approvals.append(pa)
    if status.HasField("usage"):
        slim.usage.CopyFrom(status.usage)
    return slim


class SetupTimer:
    """Lightweight timer for measuring and logging setup phase durations.

    Tracks cumulative time across all setup phases and logs each phase's
    duration.
    """

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger
        self._phases: list[tuple[str, float]] = []
        self._current_phase: str | None = None
        self._phase_start: float = 0.0
        self._overall_start: float = time.monotonic()

    def start(self, phase_name: str) -> None:
        if self._current_phase is not None:
            self.stop()
        self._current_phase = phase_name
        self._phase_start = time.monotonic()

    def stop(self) -> float:
        if self._current_phase is None:
            return 0.0
        elapsed_ms = (time.monotonic() - self._phase_start) * 1000
        self._phases.append((self._current_phase, elapsed_ms))
        self._logger.info(
            "[SETUP] %s completed in %.0fms", self._current_phase, elapsed_ms,
        )
        self._current_phase = None
        return elapsed_ms

    def log_total(self) -> None:
        total_ms = (time.monotonic() - self._overall_start) * 1000
        breakdown = ", ".join(
            f"{name}={dur:.0f}ms" for name, dur in self._phases
        )
        self._logger.info(
            "[SETUP] Total setup completed in %.0fms — phases: [%s]",
            total_ms, breakdown,
        )


def heartbeat_during_setup(phase_name: str, details: dict[str, Any] | None = None) -> None:
    """Send a heartbeat with setup-phase context between discrete setup steps.

    Ensures Temporal sees liveness signals during initialisation.
    """
    activity.heartbeat({
        "setup_phase": phase_name,
        "details": details or {},
    })


async def run_sync_with_heartbeat(
    fn: Callable[..., _T],
    *args: Any,
    heartbeat_interval_s: float = _HEARTBEAT_INTERVAL_S,
    phase_name: str,
    log: logging.Logger | None = None,
    **kwargs: Any,
) -> _T:
    """Run a synchronous callable in a thread, heartbeating periodically.

    Prevents Temporal heartbeat timeout during long-running synchronous
    operations by dispatching the work via ``asyncio.to_thread`` and
    sending heartbeats every *heartbeat_interval_s* seconds.
    """
    _log = log or _heartbeat_logger
    task = asyncio.ensure_future(
        asyncio.to_thread(functools.partial(fn, *args, **kwargs))
    )
    heartbeat_count = 0
    start = time.monotonic()

    while not task.done():
        done, _ = await asyncio.wait({task}, timeout=heartbeat_interval_s)
        if done:
            break

        heartbeat_count += 1
        elapsed_s = time.monotonic() - start
        _log.info(
            "[HEARTBEAT] %s — heartbeat #%d (%.0fs elapsed)",
            phase_name, heartbeat_count, elapsed_s,
        )
        activity.heartbeat({
            "setup_phase": phase_name,
            "heartbeat_count": heartbeat_count,
            "elapsed_s": round(elapsed_s, 1),
        })

        if activity.is_cancelled():
            _log.warning(
                "[HEARTBEAT] %s — activity cancelled by Temporal after %.0fs; "
                "abandoning wait (background thread will finish independently)",
                phase_name, elapsed_s,
            )
            raise asyncio.CancelledError(
                f"Activity cancelled during {phase_name}"
            )

    return task.result()
