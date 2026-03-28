"""Contract tests for the HITL approval flow (post-T03 simplification).

Tests cover:
  - ResumeReconciler: tool call transitions, auto-skip, stale completed_at
  - Fingerprint dedup: via messages (not flat lists)
  - Index rebuild on resume: populate_fingerprints_from_existing_tool_calls
  - Pending approvals snapshot: Temporal coordination signal
  - slim_status_for_temporal: snapshot preserved through slim copy
  - FIFO queue drain: stale entries removed when fingerprint dedup matches
  - Task tool early-TC reconciliation on resume path
  - Bidirectional ID lookup: defense-in-depth for ID mismatches
"""

import logging
from collections import deque
from typing import Any

import pytest
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    MessageType,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from google.protobuf.struct_pb2 import Struct

from worker.activities.graphton.hitl import ResumeReconciler
from worker.activities.graphton.status_builder import StatusBuilder
from worker.activities.graphton.temporal_helpers import slim_status_for_temporal


def _logger():
    return logging.getLogger("test_hitl_contracts")


def _status_with_tool_calls(*tool_calls: ToolCall) -> AgentExecutionStatus:
    """Build a minimal AgentExecutionStatus with tool calls embedded in an AI message."""
    status = AgentExecutionStatus()
    if tool_calls:
        msg = status.messages.add()
        msg.type = MessageType.MESSAGE_AI
        for tc in tool_calls:
            msg.tool_calls.append(tc)
    return status


def _make_tool_call(
    tc_id: str = "call_abc123",
    name: str = "delete_file",
    status: int = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
) -> ToolCall:
    return ToolCall(id=tc_id, name=name, status=status)


def _make_builder_with_decisions(
    tool_calls: list[ToolCall],
    sub_agents: list[SubAgentExecution] | None = None,
) -> StatusBuilder:
    """Create a StatusBuilder initialized as it would be on the resume path."""
    status = _status_with_tool_calls(*tool_calls)
    if sub_agents:
        for sa in sub_agents:
            status.sub_agent_executions.append(sa)
    builder = StatusBuilder("test_exec", status)
    builder.populate_fingerprints_from_existing_tool_calls()
    return builder


# =============================================================================
# ResumeReconciler: approve transitions
# =============================================================================


class TestResumeReconcileApprove:
    def test_approve_transitions_to_running(self):
        tc = _make_tool_call()
        builder = _make_builder_with_decisions([tc])

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_abc123",
                    action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                ),
            ],
        )

        resolved = builder.get_tool_call("call_abc123")
        assert resolved is not None
        assert resolved.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert resolved.approval_action == ApprovalAction.APPROVAL_ACTION_APPROVE
        assert resolved.approval_decided_at != ""

    def test_approve_with_comment_sets_approved_by(self):
        tc = _make_tool_call()
        builder = _make_builder_with_decisions([tc])

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_abc123",
                    action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                    comment="Looks good",
                ),
            ],
        )

        resolved = builder.get_tool_call("call_abc123")
        assert resolved is not None
        assert resolved.approved_by == "Looks good"


# =============================================================================
# ResumeReconciler: reject transitions + auto-skip
# =============================================================================


class TestResumeReconcileReject:
    def test_reject_transitions_to_skipped(self):
        tc = _make_tool_call()
        builder = _make_builder_with_decisions([tc])

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_abc123",
                    action=ApprovalAction.APPROVAL_ACTION_REJECT,
                ),
            ],
        )

        resolved = builder.get_tool_call("call_abc123")
        assert resolved is not None
        assert resolved.status == ToolCallStatus.TOOL_CALL_SKIPPED

    def test_reject_auto_skips_remaining_waiting_tools(self):
        tc1 = _make_tool_call(tc_id="call_1", name="delete_file")
        tc2 = _make_tool_call(tc_id="call_2", name="write_file")
        builder = _make_builder_with_decisions([tc1, tc2])

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_1",
                    action=ApprovalAction.APPROVAL_ACTION_REJECT,
                ),
            ],
        )

        tc1_resolved = builder.get_tool_call("call_1")
        tc2_resolved = builder.get_tool_call("call_2")
        assert tc1_resolved.status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert tc2_resolved.status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert "automatically skipped" in tc2_resolved.result


# =============================================================================
# ResumeReconciler: stale completed_at
# =============================================================================


class TestClearStaleCompletedAt:
    def test_stale_completed_at_cleared_on_reconcile(self):
        tc = _make_tool_call()
        builder = _make_builder_with_decisions([tc])
        builder.current_status.completed_at = "2026-03-27T10:22:52Z"

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_abc123",
                    action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                ),
            ],
        )

        assert builder.current_status.completed_at == ""

    def test_no_completed_at_stays_unset(self):
        tc = _make_tool_call()
        builder = _make_builder_with_decisions([tc])
        builder.current_status.completed_at = ""

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        reconciler.reconcile(
            approval_decisions=[
                SubmitApprovalInput(
                    agent_execution_id="test_exec",
                    tool_call_id="call_abc123",
                    action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                ),
            ],
        )

        assert builder.current_status.completed_at == ""


# =============================================================================
# Fingerprint dedup via messages
# =============================================================================


class TestFingerprintDedup:
    def test_fingerprint_dedup_from_messages(self):
        args = Struct()
        args.update({"key": "value"})
        tc = ToolCall(
            id="call_original",
            name="apply_mcp_server",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        status = _status_with_tool_calls(tc)
        builder = StatusBuilder("exec-fp-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        fingerprint = builder._get_tool_fingerprint(
            "apply_mcp_server", {"key": "value"},
        )
        assert fingerprint in builder.tool_call_fingerprints
        assert builder._fingerprint_to_tool_call_id.get(fingerprint) == "call_original"

    def test_sub_agent_tool_call_fingerprint(self):
        args = Struct()
        args.update({"path": "/tmp/output.txt"})
        sa_tc = ToolCall(
            id="sa-tc-001",
            name="write_file",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        sa = SubAgentExecution(id="sub-agent-run-1", name="code_editor")
        msg = sa.messages.add()
        msg.type = MessageType.MESSAGE_AI
        msg.tool_calls.append(sa_tc)

        status = AgentExecutionStatus()
        status.sub_agent_executions.append(sa)

        builder = StatusBuilder("exec-fp-sub-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        fingerprint = builder._get_tool_fingerprint(
            "write_file", {"path": "/tmp/output.txt"},
        )
        assert fingerprint in builder.tool_call_fingerprints
        assert builder._fingerprint_to_tool_call_id.get(fingerprint) == "sa-tc-001"


# =============================================================================
# Index rebuild on resume
# =============================================================================


class TestIndexRebuildOnResume:
    def test_index_populated_from_existing_messages(self):
        tc = ToolCall(
            id="call_existing",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        status = _status_with_tool_calls(tc)
        builder = StatusBuilder("exec-idx-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        assert builder.get_tool_call("call_existing") is not None
        assert builder.get_tool_call("call_existing").name == "read_file"
        assert builder.tool_call_count() == 1

    def test_mutations_via_index_propagate_to_message(self):
        tc = ToolCall(
            id="call_mut",
            name="write_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        )

        status = _status_with_tool_calls(tc)
        builder = StatusBuilder("exec-mut-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        ref = builder.get_tool_call("call_mut")
        ref.status = ToolCallStatus.TOOL_CALL_RUNNING
        ref.result = "done"

        msg_tc = status.messages[0].tool_calls[0]
        assert msg_tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert msg_tc.result == "done"


# =============================================================================
# Pending approvals snapshot for Temporal coordination
# =============================================================================


class TestBuildPendingApprovalsSnapshot:
    """Verify the point-in-time snapshot used for Temporal signal counting.

    This snapshot is populated in post_stream.py and returned via the slim
    status to the Go workflow.  It must match the same filter criteria as
    Go's ComputePendingApprovals: WAITING_APPROVAL + requires_approval +
    approval_action == UNSPECIFIED.
    """

    def test_snapshot_includes_waiting_approval_tools(self):
        tc = ToolCall(
            id="call_1",
            name="delete_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        builder = _make_builder_with_decisions([tc])

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 1
        assert snapshot[0].tool_call_id == "call_1"

    def test_snapshot_excludes_tools_with_decision_recorded(self):
        tc = ToolCall(
            id="call_1",
            name="delete_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        builder = _make_builder_with_decisions([tc])

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 0

    def test_snapshot_excludes_completed_tools(self):
        tc = ToolCall(
            id="call_1",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
            requires_approval=False,
        )
        builder = _make_builder_with_decisions([tc])

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 0

    def test_snapshot_excludes_tools_not_requiring_approval(self):
        tc = ToolCall(
            id="call_1",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=False,
        )
        builder = _make_builder_with_decisions([tc])

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 0

    def test_snapshot_batch_returns_all_pending(self):
        tc1 = ToolCall(
            id="call_1",
            name="delete_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        tc2 = ToolCall(
            id="call_2",
            name="write_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        tc3 = ToolCall(
            id="call_3",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
            requires_approval=False,
        )
        builder = _make_builder_with_decisions([tc1, tc2, tc3])

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 2
        ids = {pa.tool_call_id for pa in snapshot}
        assert ids == {"call_1", "call_2"}

    def test_snapshot_empty_when_no_tool_calls(self):
        status = AgentExecutionStatus()
        builder = StatusBuilder("test_exec", status)

        snapshot = builder.build_pending_approvals_snapshot()

        assert len(snapshot) == 0


# =============================================================================
# slim_status_for_temporal: snapshot preservation
# =============================================================================


class TestSlimStatusPreservesSnapshot:
    """Verify that slim_status_for_temporal copies pending_approvals
    from the full status, ensuring the Temporal workflow receives the
    snapshot built by build_pending_approvals_snapshot().
    """

    def test_slim_status_carries_pending_approvals(self):
        tc1 = ToolCall(
            id="call_1",
            name="delete_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        tc2 = ToolCall(
            id="call_2",
            name="write_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        builder = _make_builder_with_decisions([tc1, tc2])

        snapshot = builder.build_pending_approvals_snapshot()
        del builder.current_status.pending_approvals[:]
        builder.current_status.pending_approvals.extend(snapshot)

        slim = slim_status_for_temporal(builder.current_status)

        assert len(slim.pending_approvals) == 2
        ids = {pa.tool_call_id for pa in slim.pending_approvals}
        assert ids == {"call_1", "call_2"}

    def test_slim_status_empty_when_no_pending(self):
        status = AgentExecutionStatus()
        slim = slim_status_for_temporal(status)

        assert len(slim.pending_approvals) == 0


# =============================================================================
# FIFO queue drain: stale entries after fingerprint dedup
# =============================================================================


class TestFifoQueueDrainOnFingerprintDedup:
    """Verify that the FIFO fallback queue (_reconciled_resume_tool_calls)
    is drained when fingerprint dedup handles a resumed tool call.

    Without the drain, stale FIFO entries capture genuinely new tool calls
    with the same tool name, preventing the StatusBuilder from creating a
    new ToolCall entry and from transitioning the phase to
    WAITING_FOR_APPROVAL.
    """

    @pytest.mark.asyncio
    async def test_fifo_drained_when_fingerprint_dedup_matches(self):
        """Fingerprint dedup for resumed tools should remove the matched
        entry from the FIFO queue so it can't capture new tool calls."""
        args = Struct()
        args.update({"command": "find /workspace -name '*.yaml'"})
        tc = ToolCall(
            id="tc_1",
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            requires_approval=True,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )

        status = _status_with_tool_calls(tc)
        builder = StatusBuilder("test_exec", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        builder._reconciled_resume_tool_calls["execute"] = deque(["tc_1"])

        event = {
            "event": "on_tool_start",
            "name": "execute",
            "run_id": "new-run-001",
            "data": {"input": {"command": "find /workspace -name '*.yaml'"}},
        }
        await builder.process_event(event)

        assert builder._run_id_aliases.get("new-run-001") == "tc_1"
        queue = builder._reconciled_resume_tool_calls.get("execute")
        assert queue is not None
        assert len(queue) == 0

    @pytest.mark.asyncio
    async def test_new_tool_not_captured_by_stale_fifo_after_resume(self):
        """After 3 resumed tools are deduped by fingerprint, a genuinely new
        tool call with the same name must NOT be aliased to an old entry."""
        tc_ids = ["tc_1", "tc_2", "tc_3"]
        commands = [
            "find /workspace -name '*.yaml'",
            "find /workspace -name '*.py'",
            "find /workspace -type f | head -40",
        ]

        status = AgentExecutionStatus()
        msg = status.messages.add()
        msg.type = MessageType.MESSAGE_AI
        for tc_id, cmd in zip(tc_ids, commands):
            args = Struct()
            args.update({"command": cmd})
            msg.tool_calls.append(ToolCall(
                id=tc_id,
                name="execute",
                args=args,
                status=ToolCallStatus.TOOL_CALL_RUNNING,
                requires_approval=True,
                approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ))

        builder = StatusBuilder("test_exec", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        builder._reconciled_resume_tool_calls["execute"] = deque(tc_ids)

        for tc_id, cmd in zip(tc_ids, commands):
            event = {
                "event": "on_tool_start",
                "name": "execute",
                "run_id": f"resumed-{tc_id}",
                "data": {"input": {"command": cmd}},
            }
            await builder.process_event(event)

        queue = builder._reconciled_resume_tool_calls.get("execute")
        assert len(queue) == 0, (
            f"FIFO queue should be empty after fingerprint dedup, "
            f"but has {len(queue)} entries: {list(queue)}"
        )

        new_run_id = "brand-new-run-999"
        new_event = {
            "event": "on_tool_start",
            "name": "execute",
            "run_id": new_run_id,
            "data": {"input": {"command": "ls /home/workspace/new-dir"}},
        }
        await builder.process_event(new_event)

        assert new_run_id not in builder._run_id_aliases, (
            f"New tool call should NOT be aliased to an old entry, "
            f"but was aliased to {builder._run_id_aliases.get(new_run_id)}"
        )


# =============================================================================
# Proxy interrupt round-trip: InterruptProxy -> resume matching
# =============================================================================


class _MockInterrupt:
    """Minimal stand-in for a LangGraph interrupt object."""

    def __init__(self, *, id: str, value: object) -> None:  # noqa: A002
        self.id = id
        self.value = value


class TestProxyInterruptResume:
    """Contract tests between InterruptProxyRunnable._build_proxy_payload
    and the resume matching loop in execute_graphton.py.

    The proxy wraps sub-agent interrupts into a nested dict.  The resume
    loop must detect the proxy shape and build a nested resume dict that
    InterruptProxyRunnable passes through as Command(resume=decisions)
    to the sub-agent graph.
    """

    @staticmethod
    def _action_map() -> dict[int, str]:
        return {
            ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
            ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
            ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
        }

    @staticmethod
    def _run_matching(
        interrupts: list[_MockInterrupt],
        decisions: list[SubmitApprovalInput],
    ) -> dict:
        """Replicate the matching loop from execute_graphton.py."""
        from worker.activities.execute_graphton import _build_decision_value

        action_map = TestProxyInterruptResume._action_map()
        decisions_by_tc = {d.tool_call_id: d for d in decisions}
        resume_dict: dict = {}

        for intr in interrupts:
            intr_value = intr.value if isinstance(intr.value, dict) else {}

            direct_tc_id = intr_value.get("tool_call_id", "")
            if direct_tc_id:
                decision = decisions_by_tc.get(direct_tc_id)
                if decision:
                    resume_dict[intr.id] = _build_decision_value(
                        decision, action_map,
                    )
                continue

            sub_decisions: dict = {}
            for sub_id, sub_value in intr_value.items():
                if not isinstance(sub_value, dict):
                    continue
                if "_proxy_interrupt_id" not in sub_value:
                    continue
                sub_tc_id = sub_value.get("tool_call_id", "")
                if not sub_tc_id:
                    continue
                decision = decisions_by_tc.get(sub_tc_id)
                if decision:
                    sub_decisions[sub_id] = _build_decision_value(
                        decision, action_map,
                    )
            if sub_decisions:
                resume_dict[intr.id] = sub_decisions

        return resume_dict

    def test_direct_interrupt_matches(self):
        """Direct interrupt (main-agent tool) matches on top-level tool_call_id."""
        interrupts = [
            _MockInterrupt(
                id="intr-1",
                value={"tool_call_id": "tc_abc", "message": "Delete file?"},
            ),
        ]
        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_abc",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result = self._run_matching(interrupts, decisions)

        assert result == {"intr-1": {"action": "approve"}}

    def test_proxy_interrupt_matches(self):
        """Proxied sub-agent interrupts match on nested tool_call_id."""
        from graphton.core.interrupt_proxy import InterruptProxyRunnable

        sub_interrupts = [
            _MockInterrupt(
                id="sub-intr-a",
                value={"tool_call_id": "tc_xyz", "message": "git clone?"},
            ),
            _MockInterrupt(
                id="sub-intr-b",
                value={"tool_call_id": "tc_123", "message": "rm -rf?"},
            ),
        ]
        proxy_payload = InterruptProxyRunnable._build_proxy_payload(
            sub_interrupts,
        )

        parent_interrupt = _MockInterrupt(id="parent-intr-1", value=proxy_payload)

        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_xyz",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
            SubmitApprovalInput(
                tool_call_id="tc_123",
                action=ApprovalAction.APPROVAL_ACTION_SKIP,
            ),
        ]

        result = self._run_matching([parent_interrupt], decisions)

        assert "parent-intr-1" in result
        nested = result["parent-intr-1"]
        assert isinstance(nested, dict)
        assert nested["sub-intr-a"] == {"action": "approve"}
        assert nested["sub-intr-b"] == {"action": "skip"}

    def test_proxy_partial_decisions(self):
        """Only sub-interrupts with matching decisions appear in the resume dict."""
        from graphton.core.interrupt_proxy import InterruptProxyRunnable

        sub_interrupts = [
            _MockInterrupt(
                id="sub-a",
                value={"tool_call_id": "tc_1", "message": "cmd 1"},
            ),
            _MockInterrupt(
                id="sub-b",
                value={"tool_call_id": "tc_2", "message": "cmd 2"},
            ),
        ]
        proxy_payload = InterruptProxyRunnable._build_proxy_payload(sub_interrupts)
        parent = _MockInterrupt(id="p-1", value=proxy_payload)

        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_1",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result = self._run_matching([parent], decisions)

        nested = result["p-1"]
        assert "sub-a" in nested
        assert "sub-b" not in nested

    def test_mixed_direct_and_proxy(self):
        """Both direct and proxy interrupts in the same checkpoint are handled."""
        from graphton.core.interrupt_proxy import InterruptProxyRunnable

        sub_interrupts = [
            _MockInterrupt(
                id="sub-x",
                value={"tool_call_id": "tc_sub", "message": "sub tool"},
            ),
        ]
        proxy_payload = InterruptProxyRunnable._build_proxy_payload(sub_interrupts)

        interrupts = [
            _MockInterrupt(
                id="direct-1",
                value={"tool_call_id": "tc_main", "message": "main tool"},
            ),
            _MockInterrupt(id="proxy-1", value=proxy_payload),
        ]

        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_main",
                action=ApprovalAction.APPROVAL_ACTION_REJECT,
            ),
            SubmitApprovalInput(
                tool_call_id="tc_sub",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result = self._run_matching(interrupts, decisions)

        assert result["direct-1"] == {"action": "reject"}
        assert result["proxy-1"]["sub-x"] == {"action": "approve"}

    def test_no_match_returns_empty(self):
        """When no interrupt matches any decision, resume_dict is empty."""
        interrupts = [
            _MockInterrupt(
                id="intr-1",
                value={"tool_call_id": "tc_unrelated", "message": "..."},
            ),
        ]
        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_nonexistent",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result = self._run_matching(interrupts, decisions)

        assert result == {}

    def test_proxy_payload_structure(self):
        """_build_proxy_payload preserves tool_call_id and adds _proxy_interrupt_id."""
        from graphton.core.interrupt_proxy import InterruptProxyRunnable

        sub_interrupts = [
            _MockInterrupt(
                id="si-1",
                value={"tool_call_id": "tc_hello", "message": "hello"},
            ),
        ]
        payload = InterruptProxyRunnable._build_proxy_payload(sub_interrupts)

        assert "si-1" in payload
        entry = payload["si-1"]
        assert entry["tool_call_id"] == "tc_hello"
        assert entry["message"] == "hello"
        assert entry["_proxy_interrupt_id"] == "si-1"

    def test_summarize_direct(self):
        """_summarize_resume_entry formats direct decisions correctly."""
        from worker.activities.execute_graphton import _summarize_resume_entry

        result = _summarize_resume_entry("abcd1234efgh5678", {"action": "approve"})
        assert "action=approve" in result

    def test_summarize_proxy(self):
        """_summarize_resume_entry formats proxy payloads correctly."""
        from worker.activities.execute_graphton import _summarize_resume_entry

        result = _summarize_resume_entry(
            "parent-id-123456",
            {"sub-a": {"action": "approve"}, "sub-b": {"action": "skip"}},
        )
        assert "proxy" in result
        assert "2 sub-decision" in result


# =============================================================================
# Task tool early-TC reconciliation on resume
# =============================================================================


class TestTaskToolResumeReconciliation:
    """Verify that task tool calls from prior cycles are correctly reconciled
    on the resume path.

    The root cause of the sub-agent HITL stuck loop was that
    ``_create_early_tool_call`` skipped creation for replayed tool_use blocks
    (they already exist) but did NOT re-queue them for reconciliation.  This
    caused ``_handle_tool_start_event``'s task handler to fall through to the
    ``run_id`` fallback, producing UUID-format IDs that diverge from the
    ``InjectedToolCallId`` in the interrupt payload.
    """

    @pytest.mark.asyncio
    async def test_replayed_task_tool_use_re_queued_for_reconciliation(self):
        """A replayed task tool_use block re-queues the existing TC so that
        on_tool_start can reconcile it and produce the correct Anthropic ID."""
        args = Struct()
        args.update({"description": "research deployment", "subagent_type": "generalPurpose"})
        tc = ToolCall(
            id="toolu_AAA",
            name="task",
            args=args,
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        sa = SubAgentExecution(id="toolu_AAA", name="generalPurpose")
        builder = _make_builder_with_decisions([tc], sub_agents=[sa])

        assert len(builder._early_tool_call_queue) == 0

        _simulate_tool_use_stream(builder, "task", "toolu_AAA")

        assert len(builder._early_tool_call_queue) == 1
        temp_id, sa_id = builder._early_tool_call_queue[0]
        assert temp_id == "toolu_AAA"

    @pytest.mark.asyncio
    async def test_task_on_tool_start_reconciles_with_re_queued_entry(self):
        """After the re-queue, on_tool_start for the replayed task reconciles
        to the existing Anthropic ID instead of falling back to run_id."""
        args = Struct()
        args.update({"description": "research patterns", "subagent_type": "generalPurpose"})
        tc = ToolCall(
            id="toolu_BBB",
            name="task",
            args=args,
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        sa = SubAgentExecution(id="toolu_BBB", name="generalPurpose")
        builder = _make_builder_with_decisions([tc], sub_agents=[sa])

        _simulate_tool_use_stream(builder, "task", "toolu_BBB")

        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "019d-uuid-new-run",
            "data": {"input": {"description": "research patterns", "subagent_type": "generalPurpose"}},
        }
        await builder.process_event(event)

        assert builder._run_id_aliases.get("019d-uuid-new-run") == "toolu_BBB"
        assert len(builder._early_tool_call_queue) == 0

    @pytest.mark.asyncio
    async def test_parallel_task_tools_reconcile_independently(self):
        """Two parallel task tool_use blocks in the same stream response
        each get their own queue entry and reconcile correctly."""
        args_a = Struct()
        args_a.update({"description": "task A", "subagent_type": "generalPurpose"})
        args_b = Struct()
        args_b.update({"description": "task B", "subagent_type": "generalPurpose"})

        tc_a = ToolCall(id="toolu_CCC", name="task", args=args_a, status=ToolCallStatus.TOOL_CALL_COMPLETED)
        tc_b = ToolCall(id="toolu_DDD", name="task", args=args_b, status=ToolCallStatus.TOOL_CALL_COMPLETED)

        sa_a = SubAgentExecution(id="toolu_CCC", name="generalPurpose")
        sa_b = SubAgentExecution(id="toolu_DDD", name="generalPurpose")
        builder = _make_builder_with_decisions([tc_a, tc_b], sub_agents=[sa_a, sa_b])

        _simulate_tool_use_stream(builder, "task", "toolu_CCC")
        _simulate_tool_use_stream(builder, "task", "toolu_DDD")

        assert len(builder._early_tool_call_queue) == 2

        event_a = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "run-uuid-1",
            "data": {"input": {"description": "task A", "subagent_type": "generalPurpose"}},
        }
        event_b = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "run-uuid-2",
            "data": {"input": {"description": "task B", "subagent_type": "generalPurpose"}},
        }

        await builder.process_event(event_a)
        await builder.process_event(event_b)

        assert builder._run_id_aliases.get("run-uuid-1") == "toolu_CCC"
        assert builder._run_id_aliases.get("run-uuid-2") == "toolu_DDD"
        assert len(builder._early_tool_call_queue) == 0

    @pytest.mark.asyncio
    async def test_fingerprint_dedup_does_not_block_task_handler(self):
        """Even if the fingerprint matches a prior-cycle task tool, the task
        handler must still run so sub-agent lifecycle is managed."""
        args = Struct()
        args.update({"description": "deploy service", "subagent_type": "generalPurpose"})
        tc = ToolCall(
            id="toolu_EEE",
            name="task",
            args=args,
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        sa = SubAgentExecution(id="toolu_EEE", name="generalPurpose")
        builder = _make_builder_with_decisions([tc], sub_agents=[sa])

        _simulate_tool_use_stream(builder, "task", "toolu_EEE")

        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "new-task-run-id",
            "data": {"input": {"description": "deploy service", "subagent_type": "generalPurpose"}},
        }
        await builder.process_event(event)

        assert builder._run_id_aliases.get("new-task-run-id") == "toolu_EEE"
        assert "new-task-run-id" in builder._run_id_to_tool_call_id


# =============================================================================
# Bidirectional ID lookup: defense-in-depth resume matching
# =============================================================================


class TestBidirectionalIdLookup:
    """Contract tests for the defense-in-depth bidirectional ID lookup in
    execute_graphton.py's resume matching.

    When the status ToolCall carries a UUID-format ID (from the run_id
    fallback) but the interrupt payload carries the Anthropic toolu_* ID,
    the primary ``decisions_by_tc.get(sub_tc_id)`` lookup fails.  The
    bidirectional fallback pairs unmatched decisions with unmatched
    interrupts.
    """

    @staticmethod
    def _run_matching_with_fallback(
        interrupts: list[_MockInterrupt],
        decisions: list[SubmitApprovalInput],
    ) -> tuple[dict, set[str]]:
        """Replicate the full matching loop including bidirectional fallback."""
        from worker.activities.execute_graphton import _build_decision_value

        action_map = {
            ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
            ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
            ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
        }
        decisions_by_tc = {d.tool_call_id: d for d in decisions}
        resume_dict: dict = {}
        matched: set[str] = set()

        for intr in interrupts:
            intr_value = intr.value if isinstance(intr.value, dict) else {}
            direct_tc_id = intr_value.get("tool_call_id", "")
            if direct_tc_id:
                decision = decisions_by_tc.get(direct_tc_id)
                if decision:
                    resume_dict[intr.id] = _build_decision_value(decision, action_map)
                    matched.add(direct_tc_id)
                continue
            sub_decisions: dict = {}
            for sub_id, sub_value in intr_value.items():
                if not isinstance(sub_value, dict):
                    continue
                if "_proxy_interrupt_id" not in sub_value:
                    continue
                sub_tc_id = sub_value.get("tool_call_id", "")
                if not sub_tc_id:
                    continue
                decision = decisions_by_tc.get(sub_tc_id)
                if decision:
                    sub_decisions[sub_id] = _build_decision_value(decision, action_map)
                    matched.add(sub_tc_id)
            if sub_decisions:
                resume_dict[intr.id] = sub_decisions

        # Bidirectional fallback
        unmatched = set(decisions_by_tc) - matched
        if unmatched:
            intr_tc_to_parent: dict[str, tuple[Any, str, str]] = {}
            for intr in interrupts:
                if intr.id in resume_dict:
                    continue
                intr_value = intr.value if isinstance(intr.value, dict) else {}
                direct_tc_id = intr_value.get("tool_call_id", "")
                if direct_tc_id and direct_tc_id not in matched:
                    intr_tc_to_parent[direct_tc_id] = (intr, "direct", "")
                for sub_id, sub_value in intr_value.items():
                    if not isinstance(sub_value, dict):
                        continue
                    if "_proxy_interrupt_id" not in sub_value:
                        continue
                    sub_tc_id = sub_value.get("tool_call_id", "")
                    if sub_tc_id and sub_tc_id not in matched:
                        intr_tc_to_parent[sub_tc_id] = (intr, "proxy", sub_id)

            for um_tc_id in list(unmatched):
                decision = decisions_by_tc[um_tc_id]
                for intr_tc_id, (intr, shape, sub_id) in intr_tc_to_parent.items():
                    if intr.id in resume_dict and shape == "direct":
                        continue
                    if shape == "direct":
                        resume_dict[intr.id] = _build_decision_value(decision, action_map)
                        matched.add(um_tc_id)
                        del intr_tc_to_parent[intr_tc_id]
                        break
                    if shape == "proxy":
                        existing = resume_dict.get(intr.id, {})
                        existing[sub_id] = _build_decision_value(decision, action_map)
                        resume_dict[intr.id] = existing
                        matched.add(um_tc_id)
                        del intr_tc_to_parent[intr_tc_id]
                        break

        return resume_dict, matched

    def test_direct_mismatch_resolved_by_fallback(self):
        """Decision with UUID tool_call_id paired with interrupt's toolu_* ID."""
        interrupts = [
            _MockInterrupt(
                id="intr-1",
                value={"tool_call_id": "toolu_real_id", "message": "Execute?"},
            ),
        ]
        decisions = [
            SubmitApprovalInput(
                tool_call_id="019d-uuid-from-status",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result, matched = self._run_matching_with_fallback(interrupts, decisions)

        assert "intr-1" in result
        assert result["intr-1"] == {"action": "approve"}
        assert "019d-uuid-from-status" in matched

    def test_proxy_mismatch_resolved_by_fallback(self):
        """Proxy sub-interrupt with UUID decision ID matched to toolu_* interrupt."""
        from graphton.core.interrupt_proxy import InterruptProxyRunnable

        sub_interrupts = [
            _MockInterrupt(
                id="sub-1",
                value={"tool_call_id": "toolu_sub_real", "message": "Run cmd?"},
            ),
        ]
        proxy_payload = InterruptProxyRunnable._build_proxy_payload(sub_interrupts)
        parent = _MockInterrupt(id="p-1", value=proxy_payload)

        decisions = [
            SubmitApprovalInput(
                tool_call_id="019d-uuid-sub",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result, matched = self._run_matching_with_fallback([parent], decisions)

        assert "p-1" in result
        assert result["p-1"]["sub-1"] == {"action": "approve"}
        assert "019d-uuid-sub" in matched

    def test_no_fallback_needed_when_ids_match(self):
        """When IDs match normally, fallback is not triggered."""
        interrupts = [
            _MockInterrupt(
                id="intr-1",
                value={"tool_call_id": "toolu_match", "message": "OK?"},
            ),
        ]
        decisions = [
            SubmitApprovalInput(
                tool_call_id="toolu_match",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result, matched = self._run_matching_with_fallback(interrupts, decisions)

        assert result == {"intr-1": {"action": "approve"}}
        assert matched == {"toolu_match"}

    def test_empty_resume_dict_when_no_interrupts(self):
        """When there are no interrupts at all, resume_dict is empty."""
        decisions = [
            SubmitApprovalInput(
                tool_call_id="orphan",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result, matched = self._run_matching_with_fallback([], decisions)

        assert result == {}
        assert matched == set()


# =============================================================================
# Helpers
# =============================================================================


def _simulate_tool_use_stream(
    builder: StatusBuilder, tool_name: str, tool_use_id: str,
) -> None:
    """Simulate a streaming tool_use block arriving via on_chat_model_stream.

    Calls ``_create_early_tool_call`` directly, which is the code path
    exercised when a tool_use block appears in the LLM streaming response.
    """
    builder._create_early_tool_call(
        tool_name=tool_name,
        tool_use_id=tool_use_id,
        ns_key="",
        namespace="",
    )
