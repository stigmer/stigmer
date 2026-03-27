"""Cross-boundary contract tests for the HITL approval lifecycle.

These tests verify the data contracts between services:
  Python -> Go/Java: After INTERRUPT_CAPTURE, PendingApprovals have interrupt_id
                     and lifecycle_state == INTERRUPT_CAPTURED
  Go/Java -> Python: After RecordApprovalDecision, PendingApprovals are preserved
                     with lifecycle_state == DECISION_RECORDED
  Python -> Go/Java: After RESUME_RECONCILE, PendingApprovals are at
                     RESUME_RECONCILED (pruned by server-side merge logic)
  UI -> API:         When lifecycle_state < DECISION_RECORDED, approval is actionable;
                     when >= DECISION_RECORDED, approval is resolved

Each test constructs the minimal proto state that one service would produce
and asserts the invariants the consuming service depends on.
"""

from unittest.mock import MagicMock, patch

from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import (
    ApprovalLifecycleState,
    PendingApproval,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import ToolCall
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from ai.stigmer.agentic.agentexecution.v1.usage_pb2 import UsageMetrics
from google.protobuf.struct_pb2 import Struct

from worker.activities.graphton.hitl import (
    ApprovalStateManager,
    InterruptCapture,
    ResumeReconciler,
)
from worker.activities.graphton.status_builder import StatusBuilder

# =============================================================================
# Helpers
# =============================================================================


def _make_pending_approval(
    *,
    tool_call_id: str = "call_abc123",
    tool_name: str = "delete_file",
    interrupt_id: str = "",
    lifecycle_state: int = ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
    from_sub_agent: bool = False,
):
    return PendingApproval(
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        interrupt_id=interrupt_id,
        lifecycle_state=lifecycle_state,
        from_sub_agent=from_sub_agent,
        requested_at="2026-03-26T19:00:00Z",
    )


def _make_tool_call(
    *,
    tc_id: str = "call_abc123",
    name: str = "delete_file",
    status: int = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approval_action: int = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED,
):
    tc = MagicMock()
    tc.id = tc_id
    tc.name = name
    tc.status = status
    tc.approval_action = approval_action
    tc.approval_decided_at = ""
    tc.approved_by = ""
    tc.result = ""
    tc.is_streaming = False
    return tc


def _make_status_builder(
    *,
    pending_approvals=None,
    tool_calls=None,
    messages=None,
    sub_agent_executions=None,
):
    sb = MagicMock()
    sb.current_status.pending_approvals = list(pending_approvals or [])
    sb.current_status.tool_calls = list(tool_calls or [])
    sb.current_status.messages = list(messages or [])
    sb.current_status.sub_agent_executions = list(sub_agent_executions or [])
    sb.tool_call_fingerprints = {}
    return sb


def _make_logger():
    import logging
    return logging.getLogger("test_hitl_contracts")


def _make_state_manager(execution_id: str = "test_exec"):
    return ApprovalStateManager(
        execution_id=execution_id, logger=_make_logger(),
    )


def _make_interrupt_capture(*, status_builder=None, state_manager=None):
    """Create an InterruptCapture with sensible test defaults."""
    return InterruptCapture(
        execution_id="test_exec",
        status_builder=status_builder or _make_status_builder(),
        state_manager=state_manager or _make_state_manager(),
        logger=_make_logger(),
        resolve_platform_tool_name=lambda name: name,
    )


# =============================================================================
# Contract 1: Python -> Go/Java (INTERRUPT_CAPTURE output)
# =============================================================================


class TestInterruptCaptureContract:
    """After INTERRUPT_CAPTURE, PendingApprovals must satisfy these invariants
    for the Go/Java approval handler to work correctly."""

    def test_pending_approval_has_interrupt_id_after_enrichment(self):
        pa = _make_pending_approval(
            tool_call_id="call_abc123",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        tc = _make_tool_call(tc_id="call_abc123")
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])
        sb.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        sb.sync_sub_agent_pending_approvals = MagicMock()
        ic = _make_interrupt_capture(status_builder=sb)

        mock_intr = MagicMock()
        mock_intr.id = "intr_001"
        mock_intr.value = {"tool_call_id": "call_abc123", "message": "Confirm?"}
        mock_gs = MagicMock()
        mock_gs.interrupts = [mock_intr]

        ic.capture(
            graph_state=mock_gs,
            humanize_platform_refs=lambda msg: msg,
            resolve_display_env_vars=lambda msg, envs, secrets: msg,
            merged_env_vars={},
            secret_keys=set(),
        )

        assert pa.interrupt_id == "intr_001"
        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_lifecycle_advanced_to_interrupt_captured(self):
        pa = _make_pending_approval(tool_call_id="call_abc123")
        tc = _make_tool_call(tc_id="call_abc123")
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])
        sb.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        sb.sync_sub_agent_pending_approvals = MagicMock()
        ic = _make_interrupt_capture(status_builder=sb)

        mock_intr = MagicMock()
        mock_intr.id = "intr_002"
        mock_intr.value = {"tool_call_id": "call_abc123", "message": "Confirm?"}
        mock_gs = MagicMock()
        mock_gs.interrupts = [mock_intr]

        ic.capture(
            graph_state=mock_gs,
            humanize_platform_refs=lambda msg: msg,
            resolve_display_env_vars=lambda msg, envs, secrets: msg,
            merged_env_vars={},
            secret_keys=set(),
        )

        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_tool_call_id_preserved_after_enrichment(self):
        pa = _make_pending_approval(tool_call_id="call_original")
        tc = _make_tool_call(tc_id="call_original")
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])
        sb.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        sb.sync_sub_agent_pending_approvals = MagicMock()
        ic = _make_interrupt_capture(status_builder=sb)

        mock_intr = MagicMock()
        mock_intr.id = "intr_003"
        mock_intr.value = {"tool_call_id": "call_original", "message": "Confirm?"}
        mock_gs = MagicMock()
        mock_gs.interrupts = [mock_intr]

        ic.capture(
            graph_state=mock_gs,
            humanize_platform_refs=lambda msg: msg,
            resolve_display_env_vars=lambda msg, envs, secrets: msg,
            merged_env_vars={},
            secret_keys=set(),
        )

        assert pa.tool_call_id == "call_original"


# =============================================================================
# Contract 2: Go/Java -> Python (DECISION_RECORDED invariants)
# =============================================================================


class TestDecisionRecordedContract:
    """After Go/Java records a decision, these invariants must hold for
    the Python RESUME_RECONCILE to work correctly."""

    def test_pending_approvals_preserved_after_decision(self):
        """Go/Java must NOT remove pending_approvals from the DB."""
        pa = _make_pending_approval(
            interrupt_id="intr_001",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED,
        )
        pa.decision_action = ApprovalAction.APPROVAL_ACTION_APPROVE
        pa.decision_recorded_at = "2026-03-26T19:05:00Z"

        assert pa.tool_call_id == "call_abc123"
        assert pa.interrupt_id == "intr_001"
        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED
        assert pa.decision_action == ApprovalAction.APPROVAL_ACTION_APPROVE

    def test_decision_action_matches_tool_call_approval_action(self):
        """PendingApproval.decision_action must match ToolCall.approval_action
        (the handler sets both in the same transaction)."""
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED,
        )
        pa.decision_action = ApprovalAction.APPROVAL_ACTION_SKIP

        tc = _make_tool_call(approval_action=ApprovalAction.APPROVAL_ACTION_SKIP)

        assert pa.decision_action == tc.approval_action


# =============================================================================
# Contract 3: Python -> Go/Java (RESUME_RECONCILE)
# =============================================================================


class TestResumeReconcileContract:
    """After RESUME_RECONCILE, PendingApprovals must be at RESUME_RECONCILED
    state. The server-side merge logic prunes entries at this state."""

    def test_pending_approvals_at_resume_reconciled_after_reconcile(self):
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        approvals = sb.current_status.pending_approvals
        assert len(approvals) == 1
        assert approvals[0].tool_call_id == "call_abc123"
        assert approvals[0].lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED

    def test_tool_call_status_transitions_to_running_on_approve(self):
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.approval_action == ApprovalAction.APPROVAL_ACTION_APPROVE

    def test_tool_call_status_transitions_to_skipped_on_reject(self):
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_REJECT,
        )
        reconciler.reconcile(approval_decisions=[decision])

        assert tc.status == ToolCallStatus.TOOL_CALL_SKIPPED

    def test_no_sentinel_produced(self):
        """After reconcile, there should be no sentinel entry (empty tool_call_id)."""
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        sentinel_entries = [
            pa for pa in sb.current_status.pending_approvals
            if not pa.tool_call_id
        ]
        assert len(sentinel_entries) == 0, "No sentinel entries should be produced"


# =============================================================================
# Contract 4: UI -> API (approval actionability)
# =============================================================================


class TestUIApprovalActionabilityContract:
    """These tests codify the rules for when the UI should show an
    actionable approval card vs. a resolved decision badge."""

    def test_requested_is_actionable(self):
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        assert _is_actionable(pa)

    def test_interrupt_captured_is_actionable(self):
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
            interrupt_id="intr_001",
        )
        assert _is_actionable(pa)

    def test_decision_recorded_is_resolved(self):
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED,
        )
        pa.decision_action = ApprovalAction.APPROVAL_ACTION_APPROVE
        assert not _is_actionable(pa)

    def test_resume_reconciled_is_resolved(self):
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED,
        )
        assert not _is_actionable(pa)

    def test_unspecified_is_actionable_for_backward_compat(self):
        """Legacy PendingApprovals without lifecycle_state should be
        treated as actionable to maintain backward compatibility."""
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_UNSPECIFIED,
        )
        assert _is_actionable(pa)


# =============================================================================
# Contract 5: ApprovalStateManager forward-only invariant
# =============================================================================


class TestLifecycleForwardOnly:
    """The lifecycle_state must only move forward, never backward."""

    def test_forward_transition_succeeds(self):
        sm = ApprovalStateManager(execution_id="test", logger=_make_logger())
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        sm.advance(
            pa,
            target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
            service="test",
        )
        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_backward_transition_raises(self):
        sm = ApprovalStateManager(execution_id="test", logger=_make_logger())
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED,
        )
        import pytest
        with pytest.raises(ValueError, match="Cannot move PendingApproval lifecycle backward"):
            sm.advance(
                pa,
                target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
                service="test",
            )

    def test_same_state_transition_raises(self):
        sm = ApprovalStateManager(execution_id="test", logger=_make_logger())
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        import pytest
        with pytest.raises(ValueError):
            sm.advance(
                pa,
                target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
                service="test",
            )


# =============================================================================
# Contract 6: advance() enforcement — no direct lifecycle_state assignment
# =============================================================================


class TestAdvanceEnforcement:
    """Verify that InterruptCapture and ResumeReconciler route all lifecycle
    mutations through ApprovalStateManager.advance(), never via direct
    assignment to pa.lifecycle_state."""

    def test_interrupt_capture_enrichment_calls_advance(self):
        """capture() must route lifecycle transitions through advance()."""
        pa = _make_pending_approval(
            tool_call_id="call_abc123",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        tc = _make_tool_call(tc_id="call_abc123")
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])
        sb.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        sb.sync_sub_agent_pending_approvals = MagicMock()
        sm = _make_state_manager()
        ic = _make_interrupt_capture(status_builder=sb, state_manager=sm)

        mock_intr = MagicMock()
        mock_intr.id = "intr_001"
        mock_intr.value = {"tool_call_id": "call_abc123", "message": "Confirm?"}
        mock_gs = MagicMock()
        mock_gs.interrupts = [mock_intr]

        with patch.object(sm, "advance", wraps=sm.advance) as spy:
            ic.capture(
                graph_state=mock_gs,
                humanize_platform_refs=lambda msg: msg,
                resolve_display_env_vars=lambda msg, envs, secrets: msg,
                merged_env_vars={},
                secret_keys=set(),
            )

            spy.assert_called_once_with(
                pa,
                target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                service="InterruptCapture",
            )
        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_resume_reconciler_calls_advance_for_each_pending_approval(self):
        """reconcile() must advance each real PA to RESUME_RECONCILED."""
        pa = _make_pending_approval(
            interrupt_id="intr_001",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
        )
        tc = _make_tool_call()
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])
        sm = _make_state_manager()

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=sm,
            logger=_make_logger(),
        )

        with patch.object(sm, "advance", wraps=sm.advance) as spy:
            reconciler.reconcile(
                approval_decisions=[
                    SubmitApprovalInput(
                        agent_execution_id="test_exec",
                        tool_call_id="call_abc123",
                        action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                    ),
                ],
            )

            spy.assert_called_once_with(
                pa,
                target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED,
                service="ResumeReconciler",
            )

    def test_resume_reconciler_rejects_backward_transition(self):
        """If a PA is already RESUME_RECONCILED, advance() must raise on re-reconcile."""
        pa = _make_pending_approval(
            interrupt_id="intr_001",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED,
        )
        tc = _make_tool_call()
        sb = _make_status_builder(pending_approvals=[pa], tool_calls=[tc])

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )

        import pytest
        with pytest.raises(ValueError, match="Cannot move PendingApproval lifecycle backward"):
            reconciler.reconcile(
                approval_decisions=[
                    SubmitApprovalInput(
                        agent_execution_id="test_exec",
                        tool_call_id="call_abc123",
                        action=ApprovalAction.APPROVAL_ACTION_APPROVE,
                    ),
                ],
            )


# =============================================================================
# Contract 7: Sub-agent fingerprint map population
# =============================================================================


def _make_initial_status(*, tool_calls=None, sub_agent_executions=None):
    """Create a minimal mock AgentExecutionStatus for StatusBuilder tests."""
    status = MagicMock()
    status.messages = []
    status.tool_calls = list(tool_calls or [])
    status.sub_agent_executions = list(sub_agent_executions or [])
    status.todos = {}
    status.usage = UsageMetrics()
    status.pending_approvals = []
    return status


class TestSubAgentFingerprintMapPopulation:
    """populate_fingerprints_from_existing_tool_calls() must populate
    _fingerprint_to_tool_call_id for sub-agent tool calls, not just
    top-level ones.

    Without this, Priority 2 (fingerprint) matching in InterruptCapture
    always misses sub-agent tools, and resume-path run-ID alias creation
    fails for sub-agent tool calls.
    """

    def test_sub_agent_tool_call_fingerprint_in_map(self):
        """A sub-agent tool call must appear in _fingerprint_to_tool_call_id
        after populate_fingerprints_from_existing_tool_calls()."""
        args = Struct()
        args.update({"path": "/tmp/output.txt", "content": "hello"})
        sa_tc = ToolCall(
            id="sa-tc-001",
            name="write_file",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        sa = SubAgentExecution(id="sub-agent-run-1", name="code_editor")
        sa.tool_calls.append(sa_tc)

        status = _make_initial_status(sub_agent_executions=[sa])
        builder = StatusBuilder("exec-fp-sub-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        fingerprint = builder._get_tool_fingerprint("write_file", {"path": "/tmp/output.txt", "content": "hello"})
        assert fingerprint in builder.tool_call_fingerprints
        assert builder._fingerprint_to_tool_call_id.get(fingerprint) == "sa-tc-001"

    def test_top_level_and_sub_agent_both_populated(self):
        """Both top-level and sub-agent tool calls must appear in the map."""
        top_args = Struct()
        top_args.update({"query": "SELECT 1"})
        top_tc = ToolCall(
            id="top-tc-001",
            name="run_sql",
            args=top_args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        sa_args = Struct()
        sa_args.update({"url": "https://example.com"})
        sa_tc = ToolCall(
            id="sa-tc-002",
            name="fetch_url",
            args=sa_args,
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        )
        sa = SubAgentExecution(id="sub-agent-run-2", name="researcher")
        sa.tool_calls.append(sa_tc)

        status = _make_initial_status(tool_calls=[top_tc], sub_agent_executions=[sa])
        builder = StatusBuilder("exec-fp-both-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        top_fp = builder._get_tool_fingerprint("run_sql", {"query": "SELECT 1"})
        sa_fp = builder._get_tool_fingerprint("fetch_url", {"url": "https://example.com"})

        assert builder._fingerprint_to_tool_call_id.get(top_fp) == "top-tc-001"
        assert builder._fingerprint_to_tool_call_id.get(sa_fp) == "sa-tc-002"

    def test_sub_agent_tool_call_without_id_skipped(self):
        """A sub-agent tool call with empty id must not appear in the
        fingerprint-to-id map (but the fingerprint itself is still tracked
        for dedup)."""
        args = Struct()
        args.update({"key": "value"})
        sa_tc = ToolCall(
            id="",
            name="some_tool",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        sa = SubAgentExecution(id="sub-agent-run-3", name="helper")
        sa.tool_calls.append(sa_tc)

        status = _make_initial_status(sub_agent_executions=[sa])
        builder = StatusBuilder("exec-fp-noid-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        fingerprint = builder._get_tool_fingerprint("some_tool", {"key": "value"})
        assert fingerprint in builder.tool_call_fingerprints
        assert fingerprint not in builder._fingerprint_to_tool_call_id


# =============================================================================
# Helpers for UI contract
# =============================================================================


def _is_actionable(pa: PendingApproval) -> bool:
    """Determine if a PendingApproval should show as actionable in the UI.

    This mirrors the logic that the React UI should use:
    - UNSPECIFIED/REQUESTED/INTERRUPT_CAPTURED -> actionable (show approval card)
    - DECISION_RECORDED/RESUME_RECONCILED -> resolved (pruned server-side)
    """
    state = pa.lifecycle_state
    return state < ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED


# =============================================================================
# Resume flow: RESUME_RECONCILED entries sent to server for pruning
# =============================================================================


class TestResumeReconciledFlow:
    """After reconcile, PendingApprovals at RESUME_RECONCILED are sent to
    the server via pre-stream update. The server-side merge logic prunes them."""

    def test_reconciled_pas_retained_for_server_delivery(self):
        """After reconcile, RESUME_RECONCILED PAs remain in the list so
        they can be sent to the server for pruning."""
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        assert len(sb.current_status.pending_approvals) == 1
        assert sb.current_status.pending_approvals[0].tool_call_id == "call_abc123"
        assert sb.current_status.pending_approvals[0].lifecycle_state == \
            ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED

    def test_new_approvals_coexist_with_reconciled(self):
        """New pending approvals appended during the stream coexist
        with RESUME_RECONCILED entries. Server prunes only the resolved ones."""
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        real_pa = _make_pending_approval(
            tool_call_id="call_write_001",
            tool_name="write",
        )
        sb.current_status.pending_approvals.append(real_pa)

        assert len(sb.current_status.pending_approvals) == 2
        reconciled = [
            pa for pa in sb.current_status.pending_approvals
            if pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED
        ]
        pending = [
            pa for pa in sb.current_status.pending_approvals
            if pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED
        ]
        assert len(reconciled) == 1
        assert len(pending) == 1


# =============================================================================
# Fingerprint dedup: standard fingerprint match on resume
# =============================================================================


class TestFingerprintDedup:
    """On resume, fingerprint dedup catches exact matches."""

    def test_fingerprint_dedup_catches_exact_match(self):
        """Standard dedup: exact fingerprint match aliases and returns."""
        args = Struct()
        args.update({"key": "value"})
        tc = ToolCall(
            id="call_original",
            name="apply_mcp_server",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        status = _make_initial_status(tool_calls=[tc])
        builder = StatusBuilder("exec-ghost-1", status)
        builder.populate_fingerprints_from_existing_tool_calls()

        fingerprint = builder._get_tool_fingerprint("apply_mcp_server", {"key": "value"})
        assert fingerprint in builder.tool_call_fingerprints
        assert builder._fingerprint_to_tool_call_id.get(fingerprint) == "call_original"


# =============================================================================
# Fix 3: Guard _populate_pending_approval against post-approval tool calls
# =============================================================================


class TestPopulatePendingApprovalGuard:
    """_populate_pending_approval must skip tool calls already in
    post-approval states (RUNNING, COMPLETED, FAILED, SKIPPED)."""

    def test_guard_skips_running_tool_call(self):
        """A tool call already in RUNNING state should not get a new
        pending approval entry."""
        tc = ToolCall(
            id="call_approved",
            name="apply_mcp_server",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        status = _make_initial_status(tool_calls=[tc])
        builder = StatusBuilder("exec-guard-1", status)

        initial_count = len(builder.current_status.pending_approvals)
        builder._populate_pending_approval(
            run_id="call_approved",
            tool_name="apply_mcp_server",
            tool_args={"key": "value"},
            approval_message="Approve?",
        )
        assert len(builder.current_status.pending_approvals) == initial_count

    def test_guard_skips_completed_tool_call(self):
        tc = ToolCall(
            id="call_done",
            name="apply_mcp_server",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )

        status = _make_initial_status(tool_calls=[tc])
        builder = StatusBuilder("exec-guard-2", status)

        initial_count = len(builder.current_status.pending_approvals)
        builder._populate_pending_approval(
            run_id="call_done",
            tool_name="apply_mcp_server",
            tool_args={},
            approval_message="Approve?",
        )
        assert len(builder.current_status.pending_approvals) == initial_count

    def test_guard_allows_waiting_approval_tool_call(self):
        """WAITING_APPROVAL is pre-approval — should proceed normally."""
        tc = ToolCall(
            id="call_pending",
            name="write",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        )

        status = _make_initial_status(tool_calls=[tc])
        builder = StatusBuilder("exec-guard-3", status)

        builder._populate_pending_approval(
            run_id="call_pending",
            tool_name="write",
            tool_args={"content": "hello"},
            approval_message="Allow write?",
        )
        assert len(builder.current_status.pending_approvals) == 1
        assert builder.current_status.pending_approvals[0].tool_call_id == "call_pending"


# =============================================================================
# Fix 4: Clear stale completed_at on resume
# =============================================================================


class TestClearStaleCompletedAt:
    """ResumeReconciler must clear completed_at from the previous cycle
    so the frontend doesn't show conflicting completed + waiting states."""

    def test_stale_completed_at_cleared_on_reconcile(self):
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )
        sb.current_status.completed_at = "2026-03-27T10:22:52.724867Z"

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        assert sb.current_status.completed_at == ""

    def test_no_completed_at_stays_unset(self):
        tc = _make_tool_call()
        sb = _make_status_builder(
            pending_approvals=[
                _make_pending_approval(
                    interrupt_id="intr_001",
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                ),
            ],
            tool_calls=[tc],
        )
        sb.current_status.completed_at = ""

        reconciler = ResumeReconciler(
            execution_id="test_exec",
            status_builder=sb,
            state_manager=_make_state_manager(),
            logger=_make_logger(),
        )
        decision = SubmitApprovalInput(
            agent_execution_id="test_exec",
            tool_call_id="call_abc123",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        reconciler.reconcile(approval_decisions=[decision])

        assert sb.current_status.completed_at == ""


# =============================================================================
# Fix 7: Early tool call dedup on resume
# =============================================================================


class TestEarlyToolCallResumeDedupe:
    """On resume, _create_early_tool_call must skip creating duplicates
    for tool_use blocks replayed from the checkpoint."""

    def test_existing_early_tool_call_skipped(self):
        """If a tool call with the derived early-ID already exists,
        _create_early_tool_call should not create a duplicate."""
        tc = ToolCall(
            id="early-toolu_abc123",
            name="apply_mcp_server",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )

        status = _make_initial_status(tool_calls=[tc])
        builder = StatusBuilder("exec-dedup-1", status)

        initial_tc_count = len(builder.current_status.tool_calls)
        initial_msg_count = len(builder.current_status.messages)

        builder._create_early_tool_call(
            tool_name="apply_mcp_server",
            tool_use_id="toolu_abc123",
            ns_key="",
            namespace="",
        )

        assert len(builder.current_status.tool_calls) == initial_tc_count
        assert len(builder.current_status.messages) == initial_msg_count

    def test_new_tool_call_created_normally(self):
        """When no existing tool call matches, creation proceeds normally."""
        status = _make_initial_status()
        builder = StatusBuilder("exec-dedup-2", status)

        builder._create_early_tool_call(
            tool_name="write",
            tool_use_id="toolu_new123",
            ns_key="",
            namespace="",
        )

        assert len(builder.current_status.tool_calls) == 1
        assert builder.current_status.tool_calls[0].id == "early-toolu_new123"
        assert builder.current_status.tool_calls[0].name == "write"
