"""Idle self-termination watchdog for ephemeral runners.

Monitors the execution tracker and initiates graceful process shutdown
via SIGTERM when no Temporal activities have run for a configurable
period.  The existing signal handler in ``main.py`` handles the rest:
Temporal worker drain and clean exit.  The Go supervisor (CLI daemon)
handles runner lifecycle reporting (heartbeats, STOPPED transition)
over its bidi gRPC stream.

The watchdog is opt-in: disabled when ``STIGMER_IDLE_TIMEOUT_SECONDS``
is absent or zero.  The launcher passes this env var for ephemeral
(cloud-provisioned) runners; persistent and local runners never set it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from time import monotonic

from stigmer_runner.worker import execution_tracker

logger = logging.getLogger(__name__)


class IdleWatchdog:
    """Shuts down the process after a sustained idle period.

    Args:
        timeout_seconds: Seconds of zero activity before shutdown.
        check_interval_seconds: Polling interval for the idle check.
    """

    def __init__(
        self,
        timeout_seconds: int,
        check_interval_seconds: int = 30,
    ) -> None:
        self._timeout = timeout_seconds
        self._interval = check_interval_seconds
        self._task: asyncio.Task[None] | None = None
        self._stopped = False

    async def start(self) -> None:
        """Start the idle watchdog loop."""
        self._task = asyncio.create_task(
            self._loop(), name="idle-watchdog",
        )
        logger.info(
            "Idle watchdog started (timeout=%ds, check_interval=%ds)",
            self._timeout, self._interval,
        )

    async def stop(self) -> None:
        """Cancel the watchdog loop (idempotent)."""
        if self._stopped:
            return
        self._stopped = True

        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        logger.debug("Idle watchdog stopped")

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            self._check()

    def _check(self) -> None:
        if execution_tracker.get_count() > 0:
            return

        idle_seconds = monotonic() - execution_tracker.last_activity_at()
        if idle_seconds < self._timeout:
            return

        self._fire(idle_seconds)

    def _fire(self, idle_seconds: float) -> None:
        logger.info(
            "Runner idle for %.0fs (threshold %ds) — initiating "
            "graceful shutdown via SIGTERM",
            idle_seconds, self._timeout,
        )
        os.kill(os.getpid(), signal.SIGTERM)
