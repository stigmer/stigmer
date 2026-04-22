"""Periodic heartbeat emitter for the Runner resource.

Sends a heartbeat RPC to the Stigmer backend every ``interval_seconds``
(default 30s), reporting the runner's phase, active execution count, and
host machine information.  The server uses heartbeat absence to detect
stale runners (90s timeout -> STOPPED transition).

The emitter runs as an ``asyncio.Task`` alongside the Temporal worker on
the same event loop.  It is started after Temporal connects and stopped
(with a final STOPPED heartbeat) during graceful shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import socket
from importlib.metadata import PackageNotFoundError, version

import grpc
from ai.stigmer.agentic.runner.v1.api_pb2 import RunnerConnectionInfo
from ai.stigmer.agentic.runner.v1.enum_pb2 import (
    RUNNER_PHASE_BUSY,
    RUNNER_PHASE_READY,
    RUNNER_PHASE_STOPPED,
)
from ai.stigmer.agentic.runner.v1.io_pb2 import RunnerHeartbeatInput

from grpc_client.runner_client import RunnerClient
from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker import execution_tracker

logger = logging.getLogger(__name__)


def _gather_connection_info() -> RunnerConnectionInfo:
    """Collect static host information (gathered once at init)."""
    try:
        runner_version = version("agent-runner")
    except PackageNotFoundError:
        runner_version = "dev"

    return RunnerConnectionInfo(
        hostname=socket.gethostname(),
        os=platform.system().lower(),
        arch=platform.machine(),
        runner_version=runner_version,
    )


class HeartbeatEmitter:
    """Sends periodic heartbeat RPCs to the Stigmer backend.

    Args:
        runner_id: The runner's resource ID.
        token: Auth token (JWT or API key) for gRPC calls.
        backend_endpoint: Stigmer backend gRPC address.
        max_concurrency: Maximum concurrent activities (from Temporal worker
            config).  When ``execution_tracker.get_count() >= max_concurrency``,
            the reported phase switches from READY to BUSY.
        interval_seconds: Seconds between heartbeat ticks.
    """

    def __init__(
        self,
        runner_id: str,
        token: str,
        backend_endpoint: str,
        max_concurrency: int,
        interval_seconds: int = 30,
    ) -> None:
        self._runner_id = runner_id
        self._token = token
        self._backend_endpoint = backend_endpoint
        self._max_concurrency = max_concurrency
        self._interval = interval_seconds
        self._connection_info = _gather_connection_info()
        self._task: asyncio.Task[None] | None = None
        self._channel: grpc.aio.Channel | None = None
        self._client: RunnerClient | None = None
        self._stopped = False

    async def start(self) -> None:
        """Create the gRPC channel and start the heartbeat loop task."""
        interceptor = AuthClientInterceptor(self._token)
        self._channel = create_channel(
            self._backend_endpoint, interceptors=[interceptor],
        )
        self._client = RunnerClient(
            self._token, channel=self._channel,
        )
        self._task = asyncio.create_task(
            self._loop(), name="heartbeat-emitter",
        )
        logger.info(
            "Heartbeat emitter started for runner %s (interval=%ds)",
            self._runner_id, self._interval,
        )

    async def stop(self) -> None:
        """Send a final STOPPED heartbeat, cancel the loop, close the channel."""
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

        await self._send_stopped()

        if self._channel is not None:
            await self._channel.close()
            self._channel = None
            self._client = None

        logger.info("Heartbeat emitter stopped for runner %s", self._runner_id)

    def _build_input(self, phase: int) -> RunnerHeartbeatInput:
        return RunnerHeartbeatInput(
            runner_id=self._runner_id,
            phase=phase,
            current_executions=execution_tracker.get_count(),
            connection_info=self._connection_info,
        )

    def _current_phase(self) -> int:
        if execution_tracker.get_count() >= self._max_concurrency:
            return RUNNER_PHASE_BUSY
        return RUNNER_PHASE_READY

    async def _loop(self) -> None:
        """Tick every ``_interval`` seconds, sending a heartbeat each time."""
        while True:
            await asyncio.sleep(self._interval)
            await self._tick()

    async def _tick(self) -> None:
        assert self._client is not None
        phase = self._current_phase()
        try:
            await self._client.heartbeat(self._build_input(phase))
            logger.debug(
                "Heartbeat sent: runner=%s phase=%s executions=%d",
                self._runner_id,
                "READY" if phase == RUNNER_PHASE_READY else "BUSY",
                execution_tracker.get_count(),
            )
        except grpc.RpcError as e:
            code = e.code() if hasattr(e, "code") else None
            if code == grpc.StatusCode.NOT_FOUND:
                logger.error(
                    "Runner %s not found on server — stopping heartbeat. "
                    "The runner resource may have been deleted.",
                    self._runner_id,
                )
                self._stop_loop()
            elif code == grpc.StatusCode.FAILED_PRECONDITION:
                logger.warning(
                    "Runner %s is in FAILED phase on server — heartbeat "
                    "rejected. Investigate and recreate the runner.",
                    self._runner_id,
                )
            else:
                logger.warning(
                    "Heartbeat failed for runner %s (will retry next "
                    "interval): %s",
                    self._runner_id, e,
                )

    async def _send_stopped(self) -> None:
        """Best-effort final heartbeat with STOPPED phase."""
        if self._client is None:
            return
        try:
            await self._client.heartbeat(
                self._build_input(RUNNER_PHASE_STOPPED),
            )
            logger.info(
                "Final STOPPED heartbeat sent for runner %s",
                self._runner_id,
            )
        except Exception as e:
            logger.warning(
                "Failed to send final STOPPED heartbeat for runner %s "
                "(server will timeout after 90s): %s",
                self._runner_id, e,
            )

    def _stop_loop(self) -> None:
        """Cancel the heartbeat loop task (e.g. after NOT_FOUND)."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
