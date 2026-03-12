"""Post-stream checkpoint validation.

Validates StatusBuilder's stream-derived state against the LangGraph
checkpoint's ground truth.  The checkpoint is the authoritative record
of what actually happened during execution; StatusBuilder's view is
derived from astream_events() callbacks and can diverge if events are
missed or the stream ends silently.

This module provides a pure validation function and typed result — it
never mutates StatusBuilder or the checkpoint.  The orchestrator
(execute_graphton.py) decides what to do with discrepancies.

Architecture note: astream_events() is an in-process async iterator,
so "dropped events" is a low-probability failure mode.  The primary
risk is the stream ending silently (graph crashes without raising an
exception), leaving StatusBuilder with stale state.  Checkpoint
validation catches this by comparing against the last committed
graph state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage

_logger = logging.getLogger(__name__)

_TASK_TOOL_NAME = "task"


@dataclass(frozen=True)
class Discrepancy:
    """A single validation finding from checkpoint comparison."""

    category: str
    severity: str
    description: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CheckpointValidationResult:
    """Aggregated result from post-stream checkpoint validation.

    Attributes:
        discrepancies: All findings, ordered by detection sequence.
        graph_is_terminated: True when the graph has no pending nodes
            (``graph_state.next`` is empty).
        unmatched_tool_call_count: Tool calls requested by the model
            that have no corresponding ToolMessage in the checkpoint.
        confirmed_orphan_count: Sub-agent task tool calls that are
            incomplete in BOTH checkpoint and StatusBuilder.
        missed_event_count: Sub-agents that completed in the checkpoint
            but StatusBuilder still considers active (on_tool_end missed).
    """

    discrepancies: tuple[Discrepancy, ...]
    graph_is_terminated: bool
    unmatched_tool_call_count: int
    confirmed_orphan_count: int
    missed_event_count: int

    @property
    def has_errors(self) -> bool:
        return any(d.severity == "error" for d in self.discrepancies)

    @property
    def has_warnings(self) -> bool:
        return any(d.severity == "warning" for d in self.discrepancies)


def _extract_tool_call_sets(
    messages: list[Any],
) -> tuple[dict[str, str], set[str]]:
    """Walk checkpoint messages and extract tool call ID sets.

    Returns:
        (requested, completed) where ``requested`` maps tool_call_id to
        tool_name for every tool call in AIMessages, and ``completed``
        is the set of tool_call_ids that have a matching ToolMessage.
    """
    requested: dict[str, str] = {}
    completed: set[str] = set()

    for msg in messages:
        if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls"):
            for tc in msg.tool_calls:
                if isinstance(tc, dict):
                    tc_id = tc.get("id", "")
                    tc_name = tc.get("name", "")
                else:
                    tc_id = getattr(tc, "id", "")  # type: ignore[unreachable]
                    tc_name = getattr(tc, "name", "")
                if tc_id:
                    requested[tc_id] = tc_name
        elif isinstance(msg, ToolMessage):
            tc_id = getattr(msg, "tool_call_id", "")
            if tc_id:
                completed.add(tc_id)

    return requested, completed


def validate_against_checkpoint(
    graph_state: Any,
    active_sub_agent_count: int,
    status_ai_message_count: int,
    execution_phase: int,
    waiting_for_approval_phase: int,
    paused_phase: int,
) -> CheckpointValidationResult:
    """Validate StatusBuilder's derived state against the LangGraph checkpoint.

    Pure function — reads inputs, returns results, never mutates anything.

    Args:
        graph_state: LangGraph StateSnapshot from ``aget_state()``.
            May be ``None`` if the checkpoint was never written.
        active_sub_agent_count: Number of sub-agents StatusBuilder
            considers active (``len(_active_sub_agents)``).
        status_ai_message_count: Number of ``MESSAGE_AI`` entries in
            StatusBuilder's ``current_status.messages``.
        execution_phase: Current ``ExecutionPhase`` int value.
        waiting_for_approval_phase: ``ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL``.
        paused_phase: ``ExecutionPhase.EXECUTION_PAUSED``.

    Returns:
        Validation result with categorized discrepancies.
    """
    discrepancies: list[Discrepancy] = []

    if graph_state is None:
        return CheckpointValidationResult(
            discrepancies=(
                Discrepancy(
                    category="graph_termination",
                    severity="warning",
                    description=(
                        "aget_state() returned None — checkpoint may not "
                        "have been written"
                    ),
                ),
            ),
            graph_is_terminated=True,
            unmatched_tool_call_count=0,
            confirmed_orphan_count=0,
            missed_event_count=0,
        )

    # ── V1: Graph Termination State ──────────────────────────────────────
    next_nodes = graph_state.next if hasattr(graph_state, "next") else ()
    graph_is_terminated = len(next_nodes) == 0

    if not graph_is_terminated:
        is_expected_pause = execution_phase in (
            waiting_for_approval_phase,
            paused_phase,
        )
        if not is_expected_pause:
            discrepancies.append(
                Discrepancy(
                    category="graph_termination",
                    severity="error",
                    description=(
                        f"Graph has pending nodes {list(next_nodes)} but "
                        f"stream ended without WAITING_FOR_APPROVAL or "
                        f"PAUSED phase"
                    ),
                    details={"pending_nodes": list(next_nodes)},
                )
            )

    # ── V2: Unmatched Tool Calls ─────────────────────────────────────────
    values = graph_state.values if hasattr(graph_state, "values") else {}
    messages = values.get("messages", []) if isinstance(values, dict) else []

    requested, completed = _extract_tool_call_sets(messages)
    unmatched_ids = set(requested.keys()) - completed
    unmatched_tool_call_count = len(unmatched_ids)

    if unmatched_tool_call_count > 0:
        unmatched_details = [
            {"tool_call_id": tc_id, "tool_name": requested[tc_id]}
            for tc_id in sorted(unmatched_ids)
        ]
        discrepancies.append(
            Discrepancy(
                category="unmatched_tool_calls",
                severity="error",
                description=(
                    f"{unmatched_tool_call_count} tool call(s) requested by "
                    f"the model have no corresponding ToolMessage in the "
                    f"checkpoint"
                ),
                details={"unmatched": unmatched_details},
            )
        )

    # ── V3: Sub-Agent Cross-Reference ────────────────────────────────────
    #
    # Cross-reference checkpoint tool completion for "task" tool calls
    # against StatusBuilder's active sub-agent count:
    #
    #   - Confirmed orphan: unmatched in checkpoint AND active in
    #     StatusBuilder (both agree the sub-agent didn't finish).
    #   - Missed event: checkpoint shows the task tool completed
    #     (ToolMessage exists) but StatusBuilder still tracks the
    #     sub-agent as active (on_tool_end was never processed).
    #   - Ghost sub-agent: checkpoint shows incomplete task tool call
    #     but StatusBuilder has no record (on_tool_start was missed).
    unmatched_task_count = sum(
        1
        for tc_id in unmatched_ids
        if requested.get(tc_id) == _TASK_TOOL_NAME
    )

    confirmed_orphan_count = 0
    missed_event_count = 0

    if unmatched_task_count == 0 and active_sub_agent_count > 0:
        missed_event_count = active_sub_agent_count
        discrepancies.append(
            Discrepancy(
                category="sub_agent_mismatch",
                severity="warning",
                description=(
                    f"Checkpoint confirms all sub-agent task tools completed, "
                    f"but StatusBuilder still tracks "
                    f"{active_sub_agent_count} active sub-agent(s) — "
                    f"on_tool_end events were likely missed"
                ),
                details={
                    "active_in_status_builder": active_sub_agent_count,
                    "unmatched_in_checkpoint": 0,
                },
            )
        )
    elif unmatched_task_count > 0 and active_sub_agent_count > 0:
        confirmed_orphan_count = min(
            unmatched_task_count, active_sub_agent_count
        )
        missed_event_count = max(
            0, active_sub_agent_count - unmatched_task_count
        )

        desc_parts = [
            f"{confirmed_orphan_count} confirmed orphaned sub-agent(s) "
            f"(incomplete in both checkpoint and StatusBuilder)"
        ]
        if missed_event_count > 0:
            desc_parts.append(
                f"{missed_event_count} sub-agent(s) completed in "
                f"checkpoint but StatusBuilder missed the event"
            )

        discrepancies.append(
            Discrepancy(
                category="sub_agent_mismatch",
                severity="error",
                description="; ".join(desc_parts),
                details={
                    "active_in_status_builder": active_sub_agent_count,
                    "unmatched_in_checkpoint": unmatched_task_count,
                    "confirmed_orphans": confirmed_orphan_count,
                    "missed_events": missed_event_count,
                },
            )
        )
    elif unmatched_task_count > 0 and active_sub_agent_count == 0:
        confirmed_orphan_count = unmatched_task_count
        discrepancies.append(
            Discrepancy(
                category="sub_agent_mismatch",
                severity="error",
                description=(
                    f"{unmatched_task_count} sub-agent task tool call(s) in "
                    f"checkpoint have no ToolMessage and were never tracked "
                    f"by StatusBuilder (ghost sub-agents)"
                ),
                details={
                    "active_in_status_builder": 0,
                    "unmatched_in_checkpoint": unmatched_task_count,
                },
            )
        )

    # ── V4: AI Message Count (Soft Check) ────────────────────────────────
    checkpoint_ai_count = sum(
        1 for msg in messages if isinstance(msg, AIMessage)
    )

    count_diff = abs(checkpoint_ai_count - status_ai_message_count)
    if count_diff > 1:
        discrepancies.append(
            Discrepancy(
                category="message_count",
                severity="warning",
                description=(
                    f"AI message count divergence: checkpoint has "
                    f"{checkpoint_ai_count}, StatusBuilder has "
                    f"{status_ai_message_count} (diff={count_diff})"
                ),
                details={
                    "checkpoint_count": checkpoint_ai_count,
                    "status_builder_count": status_ai_message_count,
                    "difference": count_diff,
                },
            )
        )

    return CheckpointValidationResult(
        discrepancies=tuple(discrepancies),
        graph_is_terminated=graph_is_terminated,
        unmatched_tool_call_count=unmatched_tool_call_count,
        confirmed_orphan_count=confirmed_orphan_count,
        missed_event_count=missed_event_count,
    )


def build_error_from_validation(
    validation: CheckpointValidationResult,
) -> str:
    """Build a user-facing error string from validation discrepancies.

    Only includes ERROR-severity discrepancies.  Returns an empty string
    when there are no errors (caller should not use this in that case).
    """
    error_parts: list[str] = []
    for d in validation.discrepancies:
        if d.severity == "error":
            error_parts.append(d.description)

    if not error_parts:
        return ""

    return (
        "Checkpoint validation detected execution inconsistencies: "
        + "; ".join(error_parts)
    )
