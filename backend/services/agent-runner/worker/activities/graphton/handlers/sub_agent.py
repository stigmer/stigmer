"""Sub-agent lifecycle management: creation, completion, and finalization.

All functions receive the ``StatusBuilder`` instance as their first argument.
Module-level helpers (subject generation) are self-contained.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    MessageType,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from graphton.core import ModelRegistry
from graphton.core.models import parse_model_string
from langchain_core.messages import HumanMessage, SystemMessage

from worker.activities.graphton.handlers import formatting
from worker.config import Config

if TYPE_CHECKING:
    from worker.activities.graphton.status_builder import StatusBuilder

_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sub-Agent Subject Generation
# ---------------------------------------------------------------------------

_MAX_SUBJECT_LENGTH = 50

_SUBJECT_SYSTEM_PROMPT = """\
You are a task title generator. Given a task description delegated to a \
sub-agent, produce a concise task title.

Rules:
- 3 to 7 words, maximum 50 characters
- Lead with the most specific differentiator — the directory, file, module, \
or unique aspect. Put shared/common context last.
  Good: "apis/ protobuf Cloud Resource types"
  Bad:  "Research Cloud Resource protobuf definitions"
- If the description mentions a specific path or directory, include it
- Be specific (e.g. "Fix auth middleware tests" not "Fix tests")
- No filler words ("help with", "please", "I need", "research", "explore")
- The title MUST be unique — it must NOT duplicate any of the existing titles \
listed below. Focus on what makes THIS task different from the others.
- No quotes, no punctuation at the end
- Output ONLY the title, nothing else"""


async def _generate_sub_agent_subject(
    input_text: str,
    sub_agent_name: str,
    existing_subjects: list[str] | None = None,
) -> str:
    """Generate a concise task title for a sub-agent from its input prompt.

    Uses ``ModelRegistry.get_summarization_model()`` to select the cheapest
    available model (claude-haiku-4.5 / gpt-4o-mini / same model for Ollama),
    keeping costs negligible even with many sub-agent invocations per execution.

    When *existing_subjects* is provided (non-empty), the LLM is instructed to
    produce a title that does not duplicate any of them, ensuring visual
    differentiation in the UI.

    Returns the generated subject (stripped, truncated to 50 chars), or an
    empty string on any failure so callers can fall back gracefully.
    """
    if not input_text:
        return ""

    try:
        worker_config = Config.load_from_env()
        economy_model = ModelRegistry.get_summarization_model(
            worker_config.llm.model_name
        )

        llm_kwargs = worker_config.llm.build_llm_kwargs(
            proxy_endpoint=worker_config.stigmer_proxy_endpoint,
            proxy_auth_token=worker_config.stigmer_token,
        )

        model = parse_model_string(
            economy_model,
            max_tokens=100,
            temperature=0.7,
            **llm_kwargs,
        )

        truncated_input = input_text[:2000] if len(input_text) > 2000 else input_text

        existing_block = ""
        if existing_subjects:
            titles = "\n".join(f"- {s}" for s in existing_subjects)
            existing_block = (
                f"\nExisting titles (do NOT repeat these):\n{titles}\n"
            )

        user_prompt = (
            f'Sub-agent type: {sub_agent_name}\n'
            f'{existing_block}\n'
            f'Task description:\n"{truncated_input}"\n\n'
            f'Generate the title:'
        )

        response = await model.ainvoke([
            SystemMessage(content=_SUBJECT_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ])

        content = response.content
        if not isinstance(content, str):
            content = (
                "".join(str(part) for part in content)
                if isinstance(content, list)
                else str(content)
            )
        subject = content.strip().strip('"').strip("'")

        if subject and len(subject) > _MAX_SUBJECT_LENGTH:
            subject = subject[:_MAX_SUBJECT_LENGTH - 3] + "..."

        return subject or ""

    except Exception:
        _logger.debug(
            "Sub-agent subject generation failed (non-critical), "
            "falling back to empty subject",
            exc_info=True,
        )
        return ""


def _utc_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


# Maximum characters for tool_call.result in the status proto payload.
_MAX_STATUS_RESULT_CHARS: int = 50_000


# ---------------------------------------------------------------------------
# Sub-agent lifecycle handlers
# ---------------------------------------------------------------------------


async def handle_sub_agent_start(
    sb: StatusBuilder,
    event: dict[str, Any],
    tool_args: dict[str, Any],
    run_id: str,
    *,
    tool_call_id: str | None = None,
) -> None:
    """Handle task tool invocation — creates SubAgentExecution.

    In deepagents' task tool, ``description`` is the full task prompt (the
    only text parameter alongside ``subagent_type``).  We map it to
    ``input`` and generate a concise ``subject`` via an economy-tier LLM.

    The SubAgentExecution.id is set to *tool_call_id* (the Anthropic
    ``tool_use`` id, e.g. ``toolu_XXXXX``) so the frontend can match it
    against the ToolCall.id on the parent AI message.  The LangGraph
    *run_id* is stored separately in ``_active_sub_agents`` for namespace
    registration (which operates on run_ids from LangGraph events).
    """
    sa_id = tool_call_id or run_id

    for existing_sa in sb.current_status.sub_agent_executions:
        if existing_sa.id == sa_id:
            if existing_sa.status in (
                SubAgentStatus.SUB_AGENT_COMPLETED,
                SubAgentStatus.SUB_AGENT_FAILED,
                SubAgentStatus.SUB_AGENT_CANCELLED,
            ):
                sb.state.completed_sub_agents[run_id] = existing_sa
                sb.state.run_id_to_tool_call_id[run_id] = sa_id
                sb.logger.info(
                    "[SUBAGENT] execution=%s resume reactivation: "
                    "sa_id=%s run_id=%s routed to completed_sub_agents "
                    "(status=%s — not reactivating into active)",
                    sb.execution_id, sa_id, run_id,
                    SubAgentStatus.Name(existing_sa.status),
                )
                return

            if sa_id in sb.state.active_sub_agents and sa_id != run_id:
                del sb.state.active_sub_agents[sa_id]
            sb.state.pending_resume_sa_ids.discard(sa_id)

            sb.state.active_sub_agents[run_id] = existing_sa
            sb.state.run_id_to_tool_call_id[run_id] = sa_id
            sb.logger.info(
                "[SUBAGENT] execution=%s resume reactivation: "
                "sa_id=%s run_id=%s (skipping duplicate creation)",
                sb.execution_id, sa_id, run_id,
            )
            return

    sub_agent_name = tool_args.get("subagent_type", "") or tool_args.get("agent_type", "") or "unknown"

    _builtin_types = {"explore", "shell"}
    if sub_agent_name in _builtin_types:
        sb.logger.info(
            "[SUBAGENT] execution=%s starting built-in '%s' subagent "
            "(tool-restricted, isolated prompt)",
            sb.execution_id, sub_agent_name,
        )

    sub_agent_input = (
        tool_args.get("description", "")
        or tool_args.get("input", "")
        or tool_args.get("task", "")
        or tool_args.get("prompt", "")
    )
    existing = list(sb.state.subject_counts.keys())
    subject = await _generate_sub_agent_subject(
        sub_agent_input, sub_agent_name, existing_subjects=existing,
    )

    if subject:
        count = sb.state.subject_counts.get(subject, 0) + 1
        sb.state.subject_counts[subject] = count
        if count > 1:
            suffix = f" ({count})"
            max_base = _MAX_SUBJECT_LENGTH - len(suffix)
            base = subject[:max_base] if len(subject) > max_base else subject
            subject = base + suffix

    now = datetime.utcnow()
    sub_agent = SubAgentExecution(
        id=sa_id,
        name=sub_agent_name,
        input=sub_agent_input,
        subject=subject,
        status=SubAgentStatus.SUB_AGENT_IN_PROGRESS,
        started_at=_utc_timestamp(now),
    )

    sb.current_status.sub_agent_executions.append(sub_agent)
    sb.state.active_sub_agents[run_id] = sb.current_status.sub_agent_executions[-1]
    sb.state.run_id_to_tool_call_id[run_id] = sa_id

    sb.force_next_update = True

    sb.logger.info(
        f"[SUBAGENT] execution={sb.execution_id} "
        f"sub_agent={sub_agent_name} sa_id={sa_id} run_id={run_id} "
        f"subject={subject!r} status=IN_PROGRESS"
    )


def handle_sub_agent_end(sb: StatusBuilder, event: dict[str, Any], run_id: str) -> None:
    """Handle task tool completion — finalize SubAgentExecution."""
    output_raw = event.get("data", {}).get("output", "")
    output = formatting.extract_tool_result_content(output_raw)
    now = datetime.utcnow()

    is_error = False
    error_message = ""
    if isinstance(output_raw, dict):
        if output_raw.get("error") or output_raw.get("status") == "failed":
            is_error = True
            error_message = (
                output_raw.get("error", "")
                or output_raw.get("message", "Sub-agent failed")
            )

    sub_agent_ref = sb.state.active_sub_agents.get(run_id)
    if sub_agent_ref is None:
        sa_id = sb.state.run_id_to_tool_call_id.get(run_id, run_id)
        for sa in sb.current_status.sub_agent_executions:
            if sa.id == sa_id:
                sub_agent_ref = sa
                break

    if sub_agent_ref is not None:
        sub_agent_ref.output = output
        sub_agent_ref.completed_at = _utc_timestamp(now)
        if is_error:
            sub_agent_ref.status = SubAgentStatus.SUB_AGENT_FAILED
            sub_agent_ref.error = error_message
        else:
            sub_agent_ref.status = SubAgentStatus.SUB_AGENT_COMPLETED

        finalize_orphaned_tool_calls(sb, sub_agent_ref, now)

        sb.logger.debug(
            "[SUBAGENT] execution=%s sa_id=%s run_id=%s status=%s",
            sb.execution_id, sub_agent_ref.id, run_id,
            "FAILED" if is_error else "COMPLETED",
        )
    else:
        sb.logger.warning(
            "[SUBAGENT] execution=%s _handle_sub_agent_end: "
            "no SubAgentExecution found for run_id=%s "
            "known_ids=%s",
            sb.execution_id, run_id,
            [sa.id for sa in sb.current_status.sub_agent_executions],
        )

    tc_id = sb.state.run_id_to_tool_call_id.get(run_id)
    if tc_id:
        parent_tc = sb.get_tool_call(tc_id)
        if parent_tc is not None:
            parent_tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
            parent_tc.completed_at = _utc_timestamp(now)
            parent_tc.result = output[:_MAX_STATUS_RESULT_CHARS] if output else ""

    if run_id in sb.state.active_sub_agents:
        sb.state.completed_sub_agents[run_id] = sb.state.active_sub_agents.pop(run_id)

    sb.state.pending_completion_flush[run_id] = time.monotonic()


def finalize_orphaned_tool_calls(
    sb: StatusBuilder, sub_agent: SubAgentExecution, now: datetime,
) -> None:
    """Transition orphaned WAITING_APPROVAL tool calls to SKIPPED."""
    timestamp = _utc_timestamp(now)
    skipped = 0
    for msg in sub_agent.messages:
        for tc in msg.tool_calls:
            if (
                tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                and tc.requires_approval
                and tc.approval_action == ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
            ):
                tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
                tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
                tc.approval_decided_at = timestamp
                tc.result = "Auto-skipped: parent sub-agent finished"
                skipped += 1
    if skipped:
        sb.logger.info(
            "[SUBAGENT] execution=%s sa_id=%s "
            "finalized %d orphaned WAITING_APPROVAL tool call(s)",
            sb.execution_id, sub_agent.id, skipped,
        )


def get_orphaned_diagnostic(sb: StatusBuilder) -> dict:
    """Return structured info about orphaned (still-active) sub-agents."""
    zero_message: list[dict] = []
    mid_execution: list[dict] = []

    for run_id, sub_agent in sb.state.active_sub_agents.items():
        tc_count = sum(len(m.tool_calls) for m in sub_agent.messages)
        has_activity = len(sub_agent.messages) > 0
        entry = {
            "run_id": run_id,
            "subject": sub_agent.subject,
            "message_count": len(sub_agent.messages),
            "tool_call_count": tc_count,
        }
        if has_activity:
            mid_execution.append(entry)
        else:
            zero_message.append(entry)

    return {
        "total": len(sb.state.active_sub_agents),
        "zero_message_count": len(zero_message),
        "mid_execution_count": len(mid_execution),
        "zero_message": zero_message,
        "mid_execution": mid_execution,
    }


def flush_pending_completions(sb: StatusBuilder) -> list[str]:
    """Immediately drain all pending completion flushes."""
    if not sb.state.pending_completion_flush:
        return []

    flushed = list(sb.state.pending_completion_flush.keys())
    sb.state.pending_completion_flush.clear()
    if flushed:
        sb.force_next_update = True
    return flushed


def finalize_active(sb: StatusBuilder, status: SubAgentStatus, error: str) -> None:
    """Transition active sub-agents to a terminal state.

    Called when the parent execution terminates abnormally (error or stall)
    to ensure no sub-agent remains stuck in IN_PROGRESS.
    """
    flushed = flush_pending_completions(sb)
    if flushed:
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"flushed {len(flushed)} pending completion(s) before "
            f"finalization: {flushed}"
        )

    if not sb.state.active_sub_agents:
        return

    now = _utc_timestamp()
    finalized_ids: list[str] = []
    preserved_ids: list[str] = []

    terminal_statuses = {
        SubAgentStatus.SUB_AGENT_COMPLETED,
        SubAgentStatus.SUB_AGENT_FAILED,
        SubAgentStatus.SUB_AGENT_CANCELLED,
    }

    for run_id, sub_agent in list(sb.state.active_sub_agents.items()):
        if sub_agent.status in terminal_statuses or sub_agent.output:
            preserved_ids.append(run_id)
        else:
            sub_agent.status = status
            sub_agent.error = error
            sub_agent.completed_at = now
            finalized_ids.append(run_id)

        sb.state.completed_sub_agents[run_id] = sub_agent

    sb.state.active_sub_agents.clear()

    sb.logger.info(
        f"[SUBAGENT] execution={sb.execution_id} "
        f"finalized {len(finalized_ids)} active sub-agent(s) "
        f"-> {SubAgentStatus.Name(status)}: {finalized_ids}"
    )
    if preserved_ids:
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"preserved {len(preserved_ids)} sub-agent(s) with "
            f"existing terminal status or output: {preserved_ids}"
        )


def finalize_active_differentiated(sb: StatusBuilder, error_context: str) -> int:
    """Transition active sub-agents using differentiated statuses.

    Zero-message sub-agents receive SUB_AGENT_CANCELLED; sub-agents with
    messages or tool calls receive SUB_AGENT_FAILED.
    """
    flushed = flush_pending_completions(sb)
    if flushed:
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"flushed {len(flushed)} pending completion(s) before "
            f"differentiated finalization: {flushed}"
        )

    if not sb.state.active_sub_agents:
        return 0

    now = _utc_timestamp()
    cancelled_ids: list[str] = []
    failed_ids: list[str] = []
    preserved_ids: list[str] = []

    terminal_statuses = {
        SubAgentStatus.SUB_AGENT_COMPLETED,
        SubAgentStatus.SUB_AGENT_FAILED,
        SubAgentStatus.SUB_AGENT_CANCELLED,
    }

    for run_id, sub_agent in list(sb.state.active_sub_agents.items()):
        if sub_agent.status in terminal_statuses or sub_agent.output:
            preserved_ids.append(run_id)
        else:
            tc_count = sum(len(m.tool_calls) for m in sub_agent.messages)
            has_activity = len(sub_agent.messages) > 0
            if has_activity:
                sub_agent.status = SubAgentStatus.SUB_AGENT_FAILED
                sub_agent.error = (
                    f"{error_context}: sub-agent was running "
                    f"({len(sub_agent.messages)} messages, "
                    f"{tc_count} tool calls)"
                )
                failed_ids.append(run_id)
            else:
                sub_agent.status = SubAgentStatus.SUB_AGENT_CANCELLED
                sub_agent.error = (
                    f"{error_context}: sub-agent was spawned but never began execution"
                )
                cancelled_ids.append(run_id)

            sub_agent.completed_at = now

        sb.state.completed_sub_agents[run_id] = sub_agent

    total = len(sb.state.active_sub_agents)
    sb.state.active_sub_agents.clear()

    finalized = len(cancelled_ids) + len(failed_ids)
    sb.logger.info(
        f"[SUBAGENT] execution={sb.execution_id} "
        f"finalized {finalized}/{total} orphaned sub-agent(s) — "
        f"CANCELLED (zero-message): {cancelled_ids}, "
        f"FAILED (mid-execution): {failed_ids}"
    )
    if preserved_ids:
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"preserved {len(preserved_ids)} sub-agent(s) with "
            f"existing terminal status or output: {preserved_ids}"
        )
    return total


def finalize_from_checkpoint_validation(
    sb: StatusBuilder,
    missed_event_count: int,
    confirmed_orphan_count: int,
    error_context: str,
) -> int:
    """Finalize active sub-agents using checkpoint validation results."""
    flush_pending_completions(sb)

    if not sb.state.active_sub_agents:
        return 0

    now = _utc_timestamp()
    total = len(sb.state.active_sub_agents)

    if missed_event_count > 0 and confirmed_orphan_count == 0:
        completed_ids: list[str] = []
        for run_id, sub_agent in list(sb.state.active_sub_agents.items()):
            sub_agent.status = SubAgentStatus.SUB_AGENT_COMPLETED
            sub_agent.completed_at = now
            sb.state.completed_sub_agents[run_id] = sub_agent
            completed_ids.append(run_id)

        sb.state.active_sub_agents.clear()
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"checkpoint confirms {total} sub-agent(s) completed "
            f"(StatusBuilder missed on_tool_end events): "
            f"{completed_ids}"
        )
    else:
        cancelled_ids: list[str] = []
        failed_ids: list[str] = []

        for run_id, sub_agent in list(sb.state.active_sub_agents.items()):
            tc_count = sum(len(m.tool_calls) for m in sub_agent.messages)
            has_activity = (
                len(sub_agent.messages) > 0
                or tc_count > 0
            )
            if has_activity:
                sub_agent.status = SubAgentStatus.SUB_AGENT_FAILED
                sub_agent.error = (
                    f"{error_context}: sub-agent was running "
                    f"({len(sub_agent.messages)} messages, "
                    f"{tc_count} tool calls)"
                )
                failed_ids.append(run_id)
            else:
                sub_agent.status = SubAgentStatus.SUB_AGENT_CANCELLED
                sub_agent.error = (
                    f"{error_context}: sub-agent was spawned but "
                    f"never began execution"
                )
                cancelled_ids.append(run_id)

            sub_agent.completed_at = now
            sb.state.completed_sub_agents[run_id] = sub_agent

        sb.state.active_sub_agents.clear()

        qualifier = (
            "confirmed orphaned"
            if missed_event_count == 0
            else "mixed (some may have completed per checkpoint)"
        )
        sb.logger.info(
            f"[SUBAGENT] execution={sb.execution_id} "
            f"finalized {total} {qualifier} sub-agent(s) — "
            f"CANCELLED (zero-message): {cancelled_ids}, "
            f"FAILED (mid-execution): {failed_ids}"
        )

    return total


def pre_register_in_progress_sub_agents(sb: StatusBuilder) -> int:
    """Pre-register IN_PROGRESS sub-agents in active_sub_agents for resume.

    On resume, LangGraph may not replay ``on_tool_start`` for all concurrent
    task tools.  This leaves some sub-agents absent from ``active_sub_agents``,
    causing their events to fail namespace routing and be misrouted.

    This function ensures every IN_PROGRESS sub-agent is present in
    ``active_sub_agents`` (keyed by its own ``id``) before the stream starts.
    When ``handle_sub_agent_start`` fires later with the real LangGraph
    run_id, it re-keys the entry and removes the placeholder.  For sub-agents
    whose ``on_tool_start`` never fires, the deferred-binding path in
    ``_register_sub_agent_namespace`` claims the placeholder.

    Must be called after ``rebuild_index_from_persisted_status`` and
    ``prepare_task_tool_resume_queue``, before the stream starts.
    """
    registered = 0
    for sa in sb.current_status.sub_agent_executions:
        if sa.status != SubAgentStatus.SUB_AGENT_IN_PROGRESS:
            continue
        already_active = (
            sa.id in sb.state.active_sub_agents
            or any(ref is sa for ref in sb.state.active_sub_agents.values())
        )
        if already_active:
            continue

        sb.state.active_sub_agents[sa.id] = sa
        sb.state.pending_resume_sa_ids.add(sa.id)
        registered += 1
        sb.logger.info(
            "[RESUME_PREP] execution=%s pre-registered IN_PROGRESS "
            "sub-agent sa_id=%s in active_sub_agents (placeholder key)",
            sb.execution_id, sa.id,
        )

    return registered


def prepare_task_tool_resume_queue(sb: StatusBuilder) -> int:
    """Pre-populate the early tool call queue for task tools on resume.

    On resume from a sub-agent HITL interrupt, ``astream_events`` does
    NOT replay the AI message's ``tool_use`` blocks.  This method scans
    persisted messages for task tool calls that have a corresponding
    SubAgentExecution and queues them for reconciliation.

    Must be called **after** ``rebuild_index_from_persisted_status``
    and **before** the stream starts.

    Returns the number of task tool calls queued.
    """
    sa_ids = {sa.id for sa in sb.current_status.sub_agent_executions}
    queued = 0

    for msg in sb.current_status.messages:
        if msg.type != MessageType.MESSAGE_AI:
            continue
        for tc in msg.tool_calls:
            if tc.name != "task" or not tc.id:
                continue
            if tc.id not in sa_ids:
                continue
            already_queued = any(
                tid == tc.id for tid, _ in sb.state.early_tool_call_queue
            )
            if already_queued:
                continue

            sb.state.early_tool_call_queue.append((tc.id, None))
            queued += 1
            sb.logger.info(
                "[RESUME_PREP] execution=%s pre-queued task TC %s "
                "for sub-agent resume reconciliation",
                sb.execution_id, tc.id,
            )

    return queued
