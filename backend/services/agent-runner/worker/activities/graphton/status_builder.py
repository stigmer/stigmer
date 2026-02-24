"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import hashlib
import json
import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    AgentMessage,
    ApprovalAction,
    ComponentMetadata,
    ContextInfo,
    ExecutionArtifact,
    McpServerResolutionStatus,
    PendingApproval,
    ResolvedExecutionContext,
    SubAgentExecution,
    SummarizationEvent,
    TodoItem,
    ToolCall,
    UsageMetrics,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
    TodoStatus,
    ToolCallStatus,
)
from google.protobuf.struct_pb2 import Struct
from graphton.core.summarization_callback import SummarizationEventData

from worker.activities.graphton.approval_policy import (
    ApprovalConfig,
    ApprovalRequirement,
    render_approval_message,
    resolve_tool_approval,
)
from worker.component_type_inference import infer_component_type

# Planning tools that update execution state without UI display
PLANNING_TOOLS = {
    'write_todos',
}

# Maps tool names to the arg field(s) that contain the bulk displayable content
# (ordered by priority).  Used by the input-streaming extractor to pull clean
# content from the accumulating partial JSON and pipe it into tool_call.result.
# Tools not listed here either generate tiny args (< 1 s) or have no meaningful
# content to stream — they are left with an empty result during the early phase.
_TOOL_CONTENT_FIELDS: dict[str, list[str]] = {
    "write":          ["contents", "content", "file_content"],
    "write_file":     ["contents", "content", "file_content"],
    "create_file":    ["contents", "content", "file_content"],
    "overwrite_file": ["contents", "content", "file_content"],
    "edit":           ["new_text", "new_string", "replacement", "content"],
    "edit_file":      ["new_text", "new_string", "replacement", "content"],
    "think":          ["thought"],
}

# JSON escape → Python character mapping (single-char sequences).
_JSON_ESCAPES: dict[str, str] = {
    "n": "\n", "t": "\t", "r": "\r",
    '"': '"', "\\": "\\", "/": "/",
    "b": "\b", "f": "\f",
}


def _find_json_string_value_start(partial_json: str, field_name: str) -> int:
    """Return the index of the first content character of a JSON string value.

    Searches *partial_json* for ``"<field_name>"`` followed by ``:`` and ``"``,
    skipping optional whitespace.  Returns the index immediately after the
    opening quote, or ``-1`` if the pattern has not yet appeared.

    Robust against missing whitespace (``"key":"val"``) and extra whitespace
    (``"key" :  "val"``).
    """
    marker = f'"{field_name}"'
    pos = partial_json.find(marker)
    if pos < 0:
        return -1
    after_key = pos + len(marker)
    colon_pos = partial_json.find(":", after_key)
    if colon_pos < 0:
        return -1
    quote_pos = partial_json.find('"', colon_pos + 1)
    if quote_pos < 0:
        return -1
    return quote_pos + 1


def _json_unescape_partial(s: str) -> str:
    """Unescape a partial JSON string value.

    Converts standard JSON escape sequences (``\\n``, ``\\t``, ``\\"``, etc.)
    to their Python equivalents.  Processing stops at the closing ``"`` (end of
    JSON string) or at the end of the input (string is still being generated).

    A trailing backslash with no following character is silently dropped to
    avoid showing a garbled escape that is not yet complete.
    """
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch == "\\":
            if i + 1 >= n:
                break  # incomplete escape at boundary — drop it
            nxt = s[i + 1]
            if nxt == "u":
                if i + 5 < n:
                    try:
                        out.append(chr(int(s[i + 2 : i + 6], 16)))
                        i += 6
                        continue
                    except ValueError:
                        pass
                break  # incomplete \\uXXXX — wait for more data
            out.append(_JSON_ESCAPES.get(nxt, nxt))
            i += 2
        elif ch == '"':
            break  # end of JSON string value
        else:
            out.append(ch)
            i += 1
    return "".join(out)


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
    ):
        """
        Initialize status builder.
        
        Args:
            execution_id: The execution ID
            initial_status: Initial AgentExecutionStatus proto
            approval_config: Optional approval policy configuration. When provided,
                           tools matching approval policies will be set to
                           WAITING_APPROVAL status instead of RUNNING.
        """
        self.execution_id = execution_id
        self.current_status = initial_status
        self.logger = logging.getLogger(__name__)
        
        # Approval policy configuration (HITL Phase 2)
        # When set, tool calls are checked against policies before execution
        self._approval_config = approval_config
        
        # Track tool calls for deduplication
        self.tool_call_fingerprints: set = set()
        
        # Namespace mapping for sub-agent tool call routing
        self.namespace_mapping: dict[str, dict[str, str]] = {}
        
        # Track AI message generation timing for duration calculation
        # Key: message index in messages list, Value: start timestamp
        self._message_start_times: dict[int, datetime] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # LLM Stream Isolation (run_id-based message tracking)
        #
        # Maps each LLM invocation's run_id to the AgentMessage it owns.
        # This prevents token interleaving when multiple LLM streams are
        # active (e.g., concurrent sub-agents whose namespace routing fell
        # through to the main agent).  Each run_id always writes to its own
        # dedicated message — no two LLM invocations can share a message.
        # ─────────────────────────────────────────────────────────────────────────
        self._llm_run_id_to_message: dict[str, AgentMessage] = {}
        
        # Track tool execution timing for duration calculation (Phase 2.2)
        # Key: run_id, Value: start timestamp
        self._tool_start_times: dict[str, datetime] = {}
        
        # Track accumulated token usage across all LLM calls in this execution
        self._total_prompt_tokens: int = 0
        self._total_completion_tokens: int = 0
        
        # ─────────────────────────────────────────────────────────────────────────
        # Sub-Agent Tracking (Phase 2.3)
        #
        # These structures enable namespace-based event routing to capture
        # tool calls and messages within sub-agent executions.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Track active sub-agent executions by their run_id
        # Key: run_id (from task tool), Value: SubAgentExecution proto
        self._active_sub_agents: dict[str, SubAgentExecution] = {}
        
        # Map namespace to sub-agent run_id for event routing
        # Key: namespace string, Value: sub-agent run_id
        self._namespace_to_sub_agent_id: dict[str, str] = {}
        
        # Causal namespace registration: when a "task" tool starts, we record
        # its sub-agent ID here.  The next unregistered multi-segment namespace
        # (indicating a nested sub-graph) is associated with this sub-agent.
        # Consumed (set to None) once the first namespace is registered.
        self._pending_sub_agent_id: str | None = None
        
        # Namespaces already warned about (deduplication — log once per namespace)
        self._warned_namespaces: set[str] = set()
        
        # Track AI message generation timing within sub-agents (separate from main)
        # Key: (sub_agent_id, message_index), Value: start timestamp
        self._sub_agent_message_start_times: dict[tuple[str, int], datetime] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Usage Metrics Tracking (Phase 2.4)
        #
        # These structures track LLM call counts and model usage for UsageMetrics.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Main agent LLM call counter
        self._llm_call_count: int = 0
        
        # Primary model name (captured from first LLM response)
        self._primary_model: str = ""
        
        # Per-sub-agent usage tracking
        # Key: sub_agent_id (run_id), Value: accumulated metrics
        self._sub_agent_llm_call_count: dict[str, int] = {}
        self._sub_agent_prompt_tokens: dict[str, int] = {}
        self._sub_agent_completion_tokens: dict[str, int] = {}
        self._sub_agent_primary_model: dict[str, str] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Approval State Tracking (HITL — Batch Approval)
        #
        # Tracks which tool calls are currently pending approval.  When the LLM
        # issues multiple tool calls that each require approval in a single
        # response, LangGraph creates one interrupt per tool.  We track ALL of
        # them so the post-stream interrupt-capture logic can match each
        # interrupt to its tool call.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Ordered list of ALL run_ids currently pending approval.
        self._pending_tool_approvals: list[str] = []
        
        # Saved execution phase to restore after approval decision
        # (preserves IN_PROGRESS state when transitioning to WAITING_FOR_APPROVAL)
        self._saved_phase_before_approval: int | None = None
        
        # ─────────────────────────────────────────────────────────────────────────
        # Context Management Tracking (Phase 3)
        #
        # Tracks context window utilization and summarization events.
        # This class implements the SummarizationCallback protocol for integration
        # with the SummarizationMiddleware in graphton.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Context info initialized via initialize_context_info()
        self._context_info: ContextInfo | None = None
        
        # Accumulated summarization events during this execution
        self._summarization_events: list[SummarizationEvent] = []
        
        # ─────────────────────────────────────────────────────────────────────────
        # Run-ID Alias Map (Resume-After-Approval Fix)
        #
        # On the resume path, LangGraph generates fresh run_ids for resumed
        # tools, but the StatusBuilder already holds the original tool call
        # (with the original run_id) from the previous invocation.  Fingerprint
        # deduplication in _handle_tool_start_event correctly prevents a
        # duplicate ToolCall, but the new run_id is lost — so on_tool_end
        # cannot find the existing tool call to mark it COMPLETED.
        #
        # _run_id_aliases maps {new_run_id -> original_tool_call_id} so that
        # on_tool_end and on_tool_progress can resolve the alias and update
        # the correct tool call.
        #
        # _fingerprint_to_tool_call_id maps {fingerprint -> tool_call.id} and
        # is populated by populate_fingerprints_from_existing_tool_calls().
        # It allows the deduplication check to discover which existing tool
        # call a duplicate fingerprint belongs to.
        # ─────────────────────────────────────────────────────────────────────────
        self._run_id_aliases: dict[str, str] = {}
        self._fingerprint_to_tool_call_id: dict[str, str] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Execution Artifacts Tracking (Artifact Lifecycle)
        #
        # Tracks artifacts published by the agent via the publish_artifact tool.
        # Artifacts are accumulated during execution and added to the final status.
        # ─────────────────────────────────────────────────────────────────────────
        self._artifacts: list[ExecutionArtifact] = []
        
        # ─────────────────────────────────────────────────────────────────────────
        # Native Thinking Translation (Extended Thinking → Synthetic Think Tool)
        #
        # When Anthropic models have extended thinking enabled, thinking content
        # blocks arrive via on_chat_model_stream before the text/tool_use
        # response.  We accumulate them here and flush a synthetic "think"
        # ToolCall when the first non-thinking content arrives (or at
        # on_chat_model_end if no text follows).  This lets the entire
        # downstream pipeline (gRPC, CLI) treat native thinking identically
        # to the explicit think tool.
        #
        # Keyed by namespace (empty string for main agent).
        # ─────────────────────────────────────────────────────────────────────────
        self._thinking_buffers: dict[str, str] = {}
        self._thinking_started_at: dict[str, datetime] = {}
        self._thinking_tool_call_ids: dict[str, str] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Early Tool Call Creation (Live Write Streaming UX)
        #
        # When the LLM stream produces a tool_use block, we create the ToolCall
        # immediately — before on_tool_start fires — so the CLI shows the tool
        # name instead of the "Thinking…" idle indicator.  The queue holds temp
        # IDs in FIFO order; on_tool_start pops the first match and reconciles
        # (updating args, registering the real run_id as an alias).
        # ─────────────────────────────────────────────────────────────────────────
        self._early_tool_call_queue: list[str] = []
        
        # ─────────────────────────────────────────────────────────────────────
        # Tool Input Streaming (Live Argument Generation)
        #
        # While the LLM generates tool arguments, Anthropic emits
        # input_json_delta blocks whose partial_json fragments concatenate
        # into the full args JSON.  We accumulate them per early ToolCall and
        # extract displayable content (e.g. the file body for write tools)
        # into tool_call.result so the CLI streams it progressively.
        #
        # _tool_input_active_tc: namespace key → temp_id of the early ToolCall
        #     currently receiving input_json_delta blocks.
        # _tool_input_buffers: temp_id → accumulated partial JSON string.
        # ─────────────────────────────────────────────────────────────────────
        self._tool_input_active_tc: dict[str, str] = {}
        self._tool_input_buffers: dict[str, str] = {}
    
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
        
        # Route by event type.  Each handler is wrapped so a single bad
        # event never crashes the entire activity stream.
        handler = None
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
                handler(event, namespace)
            except Exception:
                self.logger.exception(
                    f"[EVENT_ERROR] execution={self.execution_id} "
                    f"event_type={event_type} namespace={namespace or 'main'} "
                    f"run_id={event.get('run_id', '')}"
                )
    
    def _handle_tool_start_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Handle on_tool_start event - updates local status."""
        tool_name = event.get("name", "")
        tool_args_raw = event.get("data", {}).get("input", {})
        run_id = event.get("run_id", "")
        
        if not tool_name or not run_id:
            return
        
        tool_args = self._unwrap_tool_args(tool_args_raw)
        
        # Check for duplicate.
        # On the resume-after-approval path, LangGraph re-fires on_tool_start
        # for resumed tools with a NEW run_id.  The fingerprint matches an
        # existing entry (populated by populate_fingerprints_from_existing_tool_calls),
        # so we correctly skip creating a duplicate ToolCall.  However, the
        # subsequent on_tool_end event carries this new run_id and must be able
        # to find the original ToolCall.  We record a run-ID alias so that
        # _resolve_run_id() can bridge the gap.
        fingerprint = self._get_tool_fingerprint(tool_name, tool_args)
        if fingerprint in self.tool_call_fingerprints:
            original_tc_id = self._fingerprint_to_tool_call_id.get(fingerprint)
            if original_tc_id and run_id != original_tc_id:
                self._run_id_aliases[run_id] = original_tc_id
                self.logger.info(
                    f"[RESUME_ALIAS] execution={self.execution_id} "
                    f"tool={tool_name} new_run_id={run_id} -> "
                    f"original_tc_id={original_tc_id} "
                    f"(fingerprint dedup on resume path)"
                )
            return
        self.tool_call_fingerprints.add(fingerprint)
        
        # Handle planning tools
        if tool_name in PLANNING_TOOLS:
            if tool_name == "write_todos":
                todos_data = tool_args.get("todos", [])
                if todos_data:
                    self._update_todos(todos_data)
            return
        
        # ─────────────────────────────────────────────────────────────────────
        # Sub-Agent Detection (Phase 2.3): "task" tool invokes a sub-agent
        # ─────────────────────────────────────────────────────────────────────
        if tool_name == "task":
            self._handle_sub_agent_start(event, tool_args, run_id)
            return  # Don't create regular ToolCall for task tool
        
        # Try to register namespace for event routing (for sub-agent child events)
        if namespace:
            self._register_sub_agent_namespace(namespace)
        
        # ─────────────────────────────────────────────────────────────────────
        # Early Tool Call Reconciliation (Live Write Streaming UX)
        #
        # If _create_early_tool_call already created a ToolCall for this
        # invocation (from a tool_use stream block), reconcile it: populate
        # args, register the real run_id alias, and handle approval — then
        # return without creating a duplicate.
        # ─────────────────────────────────────────────────────────────────────
        early_tc = self._reconcile_early_tool_call(tool_name, run_id, tool_args, namespace)
        if early_tc is not None:
            return
        
        # Create component metadata
        component_type = infer_component_type(tool_name)
        component_metadata = ComponentMetadata(
            component_type=component_type,
            component_group="main-agent-tools",
        )
        
        # ─────────────────────────────────────────────────────────────────────
        # Approval Check (HITL Phase 2): Check if tool requires user approval
        # ─────────────────────────────────────────────────────────────────────
        approval_requirement = self._check_tool_approval_requirement(tool_name, tool_args)
        
        # Create tool call with appropriate initial status
        # If approval required: WAITING_APPROVAL, otherwise: RUNNING
        args_struct = Struct()
        if tool_args:
            args_struct.update(tool_args)
        
        now = datetime.utcnow()
        initial_status = (
            ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
            if approval_requirement.requires_approval
            else ToolCallStatus.TOOL_CALL_RUNNING
        )
        
        tool_call = ToolCall(
            id=run_id,
            name=tool_name,
            args=args_struct,
            result="",
            status=initial_status,
            component_metadata=component_metadata,
            started_at=_utc_timestamp(now),
        )
        
        # If approval required, populate approval fields on the ToolCall
        if approval_requirement.requires_approval:
            rendered_message = render_approval_message(
                template=approval_requirement.message,
                tool_name=tool_name,
                tool_args=tool_args,
            )
            tool_call.requires_approval = True
            tool_call.approval_message = rendered_message
            tool_call.approval_requested_at = _utc_timestamp(now)
        
        # Track start time for duration calculation (even for approval-pending tools)
        self._tool_start_times[run_id] = now
        
        # Create tool message wrapper
        tool_message = AgentMessage(
            type=MessageType.MESSAGE_TOOL,
            content="",
            timestamp=_utc_timestamp(now),
        )
        tool_message.tool_calls.append(tool_call)
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Route to correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        
        # Determine context info for logging
        status_name = ToolCallStatus.Name(initial_status)
        
        if sub_agent:
            # Route to sub-agent's nested lists
            sub_agent.tool_calls.append(tool_call)
            sub_agent.messages.append(tool_message)
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} sub_agent={sub_agent.id} "
                f"tool={tool_name} run_id={run_id} status={status_name}"
            )
        else:
            # Route to main agent status
            self.current_status.messages.append(tool_message)
            self.current_status.tool_calls.append(tool_call)
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} "
                f"tool={tool_name} run_id={run_id} status={status_name}"
            )
        
        # ─────────────────────────────────────────────────────────────────────
        # Approval State Update (HITL Phase 2): Populate PendingApproval if needed
        # ─────────────────────────────────────────────────────────────────────
        if approval_requirement.requires_approval:
            # Now that tool_call is added to the lists, populate pending approval
            # This must happen AFTER adding to lists so _find_tool_call_by_id works
            rendered_message = render_approval_message(
                template=approval_requirement.message,
                tool_name=tool_name,
                tool_args=tool_args,
            )
            
            # Determine if this is from a sub-agent (for UI display)
            from_sub_agent = sub_agent is not None
            sub_agent_name = sub_agent.name if sub_agent else ""
            
            # Populate pending_approval and update execution phase
            self._populate_pending_approval(
                run_id=run_id,
                tool_name=tool_name,
                tool_args=tool_args,
                approval_message=rendered_message,
                from_sub_agent=from_sub_agent,
                sub_agent_name=sub_agent_name,
            )
    
    def _handle_tool_progress_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Handle on_custom_event with name='tool_progress'.
        
        Appends a progress chunk to the ToolCall's result field and sets
        is_streaming=True. This enables live output streaming for tools
        that support progressive output (e.g., execute/shell stdout).
        
        The run_id is read from the event-level field (same as on_tool_start/
        on_tool_end) — NOT from the data payload. dispatch_custom_event called
        within a @tool function inherits the tool's run context, so the run_id
        automatically matches.
        
        Expected event structure:
            {
                "event": "on_custom_event",
                "name": "tool_progress",
                "run_id": str,           # Inherited from tool's run context
                "data": {"chunk": str},  # Partial output to append
            }
        """
        run_id = event.get("run_id", "")
        chunk = event.get("data", {}).get("chunk", "")
        
        if not run_id or not chunk:
            return
        
        # Resolve run-ID alias (resume-after-approval path)
        resolved_id = self._resolve_run_id(run_id)
        
        # Find the ToolCall by resolved_id and update it.
        # Uses _find_tool_call_by_id which searches both main agent and sub-agents.
        tool_call = self._find_tool_call_by_id(resolved_id)
        if tool_call is None:
            self.logger.debug(
                f"[TOOL_PROGRESS] execution={self.execution_id} "
                f"run_id={run_id} resolved_id={resolved_id} "
                f"ignored (tool call not found)"
            )
            return
        
        tool_call.result += chunk
        tool_call.is_streaming = True
        
        self.logger.debug(
            f"[TOOL_PROGRESS] execution={self.execution_id} "
            f"run_id={run_id} resolved_id={resolved_id} "
            f"chunk_len={len(chunk)} total_len={len(tool_call.result)}"
        )
    
    def _handle_tool_end_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Handle on_tool_end event - updates local status with COMPLETED status."""
        tool_name = event.get("name", "")
        run_id = event.get("run_id", "")
        tool_result_raw = event.get("data", {}).get("output", "")
        
        if not run_id or tool_name in PLANNING_TOOLS:
            return
        
        # ─────────────────────────────────────────────────────────────────────
        # Sub-Agent Completion (Phase 2.3): task tool returns sub-agent result
        # ─────────────────────────────────────────────────────────────────────
        if tool_name == "task":
            self._handle_sub_agent_end(event, run_id)
            return
        
        # ─────────────────────────────────────────────────────────────────────
        # Run-ID Alias Resolution (Resume-After-Approval Fix)
        #
        # On the resume path, LangGraph assigns a new run_id to the resumed
        # tool execution.  The existing ToolCall was created in a previous
        # invocation with its original run_id.  _handle_tool_start_event
        # recorded an alias when fingerprint deduplication fired; resolve it
        # here so we can find and update the correct ToolCall.
        # ─────────────────────────────────────────────────────────────────────
        resolved_id = self._resolve_run_id(run_id)
        
        tool_result_content = self._extract_tool_result_content(tool_result_raw)
        now = datetime.utcnow()
        
        # Calculate execution duration if we tracked the start time (Phase 2.2)
        duration_ms = None
        if run_id in self._tool_start_times:
            start_time = self._tool_start_times.pop(run_id)
            duration_ms = int((now - start_time).total_seconds() * 1000)
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Update in correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        
        if sub_agent:
            # Update in sub-agent's messages list
            for message in sub_agent.messages:
                if (message.type == MessageType.MESSAGE_TOOL and 
                    len(message.tool_calls) > 0 and 
                    message.tool_calls[0].id == resolved_id):
                    
                    tc = message.tool_calls[0]
                    tc.result = tool_result_content
                    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tc.completed_at = _utc_timestamp(now)
                    tc.is_streaming = False
                    # Update message content for CLI display
                    message.content = self._format_tool_message_content(
                        tool_name, tc.args, tool_result_content
                    )
                    break
            
            # Update in sub-agent's tool_calls list
            for tool_call in sub_agent.tool_calls:
                if tool_call.id == resolved_id:
                    tool_call.result = tool_result_content
                    tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tool_call.completed_at = _utc_timestamp(now)
                    tool_call.is_streaming = False
                    break
            
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} sub_agent={sub_agent.id} "
                f"tool={tool_name} run_id={run_id} resolved_id={resolved_id} "
                f"status=COMPLETED duration_ms={duration_ms or 'N/A'}"
            )
        else:
            # Update in main agent's messages list
            for message in self.current_status.messages:
                if (message.type == MessageType.MESSAGE_TOOL and 
                    len(message.tool_calls) > 0 and 
                    message.tool_calls[0].id == resolved_id):
                    
                    tc = message.tool_calls[0]
                    tc.result = tool_result_content
                    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tc.completed_at = _utc_timestamp(now)
                    tc.is_streaming = False
                    # Update message content for CLI display
                    message.content = self._format_tool_message_content(
                        tool_name, tc.args, tool_result_content
                    )
                    break
            
            # Update in main agent's tool_calls list
            for tool_call in self.current_status.tool_calls:
                if tool_call.id == resolved_id:
                    tool_call.result = tool_result_content
                    tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tool_call.completed_at = _utc_timestamp(now)
                    tool_call.is_streaming = False
                    break
            
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} "
                f"tool={tool_name} run_id={run_id} resolved_id={resolved_id} "
                f"status=COMPLETED duration_ms={duration_ms or 'N/A'}"
            )
    
    def _handle_chat_model_stream_event(self, event: dict[str, Any], namespace: str = "") -> None:
        """Handle on_chat_model_stream event - updates local status."""
        chunk_data = event.get("data", {}).get("chunk", {})
        
        if not chunk_data:
            return
        
        # Try to register namespace for event routing
        if namespace:
            self._register_sub_agent_namespace(namespace)
        
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
            thinking_text = self._extract_thinking_content(chunk_data.content)
            text_in_same_chunk = self._extract_string_content(chunk_data.content)
            
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
                _EXPECTED_NON_TEXT_TYPES = frozenset({
                    "thinking", "tool_use", "input_json_delta",
                })
                block_types = [
                    self._block_attr(b, "type", type(b).__name__)
                    for b in chunk_data.content[:5]
                ]
                is_expected = (
                    not block_types
                    or all(bt in _EXPECTED_NON_TEXT_TYPES for bt in block_types)
                )
                log_fn = self.logger.debug if is_expected else self.logger.info
                log_fn(
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
            _SKIP_EARLY_TOOLS = frozenset(PLANNING_TOOLS) | {"task"}
            for block in chunk_data.content:
                if self._block_attr(block, "type") == "tool_use":
                    t_name = self._block_attr(block, "name")
                    t_id = self._block_attr(block, "id")
                    if t_name and t_name not in _SKIP_EARLY_TOOLS:
                        self._create_early_tool_call(
                            t_name, t_id, ns_key, namespace,
                        )
            
            # ── Tool Input Streaming ─────────────────────────────────────────
            # Accumulate input_json_delta fragments and extract displayable
            # content into the early ToolCall's result field so the CLI can
            # render it progressively (same mechanism as thinking streaming).
            for block in chunk_data.content:
                if self._block_attr(block, "type") == "input_json_delta":
                    partial = self._block_attr(block, "partial_json")
                    if partial:
                        self._accumulate_tool_input(ns_key, partial)
            
            if thinking_text:
                self._thinking_buffers[ns_key] = (
                    self._thinking_buffers.get(ns_key, "") + thinking_text
                )
                if ns_key not in self._thinking_tool_call_ids:
                    self._start_thinking_stream(ns_key, namespace, self._thinking_buffers[ns_key])
                else:
                    self._update_thinking_stream(ns_key)
                
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
                token = self._extract_string_content(chunk_content)
        
        if not token:
            return
        
        # Flush any accumulated thinking before processing text content.
        # This ensures the synthetic think ToolCall appears in the status
        # timeline before the AI message that follows it.
        ns_key = namespace or ""
        if self._thinking_buffers.get(ns_key):
            self._flush_thinking_buffer(ns_key, namespace)
        
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
            ai_message = self._llm_run_id_to_message.get(run_id)
            if ai_message is not None:
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
        
        if run_id:
            # Store the proto-managed reference, not the original.
            # Protobuf repeated-message append copies the value; the
            # original is disconnected.  Subsequent token appends must
            # mutate the proto element so the CLI sees incremental content.
            self._llm_run_id_to_message[run_id] = messages_list[-1]
        
        # Track start time for duration calculation
        new_message_index = len(messages_list) - 1
        if sub_agent:
            self._sub_agent_message_start_times[(sub_agent.id, new_message_index)] = now
            self.logger.debug(f"Started new AI message in sub_agent={sub_agent.id} at index {new_message_index} run_id={run_id}")
        else:
            self._message_start_times[new_message_index] = now
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
        if self._thinking_buffers.get(ns_key):
            self._flush_thinking_buffer(ns_key, namespace)
        
        # ─────────────────────────────────────────────────────────────────────
        # run_id-Based Message Resolution (with backwards-scan fallback)
        # ─────────────────────────────────────────────────────────────────────
        run_id = event.get("run_id", "")
        context, sub_agent = self._get_execution_context(namespace)
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages
        
        ai_message_index = None
        
        # Primary path: resolve via run_id map (matches stream handler)
        tracked_message = self._llm_run_id_to_message.pop(run_id, None) if run_id else None
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
            if timing_key in self._sub_agent_message_start_times:
                start_time = self._sub_agent_message_start_times[timing_key]
                duration = datetime.utcnow() - start_time
                generation_duration_ms = int(duration.total_seconds() * 1000)
                del self._sub_agent_message_start_times[timing_key]
        else:
            # Check main agent timing dict
            if ai_message_index in self._message_start_times:
                start_time = self._message_start_times[ai_message_index]
                duration = datetime.utcnow() - start_time
                generation_duration_ms = int(duration.total_seconds() * 1000)
                del self._message_start_times[ai_message_index]
        
        # Extract usage metadata from LangChain response
        # LangChain models expose this via usage_metadata attribute on the AIMessage
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        model_name = ""
        
        # Handle both AIMessage objects and dict representations
        if hasattr(output_data, "usage_metadata") and output_data.usage_metadata:
            usage = output_data.usage_metadata
            prompt_tokens = getattr(usage, "input_tokens", 0) or 0
            completion_tokens = getattr(usage, "output_tokens", 0) or 0
            total_tokens = getattr(usage, "total_tokens", 0) or (prompt_tokens + completion_tokens)
        elif isinstance(output_data, dict):
            # Some models return usage in dict format
            usage = output_data.get("usage_metadata") or output_data.get("usage", {})
            if usage:
                prompt_tokens = usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0
                completion_tokens = usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0
                total_tokens = usage.get("total_tokens", 0) or (prompt_tokens + completion_tokens)
        
        # Extract model name if available
        if hasattr(output_data, "response_metadata"):
            response_meta = output_data.response_metadata
            if isinstance(response_meta, dict):
                model_name = response_meta.get("model", "") or response_meta.get("model_name", "")
        elif isinstance(output_data, dict):
            response_meta = output_data.get("response_metadata", {})
            model_name = response_meta.get("model", "") or response_meta.get("model_name", "")
        
        # ─────────────────────────────────────────────────────────────────────────
        # Finalize AI message streaming state fields (Phase 2.1)
        # ─────────────────────────────────────────────────────────────────────────
        ai_message = messages_list[ai_message_index]
        
        # Mark streaming complete - UI can now show final content
        ai_message.is_streaming = False
        
        # Set per-message token count (this message's tokens, not cumulative)
        ai_message.token_count = prompt_tokens + completion_tokens
        
        # Set generation duration if we tracked the start time
        if generation_duration_ms is not None:
            ai_message.generation_duration_ms = generation_duration_ms
        
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
                    final_text = self._extract_string_content(oc)
            elif isinstance(output_data, dict) and "content" in output_data:
                oc = output_data["content"]
                if isinstance(oc, str):
                    final_text = oc
                elif isinstance(oc, list):
                    final_text = self._extract_string_content(oc)
            
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
        # Update UsageMetrics (Phase 2.4)
        #
        # Accumulate tokens and call counts, then build and assign UsageMetrics proto.
        # Sub-agent and main agent metrics are tracked separately for accurate attribution.
        # ─────────────────────────────────────────────────────────────────────────
        context_info = ""
        if sub_agent:
            # Track sub-agent usage (isolated from main agent)
            sa_id = sub_agent.id
            self._sub_agent_llm_call_count[sa_id] = self._sub_agent_llm_call_count.get(sa_id, 0) + 1
            self._sub_agent_prompt_tokens[sa_id] = self._sub_agent_prompt_tokens.get(sa_id, 0) + prompt_tokens
            self._sub_agent_completion_tokens[sa_id] = self._sub_agent_completion_tokens.get(sa_id, 0) + completion_tokens
            
            # Capture primary model (first model used by this sub-agent)
            if not self._sub_agent_primary_model.get(sa_id) and model_name:
                self._sub_agent_primary_model[sa_id] = model_name
            
            # Update sub-agent's usage proto progressively
            sub_agent.usage.CopyFrom(self._build_sub_agent_usage(sa_id))
            context_info = f"sub_agent={sa_id} "
        else:
            # Track main agent usage
            self._total_prompt_tokens += prompt_tokens
            self._total_completion_tokens += completion_tokens
            self._llm_call_count += 1
            
            # Capture primary model (first model used by main agent)
            if not self._primary_model and model_name:
                self._primary_model = model_name
            
            # Update main agent's usage proto progressively
            self.current_status.usage.CopyFrom(self._build_usage_metrics())
        
        # Structured logging for observability
        self.logger.info(
            f"[USAGE] execution={self.execution_id} {context_info}"
            f"prompt_tokens={prompt_tokens} "
            f"completion_tokens={completion_tokens} "
            f"total_tokens={total_tokens} "
            f"duration_ms={generation_duration_ms or 'N/A'} "
            f"model={model_name or 'unknown'} "
            f"llm_call_count={self._sub_agent_llm_call_count.get(sub_agent.id, 0) if sub_agent else self._llm_call_count}"
        )
        
        self.logger.debug(
            f"AI message finalized at index {ai_message_index} {context_info}"
            f"(tokens: {total_tokens}, duration: {generation_duration_ms}ms)"
        )
    
    # Helper methods
    def _resolve_run_id(self, run_id: str) -> str:
        """Resolve a run_id through the alias map.
        
        On the resume-after-approval path, LangGraph generates a new run_id
        for the resumed tool, but the StatusBuilder already holds the original
        ToolCall with a different id.  ``_run_id_aliases`` bridges the gap.
        
        Returns the original tool call id if an alias exists, otherwise
        returns the input run_id unchanged.
        """
        return self._run_id_aliases.get(run_id, run_id)
    
    def _unwrap_tool_args(self, args: dict[str, Any]) -> dict[str, Any]:
        """Unwrap LangGraph arg wrappers."""
        if "kwargs" in args and isinstance(args["kwargs"], dict):
            return args["kwargs"]
        if "input" in args and isinstance(args["input"], dict) and len(args) == 1:
            return args["input"]
        return args
    
    def _get_tool_fingerprint(self, tool_name: str, tool_args: dict[str, Any]) -> str:
        """Create fingerprint for deduplication."""
        fingerprint_data = f"{tool_name}:{json.dumps(tool_args, sort_keys=True)}"
        return hashlib.sha256(fingerprint_data.encode()).hexdigest()
    
    def populate_fingerprints_from_existing_tool_calls(self) -> None:
        """Pre-populate tool_call_fingerprints from tool calls in the loaded status.
        
        On the resume-after-approval path, the StatusBuilder is initialized with
        the DB-persisted status that already contains tool calls from the previous
        invocation.  LangGraph may re-fire ``on_tool_start`` events for resumed
        tools, which would create duplicate entries in tool_calls because the
        fingerprint set starts empty.
        
        Calling this method after initialization fills the set so that the
        deduplication check in ``_handle_tool_start_event`` correctly skips
        already-tracked tool calls.
        
        Also populates ``_fingerprint_to_tool_call_id`` so that when the
        deduplication check fires, we can record a run-ID alias mapping from
        the new (LangGraph-generated) run_id to the original tool call's id.
        This enables ``_handle_tool_end_event`` to find and update the correct
        tool call on the resume path.
        """
        for tc in self.current_status.tool_calls:
            try:
                args_dict: dict[str, Any] = {}
                if tc.args:
                    args_dict = dict(tc.args)
                fingerprint = self._get_tool_fingerprint(tc.name, args_dict)
                self.tool_call_fingerprints.add(fingerprint)
                # Map fingerprint -> tool_call.id so _handle_tool_start_event
                # can record run-ID aliases when deduplication fires.
                if tc.id:
                    self._fingerprint_to_tool_call_id[fingerprint] = tc.id
            except Exception:
                # Non-fatal: if we can't compute a fingerprint for an existing
                # tool call (e.g. malformed args), skip it.  The worst case is
                # a duplicate entry, which is cosmetic.
                pass
        
        # Also populate from sub-agent tool calls
        for sub_agent in self.current_status.sub_agent_executions:
            for tc in sub_agent.tool_calls:
                try:
                    args_dict = {}
                    if tc.args:
                        args_dict = dict(tc.args)
                    fingerprint = self._get_tool_fingerprint(tc.name, args_dict)
                    self.tool_call_fingerprints.add(fingerprint)
                except Exception:
                    pass
    
    def _extract_tool_result_content(self, result: Any) -> str:
        """Extract displayable content string from a tool result.

        Handles the four result shapes that flow through LangGraph astream_events:
        - str: Direct string results (most common for simple tools)
        - LangGraph message objects (ToolMessage, AIMessage): Extract .content
        - LangGraph Command objects: Extract ToolMessage content from .update
        - dict: Extract from 'output'/'content' keys, or JSON-serialize
        """
        if isinstance(result, str):
            return result
        # Handle LangGraph message objects (ToolMessage, AIMessage, etc.)
        # Uses duck typing on .content to stay decoupled from langchain_core.
        if hasattr(result, "content"):
            content = result.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return self._extract_string_content(content)
        # Handle LangGraph Command objects (returned after approval resume).
        # When a tool goes through interrupt()/resume, on_tool_end may emit a
        # Command object instead of the plain tool return value. The Command's
        # .update dict contains state channel data; the "messages" channel holds
        # ToolMessage objects with the human-readable result.
        # Uses duck typing on .update to stay decoupled from langgraph.types.
        # Once identified as a Command, we commit to extracting from it — even
        # if the result is empty — rather than falling through to str(result)
        # which would produce a useless repr string.
        if hasattr(result, "update") and isinstance(getattr(result, "update", None), dict):
            return self._extract_command_content(result.update)
        if isinstance(result, dict):
            if "output" in result:
                return result.get("output", "")
            if "content" in result:
                return str(result["content"])
            return json.dumps(result, indent=2)
        self.logger.warning(
            f"[TOOL] Unknown result type {type(result).__name__} for tool result "
            f"extraction, falling back to str(). Preview: {str(result)[:200]}"
        )
        return str(result)
    
    def _format_tool_message_content(
        self,
        tool_name: str,
        args: Struct | None,
        result: str,
    ) -> str:
        """Format tool message content for CLI display.
        
        Creates a human-readable summary of the tool call for streaming display.
        
        Args:
            tool_name: Name of the tool that was called
            args: Tool arguments as Struct proto
            result: Tool result string
            
        Returns:
            Formatted string like "read(path='file.txt') -> 123 chars"
        """
        # Format arguments summary
        args_summary = ""
        if args:
            try:
                args_dict = dict(args.fields)
                # Create compact args display (first arg only for brevity)
                if args_dict:
                    first_key = next(iter(args_dict))
                    first_value = args_dict[first_key]
                    # Get string value from protobuf Value
                    if hasattr(first_value, 'string_value') and first_value.string_value:
                        value_str = first_value.string_value
                        # Truncate long values
                        if len(value_str) > 40:
                            value_str = value_str[:37] + "..."
                        args_summary = f"{first_key}='{value_str}'"
                    elif hasattr(first_value, 'number_value'):
                        args_summary = f"{first_key}={first_value.number_value}"
                    elif hasattr(first_value, 'bool_value'):
                        args_summary = f"{first_key}={first_value.bool_value}"
                    
                    if len(args_dict) > 1:
                        args_summary += f", +{len(args_dict) - 1} more"
            except Exception:
                # Fall back to empty args if parsing fails
                pass
        
        # Format result summary
        result_summary = ""
        if result:
            # Truncate long results
            if len(result) > 100:
                result_summary = f"{len(result)} chars"
            else:
                # Show short results directly
                result_summary = result.replace('\n', ' ')[:80]
        
        # Build final message
        if args_summary:
            call_str = f"{tool_name}({args_summary})"
        else:
            call_str = f"{tool_name}()"
        
        if result_summary:
            return f"{call_str} -> {result_summary}"
        else:
            return call_str
    
    @staticmethod
    def _block_attr(block: Any, key: str, default: str = "") -> str:
        """Read *key* from a content block regardless of whether it is a
        ``dict`` or an object with attributes (e.g. a LangChain dataclass)."""
        if isinstance(block, dict):
            return block.get(key, default)
        return getattr(block, key, default)

    def _extract_string_content(self, content_blocks: list) -> str:
        """Extract text from multimodal content blocks.

        Handles both dict blocks (``{"type": "text", "text": "..."}``}) and
        attribute-based objects (``block.type == "text"``).
        """
        text_parts: list[str] = []
        for block in content_blocks:
            if self._block_attr(block, "type") == "text":
                text_parts.append(self._block_attr(block, "text"))
        return "".join(text_parts)

    def _extract_thinking_content(self, content_blocks: list) -> str:
        """Extract thinking text from Anthropic extended-thinking content blocks.

        Returns the concatenated thinking text from all blocks with
        ``type: "thinking"``.  Returns an empty string when no thinking
        blocks are present (non-Anthropic models, or text/tool_use chunks).

        Handles both dict blocks and attribute-based objects.
        """
        parts: list[str] = []
        for block in content_blocks:
            if self._block_attr(block, "type") == "thinking":
                parts.append(self._block_attr(block, "thinking"))
        return "".join(parts)
    
    def _create_early_tool_call(
        self, tool_name: str, tool_use_id: str, ns_key: str, namespace: str,
    ) -> None:
        """Create a ToolCall as soon as a ``tool_use`` block appears in the stream.

        The CLI shows an idle "Thinking…" indicator when no events arrive
        for ≥ 2 s.  While the LLM generates tool arguments (``input_json_delta``
        chunks) the status builder has nothing to report, so the CLI falls
        back to the idle indicator even though the model has already decided
        to call a tool.

        By creating the ToolCall here — before ``on_tool_start`` fires — the
        CLI immediately displays the tool name with a running badge.  When
        ``on_tool_start`` arrives, ``_handle_tool_start_event`` reconciles
        the early ToolCall (populates args, registers the real run-ID alias)
        instead of creating a duplicate.
        """
        if self._thinking_buffers.get(ns_key):
            self._flush_thinking_buffer(ns_key, namespace)

        temp_id = f"early-{tool_use_id or uuid4()}"

        now = datetime.utcnow()
        tool_call = ToolCall(
            id=temp_id,
            name=tool_name,
            result="",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            is_streaming=True,
            component_metadata=ComponentMetadata(
                component_type=infer_component_type(tool_name),
                component_group="main-agent-tools",
            ),
            started_at=_utc_timestamp(now),
        )

        tool_message = AgentMessage(
            type=MessageType.MESSAGE_TOOL,
            content="",
            timestamp=_utc_timestamp(now),
        )
        tool_message.tool_calls.append(tool_call)

        context, sub_agent = self._get_execution_context(namespace)
        if sub_agent:
            sub_agent.tool_calls.append(tool_call)
            sub_agent.messages.append(tool_message)
        else:
            self.current_status.messages.append(tool_message)
            self.current_status.tool_calls.append(tool_call)

        self._early_tool_call_queue.append(temp_id)
        self._tool_start_times[temp_id] = now

        self._tool_input_active_tc[ns_key] = temp_id
        self._tool_input_buffers[temp_id] = ""

        self.logger.debug(
            f"[TOOL_EARLY] execution={self.execution_id} "
            f"tool={tool_name} temp_id={temp_id} "
            f"namespace={namespace or 'main'}"
        )

    def _reconcile_early_tool_call(
        self,
        tool_name: str,
        run_id: str,
        tool_args: dict[str, Any],
        namespace: str,
    ) -> ToolCall | None:
        """Match an ``on_tool_start`` event to an early-created ToolCall.

        Pops the first queued temp-ID whose ToolCall name matches
        *tool_name*.  If found, the existing ToolCall is updated in place
        (args populated, ``is_streaming`` cleared) and the real *run_id*
        is registered as an alias so that downstream handlers
        (``on_tool_end``, ``tool_progress``) resolve to the same proto.

        Returns the reconciled ToolCall, or ``None`` if no match exists.
        """
        for idx, temp_id in enumerate(self._early_tool_call_queue):
            existing = self._find_tool_call_by_id(temp_id)
            if existing is None or existing.name != tool_name:
                continue

            self._early_tool_call_queue.pop(idx)
            self._flush_tool_input_buffer(temp_id)

            existing.result = ""

            if tool_args:
                args_struct = Struct()
                args_struct.update(tool_args)
                existing.args.CopyFrom(args_struct)

            existing.is_streaming = False

            approval = self._check_tool_approval_requirement(tool_name, tool_args)
            if approval.requires_approval:
                existing.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                existing.requires_approval = True
                existing.approval_message = render_approval_message(
                    template=approval.message,
                    tool_name=tool_name,
                    tool_args=tool_args,
                )
                existing.approval_requested_at = _utc_timestamp(datetime.utcnow())

            self._run_id_aliases[run_id] = temp_id
            self._tool_start_times[run_id] = (
                self._tool_start_times.pop(temp_id, None) or datetime.utcnow()
            )

            fingerprint = self._get_tool_fingerprint(tool_name, tool_args)
            self._fingerprint_to_tool_call_id[fingerprint] = temp_id

            self.logger.debug(
                f"[TOOL_RECONCILE] execution={self.execution_id} "
                f"tool={tool_name} run_id={run_id} -> temp_id={temp_id} "
                f"namespace={namespace or 'main'}"
            )

            if approval.requires_approval:
                _, sub_agent = self._get_execution_context(namespace)
                self._populate_pending_approval(
                    run_id=run_id,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    approval_message=existing.approval_message,
                    from_sub_agent=sub_agent is not None,
                    sub_agent_name=sub_agent.name if sub_agent else "",
                )

            return existing

        return None

    def _start_thinking_stream(self, ns_key: str, namespace: str, initial_text: str) -> None:
        """Create a RUNNING ToolCall for native thinking and begin streaming.

        Called when the first thinking content block arrives for a namespace.
        The ToolCall starts with ``is_streaming=True`` and the initial thinking
        text in ``result``.  Subsequent blocks update ``result`` via
        ``_update_thinking_stream``, and ``_flush_thinking_buffer`` transitions
        the ToolCall to COMPLETED when thinking ends.

        During streaming the CLI renders ``result`` via ``renderStreamingTool``
        (last N lines with a cursor indicator).  After completion the CLI reads
        ``args.thought`` via ``resolveDisplayContent`` (the ``toolDisplayMap``
        entry uses ``contentSourceInput``).
        """
        now = datetime.utcnow()
        tc_id = f"think-native-{uuid4()}"

        tool_call = ToolCall(
            id=tc_id,
            name="think",
            args=Struct(),
            result=initial_text,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            is_streaming=True,
            component_metadata=ComponentMetadata(
                component_type=infer_component_type("think"),
                component_group="main-agent-tools",
            ),
            started_at=_utc_timestamp(now),
        )

        _context, sub_agent = self._get_execution_context(namespace)
        if sub_agent:
            sub_agent.tool_calls.append(tool_call)
        else:
            self.current_status.tool_calls.append(tool_call)

        self._thinking_tool_call_ids[ns_key] = tc_id
        self._thinking_started_at[ns_key] = now

        self.logger.debug(
            "[THINK] execution=%s streaming_started id=%s namespace=%s",
            self.execution_id,
            tc_id,
            namespace or "main",
        )

    def _update_thinking_stream(self, ns_key: str) -> None:
        """Update the streaming think ToolCall with the latest accumulated content.

        Finds the existing RUNNING ToolCall by its tracked ID and replaces
        ``result`` with the full accumulated thinking buffer.  The gRPC update
        scheduler will push this change within ~500ms; the CLI detects the
        content change via ``tc.IsStreaming && tc.Result != prevResults`` and
        renders the latest lines.
        """
        tc_id = self._thinking_tool_call_ids.get(ns_key)
        if not tc_id:
            return

        tool_call = self._find_tool_call_by_id(tc_id)
        if tool_call is not None:
            tool_call.result = self._thinking_buffers.get(ns_key, "")

    # ─────────────────────────────────────────────────────────────────────────
    # Tool Input Streaming Helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _accumulate_tool_input(self, ns_key: str, partial_json: str) -> None:
        """Accumulate an ``input_json_delta`` fragment and update the early ToolCall.

        Appends *partial_json* to the buffer for the early ToolCall currently
        active in this namespace.  If the accumulated JSON already contains the
        tool's content field (e.g. ``"contents": "…``), the extracted value is
        written to ``tool_call.result`` so the CLI can stream it progressively.

        Follows the same pattern as ``_update_thinking_stream``: mutate
        ``tool_call.result`` in place; the gRPC scheduler pushes the change
        within ~500 ms and the CLI detects it via
        ``tc.IsStreaming && tc.Result != prevResults``.
        """
        temp_id = self._tool_input_active_tc.get(ns_key)
        if not temp_id:
            return

        buf = self._tool_input_buffers.get(temp_id)
        if buf is None:
            return

        self._tool_input_buffers[temp_id] = buf + partial_json

        tool_call = self._find_tool_call_by_id(temp_id)
        if tool_call is None:
            return

        content = self._extract_content_from_partial_json(
            tool_call.name, self._tool_input_buffers[temp_id],
        )
        if content:
            tool_call.result = content

    @staticmethod
    def _extract_content_from_partial_json(
        tool_name: str, partial_json: str,
    ) -> str:
        """Extract the displayable content value from an in-progress args JSON.

        For tools listed in ``_TOOL_CONTENT_FIELDS`` (write, edit, think) the
        method locates the content field's opening quote and JSON-unescapes
        everything that has arrived so far.  Trailing incomplete escape
        sequences are silently dropped to avoid garbled output.

        Returns an empty string when the content field has not yet appeared in
        the accumulated JSON (e.g. the LLM is still generating the ``path``
        argument).
        """
        fields = _TOOL_CONTENT_FIELDS.get(tool_name)
        if not fields:
            return ""

        for field in fields:
            start = _find_json_string_value_start(partial_json, field)
            if start >= 0:
                return _json_unescape_partial(partial_json[start:])

        return ""

    def _flush_tool_input_buffer(self, temp_id: str) -> None:
        """Clean up input-streaming state for a reconciled early ToolCall."""
        self._tool_input_buffers.pop(temp_id, None)
        for ns_key, tid in list(self._tool_input_active_tc.items()):
            if tid == temp_id:
                del self._tool_input_active_tc[ns_key]
                break

    def _flush_thinking_buffer(self, ns_key: str, namespace: str) -> None:
        """Finalize the streaming think ToolCall or create a completed one.

        If a streaming ToolCall exists (created by ``_start_thinking_stream``),
        transitions it from RUNNING to COMPLETED in place: populates
        ``args.thought`` with the full thinking text, sets ``result`` to
        ``"ok"``, and clears the streaming flag.

        Falls back to creating a new COMPLETED ToolCall from scratch if no
        streaming ToolCall exists (defensive — should not happen in normal flow
        since ``_start_thinking_stream`` is called on the first thinking block).
        """
        thinking_text = self._thinking_buffers.pop(ns_key, "")
        started_at = self._thinking_started_at.pop(ns_key, None)
        tc_id = self._thinking_tool_call_ids.pop(ns_key, None)
        if not thinking_text:
            return

        now = datetime.utcnow()

        args_struct = Struct()
        args_struct.update({"thought": thinking_text})

        if tc_id:
            tool_call = self._find_tool_call_by_id(tc_id)
            if tool_call is not None:
                tool_call.args.CopyFrom(args_struct)
                tool_call.result = "ok"
                tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                tool_call.is_streaming = False
                tool_call.completed_at = _utc_timestamp(now)

                self.logger.info(
                    "[THINK] execution=%s streaming_completed id=%s "
                    "chars=%d namespace=%s",
                    self.execution_id,
                    tc_id,
                    len(thinking_text),
                    namespace or "main",
                )
                return

        # Defensive fallback: no streaming ToolCall exists.  Create a
        # completed one from scratch so thinking content is never lost.
        tool_call = ToolCall(
            id=f"think-native-{uuid4()}",
            name="think",
            args=args_struct,
            result="ok",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
            component_metadata=ComponentMetadata(
                component_type=infer_component_type("think"),
                component_group="main-agent-tools",
            ),
            started_at=_utc_timestamp(started_at or now),
            completed_at=_utc_timestamp(now),
        )

        _context, sub_agent = self._get_execution_context(namespace)
        if sub_agent:
            sub_agent.tool_calls.append(tool_call)
        else:
            self.current_status.tool_calls.append(tool_call)

        self.logger.info(
            "[THINK] execution=%s synthetic_think_tool_call "
            "chars=%d namespace=%s (fallback)",
            self.execution_id,
            len(thinking_text),
            namespace or "main",
        )
    
    def _extract_command_content(self, update: dict[str, Any]) -> str:
        """Extract displayable content from a LangGraph Command.update dict.

        When a tool goes through the interrupt()/resume approval cycle,
        LangGraph may wrap the result in a Command object whose .update dict
        contains state channel mutations. The "messages" channel typically holds
        ToolMessage objects with the human-readable tool result.

        Extraction strategy:
        1. Look in update["messages"] for ToolMessage-like objects with .content
        2. Fall back to JSON-serializing the non-messages portion of the update

        Returns an empty string if no meaningful content can be extracted.
        """
        messages = update.get("messages", [])
        if isinstance(messages, list):
            for msg in messages:
                # Duck-type: ToolMessage has .content (str or list)
                if hasattr(msg, "content"):
                    content = msg.content
                    if isinstance(content, str) and content:
                        return content
                    if isinstance(content, list):
                        extracted = self._extract_string_content(content)
                        if extracted:
                            return extracted

        # Fallback: serialize the update dict (excluding messages to avoid
        # dumping ToolMessage repr objects back into the output).
        fallback = {k: v for k, v in update.items() if k != "messages"}
        if fallback:
            try:
                return json.dumps(fallback, indent=2, default=str)
            except (TypeError, ValueError):
                pass

        return ""
    
    def _update_todos(self, todos_data: list) -> None:
        """Update todos in local status."""
        status_map = {
            "pending": TodoStatus.TODO_PENDING,
            "in_progress": TodoStatus.TODO_IN_PROGRESS,
            "completed": TodoStatus.TODO_COMPLETED,
            "cancelled": TodoStatus.TODO_CANCELLED,
        }
        
        for todo_dict in todos_data:
            todo_id = todo_dict.get("id", "")
            if not todo_id:
                continue
            
            status_str = todo_dict.get("status", "pending").lower()
            status_enum = status_map.get(status_str, TodoStatus.TODO_PENDING)
            
            todo_item = TodoItem(
                id=todo_id,
                content=todo_dict.get("content", ""),
                status=status_enum,
                created_at=todo_dict.get("created_at", _utc_timestamp()),
                updated_at=_utc_timestamp(),
            )
            
            self.current_status.todos[todo_id].CopyFrom(todo_item)
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Approval State Management (HITL Phase 2)
    #
    # These methods manage the approval workflow state transitions:
    # - set_tool_waiting_approval: Tool requires approval → WAITING_APPROVAL
    # - set_tool_approval_decision: User decision → RUNNING/SKIPPED/FAILED
    # - clear_pending_approval: Clear pending state and restore phase
    # ─────────────────────────────────────────────────────────────────────────────
    
    def set_tool_waiting_approval(
        self,
        run_id: str,
        tool_name: str,
        tool_args: dict[str, Any],
        approval_message: str,
        from_sub_agent: bool = False,
        sub_agent_name: str = "",
    ) -> None:
        """
        Set a tool call to WAITING_APPROVAL status and update execution phase.
        
        This method transitions a tool call to the waiting-for-approval state:
        1. Updates the ToolCall status to WAITING_APPROVAL
        2. Sets approval-related fields on the ToolCall
        3. Populates pending_approval on AgentExecutionStatus for UI
        4. Appends to _pending_tool_approvals list
        5. Updates execution phase to WAITING_FOR_APPROVAL
        
        Multiple tool calls may be pending approval simultaneously when the LLM
        issues several tool calls in one response that each require approval.
        Each call to this method appends to the internal list; the post-stream
        interrupt-capture logic in execute_graphton.py later reconciles these
        with LangGraph interrupt IDs.
        
        Args:
            run_id: The tool call's run_id (from LangGraph event)
            tool_name: Name of the tool requiring approval
            tool_args: Tool arguments dictionary (for args_preview)
            approval_message: Human-readable message for the approval prompt
            from_sub_agent: True if this approval bubbles up from a sub-agent
            sub_agent_name: Name of the sub-agent (when from_sub_agent=True)
        
        Note:
            The tool call must already exist in messages[].tool_calls[] or
            tool_calls[]. If not found, this method logs a warning and returns.
        """
        now = datetime.utcnow()
        timestamp = _utc_timestamp(now)
        
        # Find and update the tool call (handles dual-reference pattern)
        tool_call = self._find_tool_call_by_id(run_id)
        if tool_call is None:
            self.logger.warning(
                f"[APPROVAL] execution={self.execution_id} "
                f"tool call {run_id} not found, cannot set waiting approval"
            )
            return
        
        # Update tool call status and approval fields
        tool_call.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        tool_call.requires_approval = True
        tool_call.approval_message = approval_message
        tool_call.approval_requested_at = timestamp
        
        # Create args preview (sanitized JSON for UI display)
        args_preview = self._create_args_preview(tool_args)
        
        # Build a PendingApproval proto for this tool (interrupt_id is not yet
        # known — it will be set post-stream when we query the graph state).
        pending = PendingApproval(
            tool_call_id=run_id,
            tool_name=tool_name,
            message=approval_message,
            args_preview=args_preview,
            requested_at=timestamp,
            from_sub_agent=from_sub_agent,
            sub_agent_name=sub_agent_name,
        )
        
        # Save current phase (only on the FIRST pending approval) and
        # transition to WAITING_FOR_APPROVAL
        if self._saved_phase_before_approval is None:
            self._saved_phase_before_approval = self.current_status.phase
        self.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        # Track pending approval state
        self._pending_tool_approvals.append(run_id)
        
        context_info = f"sub_agent={sub_agent_name}" if from_sub_agent else "main_agent"
        pending_count = len(self._pending_tool_approvals)
        self.logger.info(
            f"[APPROVAL] execution={self.execution_id} "
            f"tool={tool_name} run_id={run_id} "
            f"status=WAITING_APPROVAL context={context_info} "
            f"pending_count={pending_count}"
        )
    
    def set_tool_approval_decision(
        self,
        run_id: str,
        action: ApprovalAction,
        approved_by: str,
    ) -> None:
        """
        Record approval decision on a tool call and update state accordingly.
        
        This method processes the user's approval decision:
        - APPROVE: Marks tool ready to execute, clears this entry from pending
        - SKIP: Sets tool to SKIPPED, clears this entry from pending
        - REJECT: Sets execution to FAILED, clears all pending
        
        With batch approval, this method only clears the specific run_id from
        the pending list. The execution phase remains WAITING_FOR_APPROVAL if
        other tools still need decisions.  The graph is NOT resumed until ALL
        pending approvals are resolved (handled by the Temporal workflow).
        
        Args:
            run_id: The tool call's run_id
            action: User's approval decision (ApprovalAction enum)
            approved_by: User ID or identifier who made the decision
        
        Note:
            For APPROVE, the caller is responsible for actually resuming tool
            execution (e.g., via LangGraph interrupt/resume). This method only
            updates the state to reflect the decision.
        """
        if run_id not in self._pending_tool_approvals:
            self.logger.warning(
                f"[APPROVAL] execution={self.execution_id} "
                f"approval decision for {run_id} but not in pending list "
                f"{self._pending_tool_approvals}"
            )
        
        now = datetime.utcnow()
        timestamp = _utc_timestamp(now)
        
        # Find the tool call
        tool_call = self._find_tool_call_by_id(run_id)
        if tool_call is None:
            self.logger.warning(
                f"[APPROVAL] execution={self.execution_id} "
                f"tool call {run_id} not found, cannot record decision"
            )
            return
        
        # Record the decision on the tool call
        tool_call.approval_action = action
        tool_call.approval_decided_at = timestamp
        tool_call.approved_by = approved_by
        
        # Process based on action
        action_name = ApprovalAction.Name(action)
        
        if action == ApprovalAction.APPROVAL_ACTION_APPROVE:
            # Tool is approved — it will transition to RUNNING when execution
            # resumes. Keep status as WAITING_APPROVAL until actual execution.
            # Remove this run_id from pending list.
            self._remove_from_pending(run_id)
            self.logger.info(
                f"[APPROVAL] execution={self.execution_id} "
                f"run_id={run_id} decision=APPROVE by={approved_by} "
                f"remaining_pending={len(self._pending_tool_approvals)}"
            )
            
        elif action == ApprovalAction.APPROVAL_ACTION_SKIP:
            # Tool is skipped — set terminal status and skip message.
            tool_call.status = ToolCallStatus.TOOL_CALL_SKIPPED
            tool_call.result = f"Tool '{tool_call.name}' was skipped by user. Please proceed without this operation."
            tool_call.completed_at = timestamp
            
            # Remove this run_id from pending list.
            self._remove_from_pending(run_id)
            self.logger.info(
                f"[APPROVAL] execution={self.execution_id} "
                f"run_id={run_id} decision=SKIP by={approved_by} "
                f"remaining_pending={len(self._pending_tool_approvals)}"
            )
            
        elif action == ApprovalAction.APPROVAL_ACTION_REJECT:
            # Tool is rejected — fail the entire execution.
            tool_call.status = ToolCallStatus.TOOL_CALL_FAILED
            tool_call.error = f"Tool execution rejected by {approved_by}"
            tool_call.completed_at = timestamp
            
            # Clear ALL pending state and set phase to FAILED
            self._pending_tool_approvals.clear()
            del self.current_status.pending_approvals[:]
            self.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            self.current_status.error = f"Tool '{tool_call.name}' execution rejected by {approved_by}"
            
            self.logger.info(
                f"[APPROVAL] execution={self.execution_id} "
                f"run_id={run_id} decision=REJECT by={approved_by}"
            )
        else:
            self.logger.warning(
                f"[APPROVAL] execution={self.execution_id} "
                f"run_id={run_id} unknown action={action_name}"
            )
    
    def _remove_from_pending(self, run_id: str) -> None:
        """Remove a single run_id from the pending approvals list.
        
        If no more pending approvals remain after removal, clear the overall
        pending state and restore the execution phase.
        """
        if run_id in self._pending_tool_approvals:
            self._pending_tool_approvals.remove(run_id)
        
        if not self._pending_tool_approvals:
            # All pending approvals have been decided — clear state
            self.clear_pending_approval()
    
    def clear_pending_approval(self) -> None:
        """
        Clear ALL pending approval state and restore execution phase.
        
        Called when all approval decisions have been processed (or on reject)
        to clean up state.  Restores the execution phase to what it was before
        entering WAITING_FOR_APPROVAL (typically IN_PROGRESS).
        """
        self._pending_tool_approvals.clear()
        del self.current_status.pending_approvals[:]
        
        # Restore phase (default to IN_PROGRESS if not saved)
        if self._saved_phase_before_approval is not None:
            self.current_status.phase = self._saved_phase_before_approval
            self._saved_phase_before_approval = None
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
    
    def _populate_pending_approval(
        self,
        run_id: str,
        tool_name: str,
        tool_args: dict[str, Any],
        approval_message: str,
        from_sub_agent: bool = False,
        sub_agent_name: str = "",
    ) -> None:
        """
        Populate pending approval tracking and update execution phase.
        
        This is called after the ToolCall has already been created with
        WAITING_APPROVAL status. It handles the execution-level state updates.
        
        Unlike set_tool_waiting_approval(), this does not need to find and
        update the ToolCall (already done during creation).
        
        Args:
            run_id: The tool call's run_id
            tool_name: Name of the tool requiring approval
            tool_args: Tool arguments dictionary (for args_preview)
            approval_message: Rendered approval message
            from_sub_agent: True if this approval bubbles up from a sub-agent
            sub_agent_name: Name of the sub-agent (when from_sub_agent=True)
        """
        # Save current phase (only on the FIRST pending approval) and
        # transition to WAITING_FOR_APPROVAL.  When multiple tool calls
        # require approval in a single LLM response, subsequent calls to
        # this method must NOT overwrite the saved phase — it should stay
        # as the pre-approval phase (typically IN_PROGRESS) so that
        # clear_pending_approval() can restore it correctly.
        if self._saved_phase_before_approval is None:
            self._saved_phase_before_approval = self.current_status.phase
        self.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        # Track pending approval state
        self._pending_tool_approvals.append(run_id)
        
        context_info = f"sub_agent={sub_agent_name}" if from_sub_agent else "main_agent"
        self.logger.info(
            f"[APPROVAL] execution={self.execution_id} "
            f"tool={tool_name} run_id={run_id} "
            f"status=WAITING_APPROVAL context={context_info}"
        )
    
    def _find_tool_call_by_id(self, run_id: str) -> ToolCall | None:
        """
        Find a ToolCall by its run_id in the current execution context.
        
        Searches both main agent and sub-agent tool calls.
        Returns the first match (there should only be one per run_id).
        
        Args:
            run_id: The tool call's run_id to find
            
        Returns:
            ToolCall proto if found, None otherwise
        """
        # Check main agent tool_calls
        for tool_call in self.current_status.tool_calls:
            if tool_call.id == run_id:
                return tool_call
        
        # Check sub-agent tool_calls
        for sub_agent in self.current_status.sub_agent_executions:
            for tool_call in sub_agent.tool_calls:
                if tool_call.id == run_id:
                    return tool_call
        
        return None
    
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
            
            # Truncate long strings
            if isinstance(value, str) and len(value) > 200:
                return value[:200] + "... (truncated)"
            
            # Recursively sanitize nested dicts
            if isinstance(value, dict):
                return {k: sanitize_value(k, v) for k, v in value.items()}
            
            # Truncate long lists
            if isinstance(value, list):
                if len(value) > 10:
                    return value[:10] + [f"... ({len(value) - 10} more items)"]
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
        sub_agent_id = self._namespace_to_sub_agent_id.get(namespace)
        if sub_agent_id and sub_agent_id in self._active_sub_agents:
            sub_agent = self._active_sub_agents[sub_agent_id]
            return sub_agent, sub_agent
        
        # Namespace not yet registered — fall back to main agent.
        # Single-segment namespaces (no "|") are normal main-agent graph
        # activity (e.g., the tools node).  Only warn for multi-segment
        # namespaces, which indicate sub-agent events that should have
        # been routed.  Deduplicate: warn once per unique namespace.
        if "|" in namespace and namespace not in self._warned_namespaces:
            self._warned_namespaces.add(namespace)
            self.logger.warning(
                f"[NAMESPACE] execution={self.execution_id} "
                f"namespace={namespace} has no registered sub-agent — "
                f"falling back to main agent context"
            )
        return self.current_status, None
    
    def _register_sub_agent_namespace(self, namespace: str) -> None:
        """
        Register namespace -> sub-agent mapping when child event arrives.
        
        Uses three strategies in priority order:
        
        1. **Root-prefix matching**: Multi-segment namespaces (containing "|")
           share a root segment (before the first "|") when they originate
           from the same sub-agent.  If any already-registered namespace
           shares the same root, the new namespace inherits the mapping.
        
        2. **Substring matching** (legacy): Checks if any active sub-agent's
           run_id appears in the namespace string.
        
        3. **Causal correlation**: When a "task" tool starts a sub-agent,
           ``_pending_sub_agent_id`` is set.  The first unregistered
           multi-segment namespace is associated with that pending sub-agent.
           This handles the common case where LangGraph checkpoint UUIDs
           differ from the task tool's event run_id.
        
        Single-segment namespaces (no "|") are from the main agent's graph
        nodes and are intentionally not registered.
        
        Args:
            namespace: LangGraph checkpoint namespace string
        """
        if not namespace or namespace in self._namespace_to_sub_agent_id:
            return
        
        is_multi_segment = "|" in namespace
        ns_root = namespace.split("|")[0]
        
        # Strategy 1: root-prefix matching against already-registered namespaces.
        # When a sub-agent has been identified via any namespace variant, all
        # namespaces sharing the same root segment (before the first "|") are
        # from the same sub-agent graph.
        if is_multi_segment:
            for registered_ns, sub_agent_id in self._namespace_to_sub_agent_id.items():
                if registered_ns.split("|")[0] == ns_root:
                    self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                    self.logger.debug(
                        f"[SUBAGENT] Prefix-matched namespace={namespace} "
                        f"-> sub_agent={sub_agent_id} "
                        f"(via root={ns_root})"
                    )
                    return
        
        # Strategy 2: substring matching (legacy — works when run_id is in namespace)
        for sub_agent_id in self._active_sub_agents:
            if sub_agent_id in namespace:
                self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                self.logger.info(
                    f"[SUBAGENT] Substring-matched namespace={namespace} "
                    f"-> sub_agent={sub_agent_id}"
                )
                return
        
        # Strategy 3: causal correlation with pending sub-agent.
        # Only for multi-segment namespaces — single-segment namespaces are
        # from the main agent's graph nodes, not from sub-agents.
        if is_multi_segment and self._pending_sub_agent_id:
            sub_agent_id = self._pending_sub_agent_id
            if sub_agent_id in self._active_sub_agents:
                self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                self._pending_sub_agent_id = None
                self.logger.info(
                    f"[SUBAGENT] Causal registration: namespace={namespace} "
                    f"-> sub_agent={sub_agent_id}"
                )
                return
        
        # Diagnostic: log failed registration for multi-segment namespaces only
        if is_multi_segment:
            self.logger.info(
                f"[NS_DIAG] Namespace registration failed: "
                f"execution={self.execution_id} "
                f"namespace={namespace} "
                f"active_sub_agents={list(self._active_sub_agents.keys())} "
                f"pending={self._pending_sub_agent_id}"
            )
    
    def _handle_sub_agent_start(self, event: dict[str, Any], tool_args: dict[str, Any], run_id: str) -> None:
        """
        Handle task tool invocation - creates SubAgentExecution.
        
        The "task" tool is the mechanism for invoking sub-agents in LangGraph.
        We extract sub-agent metadata and create a tracking entry.
        
        Args:
            event: The on_tool_start event dictionary
            tool_args: Unwrapped tool arguments
            run_id: The run_id for this tool invocation
        """
        # Extract sub-agent metadata from tool args
        sub_agent_name = tool_args.get("subagent_type", "") or tool_args.get("agent_type", "") or "unknown"
        sub_agent_input = tool_args.get("input", "") or tool_args.get("task", "") or tool_args.get("prompt", "")
        
        now = datetime.utcnow()
        sub_agent = SubAgentExecution(
            id=run_id,
            name=sub_agent_name,
            input=sub_agent_input,
            status=SubAgentStatus.SUB_AGENT_IN_PROGRESS,  # Skip PENDING - already executing
            started_at=_utc_timestamp(now),
        )
        
        # Append first, then store the proto-managed reference.
        # Protobuf repeated-message append copies the value; the original
        # object is disconnected from the proto.  By storing the element
        # returned by the repeated field we ensure all later mutations
        # (messages, tool_calls, usage) write to the actual status proto.
        self.current_status.sub_agent_executions.append(sub_agent)
        self._active_sub_agents[run_id] = self.current_status.sub_agent_executions[-1]
        
        # Mark as pending for causal namespace registration.
        # The next multi-segment namespace will be associated with this sub-agent.
        self._pending_sub_agent_id = run_id
        
        self.logger.info(
            f"[SUBAGENT] execution={self.execution_id} "
            f"sub_agent={sub_agent_name} id={run_id} status=IN_PROGRESS "
            f"(pending namespace registration)"
        )
    
    def _handle_sub_agent_end(self, event: dict[str, Any], run_id: str) -> None:
        """
        Handle task tool completion - finalize SubAgentExecution.
        
        This is called when the "task" tool returns, indicating the sub-agent
        has completed its work (successfully or with failure).
        
        Args:
            event: The on_tool_end event dictionary
            run_id: The run_id for this task tool invocation
        """
        output_raw = event.get("data", {}).get("output", "")
        output = self._extract_tool_result_content(output_raw)
        now = datetime.utcnow()
        
        # Check for error indicators in output
        is_error = False
        error_message = ""
        if isinstance(output_raw, dict):
            if output_raw.get("error") or output_raw.get("status") == "failed":
                is_error = True
                error_message = output_raw.get("error", "") or output_raw.get("message", "Sub-agent failed")
        
        # Find and update the sub-agent execution
        for sub_agent in self.current_status.sub_agent_executions:
            if sub_agent.id == run_id:
                sub_agent.output = output
                sub_agent.completed_at = _utc_timestamp(now)
                
                if is_error:
                    sub_agent.status = SubAgentStatus.SUB_AGENT_FAILED
                    sub_agent.error = error_message
                else:
                    sub_agent.status = SubAgentStatus.SUB_AGENT_COMPLETED
                
                self.logger.debug(
                    f"[SUBAGENT] execution={self.execution_id} "
                    f"id={run_id} status={'FAILED' if is_error else 'COMPLETED'}"
                )
                break
        
        # Cleanup tracking dictionaries
        if run_id in self._active_sub_agents:
            del self._active_sub_agents[run_id]
        
        if self._pending_sub_agent_id == run_id:
            self._pending_sub_agent_id = None
        
        # Cleanup any namespace mappings pointing to this sub-agent
        namespaces_to_remove = [
            ns for ns, sa_id in self._namespace_to_sub_agent_id.items()
            if sa_id == run_id
        ]
        for ns in namespaces_to_remove:
            del self._namespace_to_sub_agent_id[ns]
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Usage Metrics Builders (Phase 2.4)
    # ─────────────────────────────────────────────────────────────────────────────
    
    def _build_usage_metrics(self) -> UsageMetrics:
        """
        Build UsageMetrics proto for main agent.
        
        Creates a UsageMetrics instance containing accumulated token usage
        and LLM call statistics for the main agent's direct calls.
        
        Returns:
            UsageMetrics proto with current accumulated values
        """
        return UsageMetrics(
            prompt_tokens=self._total_prompt_tokens,
            completion_tokens=self._total_completion_tokens,
            total_tokens=self._total_prompt_tokens + self._total_completion_tokens,
            llm_call_count=self._llm_call_count,
            primary_model=self._primary_model,
        )
    
    def _build_sub_agent_usage(self, sub_agent_id: str) -> UsageMetrics:
        """
        Build UsageMetrics proto for a specific sub-agent.
        
        Creates a UsageMetrics instance containing accumulated token usage
        and LLM call statistics for a sub-agent's direct calls.
        
        Args:
            sub_agent_id: The run_id of the sub-agent
            
        Returns:
            UsageMetrics proto with current accumulated values for the sub-agent
        """
        prompt = self._sub_agent_prompt_tokens.get(sub_agent_id, 0)
        completion = self._sub_agent_completion_tokens.get(sub_agent_id, 0)
        return UsageMetrics(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=prompt + completion,
            llm_call_count=self._sub_agent_llm_call_count.get(sub_agent_id, 0),
            primary_model=self._sub_agent_primary_model.get(sub_agent_id, ""),
        )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Resolved Execution Context (Phase 2.5)
    #
    # Captures what resources the agent had access to at execution time.
    # This is set once after all resources are resolved, before streaming begins.
    # ─────────────────────────────────────────────────────────────────────────────
    
    def set_resolved_context(
        self,
        environment_keys: list[str],
        mcp_servers: dict[str, tuple[bool, str, int]],
        skill_names: list[str],
    ) -> None:
        """
        Set the resolved execution context.
        
        Called once after all resources are resolved, before streaming begins.
        This captures the "snapshot" of what the agent has access to, enabling:
        - Debugging: Understanding what was available when investigating failures
        - Auditing: Tracking what resources each execution consumed
        - Security review: Verifying which secrets (by key name only) were exposed
        - UX transparency: Showing users what their agent can access
        
        Args:
            environment_keys: Environment variable keys (NOT values) available to agent.
                              Represents the merged result of template, instance, and runtime env.
            mcp_servers: Dict mapping server slug to (resolved, message, enabled_tool_count).
                         resolved=True means server was found and configured successfully.
                         resolved=False means resolution failed (server not found, missing env var).
            skill_names: Names of skills injected into system prompt.
        
        Note:
            Environment values are intentionally NOT captured for security reasons.
            Only keys are stored to enable debugging without exposing secrets.
        """
        # Build ResolvedExecutionContext proto
        resolved_context = ResolvedExecutionContext(
            environment_keys=sorted(environment_keys),  # Sorted for consistent ordering
            skill_names=sorted(skill_names),            # Sorted for consistent ordering
        )
        
        # Build MCP server status map
        for slug, (resolved, message, tool_count) in mcp_servers.items():
            resolved_context.mcp_servers[slug].CopyFrom(
                McpServerResolutionStatus(
                    resolved=resolved,
                    message=message,
                    enabled_tool_count=tool_count,
                )
            )
        
        # Assign to status proto
        self.current_status.resolved_context.CopyFrom(resolved_context)
        
        # Structured logging for observability
        resolved_count = sum(1 for r, _, _ in mcp_servers.values() if r)
        failed_count = len(mcp_servers) - resolved_count
        
        self.logger.info(
            f"[CONTEXT] execution={self.execution_id} "
            f"env_keys={len(environment_keys)} "
            f"mcp_servers={len(mcp_servers)} (resolved={resolved_count}, failed={failed_count}) "
            f"skills={len(skill_names)}"
        )
        
        # Log details at debug level for troubleshooting
        if environment_keys:
            self.logger.debug(f"[CONTEXT] Environment keys: {sorted(environment_keys)}")
        if mcp_servers:
            for slug, (resolved, message, tool_count) in mcp_servers.items():
                status = "OK" if resolved else "FAILED"
                self.logger.debug(
                    f"[CONTEXT] MCP server '{slug}': {status} - {message} "
                    f"(tools={tool_count})"
                )
        if skill_names:
            self.logger.debug(f"[CONTEXT] Skills: {sorted(skill_names)}")
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Context Management (Phase 3)
    #
    # These methods implement the SummarizationCallback protocol for integration
    # with the SummarizationMiddleware in graphton. They track context window
    # utilization and record summarization events.
    # ─────────────────────────────────────────────────────────────────────────────
    
    def initialize_context_info(
        self,
        context_window_limit: int,
        trigger_threshold: int,
        target_tokens: int,
        enabled: bool,
    ) -> None:
        """
        Initialize context info from model registry data.
        
        Called once at the start of execution to set up context tracking.
        This captures the configuration that will be used for summarization.
        
        Args:
            context_window_limit: Model's maximum context window size in tokens.
            trigger_threshold: Token threshold that triggers summarization.
            target_tokens: Target token count after summarization.
            enabled: Whether summarization is enabled for this execution.
        """
        self._context_info = ContextInfo(
            context_window_limit=context_window_limit,
            summarization_trigger_threshold=trigger_threshold,
            summarization_target_tokens=target_tokens,
            summarization_enabled=enabled,
            current_token_count=0,
            utilization_percent=0.0,
        )
        
        self.logger.info(
            f"[CONTEXT] execution={self.execution_id} "
            f"context_management initialized: "
            f"window={context_window_limit}, "
            f"trigger={trigger_threshold}, "
            f"target={target_tokens}, "
            f"enabled={enabled}"
        )
    
    def on_summarization_complete(self, event: SummarizationEventData) -> None:
        """
        Callback from SummarizationMiddleware when summarization completes.
        
        Records the summarization event and updates context info.
        This is part of the SummarizationCallback protocol.
        
        Args:
            event: Immutable data object containing summarization metrics.
        """
        if self._context_info is None:
            self.logger.warning(
                f"[CONTEXT] execution={self.execution_id} "
                "on_summarization_complete called but context_info not initialized"
            )
            return
        
        # Create proto event
        timestamp = _utc_timestamp()
        proto_event = SummarizationEvent(
            timestamp=timestamp,
            tokens_before=event.tokens_before,
            tokens_after=event.tokens_after,
            compression_ratio=event.compression_ratio,
            duration_ms=event.duration_ms,
            summarization_model=event.summarization_model,
            messages_before=event.messages_before,
            messages_after=event.messages_after,
        )
        self._summarization_events.append(proto_event)
        
        # Update context info with new token count
        self._context_info.current_token_count = event.tokens_after
        self._update_utilization()
        
        # Structured logging
        self.logger.info(
            f"[CONTEXT] execution={self.execution_id} "
            f"summarization completed: "
            f"{event.tokens_before} -> {event.tokens_after} tokens "
            f"({event.compression_ratio * 100:.1f}% reduction), "
            f"duration={event.duration_ms}ms, "
            f"model={event.summarization_model}"
        )
    
    def on_token_count_updated(self, token_count: int) -> None:
        """
        Callback from SummarizationMiddleware when token count changes.
        
        Updates the current token count and recalculates utilization.
        This is part of the SummarizationCallback protocol.
        
        Args:
            token_count: Current token count in the context window.
        """
        if self._context_info is None:
            # Not an error - context tracking may be disabled
            return
        
        self._context_info.current_token_count = token_count
        self._update_utilization()
        
        self.logger.debug(
            f"[CONTEXT] execution={self.execution_id} "
            f"token_count={token_count} "
            f"utilization={self._context_info.utilization_percent:.1f}%"
        )
    
    def _update_utilization(self) -> None:
        """Recalculate utilization percentage based on current token count."""
        if self._context_info is None:
            return
        
        if self._context_info.context_window_limit > 0:
            self._context_info.utilization_percent = (
                self._context_info.current_token_count
                / self._context_info.context_window_limit
                * 100
            )
        else:
            self._context_info.utilization_percent = 0.0
    
    def finalize_context_info(self) -> None:
        """
        Finalize context info and copy to status proto.
        
        Called at the end of execution to copy accumulated context info,
        summarization events, and execution outputs to the status proto.
        """
        if self._context_info is not None:
            # Copy summarization events to context info
            for event in self._summarization_events:
                self._context_info.summarization_events.append(event)
            
            # Copy context info to status proto
            self.current_status.context_info.CopyFrom(self._context_info)
            
            # Summary log
            summarization_count = len(self._summarization_events)
            self.logger.info(
                f"[CONTEXT] execution={self.execution_id} "
                f"context_info finalized: "
                f"final_tokens={self._context_info.current_token_count}, "
                f"utilization={self._context_info.utilization_percent:.1f}%, "
                f"summarizations={summarization_count}"
            )
        
        # Copy artifacts to status proto
        if self._artifacts:
            for artifact in self._artifacts:
                self.current_status.artifacts.append(artifact)
            
            self.logger.info(
                f"[ARTIFACTS] execution={self.execution_id} "
                f"finalized {len(self._artifacts)} artifacts"
            )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Execution Artifacts (Artifact Lifecycle)
    #
    # These methods track artifacts published by the agent via the publish_artifact tool.
    # Artifacts are accumulated during execution and added to the final status.
    # ─────────────────────────────────────────────────────────────────────────────
    
    def add_artifact(self, artifact: ExecutionArtifact) -> None:
        """
        Add a published artifact to the tracking list.
        
        Called by the publish_artifact tool when an agent publishes
        a file or directory as a downloadable artifact.
        
        Args:
            artifact: ExecutionArtifact proto with download URL and metadata.
        """
        self._artifacts.append(artifact)
        
        self.logger.info(
            f"[ARTIFACT] execution={self.execution_id} "
            f"name={artifact.name} "
            f"size={artifact.size_bytes} bytes "
            f"path={artifact.sandbox_path}"
        )
    
    def get_artifacts(self) -> list[ExecutionArtifact]:
        """
        Get the current list of artifacts.
        
        Returns:
            List of ExecutionArtifact protos published during this execution.
        """
        return list(self._artifacts)