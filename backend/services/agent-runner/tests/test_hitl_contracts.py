"""Contract tests for the HITL approval flow.

Tests cover:
  - ResumeReconciler: tool call transitions, auto-skip, stale completed_at
  - Index rebuild on resume: rebuild_index_from_persisted_status
  - slim_status_for_temporal: phase-only slim copy
  - Task tool early-TC reconciliation on resume path
  - Checkpoint orphan reconciliation: reconcile_orphans_against_checkpoint
"""

import logging
from typing import Any

import pytest
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    MessageType,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from google.protobuf.struct_pb2 import Struct

from stigmer_runner.worker.activities.graphton.hitl import (
    ResumeReconciler,
    extract_approval_decisions_from_execution,
    extract_interrupt_tool_call_ids,
)
from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder
from stigmer_runner.worker.activities.graphton.temporal_helpers import slim_status_for_temporal


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
    builder.rebuild_index_from_persisted_status()
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
        builder.rebuild_index_from_persisted_status()

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
        builder.rebuild_index_from_persisted_status()

        ref = builder.get_tool_call("call_mut")
        ref.status = ToolCallStatus.TOOL_CALL_RUNNING
        ref.result = "done"

        msg_tc = status.messages[0].tool_calls[0]
        assert msg_tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert msg_tc.result == "done"


# =============================================================================
# slim_status_for_temporal: phase-only slim copy
# =============================================================================


class TestSlimStatusPhaseOnly:
    """Verify that slim_status_for_temporal carries only workflow-critical
    fields (phase, error, timestamps).  pending_approvals is intentionally
    omitted — the Go/Java workflow reads it from the DB via loadExecution().
    """

    def test_slim_status_carries_phase_and_timestamps(self):
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase

        status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
            started_at="2026-03-29T00:00:00Z",
        )
        slim = slim_status_for_temporal(status)

        assert slim.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        assert slim.started_at == "2026-03-29T00:00:00Z"

    def test_slim_status_omits_pending_approvals(self):
        from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval

        status = AgentExecutionStatus()
        status.pending_approvals.append(
            PendingApproval(tool_call_id="call_1"),
        )

        slim = slim_status_for_temporal(status)

        assert len(slim.pending_approvals) == 0


# =============================================================================
# Direct interrupt round-trip: resume matching
# =============================================================================


class _MockInterrupt:
    """Minimal stand-in for a LangGraph interrupt object."""

    def __init__(self, *, id: str, value: object) -> None:  # noqa: A002
        self.id = id
        self.value = value


class TestDirectInterruptResume:
    """Contract tests for the direct interrupt shape used by both root-agent
    and sub-agent tools (via LangGraph native per-invocation mode).

    All interrupts have the same shape:
        intr.value = {"tool_call_id": "tc_abc", "message": "..."}
        resume_dict[intr.id] = {"action": "approve"}
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
        from stigmer_runner.worker.activities.execute_graphton import _build_decision_value

        action_map = TestDirectInterruptResume._action_map()
        decisions_by_tc = {d.tool_call_id: d for d in decisions}
        resume_dict: dict = {}

        for intr in interrupts:
            intr_value = intr.value if isinstance(intr.value, dict) else {}
            tc_id = intr_value.get("tool_call_id", "")
            if tc_id:
                decision = decisions_by_tc.get(tc_id)
                if decision:
                    resume_dict[intr.id] = _build_decision_value(
                        decision, action_map,
                    )

        return resume_dict

    def test_direct_interrupt_matches(self):
        """Direct interrupt matches on top-level tool_call_id."""
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

    def test_multiple_interrupts_match(self):
        """Multiple direct interrupts (root + sub-agent) all match correctly."""
        interrupts = [
            _MockInterrupt(
                id="intr-root",
                value={"tool_call_id": "tc_main", "message": "main tool"},
            ),
            _MockInterrupt(
                id="intr-sub",
                value={"tool_call_id": "tc_sub", "message": "sub tool"},
            ),
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

        assert result["intr-root"] == {"action": "reject"}
        assert result["intr-sub"] == {"action": "approve"}

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

    def test_partial_decisions(self):
        """Only interrupts with matching decisions appear in the resume dict."""
        interrupts = [
            _MockInterrupt(
                id="intr-1",
                value={"tool_call_id": "tc_1", "message": "cmd 1"},
            ),
            _MockInterrupt(
                id="intr-2",
                value={"tool_call_id": "tc_2", "message": "cmd 2"},
            ),
        ]
        decisions = [
            SubmitApprovalInput(
                tool_call_id="tc_1",
                action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            ),
        ]

        result = self._run_matching(interrupts, decisions)

        assert "intr-1" in result
        assert "intr-2" not in result

    def test_summarize_direct(self):
        """_summarize_resume_entry formats direct decisions correctly."""
        from stigmer_runner.worker.activities.execute_graphton import _summarize_resume_entry

        result = _summarize_resume_entry("abcd1234efgh5678", {"action": "approve"})
        assert "action=approve" in result


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

        assert len(builder.state.early_tool_call_queue) == 0

        _simulate_tool_use_stream(builder, "task", "toolu_AAA")

        assert len(builder.state.early_tool_call_queue) == 1
        temp_id, sa_id = builder.state.early_tool_call_queue[0]
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

        assert builder.resolve_run_id("019d-uuid-new-run") == "toolu_BBB"
        assert len(builder.state.early_tool_call_queue) == 0

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

        assert len(builder.state.early_tool_call_queue) == 2

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

        assert builder.resolve_run_id("run-uuid-1") == "toolu_CCC"
        assert builder.resolve_run_id("run-uuid-2") == "toolu_DDD"
        assert len(builder.state.early_tool_call_queue) == 0

    @pytest.mark.asyncio
    async def test_identity_dedup_does_not_block_task_handler(self):
        """Even if identity dedup detects a prior-cycle task tool, the task
        handler must still run so sub-agent lifecycle is managed."""
        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

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

        capture = ToolCallIdCapture()
        capture._run_id_to_tool_call_id["new-task-run-id"] = "toolu_EEE"
        builder._tool_call_id_capture = capture

        _simulate_tool_use_stream(builder, "task", "toolu_EEE")

        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "new-task-run-id",
            "data": {"input": {"description": "deploy service", "subagent_type": "generalPurpose"}},
        }
        await builder.process_event(event)

        assert builder.resolve_run_id("new-task-run-id") == "toolu_EEE"
        assert "new-task-run-id" in builder.state.run_id_to_tool_call_id

    # ─────────────────────────────────────────────────────────────────────────
    # No-AI-replay resume: prepare_task_tool_resume_queue
    #
    # These tests cover the scenario where astream_events does NOT replay
    # the AI message's tool_use blocks (the AI node was checkpointed, not
    # re-executed).  prepare_task_tool_resume_queue pre-populates the
    # _early_tool_call_queue from persisted status so that the existing
    # reconciliation machinery still works.
    # ─────────────────────────────────────────────────────────────────────────

    def test_prepare_task_tool_resume_queue_populates_queue(self):
        """prepare_task_tool_resume_queue() populates _early_tool_call_queue
        from persisted task tool calls with matching SubAgentExecutions."""
        args_a = Struct()
        args_a.update({"description": "research deployment", "subagent_type": "generalPurpose"})
        args_b = Struct()
        args_b.update({"description": "scan infra charts", "subagent_type": "explore"})

        tc_a = ToolCall(id="toolu_RQ1", name="task", args=args_a, status=ToolCallStatus.TOOL_CALL_COMPLETED)
        tc_b = ToolCall(id="toolu_RQ2", name="task", args=args_b, status=ToolCallStatus.TOOL_CALL_COMPLETED)

        sa_a = SubAgentExecution(id="toolu_RQ1", name="generalPurpose")
        sa_b = SubAgentExecution(id="toolu_RQ2", name="explore")
        builder = _make_builder_with_decisions([tc_a, tc_b], sub_agents=[sa_a, sa_b])

        assert len(builder.state.early_tool_call_queue) == 0

        queued = builder.prepare_task_tool_resume_queue()

        assert queued == 2
        assert len(builder.state.early_tool_call_queue) == 2
        assert builder.state.early_tool_call_queue[0] == ("toolu_RQ1", None)
        assert builder.state.early_tool_call_queue[1] == ("toolu_RQ2", None)

    @pytest.mark.asyncio
    async def test_task_on_tool_start_without_ai_replay_reactivates_subagent(self):
        """End-to-end: persisted status with 3 task tools + SubAgentExecutions.
        Call prepare_task_tool_resume_queue(), then fire on_tool_start events
        with new run_ids.  Existing SubAgentExecutions must be reactivated,
        not duplicated."""
        tool_calls = []
        sub_agents = []
        for i, (tc_id, desc, sa_type) in enumerate([
            ("toolu_SA1", "discover docs", "generalPurpose"),
            ("toolu_SA2", "find infra charts", "explore"),
            ("toolu_SA3", "scan API protos", "generalPurpose"),
        ]):
            args = Struct()
            args.update({"description": desc, "subagent_type": sa_type})
            tool_calls.append(ToolCall(
                id=tc_id, name="task", args=args,
                status=ToolCallStatus.TOOL_CALL_COMPLETED,
            ))
            sub_agents.append(SubAgentExecution(id=tc_id, name=sa_type))

        builder = _make_builder_with_decisions(tool_calls, sub_agents=sub_agents)
        builder.prepare_task_tool_resume_queue()

        for i, (tc_id, desc, sa_type) in enumerate([
            ("toolu_SA1", "discover docs", "generalPurpose"),
            ("toolu_SA2", "find infra charts", "explore"),
            ("toolu_SA3", "scan API protos", "generalPurpose"),
        ]):
            event = {
                "event": "on_tool_start",
                "name": "task",
                "run_id": f"new-run-uuid-{i}",
                "data": {"input": {"description": desc, "subagent_type": sa_type}},
            }
            await builder.process_event(event)

        assert len(builder.current_status.sub_agent_executions) == 3

        for i, tc_id in enumerate(["toolu_SA1", "toolu_SA2", "toolu_SA3"]):
            assert builder.resolve_run_id(f"new-run-uuid-{i}") == tc_id
            assert f"new-run-uuid-{i}" in builder.state.active_sub_agents

        assert len(builder.state.early_tool_call_queue) == 0

    def test_prepare_skips_task_tools_without_subagent(self):
        """Task tool calls without a corresponding SubAgentExecution are NOT
        queued — they may be genuinely new tasks not yet started."""
        args_with_sa = Struct()
        args_with_sa.update({"description": "has sub-agent", "subagent_type": "generalPurpose"})
        args_no_sa = Struct()
        args_no_sa.update({"description": "no sub-agent yet", "subagent_type": "explore"})

        tc_with = ToolCall(id="toolu_HAS", name="task", args=args_with_sa, status=ToolCallStatus.TOOL_CALL_COMPLETED)
        tc_without = ToolCall(id="toolu_NOSA", name="task", args=args_no_sa, status=ToolCallStatus.TOOL_CALL_RUNNING)

        sa = SubAgentExecution(id="toolu_HAS", name="generalPurpose")
        builder = _make_builder_with_decisions([tc_with, tc_without], sub_agents=[sa])

        queued = builder.prepare_task_tool_resume_queue()

        assert queued == 1
        assert len(builder.state.early_tool_call_queue) == 1
        assert builder.state.early_tool_call_queue[0] == ("toolu_HAS", None)

    @pytest.mark.asyncio
    async def test_prepare_is_idempotent_with_ai_replay(self):
        """If both prepare_task_tool_resume_queue() and _create_early_tool_call
        (via _simulate_tool_use_stream) run, reconciliation still works
        correctly without duplicate side effects."""
        args = Struct()
        args.update({"description": "deploy service", "subagent_type": "generalPurpose"})
        tc = ToolCall(id="toolu_IDEM", name="task", args=args, status=ToolCallStatus.TOOL_CALL_COMPLETED)
        sa = SubAgentExecution(id="toolu_IDEM", name="generalPurpose")
        builder = _make_builder_with_decisions([tc], sub_agents=[sa])

        queued = builder.prepare_task_tool_resume_queue()
        assert queued == 1

        _simulate_tool_use_stream(builder, "task", "toolu_IDEM")

        assert len(builder.state.early_tool_call_queue) == 2

        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "run-idem-uuid",
            "data": {"input": {"description": "deploy service", "subagent_type": "generalPurpose"}},
        }
        await builder.process_event(event)

        assert builder.resolve_run_id("run-idem-uuid") == "toolu_IDEM"
        assert len(builder.current_status.sub_agent_executions) == 1
        assert len(builder.state.early_tool_call_queue) == 1


# =============================================================================
# Sub-Agent Completion Cleanup
# =============================================================================


class TestSubAgentCompletionCleanup:
    """Verify _handle_sub_agent_end sweeps orphaned WAITING_APPROVAL tool calls.

    When a sub-agent completes, tool calls that were WAITING_APPROVAL but
    never received a decision remain in the StatusBuilder.
    _handle_sub_agent_end must transition these to SKIPPED so they do not
    leak into pending_approvals.
    """

    @staticmethod
    def _make_sub_agent_with_orphaned_tools() -> tuple[StatusBuilder, str]:
        """Build a StatusBuilder whose sub-agent has orphaned WAITING_APPROVAL TCs."""
        args = Struct()
        args.update({"command": "find / -name '*.proto'"})

        orphan_tc = ToolCall(
            id="toolu_orphan_1",
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
        )
        completed_tc = ToolCall(
            id="toolu_completed_1",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        sa = SubAgentExecution(id="toolu_task_1", name="general-purpose")
        msg = sa.messages.add()
        msg.type = MessageType.MESSAGE_AI
        msg.tool_calls.append(orphan_tc)
        msg.tool_calls.append(completed_tc)

        status = AgentExecutionStatus()
        parent_msg = status.messages.add()
        parent_msg.type = MessageType.MESSAGE_AI
        parent_tc = parent_msg.tool_calls.add()
        parent_tc.id = "toolu_task_1"
        parent_tc.name = "task"
        parent_tc.status = ToolCallStatus.TOOL_CALL_RUNNING

        status.sub_agent_executions.append(sa)

        builder = StatusBuilder("test_exec", status)
        builder.rebuild_index_from_persisted_status()

        run_id = "task-run-abc"
        sa_ref = builder.current_status.sub_agent_executions[0]
        builder.state.active_sub_agents[run_id] = sa_ref
        builder.state.run_id_to_tool_call_id[run_id] = "toolu_task_1"

        return builder, run_id

    def test_orphaned_waiting_approval_skipped_on_completion(self):
        """WAITING_APPROVAL TC with no decision -> SKIPPED when sub-agent completes."""
        builder, run_id = self._make_sub_agent_with_orphaned_tools()

        event = {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "Sub-agent finished all work"},
            "metadata": {},
        }
        builder._handle_sub_agent_end(event, run_id)

        sa = builder.current_status.sub_agent_executions[0]
        orphan = sa.messages[0].tool_calls[0]
        assert orphan.status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert orphan.approval_action == ApprovalAction.APPROVAL_ACTION_SKIP
        assert orphan.approval_decided_at != ""

    def test_completed_tool_calls_not_touched(self):
        """Already-completed TCs must not be altered by the sweep."""
        builder, run_id = self._make_sub_agent_with_orphaned_tools()

        event = {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {},
        }
        builder._handle_sub_agent_end(event, run_id)

        sa = builder.current_status.sub_agent_executions[0]
        completed = sa.messages[0].tool_calls[1]
        assert completed.status == ToolCallStatus.TOOL_CALL_COMPLETED

    def test_pending_approvals_clear_after_cleanup(self):
        """build_pending_approvals_snapshot must return empty after cleanup."""
        builder, run_id = self._make_sub_agent_with_orphaned_tools()

        before = builder.build_pending_approvals_snapshot()
        assert len(before) == 1

        event = {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {},
        }
        builder._handle_sub_agent_end(event, run_id)

        after = builder.build_pending_approvals_snapshot()
        assert len(after) == 0

    def test_cleanup_on_failure(self):
        """Orphaned TCs are also swept when sub-agent fails."""
        builder, run_id = self._make_sub_agent_with_orphaned_tools()

        event = {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": {"error": "timeout", "status": "failed"}},
            "metadata": {},
        }
        builder._handle_sub_agent_end(event, run_id)

        sa = builder.current_status.sub_agent_executions[0]
        assert sa.status == SubAgentStatus.SUB_AGENT_FAILED
        orphan = sa.messages[0].tool_calls[0]
        assert orphan.status == ToolCallStatus.TOOL_CALL_SKIPPED

    def test_already_decided_tool_call_not_overwritten(self):
        """If a TC has approval_action set (user approved), don't overwrite it."""
        builder, run_id = self._make_sub_agent_with_orphaned_tools()

        sa = builder.current_status.sub_agent_executions[0]
        tc = sa.messages[0].tool_calls[0]
        tc.approval_action = ApprovalAction.APPROVAL_ACTION_APPROVE

        event = {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {},
        }
        builder._handle_sub_agent_end(event, run_id)

        assert tc.approval_action == ApprovalAction.APPROVAL_ACTION_APPROVE
        assert tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL


# =============================================================================
# Interrupt-based snapshot: extract_interrupt_tool_call_ids / build_snapshot
# =============================================================================


class _FakeInterrupt:
    """Minimal stand-in for a LangGraph Interrupt object."""

    def __init__(self, interrupt_id: str, value: Any) -> None:
        self.id = interrupt_id
        self.value = value


class TestExtractInterruptToolCallIds:
    """Verify extract_interrupt_tool_call_ids handles direct + proxy shapes."""

    def test_direct_interrupt(self):
        interrupts = [
            _FakeInterrupt("intr-1", {"tool_call_id": "tc_direct_1"}),
            _FakeInterrupt("intr-2", {"tool_call_id": "tc_direct_2"}),
        ]
        result = extract_interrupt_tool_call_ids(interrupts)
        assert result == {"tc_direct_1", "tc_direct_2"}

    def test_sub_agent_interrupt_same_shape(self):
        """Sub-agent interrupts use the same direct shape as root-agent tools."""
        interrupts = [
            _FakeInterrupt("intr-sub-1", {"tool_call_id": "tc_sub_1", "message": "sub tool 1"}),
            _FakeInterrupt("intr-sub-2", {"tool_call_id": "tc_sub_2", "message": "sub tool 2"}),
        ]
        result = extract_interrupt_tool_call_ids(interrupts)
        assert result == {"tc_sub_1", "tc_sub_2"}

    def test_mixed_root_and_sub_agent(self):
        """Root and sub-agent interrupts are both direct shape."""
        interrupts = [
            _FakeInterrupt("intr-1", {"tool_call_id": "tc_direct"}),
            _FakeInterrupt("intr-2", {"tool_call_id": "tc_sub"}),
        ]
        result = extract_interrupt_tool_call_ids(interrupts)
        assert result == {"tc_direct", "tc_sub"}

    def test_empty_interrupts(self):
        assert extract_interrupt_tool_call_ids([]) == set()

    def test_non_dict_value_skipped(self):
        interrupts = [_FakeInterrupt("intr-1", "not-a-dict")]
        assert extract_interrupt_tool_call_ids(interrupts) == set()

    def test_missing_tool_call_id_skipped(self):
        interrupts = [_FakeInterrupt("intr-1", {"message": "no tc id"})]
        assert extract_interrupt_tool_call_ids(interrupts) == set()


# =============================================================================
# Checkpoint orphan reconciliation: reconcile_orphans_against_checkpoint
# =============================================================================


class TestReconcileOrphansAgainstCheckpoint:
    """Verify ResumeReconciler.reconcile_orphans_against_checkpoint behaviour."""

    def _make_builder_with_waiting_tools(
        self, *tc_ids: str,
    ) -> StatusBuilder:
        tool_calls = [
            _make_tool_call(tc_id=tc_id, name=f"tool_{tc_id}")
            for tc_id in tc_ids
        ]
        return _make_builder_with_decisions(tool_calls)

    def test_orphaned_tool_calls_skipped(self):
        """WAITING_APPROVAL TCs not in interrupts or decisions get SKIPPED."""
        builder = self._make_builder_with_waiting_tools(
            "tc_real", "tc_orphan",
        )
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids={"tc_real"},
            decision_tc_ids=set(),
        )
        assert skipped == 1
        orphan = builder.get_tool_call("tc_orphan")
        assert orphan.status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert orphan.approval_action == ApprovalAction.APPROVAL_ACTION_SKIP
        assert "no matching checkpoint interrupt" in orphan.result

    def test_tool_in_interrupt_set_not_skipped(self):
        """TCs present in the checkpoint interrupt set remain untouched."""
        builder = self._make_builder_with_waiting_tools("tc_real")
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids={"tc_real"},
            decision_tc_ids=set(),
        )
        assert skipped == 0
        tc = builder.get_tool_call("tc_real")
        assert tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL

    def test_tool_in_decision_set_not_skipped(self):
        """TCs that have an approval decision remain untouched."""
        builder = self._make_builder_with_waiting_tools("tc_decided")
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids=set(),
            decision_tc_ids={"tc_decided"},
        )
        assert skipped == 0
        tc = builder.get_tool_call("tc_decided")
        assert tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL

    def test_already_completed_tool_not_touched(self):
        """Non-WAITING_APPROVAL TCs are ignored regardless of interrupt set."""
        tc = _make_tool_call(
            tc_id="tc_done",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )
        builder = _make_builder_with_decisions([tc])
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids=set(),
            decision_tc_ids=set(),
        )
        assert skipped == 0
        assert builder.get_tool_call("tc_done").status == ToolCallStatus.TOOL_CALL_COMPLETED

    def test_already_decided_approval_not_overwritten(self):
        """WAITING_APPROVAL with existing approval_action is not overwritten."""
        tc = _make_tool_call(tc_id="tc_approved")
        tc.approval_action = ApprovalAction.APPROVAL_ACTION_APPROVE
        builder = _make_builder_with_decisions([tc])
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids=set(),
            decision_tc_ids=set(),
        )
        assert skipped == 0
        assert builder.get_tool_call("tc_approved").approval_action == ApprovalAction.APPROVAL_ACTION_APPROVE

    def test_mixed_real_and_orphaned(self):
        """Only orphaned TCs are skipped; real ones survive."""
        builder = self._make_builder_with_waiting_tools(
            "tc_real_1", "tc_real_2", "tc_orphan_1", "tc_orphan_2",
        )
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids={"tc_real_1", "tc_real_2"},
            decision_tc_ids=set(),
        )
        assert skipped == 2
        assert builder.get_tool_call("tc_real_1").status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        assert builder.get_tool_call("tc_real_2").status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        assert builder.get_tool_call("tc_orphan_1").status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert builder.get_tool_call("tc_orphan_2").status == ToolCallStatus.TOOL_CALL_SKIPPED

    def test_empty_everything_skips_nothing(self):
        """No tool calls at all → zero skipped."""
        builder = _make_builder_with_decisions([])
        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=builder,
            logger=_logger(),
        )
        skipped = reconciler.reconcile_orphans_against_checkpoint(
            interrupt_tc_ids=set(),
            decision_tc_ids=set(),
        )
        assert skipped == 0


# =============================================================================
# T03: extract_approval_decisions_from_execution (DB-driven resume)
# =============================================================================


class TestExtractApprovalDecisionsFromExecution:
    """Verify that approval decisions are correctly extracted from a DB-loaded
    AgentExecution's tool calls for the DB-driven resume path (T03).
    """

    @staticmethod
    def _make_execution(
        root_tool_calls: list[ToolCall] | None = None,
        sub_agent_tool_calls: list[ToolCall] | None = None,
    ):
        """Build a minimal AgentExecution-like proto with tool calls."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            AgentExecution,
        )

        execution = AgentExecution()
        if root_tool_calls:
            msg = execution.status.messages.add()
            msg.type = MessageType.MESSAGE_AI
            for tc in root_tool_calls:
                msg.tool_calls.append(tc)
        if sub_agent_tool_calls:
            sa = execution.status.sub_agent_executions.add()
            sa.name = "test-sub-agent"
            msg = sa.messages.add()
            msg.type = MessageType.MESSAGE_AI
            for tc in sub_agent_tool_calls:
                msg.tool_calls.append(tc)
        return execution

    def test_extracts_approved_tool_calls(self):
        tc = ToolCall(
            id="tc_1",
            name="delete_file",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user@example.com",
        )
        execution = self._make_execution(root_tool_calls=[tc])

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 1
        assert decisions[0].tool_call_id == "tc_1"
        assert decisions[0].action == ApprovalAction.APPROVAL_ACTION_APPROVE
        assert decisions[0].comment == "user@example.com"

    def test_extracts_rejected_tool_calls(self):
        tc = ToolCall(
            id="tc_reject",
            name="dangerous_tool",
            status=ToolCallStatus.TOOL_CALL_SKIPPED,
            approval_action=ApprovalAction.APPROVAL_ACTION_REJECT,
        )
        execution = self._make_execution(root_tool_calls=[tc])

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 1
        assert decisions[0].tool_call_id == "tc_reject"
        assert decisions[0].action == ApprovalAction.APPROVAL_ACTION_REJECT

    def test_skips_undecided_tool_calls(self):
        decided = ToolCall(
            id="tc_decided",
            name="write_file",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        undecided = ToolCall(
            id="tc_pending",
            name="read_file",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            approval_action=ApprovalAction.APPROVAL_ACTION_UNSPECIFIED,
        )
        execution = self._make_execution(root_tool_calls=[decided, undecided])

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 1
        assert decisions[0].tool_call_id == "tc_decided"

    def test_extracts_from_sub_agent_messages(self):
        sub_tc = ToolCall(
            id="tc_sub",
            name="execute",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        execution = self._make_execution(sub_agent_tool_calls=[sub_tc])

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 1
        assert decisions[0].tool_call_id == "tc_sub"

    def test_extracts_from_both_root_and_sub_agent(self):
        root_tc = ToolCall(
            id="tc_root",
            name="deploy",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        sub_tc = ToolCall(
            id="tc_sub",
            name="execute",
            status=ToolCallStatus.TOOL_CALL_SKIPPED,
            approval_action=ApprovalAction.APPROVAL_ACTION_SKIP,
        )
        execution = self._make_execution(
            root_tool_calls=[root_tc],
            sub_agent_tool_calls=[sub_tc],
        )

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 2
        ids = {d.tool_call_id for d in decisions}
        assert ids == {"tc_root", "tc_sub"}

    def test_empty_execution_returns_empty(self):
        execution = self._make_execution()

        decisions = extract_approval_decisions_from_execution(execution)

        assert decisions == []

    def test_empty_approved_by_becomes_empty_comment(self):
        tc = ToolCall(
            id="tc_1",
            name="tool",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        execution = self._make_execution(root_tool_calls=[tc])

        decisions = extract_approval_decisions_from_execution(execution)

        assert len(decisions) == 1
        assert decisions[0].comment == ""


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
