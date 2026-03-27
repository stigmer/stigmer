"""Tests for InterruptCapture tool_call_id-based interrupt matching.

Covers ``_match_interrupt``, ``_verify_waiting_approval``, and ``_find_tool_call``.
Interrupts are matched directly by ``tool_call_id`` against tool calls in
``WAITING_APPROVAL`` state (top-level and sub-agent executions).
"""

import logging
from unittest.mock import MagicMock

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus

from worker.activities.graphton.hitl import ApprovalStateManager, InterruptCapture


# =============================================================================
# Helpers
# =============================================================================


def _make_ic(tool_calls=None, sub_agent_executions=None):
    logger = logging.getLogger("test_match_interrupt")
    sb = MagicMock()
    sb.current_status.tool_calls = list(tool_calls or [])
    sb.current_status.sub_agent_executions = list(sub_agent_executions or [])
    sb.current_status.pending_approvals = []
    sm = ApprovalStateManager(execution_id="test", logger=logger)
    return InterruptCapture(
        execution_id="test",
        status_builder=sb,
        state_manager=sm,
        logger=logger,
        resolve_platform_tool_name=lambda name: name,
    )


def _make_tc(tc_id="call_001", status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL):
    tc = MagicMock()
    tc.id = tc_id
    tc.status = status
    return tc


def _make_sub_agent(tool_calls=None):
    sa = MagicMock()
    sa.tool_calls = list(tool_calls or [])
    return sa


# =============================================================================
# TestMatchInterrupt
# =============================================================================


class TestMatchInterrupt:
    """Tests for ``InterruptCapture._match_interrupt``."""

    def test_returns_tool_call_id_when_valid(self):
        ic = _make_ic(tool_calls=[_make_tc()])
        matched: set[str] = set()
        out = ic._match_interrupt(
            tool_call_id="call_001",
            matched_tc_ids=matched,
            intr_id="intr-1",
        )
        assert out == "call_001"

    def test_returns_empty_when_no_tool_call_id(self):
        ic = _make_ic(tool_calls=[_make_tc()])
        matched: set[str] = set()
        out = ic._match_interrupt(
            tool_call_id="",
            matched_tc_ids=matched,
            intr_id="intr-1",
        )
        assert out == ""

    def test_returns_empty_for_duplicate(self):
        ic = _make_ic(tool_calls=[_make_tc()])
        matched: set[str] = set()
        first = ic._match_interrupt(
            tool_call_id="call_001",
            matched_tc_ids=matched,
            intr_id="intr-1",
        )
        second = ic._match_interrupt(
            tool_call_id="call_001",
            matched_tc_ids=matched,
            intr_id="intr-2",
        )
        assert first == "call_001"
        assert second == ""

    def test_returns_empty_when_not_waiting_approval(self):
        ic = _make_ic(
            tool_calls=[_make_tc(status=ToolCallStatus.TOOL_CALL_RUNNING)],
        )
        matched: set[str] = set()
        out = ic._match_interrupt(
            tool_call_id="call_001",
            matched_tc_ids=matched,
            intr_id="intr-1",
        )
        assert out == ""

    def test_adds_to_matched_set(self):
        ic = _make_ic(tool_calls=[_make_tc()])
        matched: set[str] = set()
        ic._match_interrupt(
            tool_call_id="call_001",
            matched_tc_ids=matched,
            intr_id="intr-1",
        )
        assert matched == {"call_001"}


# =============================================================================
# TestVerifyWaitingApproval
# =============================================================================


class TestVerifyWaitingApproval:
    """Tests for ``InterruptCapture._verify_waiting_approval``."""

    def test_finds_top_level_waiting(self):
        ic = _make_ic(tool_calls=[_make_tc(tc_id="tc-top")])
        assert ic._verify_waiting_approval("tc-top") is True

    def test_finds_sub_agent_waiting(self):
        sa = _make_sub_agent(tool_calls=[_make_tc(tc_id="tc-sub")])
        ic = _make_ic(sub_agent_executions=[sa])
        assert ic._verify_waiting_approval("tc-sub") is True

    def test_rejects_running(self):
        ic = _make_ic(
            tool_calls=[_make_tc(tc_id="tc-run", status=ToolCallStatus.TOOL_CALL_RUNNING)],
        )
        assert ic._verify_waiting_approval("tc-run") is False

    def test_rejects_missing(self):
        ic = _make_ic(tool_calls=[])
        assert ic._verify_waiting_approval("missing") is False


# =============================================================================
# TestFindToolCall
# =============================================================================


class TestFindToolCall:
    """Tests for ``InterruptCapture._find_tool_call``."""

    def test_finds_top_level(self):
        tc = _make_tc(tc_id="a1", status=ToolCallStatus.TOOL_CALL_RUNNING)
        ic = _make_ic(tool_calls=[tc])
        assert ic._find_tool_call("a1") is tc

    def test_finds_sub_agent(self):
        tc = _make_tc(tc_id="b2")
        sa = _make_sub_agent(tool_calls=[tc])
        ic = _make_ic(sub_agent_executions=[sa])
        assert ic._find_tool_call("b2") is tc

    def test_returns_none_when_missing(self):
        ic = _make_ic(tool_calls=[_make_tc(tc_id="only")])
        assert ic._find_tool_call("other") is None
