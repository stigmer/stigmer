"""Sending a message and waiting for the agent's answer, in one call.

A turn is a run: :meth:`StigmerClient.send_and_wait` creates it
(``runs.create``, as every turn starts) and follows the session's event log
(``streamEvents``) until the turn ends or waits for a person's answer, then
returns how it stands. :meth:`StigmerClient.wait_for_turn` resumes that wait
after the person answered. They are the Python form of the TypeScript
client's ``sendAndWait`` and ``waitForTurn``
(sdk/typescript/src/session-events.ts), with the same rules and outcome.
``send_and_wait`` takes keyword arguments rather than the generated
``RunInput``, whose ``name`` has no default; a caller who needs another run
field creates the run with ``client.runs.create`` and calls
``wait_for_turn``, the layering TypeScript has too.

The reading is split from the driving. :class:`_TurnReader` is pure: it
takes stream frames one at a time and folds only what an answer needs, the
three rules of the shared fold (backend/libs/ts/session-log/src/fold.ts),
which is the reference:

- a turn has ended when its newest ``stigmer.run.status`` phase is
  completed, failed, cancelled or terminated;
- it waits when the session is idle with stop reason ``requires_action``
  naming one of its tool uses that asks for permission and has neither a
  confirmation nor a result;
- its answer is the text of its last stored message on its primary thread,
  the text blocks joined with nothing between them.

It reads stored events only (a preview is never the answer) and each event
once, by id. The cases in test/fixtures/turns, which the TypeScript, Go and
Java clients read too, hold it to the fold.

The driver opens the stream from the place it was given, reconnects from the
last place delivered with a backoff from 0.5 s up to 5 s, and raises the
error on a code a reconnect cannot fix (not found, permission denied,
unauthenticated, invalid argument, failed precondition). It cancels its call
the moment the reader decides, and on an error or the timeout, so a returned
wait leaves nothing open on the server. The timeout bounds the whole wait,
reconnections included: each stream gets the time that remains, which is
why the driver builds its own query stub from the channel rather than the
generated ``stream_events``, which takes no deadline.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterable

import grpc

from ai.stigmer.agentic.session.v1 import event_pb2, io_pb2, query_pb2_grpc

from ._gen._errors import ErrorCode, StigmerError, wrap_error
from ._gen._run import RunClient, RunConfigInput, RunInput, SessionSpecInput
from ._gen._session import SessionClient

TURN_PHASE_WAITING = "waiting"
"""The phase of a turn that waits for a person's answer to its asks."""

_ENDED_PHASES = frozenset({"completed", "failed", "cancelled", "terminated"})

_FINAL_CODES = frozenset(
    {
        grpc.StatusCode.NOT_FOUND,
        grpc.StatusCode.PERMISSION_DENIED,
        grpc.StatusCode.UNAUTHENTICATED,
        grpc.StatusCode.INVALID_ARGUMENT,
        grpc.StatusCode.FAILED_PRECONDITION,
    }
)

# The reconnect backoff in seconds: the first wait, doubled per failure up
# to the longest. Module values so a test can shorten them.
_BACKOFF_BASE = 0.5
_BACKOFF_MAX = 5.0


@dataclass(frozen=True)
class TurnAsk:
    """A tool use that waits for a person's answer.

    Answer it with the session's ``confirm_tool_use`` or
    ``grant_permission``, which take its ``id``.
    """

    id: str
    """The tool use's event id."""

    name: str
    """The tool's name."""


@dataclass(frozen=True)
class TurnOutcome:
    """How a waited-for turn stands when the wait returns."""

    run_id: str
    """The run that is the turn."""

    session_id: str
    """The session the turn runs in."""

    phase: str
    """completed, failed, cancelled or terminated once the turn ended, or
    ``"waiting"`` when it waits for an answer to its :attr:`asks`."""

    answer: str
    """The text of the turn's last message on its primary thread; "" when it
    wrote none."""

    stop_cause: str
    """Why the turn ended, once it has; "" otherwise."""

    error: str
    """What went wrong, when the turn failed or was stopped with a reason."""

    asks: tuple[TurnAsk, ...]
    """The tool uses that wait for an answer, when :attr:`phase` is
    ``"waiting"``; empty once the turn ended."""

    last_seq: int
    """The log's place when the wait returned: pass it to ``wait_for_turn``
    to resume after answering the asks."""


class _TurnReader:
    """Folds one turn's facts from stream frames (module docstring)."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self._seen: set[str] = set()
        self.last_seq = 0
        self._status: event_pb2.StigmerRunStatusEvent | None = None
        self._answer = ""
        self._tool_uses: list[tuple[str, str, bool]] = []
        self._answered: set[str] = set()
        self._idle = False
        self._stop_reason = ""
        self._waiting_on: tuple[str, ...] = ()

    def read(self, frame: io_pb2.StreamSessionEventsResponse) -> bool:
        """Folds one frame; returns whether the turn has ended or waits."""
        if frame.WhichOneof("frame") != "event":
            # A preview: never the answer, never an end.
            return False
        event = frame.event
        self.last_seq = max(self.last_seq, event.seq)
        kind = event.WhichOneof("event")
        if kind is None:
            return False
        if kind == "user_message" and event.run_id == "":
            # A message waiting in the session's queue: its run's copy comes
            # later under the same id, so it is not marked as read.
            return False
        body = getattr(event, kind)
        event_id = getattr(body, "id", "")
        if event_id:
            if event_id in self._seen:
                return False
            self._seen.add(event_id)
        ours = event.run_id == self.run_id
        if kind == "session_status_running":
            self._idle, self._stop_reason, self._waiting_on = False, "", ()
        elif kind == "session_status_idle":
            self._idle = True
            self._stop_reason = body.stop_reason.type
            self._waiting_on = tuple(body.stop_reason.event_ids)
        elif kind == "agent_message":
            if ours and event.thread_id == "":
                self._answer = _text_of(body.content)
        elif kind == "stigmer_run_status":
            if ours:
                self._status = body
        elif kind in ("agent_tool_use", "agent_mcp_tool_use"):
            if ours:
                self._tool_uses.append((body.id, body.name, body.evaluated_permission == "ask"))
        elif kind in ("user_tool_confirmation", "agent_tool_result"):
            self._answered.add(body.tool_use_id)
        elif kind == "agent_mcp_tool_result":
            self._answered.add(body.mcp_tool_use_id)
        return self._ended() or self._waiting()

    def _ended(self) -> bool:
        return self._status is not None and self._status.phase in _ENDED_PHASES

    def _open_asks(self) -> tuple[TurnAsk, ...]:
        return tuple(
            TurnAsk(id=use_id, name=name)
            for use_id, name, asks in self._tool_uses
            if asks and use_id not in self._answered
        )

    def _waiting(self) -> bool:
        if not self._idle or self._stop_reason != "requires_action":
            return False
        return any(ask.id in self._waiting_on for ask in self._open_asks())

    def outcome(self, session_id: str) -> TurnOutcome:
        """How the turn stands now."""
        status = self._status
        ended = self._ended()
        waiting = not ended and self._waiting()
        phase = TURN_PHASE_WAITING if waiting else (status.phase if status is not None else "")
        return TurnOutcome(
            run_id=self.run_id,
            session_id=session_id,
            phase=phase,
            answer=self._answer,
            stop_cause=status.stop_cause if status is not None else "",
            error=status.error if status is not None else "",
            asks=self._open_asks() if waiting else (),
            last_seq=self.last_seq,
        )


def _text_of(content: Iterable[object]) -> str:
    """A content list's text blocks, joined with nothing between them."""
    return "".join(block.text for block in content if block.type == "text")  # type: ignore[attr-defined]


def _invalid(message: str) -> StigmerError:
    return StigmerError(ErrorCode.INVALID_ARGUMENT, message, grpc.StatusCode.INVALID_ARGUMENT)


def send_and_wait(
    channel: grpc.Channel,
    runs: RunClient,
    sessions: SessionClient,
    *,
    org: str,
    message: str,
    session_id: str,
    session_spec: SessionSpecInput | None,
    name: str,
    run_config: RunConfigInput | None,
    file_ids: Iterable[str],
    timeout: float | None,
) -> TurnOutcome:
    """The body of :meth:`StigmerClient.send_and_wait`."""
    if not org:
        raise _invalid("send_and_wait: org is required — the organization the turn runs in, by id or slug")
    if (session_id == "") == (session_spec is None):
        raise _invalid(
            "send_and_wait: exactly one of session_id or session_spec is required"
            " — the session the turn continues, or the one to start"
        )
    deadline = None if timeout is None else time.monotonic() + timeout
    after_seq = 0
    if session_id:
        page = sessions.list_events(io_pb2.ListSessionEventsRequest(session_id=session_id, order="desc", page_size=1))
        after_seq = page.events[0].seq if page.events else 0
    run = runs.create(
        RunInput(
            name=name or f"run-{int(time.time() * 1000)}",
            org=org,
            session_id=session_id,
            session_spec=session_spec,
            message=message,
            run_config=run_config,
            file_ids=list(file_ids),
        )
    )
    created_session = run.spec.session_id if run.spec.WhichOneof("target") == "session_id" else ""
    target = created_session or session_id
    if not target:
        raise StigmerError(ErrorCode.INTERNAL, "the created run names no session", grpc.StatusCode.INTERNAL)
    return wait_for_turn(channel, target, run.metadata.id, after_seq, deadline=deadline)


def wait_for_turn(
    channel: grpc.Channel,
    session_id: str,
    run_id: str,
    after_seq: int,
    *,
    deadline: float | None,
) -> TurnOutcome:
    """The body of :meth:`StigmerClient.wait_for_turn`; ``deadline`` is on the monotonic clock."""
    stub = query_pb2_grpc.SessionQueryControllerStub(channel)
    reader = _TurnReader(run_id)
    place = after_seq
    failures = 0
    while True:
        remaining = None if deadline is None else deadline - time.monotonic()
        if remaining is not None and remaining <= 0:
            raise _timed_out()
        call = stub.streamEvents(
            io_pb2.StreamSessionEventsRequest(session_id=session_id, after_seq=place),
            timeout=remaining,
        )
        try:
            for frame in call:
                failures = 0
                if frame.WhichOneof("frame") == "event" and frame.event.seq > place:
                    place = frame.event.seq
                if reader.read(frame):
                    return reader.outcome(session_id)
        except grpc.RpcError as err:
            code = err.code()  # type: ignore[attr-defined]
            if code == grpc.StatusCode.DEADLINE_EXCEEDED:
                raise _timed_out() from err
            if code in _FINAL_CODES:
                raise wrap_error(err) from err
        finally:
            call.cancel()
        pause = min(_BACKOFF_MAX, _BACKOFF_BASE * 2**failures)
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= pause:
                if remaining > 0:
                    time.sleep(remaining)
                raise _timed_out()
        time.sleep(pause)
        failures += 1


def _timed_out() -> TimeoutError:
    return TimeoutError("stigmer: the wait for the turn did not end within its timeout")
