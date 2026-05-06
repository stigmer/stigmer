"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import inspect
import logging
from collections.abc import Callable, Coroutine, Iterator
from datetime import datetime
from typing import Any

from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    AgentMessage,
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from graphton.core.summarization_callback import SummarizationEventData

from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig
from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState
from stigmer_runner.worker.activities.graphton.handlers import (
    chat_model as chat_model_handlers,
)
from stigmer_runner.worker.activities.graphton.handlers import (
    context as context_handlers,
)
from stigmer_runner.worker.activities.graphton.handlers import (
    formatting,
    streaming_buffers,
)
from stigmer_runner.worker.activities.graphton.handlers import (
    sub_agent as sub_agent_handlers,
)
from stigmer_runner.worker.activities.graphton.handlers import (
    tool_event as tool_event_handlers,
)
from stigmer_runner.worker.activities.graphton.handlers.sub_agent import (  # noqa: F401
    _MAX_SUBJECT_LENGTH,
    _generate_sub_agent_subject,
)
from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

# ---------------------------------------------------------------------------
# Backward-compatible re-exports (tests and internal callers import from here)
# ---------------------------------------------------------------------------

PLANNING_TOOLS = tool_event_handlers.PLANNING_TOOLS
_MAX_STATUS_RESULT_CHARS: int = tool_event_handlers._MAX_STATUS_RESULT_CHARS
_READ_ONLY_TOOLS = tool_event_handlers._READ_ONLY_TOOLS
_TOOL_CONTENT_FIELDS = streaming_buffers._TOOL_CONTENT_FIELDS
_find_json_string_value_start = streaming_buffers._find_json_string_value_start
_json_unescape_partial = streaming_buffers._json_unescape_partial


def _utc_timestamp(dt: datetime | None = None) -> str:
    """Return a UTC datetime as an RFC 3339 timestamp string."""
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


class StatusBuilder:
    """Builds execution status locally from astream_events."""

    def __init__(
        self,
        execution_id: str,
        initial_status: Any,
        approval_config: ApprovalConfig | None = None,
        tool_call_id_capture: ToolCallIdCapture | None = None,
    ):
        self.execution_id = execution_id
        self.logger = logging.getLogger(__name__)
        self.state = ExecutionState(proto=initial_status)
        self._approval_config = approval_config
        self._tool_call_id_capture = tool_call_id_capture or ToolCallIdCapture()
        self.force_next_update: bool = False
        self._display_env_vars: dict[str, str] | None = None
        self._secret_keys: set[str] | None = None
        self._workspace_root: str = ""

    @property
    def current_status(self) -> Any:
        return self.state.proto

    @current_status.setter
    def current_status(self, value: Any) -> None:
        self.state.proto = value

    def set_display_env_vars(
        self, env_vars: dict[str, str], secret_keys: set[str] | None = None,
    ) -> None:
        """Store resolved agent env vars for display humanization."""
        self._display_env_vars = env_vars
        self._secret_keys = secret_keys

    def set_workspace_root(self, workspace_root: str) -> None:
        """Store the sandbox workspace root for display humanization."""
        self._workspace_root = workspace_root

    # ── Tool Call Index — public accessors ────────────────────────────────

    def get_tool_call(self, tc_id: str) -> ToolCall | None:
        return self.state.tool_calls.get(tc_id)

    def iter_all_tool_calls(self) -> Iterator[ToolCall]:
        return iter(self.state.tool_calls.values())

    def tool_call_count(self) -> int:
        return len(self.state.tool_calls)

    @property
    def active_sub_agent_count(self) -> int:
        return len(self.state.active_sub_agents)

    _COMPLETION_DRAIN_MS: float = 300.0

    def should_flush_completions(self, now_monotonic: float) -> bool:
        """Check whether any pending sub-agent completion has drained."""
        if not self.state.pending_completion_flush:
            return False
        threshold = self._COMPLETION_DRAIN_MS / 1000.0
        flushed: list[str] = []
        for run_id, recorded_at in self.state.pending_completion_flush.items():
            if (now_monotonic - recorded_at) >= threshold:
                flushed.append(run_id)
        if flushed:
            for run_id in flushed:
                del self.state.pending_completion_flush[run_id]
            self.force_next_update = True
            return True
        return False

    # ── Event Dispatch ────────────────────────────────────────────────────

    async def process_event(self, event: dict[str, Any]) -> None:
        """Process astream_events v2 event and update local status."""
        event_type = event.get("event", "")

        metadata = event.get("metadata", {})
        namespace = (
            metadata.get("langgraph_checkpoint_ns")
            or metadata.get("checkpoint_ns")
            or ""
        )
        if isinstance(namespace, tuple):
            namespace = ":".join(str(x) for x in namespace)

        if namespace:
            self._register_sub_agent_namespace(namespace, event)

        handler: (
            Callable[[dict[str, Any], str], None | Coroutine[Any, Any, None]] | None
        ) = None
        if event_type == "on_tool_start":
            handler = self._handle_tool_start_event
        elif event_type == "on_tool_end":
            handler = self._handle_tool_end_event
        elif event_type == "on_chat_model_stream":
            handler = self._handle_chat_model_stream_event
        elif event_type == "on_chat_model_end":
            handler = self._handle_chat_model_end_event
        elif event_type == "on_custom_event" and event.get("name") == "tool_progress":
            handler = self._handle_tool_progress_event

        if handler is not None:
            try:
                result = handler(event, namespace)
                if inspect.isawaitable(result):
                    await result
            except Exception:
                self.logger.exception(
                    f"[EVENT_ERROR] execution={self.execution_id} "
                    f"event_type={event_type} namespace={namespace or 'main'} "
                    f"run_id={event.get('run_id', '')}"
                )


    # ── Handler Delegations ───────────────────────────────────────────────

    async def _handle_tool_start_event(self, event: dict[str, Any], namespace: str = "") -> None:
        await tool_event_handlers.handle_tool_start(self, event, namespace)

    def _handle_tool_progress_event(self, event: dict[str, Any], namespace: str = "") -> None:
        tool_event_handlers.handle_tool_progress(self, event, namespace)

    def _handle_tool_end_event(self, event: dict[str, Any], namespace: str = "") -> None:
        tool_event_handlers.handle_tool_end(self, event, namespace)

    def _handle_chat_model_stream_event(self, event: dict[str, Any], namespace: str = "") -> None:
        chat_model_handlers.handle_chat_model_stream(self, event, namespace)

    def _handle_chat_model_end_event(self, event: dict[str, Any], namespace: str = "") -> None:
        chat_model_handlers.handle_chat_model_end(self, event, namespace)

    # ── Billing Usage Reporting ───────────────────────────────────────────

    # ── Streaming Buffer Delegations ──────────────────────────────────────

    def _ensure_parent_ai_message(self, ns_key: str, namespace: str,
                                  llm_run_id: str = "") -> AgentMessage:
        return streaming_buffers.ensure_parent_ai_message(
            self, ns_key, namespace, llm_run_id,
        )

    def _extract_tool_result_content(self, result: Any) -> str:
        return formatting.extract_tool_result_content(result)

    def _create_early_tool_call(self, tool_name: str, tool_use_id: str,
                               ns_key: str, namespace: str,
                               llm_run_id: str = "") -> None:
        streaming_buffers.create_early_tool_call(
            self, tool_name, tool_use_id, ns_key, namespace, llm_run_id,
        )

    def _reconcile_early_tool_call(self, tool_name: str, run_id: str,
                                   tool_args: dict[str, Any],
                                   namespace: str) -> ToolCall | None:
        return streaming_buffers.reconcile_early_tool_call(
            self, tool_name, run_id, tool_args, namespace,
        )

    # ── Tool Event Support Delegations ────────────────────────────────────

    def _update_todos(self, todos_data: list) -> None:
        tool_event_handlers.update_todos(self, todos_data)

    def _update_sub_agent_todos(self, sub_agent: SubAgentExecution,
                                todos_data: list) -> None:
        tool_event_handlers.update_sub_agent_todos(self, sub_agent, todos_data)

    def _check_tool_approval_requirement(self, tool_name: str,
                                         tool_args: dict[str, Any]) -> Any:
        return tool_event_handlers.check_approval_requirement(self, tool_name, tool_args)

    def _set_waiting_for_approval_phase(self, tool_name: str, run_id: str) -> None:
        tool_event_handlers.set_waiting_for_approval_phase(self, tool_name, run_id)

    def _humanize_args_for_display(self, tool_args: dict[str, Any]) -> dict[str, Any]:
        return tool_event_handlers.humanize_args_for_display(self, tool_args)

    def _create_args_preview(self, tool_args: dict[str, Any]) -> str:
        return tool_event_handlers.create_args_preview(self, tool_args)

    # ── Approval State ────────────────────────────────────────────────────

    def clear_pending_approval(self) -> None:
        """Clear pending approval tracking state and restore execution phase."""
        self.state.approval.pending.clear()
        if self.state.approval.wait_started_at is not None:
            self.state.approval.wait_started_at = None
        if self.state.approval.saved_phase is not None:
            self.current_status.phase = self.state.approval.saved_phase
            self.state.approval.saved_phase = None
        else:
            self.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS

    def build_pending_approvals_snapshot(self) -> list[PendingApproval]:
        """Build pending_approvals snapshot for the Temporal slim status."""
        result: list[PendingApproval] = []
        for tc in self.iter_all_tool_calls():
            if (
                tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                and tc.requires_approval
                and tc.approval_action == ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
            ):
                result.append(PendingApproval(tool_call_id=tc.id))
        return result

    # ── Identity / Resume Helpers ─────────────────────────────────────────

    def resolve_run_id(self, run_id: str) -> str:
        return self._tool_call_id_capture.resolve(run_id)

    def rebuild_index_from_persisted_status(self) -> None:
        """Reconstruct proto-derivable indexes from persisted status."""
        self.state = ExecutionState.rebuild_from_proto(self.state.proto)

    def prepare_task_tool_resume_queue(self) -> int:
        return sub_agent_handlers.prepare_task_tool_resume_queue(self)

    def pre_register_in_progress_sub_agents(self) -> int:
        return sub_agent_handlers.pre_register_in_progress_sub_agents(self)

    # ── Sub-Agent Delegations ─────────────────────────────────────────────

    async def _handle_sub_agent_start(self, event: dict[str, Any],
                                     tool_args: dict[str, Any], run_id: str,
                                     *, tool_call_id: str | None = None) -> None:
        await sub_agent_handlers.handle_sub_agent_start(
            self, event, tool_args, run_id, tool_call_id=tool_call_id,
        )

    def _flush_pending_completions(self) -> list[str]:
        return sub_agent_handlers.flush_pending_completions(self)

    def _handle_sub_agent_end(self, event: dict[str, Any], run_id: str) -> None:
        sub_agent_handlers.handle_sub_agent_end(self, event, run_id)

    @property
    def has_orphaned_sub_agents(self) -> bool:
        return bool(self.state.active_sub_agents)

    def get_orphaned_sub_agents_diagnostic(self) -> dict:
        return sub_agent_handlers.get_orphaned_diagnostic(self)

    def finalize_active_sub_agents(self, status: SubAgentStatus, error: str) -> None:
        sub_agent_handlers.finalize_active(self, status, error)

    def finalize_active_sub_agents_differentiated(self, error_context: str) -> int:
        return sub_agent_handlers.finalize_active_differentiated(self, error_context)

    def finalize_sub_agents_from_checkpoint_validation(
        self, missed_event_count: int, confirmed_orphan_count: int,
        error_context: str,
    ) -> int:
        return sub_agent_handlers.finalize_from_checkpoint_validation(
            self, missed_event_count, confirmed_orphan_count, error_context,
        )

    # ── Context Delegations ───────────────────────────────────────────────

    def set_resolved_context(self, environment_keys: list[str],
                             mcp_servers: dict[str, tuple[bool, str, int]],
                             skill_names: list[str],
                             excluded_skill_names: list[str] | None = None) -> None:
        context_handlers.set_resolved_context(
            self, environment_keys, mcp_servers, skill_names, excluded_skill_names,
        )

    def initialize_context_info(self, context_window_limit: int,
                                trigger_threshold: int, target_tokens: int,
                                enabled: bool) -> None:
        context_handlers.initialize_context_info(
            self, context_window_limit, trigger_threshold, target_tokens, enabled,
        )

    def on_summarization_complete(self, event: SummarizationEventData) -> None:
        context_handlers.on_summarization_complete(self, event)

    def on_token_count_updated(self, token_count: int) -> None:
        context_handlers.on_token_count_updated(self, token_count)

    def finalize_context_info(self) -> None:
        context_handlers.finalize_context_info(self)

    def add_artifact(self, artifact: ExecutionArtifact) -> None:
        context_handlers.add_artifact(self, artifact)

    def add_workspace_write_back(self, wb) -> None:
        context_handlers.add_workspace_write_back(self, wb)

    # ── Namespace Routing ─────────────────────────────────────────────────

    def _get_execution_context(self, namespace: str) -> tuple[Any, SubAgentExecution | None]:
        """Determine execution context based on namespace."""
        if not namespace:
            return self.current_status, None

        sub_agent_id = self.state.namespace_to_sub_agent.get(namespace)
        if sub_agent_id:
            if sub_agent_id in self.state.active_sub_agents:
                sa = self.state.active_sub_agents[sub_agent_id]
                return sa, sa
            if sub_agent_id in self.state.completed_sub_agents:
                self.logger.debug(
                    f"[SUBAGENT] execution={self.execution_id} "
                    f"late event routed to completed sub-agent={sub_agent_id} "
                    f"namespace={namespace}"
                )
                sa = self.state.completed_sub_agents[sub_agent_id]
                return sa, sa

        if "|" in namespace and namespace not in self.state.warned_namespaces:
            self.state.warned_namespaces.add(namespace)
            self.logger.warning(
                f"[NAMESPACE] execution={self.execution_id} "
                f"namespace={namespace} has no registered sub-agent — "
                f"falling back to main agent context"
            )
        return self.current_status, None

    def _register_sub_agent_namespace(
        self, namespace: str, event: dict[str, Any],
    ) -> None:
        """Register namespace -> sub-agent mapping via ``parent_ids``.

        Resolution priority:
          1. Active sub-agents (by parent_id match)
          2. Deferred binding: if a single unattached IN_PROGRESS sub-agent
             exists (pre-registered but never claimed by handle_sub_agent_start),
             bind it to the first unknown parent_id
          3. Completed sub-agents — only when NO active sub-agents exist
             (prevents misrouting events to a finished sub-agent)
        """
        if not namespace or namespace in self.state.namespace_to_sub_agent:
            return
        if "|" not in namespace:
            return

        parent_ids: list[str] = event.get("parent_ids", [])

        # Priority 1: match against active sub-agents
        for pid in parent_ids:
            if pid in self.state.active_sub_agents:
                self.state.namespace_to_sub_agent[namespace] = pid
                self.logger.debug(
                    "[SUBAGENT] namespace=%s -> sub_agent=%s (via parent_ids)",
                    namespace, pid,
                )
                return

        # Priority 2: deferred binding for pre-registered sub-agents whose
        # on_tool_start was never replayed by LangGraph on resume.
        if self.state.pending_resume_sa_ids:
            if len(self.state.pending_resume_sa_ids) == 1:
                sa_id = next(iter(self.state.pending_resume_sa_ids))
                sa_proto = self.state.active_sub_agents.get(sa_id)
                if sa_proto is not None:
                    for pid in parent_ids:
                        if (
                            pid not in self.state.active_sub_agents
                            and pid not in self.state.completed_sub_agents
                        ):
                            del self.state.active_sub_agents[sa_id]
                            self.state.active_sub_agents[pid] = sa_proto
                            self.state.run_id_to_tool_call_id[pid] = sa_id
                            self.state.pending_resume_sa_ids.discard(sa_id)
                            self.state.namespace_to_sub_agent[namespace] = pid
                            self.logger.info(
                                "[SUBAGENT] execution=%s deferred binding: "
                                "namespace=%s -> parent_id=%s -> sa_id=%s "
                                "(on_tool_start not replayed for this sub-agent)",
                                self.execution_id, namespace, pid, sa_id,
                            )
                            return
            else:
                self.logger.warning(
                    "[SUBAGENT] execution=%s namespace=%s: %d unattached "
                    "sub-agents pending — cannot determine binding "
                    "(pending_sa_ids=%s, parent_ids=%s)",
                    self.execution_id, namespace,
                    len(self.state.pending_resume_sa_ids),
                    sorted(self.state.pending_resume_sa_ids),
                    parent_ids,
                )

        # Priority 3: completed sub-agents — only when no active sub-agents
        # exist, to prevent misrouting live events to a finished sub-agent.
        if not self.state.active_sub_agents:
            for pid in parent_ids:
                if pid in self.state.completed_sub_agents:
                    self.state.namespace_to_sub_agent[namespace] = pid
                    self.logger.debug(
                        "[SUBAGENT] namespace=%s -> completed sub_agent=%s "
                        "(via parent_ids, no active sub-agents)",
                        namespace, pid,
                    )
                    return
        else:
            for pid in parent_ids:
                if pid in self.state.completed_sub_agents:
                    self.logger.warning(
                        "[SUBAGENT] execution=%s namespace=%s would map to "
                        "completed sub_agent=%s via parent_ids but active "
                        "sub-agents exist — suppressing to prevent misrouting",
                        self.execution_id, namespace, pid,
                    )
                    break

        self.logger.debug(
            "[SUBAGENT] execution=%s namespace=%s not resolved: "
            "parent_ids=%s matched neither active=%s nor completed=%s",
            self.execution_id, namespace, parent_ids,
            list(self.state.active_sub_agents.keys()),
            list(self.state.completed_sub_agents.keys()),
        )
