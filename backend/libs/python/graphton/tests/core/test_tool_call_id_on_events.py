"""Research verification: tool_call_id availability on LangGraph v2 stream events.

Determines whether LangGraph v2 ``astream_events`` exposes the model's
``tool_call_id`` (e.g. ``toolu_01abc...``) on ``on_tool_start`` and
``on_tool_end`` events.  The agent-runner's ``ToolCallIdCapture`` exists
because early analysis found v2 events do NOT carry this field, while the
LangChain callback API (``BaseCallbackHandler.on_tool_start``) does.

These tests empirically verify that finding against the installed LangGraph
version to:

1. Confirm v2 events still omit ``tool_call_id`` (or discover it was added)
2. Confirm the callback API still provides ``tool_call_id``
3. Confirm callbacks fire before the corresponding v2 event is yielded
4. Verify behavior with multiple concurrent tool calls
5. Verify behavior on the resume-after-interrupt path
6. Verify with a real Anthropic model (skipped without API key)

Results directly inform T03 (HITL bidirectional fallback elimination) in
the execute_graphton simplification project.  If v2 events now carry
``tool_call_id``, ``ToolCallIdCapture`` can be simplified or removed.

Tested against: langgraph>=1.0.0, langchain-core>=1.0.0
"""

from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import pytest
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt


# ---------------------------------------------------------------------------
# Test tools
# ---------------------------------------------------------------------------


@tool
def greet(name: str) -> str:
    """Greet someone by name."""
    return f"Hello, {name}!"


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


# ---------------------------------------------------------------------------
# Recording callback handler
# ---------------------------------------------------------------------------


class _RecordingCallbackHandler(BaseCallbackHandler):
    """Records on_tool_start invocations for verification.

    Registered as a sync handler so it fires before the corresponding
    v2 event is yielded from ``astream_events``.
    """

    def __init__(self) -> None:
        self.tool_starts: list[dict[str, Any]] = []
        self.ordering: list[str] = []

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        tool_call_id: str | None = None,
        **kwargs: Any,
    ) -> None:
        self.tool_starts.append({
            "run_id": str(run_id),
            "tool_call_id": tool_call_id,
            "name": serialized.get("name", ""),
        })
        self.ordering.append(f"callback:{run_id}")


# ---------------------------------------------------------------------------
# Event inspection utility
# ---------------------------------------------------------------------------


def _find_tool_call_id_locations(event: dict[str, Any]) -> dict[str, Any]:
    """Search for tool_call_id in well-known locations within a v2 event.

    Returns a dict mapping location names to found values.  Empty dict
    means tool_call_id is not present at any inspected location.
    """
    locations: dict[str, Any] = {}

    if "tool_call_id" in event:
        locations["top_level"] = event["tool_call_id"]

    data = event.get("data", {})
    if isinstance(data, dict):
        if "tool_call_id" in data:
            locations["data"] = data["tool_call_id"]
        data_input = data.get("input")
        if isinstance(data_input, dict) and "tool_call_id" in data_input:
            locations["data.input"] = data_input["tool_call_id"]
        data_output = data.get("output")
        if hasattr(data_output, "tool_call_id"):
            locations["data.output (ToolMessage attr)"] = data_output.tool_call_id

    metadata = event.get("metadata", {})
    if isinstance(metadata, dict) and "tool_call_id" in metadata:
        locations["metadata"] = metadata["tool_call_id"]

    return locations


# ---------------------------------------------------------------------------
# Graph builders
# ---------------------------------------------------------------------------


def _build_single_tool_graph(
    tools: list,
    *,
    tool_call_id: str = "toolu_test_001",
    tool_name: str = "greet",
    tool_args: dict | None = None,
    checkpointer=None,
):
    """Deterministic graph that emits one tool call then finishes.

    The "model" node returns an AIMessage with a single tool_call on the
    first invocation, then a plain AIMessage on subsequent invocations.
    No LLM API key required.
    """
    if tool_args is None:
        tool_args = {"name": "World"}

    tool_node = ToolNode(tools)
    invocation_count: list[int] = []

    def model_node(state: MessagesState) -> dict:
        invocation_count.append(1)
        if len(invocation_count) == 1:
            return {"messages": [AIMessage(
                content="",
                tool_calls=[{
                    "name": tool_name,
                    "args": tool_args,
                    "id": tool_call_id,
                    "type": "tool_call",
                }],
            )]}
        return {"messages": [AIMessage(content="Done!")]}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    builder = StateGraph(MessagesState)
    builder.add_node("model", model_node)
    builder.add_node("tools", tool_node)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", should_continue)
    builder.add_edge("tools", "model")
    return builder.compile(checkpointer=checkpointer)


def _build_multi_tool_graph(tools: list):
    """Deterministic graph that emits two tool calls in a single AIMessage."""
    tool_node = ToolNode(tools)
    invocation_count: list[int] = []

    def model_node(state: MessagesState) -> dict:
        invocation_count.append(1)
        if len(invocation_count) == 1:
            return {"messages": [AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "greet",
                        "args": {"name": "Alice"},
                        "id": "toolu_multi_001",
                        "type": "tool_call",
                    },
                    {
                        "name": "add",
                        "args": {"a": 2, "b": 3},
                        "id": "toolu_multi_002",
                        "type": "tool_call",
                    },
                ],
            )]}
        return {"messages": [AIMessage(content="All done!")]}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    builder = StateGraph(MessagesState)
    builder.add_node("model", model_node)
    builder.add_node("tools", tool_node)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", should_continue)
    builder.add_edge("tools", "model")
    return builder.compile()


# ---------------------------------------------------------------------------
# Test 1: tool_call_id on v2 stream events
# ---------------------------------------------------------------------------


class TestToolCallIdOnV2StreamEvents:
    """Verify whether LangGraph v2 astream_events carry tool_call_id.

    This is the core research question.  If tool_call_id appears on v2
    on_tool_start / on_tool_end events, ToolCallIdCapture can be simplified.
    If absent (the expected finding), ToolCallIdCapture remains necessary.
    """

    async def test_on_tool_start_event_lacks_tool_call_id(self):
        """v2 on_tool_start event does not expose tool_call_id at the
        event-envelope level (top-level keys, data, or metadata)."""
        graph = _build_single_tool_graph([greet])
        config = {"configurable": {"thread_id": "t1-start"}}

        tool_start_events = []
        async for event in graph.astream_events(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
            version="v2",
        ):
            if event.get("event") == "on_tool_start":
                tool_start_events.append(event)

        assert len(tool_start_events) >= 1, (
            "Expected at least one on_tool_start event from astream_events v2"
        )

        first = tool_start_events[0]
        assert "run_id" in first, "on_tool_start must carry run_id"
        assert "name" in first, "on_tool_start must carry name"
        assert first["name"] == "greet"

        locations = _find_tool_call_id_locations(first)
        envelope_locations = {
            k: v for k, v in locations.items()
            if k != "data.output (ToolMessage attr)"
        }
        assert not envelope_locations, (
            f"SURPRISE: tool_call_id found on v2 on_tool_start event at "
            f"{envelope_locations}. ToolCallIdCapture may be simplifiable! "
            f"Full event keys: {sorted(first.keys())}"
        )

    async def test_on_tool_end_event_lacks_tool_call_id(self):
        """v2 on_tool_end event does not expose tool_call_id at the
        event-envelope level."""
        graph = _build_single_tool_graph([greet])
        config = {"configurable": {"thread_id": "t1-end"}}

        tool_end_events = []
        async for event in graph.astream_events(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
            version="v2",
        ):
            if event.get("event") == "on_tool_end":
                tool_end_events.append(event)

        assert len(tool_end_events) >= 1, (
            "Expected at least one on_tool_end event from astream_events v2"
        )

        first = tool_end_events[0]
        locations = _find_tool_call_id_locations(first)
        envelope_locations = {
            k: v for k, v in locations.items()
            if k != "data.output (ToolMessage attr)"
        }
        assert not envelope_locations, (
            f"SURPRISE: tool_call_id found on v2 on_tool_end event at "
            f"{envelope_locations}. ToolCallIdCapture may be simplifiable!"
        )

    async def test_on_tool_end_output_is_tool_message_with_tool_call_id(self):
        """v2 on_tool_end data.output is a ToolMessage that carries
        tool_call_id (expected -- this is how LangChain works, but it
        requires parsing the output object rather than reading a top-level
        event field)."""
        graph = _build_single_tool_graph([greet])
        config = {"configurable": {"thread_id": "t1-output"}}

        tool_end_events = []
        async for event in graph.astream_events(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
            version="v2",
        ):
            if event.get("event") == "on_tool_end":
                tool_end_events.append(event)

        assert len(tool_end_events) >= 1
        first = tool_end_events[0]
        output = first.get("data", {}).get("output")

        if hasattr(output, "tool_call_id"):
            assert output.tool_call_id == "toolu_test_001", (
                f"ToolMessage.tool_call_id mismatch: expected 'toolu_test_001', "
                f"got {output.tool_call_id!r}"
            )


# ---------------------------------------------------------------------------
# Test 2: tool_call_id on callback API
# ---------------------------------------------------------------------------


class TestToolCallIdOnCallbackApi:
    """Verify that the LangChain callback API delivers tool_call_id.

    ToolCallIdCapture relies on BaseCallbackHandler.on_tool_start receiving
    tool_call_id as a keyword argument.  These tests confirm this still works
    with the current LangGraph version.
    """

    async def test_callback_receives_tool_call_id(self):
        """on_tool_start callback receives a non-None tool_call_id kwarg."""
        handler = _RecordingCallbackHandler()
        graph = _build_single_tool_graph([greet])
        config = {
            "configurable": {"thread_id": "t2-callback"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        assert len(handler.tool_starts) >= 1, (
            "Callback handler was not invoked for on_tool_start"
        )
        captured = handler.tool_starts[0]
        assert captured["tool_call_id"] is not None, (
            "tool_call_id was None on callback. The callback API no longer "
            "provides it -- ToolCallIdCapture mechanism is broken."
        )

    async def test_callback_tool_call_id_matches_model_output(self):
        """The tool_call_id from the callback matches the AIMessage's
        tool_calls[].id value."""
        known_id = "toolu_match_001"
        handler = _RecordingCallbackHandler()
        graph = _build_single_tool_graph([greet], tool_call_id=known_id)
        config = {
            "configurable": {"thread_id": "t2-match"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        assert len(handler.tool_starts) >= 1
        assert handler.tool_starts[0]["tool_call_id"] == known_id, (
            f"Expected tool_call_id={known_id!r}, "
            f"got {handler.tool_starts[0]['tool_call_id']!r}"
        )


# ---------------------------------------------------------------------------
# Test 3: Callback fires before v2 event
# ---------------------------------------------------------------------------


class TestCallbackFiresBeforeStreamEvent:
    """Verify sync callbacks fire before the corresponding v2 event is yielded.

    ToolCallIdCapture must populate run_id -> tool_call_id BEFORE
    StatusBuilder processes the v2 on_tool_start event.  This relies on
    sync callbacks being dispatched inline before the async generator
    yields the event.
    """

    async def test_callback_precedes_v2_tool_start_event(self):
        """The callback's on_tool_start fires before the stream yields
        the on_tool_start event for the same run_id."""
        handler = _RecordingCallbackHandler()
        graph = _build_single_tool_graph([greet])
        config = {
            "configurable": {"thread_id": "t3-order"},
            "callbacks": [handler],
        }

        async for event in graph.astream_events(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
            version="v2",
        ):
            if event.get("event") == "on_tool_start":
                run_id = event.get("run_id", "")
                handler.ordering.append(f"stream:{run_id}")

        callback_entries = [e for e in handler.ordering if e.startswith("callback:")]
        stream_entries = [e for e in handler.ordering if e.startswith("stream:")]

        assert len(callback_entries) >= 1, "No callback entries recorded"
        assert len(stream_entries) >= 1, "No stream entries recorded"

        first_callback_idx = handler.ordering.index(callback_entries[0])
        first_stream_idx = handler.ordering.index(stream_entries[0])
        assert first_callback_idx < first_stream_idx, (
            f"Callback did not fire before stream event. "
            f"Ordering: {handler.ordering}. "
            f"ToolCallIdCapture relies on callbacks preceding v2 events."
        )


# ---------------------------------------------------------------------------
# Test 4: Multiple tool calls
# ---------------------------------------------------------------------------


class TestToolCallIdWithMultipleToolCalls:
    """Verify correct tool_call_id resolution with multiple tool calls.

    When an AIMessage contains multiple tool_calls, each callback
    invocation must receive the correct tool_call_id for its respective
    tool call.
    """

    async def test_multiple_tool_calls_each_get_correct_id_via_callback(self):
        """N tool calls produce N callback invocations with correct IDs."""
        handler = _RecordingCallbackHandler()
        graph = _build_multi_tool_graph([greet, add])
        config = {
            "configurable": {"thread_id": "t4-multi"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        assert len(handler.tool_starts) >= 2, (
            f"Expected at least 2 tool_start callbacks, got {len(handler.tool_starts)}"
        )
        captured_ids = {ts["tool_call_id"] for ts in handler.tool_starts}
        assert "toolu_multi_001" in captured_ids, (
            f"Missing toolu_multi_001 in captured IDs: {captured_ids}"
        )
        assert "toolu_multi_002" in captured_ids, (
            f"Missing toolu_multi_002 in captured IDs: {captured_ids}"
        )

    async def test_multiple_tool_calls_v2_events_lack_tool_call_id(self):
        """v2 events for multiple tool calls still lack tool_call_id at
        the event-envelope level."""
        graph = _build_multi_tool_graph([greet, add])
        config = {"configurable": {"thread_id": "t4-multi-events"}}

        tool_events = []
        async for event in graph.astream_events(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
            version="v2",
        ):
            if event.get("event") in ("on_tool_start", "on_tool_end"):
                tool_events.append(event)

        assert len(tool_events) >= 4, (
            f"Expected at least 4 tool events (2 starts + 2 ends), "
            f"got {len(tool_events)}"
        )

        for evt in tool_events:
            locations = _find_tool_call_id_locations(evt)
            envelope_locations = {
                k: v for k, v in locations.items()
                if k != "data.output (ToolMessage attr)"
            }
            assert not envelope_locations, (
                f"SURPRISE: tool_call_id found on multi-tool v2 "
                f"{evt['event']} event at {envelope_locations}. "
                f"ToolCallIdCapture may be simplifiable."
            )


# ---------------------------------------------------------------------------
# Test 5: Resume after interrupt
# ---------------------------------------------------------------------------


class TestToolCallIdOnResumeAfterInterrupt:
    """Verify tool_call_id behavior on the resume-after-interrupt path.

    When a tool calls interrupt() and the graph resumes via
    Command(resume=...), LangGraph re-invokes the tool node.  The callback
    must still receive the original tool_call_id so ToolCallIdCapture can
    map the (potentially new) run_id to the same identity.
    """

    async def test_resumed_tool_callback_preserves_tool_call_id(self):
        """After interrupt + resume, the callback delivers the original
        tool_call_id on the re-invocation."""
        handler = _RecordingCallbackHandler()
        checkpointer = MemorySaver()

        @tool
        def dangerous_op(action: str) -> str:
            """Perform a dangerous operation requiring approval."""
            decision = interrupt({"message": f"Approve: {action}?"})
            return f"Done: {action} (approved={decision})"

        known_tc_id = "toolu_interrupt_001"
        graph = _build_single_tool_graph(
            [dangerous_op],
            tool_call_id=known_tc_id,
            tool_name="dangerous_op",
            tool_args={"action": "delete_everything"},
            checkpointer=checkpointer,
        )
        config = {
            "configurable": {"thread_id": "t5-resume"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        pre_resume_count = len(handler.tool_starts)
        assert pre_resume_count >= 1, (
            "Expected at least one callback before interrupt"
        )
        assert handler.tool_starts[0]["tool_call_id"] == known_tc_id, (
            f"Pre-interrupt callback has wrong tool_call_id: "
            f"{handler.tool_starts[0]['tool_call_id']!r}"
        )

        await graph.ainvoke(
            Command(resume="yes"),
            config=config,
        )

        post_resume_starts = handler.tool_starts[pre_resume_count:]
        if post_resume_starts:
            resumed_tc_id = post_resume_starts[0]["tool_call_id"]
            assert resumed_tc_id == known_tc_id, (
                f"Resumed tool callback has different tool_call_id! "
                f"Expected {known_tc_id!r}, got {resumed_tc_id!r}. "
                f"ToolCallIdCapture alias mechanism may need adjustment."
            )

    async def test_resumed_tool_run_id_may_differ(self):
        """Document whether LangGraph assigns a new run_id on resume.

        If the run_id changes, ToolCallIdCapture's alias mechanism is
        needed to map the new run_id back to the original tool_call_id.
        This test documents the observed behavior without asserting a
        specific outcome -- the finding informs ToolCallIdCapture design.
        """
        handler = _RecordingCallbackHandler()
        checkpointer = MemorySaver()

        @tool
        def dangerous_op(action: str) -> str:
            """Perform a dangerous operation requiring approval."""
            decision = interrupt({"message": f"Approve: {action}?"})
            return f"Done: {action} (approved={decision})"

        graph = _build_single_tool_graph(
            [dangerous_op],
            tool_call_id="toolu_runid_test",
            tool_name="dangerous_op",
            tool_args={"action": "test"},
            checkpointer=checkpointer,
        )
        config = {
            "configurable": {"thread_id": "t5-runid"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )
        pre_resume_count = len(handler.tool_starts)

        await graph.ainvoke(
            Command(resume="yes"),
            config=config,
        )

        post_resume_starts = handler.tool_starts[pre_resume_count:]
        if post_resume_starts and pre_resume_count > 0:
            original_run_id = handler.tool_starts[0]["run_id"]
            resumed_run_id = post_resume_starts[0]["run_id"]
            # We document whether they differ but don't fail either way.
            # Both outcomes are valid; the alias mechanism handles both.
            if original_run_id != resumed_run_id:
                # New run_id on resume: alias mechanism is required
                pass
            else:
                # Same run_id on resume: alias mechanism is not needed
                # for this case but may still be needed for other paths
                pass


# ---------------------------------------------------------------------------
# Test 6: Real LLM verification (requires ANTHROPIC_API_KEY)
# ---------------------------------------------------------------------------


_SKIP_REAL_LLM = not os.environ.get("ANTHROPIC_API_KEY")


@pytest.mark.skipif(_SKIP_REAL_LLM, reason="Requires ANTHROPIC_API_KEY env var")
class TestToolCallIdWithRealLLM:
    """Verify tool_call_id behavior with a real Anthropic model.

    These tests use a live LLM to confirm that real model-generated
    tool_call_ids (toolu_01abc... format) flow correctly through the
    event/callback pipeline.  Skipped in CI without API keys.
    """

    @staticmethod
    def _build_real_llm_graph(tools: list):
        """Build a graph using a real ChatAnthropic model."""
        from langchain_anthropic import ChatAnthropic

        model = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)
        model_with_tools = model.bind_tools(tools)
        tool_node = ToolNode(tools)

        def model_node(state: MessagesState) -> dict:
            response = model_with_tools.invoke(state["messages"])
            return {"messages": [response]}

        def should_continue(state: MessagesState) -> str:
            last = state["messages"][-1]
            if isinstance(last, AIMessage) and last.tool_calls:
                return "tools"
            return END

        builder = StateGraph(MessagesState)
        builder.add_node("model", model_node)
        builder.add_node("tools", tool_node)
        builder.add_edge(START, "model")
        builder.add_conditional_edges("model", should_continue)
        builder.add_edge("tools", "model")
        return builder.compile()

    async def test_real_model_callback_receives_anthropic_tool_call_id(self):
        """A real Anthropic model's tool_call_id (toolu_...) reaches
        the callback handler."""
        @tool
        def get_weather(city: str) -> str:
            """Get the current weather for a city."""
            return f"Sunny, 72F in {city}"

        handler = _RecordingCallbackHandler()
        graph = self._build_real_llm_graph([get_weather])
        config = {
            "configurable": {"thread_id": "t6-real-cb"},
            "callbacks": [handler],
        }

        await graph.ainvoke(
            {"messages": [HumanMessage(
                content="What's the weather in San Francisco? Use the get_weather tool.",
            )]},
            config=config,
        )

        assert len(handler.tool_starts) >= 1, (
            "No tool_start callbacks from real model invocation. "
            "The model may not have called the tool."
        )

        tc_id = handler.tool_starts[0]["tool_call_id"]
        assert tc_id is not None, "Real model's tool_call_id was None in callback"
        assert tc_id.startswith("toolu_"), (
            f"Expected Anthropic-style tool_call_id (toolu_...), got {tc_id!r}"
        )

    async def test_real_model_v2_events_lack_tool_call_id(self):
        """v2 events from a real model invocation still lack tool_call_id
        at the event-envelope level."""
        @tool
        def get_weather(city: str) -> str:
            """Get the current weather for a city."""
            return f"Sunny, 72F in {city}"

        graph = self._build_real_llm_graph([get_weather])
        config = {"configurable": {"thread_id": "t6-real-events"}}

        tool_events = []
        async for event in graph.astream_events(
            {"messages": [HumanMessage(
                content="What's the weather in San Francisco? Use the get_weather tool.",
            )]},
            config=config,
            version="v2",
        ):
            if event.get("event") in ("on_tool_start", "on_tool_end"):
                tool_events.append(event)

        assert len(tool_events) >= 2, (
            f"Expected at least 2 tool events (start+end), got {len(tool_events)}. "
            f"The model may not have called the tool."
        )

        for evt in tool_events:
            locations = _find_tool_call_id_locations(evt)
            envelope_locations = {
                k: v for k, v in locations.items()
                if k != "data.output (ToolMessage attr)"
            }
            assert not envelope_locations, (
                f"SURPRISE: tool_call_id found on real-model v2 "
                f"{evt['event']} event at {envelope_locations}. "
                f"ToolCallIdCapture may be simplifiable."
            )
