"""Contract tests for the HITL approval flow (post-T03 simplification).

Tests cover:
  - ResumeReconciler: tool call transitions, auto-skip, stale completed_at
  - Fingerprint dedup: via messages (not flat lists)
  - Index rebuild on resume: populate_fingerprints_from_existing_tool_calls
"""

import logging

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    MessageType,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    AgentMessage,
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from google.protobuf.struct_pb2 import Struct

from worker.activities.graphton.hitl import ResumeReconciler
from worker.activities.graphton.status_builder import StatusBuilder


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
