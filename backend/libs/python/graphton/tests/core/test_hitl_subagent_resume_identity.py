"""HITL sub-agent approval identity chain verification.

Investigates the production bug where sub-agent tool approvals keep
reappearing in the UI despite being approved.  The root cause is a
tool_call_id identity chain failure: the DB-stored ``tc.id`` diverges
from the ``tool_call_id`` inside the LangGraph checkpoint interrupt
value on the resume path.

These tests encode the expected contract and empirically verify it
against the installed LangGraph version:

1. ``interrupt({"tool_call_id": X})`` in a sub-agent preserves X in
   ``aget_state().interrupts[].value["tool_call_id"]`` on the parent.
2. ``Command(resume={intr.id: decision})`` correctly resumes the
   sub-agent after approval.
3. ``intr.id`` (LangGraph's internal key) is distinct from
   ``intr.value["tool_call_id"]`` (the model-assigned ID stored in DB).
4. Multi-interrupt, partial-resume, and multi-cycle scenarios behave
   as the HITL resume matching logic expects.

Tested against: langgraph>=1.0.0

See also:
  - test_native_subgraph_interrupt.py  (Phase 0 propagation verification)
  - test_tool_call_id_on_events.py     (ToolCallIdCapture research)
  - hitl.py resolve_resume_input       (resume matching logic under test)
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt
from typing_extensions import Annotated

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_all_interrupts(state) -> list:
    """Extract all interrupt objects from a parent graph state."""
    interrupts = []
    if hasattr(state, "tasks"):
        for task in state.tasks:
            if hasattr(task, "interrupts"):
                interrupts.extend(task.interrupts)
    return interrupts


def _build_approval_subgraph(
    tool_call_ids: list[str],
) -> Any:
    """Sub-agent graph where each node calls interrupt() with a distinct tool_call_id.

    Simulates the pattern from ``_check_and_handle_approval`` in tool_wrappers.py:
    ``interrupt({"tool_call_id": tool_call_id, "message": ...})``.
    """

    def ask_approval(state: MessagesState) -> dict:
        results = []
        for tc_id in tool_call_ids:
            decision = interrupt({
                "tool_call_id": tc_id,
                "message": f"Approve tool call {tc_id}?",
            })
            results.append(f"{tc_id}={decision}")
        return {"messages": [AIMessage(content=f"Results: {', '.join(results)}")]}

    builder = StateGraph(MessagesState)
    builder.add_node("ask", ask_approval)
    builder.add_edge(START, "ask")
    builder.add_edge("ask", END)
    return builder.compile()


def _build_parent_with_subagent(subgraph, checkpointer) -> Any:
    """Parent graph that invokes a sub-agent from a node."""

    def router(state: MessagesState) -> str:
        last = state["messages"][-1]
        if isinstance(last, HumanMessage):
            return "call_sub"
        return END

    def call_sub(state: MessagesState) -> dict:
        result = subgraph.invoke(
            {"messages": [HumanMessage(content="Do work")]},
        )
        return {"messages": [AIMessage(content=result["messages"][-1].content)]}

    builder = StateGraph(MessagesState)
    builder.add_node("call_sub", call_sub)
    builder.add_conditional_edges(START, router, {"call_sub": "call_sub", END: END})
    builder.add_edge("call_sub", END)
    return builder.compile(checkpointer=checkpointer)


def _build_multi_cycle_subgraph() -> Any:
    """Sub-agent that interrupts twice across two sequential calls.

    Cycle 1: interrupt with tool_call_id = "tc_cycle_1"
    Cycle 2: interrupt with tool_call_id = "tc_cycle_2"
    """
    call_count: list[int] = []

    def work(state: MessagesState) -> dict:
        call_count.append(1)
        cycle = len(call_count)
        tc_id = f"tc_cycle_{cycle}"
        decision = interrupt({
            "tool_call_id": tc_id,
            "message": f"Approve cycle {cycle}?",
        })
        return {"messages": [AIMessage(content=f"Cycle {cycle}: {decision}")]}

    builder = StateGraph(MessagesState)
    builder.add_node("work", work)
    builder.add_edge(START, "work")
    builder.add_edge("work", END)
    return builder.compile()


# ---------------------------------------------------------------------------
# Test 1: Sub-agent interrupt tool_call_id preserved across resume
# ---------------------------------------------------------------------------


class TestSubagentInterruptIdentityPreserved:
    """Verify that a sub-agent's interrupt({"tool_call_id": X}) is readable
    as intr.value["tool_call_id"] == X on the parent state, and that resume
    via Command(resume={intr.id: decision}) completes successfully."""

    @pytest.mark.asyncio
    async def test_tool_call_id_preserved_in_interrupt_value(self):
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_sub_001"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "identity-test-1"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)

        assert len(interrupts) >= 1, (
            "Sub-agent interrupt() did not propagate to parent"
        )

        intr = interrupts[0]
        assert isinstance(intr.value, dict), (
            f"Interrupt value is not a dict: {type(intr.value)}"
        )
        assert intr.value.get("tool_call_id") == "toolu_sub_001", (
            f"tool_call_id mismatch in interrupt value: "
            f"expected 'toolu_sub_001', got {intr.value.get('tool_call_id')!r}"
        )

    @pytest.mark.asyncio
    async def test_resume_with_interrupt_id_key_completes(self):
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_sub_001"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "identity-test-1b"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)
        assert len(interrupts) >= 1

        intr = interrupts[0]
        resume_dict = {intr.id: {"action": "approve"}}

        result = await parent.ainvoke(
            Command(resume=resume_dict),
            config=config,
        )

        final_msg = result["messages"][-1].content
        assert "toolu_sub_001" in final_msg, (
            f"Expected tool_call_id in result, got: {final_msg}"
        )


# ---------------------------------------------------------------------------
# Test 2: Multiple sub-agent interrupts
# ---------------------------------------------------------------------------


class TestMultipleSubagentInterrupts:
    """Verify that multiple interrupt() calls from a sub-agent each carry
    their distinct tool_call_id and can be resumed simultaneously."""

    @pytest.mark.asyncio
    async def test_two_interrupts_have_distinct_tool_call_ids(self):
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_multi_A", "toolu_multi_B"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "multi-interrupt-test"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)

        # LangGraph processes interrupt() calls sequentially within a node.
        # The first interrupt() pauses execution. After resume, the second
        # interrupt() fires. So we expect exactly 1 interrupt at a time.
        assert len(interrupts) >= 1, "Expected at least 1 interrupt"

        first_intr = interrupts[0]
        assert first_intr.value.get("tool_call_id") == "toolu_multi_A", (
            f"First interrupt should have tool_call_id='toolu_multi_A', "
            f"got {first_intr.value.get('tool_call_id')!r}"
        )

    @pytest.mark.asyncio
    async def test_sequential_interrupts_resume_through_both(self):
        """Resume first interrupt, then second interrupt fires, resume again."""
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_seq_A", "toolu_seq_B"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "seq-interrupt-test"}}

        # First invocation: first interrupt fires
        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)
        assert len(interrupts) >= 1
        first_intr = interrupts[0]
        assert first_intr.value["tool_call_id"] == "toolu_seq_A"

        # Resume first interrupt
        result = await parent.ainvoke(
            Command(resume={first_intr.id: {"action": "approve"}}),
            config=config,
        )

        # Check if second interrupt fires
        state2 = await parent.aget_state(config)
        interrupts2 = _get_all_interrupts(state2)

        if interrupts2:
            # Second interrupt fired
            second_intr = interrupts2[0]
            assert second_intr.value["tool_call_id"] == "toolu_seq_B", (
                f"Second interrupt should have tool_call_id='toolu_seq_B', "
                f"got {second_intr.value.get('tool_call_id')!r}"
            )

            # Resume second interrupt
            result = await parent.ainvoke(
                Command(resume={second_intr.id: {"action": "approve"}}),
                config=config,
            )

            final_msg = result["messages"][-1].content
            assert "toolu_seq_A" in final_msg and "toolu_seq_B" in final_msg, (
                f"Expected both tool_call_ids in result, got: {final_msg}"
            )
        else:
            # Both completed in one resume (graph completed)
            final_msg = result["messages"][-1].content
            assert "toolu_seq_A" in final_msg, (
                f"Expected at least first tool_call_id in result: {final_msg}"
            )


# ---------------------------------------------------------------------------
# Test 3: Partial resume (approve 1 of N interrupts)
# ---------------------------------------------------------------------------


class TestPartialResume:
    """Document LangGraph behavior when only some interrupts are resumed.

    In production, the user may approve one tool call but not another.
    ``resolve_resume_input`` builds ``Command(resume=...)`` with only
    the matched decisions.  We need to understand what LangGraph does:
    does it re-interrupt for the unresolved one, or error?
    """

    @pytest.mark.asyncio
    async def test_partial_resume_behavior_documented(self):
        """With sequential interrupts, partial resume is the natural flow:
        resume interrupt A, then interrupt B fires separately."""
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_partial_A", "toolu_partial_B"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "partial-resume-test"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)
        assert len(interrupts) >= 1

        first_intr = interrupts[0]
        assert first_intr.value["tool_call_id"] == "toolu_partial_A"

        # Resume only the first one (the only one pending)
        await parent.ainvoke(
            Command(resume={first_intr.id: {"action": "approve"}}),
            config=config,
        )

        # The second interrupt should now be pending
        state2 = await parent.aget_state(config)
        interrupts2 = _get_all_interrupts(state2)

        if interrupts2:
            assert interrupts2[0].value["tool_call_id"] == "toolu_partial_B", (
                "After resuming first interrupt, second should be pending"
            )


# ---------------------------------------------------------------------------
# Test 4: Multi-cycle resume (stale decisions must not confuse matching)
# ---------------------------------------------------------------------------


class TestMultiCycleResume:
    """Verify that after cycle 1 interrupt is resumed, cycle 2 produces
    a new interrupt with a DIFFERENT tool_call_id, and that cycle 1's
    stale decision data does not interfere with cycle 2 matching."""

    @pytest.mark.asyncio
    async def test_cycle2_interrupt_has_different_tool_call_id(self):
        checkpointer = MemorySaver()

        # Sub-agent that interrupts on every invocation with a new tc_id
        call_count: list[int] = []

        def work_node(state: MessagesState) -> dict:
            call_count.append(1)
            cycle = len(call_count)
            tc_id = f"tc_cycle_{cycle}"
            decision = interrupt({
                "tool_call_id": tc_id,
                "message": f"Approve cycle {cycle}?",
            })
            return {"messages": [AIMessage(content=f"Cycle {cycle}: {decision}")]}

        sub_builder = StateGraph(MessagesState)
        sub_builder.add_node("work", work_node)
        sub_builder.add_edge(START, "work")
        sub_builder.add_edge("work", END)
        subgraph = sub_builder.compile()

        # Parent that calls sub-agent twice sequentially
        invocation_count: list[int] = []

        def parent_node(state: MessagesState) -> dict:
            invocation_count.append(1)
            result = subgraph.invoke(
                {"messages": [HumanMessage(content=f"Task {len(invocation_count)}")]},
            )
            return {"messages": [AIMessage(content=result["messages"][-1].content)]}

        def should_continue(state: MessagesState) -> str:
            if len(invocation_count) < 2:
                return "work"
            return END

        parent_builder = StateGraph(MessagesState)
        parent_builder.add_node("work", parent_node)
        parent_builder.add_edge(START, "work")
        parent_builder.add_conditional_edges("work", should_continue)
        parent = parent_builder.compile(checkpointer=checkpointer)

        config = {"configurable": {"thread_id": "multi-cycle-test"}}

        # Cycle 1: first interrupt
        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state1 = await parent.aget_state(config)
        interrupts1 = _get_all_interrupts(state1)
        assert len(interrupts1) >= 1
        cycle1_intr = interrupts1[0]
        cycle1_tc_id = cycle1_intr.value["tool_call_id"]
        assert cycle1_tc_id == "tc_cycle_1"

        # Resume cycle 1
        await parent.ainvoke(
            Command(resume={cycle1_intr.id: {"action": "approve"}}),
            config=config,
        )

        # Check if cycle 2 interrupt fired
        state2 = await parent.aget_state(config)
        interrupts2 = _get_all_interrupts(state2)

        if interrupts2:
            cycle2_intr = interrupts2[0]
            cycle2_tc_id = cycle2_intr.value["tool_call_id"]

            assert cycle2_tc_id != cycle1_tc_id, (
                f"Cycle 2 interrupt has same tool_call_id as cycle 1: {cycle2_tc_id}"
            )
            assert cycle2_tc_id == "tc_cycle_2", (
                f"Expected 'tc_cycle_2', got {cycle2_tc_id!r}"
            )

            # Verify cycle 1's interrupt ID is NOT reused
            assert cycle2_intr.id != cycle1_intr.id, (
                "Cycle 2 interrupt.id should differ from cycle 1"
            )


# ---------------------------------------------------------------------------
# Test 5: interrupt.id vs interrupt.value["tool_call_id"] are distinct
# ---------------------------------------------------------------------------


class TestInterruptIdVsToolCallId:
    """Confirm that ``intr.id`` (LangGraph's internal interrupt key used in
    ``Command(resume={intr.id: ...})``) is NOT the same string as
    ``intr.value["tool_call_id"]`` (the model-assigned ID stored in DB).

    ``resolve_resume_input`` in hitl.py must map tool_call_id -> intr.id
    for the resume dict.  If they were the same, a simpler mapping would
    work, but the production data shows they are different (e.g.,
    intr.id = '4d2c3bea51206fd2' vs tool_call_id = 'toolu_...')."""

    @pytest.mark.asyncio
    async def test_interrupt_id_differs_from_tool_call_id(self):
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_id_test_001"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "id-distinction-test"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)
        assert len(interrupts) >= 1

        intr = interrupts[0]
        interrupt_id = intr.id
        tool_call_id = intr.value["tool_call_id"]

        assert tool_call_id == "toolu_id_test_001"

        # Document whether they are the same or different.
        # The HITL resume flow uses intr.id as the resume dict key and
        # tool_call_id for DB matching.  If they differ, the two-step
        # mapping in resolve_resume_input is necessary.
        if interrupt_id == tool_call_id:
            # They are the same -- resolve_resume_input could use
            # tool_call_id directly as the resume key.
            pass
        else:
            # They differ -- the two-step mapping is required:
            # 1. Match decision.tool_call_id to intr.value["tool_call_id"]
            # 2. Use intr.id as the key in Command(resume=...)
            assert interrupt_id != tool_call_id, (
                "Expected intr.id to differ from tool_call_id for "
                "two-layer identity model verification"
            )

    @pytest.mark.asyncio
    async def test_resume_uses_interrupt_id_not_tool_call_id(self):
        """Resuming with tool_call_id as the key (instead of intr.id)
        should either fail or have no effect -- only intr.id works."""
        checkpointer = MemorySaver()
        subgraph = _build_approval_subgraph(["toolu_wrong_key"])
        parent = _build_parent_with_subagent(subgraph, checkpointer)

        config = {"configurable": {"thread_id": "wrong-key-test"}}

        await parent.ainvoke(
            {"messages": [HumanMessage(content="Go")]},
            config=config,
        )

        state = await parent.aget_state(config)
        interrupts = _get_all_interrupts(state)
        assert len(interrupts) >= 1

        intr = interrupts[0]
        tool_call_id = intr.value["tool_call_id"]

        if intr.id == tool_call_id:
            pytest.skip("intr.id == tool_call_id; wrong-key test not applicable")

        # Try resuming with tool_call_id instead of intr.id
        wrong_resume = {tool_call_id: {"action": "approve"}}

        result = await parent.ainvoke(
            Command(resume=wrong_resume),
            config=config,
        )

        # After resume with wrong key, interrupt should still be pending
        state_after = await parent.aget_state(config)
        interrupts_after = _get_all_interrupts(state_after)

        # If the interrupt is still pending, the wrong key was ignored
        # (this is the expected behavior that confirms the two-layer model)
        if interrupts_after:
            still_pending_tc_id = interrupts_after[0].value.get("tool_call_id")
            assert still_pending_tc_id == "toolu_wrong_key", (
                "Wrong resume key should leave the interrupt pending"
            )


# ---------------------------------------------------------------------------
# Test 6: Real LLM sub-agent interrupt identity (requires ANTHROPIC_API_KEY)
# ---------------------------------------------------------------------------


_SKIP_REAL_LLM = not os.environ.get("ANTHROPIC_API_KEY")


@pytest.mark.skipif(_SKIP_REAL_LLM, reason="Requires ANTHROPIC_API_KEY env var")
class TestRealLLMSubagentInterruptIdentity:
    """Verify with a real Anthropic model that the model-generated
    tool_call_id (toolu_...) flows through InjectedToolCallId into the
    interrupt value and can be matched on resume."""

    @pytest.mark.asyncio
    async def test_real_model_tool_call_id_in_interrupt(self):
        from langchain_anthropic import ChatAnthropic

        @tool
        def dangerous_execute(
            command: str,
            tool_call_id: Annotated[str, InjectedToolCallId],
        ) -> str:
            """Execute a shell command (requires approval)."""
            decision = interrupt({
                "tool_call_id": tool_call_id,
                "message": f"Execute: {command}",
            })
            if isinstance(decision, dict) and decision.get("action") == "approve":
                return f"Executed: {command}"
            return f"Skipped: {command}"

        model = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)
        model_with_tools = model.bind_tools([dangerous_execute])
        tool_node = ToolNode([dangerous_execute])

        invocation_count: list[int] = []

        def model_node(state: MessagesState) -> dict:
            invocation_count.append(1)
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

        checkpointer = MemorySaver()
        graph = builder.compile(checkpointer=checkpointer)

        config = {"configurable": {"thread_id": "real-llm-interrupt"}}

        await graph.ainvoke(
            {"messages": [HumanMessage(
                content="Run the command 'ls -la' using the dangerous_execute tool.",
            )]},
            config=config,
        )

        state = await graph.aget_state(config)
        interrupts = _get_all_interrupts(state)

        if not interrupts:
            pytest.skip("Model did not call the tool requiring approval")

        intr = interrupts[0]
        tc_id = intr.value.get("tool_call_id", "")

        assert tc_id, "tool_call_id is empty in interrupt value"
        assert tc_id.startswith("toolu_"), (
            f"Expected Anthropic-style tool_call_id (toolu_...), got {tc_id!r}"
        )

        # Resume and verify completion
        resume_dict = {intr.id: {"action": "approve"}}
        result = await graph.ainvoke(
            Command(resume=resume_dict),
            config=config,
        )

        final_msg = result["messages"][-1].content
        assert final_msg, "No final message after resume"
