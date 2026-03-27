"""
Human-in-the-Loop (HITL) approval flow logic.

Simplified in T03: ``messages[].tool_calls`` is the single source of truth.
``pending_approvals`` is computed server-side.  The LangGraph checkpoint is
queried directly at resume time.

Only one class remains:

  ResumeReconciler — transitions tool calls from WAITING_APPROVAL to their
                     post-decision status using the in-memory index.
"""

from __future__ import annotations

import logging

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput

from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp


class ResumeReconciler:
    """Reconciles tool call status when resuming from approval.

    On resume, the StatusBuilder is initialized with DB-persisted status that
    already contains tool calls in WAITING_APPROVAL state.  This class:

    1. Transitions each decided tool call to RUNNING / SKIPPED
    2. Auto-skips remaining WAITING_APPROVAL tools on REJECT
    3. Clears stale ``completed_at`` from the previous cycle
    4. Pre-populates fingerprints for LangGraph replay dedup
    """

    _APPROVAL_TO_STATUS = {
        ApprovalAction.APPROVAL_ACTION_APPROVE: ToolCallStatus.TOOL_CALL_RUNNING,
        ApprovalAction.APPROVAL_ACTION_SKIP: ToolCallStatus.TOOL_CALL_SKIPPED,
        ApprovalAction.APPROVAL_ACTION_REJECT: ToolCallStatus.TOOL_CALL_SKIPPED,
    }

    def __init__(
        self,
        *,
        execution_id: str,
        status_builder: StatusBuilder,
        logger: logging.Logger,
    ) -> None:
        self._execution_id = execution_id
        self._sb = status_builder
        self._logger = logger

    def reconcile(
        self,
        *,
        approval_decisions: list[SubmitApprovalInput],
    ) -> None:
        """Run the full reconciliation pipeline."""
        decisions_by_tc = {d.tool_call_id: d for d in approval_decisions}
        reconciled_count = 0
        has_reject = False

        for decision in approval_decisions:
            tc = self._sb.get_tool_call(decision.tool_call_id)
            if tc is None:
                self._logger.warning(
                    "[RESUME_RECONCILE] execution=%s "
                    "tool_call_id=%s not found in index — skipping",
                    self._execution_id, decision.tool_call_id,
                )
                continue

            if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                self._logger.info(
                    "[RESUME_RECONCILE] execution=%s "
                    "tool_call=%s name=%s already in %s — skipping",
                    self._execution_id, tc.id, tc.name,
                    ToolCallStatus.Name(tc.status),
                )
                continue

            new_status = self._APPROVAL_TO_STATUS.get(
                decision.action, ToolCallStatus.TOOL_CALL_RUNNING,
            )
            tc.status = new_status
            tc.approval_action = decision.action
            tc.approval_decided_at = _utc_timestamp()
            if decision.comment:
                tc.approved_by = decision.comment
            reconciled_count += 1

            if decision.action == ApprovalAction.APPROVAL_ACTION_REJECT:
                has_reject = True

            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "tool_call=%s name=%s "
                "WAITING_APPROVAL -> %s",
                self._execution_id, tc.id, tc.name,
                ToolCallStatus.Name(new_status),
            )

        if has_reject:
            self._auto_skip_remaining(decisions_by_tc)

        if self._sb.current_status.completed_at:
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s clearing stale "
                "completed_at=%s from previous cycle",
                self._execution_id,
                self._sb.current_status.completed_at,
            )
            self._sb.current_status.completed_at = ""

        self._sb.populate_fingerprints_from_existing_tool_calls()

        self._logger.info(
            "[RESUME_RECONCILE] execution=%s "
            "reconciled %d tool call(s), "
            "populated %d fingerprint(s)",
            self._execution_id, reconciled_count,
            len(self._sb.tool_call_fingerprints),
        )

    def _auto_skip_remaining(
        self, decisions_by_tc: dict[str, SubmitApprovalInput],
    ) -> None:
        """Auto-skip WAITING_APPROVAL tools that weren't in the decision set."""
        for tc in self._sb.iter_all_tool_calls():
            if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                continue
            if tc.id in decisions_by_tc:
                continue
            tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
            tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
            tc.approval_decided_at = _utc_timestamp()
            tc.result = (
                f"Tool '{tc.name}' was automatically skipped because "
                "another tool in this batch was rejected by the user."
            )
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "tool_call=%s name=%s "
                "WAITING_APPROVAL -> TOOL_CALL_SKIPPED (auto-skip after reject)",
                self._execution_id, tc.id, tc.name,
            )
