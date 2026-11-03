"""Pins send_and_wait and wait_for_turn (stigmer/_turns.py).

The reader is held to the shared turn cases in test/fixtures/turns, which the
TypeScript client reads through the fold itself: a rule that drifts here
fails naming the case. The driver runs against a gRPC server served on a free
local port, the only way to see that it cancels its call: it checks the org
and the session before any call, names the run ``run-<epoch ms>``, reads from
the newest place of an existing session, reconnects from the last place
delivered after a drop, ends on a code a reconnect cannot fix, cancels its
stream once the turn is decided, and stops at its timeout across
reconnections.
"""

from __future__ import annotations

import json
import re
import threading
import time
from concurrent import futures
from pathlib import Path

import grpc
import pytest
from google.protobuf import json_format

from ai.stigmer.agentic.run.v1 import api_pb2 as run_api_pb2
from ai.stigmer.agentic.run.v1 import command_pb2_grpc as run_command_pb2_grpc
from ai.stigmer.agentic.session.v1 import event_content_pb2, event_pb2, io_pb2, query_pb2_grpc

import stigmer._turns as turns
from stigmer import ResourceRef, SessionSpecInput, StigmerClient, StigmerError
from stigmer._turns import TurnAsk, _TurnReader

_TURNS = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "turns"
_CASES = sorted(_TURNS.glob("*.json"))


def test_the_shared_cases_are_there() -> None:
    assert len(_CASES) >= 10, _TURNS


@pytest.mark.parametrize("path", _CASES, ids=[p.name for p in _CASES])
def test_reader_holds_the_shared_turn_case(path: Path) -> None:
    case = json.loads(path.read_text())
    reader = _TurnReader(case["runId"])
    decided = False
    for frame in case["frames"]:
        if reader.read(json_format.ParseDict(frame, io_pb2.StreamSessionEventsResponse())):
            decided = True
            break
    expect = case["expect"]
    assert decided == expect["decided"], case["description"]
    if not decided:
        return
    outcome = reader.outcome("ses_1")
    assert {
        "phase": outcome.phase,
        "answer": outcome.answer,
        "stopCause": outcome.stop_cause,
        "error": outcome.error,
        "asks": [{"id": a.id, "name": a.name} for a in outcome.asks],
        "lastSeq": str(outcome.last_seq),
    } == {k: expect[k] for k in ("phase", "answer", "stopCause", "error", "asks", "lastSeq")}, case["description"]
    assert outcome.run_id == case["runId"]


# ── The driver, against a served fake ─────────────────────────────────────


def _event(seq: int, run_id: str, **content) -> io_pb2.StreamSessionEventsResponse:
    return io_pb2.StreamSessionEventsResponse(
        event=event_pb2.SessionEvent(seq=seq, session_id="ses_1", run_id=run_id, **content)
    )


def _message(seq: int, event_id: str, text: str) -> io_pb2.StreamSessionEventsResponse:
    return _event(
        seq,
        "run_1",
        agent_message=event_pb2.AgentMessageEvent(id=event_id, content=[event_content_pb2.ContentBlock(type="text", text=text)]),
    )


def _status(seq: int, event_id: str, phase: str) -> io_pb2.StreamSessionEventsResponse:
    return _event(seq, "run_1", stigmer_run_status=event_pb2.StigmerRunStatusEvent(id=event_id, phase=phase))


class _Step:
    """One stream: frames, then an error code, or a hold until the client cancels."""

    def __init__(self, frames=(), code: grpc.StatusCode | None = None, hold: bool = False) -> None:
        self.frames = list(frames)
        self.code = code
        self.hold = hold


class _Fake(query_pb2_grpc.SessionQueryControllerServicer, run_command_pb2_grpc.RunCommandControllerServicer):
    def __init__(self, steps: list[_Step], newest: int = 0) -> None:
        self.steps = steps
        self.newest = newest
        self.requests: list[io_pb2.StreamSessionEventsRequest] = []
        self.lists = 0
        self.created: list[run_api_pb2.Run] = []
        self.cancelled = threading.Event()

    def listEvents(self, request, context):  # noqa: N802 - proto rpc name
        self.lists += 1
        if self.newest == 0:
            return io_pb2.SessionEventList()
        return io_pb2.SessionEventList(events=[event_pb2.SessionEvent(seq=self.newest)])

    def streamEvents(self, request, context):  # noqa: N802 - proto rpc name
        self.requests.append(request)
        step = self.steps.pop(0) if self.steps else _Step(hold=True)
        yield from step.frames
        if step.code is not None:
            context.abort(step.code, "scripted")
        if step.hold:
            closed = threading.Event()
            context.add_callback(closed.set)
            closed.wait(10)
            if not context.is_active():
                self.cancelled.set()

    def create(self, request, context):  # noqa: N802 - proto rpc name
        self.created.append(request)
        run = run_api_pb2.Run()
        run.metadata.id = "run_1"
        run.spec.session_id = request.spec.session_id or "ses_new"
        return run


# Every driver call waits with a timeout, so a broken rule that leaves the
# wait open fails in seconds instead of hanging the suite.


@pytest.fixture()
def serve(monkeypatch):
    monkeypatch.setattr(turns, "_BACKOFF_BASE", 0.01)
    monkeypatch.setattr(turns, "_BACKOFF_MAX", 0.05)
    servers = []

    def start(fake: _Fake) -> StigmerClient:
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
        query_pb2_grpc.add_SessionQueryControllerServicer_to_server(fake, server)
        run_command_pb2_grpc.add_RunCommandControllerServicer_to_server(fake, server)
        port = server.add_insecure_port("localhost:0")
        server.start()
        servers.append(server)
        return StigmerClient(base_url=f"localhost:{port}", insecure=True)

    yield start
    for server in servers:
        server.stop(grace=None)


def test_send_and_wait_checks_its_input_before_any_call(serve) -> None:
    fake = _Fake([])
    client = serve(fake)
    spec = SessionSpecInput(agent_ref=ResourceRef(org="acme", slug="greeter"))
    for kwargs in (
        {"org": "", "message": "hi", "session_id": "ses_1"},
        {"org": "acme", "message": "hi"},
        {"org": "acme", "message": "hi", "session_id": "ses_1", "session_spec": spec},
    ):
        with pytest.raises(StigmerError) as raised:
            client.send_and_wait(**kwargs)
        assert raised.value.code.value == "invalid-argument"
    assert (fake.lists, fake.created, fake.requests) == (0, [], [])


def test_reconnects_from_the_last_place_and_cancels_its_stream_once_decided(serve) -> None:
    fake = _Fake(
        [
            _Step([_message(8, "m8", "Working.")], code=grpc.StatusCode.UNAVAILABLE),
            _Step([_message(9, "m9", "Hello."), _status(10, "st10", "completed")], hold=True),
        ],
        newest=7,
    )
    client = serve(fake)
    outcome = client.send_and_wait(org="acme", message="hi", session_id="ses_1", timeout=10)
    assert (outcome.phase, outcome.answer, outcome.run_id, outcome.session_id, outcome.last_seq) == (
        "completed",
        "Hello.",
        "run_1",
        "ses_1",
        10,
    )
    assert fake.cancelled.wait(5), "the stream was left open after the wait returned"
    assert [r.after_seq for r in fake.requests] == [7, 8]
    assert re.fullmatch(r"run-\d+", fake.created[0].metadata.name)
    assert fake.created[0].metadata.org == "acme"


def test_a_new_session_reads_the_whole_log_and_keeps_a_given_name(serve) -> None:
    fake = _Fake([_Step([_message(1, "m1", "Hi."), _status(2, "st2", "completed")], hold=True)])
    client = serve(fake)
    spec = SessionSpecInput(agent_ref=ResourceRef(org="acme", slug="greeter"))
    outcome = client.send_and_wait(org="acme", message="hi", session_spec=spec, name="mine", timeout=10)
    assert fake.cancelled.wait(5)
    assert fake.lists == 0
    assert fake.requests[0].HasField("after_seq") and fake.requests[0].after_seq == 0
    assert (outcome.session_id, fake.created[0].metadata.name) == ("ses_new", "mine")


def test_ends_on_a_final_code_without_retrying(serve) -> None:
    fake = _Fake([_Step(code=grpc.StatusCode.PERMISSION_DENIED)])
    client = serve(fake)
    with pytest.raises(StigmerError) as raised:
        client.wait_for_turn("ses_1", "run_1", 0, timeout=10)
    assert raised.value.code.value == "permission-denied"
    assert len(fake.requests) == 1


def test_the_timeout_bounds_the_wait_across_reconnects_and_cancels_the_stream(serve) -> None:
    fake = _Fake(
        [
            _Step(code=grpc.StatusCode.UNAVAILABLE),
            _Step(code=grpc.StatusCode.UNAVAILABLE),
            _Step(hold=True),
        ]
    )
    client = serve(fake)
    start = time.monotonic()
    with pytest.raises(TimeoutError):
        client.wait_for_turn("ses_1", "run_1", 0, timeout=0.5)
    assert time.monotonic() - start < 3
    assert len(fake.requests) == 3
    assert fake.cancelled.wait(5), "the held stream was left open after the timeout"


def test_returns_the_asks_of_a_waiting_turn(serve) -> None:
    ask = _event(
        3,
        "run_1",
        agent_tool_use=event_pb2.AgentToolUseEvent(id="t3", name="Bash", evaluated_permission="ask"),
    )
    idle = _event(
        4,
        "",
        session_status_idle=event_pb2.SessionStatusIdleEvent(
            id="i4", stop_reason=event_content_pb2.StopReason(type="requires_action", event_ids=["t3"])
        ),
    )
    fake = _Fake([_Step([ask, idle], hold=True)])
    client = serve(fake)
    outcome = client.wait_for_turn("ses_1", "run_1", 2, timeout=10)
    assert fake.cancelled.wait(5)
    assert (outcome.phase, outcome.asks, outcome.last_seq) == ("waiting", (TurnAsk(id="t3", name="Bash"),), 4)
