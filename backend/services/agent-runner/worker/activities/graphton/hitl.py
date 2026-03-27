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
    ApprovalLifecycleState.APPROVAL_LIFECYCLE_CLEARED: 5,
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

    Priority chain:
      1. run_id  — via ``status_builder._run_id_aliases``
      2. fingerprint — via ``status_builder._fingerprint_to_tool_call_id``
      3. name — first WAITING_APPROVAL tool with matching name

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
                "id=%s tool_name=%s from_sub_agent=%s "
                "sub_agent_name=%s run_id=%s value_type=%s",
                _diag_idx,
                _diag_intr.id,
                _diag_val.get("tool_name", "") if isinstance(_diag_val, dict) else "",
                _diag_val.get("from_sub_agent", False) if isinstance(_diag_val, dict) else False,
                _diag_val.get("sub_agent_name", "") if isinstance(_diag_val, dict) else "",
                _diag_val.get("run_id", "") if isinstance(_diag_val, dict) else "",
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
            tool_name = intr_value.get("tool_name", "") if isinstance(intr_value, dict) else ""
            tool_args = intr_value.get("tool_args", {}) if isinstance(intr_value, dict) else {}
            message = intr_value.get("message", "") if isinstance(intr_value, dict) else ""
            from_sub_agent = intr_value.get("from_sub_agent", False) if isinstance(intr_value, dict) else False
            sub_agent_name = intr_value.get("sub_agent_name", "") if isinstance(intr_value, dict) else ""
            intr_run_id = intr_value.get("run_id", "") if isinstance(intr_value, dict) else ""

            matched_tool_call_id = self._match_interrupt(
                intr=intr,
                tool_name=tool_name,
                tool_args=tool_args,
                from_sub_agent=from_sub_agent,
                intr_run_id=intr_run_id,
                matched_tc_ids=matched_tc_ids,
            )

            if not matched_tool_call_id:
                fallback_enriched = self._try_enrich_phase1_entry(
                    tool_name, from_sub_agent, intr.id,
                )
                if fallback_enriched:
                    enriched_count += 1
                    self._logger.info(
                        "[INTERRUPT_CAPTURE] execution=%s "
                        "interrupt %s tool=%s from_sub_agent=%s — "
                        "enriched Phase 1 entry via tool_name fallback",
                        self._execution_id, intr.id, tool_name, from_sub_agent,
                    )
                else:
                    skipped_count += 1
                    self._logger.warning(
                        "[INTERRUPT_CAPTURE] execution=%s "
                        "cannot match interrupt %s tool=%s "
                        "from_sub_agent=%s to any tool call — "
                        "Phase 1 entries preserved",
                        self._execution_id, intr.id, tool_name, from_sub_agent,
                    )
                continue

            args_preview = self._sb._create_args_preview(tool_args)
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
                stale_phase1 = [
                    pa for pa in phase1_by_tc_id.values()
                    if pa.tool_name == tool_name
                    and pa.tool_call_id != matched_tool_call_id
                ]
                if stale_phase1:
                    for stale_pa in stale_phase1:
                        self._logger.warning(
                            "[INTERRUPT_CAPTURE] execution=%s "
                            "Phase 1 has tc_id=%s but interrupt matched "
                            "tc_id=%s for tool=%s — removing stale Phase 1 entry",
                            self._execution_id, stale_pa.tool_call_id,
                            matched_tool_call_id, tool_name,
                        )
                        try:
                            self._sb.current_status.pending_approvals.remove(stale_pa)
                        except ValueError:
                            pass

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
        intr: Any,
        tool_name: str,
        tool_args: dict[str, Any],
        from_sub_agent: bool,
        intr_run_id: str,
        matched_tc_ids: set[str],
    ) -> str:
        """Run the Priority 1/2/3 matching chain. Returns matched tool_call_id or ""."""
        matched = ""

        # Priority 1: run_id
        if intr_run_id:
            resolved = self._sb._run_id_aliases.get(intr_run_id, intr_run_id)
            if resolved not in matched_tc_ids:
                matched = resolved
                matched_tc_ids.add(resolved)
            else:
                self._logger.info(
                    "[INTERRUPT_CAPTURE] execution=%s "
                    "run_id=%s resolved=%s already in matched_tc_ids — falling through",
                    self._execution_id, intr_run_id, resolved,
                )
        elif tool_name:
            self._logger.info(
                "[INTERRUPT_CAPTURE] execution=%s "
                "interrupt %s tool=%s has empty run_id — "
                "falling through to fingerprint/name matching",
                self._execution_id, intr.id, tool_name,
            )

        # Priority 2: fingerprint
        if not matched and tool_args:
            intr_fp = self._sb._get_tool_fingerprint(tool_name, tool_args)
            fp_tc_id = self._sb._fingerprint_to_tool_call_id.get(intr_fp, "")
            if fp_tc_id and fp_tc_id not in matched_tc_ids:
                if self._verify_waiting_approval(fp_tc_id):
                    matched = fp_tc_id
                    matched_tc_ids.add(fp_tc_id)
                    self._logger.info(
                        "[INTERRUPT_CAPTURE] execution=%s "
                        "interrupt %s matched via fingerprint: tool=%s tc_id=%s",
                        self._execution_id, intr.id, tool_name, fp_tc_id,
                    )

        # Priority 3: name
        if not matched and tool_name:
            matched = self._match_by_name(
                tool_name=tool_name,
                from_sub_agent=from_sub_agent,
                matched_tc_ids=matched_tc_ids,
                intr_id=intr.id,
            )

        return matched

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

    def _match_by_name(
        self,
        *,
        tool_name: str,
        from_sub_agent: bool,
        matched_tc_ids: set[str],
        intr_id: str,
    ) -> str:
        """Priority 3: name-based matching with sub-agent scope awareness."""
        resolve = self._resolve_platform_tool_name

        candidates = [
            tc.id
            for tc in self._sb.current_status.tool_calls
            if (tc.name == tool_name or resolve(tc.name) == tool_name)
            and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
            and tc.id not in matched_tc_ids
        ]
        self._logger.info(
            "[INTERRUPT_CAPTURE] execution=%s "
            "interrupt %s falling back to name matching: "
            "tool=%s from_sub_agent=%s candidates=%s",
            self._execution_id, intr_id, tool_name, from_sub_agent, candidates,
        )

        if from_sub_agent:
            for sa in self._sb.current_status.sub_agent_executions:
                for tc in sa.tool_calls:
                    if (
                        (tc.name == tool_name or resolve(tc.name) == tool_name)
                        and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                        and tc.id not in matched_tc_ids
                    ):
                        matched_tc_ids.add(tc.id)
                        return tc.id
            # Fallthrough: search top-level too
            for tc in self._sb.current_status.tool_calls:
                if (
                    (tc.name == tool_name or resolve(tc.name) == tool_name)
                    and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                    and tc.id not in matched_tc_ids
                ):
                    matched_tc_ids.add(tc.id)
                    return tc.id
        else:
            for tc in self._sb.current_status.tool_calls:
                if (
                    (tc.name == tool_name or resolve(tc.name) == tool_name)
                    and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                    and tc.id not in matched_tc_ids
                ):
                    matched_tc_ids.add(tc.id)
                    return tc.id
            # Defense-in-depth: search sub-agent tool calls too
            for sa in self._sb.current_status.sub_agent_executions:
                for tc in sa.tool_calls:
                    if (
                        (tc.name == tool_name or resolve(tc.name) == tool_name)
                        and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                        and tc.id not in matched_tc_ids
                    ):
                        matched_tc_ids.add(tc.id)
                        return tc.id

        return ""

    def _try_enrich_phase1_entry(
        self,
        tool_name: str,
        from_sub_agent: bool,
        interrupt_id: str,
    ) -> bool:
        """Fallback enrichment when the interrupt could not be matched by run_id or fingerprint.

        Searches ``current_status.pending_approvals`` for a Phase 1 entry that
        matches ``tool_name`` and does not already have an ``interrupt_id``.

        If found, sets the ``interrupt_id`` and advances lifecycle to
        INTERRUPT_CAPTURED via the state manager.
        """
        for pa in self._sb.current_status.pending_approvals:
            if (
                pa.tool_name == tool_name
                and pa.from_sub_agent == from_sub_agent
                and not pa.interrupt_id
            ):
                pa.interrupt_id = interrupt_id
                self._sm.advance(
                    pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                    service="InterruptCapture",
                )
                return True
        for pa in self._sb.current_status.pending_approvals:
            if pa.tool_name == tool_name and not pa.interrupt_id:
                pa.interrupt_id = interrupt_id
                self._sm.advance(
                    pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
                    service="InterruptCapture",
                )
                return True
        return False

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
    4. Clears pending_approvals with the clear-signal sentinel
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

        # Advance pending_approvals to RESUME_RECONCILED, then clear
        for pa in self._sb.current_status.pending_approvals:
            if pa.tool_call_id:
                self._sm.advance(
                    pa,
                    target_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_RESUME_RECONCILED,
                    service="ResumeReconciler",
                )
        del self._sb.current_status.pending_approvals[:]
        self._sb.current_status.pending_approvals.append(
            PendingApproval(
                tool_call_id="",
                lifecycle_state=ApprovalLifecycleState.APPROVAL_LIFECYCLE_CLEARED,
            )
        )

        self._sb.populate_fingerprints_from_existing_tool_calls()

        self._logger.info(
            "[RESUME_RECONCILE] execution=%s "
            "reconciled %d tool call(s), "
            "synced message-embedded copies, "
            "queued pending_approvals clear-signal, "
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
                    f"id={i.id} tool={i.value.get('tool_name', '') if isinstance(i.value, dict) else ''}"
                    for i in graph_state.interrupts
                ),
            )

            remaining_decisions = dict(decisions_by_tc)
            for intr in graph_state.interrupts:
                if not remaining_decisions:
                    break
                intr_value = intr.value if isinstance(intr.value, dict) else {}
                intr_tool = intr_value.get("tool_name", "")

                matched_tc_id = None
                for tc_id, dec in remaining_decisions.items():
                    if intr_tool and intr_tool == next(
                        (
                            pa.tool_name
                            for pa in pending_approvals
                            if pa.tool_call_id == tc_id
                        ),
                        "",
                    ):
                        matched_tc_id = tc_id
                        break

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
                        "interrupt_id=%s to tool_call_id=%s "
                        "(tool=%s) via checkpoint",
                        intr.id, matched_tc_id, intr_tool,
                    )

        except Exception as e:
            self._logger.warning(
                "[RESUME_CHECKPOINT_FALLBACK] Checkpoint query failed: "
                "%s. Proceeding with fresh execution.", e,
            )

        return resume_dict


