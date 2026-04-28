"""
Human-in-the-Loop (HITL) approval flow logic.

``messages[].tool_calls`` is the single source of truth.
``pending_approvals`` is computed server-side by Go/Java
``ComputePendingApprovals``.  The LangGraph checkpoint is queried
directly at resume time.

Public helpers:

  extract_interrupt_tool_call_ids — extracts the set of tool_call_ids from
      LangGraph checkpoint interrupts.

  extract_approval_decisions_from_execution — builds a
      ``list[SubmitApprovalInput]`` from a DB-loaded execution's tool calls
      (DB-driven resume path).

  resolve_resume_input — orchestrates the full HITL resume resolution,
      returning a ``ResumeResult`` with the LangGraph input and status.

Classes:

  ResumeReconciler — transitions tool calls from WAITING_APPROVAL to their
                     post-decision status using the in-memory index.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import TYPE_CHECKING, Any, cast

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import SubmitApprovalInput
from langchain_core.runnables import RunnableConfig

from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp

if TYPE_CHECKING:
    from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
        AgentExecutionStatus,
    )

    from stigmer_runner.grpc_client.agent_execution_client import AgentExecutionClient

# Proto enum → action string for interrupt resume values
_ACTION_MAP: dict[ApprovalAction, str] = {
    ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
    ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
    ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
}

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


def _build_decision_value(
    decision: SubmitApprovalInput,
    action_map: dict[ApprovalAction, str],
) -> dict[str, str]:
    """Build the resume value dict for a single approval decision."""
    dv: dict[str, str] = {"action": action_map.get(decision.action, "unknown")}
    if decision.comment:
        dv["comment"] = decision.comment
    return dv


def _summarize_resume_entry(interrupt_id: str, value: Any) -> str:
    """Format one entry from the resume dict for logging."""
    if isinstance(value, dict) and "action" in value:
        return f"interrupt={interrupt_id[:16]} action={value['action']}"
    return f"interrupt={interrupt_id[:16]} value={value!r}"


@dataclasses.dataclass(frozen=True)
class ResumeResult:
    """Outcome of HITL resume resolution.

    *terminal_status*: when not ``None``, the caller must return this
    immediately (resume match failure).
    """

    graph_input: Any
    is_resume_from_approval: bool
    terminal_status: AgentExecutionStatus | None = None


async def resolve_resume_input(
    *,
    approval_decisions: list[SubmitApprovalInput],
    agent_graph: Any,
    config: dict[str, Any],
    execution: Any,
    status_builder: StatusBuilder,
    execution_client: AgentExecutionClient,
    execution_id: str,
    langgraph_input: dict[str, Any],
    logger: logging.Logger,
) -> ResumeResult:
    """Orchestrate the full HITL resume resolution.

    Steps:
      1. DB-driven resume detection (if no Temporal-arg decisions)
      2. Match decisions to checkpoint interrupts
      3. On match failure → build FAILED status and return terminal_status
      4. ResumeReconciler: transition tool calls, orphan reconciliation
      5. Build ``Command(resume=...)`` for LangGraph
    """
    from stigmer_runner.worker.activities.graphton.temporal_helpers import (
        slim_status_for_temporal as _slim_status_for_temporal,
    )

    # DB-driven resume: detect interrupts in checkpoint when no
    # decisions were passed via Temporal args.
    if not approval_decisions:
        _db_graph_state = await agent_graph.aget_state(
            cast(RunnableConfig, config),
        )
        if _db_graph_state and getattr(_db_graph_state, "interrupts", None):
            approval_decisions = extract_approval_decisions_from_execution(
                execution,
            )
            logger.info(
                "[RESUME] DB-driven: extracted %d approval decision(s) "
                "from execution %s (tool_call_ids: %s)",
                len(approval_decisions),
                execution_id,
                [d.tool_call_id for d in approval_decisions],
            )

    if not approval_decisions:
        return ResumeResult(
            graph_input=langgraph_input,
            is_resume_from_approval=False,
        )

    # Match decisions to checkpoint interrupts
    decisions_by_tc: dict[str, SubmitApprovalInput] = {
        d.tool_call_id: d for d in approval_decisions
    }
    graph_state = await agent_graph.aget_state(
        cast(RunnableConfig, config),
    )

    resume_dict: dict[str, Any] = {}
    matched_decision_tc_ids: set[str] = set()

    if graph_state and graph_state.interrupts:
        for intr in graph_state.interrupts:
            intr_value = intr.value if isinstance(intr.value, dict) else {}
            tc_id = intr_value.get("tool_call_id", "")
            if tc_id:
                decision = decisions_by_tc.get(tc_id)
                if decision:
                    resume_dict[intr.id] = _build_decision_value(
                        decision, _ACTION_MAP,
                    )
                    matched_decision_tc_ids.add(tc_id)

    unmatched = set(decisions_by_tc) - matched_decision_tc_ids
    if unmatched:
        logger.error(
            "[RESUME_UNMATCHED] execution=%s "
            "%d decision(s) could not match any interrupt: %s. "
            "This indicates a tool_call_id identity chain failure "
            "-- investigate ToolCallIdCapture and StatusBuilder.",
            execution_id, len(unmatched), sorted(unmatched),
        )

    if not resume_dict:
        # All decisions failed to match — abort with FAILED status
        intr_tc_ids: list[str] = []
        if graph_state and graph_state.interrupts:
            for intr in graph_state.interrupts:
                intr_value = intr.value if isinstance(intr.value, dict) else {}
                tc_id = intr_value.get("tool_call_id", "")
                if tc_id:
                    intr_tc_ids.append(tc_id)

        error_msg = (
            f"Approval resume failed: {len(approval_decisions)} "
            f"decision(s) could not be matched to any pending "
            f"interrupt in the checkpoint. "
            f"decision_tc_ids={[d.tool_call_id for d in approval_decisions]} "
            f"interrupt_tc_ids={intr_tc_ids}"
        )
        logger.error(
            "[RESUME_FAILED] execution=%s: %s",
            execution_id, error_msg,
        )

        status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
        status_builder.current_status.error = error_msg
        if not status_builder.current_status.completed_at:
            status_builder.current_status.completed_at = _utc_timestamp()
        try:
            await execution_client.update_status(
                execution_id, status_builder.current_status,
            )
        except Exception as update_err:
            logger.error(
                "[RESUME_FAILED] Failed to persist FAILED status "
                "for execution %s: %s",
                execution_id, update_err,
            )
        return ResumeResult(
            graph_input=None,
            is_resume_from_approval=False,
            terminal_status=_slim_status_for_temporal(
                status_builder.current_status,
            ),
        )

    # Reconciliation
    logger.info(
        "[RESUME] Matched %d interrupt(s) for execution %s: %s",
        len(resume_dict),
        execution_id,
        ", ".join(
            _summarize_resume_entry(iid, val)
            for iid, val in resume_dict.items()
        ),
    )

    resume_reconciler = ResumeReconciler(
        execution_id=execution_id,
        status_builder=status_builder,
        logger=logger,
    )
    resume_reconciler.reconcile(approval_decisions=approval_decisions)

    if graph_state and getattr(graph_state, "interrupts", None):
        interrupt_tc_ids = extract_interrupt_tool_call_ids(
            graph_state.interrupts,
        )
    else:
        interrupt_tc_ids = set()
    decision_tc_ids = {d.tool_call_id for d in approval_decisions}
    orphan_count = resume_reconciler.reconcile_orphans_against_checkpoint(
        interrupt_tc_ids=interrupt_tc_ids,
        decision_tc_ids=decision_tc_ids,
    )
    if orphan_count:
        logger.info(
            "[RESUME] execution=%s — reconciled %d orphaned tool "
            "call(s) against checkpoint before streaming",
            execution_id, orphan_count,
        )

    task_tc_count = status_builder.prepare_task_tool_resume_queue()
    if task_tc_count:
        logger.info(
            "[RESUME] execution=%s — pre-queued %d task tool call(s) "
            "for sub-agent resume reconciliation",
            execution_id, task_tc_count,
        )

    pre_reg_count = status_builder.pre_register_in_progress_sub_agents()
    if pre_reg_count:
        logger.info(
            "[RESUME] execution=%s — pre-registered %d IN_PROGRESS "
            "sub-agent(s) for resume event routing",
            execution_id, pre_reg_count,
        )

    # Build graph input
    from langgraph.types import Command

    graph_input: Command = Command(resume=resume_dict)
    summary = ", ".join(
        _summarize_resume_entry(iid, val)
        for iid, val in resume_dict.items()
    )
    logger.info(
        "Resuming Graphton agent for execution %s "
        "(%d interrupt(s): %s)",
        execution_id, len(resume_dict), summary,
    )

    return ResumeResult(
        graph_input=graph_input,
        is_resume_from_approval=True,
    )


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
        # Rebuild the tool call index BEFORE the reconciliation loop so that
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
            self._sb.tool_call_count(),
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
