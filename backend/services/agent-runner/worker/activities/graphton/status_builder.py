"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import inspect
import json
import logging
import time
from collections.abc import Callable, Coroutine, Iterator
from datetime import datetime
from typing import Any
from uuid import uuid4

from worker.activities.graphton.execution_state import ExecutionState
from worker.activities.graphton.handlers import (
    chat_model as chat_model_handlers,
    context as context_handlers,
    formatting,
    streaming_buffers,
    sub_agent as sub_agent_handlers,
    tool_event as tool_event_handlers,
)
from worker.activities.graphton.handlers.sub_agent import (
    _MAX_SUBJECT_LENGTH,
    _generate_sub_agent_subject,
)
from worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.context_pb2 import (
    ContextInfo,
    McpServerResolutionStatus,
    ResolvedExecutionContext,
    SummarizationEvent,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
    SummarizationSource,
    TodoStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    AgentMessage,
    ComponentMetadata,
    ToolCall,
)
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from ai.stigmer.agentic.agentexecution.v1.todo_pb2 import TodoItem
from google.protobuf.struct_pb2 import Struct
from graphton.core import ModelRegistry
from graphton.core.backends.platform_mount import (
    humanize_platform_refs,
    humanize_sandbox_paths,
    resolve_display_env_vars,
)
from graphton.core.models import parse_model_string
from graphton.core.summarization_callback import SummarizationEventData
from langchain_core.messages import HumanMessage, SystemMessage

from worker.activities.graphton.approval_policy import (
    ApprovalConfig,
    ApprovalRequirement,
    render_approval_message,
    resolve_tool_approval,
)
from worker.activities.graphton.usage_tracker import MAIN_SCOPE, UsageTracker
from worker.component_type_inference import infer_component_type
from worker.config import Config

_logger = logging.getLogger(__name__)

# Planning tools that update execution state without UI display
PLANNING_TOOLS = {
    'write_todos',
}

# Maximum characters for tool_call.result in the status proto payload.
# This is a display/transport concern — the gRPC Temporal update must fit
# within message-size limits.  The LLM context has its own independent cap
# (see graphton.core.tool_wrappers._MAX_TOOL_OUTPUT_CHARS).
_MAX_STATUS_RESULT_CHARS: int = 50_000

_TOOL_CONTENT_FIELDS = streaming_buffers._TOOL_CONTENT_FIELDS

# Read-only tools whose result content is replaced with a size-only placeholder
# in the persisted state.  The file path is already in tc.args; full content
# lives in the LangGraph checkpoint DB if ever needed.
_READ_ONLY_TOOLS: set[str] = {"read", "read_file"}

_find_json_string_value_start = streaming_buffers._find_json_string_value_start
_json_unescape_partial = streaming_buffers._json_unescape_partial


def _utc_timestamp(dt: datetime | None = None) -> str:
    """Return a UTC datetime as an RFC 3339 timestamp string.

    Appends the ``Z`` suffix so that consumers using strict RFC 3339 / ISO 8601
    parsers (e.g. Go's ``time.Parse(time.RFC3339, …)``) can parse the value
    without ambiguity.

    Args:
        dt: A UTC datetime to format. If *None*, ``datetime.utcnow()`` is used.
    """
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


class StatusBuilder:
    """
    Builds execution status locally from astream_events.
    
    Usage:
        builder = StatusBuilder(execution_id, initial_status)
        
        # Process events
        for event in events:
            await builder.process_event(event)
        
        # Set final phase
        builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
        
        # Return to workflow
        return builder.current_status
    """
    
    def __init__(
        self,
        execution_id: str,
        initial_status: Any,
        approval_config: ApprovalConfig | None = None,
        tool_call_id_capture: ToolCallIdCapture | None = None,
    ):
        """
        Initialize status builder.
        
        Args:
            execution_id: The execution ID
            initial_status: Initial AgentExecutionStatus proto
            approval_config: Optional approval policy configuration. When provided,
                           tools matching approval policies will be set to
                           WAITING_APPROVAL status instead of RUNNING.
            tool_call_id_capture: Callback handler that captures {run_id → tool_call_id}
                from the LangChain callback API. Used for identity-based dedup on the
                resume path. A bare instance is created when not provided.
        """
        self.execution_id = execution_id
        self.logger = logging.getLogger(__name__)

        # -- Execution state (all mutable tracking data) -------------------
        self.state = ExecutionState(proto=initial_status)

        # -- Configuration (immutable after init) --------------------------
        self._approval_config = approval_config

        # Single authority for run_id → tool_call_id resolution.
        self._tool_call_id_capture = tool_call_id_capture or ToolCallIdCapture()

        # Token/cost accounting for LLM calls.
        self._usage_tracker = UsageTracker(execution_id)

        # gRPC scheduling signal (not execution state).
        self.force_next_update: bool = False

        # Display humanization config (set after workspace provisioning).
        self._display_env_vars: dict[str, str] | None = None
        self._secret_keys: set[str] | None = None
        self._workspace_root: str = ""

    @property
    def current_status(self) -> Any:
        """The protobuf projection being built."""
        return self.state.proto

    @current_status.setter
    def current_status(self, value: Any) -> None:
        self.state.proto = value
    
    def set_display_env_vars(
        self,
        env_vars: dict[str, str],
        secret_keys: set[str] | None = None,
    ) -> None:
        """Store resolved agent env vars for display humanization.

        Called once after environment merge completes.  ``_create_args_preview``
        uses these to replace ``$KEY`` references with their values so the
        approval prompt shows concrete paths instead of opaque env-var names.

        Args:
            env_vars: Merged env-var name-to-value mapping.
            secret_keys: Keys marked ``is_secret=true`` in the EnvironmentValue
                proto.  These are never expanded into display strings.
        """
        self._display_env_vars = env_vars
        self._secret_keys = secret_keys

    def set_workspace_root(self, workspace_root: str) -> None:
        """Store the sandbox workspace root for display humanization.

        Called once after workspace provisioning completes.
        ``_humanize_args_for_display`` and tool-result recording use this to
        replace absolute sandbox paths (e.g. ``/home/daytona/workspace/…``)
        with workspace-relative display paths.

        Pass an empty string to disable sandbox path humanization (local
        mode, where paths are the user's actual filesystem).
        """
        self._workspace_root = workspace_root

    # ─────────────────────────────────────────────────────────────────────────
    # Tool Call Index — public accessors
    # ─────────────────────────────────────────────────────────────────────────

    def get_tool_call(self, tc_id: str) -> ToolCall | None:
        """Look up a ToolCall by its ID.

        Returns the reference stored inside the parent AI message's repeated
        field, so mutations to the returned object propagate to the proto
        status automatically.
        """
        return self.state.tool_calls.get(tc_id)

    def iter_all_tool_calls(self) -> Iterator[ToolCall]:
        """Iterate over every tracked ToolCall (main agent + sub-agents)."""
        return iter(self.state.tool_calls.values())

    def tool_call_count(self) -> int:
        """Return the total number of tracked tool calls."""
        return len(self.state.tool_calls)

    @property
    def active_sub_agent_count(self) -> int:
        """Return the number of currently active (in-progress) sub-agents."""
        return len(self.state.active_sub_agents)

    _COMPLETION_DRAIN_MS: float = 300.0

    def should_flush_completions(self, now_monotonic: float) -> bool:
        """Check whether any pending sub-agent completion has drained.

        Returns True (and sets :attr:`force_next_update`) when at least one
        sub-agent completion has been pending for longer than
        ``_COMPLETION_DRAIN_MS``.  The drain window allows late LangGraph
        events to be batched into the same gRPC update that carries the
        COMPLETED status.
        """
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

    async def process_event(self, event: dict[str, Any]) -> None:
        """
        Process astream_events v2 event and update local status.
        
        Args:
            event: The astream_events v2 event dictionary
        """
        event_type = event.get("event", "")
        
        # Extract namespace
        metadata = event.get("metadata", {})
        namespace = (
            metadata.get("langgraph_checkpoint_ns") or
            metadata.get("checkpoint_ns") or
            ""
        )
        
        if isinstance(namespace, tuple):
            namespace = ":".join(str(x) for x in namespace)
        
        # Register namespace -> sub-agent mapping for EVERY event type.
        # _register_sub_agent_namespace is idempotent (returns immediately
        # for already-registered or single-segment namespaces), so calling
        # it universally is safe and cheap.  This ensures that namespace
        # variants arriving via on_chat_model_stream, on_tool_end, etc.
        # are registered before _get_execution_context performs its exact
        # lookup in the type-specific handler.
        if namespace:
            self._register_sub_agent_namespace(namespace, event)
        
        # Route by event type.  Each handler is wrapped so a single bad
        # event never crashes the entire activity stream.
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
    
    async def _handle_tool_start_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Delegate to :func:`tool_event_handlers.handle_tool_start`."""
        await tool_event_handlers.handle_tool_start(self, event, namespace)
    
    def _ensure_parent_ai_message(
        self,
        ns_key: str,
        namespace: str,
        llm_run_id: str = "",
    ) -> AgentMessage:
        """Return the current parent AI message, creating an empty one if needed.

        When a tool call (including thinking) fires before the LLM has produced
        any text, there is no AI message to attach it to.  This method creates
        a zero-content ``MESSAGE_AI`` so the tool call has a parent — the
        frontend renders such messages as tool-only rows without a text bubble.

        When the LLM later produces text tokens, ``_handle_chat_model_stream_event``
        creates a *new* AI message (keyed by ``run_id``), which replaces
        ``_last_ai_message[ns_key]``.  Subsequent tool calls attach to that
        new message, preserving correct chronological grouping.

        Args:
            ns_key: Namespace key (empty string for main agent).
            namespace: Raw LangGraph checkpoint namespace.
            llm_run_id: When called from the LLM stream path (thinking /
                early tool_use), pass the LLM's ``run_id`` so the empty
                parent is registered in ``_llm_run_id_to_message``.  This
                allows ``_handle_chat_model_end_event`` to find it and
                record usage metrics for thinking-only turns.  Callers from
                the tool-execution path (``on_tool_start``) must omit this
                to avoid polluting the LLM run-id map with tool run-ids.
        """
        existing = self.state.current_ai_message.get(ns_key)
        if existing is not None:
            return existing

        _, sub_agent = self._get_execution_context(namespace)
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages

        now = datetime.utcnow()
        ai_message = AgentMessage(
            type=MessageType.MESSAGE_AI,
            content="",
            timestamp=_utc_timestamp(now),
            is_streaming=False,
        )
        messages_list.append(ai_message)
        managed = messages_list[-1]
        self.state.current_ai_message[ns_key] = managed

        if llm_run_id:
            self.state.messages_by_run[llm_run_id] = managed

        self.logger.debug(
            "[AI_MSG] execution=%s created empty parent AI message "
            "namespace=%s llm_run_id=%s (tool call arrived before text)",
            self.execution_id,
            namespace or "main",
            llm_run_id or "none",
        )
        return managed

    def _handle_tool_progress_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Delegate to :func:`tool_event_handlers.handle_tool_progress`."""
        tool_event_handlers.handle_tool_progress(self, event, namespace)
    
    def _handle_tool_end_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Delegate to :func:`tool_event_handlers.handle_tool_end`."""
        tool_event_handlers.handle_tool_end(self, event, namespace)
    
    def _handle_chat_model_stream_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Handle on_chat_model_stream event - updates local status."""
        chunk_data = event.get("data", {}).get("chunk", {})
        
        if not chunk_data:
            return
        
        # Try to register namespace for event routing
        if namespace:
            self._register_sub_agent_namespace(namespace, event)
        
        # ─────────────────────────────────────────────────────────────────────
        # LLM Turn-Boundary Detection
        #
        # Each LLM invocation carries a unique run_id.  When the run_id
        # changes we know a new LLM turn has started.  Clear the cached
        # _last_ai_message for this namespace so that thinking/tool_use
        # blocks from the new turn create a fresh parent AI message
        # instead of piling onto the previous turn's parent.
        #
        # For text-producing turns this is harmless — the text path
        # already creates a new AI message per new run_id.  The fix
        # matters for thinking-only turns where no text path runs and
        # _last_ai_message would otherwise remain stale.
        # ─────────────────────────────────────────────────────────────────────
        run_id = event.get("run_id", "")
        ns_key = namespace or ""
        if run_id and run_id != self.state.last_llm_run_id.get(ns_key):
            self.state.current_ai_message.pop(ns_key, None)
            self.state.last_llm_run_id[ns_key] = run_id
        
        # ─────────────────────────────────────────────────────────────────────
        # Native Thinking Detection
        #
        # When Anthropic extended thinking is active, content blocks arrive as
        # dicts with type:"thinking" BEFORE the text/tool_use blocks.  We
        # accumulate thinking content in a per-namespace buffer and skip AI
        # message creation for these chunks.  When the first non-thinking
        # content arrives we flush the buffer into a synthetic think ToolCall.
        #
        # A single chunk may contain BOTH thinking and text blocks (e.g., at
        # the boundary between thinking and response output).  We must
        # process thinking content AND check for co-located text — only
        # returning early if the chunk is purely thinking content.
        # ─────────────────────────────────────────────────────────────────────
        if hasattr(chunk_data, "content") and isinstance(chunk_data.content, list):
            ns_key = namespace or ""
            thinking_text = formatting.extract_thinking_content(chunk_data.content)
            text_in_same_chunk = formatting.extract_string_content(chunk_data.content)
            
            # Diagnostic: log mixed chunks and empty extractions
            if thinking_text and text_in_same_chunk:
                self.logger.info(
                    f"[STREAM_DIAG] Mixed thinking+text chunk: "
                    f"execution={self.execution_id} "
                    f"run_id={event.get('run_id', '')} "
                    f"namespace={namespace or 'main'} "
                    f"thinking_len={len(thinking_text)} "
                    f"text_len={len(text_in_same_chunk)} "
                    f"text={text_in_same_chunk[:100]!r}"
                )
            elif not thinking_text and not text_in_same_chunk:
                expected_non_text_types = frozenset({
                    "thinking", "tool_use", "input_json_delta",
                })
                block_types = [
                    formatting.block_attr(b, "type", type(b).__name__)
                    for b in chunk_data.content[:5]
                ]
                is_expected = (
                    not block_types
                    or all(bt in expected_non_text_types for bt in block_types)
                )
                if not is_expected:
                    self.logger.info(
                        f"[STREAM_DIAG] List content with no thinking/text: "
                        f"execution={self.execution_id} "
                        f"run_id={event.get('run_id', '')} "
                        f"namespace={namespace or 'main'} "
                        f"blocks={len(chunk_data.content)} "
                        f"block_types={block_types}"
                    )
            
            # ── Early Tool Call Creation ─────────────────────────────────────
            # When a tool_use block appears in the stream, create the ToolCall
            # right away so the CLI replaces the idle "Thinking…" indicator
            # with the actual tool name (e.g. "Write: …").
            skip_early_tools = frozenset(PLANNING_TOOLS)
            for block in chunk_data.content:
                try:
                    if formatting.block_attr(block, "type") == "tool_use":
                        t_name = formatting.block_attr(block, "name")
                        t_id = formatting.block_attr(block, "id")
                        if t_name and t_name not in skip_early_tools:
                            self._create_early_tool_call(
                                t_name, t_id, ns_key, namespace,
                                llm_run_id=run_id,
                            )
                except Exception:
                    self.logger.exception(
                        f"[TOOL_EARLY_ERROR] execution={self.execution_id} "
                        f"block={block!r:.200} namespace={namespace or 'main'}"
                    )
            
            # ── Tool Input Streaming ─────────────────────────────────────────
            # Accumulate input_json_delta fragments and extract displayable
            # content into the early ToolCall's result field so the CLI can
            # render it progressively (same mechanism as thinking streaming).
            for block in chunk_data.content:
                try:
                    if formatting.block_attr(block, "type") == "input_json_delta":
                        partial = formatting.block_attr(block, "partial_json")
                        if partial:
                            streaming_buffers.accumulate_tool_input(self, ns_key, partial)
                except Exception:
                    self.logger.exception(
                        f"[TOOL_INPUT_ERROR] execution={self.execution_id} "
                        f"namespace={namespace or 'main'}"
                    )
            
            if thinking_text:
                self.state.thinking.buffers[ns_key] = (
                    self.state.thinking.buffers.get(ns_key, "") + thinking_text
                )
                if ns_key not in self.state.thinking.tool_call_ids:
                    streaming_buffers.start_thinking_stream(self,
                        ns_key, namespace, self.state.thinking.buffers[ns_key],
                        llm_run_id=run_id,
                    )
                else:
                    streaming_buffers.update_thinking_stream(self, ns_key)
                
                if not text_in_same_chunk:
                    return
                # Fall through: chunk has both thinking AND text.
                # Thinking is accumulated above; text is processed below.
        
        # Extract token
        token = ""
        if hasattr(chunk_data, "content"):
            chunk_content = chunk_data.content
            if isinstance(chunk_content, str):
                token = chunk_content
            elif isinstance(chunk_content, list):
                token = formatting.extract_string_content(chunk_content)
        
        if not token:
            return
        
        # Flush any accumulated thinking before processing text content.
        # This ensures the synthetic think ToolCall appears in the status
        # timeline before the AI message that follows it.
        ns_key = namespace or ""
        if self.state.thinking.buffers.get(ns_key):
            streaming_buffers.flush_thinking_buffer(self, ns_key, namespace)
        
        # ─────────────────────────────────────────────────────────────────────
        # run_id-Based Message Isolation
        #
        # Each LLM invocation has a unique run_id. We use it to map tokens
        # to the correct AgentMessage, preventing interleaving when multiple
        # LLM streams are active (e.g., concurrent sub-agents whose namespace
        # routing fell through to the main agent).
        #
        # When run_id is absent, we fall back to the legacy backwards-scan
        # for the last streaming AI message in the resolved context.
        # ─────────────────────────────────────────────────────────────────────
        run_id = event.get("run_id", "")
        context, sub_agent = self._get_execution_context(namespace)
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages
        
        # Fast path: run_id already mapped to a message from an earlier token.
        if run_id:
            ai_message = self.state.messages_by_run.get(run_id)
            if ai_message is not None:
                # Empty parent AI messages created by _ensure_parent_ai_message
                # for thinking/tool_use blocks must NOT receive text content.
                # Text should go to a separate AI message so the frontend
                # renders the thread in chronological order: thinking tool
                # group first, then the text response.  Remove the stale
                # registration so the "first token" path below creates a
                # proper text AI message and re-registers the run_id.
                if not ai_message.content and len(ai_message.tool_calls) > 0:
                    del self.state.messages_by_run[run_id]
                else:
                    ai_message.content += token
                    return
        
        if not run_id:
            # Legacy fallback: no run_id available — find the last streaming
            # AI message in this context (pre-isolation behaviour).
            for idx in range(len(messages_list) - 1, -1, -1):
                message = messages_list[idx]
                if message.type == MessageType.MESSAGE_AI and message.is_streaming:
                    message.content += token
                    return
        
        # First token for this run_id (or no existing streaming message in
        # legacy mode) — create a new AgentMessage.
        now = datetime.utcnow()
        ai_message = AgentMessage(
            type=MessageType.MESSAGE_AI,
            content=token,
            timestamp=_utc_timestamp(now),
            is_streaming=True,
        )
        messages_list.append(ai_message)
        
        # Store the proto-managed reference (not the original, which is
        # disconnected after protobuf repeated-message append).
        managed_ai_message = messages_list[-1]
        
        if run_id:
            self.state.messages_by_run[run_id] = managed_ai_message
        
        # Track as the most recent AI message for this namespace so that
        # subsequent tool calls (on_tool_start, early tool_use) are attached
        # to the correct parent AI message.
        ns_key = namespace or ""
        self.state.current_ai_message[ns_key] = managed_ai_message
        
        # Track start time for duration calculation
        new_message_index = len(messages_list) - 1
        if sub_agent:
            self.state.sub_agent_message_start_times[(sub_agent.id, new_message_index)] = now
            self.logger.debug(f"Started new AI message in sub_agent={sub_agent.id} at index {new_message_index} run_id={run_id}")
        else:
            self.state.message_start_times[new_message_index] = now
            self.logger.debug(f"Started new AI message at index {new_message_index} run_id={run_id}")
    
    def _handle_chat_model_end_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """
        Handle on_chat_model_end event - finalize AI message and capture usage metrics.
        
        This event is emitted when the LLM completes generating a response. It contains:
        - Final message content (already captured via streaming)
        - Usage metadata (token counts) - only available in this event
        - Model information
        
        Args:
            event: The astream_events v2 event dictionary
            namespace: LangGraph checkpoint namespace for sub-agent routing
        """
        output_data = event.get("data", {}).get("output", {})
        
        if not output_data:
            return
        
        # Flush any remaining thinking content that wasn't followed by text
        # (e.g. the model only produced thinking + tool_use, no text block).
        ns_key = namespace or ""
        if self.state.thinking.buffers.get(ns_key):
            streaming_buffers.flush_thinking_buffer(self, ns_key, namespace)
        
        # ─────────────────────────────────────────────────────────────────────
        # run_id-Based Message Resolution (with backwards-scan fallback)
        # ─────────────────────────────────────────────────────────────────────
        run_id = event.get("run_id", "")
        context, sub_agent = self._get_execution_context(namespace)
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages
        
        ai_message_index = None
        
        # Primary path: resolve via run_id map (matches stream handler)
        tracked_message = self.state.messages_by_run.pop(run_id, None) if run_id else None
        if tracked_message is not None:
            for idx in range(len(messages_list) - 1, -1, -1):
                if messages_list[idx] is tracked_message:
                    ai_message_index = idx
                    break
        
        # Fallback: backwards scan for last streaming AI message
        if ai_message_index is None:
            for idx in range(len(messages_list) - 1, -1, -1):
                message = messages_list[idx]
                if message.type == MessageType.MESSAGE_AI and message.is_streaming:
                    ai_message_index = idx
                    break
        
        if ai_message_index is None:
            context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
            self.logger.warning(
                f"on_chat_model_end received but no AI message found to finalize "
                f"({context_desc} run_id={run_id})"
            )
            return
        
        # Calculate generation duration if we tracked the start time
        generation_duration_ms = None
        if sub_agent:
            # Check sub-agent timing dict
            timing_key = (sub_agent.id, ai_message_index)
            if timing_key in self.state.sub_agent_message_start_times:
                start_time = self.state.sub_agent_message_start_times[timing_key]
                duration = datetime.utcnow() - start_time
                generation_duration_ms = int(duration.total_seconds() * 1000)
                del self.state.sub_agent_message_start_times[timing_key]
        else:
            # Check main agent timing dict
            if ai_message_index in self.state.message_start_times:
                start_time = self.state.message_start_times[ai_message_index]
                duration = datetime.utcnow() - start_time
                generation_duration_ms = int(duration.total_seconds() * 1000)
                del self.state.message_start_times[ai_message_index]
        
        # ─────────────────────────────────────────────────────────────────────────
        # Diagnostic: capture output_data shape for zero-usage debugging.
        # Log the concrete type, usage_metadata value, and whether
        # response_metadata carries a raw ``usage`` dict (Anthropic always
        # populates this even during streaming).
        # ─────────────────────────────────────────────────────────────────────────
        _rm = getattr(output_data, "response_metadata", None)
        _rm_usage = _rm.get("usage") if isinstance(_rm, dict) else None
        self.logger.debug(
            "[USAGE_DIAG] execution=%s run_id=%s "
            "output_data_type=%s "
            "has_usage_metadata=%s usage_metadata=%r "
            "response_metadata_keys=%s "
            "response_metadata_usage=%r",
            self.execution_id,
            run_id,
            type(output_data).__name__,
            hasattr(output_data, "usage_metadata"),
            getattr(output_data, "usage_metadata", "N/A"),
            list(_rm.keys()) if isinstance(_rm, dict) else "N/A",
            _rm_usage,
        )
        del _rm, _rm_usage

        # ─────────────────────────────────────────────────────────────────────────
        # Extract usage metadata from LangChain response (Phase 3)
        #
        # LangChain normalises provider token counts into a unified
        # ``usage_metadata`` structure:
        #   input_tokens   — TOTAL input including cache (both providers)
        #   output_tokens  — output / completion tokens
        #   input_token_details.cache_creation — Anthropic cache writes
        #   input_token_details.cache_read     — cache reads (both)
        #
        # For cost calculation we need four disjoint buckets:
        #   regular_input = input_tokens - cache_creation - cache_read
        # ─────────────────────────────────────────────────────────────────────────
        total_input_tokens = 0
        output_tokens = 0
        cache_creation_tokens = 0
        cache_read_tokens = 0
        model_name = ""
        
        # Resolve usage_metadata from AIMessage attribute or raw dict.
        usage: dict | None = None
        if hasattr(output_data, "usage_metadata") and output_data.usage_metadata:
            usage = output_data.usage_metadata
        elif isinstance(output_data, dict):
            usage = output_data.get("usage_metadata") or output_data.get("usage")

        # UsageMetadata is a TypedDict (plain dict at runtime) in all
        # langchain-core versions.  Use dict .get() for key access;
        # getattr() silently returns the default on dicts.
        if usage and isinstance(usage, dict):
            total_input_tokens = usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0
            output_tokens = usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0
            details = usage.get("input_token_details") or {}
            if isinstance(details, dict):
                cache_creation_tokens = details.get("cache_creation", 0) or 0
                cache_read_tokens = details.get("cache_read", 0) or 0
        
        # Derive the non-cached regular input (disjoint bucket for cost)
        regular_input_tokens = max(0, total_input_tokens - cache_creation_tokens - cache_read_tokens)
        
        # Extract model name from response_metadata
        if hasattr(output_data, "response_metadata"):
            response_meta = output_data.response_metadata
            if isinstance(response_meta, dict):
                model_name = response_meta.get("model", "") or response_meta.get("model_name", "")
        elif isinstance(output_data, dict):
            response_meta = output_data.get("response_metadata", {})
            model_name = response_meta.get("model", "") or response_meta.get("model_name", "")
        
        # ─────────────────────────────────────────────────────────────────────────
        # Finalize AI message streaming state fields
        # ─────────────────────────────────────────────────────────────────────────
        ai_message = messages_list[ai_message_index]
        
        ai_message.is_streaming = False
        
        # ─────────────────────────────────────────────────────────────────────────
        # Diagnostic: detect text content dropped during streaming
        #
        # The output_data contains the FULL final AIMessage with all content
        # blocks.  Extract the text portion and compare with what the stream
        # handler accumulated.  A mismatch proves tokens were silently dropped.
        # ─────────────────────────────────────────────────────────────────────────
        try:
            final_text = ""
            if hasattr(output_data, "content"):
                oc = output_data.content
                if isinstance(oc, str):
                    final_text = oc
                elif isinstance(oc, list):
                    final_text = formatting.extract_string_content(oc)
            elif isinstance(output_data, dict) and "content" in output_data:
                oc = output_data["content"]
                if isinstance(oc, str):
                    final_text = oc
                elif isinstance(oc, list):
                    final_text = formatting.extract_string_content(oc)
            
            streamed_text = ai_message.content
            if final_text and final_text != streamed_text:
                self.logger.warning(
                    f"[CONTENT_DROP] execution={self.execution_id} run_id={run_id} "
                    f"namespace={namespace or 'main'} "
                    f"streamed_len={len(streamed_text)} final_len={len(final_text)} "
                    f"streamed={streamed_text[:200]!r} "
                    f"final={final_text[:200]!r}"
                )
                # Reconcile: overwrite with the authoritative final content
                # so the CLI shows the complete message even if streaming
                # was disrupted (e.g. by proto copy semantics).
                ai_message.content = final_text
            elif final_text:
                self.logger.debug(
                    f"[CONTENT_OK] execution={self.execution_id} run_id={run_id} "
                    f"len={len(streamed_text)} content={streamed_text[:100]!r}"
                )
        except Exception:
            pass
        
        # ─────────────────────────────────────────────────────────────────────────
        # Record usage via UsageTracker (Phase 3)
        #
        # Delegates all token accounting, pricing lookup, cost computation,
        # LlmCallMetrics construction, and ModelUsage aggregation to the
        # tracker.  The returned LlmCallMetrics is used to enrich the
        # AgentMessage with per-message cost and model fields.
        # ─────────────────────────────────────────────────────────────────────────
        scope = sub_agent.id if sub_agent else MAIN_SCOPE
        
        call_metrics = self._usage_tracker.record_llm_call(
            model_name=model_name,
            input_tokens=regular_input_tokens,
            output_tokens=output_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
            duration_ms=generation_duration_ms,
            timestamp=_utc_timestamp(),
            scope=scope,
        )
        
        ai_message.llm_metrics.CopyFrom(call_metrics)
        
        self.logger.debug(
            "AI message finalized at index %d scope=%s "
            "(tokens: %d, cost: $%.6f, duration: %sms)",
            ai_message_index,
            scope,
            total_input_tokens + output_tokens,
            call_metrics.estimated_cost_usd,
            generation_duration_ms or "N/A",
        )
    
    # Helper methods
    def resolve_run_id(self, run_id: str) -> str:
        """Resolve a run_id to its canonical tool_call_id.

        Delegates to :class:`ToolCallIdCapture` which checks resume-path
        aliases first, then the callback-captured mapping, and falls back
        to *run_id* unchanged.
        """
        return self._tool_call_id_capture.resolve(run_id)
    
    def rebuild_index_from_persisted_status(self) -> None:
        """Reconstruct proto-derivable indexes from the persisted status.

        On the resume-after-approval path, the StatusBuilder is initialized
        with the DB-persisted status that already contains tool calls embedded
        in messages.  This method delegates to ``ExecutionState.rebuild_from_proto``
        to re-populate tool call indexes, completed sub-agents, and artifacts
        so the subsequent stream cycle resolves correctly.
        """
        self.state = ExecutionState.rebuild_from_proto(self.state.proto)

    def prepare_task_tool_resume_queue(self) -> int:
        """Pre-populate the early tool call queue for task tools on resume.

        On resume from a sub-agent HITL interrupt, ``astream_events`` does
        NOT replay the AI message's ``tool_use`` blocks — the AI node
        completed in a prior checkpoint and is not re-executed.  Only
        ``on_tool_start`` fires (from the tool node re-execution).  This
        leaves ``_early_tool_call_queue`` empty, causing the task handler
        to fall back to ``run_id`` as the ``tool_call_id``, which doesn't
        match the original Anthropic ``toolu_*`` ID stored on the
        SubAgentExecution.  The result is duplicate SubAgentExecution
        entries on every resume cycle.

        This method simulates what ``_create_early_tool_call`` would have
        done by scanning persisted messages for task tool calls that have
        a corresponding SubAgentExecution and queueing them for
        ``_reconcile_early_tool_call``.

        Safe against double-queueing: if ``astream_events`` also replays
        the AI message on some resume paths, ``_create_early_tool_call``'s
        existing dedup re-queues the same entry.
        ``_reconcile_early_tool_call`` pops the first match; any leftover
        entry is harmless.

        Must be called **after** ``rebuild_index_from_persisted_status``
        (which builds ``_tool_call_index``) and **before** the stream starts.

        Returns the number of task tool calls queued.
        """
        sa_ids = {sa.id for sa in self.current_status.sub_agent_executions}
        queued = 0

        for msg in self.current_status.messages:
            if msg.type != MessageType.MESSAGE_AI:
                continue
            for tc in msg.tool_calls:
                if tc.name != "task" or not tc.id:
                    continue
                if tc.id not in sa_ids:
                    continue
                already_queued = any(
                    tid == tc.id for tid, _ in self.state.early_tool_call_queue
                )
                if already_queued:
                    continue

                self.state.early_tool_call_queue.append((tc.id, None))
                queued += 1
                self.logger.info(
                    "[RESUME_PREP] execution=%s pre-queued task TC %s "
                    "for sub-agent resume reconciliation",
                    self.execution_id, tc.id,
                )

        return queued

    def _extract_tool_result_content(self, result: Any) -> str:
        """Delegate to :func:`formatting.extract_tool_result_content`."""
        return formatting.extract_tool_result_content(result)
    
    def _create_early_tool_call(self, tool_name: str, tool_use_id: str,
                               ns_key: str, namespace: str,
                               llm_run_id: str = "") -> None:
        """Delegate to :func:`streaming_buffers.create_early_tool_call`."""
        streaming_buffers.create_early_tool_call(
            self, tool_name, tool_use_id, ns_key, namespace, llm_run_id,
        )

    def _reconcile_early_tool_call(self, tool_name: str, run_id: str,
                                   tool_args: dict[str, Any],
                                   namespace: str) -> ToolCall | None:
        """Delegate to :func:`streaming_buffers.reconcile_early_tool_call`."""
        return streaming_buffers.reconcile_early_tool_call(
            self, tool_name, run_id, tool_args, namespace,
        )
    
    def _update_todos(self, todos_data: list) -> None:
        """Replace the todo snapshot in the local execution status.

        ``TodoListMiddleware`` (LangChain) performs full-snapshot replacement:
        each ``write_todos`` call carries the *complete* current todo list, not
        a delta.  We therefore clear existing todos before applying the new set.

        LangChain's ``Todo`` TypedDict has ``{content, status}`` but no ``id``
        field.  When ``id`` is absent we generate a stable, position-based key
        (``todo-0``, ``todo-1``, ...) so the proto ``map<string, TodoItem>``
        contract is satisfied and downstream consumers (CLI fingerprint diffing,
        Go status storage) work unchanged.
        """
        status_map = {
            "pending": TodoStatus.TODO_PENDING,
            "in_progress": TodoStatus.TODO_IN_PROGRESS,
            "completed": TodoStatus.TODO_COMPLETED,
            "cancelled": TodoStatus.TODO_CANCELLED,
        }

        self.current_status.todos.clear()

        now = _utc_timestamp()
        for idx, todo_dict in enumerate(todos_data):
            todo_id = todo_dict.get("id") or f"todo-{idx}"

            status_str = todo_dict.get("status", "pending").lower()
            status_enum = status_map.get(status_str, TodoStatus.TODO_PENDING)

            todo_item = TodoItem(
                id=todo_id,
                content=todo_dict.get("content", ""),
                status=status_enum,
                created_at=todo_dict.get("created_at", now),
                updated_at=now,
            )

            self.current_status.todos[todo_id].CopyFrom(todo_item)

        self.logger.info(
            "Updated todos: %d item(s) in snapshot", len(todos_data),
        )

    def _update_sub_agent_todos(
        self, sub_agent: SubAgentExecution, todos_data: list
    ) -> None:
        """Replace the todo snapshot on a sub-agent execution.

        Same snapshot-replacement semantics as ``_update_todos`` but targets
        ``sub_agent.todos`` instead of ``self.current_status.todos``.
        """
        status_map = {
            "pending": TodoStatus.TODO_PENDING,
            "in_progress": TodoStatus.TODO_IN_PROGRESS,
            "completed": TodoStatus.TODO_COMPLETED,
            "cancelled": TodoStatus.TODO_CANCELLED,
        }

        sub_agent.todos.clear()

        now = _utc_timestamp()
        for idx, todo_dict in enumerate(todos_data):
            todo_id = todo_dict.get("id") or f"todo-{idx}"

            status_str = todo_dict.get("status", "pending").lower()
            status_enum = status_map.get(status_str, TodoStatus.TODO_PENDING)

            todo_item = TodoItem(
                id=todo_id,
                content=todo_dict.get("content", ""),
                status=status_enum,
                created_at=todo_dict.get("created_at", now),
                updated_at=now,
            )

            sub_agent.todos[todo_id].CopyFrom(todo_item)

        self.logger.info(
            "Updated sub-agent todos: %d item(s) (sub_agent_id=%s)",
            len(todos_data),
            sub_agent.id,
        )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Approval State Management (HITL Phase 2)
    #
    # Approval-waiting state is set inline by _handle_tool_start_event() and
    # _reconcile_early_tool_call() at ToolCall creation time.  On resume,
    # ResumeReconciler (hitl.py) handles reconciliation and clears pending
    # approvals via the clear-signal sentinel pattern.
    #
    # The helpers below manage non-resume pending-approvals bookkeeping:
    # clearing all pending state and syncing sub-agent approval lists.
    # ─────────────────────────────────────────────────────────────────────────────

    def clear_pending_approval(self) -> None:
        """Clear pending approval tracking state and restore execution phase.

        Called when all approval decisions have been processed (or on reject).
        Restores the execution phase to what it was before entering
        WAITING_FOR_APPROVAL (typically IN_PROGRESS).
        """
        self.state.approval.pending.clear()

        if self.state.approval.wait_started_at is not None:
            self.state.approval.wait_started_at = None

        if self.state.approval.saved_phase is not None:
            self.current_status.phase = self.state.approval.saved_phase
            self.state.approval.saved_phase = None
        else:
            self.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS

    def _check_tool_approval_requirement(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> ApprovalRequirement:
        """
        Check if a tool requires approval based on the configured policy chain.
        
        Uses the ApprovalConfig to resolve whether this tool requires approval.
        If no ApprovalConfig is set, tools never require approval.
        
        Args:
            tool_name: Name of the tool to check
            tool_args: Tool arguments (used for logging, not policy resolution)
            
        Returns:
            ApprovalRequirement with resolved approval status and message
        """
        # No approval config = no approval required
        if self._approval_config is None:
            return ApprovalRequirement(
                requires_approval=False,
                message="",
                source="none",
            )
        
        # Resolve using policy chain
        mcp_server_name = self._approval_config.get_mcp_server_for_tool(tool_name)
        default_policies = self._approval_config.get_default_policies_for_tool(tool_name)
        
        return resolve_tool_approval(
            tool_name=tool_name,
            mcp_server_name=mcp_server_name,
            auto_approve_all=self._approval_config.auto_approve_all,
            tool_approval_overrides=self._approval_config.tool_approval_overrides,
            default_tool_approvals=default_policies,
        )
    
    def _set_waiting_for_approval_phase(
        self, tool_name: str, run_id: str,
    ) -> None:
        """Transition execution phase to WAITING_FOR_APPROVAL.

        Saves the current phase (only on the first pending approval) so
        ``clear_pending_approval()`` can restore it later.  Also tracks the
        run_id in ``_pending_tool_approvals`` and forces an immediate gRPC push.
        """
        post_approval_statuses = frozenset({
            ToolCallStatus.TOOL_CALL_RUNNING,
            ToolCallStatus.TOOL_CALL_COMPLETED,
            ToolCallStatus.TOOL_CALL_FAILED,
            ToolCallStatus.TOOL_CALL_SKIPPED,
        })
        tc_id = self._tool_call_id_capture.resolve(run_id)
        existing_tc = self.get_tool_call(tc_id)
        if existing_tc is not None and existing_tc.status in post_approval_statuses:
            self.logger.warning(
                "[APPROVAL_GUARD] execution=%s tool=%s tc_id=%s "
                "skipping phase transition — tool call already in "
                "post-approval state %s",
                self.execution_id, tool_name, tc_id,
                ToolCallStatus.Name(existing_tc.status),
            )
            return

        if self.state.approval.saved_phase is None:
            self.state.approval.saved_phase = self.current_status.phase
            self.state.approval.wait_started_at = datetime.utcnow()
        self.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL

        self.state.approval.pending.append(run_id)
        self.force_next_update = True

        self.logger.info(
            f"[APPROVAL] execution={self.execution_id} "
            f"tool={tool_name} run_id={run_id} tc_id={tc_id} "
            f"status=WAITING_APPROVAL "
            f"pending_count={len(self.state.approval.pending)}"
        )
    
    def _find_tool_call_by_id(self, run_id: str) -> ToolCall | None:
        """Find a ToolCall by its run_id via the in-memory index.

        Alias for :meth:`get_tool_call` retained for internal callers.
        """
        return self.state.tool_calls.get(run_id)
    
    def _humanize_args_for_display(self, tool_args: dict[str, Any]) -> dict[str, Any]:
        """Return a shallow copy of *tool_args* with string values humanized.

        Applies, in order:

        1. :func:`humanize_platform_refs` — ``$STIGMER_PLATFORM_DIR`` → ``.stigmer``
        2. :func:`resolve_display_env_vars` — ``$KEY`` → value (respecting secrets)
        3. :func:`humanize_sandbox_paths` — absolute sandbox paths → workspace-relative

        Non-string values are passed through unchanged.

        The original *tool_args* dict is never modified — callers that also
        need the raw args (e.g. for fingerprinting or approval checks) are
        safe.
        """
        if not tool_args:
            return tool_args

        result: dict[str, Any] = {}
        for key, value in tool_args.items():
            if isinstance(value, str):
                value = humanize_platform_refs(value)
                value = resolve_display_env_vars(
                    value, self._display_env_vars, self._secret_keys,
                )
                value = humanize_sandbox_paths(value, self._workspace_root)
            result[key] = value
        return result

    def _create_args_preview(self, tool_args: dict[str, Any]) -> str:
        """
        Create a sanitized preview of tool arguments for UI display.
        
        Sensitive values (passwords, tokens, keys) are redacted.
        Large values are truncated for readability.
        
        Args:
            tool_args: Tool arguments dictionary
            
        Returns:
            JSON string suitable for UI display
        """
        if not tool_args:
            return "{}"
        
        # List of key patterns that indicate sensitive data
        sensitive_patterns = [
            "password", "passwd", "pwd",
            "token", "api_key", "apikey", "api-key",
            "secret", "credential", "auth",
            "private_key", "privatekey", "private-key",
        ]
        
        def sanitize_value(key: str, value: Any) -> Any:
            """Sanitize a single value based on its key name."""
            key_lower = key.lower()
            
            # Check if key matches sensitive patterns
            for pattern in sensitive_patterns:
                if pattern in key_lower:
                    return "***REDACTED***"
            
            if isinstance(value, str):
                value = humanize_platform_refs(value)
                value = resolve_display_env_vars(
                    value, self._display_env_vars, self._secret_keys,
                )
                return value
            
            if isinstance(value, dict):
                return {k: sanitize_value(k, v) for k, v in value.items()}
            
            if isinstance(value, list):
                return [sanitize_value(str(i), v) for i, v in enumerate(value)]
            
            return value
        
        sanitized = {k: sanitize_value(k, v) for k, v in tool_args.items()}
        
        try:
            return json.dumps(sanitized, indent=2, default=str)
        except (TypeError, ValueError):
            return "{}"
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Sub-Agent Namespace Routing (Phase 2.3)
    # ─────────────────────────────────────────────────────────────────────────────
    
    def _get_execution_context(self, namespace: str) -> tuple[Any, SubAgentExecution | None]:
        """
        Determine execution context based on namespace.
        
        Root-level events (namespace == "") route to main agent status.
        Sub-agent events (namespace != "") route to the corresponding SubAgentExecution.
        
        Args:
            namespace: LangGraph checkpoint namespace string
            
        Returns:
            Tuple of (container, sub_agent_or_none):
            - Root events: (self.current_status, None)
            - Sub-agent events: (sub_agent, sub_agent)
        """
        if not namespace:
            return self.current_status, None
        
        # Try to find matching sub-agent by namespace
        sub_agent_id = self.state.namespace_to_sub_agent.get(namespace)
        if sub_agent_id:
            if sub_agent_id in self.state.active_sub_agents:
                return self.state.active_sub_agents[sub_agent_id], self.state.active_sub_agents[sub_agent_id]

            # Late-arriving event: the sub-agent already completed but
            # LangGraph emitted one more event (e.g. on_chat_model_end
            # finalizing a message that was streamed before completion).
            if sub_agent_id in self.state.completed_sub_agents:
                self.logger.debug(
                    f"[SUBAGENT] execution={self.execution_id} "
                    f"late event routed to completed sub-agent={sub_agent_id} "
                    f"namespace={namespace}"
                )
                return self.state.completed_sub_agents[sub_agent_id], self.state.completed_sub_agents[sub_agent_id]

        # Namespace not yet registered — fall back to main agent.
        # Single-segment namespaces (no "|") are normal main-agent graph
        # activity (e.g., the tools node).  Only warn for multi-segment
        # namespaces, which indicate sub-agent events that should have
        # been routed.  Deduplicate: warn once per unique namespace.
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

        v2 ``astream_events`` carry a ``parent_ids`` list tracing the full
        callback chain.  When a sub-agent event arrives, at least one entry
        in ``parent_ids`` is the task tool's ``run_id`` — the same key stored
        in ``_active_sub_agents``.  This provides a deterministic mapping
        without heuristics (no root-prefix, no FIFO queue, no substring
        matching, no sole-active fallback).

        Single-segment namespaces (no ``|``) are from the main agent's graph
        nodes and are intentionally not registered.

        Args:
            namespace: LangGraph checkpoint namespace string.
            event: The full v2 astream_events event dict (carries
                ``parent_ids`` at the top level).
        """
        if not namespace or namespace in self.state.namespace_to_sub_agent:
            return

        if "|" not in namespace:
            return

        parent_ids: list[str] = event.get("parent_ids", [])
        for pid in parent_ids:
            if pid in self.state.active_sub_agents:
                self.state.namespace_to_sub_agent[namespace] = pid
                self.logger.debug(
                    "[SUBAGENT] namespace=%s -> sub_agent=%s (via parent_ids)",
                    namespace, pid,
                )
                return
            if pid in self.state.completed_sub_agents:
                self.state.namespace_to_sub_agent[namespace] = pid
                self.logger.debug(
                    "[SUBAGENT] namespace=%s -> completed sub_agent=%s "
                    "(via parent_ids)",
                    namespace, pid,
                )
                return

        self.logger.debug(
            "[SUBAGENT] execution=%s namespace=%s not resolved: "
            "parent_ids=%s matched neither active=%s nor completed=%s",
            self.execution_id, namespace, parent_ids,
            list(self.state.active_sub_agents.keys()),
            list(self.state.completed_sub_agents.keys()),
        )
    
    async def _handle_sub_agent_start(self, event: dict[str, Any],
                                     tool_args: dict[str, Any], run_id: str,
                                     *, tool_call_id: str | None = None) -> None:
        """Delegate to :func:`sub_agent_handlers.handle_sub_agent_start`."""
        await sub_agent_handlers.handle_sub_agent_start(
            self, event, tool_args, run_id, tool_call_id=tool_call_id,
        )

    def _flush_pending_completions(self) -> list[str]:
        """Delegate to :func:`sub_agent_handlers.flush_pending_completions`."""
        return sub_agent_handlers.flush_pending_completions(self)

    def _handle_sub_agent_end(self, event: dict[str, Any], run_id: str) -> None:
        """Delegate to :func:`sub_agent_handlers.handle_sub_agent_end`."""
        sub_agent_handlers.handle_sub_agent_end(self, event, run_id)

    @property
    def has_orphaned_sub_agents(self) -> bool:
        """True when sub-agents remain active after the event stream ended."""
        return bool(self.state.active_sub_agents)

    def get_orphaned_sub_agents_diagnostic(self) -> dict:
        """Delegate to :func:`sub_agent_handlers.get_orphaned_diagnostic`."""
        return sub_agent_handlers.get_orphaned_diagnostic(self)

    def finalize_active_sub_agents(self, status: SubAgentStatus, error: str) -> None:
        """Delegate to :func:`sub_agent_handlers.finalize_active`."""
        sub_agent_handlers.finalize_active(self, status, error)

    def finalize_active_sub_agents_differentiated(self, error_context: str) -> int:
        """Delegate to :func:`sub_agent_handlers.finalize_active_differentiated`."""
        return sub_agent_handlers.finalize_active_differentiated(self, error_context)

    def finalize_sub_agents_from_checkpoint_validation(
        self, missed_event_count: int, confirmed_orphan_count: int,
        error_context: str,
    ) -> int:
        """Delegate to :func:`sub_agent_handlers.finalize_from_checkpoint_validation`."""
        return sub_agent_handlers.finalize_from_checkpoint_validation(
            self, missed_event_count, confirmed_orphan_count, error_context,
        )

    # ─────────────────────────────────────────────────────────────────────────────
    # Usage Metrics (Phase 3 — delegated to UsageTracker)
    # ─────────────────────────────────────────────────────────────────────────────
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Resolved Execution Context (Phase 2.5)
    #
    # Captures what resources the agent had access to at execution time.
    # This is set once after all resources are resolved, before streaming begins.
    # ─────────────────────────────────────────────────────────────────────────────
    
    def build_pending_approvals_snapshot(self) -> list[PendingApproval]:
        """Build pending_approvals snapshot for the Temporal slim status.

        This is a point-in-time coordination signal for the Temporal workflow,
        NOT a DB-persisted projection.  The DB projection is computed
        server-side by Go/Java ``ComputePendingApprovals`` on every
        ``UpdateStatus`` write (DD-001).

        The Temporal workflow uses this snapshot to determine how many
        approval signals to collect before re-invoking the Python activity.
        Reading from the DB is unsafe because the ``SubmitApproval`` handler
        may have already recorded decisions (mutating the DB projection)
        before the workflow reads it.
        """
        result: list[PendingApproval] = []
        for tc in self.iter_all_tool_calls():
            if (
                tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                and tc.requires_approval
                and tc.approval_action
                == ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
            ):
                result.append(PendingApproval(tool_call_id=tc.id))
        return result

    def set_resolved_context(self, environment_keys: list[str],
                             mcp_servers: dict[str, tuple[bool, str, int]],
                             skill_names: list[str],
                             excluded_skill_names: list[str] | None = None) -> None:
        """Delegate to :func:`context_handlers.set_resolved_context`."""
        context_handlers.set_resolved_context(
            self, environment_keys, mcp_servers, skill_names, excluded_skill_names,
        )

    def initialize_context_info(self, context_window_limit: int,
                                trigger_threshold: int, target_tokens: int,
                                enabled: bool) -> None:
        """Delegate to :func:`context_handlers.initialize_context_info`."""
        context_handlers.initialize_context_info(
            self, context_window_limit, trigger_threshold, target_tokens, enabled,
        )

    def on_summarization_complete(self, event: SummarizationEventData) -> None:
        """Delegate to :func:`context_handlers.on_summarization_complete`."""
        context_handlers.on_summarization_complete(self, event)

    def on_token_count_updated(self, token_count: int) -> None:
        """Delegate to :func:`context_handlers.on_token_count_updated`."""
        context_handlers.on_token_count_updated(self, token_count)

    def finalize_context_info(self) -> None:
        """Delegate to :func:`context_handlers.finalize_context_info`."""
        context_handlers.finalize_context_info(self)

    def add_artifact(self, artifact: ExecutionArtifact) -> None:
        """Delegate to :func:`context_handlers.add_artifact`."""
        context_handlers.add_artifact(self, artifact)

    def add_workspace_write_back(self, wb) -> None:
        """Delegate to :func:`context_handlers.add_workspace_write_back`."""
        context_handlers.add_workspace_write_back(self, wb)
    