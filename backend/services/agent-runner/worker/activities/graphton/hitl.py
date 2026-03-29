"""
Human-in-the-Loop (HITL) approval flow logic.

Simplified in T03: ``messages[].tool_calls`` is the single source of truth.
``pending_approvals`` is computed server-side.  The LangGraph checkpoint is
queried directly at resume time.

Public helpers:

  extract_interrupt_tool_call_ids — extracts the set of tool_call_ids from
      LangGraph checkpoint interrupts (both direct and proxy shapes).

  build_snapshot_from_interrupts — builds the Temporal-coordination
      ``pending_approvals`` list from checkpoint interrupts.

  extract_approval_decisions_from_execution — builds the same
      ``list[SubmitApprovalInput]`` from a DB-loaded execution's tool calls
      (T03 DB-driven resume path).

Classes:

  ResumeReconciler — transitions tool calls from WAITING_APPROVAL to their
                     post-decision status using the in-memory index.
"""

from __future__ import annotations

import logging
from typing import Any

from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput

from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp

# ---------------------------------------------------------------------------
# Interrupt helpers
# ---------------------------------------------------------------------------


def extract_interrupt_tool_call_ids(interrupts: Any) -> set[str]:
    """Extract all tool_call_ids from LangGraph checkpoint interrupts.

    All interrupts use the direct shape: ``intr.value["tool_call_id"]``.
    Both root-agent and sub-agent interrupts propagate with this same
    shape thanks to LangGraph's native per-invocation subgraph mode.
    """
    tc_ids: set[str] = set()
    for intr in interrupts:
        intr_value = intr.value if isinstance(intr.value, dict) else {}
        tc_id = intr_value.get("tool_call_id", "")
        if tc_id:
            tc_ids.add(tc_id)
    return tc_ids


def build_snapshot_from_interrupts(interrupts: Any) -> list[PendingApproval]:
    """Build ``pending_approvals`` snapshot from checkpoint interrupts.

    Returns one :class:`PendingApproval` per tool_call_id found in the
    interrupts.  This is the Temporal-coordination signal that tells the Go
    workflow how many approval signals to collect.
    """
    return [
        PendingApproval(tool_call_id=tc_id)
        for tc_id in sorted(extract_interrupt_tool_call_ids(interrupts))
    ]


def extract_approval_decisions_from_execution(
    execution,
) -> list[SubmitApprovalInput]:
    """Extract approval decisions from a DB-loaded AgentExecution.

    After T01, ``SubmitApproval`` atomically sets ``approval_action`` and
    ``approval_decided_at`` on each tool call.  This function scans all
    tool calls (root and sub-agent messages) and builds the same
    ``list[SubmitApprovalInput]`` that :class:`ResumeReconciler` expects.

    Used by the DB-driven resume path (T03): when the workflow sends no
    approval decisions via Temporal args, the activity detects a resume via
    LangGraph interrupts and calls this function to extract the decisions
    from the execution loaded in Step 0.
    """
    decisions: list[SubmitApprovalInput] = []
    for msg in execution.status.messages:
        for tc in msg.tool_calls:
            if tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED:
                decisions.append(SubmitApprovalInput(
                    tool_call_id=tc.id,
                    action=tc.approval_action,
                    comment=tc.approved_by or "",
                ))
    for sa in execution.status.sub_agent_executions:
        for msg in sa.messages:
            for tc in msg.tool_calls:
                if tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED:
                    decisions.append(SubmitApprovalInput(
                        tool_call_id=tc.id,
                        action=tc.approval_action,
                        comment=tc.approved_by or "",
                    ))
    return decisions


class ResumeReconciler:
    """Reconciles tool call status when resuming from approval.

    On resume, the StatusBuilder is initialized with DB-persisted status that
    already contains tool calls in WAITING_APPROVAL state.  This class:

    1. Rebuilds the in-memory index from persisted status
    2. Transitions each decided tool call to RUNNING / SKIPPED
    3. Auto-skips remaining WAITING_APPROVAL tools on REJECT
    4. Clears stale ``completed_at`` from the previous cycle
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
        # Rebuild _tool_call_index BEFORE the reconciliation loop so that
        # get_tool_call() and iter_all_tool_calls() can find persisted tool
        # calls from the previous execution cycle.
        self._sb.rebuild_index_from_persisted_status()

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

        self._logger.info(
            "[RESUME_RECONCILE] execution=%s "
            "reconciled %d tool call(s), "
            "index size=%d",
            self._execution_id, reconciled_count,
            len(self._sb._tool_call_index),
        )

    def reconcile_orphans_against_checkpoint(
        self,
        interrupt_tc_ids: set[str],
        decision_tc_ids: set[str],
    ) -> int:
        """Mark orphaned WAITING_APPROVAL tool calls as SKIPPED.

        A tool call is orphaned if it is ``WAITING_APPROVAL`` with no
        recorded decision, AND its ID does not appear in any checkpoint
        interrupt.  Such tool calls are artifacts of previous sub-agent
        invocations that completed or restarted on a new thread.

        Returns the number of tool calls skipped.
        """
        skipped = 0
        for tc in self._sb.iter_all_tool_calls():
            if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                continue
            if tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED:
                continue
            if tc.id in interrupt_tc_ids or tc.id in decision_tc_ids:
                continue
            tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
            tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
            tc.approval_decided_at = _utc_timestamp()
            tc.result = "Auto-skipped: no matching checkpoint interrupt"
            skipped += 1
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "tool_call=%s name=%s "
                "WAITING_APPROVAL -> TOOL_CALL_SKIPPED "
                "(orphan: not in checkpoint interrupts)",
                self._execution_id, tc.id, tc.name,
            )
        if skipped:
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "skipped %d orphaned WAITING_APPROVAL tool call(s) "
                "not present in checkpoint interrupts",
                self._execution_id, skipped,
            )
        return skipped

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
