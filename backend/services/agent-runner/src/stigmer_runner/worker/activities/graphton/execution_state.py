"""Explicit state model for StatusBuilder.

All mutable execution state lives here in typed, documented fields.
StatusBuilder owns an ``ExecutionState`` instance and all event handlers
operate on it.  Configuration and collaborators (approval config,
ToolCallIdCapture, display env) stay on StatusBuilder
itself — they are not execution state.

The state is split into:

* **Proto indexes** — O(1) lookup into the protobuf's repeated fields.
* **Sub-agent routing** — maps that connect LangGraph namespaces and
  run_ids to the correct ``SubAgentExecution`` proto.
* **Streaming buffers** — partial data accumulated during LLM token
  streaming before being flushed to the proto.
* **Timing / observability** — start timestamps for duration calculation.
* **Approval tracking** — batch-approval lifecycle state.
* **Other** — log-dedup guards, context window tracking, artifact staging.

Three tightly-coupled field groups are extracted into sub-dataclasses
(``ThinkingStreamState``, ``ToolInputStreamState``, ``ApprovalTrackingState``)
because their fields share a lifecycle and are always mutated together.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.context_pb2 import ContextInfo
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    MessageType,
    SubAgentStatus,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    AgentMessage,
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution

_TERMINAL_SUB_AGENT_STATUSES = frozenset({
    SubAgentStatus.SUB_AGENT_COMPLETED,
    SubAgentStatus.SUB_AGENT_FAILED,
    SubAgentStatus.SUB_AGENT_CANCELLED,
})


# ---------------------------------------------------------------------------
# Sub-group dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ThinkingStreamState:
    """Native-thinking translation buffers (extended thinking -> synthetic think tool).

    All three dicts are keyed by namespace (empty string for main agent)
    and are always mutated together in ``_start_thinking_stream``,
    ``_update_thinking_stream``, and ``_flush_thinking_buffer``.
    """

    buffers: dict[str, str] = field(default_factory=dict)
    started_at: dict[str, datetime] = field(default_factory=dict)
    tool_call_ids: dict[str, str] = field(default_factory=dict)


@dataclass
class ToolInputStreamState:
    """Live tool-argument streaming buffers (input_json_delta accumulation).

    ``active_tc`` maps namespace -> temp tool call id currently receiving
    input deltas.  ``buffers`` maps temp id -> accumulated partial JSON.
    Always used together in ``_accumulate_tool_input`` and
    ``_flush_tool_input_buffer``.
    """

    active_tc: dict[str, str] = field(default_factory=dict)
    buffers: dict[str, str] = field(default_factory=dict)


@dataclass
class ApprovalTrackingState:
    """Batch-approval lifecycle state.

    Set together when entering WAITING_FOR_APPROVAL, cleared together in
    ``clear_pending_approval``.
    """

    pending: list[str] = field(default_factory=list)
    saved_phase: int | None = None
    wait_started_at: datetime | None = None


# ---------------------------------------------------------------------------
# Main state dataclass
# ---------------------------------------------------------------------------

@dataclass
class ExecutionState:
    """All mutable execution state for StatusBuilder.

    Every field is either a proto index, streaming buffer, timing tracker,
    sub-agent routing map, or approval tracker.  None are compensating
    complexity — each serves a genuine purpose documented in its comment.

    ``force_next_update`` is intentionally NOT here; it is a gRPC
    scheduling coordination signal between StatusBuilder and StreamExecutor,
    not execution state.
    """

    # The protobuf projection being built.
    proto: Any

    # -- Proto indexes -- O(1) lookup into proto repeated fields -----------

    # tool_call_id -> managed ToolCall reference inside a message's repeated
    # field.  Mutations propagate directly to the proto.
    tool_calls: dict[str, ToolCall] = field(default_factory=dict)

    # LLM run_id -> the AgentMessage that run is streaming into.
    # Prevents token interleaving when multiple LLM streams are active.
    messages_by_run: dict[str, AgentMessage] = field(default_factory=dict)

    # namespace -> most recently created AI message in that execution context.
    # Tool calls are appended to this message's tool_calls repeated field.
    current_ai_message: dict[str, AgentMessage] = field(default_factory=dict)

    # namespace -> latest LLM run_id for turn-boundary detection.
    last_llm_run_id: dict[str, str] = field(default_factory=dict)

    # -- Sub-agent routing -------------------------------------------------

    # task-tool run_id -> in-progress SubAgentExecution proto.
    active_sub_agents: dict[str, SubAgentExecution] = field(default_factory=dict)

    # Same keys after task completes; keeps routing for late events.
    completed_sub_agents: dict[str, SubAgentExecution] = field(default_factory=dict)

    # LangGraph task run_id -> tool_call_id (= SubAgentExecution.id).
    run_id_to_tool_call_id: dict[str, str] = field(default_factory=dict)

    # checkpoint namespace root -> sub-agent task run_id for event routing.
    namespace_to_sub_agent: dict[str, str] = field(default_factory=dict)

    # sa_ids of IN_PROGRESS sub-agents pre-registered before the resume stream
    # starts.  Consumed by handle_sub_agent_start (on real on_tool_start) or
    # by deferred-binding in _register_sub_agent_namespace.
    pending_resume_sa_ids: set[str] = field(default_factory=set)

    # Tracks how many times each subject has been assigned for dedup suffixes.
    subject_counts: dict[str, int] = field(default_factory=dict)

    # -- Streaming buffers -------------------------------------------------

    thinking: ThinkingStreamState = field(default_factory=ThinkingStreamState)

    tool_input: ToolInputStreamState = field(default_factory=ToolInputStreamState)

    # FIFO queue of (temp_tool_call_id, sub_agent_id_or_None) for
    # stream -> on_tool_start reconciliation.
    early_tool_call_queue: list[tuple[str, str | None]] = field(default_factory=list)

    # -- Timing / observability --------------------------------------------

    # tool run_id -> start timestamp for duration calculation.
    tool_start_times: dict[str, datetime] = field(default_factory=dict)

    # Main-agent AI message index -> stream start time for duration.
    message_start_times: dict[int, datetime] = field(default_factory=dict)

    # (sub_agent_id, message_index) -> AI stream start time.
    sub_agent_message_start_times: dict[tuple[str, int], datetime] = field(
        default_factory=dict
    )

    # task run_id -> monotonic time when completion flush was deferred.
    pending_completion_flush: dict[str, float] = field(default_factory=dict)

    # -- Approval ----------------------------------------------------------

    approval: ApprovalTrackingState = field(default_factory=ApprovalTrackingState)

    # -- Other -------------------------------------------------------------

    # Log-once guard for unresolved multi-segment namespaces.
    warned_namespaces: set[str] = field(default_factory=set)

    # Context window utilization and summarization tracking.
    context_info: ContextInfo | None = None

    # Artifacts staged during execution, synced to proto on finalize.
    artifacts: list[ExecutionArtifact] = field(default_factory=list)

    @classmethod
    def rebuild_from_proto(cls, proto: Any) -> ExecutionState:
        """Reconstruct proto-derivable indexes from a persisted status.

        Used on the resume-after-approval path where the StatusBuilder is
        initialized with a DB-persisted ``AgentExecutionStatus`` that already
        contains messages, tool calls, sub-agent executions, and artifacts.

        Only proto-derivable indexes are reconstructed.  Ephemeral runtime
        state (run_id maps, streaming buffers, timing) starts fresh —
        streaming resumes from the checkpoint with new ephemeral state.
        """
        state = cls(proto=proto)

        def _index_tool_calls(messages: Any) -> None:
            for message in messages:
                if message.type != MessageType.MESSAGE_AI:
                    continue
                for i, tc in enumerate(message.tool_calls):
                    if tc.id:
                        state.tool_calls[tc.id] = message.tool_calls[i]

        _index_tool_calls(proto.messages)

        for sa in proto.sub_agent_executions:
            _index_tool_calls(sa.messages)
            if sa.status in _TERMINAL_SUB_AGENT_STATUSES:
                state.completed_sub_agents[sa.id] = sa

        state.artifacts = list(proto.artifacts)
        return state
