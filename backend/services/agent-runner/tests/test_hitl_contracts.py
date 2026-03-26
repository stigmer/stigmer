"""Cross-boundary contract tests for the HITL approval lifecycle.

These tests verify the data contracts between services:
  Python -> Go/Java: After INTERRUPT_CAPTURE, PendingApprovals have interrupt_id
                     and lifecycle_state == INTERRUPT_CAPTURED
  Go/Java -> Python: After RecordApprovalDecision, PendingApprovals are preserved
                     with lifecycle_state == DECISION_RECORDED
  Python -> Go/Java: After RESUME_RECONCILE, clear-signal sentinel is present
                     with lifecycle_state == CLEARED
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

from worker.activities.graphton.hitl import (
    ApprovalStateManager,
    InterruptCapture,
    ResumeReconciler,
)


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
        pa = _make_pending_approval(lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED)
        sb = _make_status_builder(pending_approvals=[pa])
        ic = _make_interrupt_capture(status_builder=sb)

        result = ic._try_enrich_phase1_entry("delete_file", False, "intr_001")

        assert result is True
        assert pa.interrupt_id == "intr_001"
        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_lifecycle_advanced_to_interrupt_captured(self):
        pa = _make_pending_approval()
        sb = _make_status_builder(pending_approvals=[pa])
        ic = _make_interrupt_capture(status_builder=sb)

        ic._try_enrich_phase1_entry("delete_file", False, "intr_002")

        assert pa.lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED

    def test_tool_call_id_preserved_after_enrichment(self):
        pa = _make_pending_approval(tool_call_id="call_original")
        sb = _make_status_builder(pending_approvals=[pa])
        ic = _make_interrupt_capture(status_builder=sb)

        ic._try_enrich_phase1_entry("delete_file", False, "intr_003")

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
# Contract 3: Python -> Go/Java (RESUME_RECONCILE clear-signal)
# =============================================================================


class TestClearSignalContract:
    """After RESUME_RECONCILE, the clear-signal sentinel must be present
    for the Go/Java UpdateStatus handler to clear pending_approvals."""

    def test_clear_signal_has_empty_tool_call_id(self):
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
        assert approvals[0].tool_call_id == ""
        assert approvals[0].lifecycle_state == ApprovalLifecycleState.APPROVAL_LIFECYCLE_CLEARED

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
        """_try_enrich_phase1_entry must route through advance()."""
        pa = _make_pending_approval(
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
        )
        sb = _make_status_builder(pending_approvals=[pa])
        sm = _make_state_manager()
        ic = _make_interrupt_capture(status_builder=sb, state_manager=sm)

        with patch.object(sm, "advance", wraps=sm.advance) as spy:
            ic._try_enrich_phase1_entry("delete_file", False, "intr_001")

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
        """If a PA is already CLEARED, advance() must raise on RESUME_RECONCILED."""
        pa = _make_pending_approval(
            interrupt_id="intr_001",
            lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_CLEARED,
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
# Helpers for UI contract
# =============================================================================


def _is_actionable(pa: PendingApproval) -> bool:
    """Determine if a PendingApproval should show as actionable in the UI.

    This mirrors the logic that the React UI should use:
    - UNSPECIFIED/REQUESTED/INTERRUPT_CAPTURED -> actionable (show approval card)
    - DECISION_RECORDED/RESUME_RECONCILED/CLEARED -> resolved (show badge)
    """
    state = pa.lifecycle_state
    return state < ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED
