"""Unit tests for checkpoint_validator module.

Tests cover:
- V1: Graph termination state detection
- V2: Unmatched tool call detection
- V3: Sub-agent cross-reference (confirmed orphans, missed events, ghost sub-agents)
- V4: AI message count divergence
- Happy path with no discrepancies
- Multiple discrepancies in a single validation
- Edge cases: None graph_state, empty messages
- build_error_from_validation helper
"""

from types import SimpleNamespace
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from stigmer_runner.worker.activities.graphton.checkpoint_validator import (
    CheckpointValidationResult,
    Discrepancy,
    build_error_from_validation,
    validate_against_checkpoint,
)

PHASE_IN_PROGRESS = 1
PHASE_WAITING_FOR_APPROVAL = 5
PHASE_PAUSED = 6
PHASE_COMPLETED = 3


def _make_graph_state(
    messages: list[Any] | None = None,
    next_nodes: tuple[str, ...] = (),
    interrupts: tuple[Any, ...] = (),
) -> SimpleNamespace:
    """Build a mock StateSnapshot with the fields aget_state() returns."""
    return SimpleNamespace(
        values={"messages": messages or []},
        next=next_nodes,
        interrupts=interrupts,
    )


def _ai_with_tool_calls(
    tool_calls: list[dict[str, str]],
    content: str = "",
) -> AIMessage:
    """Build an AIMessage with tool_calls."""
    return AIMessage(
        content=content,
        tool_calls=[
            {"id": tc["id"], "name": tc["name"], "args": tc.get("args", {})}
            for tc in tool_calls
        ],
    )


def _tool_result(tool_call_id: str, content: str = "ok") -> ToolMessage:
    """Build a ToolMessage for a completed tool call."""
    return ToolMessage(content=content, tool_call_id=tool_call_id)


# =============================================================================
# V1: Graph Termination State
# =============================================================================


class TestGraphTermination:
    """Tests for V1: graph termination state detection."""

    def test_terminated_graph_no_discrepancy(self):
        """Normal completion — graph has no pending nodes."""
        state = _make_graph_state(next_nodes=())
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.graph_is_terminated is True
        assert not any(
            d.category == "graph_termination" for d in result.discrepancies
        )

    def test_graph_not_terminated_unexpected(self):
        """Graph has pending nodes but stream ended without expected phase."""
        state = _make_graph_state(next_nodes=("tools",))
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.graph_is_terminated is False
        assert result.has_errors
        term_errors = [
            d for d in result.discrepancies if d.category == "graph_termination"
        ]
        assert len(term_errors) == 1
        assert term_errors[0].severity == "error"
        assert "tools" in term_errors[0].description

    def test_graph_not_terminated_waiting_for_approval(self):
        """Graph has pending nodes but phase is WAITING_FOR_APPROVAL — expected."""
        state = _make_graph_state(next_nodes=("tools",))
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_WAITING_FOR_APPROVAL,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.graph_is_terminated is False
        assert not any(
            d.category == "graph_termination" and d.severity == "error"
            for d in result.discrepancies
        )

    def test_graph_not_terminated_paused(self):
        """Graph has pending nodes but phase is PAUSED — expected."""
        state = _make_graph_state(next_nodes=("agent",))
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_PAUSED,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert not result.has_errors


# =============================================================================
# V2: Unmatched Tool Calls
# =============================================================================


class TestUnmatchedToolCalls:
    """Tests for V2: unmatched tool call detection."""

    def test_all_tools_matched(self):
        """Every tool call has a corresponding ToolMessage."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([
                {"id": "call_1", "name": "read_file"},
                {"id": "call_2", "name": "write_file"},
            ]),
            _tool_result("call_1", "file contents"),
            _tool_result("call_2", "written"),
            AIMessage(content="Done."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=2,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.unmatched_tool_call_count == 0
        assert not any(
            d.category == "unmatched_tool_calls" for d in result.discrepancies
        )

    def test_unmatched_regular_tool(self):
        """AIMessage has tool call for read_file but no ToolMessage."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "call_1", "name": "read_file"}]),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.unmatched_tool_call_count == 1
        assert result.has_errors
        unmatched = [
            d for d in result.discrepancies
            if d.category == "unmatched_tool_calls"
        ]
        assert len(unmatched) == 1
        assert "read_file" in str(unmatched[0].details)

    def test_unmatched_task_tool(self):
        """AIMessage has tool call for task tool, no ToolMessage."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([
                {"id": "call_1", "name": "task"},
                {"id": "call_2", "name": "read_file"},
            ]),
            _tool_result("call_2", "contents"),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=1,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.unmatched_tool_call_count == 1
        assert result.confirmed_orphan_count == 1

    def test_multiple_rounds_all_matched(self):
        """Multiple model-tool rounds, all tool calls matched."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "c1", "name": "read_file"}]),
            _tool_result("c1"),
            _ai_with_tool_calls([{"id": "c2", "name": "write_file"}]),
            _tool_result("c2"),
            AIMessage(content="All done."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=3,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.unmatched_tool_call_count == 0
        assert not result.has_errors


# =============================================================================
# V3: Sub-Agent Cross-Reference
# =============================================================================


class TestSubAgentCrossReference:
    """Tests for V3: sub-agent completion cross-reference."""

    def test_confirmed_orphan(self):
        """Unmatched in checkpoint AND active in StatusBuilder."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "call_1", "name": "task"}]),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=1,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.confirmed_orphan_count == 1
        assert result.missed_event_count == 0
        assert result.has_errors
        mismatch = [
            d for d in result.discrepancies
            if d.category == "sub_agent_mismatch"
        ]
        assert len(mismatch) == 1
        assert "confirmed orphaned" in mismatch[0].description

    def test_missed_event_detection(self):
        """Checkpoint has ToolMessage for task but sub-agent still in _active."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "call_1", "name": "task"}]),
            _tool_result("call_1", "sub-agent result"),
            AIMessage(content="Done."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=1,
            status_ai_message_count=2,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.missed_event_count == 1
        assert result.confirmed_orphan_count == 0
        assert not result.has_errors
        assert result.has_warnings
        mismatch = [
            d for d in result.discrepancies
            if d.category == "sub_agent_mismatch"
        ]
        assert len(mismatch) == 1
        assert "on_tool_end events were likely missed" in mismatch[0].description

    def test_ghost_sub_agent(self):
        """Checkpoint shows task tool call without ToolMessage, NOT in _active."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "call_1", "name": "task"}]),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.confirmed_orphan_count == 1
        assert result.missed_event_count == 0
        assert result.has_errors
        mismatch = [
            d for d in result.discrepancies
            if d.category == "sub_agent_mismatch"
        ]
        assert "ghost sub-agents" in mismatch[0].description

    def test_mixed_orphans_and_missed_events(self):
        """Some sub-agents completed, some didn't, StatusBuilder tracks more."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([
                {"id": "call_1", "name": "task"},
                {"id": "call_2", "name": "task"},
                {"id": "call_3", "name": "task"},
            ]),
            _tool_result("call_1", "result 1"),
            _tool_result("call_2", "result 2"),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=3,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.confirmed_orphan_count == 1
        assert result.missed_event_count == 2
        assert result.has_errors

    def test_no_sub_agents_no_mismatch(self):
        """No task tool calls and no active sub-agents — clean."""
        messages = [
            HumanMessage(content="hello"),
            AIMessage(content="Sure, let me help."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.confirmed_orphan_count == 0
        assert result.missed_event_count == 0
        assert not any(
            d.category == "sub_agent_mismatch" for d in result.discrepancies
        )


# =============================================================================
# V4: AI Message Count
# =============================================================================


class TestAIMessageCount:
    """Tests for V4: AI message count divergence."""

    def test_counts_match(self):
        """AI message counts agree — no warning."""
        messages = [
            HumanMessage(content="hello"),
            AIMessage(content="Hi!"),
            AIMessage(content="Done."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=2,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert not any(
            d.category == "message_count" for d in result.discrepancies
        )

    def test_off_by_one_no_warning(self):
        """Difference of 1 is within tolerance — no warning."""
        messages = [
            HumanMessage(content="hello"),
            AIMessage(content="Hi!"),
            AIMessage(content="Done."),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert not any(
            d.category == "message_count" for d in result.discrepancies
        )

    def test_significant_divergence_warning(self):
        """Difference > 1 triggers warning."""
        messages = [
            HumanMessage(content="hello"),
            AIMessage(content="1"),
            AIMessage(content="2"),
            AIMessage(content="3"),
            AIMessage(content="4"),
            AIMessage(content="5"),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=2,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        count_warnings = [
            d for d in result.discrepancies if d.category == "message_count"
        ]
        assert len(count_warnings) == 1
        assert count_warnings[0].severity == "warning"
        assert count_warnings[0].details["difference"] == 3


# =============================================================================
# Happy Path & Edge Cases
# =============================================================================


class TestHappyPath:
    """Test normal completion with no discrepancies."""

    def test_clean_execution(self):
        """Normal execution — all checks pass, zero discrepancies."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([{"id": "c1", "name": "read_file"}]),
            _tool_result("c1"),
            _ai_with_tool_calls([{"id": "c2", "name": "task"}]),
            _tool_result("c2", "sub-agent done"),
            AIMessage(content="All done!"),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=3,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert len(result.discrepancies) == 0
        assert result.graph_is_terminated is True
        assert result.unmatched_tool_call_count == 0
        assert result.confirmed_orphan_count == 0
        assert result.missed_event_count == 0
        assert not result.has_errors
        assert not result.has_warnings


class TestEdgeCases:
    """Edge cases and defensive behavior."""

    def test_none_graph_state(self):
        """aget_state() returned None — produces warning, not error."""
        result = validate_against_checkpoint(
            graph_state=None,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert len(result.discrepancies) == 1
        assert result.discrepancies[0].severity == "warning"
        assert result.discrepancies[0].category == "graph_termination"
        assert result.graph_is_terminated is True
        assert not result.has_errors
        assert result.has_warnings

    def test_empty_messages(self):
        """Graph state has no messages — no tool call or message count issues."""
        state = _make_graph_state(messages=[])
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.unmatched_tool_call_count == 0
        assert not result.has_errors

    def test_graph_state_without_values(self):
        """Graph state object has no values attribute — handled gracefully."""
        state = SimpleNamespace(next=())
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=0,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert result.graph_is_terminated is True
        assert result.unmatched_tool_call_count == 0

    def test_system_messages_not_counted_as_ai(self):
        """SystemMessages in checkpoint should not inflate AI message count."""
        messages = [
            SystemMessage(content="You are a helpful assistant."),
            HumanMessage(content="hello"),
            AIMessage(content="Hi!"),
        ]
        state = _make_graph_state(messages=messages)
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=0,
            status_ai_message_count=1,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        assert not any(
            d.category == "message_count" for d in result.discrepancies
        )


# =============================================================================
# Multiple Discrepancies
# =============================================================================


class TestMultipleDiscrepancies:
    """Test that all validation checks run and report independently."""

    def test_all_checks_report(self):
        """Graph not terminated + unmatched tools + message divergence."""
        messages = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls([
                {"id": "c1", "name": "read_file"},
                {"id": "c2", "name": "task"},
            ]),
            AIMessage(content="extra 1"),
            AIMessage(content="extra 2"),
            AIMessage(content="extra 3"),
        ]
        state = _make_graph_state(
            messages=messages, next_nodes=("tools",)
        )
        result = validate_against_checkpoint(
            graph_state=state,
            active_sub_agent_count=1,
            status_ai_message_count=0,
            execution_phase=PHASE_IN_PROGRESS,
            waiting_for_approval_phase=PHASE_WAITING_FOR_APPROVAL,
            paused_phase=PHASE_PAUSED,
        )
        categories = {d.category for d in result.discrepancies}
        assert "graph_termination" in categories
        assert "unmatched_tool_calls" in categories
        assert "sub_agent_mismatch" in categories
        assert "message_count" in categories
        assert result.has_errors
        assert result.has_warnings


# =============================================================================
# build_error_from_validation
# =============================================================================


class TestBuildErrorFromValidation:
    """Tests for the error message builder."""

    def test_errors_included(self):
        """Error-severity discrepancies are included in the message."""
        result = CheckpointValidationResult(
            discrepancies=(
                Discrepancy(
                    category="unmatched_tool_calls",
                    severity="error",
                    description="2 tool calls unmatched",
                ),
                Discrepancy(
                    category="message_count",
                    severity="warning",
                    description="count mismatch",
                ),
            ),
            graph_is_terminated=True,
            unmatched_tool_call_count=2,
            confirmed_orphan_count=0,
            missed_event_count=0,
        )
        error = build_error_from_validation(result)
        assert "2 tool calls unmatched" in error
        assert "count mismatch" not in error
        assert error.startswith("Checkpoint validation detected")

    def test_no_errors_empty_string(self):
        """When no errors, returns empty string."""
        result = CheckpointValidationResult(
            discrepancies=(
                Discrepancy(
                    category="message_count",
                    severity="warning",
                    description="minor diff",
                ),
            ),
            graph_is_terminated=True,
            unmatched_tool_call_count=0,
            confirmed_orphan_count=0,
            missed_event_count=0,
        )
        assert build_error_from_validation(result) == ""

    def test_clean_result_empty_string(self):
        """Clean validation result produces empty string."""
        result = CheckpointValidationResult(
            discrepancies=(),
            graph_is_terminated=True,
            unmatched_tool_call_count=0,
            confirmed_orphan_count=0,
            missed_event_count=0,
        )
        assert build_error_from_validation(result) == ""
