"""
Human-in-the-Loop (HITL) approval flow logic.

Extracted from execute_graphton.py to provide focused, testable classes
for the distributed approval lifecycle:

  ApprovalStateManager  — enforces forward-only lifecycle transitions
  InterruptCapture      — matches LangGraph interrupts to tool calls (Phase 2)
  ResumeReconciler      — reconciles tool call status on resume (RESUME_RECONCILE)
  CheckpointFallback    — discovers interrupt IDs from LangGraph checkpoint

Each class has explicit dependencies (no globals, no closure captures) and
a clear single responsibility.
"""

from __future__ import annotations

import logging
from typing import Any

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

from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp

_LIFECYCLE_ORDER = {
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_UNSPECIFIED: 0,
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED: 1,
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED: 2,
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_DECISION_RECORDED: 3,
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED: 4,
}


class ApprovalStateManager:
    """Enforces forward-only lifecycle transitions on PendingApproval records.

    Every lifecycle transition in the HITL pipeline MUST go through this
    manager. It guarantees:
      - No backward transitions (raises ValueError)
      - Structured logging for every transition
      - The ``lifecycle_state`` field is the single source of truth
    """

    def __init__(self, *, execution_id: str, logger: logging.Logger) -> None:
        self._execution_id = execution_id
        self._logger = logger

    def advance(
        self,
        pa: PendingApproval,
        *,
        target_state: ApprovalLifecycleState,
        service: str,
    ) -> None:
        """Advance ``pa.lifecycle_state`` to ``target_state``.

        Raises ``ValueError`` if ``target_state`` is not strictly ahead
        of the current state.
        """
        current = pa.lifecycle_state
        current_ord = _LIFECYCLE_ORDER.get(current, 0)
        target_ord = _LIFECYCLE_ORDER.get(target_state, 0)

        if target_ord <= current_ord:
            raise ValueError(
                f"Cannot move PendingApproval lifecycle backward: "
                f"{ApprovalLifecycleState.Name(current)} -> "
                f"{ApprovalLifecycleState.Name(target_state)} "
                f"(execution={self._execution_id} tc_id={pa.tool_call_id})"
            )

        self._logger.info(
            "[LIFECYCLE] execution=%s tc_id=%s tool=%s "
            "%s -> %s (service=%s)",
            self._execution_id,
            pa.tool_call_id,
            pa.tool_name,
            ApprovalLifecycleState.Name(current),
            ApprovalLifecycleState.Name(target_state),
            service,
        )
        pa.lifecycle_state = target_state


class InterruptCapture:
    """Matches LangGraph interrupts to existing PendingApproval entries.

    After the LangGraph event stream ends with ``EXECUTION_WAITING_FOR_APPROVAL``,
    this class iterates ``graph_state.interrupts`` and enriches Phase 1
    ``PendingApproval`` entries with the LangGraph-assigned ``interrupt_id``.

    The interrupt payload carries ``tool_call_id`` (injected via
    ``InjectedToolCallId``) which directly identifies the ``ToolCall``.
    No fuzzy matching (run_id aliases, fingerprints, name fallback) is needed.

    Each match advances the PendingApproval lifecycle to INTERRUPT_CAPTURED.
    """

    def __init__(
        self,
        *,
        execution_id: str,
        status_builder: StatusBuilder,
        state_manager: ApprovalStateManager,
        logger: logging.Logger,
        resolve_platform_tool_name: Any,
    ) -> None:
        self._execution_id = execution_id
        self._sb = status_builder
        self._sm = state_manager
        self._logger = logger
        self._resolve_platform_tool_name = resolve_platform_tool_name

    def capture(
        self,
        *,
        graph_state: Any,
        humanize_platform_refs: Any,
        resolve_display_env_vars: Any,
        merged_env_vars: dict[str, str],
        secret_keys: set[str],
    ) -> None:
        """Run the full interrupt capture pipeline.

        Modifies ``status_builder.current_status.pending_approvals`` in place.
        """
        if self._sb.current_status.phase != ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
            return

        if not graph_state or not graph_state.interrupts:
            self._logger.debug(
                "[INTERRUPT_CAPTURE] execution=%s "
                "WAITING_FOR_APPROVAL phase but no interrupts in graph state.",
                self._execution_id,
            )
            return

        for _diag_idx, _diag_intr in enumerate(graph_state.interrupts):
            _diag_val = _diag_intr.value if hasattr(_diag_intr, "value") else {}
            self._logger.info(
                "[DIAG] Raw interrupt [%d]: "
                "id=%s tool_call_id=%s value_type=%s",
                _diag_idx,
                _diag_intr.id,
                _diag_val.get("tool_call_id", "") if isinstance(_diag_val, dict) else "",
                type(_diag_val).__name__,
            )

        phase1_count = len(self._sb.current_status.pending_approvals)
        enriched_count = 0
        added_count = 0
        skipped_count = 0

        phase1_by_tc_id: dict[str, PendingApproval] = {
            pa.tool_call_id: pa
            for pa in self._sb.current_status.pending_approvals
            if pa.tool_call_id
        }

        matched_tc_ids: set[str] = set()

        for intr in graph_state.interrupts:
            intr_value = intr.value if hasattr(intr, "value") else {}
            intr_tc_id = intr_value.get("tool_call_id", "") if isinstance(intr_value, dict) else ""
            message = intr_value.get("message", "") if isinstance(intr_value, dict) else ""

            matched_tool_call_id = self._match_interrupt(
                tool_call_id=intr_tc_id,
                matched_tc_ids=matched_tc_ids,
                intr_id=intr.id,
            )

            if not matched_tool_call_id:
                skipped_count += 1
                self._logger.warning(
                    "[INTERRUPT_CAPTURE] execution=%s "
                    "cannot match interrupt %s tool_call_id=%s "
                    "to any WAITING_APPROVAL tool call",
                    self._execution_id, intr.id, intr_tc_id,
                )
                continue

            display_message = humanize_platform_refs(message)
            display_message = resolve_display_env_vars(
                display_message, merged_env_vars, secret_keys,
            )

            if matched_tool_call_id in phase1_by_tc_id:
                existing_pa = phase1_by_tc_id[matched_tool_call_id]
                existing_pa.interrupt_id = intr.id
                self._sm.advance(
                    existing_pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                    service="InterruptCapture",
                )
                enriched_count += 1
            else:
                tc = self._find_tool_call(matched_tool_call_id)
                tool_name = tc.name if tc else ""
                from_sub_agent = False
                sub_agent_name = ""
                args_preview = ""
                if tc:
                    args_preview = self._sb._create_args_preview(
                        {f.key: f.value for f in tc.args}
                        if hasattr(tc, "args") and tc.args
                        else {}
                    )
                for sa in self._sb.current_status.sub_agent_executions:
                    if any(sa_tc.id == matched_tool_call_id for sa_tc in sa.tool_calls):
                        from_sub_agent = True
                        sub_agent_name = sa.name
                        break

                pa = PendingApproval(
                    tool_call_id=matched_tool_call_id,
                    tool_name=tool_name,
                    message=display_message,
                    args_preview=args_preview,
                    requested_at=_utc_timestamp(),
                    from_sub_agent=from_sub_agent,
                    sub_agent_name=sub_agent_name,
                    interrupt_id=intr.id,
                    lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_REQUESTED,
                )
                self._sb.current_status.pending_approvals.append(pa)
                self._sm.advance(
                    pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                    service="InterruptCapture",
                )
                added_count += 1

        self._sb.sync_sub_agent_pending_approvals()

        final_count = len(self._sb.current_status.pending_approvals)
        self._logger.info(
            "[INTERRUPT_CAPTURE] execution=%s "
            "phase1=%d enriched=%d added=%d skipped=%d final=%d: %s",
            self._execution_id, phase1_count, enriched_count,
            added_count, skipped_count, final_count,
            ", ".join(
                f"tool={pa.tool_name} tc_id={pa.tool_call_id} "
                f"interrupt_id={pa.interrupt_id} lifecycle={ApprovalLifecycleState.Name(pa.lifecycle_state)}"
                for pa in self._sb.current_status.pending_approvals
            ),
        )

        self._reset_stale_approval_actions()

    def _match_interrupt(
        self,
        *,
        tool_call_id: str,
        matched_tc_ids: set[str],
        intr_id: str,
    ) -> str:
        """Match an interrupt to a tool call via ``tool_call_id``. Returns matched id or ""."""
        if not tool_call_id:
            self._logger.warning(
                "[INTERRUPT_CAPTURE] execution=%s "
                "interrupt %s has no tool_call_id — cannot match",
                self._execution_id, intr_id,
            )
            return ""

        if tool_call_id in matched_tc_ids:
            self._logger.info(
                "[INTERRUPT_CAPTURE] execution=%s "
                "tool_call_id=%s already matched — skipping duplicate",
                self._execution_id, tool_call_id,
            )
            return ""

        if not self._verify_waiting_approval(tool_call_id):
            self._logger.warning(
                "[INTERRUPT_CAPTURE] execution=%s "
                "tool_call_id=%s not found in WAITING_APPROVAL state",
                self._execution_id, tool_call_id,
            )
            return ""

        matched_tc_ids.add(tool_call_id)
        return tool_call_id

    def _verify_waiting_approval(self, tc_id: str) -> bool:
        """Check if a tool call exists and is WAITING_APPROVAL."""
        for tc in self._sb.current_status.tool_calls:
            if tc.id == tc_id and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                return True
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                if tc.id == tc_id and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                    return True
        return False

    def _find_tool_call(self, tc_id: str) -> Any | None:
        """Look up a ToolCall by id across top-level and sub-agent tool calls."""
        for tc in self._sb.current_status.tool_calls:
            if tc.id == tc_id:
                return tc
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                if tc.id == tc_id:
                    return tc
        return None

    def _reset_stale_approval_actions(self) -> None:
        """Reset stale approval_action on ToolCalls that re-entered pending_approvals."""
        pending_tc_ids = {
            pa.tool_call_id
            for pa in self._sb.current_status.pending_approvals
            if pa.tool_call_id
        }
        if not pending_tc_ids:
            return

        stale_reset_count = 0
        for tc in self._sb.current_status.tool_calls:
            if (
                tc.id in pending_tc_ids
                and tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
            ):
                self._logger.info(
                    "[INTERRUPT_CAPTURE] execution=%s "
                    "resetting stale approval_action=%s "
                    "on tool_call=%s (now pending again in new cycle)",
                    self._execution_id,
                    ApprovalAction.Name(tc.approval_action),
                    tc.id,
                )
                tc.approval_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                tc.approval_decided_at = ""
                stale_reset_count += 1
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                if (
                    tc.id in pending_tc_ids
                    and tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                ):
                    self._logger.info(
                        "[INTERRUPT_CAPTURE] execution=%s "
                        "resetting stale approval_action=%s "
                        "on sub-agent tool_call=%s (now pending again in new cycle)",
                        self._execution_id,
                        ApprovalAction.Name(tc.approval_action),
                        tc.id,
                    )
                    tc.approval_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                    tc.approval_decided_at = ""
                    stale_reset_count += 1

        if stale_reset_count > 0:
            self._logger.info(
                "[INTERRUPT_CAPTURE] execution=%s "
                "reset %d stale approval_action(s) "
                "on ToolCalls that are pending again in a new cycle",
                self._execution_id, stale_reset_count,
            )


class ResumeReconciler:
    """Reconciles tool call status when resuming from approval.

    On resume, the StatusBuilder contains tool calls from the previous
    invocation still in WAITING_APPROVAL status. This class:

    1. Transitions each approved/skipped/rejected tool call to its
       post-decision status
    2. Syncs message-embedded ToolCall copies
    3. Auto-skips remaining tools on REJECT
    4. Advances pending_approvals to RESUME_RECONCILED (pruned server-side)
    5. Pre-populates fingerprints for LangGraph replay
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
        state_manager: ApprovalStateManager,
        logger: logging.Logger,
    ) -> None:
        self._execution_id = execution_id
        self._sb = status_builder
        self._sm = state_manager
        self._logger = logger

    def reconcile(
        self,
        *,
        approval_decisions: list[SubmitApprovalInput],
    ) -> None:
        """Run the full reconciliation pipeline."""
        decisions_by_tc = {d.tool_call_id: d for d in approval_decisions}
        reconciled_count = 0

        def _reconcile_tc(tc: Any, context: str) -> bool:
            nonlocal reconciled_count
            if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                return False
            decision = decisions_by_tc.get(tc.id)
            if decision is None:
                return False
            new_status = self._APPROVAL_TO_STATUS.get(
                decision.action, ToolCallStatus.TOOL_CALL_RUNNING
            )
            tc.status = new_status
            tc.approval_action = decision.action
            tc.approval_decided_at = _utc_timestamp()
            if decision.comment:
                tc.approved_by = decision.comment
            reconciled_count += 1
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "tool_call=%s name=%s context=%s "
                "WAITING_APPROVAL -> %s",
                self._execution_id, tc.id, tc.name, context,
                ToolCallStatus.Name(new_status),
            )
            return True

        for tc in self._sb.current_status.tool_calls:
            _reconcile_tc(tc, context="top-level")
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                _reconcile_tc(tc, context=f"sub-agent:{sa.name}")

        # Sync message-embedded copies
        for tc_id, decision in decisions_by_tc.items():
            new_status = self._APPROVAL_TO_STATUS.get(
                decision.action, ToolCallStatus.TOOL_CALL_RUNNING
            )
            self._sb._update_tool_call_on_ai_message(
                tool_call_id=tc_id,
                messages_list=self._sb.current_status.messages,
                status=new_status,
            )
        for sa in self._sb.current_status.sub_agent_executions:
            for tc_id, decision in decisions_by_tc.items():
                new_status = self._APPROVAL_TO_STATUS.get(
                    decision.action, ToolCallStatus.TOOL_CALL_RUNNING
                )
                self._sb._update_tool_call_on_ai_message(
                    tool_call_id=tc_id,
                    messages_list=sa.messages,
                    status=new_status,
                )

        # Warn about unreconciled WAITING_APPROVAL tool calls
        for tc in self._sb.current_status.tool_calls:
            if tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                self._logger.warning(
                    "[RESUME_RECONCILE] execution=%s "
                    "tool_call=%s name=%s still WAITING_APPROVAL "
                    "after reconciliation — no matching decision found "
                    "(decisions: %s)",
                    self._execution_id, tc.id, tc.name,
                    list(decisions_by_tc.keys()),
                )

        # Auto-skip on REJECT
        has_reject = any(
            d.action == ApprovalAction.APPROVAL_ACTION_REJECT
            for d in approval_decisions
        )
        if has_reject:
            self._auto_skip_remaining(decisions_by_tc)

        # Clear stale completed_at from the previous cycle.  The prior
        # invocation may have reached a terminal phase that stamped
        # completed_at.  Keeping it around while the execution re-enters
        # IN_PROGRESS / WAITING_FOR_APPROVAL causes the frontend to show
        # contradictory "completed" and "waiting" signals simultaneously.
        if self._sb.current_status.completed_at:
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s clearing stale "
                "completed_at=%s from previous cycle",
                self._execution_id,
                self._sb.current_status.completed_at,
            )
            self._sb.current_status.completed_at = ""

        # Advance pending_approvals to RESUME_RECONCILED.
        # The server-side merge logic (Java/Go) will prune entries at this
        # lifecycle state, keeping the field genuinely "pending" at rest.
        for pa in self._sb.current_status.pending_approvals:
            if pa.tool_call_id:
                self._sm.advance(
                    pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED,
                    service="ResumeReconciler",
                )

        self._sb.populate_fingerprints_from_existing_tool_calls()

        self._logger.info(
            "[RESUME_RECONCILE] execution=%s "
            "reconciled %d tool call(s), "
            "synced message-embedded copies, "
            "advanced pending_approvals to RESUME_RECONCILED, "
            "populated %d fingerprint(s)",
            self._execution_id, reconciled_count,
            len(self._sb.tool_call_fingerprints),
        )

    def _auto_skip_remaining(self, decisions_by_tc: dict[str, Any]) -> None:
        """Auto-skip WAITING_APPROVAL tools that weren't in the decision set."""
        def _skip(tc: Any, context: str) -> None:
            if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                return
            tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
            tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
            tc.approval_decided_at = _utc_timestamp()
            tc.result = (
                f"Tool '{tc.name}' was automatically skipped because "
                "another tool in this batch was rejected by the user."
            )
            self._logger.info(
                "[RESUME_RECONCILE] execution=%s "
                "tool_call=%s name=%s context=%s "
                "WAITING_APPROVAL -> TOOL_CALL_SKIPPED (auto-skip after reject)",
                self._execution_id, tc.id, tc.name, context,
            )

        for tc in self._sb.current_status.tool_calls:
            _skip(tc, context="top-level")
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                _skip(tc, context=f"sub-agent:{sa.name}")

        # Sync auto-skip to message-embedded copies
        for tc in self._sb.current_status.tool_calls:
            if tc.status == ToolCallStatus.TOOL_CALL_SKIPPED:
                self._sb._update_tool_call_on_ai_message(
                    tool_call_id=tc.id,
                    messages_list=self._sb.current_status.messages,
                    status=ToolCallStatus.TOOL_CALL_SKIPPED,
                )
        for sa in self._sb.current_status.sub_agent_executions:
            for tc in sa.tool_calls:
                if tc.status == ToolCallStatus.TOOL_CALL_SKIPPED:
                    self._sb._update_tool_call_on_ai_message(
                        tool_call_id=tc.id,
                        messages_list=sa.messages,
                        status=ToolCallStatus.TOOL_CALL_SKIPPED,
                    )


class CheckpointFallback:
    """Discovers interrupt IDs from LangGraph checkpoint when pending_approvals is empty.

    Defense-in-depth for the case where approval_decisions are present but
    pending_approvals was cleared upstream (e.g., by a deployment-transition
    race). Queries ``agent_graph.aget_state()`` to find interrupt IDs.
    """

    def __init__(
        self,
        *,
        execution_id: str,
        logger: logging.Logger,
    ) -> None:
        self._execution_id = execution_id
        self._logger = logger

    async def discover_interrupts(
        self,
        *,
        agent_graph: Any,
        config: Any,
        approval_decisions: list[SubmitApprovalInput],
        pending_approvals: list[PendingApproval],
        action_map: dict[ApprovalAction, str],
    ) -> dict[str, dict[str, str]]:
        """Query the LangGraph checkpoint and build a resume_dict.

        Returns a dict mapping ``interrupt_id -> {"action": ..., "comment": ...}``.
        Returns empty dict if checkpoint query fails or no interrupts found.
        """
        decisions_by_tc = {d.tool_call_id: d for d in approval_decisions}

        self._logger.warning(
            "[RESUME_CHECKPOINT_FALLBACK] pending_approvals empty but "
            "%d approval_decision(s) present. Attempting interrupt "
            "discovery from LangGraph checkpoint.",
            len(approval_decisions),
        )

        resume_dict: dict[str, dict[str, str]] = {}

        try:
            from typing import cast

            from langchain_core.runnables import RunnableConfig
            graph_state = await agent_graph.aget_state(cast(RunnableConfig, config))

            if not graph_state or not graph_state.interrupts:
                self._logger.warning(
                    "[RESUME_CHECKPOINT_FALLBACK] No interrupts in "
                    "checkpoint. LangGraph may have already processed "
                    "the resume. Proceeding with fresh execution."
                )
                return resume_dict

            self._logger.info(
                "[RESUME_CHECKPOINT_FALLBACK] Found %d interrupt(s) "
                "in checkpoint: %s",
                len(graph_state.interrupts),
                ", ".join(
                    f"id={i.id} tool_call_id={i.value.get('tool_call_id', '') if isinstance(i.value, dict) else ''}"
                    for i in graph_state.interrupts
                ),
            )

            remaining_decisions = dict(decisions_by_tc)
            for intr in graph_state.interrupts:
                if not remaining_decisions:
                    break
                intr_value = intr.value if isinstance(intr.value, dict) else {}
                intr_tc_id = intr_value.get("tool_call_id", "")

                matched_tc_id = None
                if intr_tc_id and intr_tc_id in remaining_decisions:
                    matched_tc_id = intr_tc_id

                if (
                    matched_tc_id is None
                    and len(graph_state.interrupts) == 1
                    and len(remaining_decisions) == 1
                ):
                    matched_tc_id = next(iter(remaining_decisions))

                if matched_tc_id is not None:
                    dec = remaining_decisions.pop(matched_tc_id)
                    action_str = action_map.get(dec.action, "unknown")
                    dv: dict[str, str] = {"action": action_str}
                    if dec.comment:
                        dv["comment"] = dec.comment
                    resume_dict[intr.id] = dv
                    self._logger.info(
                        "[RESUME_CHECKPOINT_FALLBACK] Matched "
                        "interrupt_id=%s to tool_call_id=%s via checkpoint",
                        intr.id, matched_tc_id,
                    )

        except Exception as e:
            self._logger.warning(
                "[RESUME_CHECKPOINT_FALLBACK] Checkpoint query failed: "
                "%s. Proceeding with fresh execution.", e,
            )

        return resume_dict


