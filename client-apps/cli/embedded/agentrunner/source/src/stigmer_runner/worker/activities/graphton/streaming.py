"""Streaming execution loop for Graphton agent.

Encapsulates the LangGraph event stream, background heartbeats,
stall detection, progressive gRPC updates, and terminal-state
handling (pause, stall, recursion limit).

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionControlSignal,
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage

from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp
from stigmer_runner.worker.streaming import StreamingConfig, StreamingUpdateScheduler

if TYPE_CHECKING:
    from graphton.core.graceful_stop import GracefulStopMiddleware
    from stigmer_runner.grpc_client.agent_execution_client import AgentExecutionClient

_FILE_MODIFYING_TOOLS = frozenset({
    "write", "write_file", "edit", "edit_file", "delete", "delete_file",
})


@dataclasses.dataclass(frozen=True)
class StreamResult:
    """Result of :meth:`StreamExecutor.execute`.

    When ``terminal_status`` is not ``None`` the stream ended with a
    terminal condition (pause, stall, recursion limit) and the caller
    should return it directly.  Otherwise the caller proceeds to
    post-stream processing.
    """

    events_processed: int
    terminal_status: AgentExecutionStatus | None = None


class StreamExecutor:
    """Runs the LangGraph event stream with heartbeats, stall guard, and
    progressive status updates.

    All Temporal-specific side-effects (heartbeat, cancellation check)
    are injected as callables so the class is testable without a running
    Temporal worker.
    """

    def __init__(
        self,
        *,
        agent_graph: Any,
        config: dict[str, Any],
        execution_id: str,
        thread_id: str,
        status_builder: StatusBuilder,
        execution_client: AgentExecutionClient,
        streaming_config: StreamingConfig,
        stall_timeout_seconds: int,
        grpc_update_timeout_seconds: int,
        effective_recursion_limit: int,
        heartbeat_fn: Callable[[dict[str, Any]], None],
        is_cancelled_fn: Callable[[], bool],
        slim_status_fn: Callable[[AgentExecutionStatus], AgentExecutionStatus],
        logger: logging.Logger,
        graceful_stop: GracefulStopMiddleware | None = None,
        on_file_written: Callable[[str], Any] | None = None,
        on_git_file_modified: Callable[[str], Any] | None = None,
    ) -> None:
        self._graph = agent_graph
        self._config = config
        self._execution_id = execution_id
        self._thread_id = thread_id
        self._sb = status_builder
        self._exec_client = execution_client
        self._streaming_cfg = streaming_config
        self._stall_timeout = stall_timeout_seconds
        self._grpc_timeout = grpc_update_timeout_seconds
        self._recursion_limit = effective_recursion_limit
        self._heartbeat = heartbeat_fn
        self._is_cancelled = is_cancelled_fn
        self._slim_status = slim_status_fn
        self._log = logger
        self._graceful_stop = graceful_stop
        self._on_file_written = on_file_written
        self._on_git_file_modified = on_git_file_modified
        self._pending_publishes: set[asyncio.Task[None]] = set()
        self._pending_git_tasks: set[asyncio.Task[None]] = set()

    @property
    def pending_publish_tasks(self) -> set[asyncio.Task[None]]:
        """Background publish tasks that have not yet completed.

        Callers (typically post-stream processing) should ``await`` these
        before running the safety-net auto-publish so that any in-flight
        uploads have a chance to finish.
        """
        self._pending_publishes.discard(None)  # type: ignore[arg-type]
        self._pending_publishes = {t for t in self._pending_publishes if not t.done()}
        return set(self._pending_publishes)

    @property
    def pending_git_tasks(self) -> set[asyncio.Task[None]]:
        """Background git write-back tasks that have not yet completed."""
        self._pending_git_tasks = {t for t in self._pending_git_tasks if not t.done()}
        return set(self._pending_git_tasks)

    def _on_file_modifying_tool_end(
        self, event: dict[str, Any],
    ) -> asyncio.Task[None] | None:
        """Handle ``on_tool_end`` for file-modifying tools.

        Returns the artifact-publish task so the caller can ``await`` it
        before flushing the next status update (ensuring the artifact is
        available when the UI receives the tool-completion event).

        Git write-back remains fire-and-forget — it does not affect
        artifact content visible in the preview.
        """
        if event.get("event") != "on_tool_end":
            return None
        tool_name = event.get("name", "")
        if tool_name not in _FILE_MODIFYING_TOOLS:
            return None

        run_id = event.get("run_id", "")
        resolved_id = self._sb.resolve_run_id(run_id)
        path = ""
        tc = self._sb.get_tool_call(resolved_id)
        if tc is not None:
            path = str(dict(tc.args).get("path", "")) if tc.args else ""

        if not path:
            self._log.debug(
                "[INLINE_PUBLISH] execution=%s — no path found for "
                "tool_end run_id=%s tool=%s, skipping",
                self._execution_id, run_id, tool_name,
            )
            return None

        publish_task: asyncio.Task[None] | None = None
        if self._on_file_written is not None:
            publish_task = asyncio.create_task(
                self._on_file_written(path),
                name=f"inline-publish-{self._execution_id}-{path}",
            )
            self._pending_publishes.add(publish_task)
            publish_task.add_done_callback(self._pending_publishes.discard)

        if self._on_git_file_modified is not None:
            task = asyncio.create_task(
                self._on_git_file_modified(path),
                name=f"git-writeback-{self._execution_id}-{path}",
            )
            self._pending_git_tasks.add(task)
            task.add_done_callback(self._pending_git_tasks.discard)

        return publish_task

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    async def execute(
        self,
        graph_input: Any,
        *,
        is_resume: bool,
    ) -> StreamResult:
        """Run the streaming loop and return the result."""
        events_processed = 0
        last_hb_time = time.monotonic()
        hb_interval_ms = 2000
        scheduler = StreamingUpdateScheduler(self._streaming_cfg)

        if is_resume:
            await self._pre_stream_update()

        self._log.info(
            "[STALL_GUARD] Stall detection timeout: %ds (resets on every event), "
            "gRPC update timeout: %ds",
            self._stall_timeout, self._grpc_timeout,
        )

        hb_task: asyncio.Task[None] | None = None
        wd_task: asyncio.Task[None] | None = None
        try:
            hb_task = asyncio.create_task(
                self._background_heartbeat(lambda: events_processed)
            )
            wd_task = asyncio.create_task(self._event_loop_watchdog())

            async with asyncio.timeout(self._stall_timeout) as stall_deadline:
                async for event in self._graph.astream_events(
                    graph_input,
                    config=self._config,
                    version="v2",
                ):
                    stall_deadline.reschedule(
                        asyncio.get_event_loop().time() + self._stall_timeout
                    )

                    if self._is_cancelled():
                        self._log.info(
                            "PAUSE: Activity cancelled for execution %s, "
                            "saving checkpoint (thread_id=%s)",
                            self._execution_id, self._thread_id,
                        )
                        raise asyncio.CancelledError("Paused by user")

                    await self._sb.process_event(event)
                    publish_task = self._on_file_modifying_tool_end(event)
                    if publish_task is not None:
                        await self._await_publish(publish_task)
                    events_processed += 1

                    now = time.monotonic()
                    if (now - last_hb_time) * 1000 >= hb_interval_ms:
                        self._send_heartbeat(events_processed)
                        last_hb_time = now

                    events_processed, last_hb_time = await self._maybe_send_update(
                        events_processed, scheduler, last_hb_time,
                    )

        except asyncio.CancelledError:
            return self._handle_pause(events_processed)
        except TimeoutError:
            return self._handle_stall(events_processed)
        except Exception as stream_err:
            if type(stream_err).__name__ == "GraphRecursionError":
                return self._handle_recursion_limit(events_processed, stream_err)
            self._sb.finalize_active_sub_agents(
                SubAgentStatus.SUB_AGENT_FAILED,
                f"Parent execution error: {type(stream_err).__name__}",
            )
            raise
        finally:
            if wd_task is not None:
                wd_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await wd_task
            if hb_task is not None:
                hb_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await hb_task

        if events_processed == 0:
            raise RuntimeError(
                "Graphton stream completed without processing any events. "
                "This may indicate a configuration error."
            )

        self._log.info(
            "Execution %s stream finished — processed %d events",
            self._execution_id, events_processed,
        )
        return StreamResult(events_processed=events_processed)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    _INLINE_PUBLISH_TIMEOUT = 15.0

    async def _await_publish(self, task: asyncio.Task[None]) -> None:
        """Wait for an inline-publish task to complete before the next
        status flush, so the artifact is present when the UI receives the
        tool-completion event.

        On timeout or failure the task stays in ``_pending_publishes``
        and the post-stream safety net will handle it.  The streaming
        loop is never blocked indefinitely.
        """
        try:
            await asyncio.wait_for(
                asyncio.shield(task), timeout=self._INLINE_PUBLISH_TIMEOUT,
            )
        except TimeoutError:
            self._log.warning(
                "[INLINE_PUBLISH] execution=%s — publish did not complete "
                "within %.0fs, deferring to post-stream safety net",
                self._execution_id, self._INLINE_PUBLISH_TIMEOUT,
            )
        except Exception as exc:
            self._log.warning(
                "[INLINE_PUBLISH] execution=%s — publish failed "
                "(non-fatal, post-stream safety net will retry): %s",
                self._execution_id, exc,
            )

    async def _pre_stream_update(self) -> None:
        """Send an immediate IN_PROGRESS status update before streaming.

        On resume, the pending_approvals list contains entries at
        RESUME_RECONCILED state. The server-side merge logic will prune
        them, so no sentinel purge is needed here.
        """
        try:
            self._log.info("[RESUME] Sending pre-stream IN_PROGRESS status update")
            await asyncio.wait_for(
                self._exec_client.update_status(
                    execution_id=self._execution_id,
                    status=self._sb.current_status,
                ),
                timeout=self._grpc_timeout,
            )
            self._log.info("[RESUME] Pre-stream status update sent successfully")
        except Exception as err:
            self._log.warning("[RESUME] Pre-stream status update failed: %s", err)

    async def _background_heartbeat(
        self,
        events_counter: Callable[[], int],
    ) -> None:
        interval = 10.0
        seq = 0
        while True:
            await asyncio.sleep(interval)
            seq += 1
            try:
                self._heartbeat({
                    "thread_id": self._thread_id,
                    "paused": self._is_cancelled(),
                    "events_processed": events_counter(),
                    "messages": len(self._sb.current_status.messages),
                    "tool_calls": self._sb.tool_call_count(),
                    "phase": self._sb.current_status.phase,
                    "source": "background",
                })
                self._log.info(
                    "[HEARTBEAT] execution=%s seq=%d events=%d source=background",
                    self._execution_id, seq, events_counter(),
                )
            except BaseException as hb_err:
                self._log.info(
                    "[HEARTBEAT] execution=%s seq=%d failed: %s: %s",
                    self._execution_id, seq, type(hb_err).__name__, hb_err,
                )
                if isinstance(hb_err, (asyncio.CancelledError, KeyboardInterrupt)):
                    raise

    _WATCHDOG_POLL_S = 0.1
    _WATCHDOG_THRESHOLD_MS = 500

    async def _event_loop_watchdog(self) -> None:
        """Detect event loop blockage during streaming.

        Runs ``asyncio.sleep`` in a tight loop and measures how long
        the sleep actually took.  If the event loop was blocked by a
        synchronous call the measured duration will far exceed the
        requested sleep — a clear signal of trouble.
        """
        while True:
            t0 = asyncio.get_event_loop().time()
            await asyncio.sleep(self._WATCHDOG_POLL_S)
            elapsed_ms = (asyncio.get_event_loop().time() - t0) * 1000

            if elapsed_ms > self._WATCHDOG_THRESHOLD_MS:
                self._log.warning(
                    "[WATCHDOG] execution=%s event loop blocked for %.0fms "
                    "(threshold=%dms)",
                    self._execution_id, elapsed_ms, self._WATCHDOG_THRESHOLD_MS,
                )

    def _send_heartbeat(self, events_processed: int) -> None:
        try:
            self._heartbeat({
                "thread_id": self._thread_id,
                "paused": self._is_cancelled(),
                "events_processed": events_processed,
                "messages": len(self._sb.current_status.messages),
                "tool_calls": self._sb.tool_call_count(),
                "phase": self._sb.current_status.phase,
            })
        except Exception as e:
            self._log.debug("Heartbeat failed (event %d): %s", events_processed, e)

    async def _maybe_send_update(
        self,
        events_processed: int,
        scheduler: StreamingUpdateScheduler,
        last_hb_time: float,
    ) -> tuple[int, float]:
        force = self._sb.force_next_update
        if force:
            self._sb.force_next_update = False

        # Check if any deferred sub-agent completion has drained.  This
        # sets force_next_update (captured in the next iteration) only
        # after the drain window elapses, giving late LangGraph events
        # time to be batched into the same gRPC update.
        completion_drained = self._sb.should_flush_completions(
            time.monotonic(),
        )
        if completion_drained and not force:
            force = self._sb.force_next_update
            if force:
                self._sb.force_next_update = False

        if not (force or scheduler.should_send_update(events_processed)):
            return events_processed, last_hb_time

        reason = (
            "force_tool_update"
            if force
            else scheduler.get_update_reason_str()
        )
        time_since = scheduler.get_time_since_last_update_ms()
        events_since = scheduler.get_events_since_last_update(events_processed)

        try:
            self._log.info(
                "[STREAM] execution=%s update_sent=true reason=%s "
                "events_total=%d events_since_last=%d "
                "time_since_last_ms=%.0f messages=%d tool_calls=%d",
                self._execution_id, reason, events_processed,
                events_since, time_since,
                len(self._sb.current_status.messages),
                self._sb.tool_call_count(),
            )
            response = await asyncio.wait_for(
                self._exec_client.update_status(
                    execution_id=self._execution_id,
                    status=self._sb.current_status,
                ),
                timeout=self._grpc_timeout,
            )
            scheduler.mark_update_sent(events_processed)
            self._handle_control_signal(response)
        except TimeoutError:
            self._log.warning(
                "[STREAM] execution=%s update_sent=false reason=grpc_timeout "
                "timeout_seconds=%d",
                self._execution_id, self._grpc_timeout,
            )
            scheduler.mark_update_sent(events_processed)
        except Exception as e:
            self._log.warning(
                "[STREAM] execution=%s update_sent=false reason=%s error=%s",
                self._execution_id, reason, e,
            )
            scheduler.mark_update_sent(events_processed)

        if events_processed % 50 == 0:
            self._log.debug("Processed %d events", events_processed)

        return events_processed, last_hb_time

    # ------------------------------------------------------------------
    # Platform signal handling
    # ------------------------------------------------------------------

    def _handle_control_signal(self, response: Any) -> None:
        """Act on the ExecutionControlSignal returned by updateStatus."""
        signal = getattr(response, "signal", 0)
        if signal == ExecutionControlSignal.EXECUTION_CONTROL_SIGNAL_STOP:
            reason = getattr(response, "signal_reason", "")
            self._log.warning(
                "[PLATFORM_STOP] execution=%s signal=STOP reason=%s",
                self._execution_id, reason or "unspecified",
            )
            if self._graceful_stop is not None and not self._graceful_stop.activated:
                self._graceful_stop.activate(reason)
        elif signal == ExecutionControlSignal.EXECUTION_CONTROL_SIGNAL_WARNING:
            reason = getattr(response, "signal_reason", "")
            self._log.warning(
                "[PLATFORM_WARNING] execution=%s reason=%s",
                self._execution_id, reason or "unspecified",
            )

    # ------------------------------------------------------------------
    # Terminal-state handlers
    # ------------------------------------------------------------------

    def _finalize_and_persist(
        self, phase: int, error: str, message_content: str,
    ) -> AgentExecutionStatus:
        self._sb.finalize_context_info()
        msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=message_content,
            timestamp=_utc_timestamp(),
        )
        self._sb.current_status.messages.append(msg)
        self._sb.current_status.phase = phase
        if error:
            self._sb.current_status.error = error
        if not self._sb.current_status.completed_at:
            self._sb.current_status.completed_at = _utc_timestamp()
        return self._slim_status(self._sb.current_status)

    async def _persist_terminal_status(self, label: str) -> None:
        try:
            self._log.info("[%s] Sending %s status update", label, label)
            await self._exec_client.update_status(
                execution_id=self._execution_id,
                status=self._sb.current_status,
            )
            self._log.info("[%s] Status update sent successfully", label)
        except Exception as err:
            self._log.warning("[%s] Failed to send status update: %s", label, err)

    def _handle_pause(self, events_processed: int) -> StreamResult:
        self._log.info(
            "Graceful pause for execution %s — checkpoint saved "
            "(thread_id=%s, events_processed=%d)",
            self._execution_id, self._thread_id, events_processed,
        )
        slim = self._finalize_and_persist(
            phase=ExecutionPhase.EXECUTION_PAUSED,
            error="",
            message_content=(
                "Execution paused by user. Use resume to continue "
                "from this checkpoint."
            ),
        )
        # No persistence here — the caller (execute_graphton.py) handles
        # terminal status persistence via retry_executor for all terminal
        # paths uniformly (pause, stall, recursion limit).
        return StreamResult(events_processed=events_processed, terminal_status=slim)

    def _handle_stall(self, events_processed: int) -> StreamResult:
        stall_msg = (
            f"Agent stream stalled: no events received for "
            f"{self._stall_timeout}s after processing {events_processed} events. "
            f"The LLM or a tool may be hanging."
        )
        self._log.error("[STALL] execution=%s — %s", self._execution_id, stall_msg)

        self._sb.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_CANCELLED,
            "Parent execution stalled — no events received",
        )

        slim = self._finalize_and_persist(
            phase=ExecutionPhase.EXECUTION_TERMINATED,
            error=stall_msg,
            message_content=(
                f"Execution timed out: the agent produced no output for "
                f"{self._stall_timeout} seconds. This typically means the LLM "
                f"or a tool stopped responding. The execution has been stopped."
            ),
        )
        return StreamResult(events_processed=events_processed, terminal_status=slim)

    def _handle_recursion_limit(
        self, events_processed: int, err: Exception,
    ) -> StreamResult:
        limit_msg = (
            f"Agent reached the tool-call limit after processing "
            f"{events_processed} events. Send another message to continue."
        )
        self._log.warning(
            "[RECURSION_LIMIT] execution=%s events=%d "
            "invoke_config_limit=%d original_error=%s",
            self._execution_id, events_processed,
            self._recursion_limit, err,
        )

        self._sb.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_CANCELLED,
            "Parent execution reached tool-call limit",
        )

        slim = self._finalize_and_persist(
            phase=ExecutionPhase.EXECUTION_TERMINATED,
            error=limit_msg,
            message_content=(
                "The agent reached the tool-call limit for this message. "
                "Work completed so far has been saved. "
                "Send another message to continue where the agent left off."
            ),
        )
        return StreamResult(events_processed=events_processed, terminal_status=slim)
