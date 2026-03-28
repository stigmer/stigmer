"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import hashlib
import inspect
import json
import logging
from collections import deque
from collections.abc import Callable, Coroutine, Iterator
from datetime import datetime
from typing import Any
from uuid import uuid4

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import TodoItem
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

# ─────────────────────────────────────────────────────────────────────────────
# Sub-Agent Subject Generation
#
# Generates a concise task title for sub-agent executions using an economy-tier
# LLM. Follows the same pattern as session subject generation in
# generate_session_subject.py.
# ─────────────────────────────────────────────────────────────────────────────

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

        llm_kwargs: dict = {}
        if worker_config.llm.provider == "ollama":
            llm_kwargs["base_url"] = worker_config.llm.base_url
        elif worker_config.llm.provider in ("anthropic", "openai"):
            llm_kwargs["api_key"] = worker_config.llm.api_key

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


# Planning tools that update execution state without UI display
PLANNING_TOOLS = {
    'write_todos',
}

# Maximum characters for tool_call.result in the status proto payload.
# This is a display/transport concern — the gRPC Temporal update must fit
# within message-size limits.  The LLM context has its own independent cap
# (see graphton.core.tool_wrappers._MAX_TOOL_OUTPUT_CHARS).
_MAX_STATUS_RESULT_CHARS: int = 50_000

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

# Read-only tools whose result content is replaced with a size-only placeholder
# in the persisted state.  The file path is already in tc.args; full content
# lives in the LangGraph checkpoint DB if ever needed.
_READ_ONLY_TOOLS: set[str] = {"read", "read_file"}

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
        
        # In-memory index from tool_call_id to the ToolCall proto reference
        # inside a message's repeated field.  Mutations via these references
        # propagate directly to the message-embedded copy — no sync needed.
        # Replaces the removed flat ``tool_calls`` list on the proto.
        self._tool_call_index: dict[str, ToolCall] = {}
        
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
        
        # ─────────────────────────────────────────────────────────────────────────
        # AI Message Ownership Tracking (Tool Call → Parent AI Message)
        #
        # Tracks the most recently created AI message per execution context
        # (keyed by namespace).  When a tool call fires (on_tool_start or
        # early tool_use detection), the ToolCall proto is appended to this
        # message's tool_calls repeated field — establishing the standard
        # "AI message owns its tool calls" relationship used by OpenAI,
        # Anthropic, and LangChain.
        #
        # Stores proto-managed references (the element inside the repeated
        # field, not the original) so mutations are visible in the status.
        # ─────────────────────────────────────────────────────────────────────────
        self._last_ai_message: dict[str, AgentMessage] = {}
        
        # Track tool execution timing for duration calculation (Phase 2.2)
        # Key: run_id, Value: start timestamp
        self._tool_start_times: dict[str, datetime] = {}
        
        # NOTE: Token accumulators (_total_prompt_tokens, etc.) removed in
        # Phase 3; all usage tracking now lives in self._usage_tracker.
        
        # ─────────────────────────────────────────────────────────────────────────
        # Sub-Agent Tracking (Phase 2.3)
        #
        # These structures enable namespace-based event routing to capture
        # tool calls and messages within sub-agent executions.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Track active sub-agent executions by their run_id
        # Key: run_id (from task tool), Value: SubAgentExecution proto
        self._active_sub_agents: dict[str, SubAgentExecution] = {}

        # Completed sub-agent executions, moved here from _active_sub_agents
        # on completion.  Namespace mappings are preserved so late-arriving
        # events from LangGraph still route to the correct proto.
        self._completed_sub_agents: dict[str, SubAgentExecution] = {}

        # Bridge between LangGraph run_ids and Anthropic tool_call_ids.
        # SubAgentExecution.id uses the tool_call_id (for frontend matching),
        # while _active_sub_agents and namespace registration use the run_id.
        # Key: LangGraph run_id, Value: tool_call_id (= SubAgentExecution.id)
        self._run_id_to_tool_call_id: dict[str, str] = {}

        # Map namespace to sub-agent run_id for event routing
        # Key: namespace string, Value: sub-agent run_id
        self._namespace_to_sub_agent_id: dict[str, str] = {}
        
        # Causal namespace registration: when "task" tools start, we record
        # their sub-agent IDs in FIFO order.  The next unregistered multi-segment
        # namespace (indicating a nested sub-graph) is associated with the
        # front-of-queue sub-agent.  Supports concurrent sub-agent launches
        # where multiple task tools start before any child events arrive.
        self._pending_sub_agent_ids: list[str] = []
        
        # Subject deduplication: tracks how many times each subject has been
        # assigned so duplicate subjects get a numeric suffix (e.g., "(2)").
        self._subject_counts: dict[str, int] = {}
        
        # Namespaces already warned about (deduplication — log once per namespace)
        self._warned_namespaces: set[str] = set()
        
        # Track AI message generation timing within sub-agents (separate from main)
        # Key: (sub_agent_id, message_index), Value: start timestamp
        self._sub_agent_message_start_times: dict[tuple[str, int], datetime] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Usage & Cost Tracking (Phase 3)
        #
        # All token accounting, pricing lookups, per-call metrics, per-model
        # aggregation, and duration tracking are delegated to UsageTracker.
        # StatusBuilder routes events to it and calls build_usage_metrics()
        # to obtain the proto.
        # ─────────────────────────────────────────────────────────────────────────
        self._usage_tracker = UsageTracker(execution_id)
        
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
        
        # Tracks when the execution entered WAITING_FOR_APPROVAL so we can
        # compute approval_wait_duration_ms on exit.
        self._approval_wait_started_at: datetime | None = None
        
        # ─────────────────────────────────────────────────────────────────────────
        # Context Management Tracking (Phase 3)
        #
        # Tracks context window utilization and summarization events.
        # This class implements the SummarizationCallback protocol for integration
        # with the SummarizationMiddleware in graphton.
        # ─────────────────────────────────────────────────────────────────────────
        
        # Context info initialized via initialize_context_info()
        self._context_info: ContextInfo | None = None
        
        # Context info is the single source of truth for summarization events.
        # Events are appended directly to _context_info.summarization_events
        # (once initialized) and synced to current_status via _sync_context_info().
        
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

        # Resume-aware dedup: tool calls recently reconciled from WAITING_APPROVAL
        # to RUNNING by ResumeReconciler.  Keyed by tool_name → deque of
        # tool_call_ids (FIFO order preserves match ordering when the same tool
        # appears multiple times).  Consumed by _handle_tool_start_event as a
        # fallback when fingerprint dedup fails (fingerprints are computed from
        # display args in populate_fingerprints but raw args in the event, which
        # can diverge due to humanization).
        self._reconciled_resume_tool_calls: dict[str, deque[str]] = {}

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
        # LLM Turn-Boundary Tracking
        #
        # Tracks the most recent LLM run_id per namespace so we can detect
        # when a new LLM invocation starts.  Without this, thinking-only
        # turns (thinking + tool_use, no text) leave _last_ai_message
        # pointing at the previous turn's empty parent AI, causing the
        # next turn's thinking/tool_use blocks to pile up on the wrong
        # message.  When the run_id changes we clear _last_ai_message
        # for that namespace so a fresh parent is created.
        # ─────────────────────────────────────────────────────────────────────────
        self._last_llm_run_id: dict[str, str] = {}
        
        # ─────────────────────────────────────────────────────────────────────────
        # Early Tool Call Creation (Live Write Streaming UX)
        #
        # When the LLM stream produces a tool_use block, we create the ToolCall
        # immediately — before on_tool_start fires — so the CLI shows the tool
        # name instead of the "Thinking…" idle indicator.  The queue holds temp
        # IDs in FIFO order; on_tool_start pops the first match and reconciles
        # (updating args, registering the real run_id as an alias).
        # Each entry is (temp_id, sub_agent_id_or_None) so reconciliation
        # matches within the correct execution context and avoids
        # cross-contamination between concurrent sub-agents.
        # ─────────────────────────────────────────────────────────────────────────
        self._early_tool_call_queue: list[tuple[str, str | None]] = []
        
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

        # When True, the main event loop should send a gRPC status update
        # immediately after process_event() returns, bypassing the scheduler's
        # time/burst thresholds.  Set by _create_early_tool_call and
        # _start_thinking_stream so the CLI sees new tool calls without
        # waiting for the next scheduled update (which may be 500ms–30s away
        # if no further LangGraph events arrive).
        self.force_next_update: bool = False

        # Resolved agent env vars used by _create_args_preview to expand
        # $VAR references in display strings.  Set via set_display_env_vars()
        # once the merged environment is available.
        self._display_env_vars: dict[str, str] | None = None
        self._secret_keys: set[str] | None = None

        # Sandbox workspace root for display humanization.  Set via
        # set_workspace_root() once the workspace is provisioned.
        # humanize_sandbox_paths() uses this to strip absolute sandbox
        # paths from display strings (tool args, results, previews).
        self._workspace_root: str = ""
    
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
        return self._tool_call_index.get(tc_id)

    def iter_all_tool_calls(self) -> Iterator[ToolCall]:
        """Iterate over every tracked ToolCall (main agent + sub-agents)."""
        return iter(self._tool_call_index.values())

    def tool_call_count(self) -> int:
        """Return the total number of tracked tool calls."""
        return len(self._tool_call_index)

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
                # Keep the FIFO queue in sync: remove the matched entry so
                # the fallback doesn't retain stale slots that could capture
                # genuinely new tool calls with the same tool name.
                resume_queue = self._reconciled_resume_tool_calls.get(tool_name)
                if resume_queue:
                    try:
                        resume_queue.remove(original_tc_id)
                    except ValueError:
                        pass
                self.logger.info(
                    f"[RESUME_ALIAS] execution={self.execution_id} "
                    f"tool={tool_name} new_run_id={run_id} -> "
                    f"original_tc_id={original_tc_id} "
                    f"(fingerprint dedup on resume path)"
                )
            # Task tools must NOT return here — the task handler below
            # manages sub-agent lifecycle (reactivation on resume,
            # SubAgentExecution creation on first run).  The alias set
            # above is sufficient for the dedup; control falls through.
            if tool_name != "task":
                return

        # Fallback: resume-aware dedup for reconciled tool calls.
        # Fingerprint dedup above uses raw event args, but
        # populate_fingerprints_from_existing_tool_calls computes from
        # humanized display args stored in the proto Struct.  When
        # _humanize_args_for_display transforms values (e.g. platform refs,
        # env var resolution), the fingerprints diverge and the primary
        # check above misses the match.  This fallback uses the explicit
        # reconciled-tool registry populated by ResumeReconciler.
        #
        # Task tools are excluded: their lifecycle is managed by the task
        # handler below via _reconcile_early_tool_call + _handle_sub_agent_start.
        resume_queue = self._reconciled_resume_tool_calls.get(tool_name)
        if resume_queue and tool_name != "task":
            original_tc_id = resume_queue.popleft()
            self._run_id_aliases[run_id] = original_tc_id
            self.tool_call_fingerprints.add(fingerprint)
            self._fingerprint_to_tool_call_id[fingerprint] = original_tc_id
            self.logger.info(
                f"[RESUME_ALIAS] execution={self.execution_id} "
                f"tool={tool_name} new_run_id={run_id} -> "
                f"original_tc_id={original_tc_id} "
                f"(reconciled resume fallback)"
            )
            return

        self.tool_call_fingerprints.add(fingerprint)

        # Register namespace early — before any special-case handlers — so
        # that PLANNING_TOOLS and task-tool handlers can distinguish sub-agent
        # events from main-agent events via _get_execution_context().
        # _register_sub_agent_namespace is idempotent (returns immediately
        # for already-registered or single-segment namespaces).
        if namespace:
            self._register_sub_agent_namespace(namespace)

        # Handle planning tools
        if tool_name in PLANNING_TOOLS:
            if tool_name == "write_todos":
                _, sub_agent = self._get_execution_context(namespace)
                if sub_agent is not None:
                    self.logger.debug(
                        f"[PLANNING] execution={self.execution_id} "
                        f"skipping sub-agent write_todos "
                        f"(sub_agent_id={sub_agent.id})"
                    )
                    return
                todos_data = tool_args.get("todos", [])
                if todos_data:
                    self._update_todos(todos_data)
            return
        
        # ─────────────────────────────────────────────────────────────────────
        # Sub-Agent Detection (Phase 2.3): "task" tool invokes a sub-agent
        #
        # Reconcile the early ToolCall (created from the tool_use stream
        # block) so it persists in the parent AI message — this is the slot
        # the frontend uses to render SubAgentSection.  Extract the
        # tool_call_id so SubAgentExecution.id matches ToolCall.id.
        # ─────────────────────────────────────────────────────────────────────
        if tool_name == "task":
            tool_call_id: str | None = None
            early_tc = self._reconcile_early_tool_call(tool_name, run_id, tool_args, namespace)
            if early_tc is not None:
                tool_call_id = early_tc.id
            else:
                # No early ToolCall (e.g. checkpoint replay where the stream
                # did not re-emit tool_use blocks).  Create one now so the
                # frontend has a tool call slot for the sub-agent.
                ns_key = namespace or ""
                display_args = self._humanize_args_for_display(tool_args) if tool_args else {}
                args_struct = Struct()
                if display_args:
                    args_struct.update(display_args)
                now = datetime.utcnow()
                tool_call = ToolCall(
                    id=run_id,
                    name=tool_name,
                    args=args_struct,
                    args_preview=self._create_args_preview(tool_args),
                    result="",
                    status=ToolCallStatus.TOOL_CALL_RUNNING,
                    component_metadata=ComponentMetadata(
                        component_type=infer_component_type(tool_name),
                        component_group="main-agent-tools",
                    ),
                    started_at=_utc_timestamp(now),
                )
                parent_ai = self._ensure_parent_ai_message(ns_key, namespace)
                parent_ai.tool_calls.append(tool_call)
                self._tool_call_index[run_id] = parent_ai.tool_calls[-1]
                tool_call_id = run_id

            await self._handle_sub_agent_start(event, tool_args, run_id, tool_call_id=tool_call_id)
            return
        
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
            # The index holds a reference INTO the message's repeated field,
            # so _reconcile_early_tool_call already mutated the message copy.
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
        display_args = self._humanize_args_for_display(tool_args) if tool_args else {}
        args_struct = Struct()
        if display_args:
            args_struct.update(display_args)
        
        now = datetime.utcnow()
        initial_status = (
            ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
            if approval_requirement.requires_approval
            else ToolCallStatus.TOOL_CALL_RUNNING
        )
        
        mcp_server_slug = ""
        if self._approval_config is not None:
            mcp_server_slug = self._approval_config.get_mcp_server_for_tool(tool_name)
        
        tool_call = ToolCall(
            id=run_id,
            name=tool_name,
            args=args_struct,
            args_preview=self._create_args_preview(tool_args),
            result="",
            status=initial_status,
            component_metadata=component_metadata,
            started_at=_utc_timestamp(now),
            mcp_server_slug=mcp_server_slug,
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
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Route to correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        ns_key = namespace or ""
        
        # Determine context info for logging
        status_name = ToolCallStatus.Name(initial_status)
        
        # Attach tool call to the parent AI message — the single source of
        # truth.  The in-memory _tool_call_index provides O(1) lookup by ID.
        parent_ai = self._ensure_parent_ai_message(ns_key, namespace)
        parent_ai.tool_calls.append(tool_call)
        self._tool_call_index[run_id] = parent_ai.tool_calls[-1]
        
        context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
        self.logger.debug(
            f"[TOOL] execution={self.execution_id} {context_desc} "
            f"tool={tool_name} run_id={run_id} status={status_name}"
        )
        
        if approval_requirement.requires_approval:
            self._set_waiting_for_approval_phase(tool_name, run_id)
    
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
        existing = self._last_ai_message.get(ns_key)
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
        self._last_ai_message[ns_key] = managed

        if llm_run_id:
            self._llm_run_id_to_message[llm_run_id] = managed

        self.logger.debug(
            "[AI_MSG] execution=%s created empty parent AI message "
            "namespace=%s llm_run_id=%s (tool call arrived before text)",
            self.execution_id,
            namespace or "main",
            llm_run_id or "none",
        )
        return managed

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

        chunk = humanize_sandbox_paths(chunk, self._workspace_root)

        # Resolve run-ID alias (resume-after-approval path)
        resolved_id = self._resolve_run_id(run_id)
        
        tool_call = self.get_tool_call(resolved_id)
        if tool_call is None:
            self.logger.debug(
                f"[TOOL_PROGRESS] execution={self.execution_id} "
                f"run_id={run_id} resolved_id={resolved_id} "
                f"ignored (tool call not found)"
            )
            return
        
        was_streaming = tool_call.is_streaming

        current_len = len(tool_call.result)
        if current_len < _MAX_STATUS_RESULT_CHARS:
            remaining = _MAX_STATUS_RESULT_CHARS - current_len
            tool_call.result += chunk[:remaining]
            if len(chunk) > remaining:
                tool_call.result += "\n[output truncated for display]"
        tool_call.is_streaming = True

        if not was_streaming:
            self.force_next_update = True

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

        if tool_name in _READ_ONLY_TOOLS:
            persisted_result = f"[content omitted - {len(tool_result_content)} chars]"
        elif len(tool_result_content) > _MAX_STATUS_RESULT_CHARS:
            persisted_result = (
                tool_result_content[:_MAX_STATUS_RESULT_CHARS]
                + "\n[output truncated for display]"
            )
        else:
            persisted_result = tool_result_content

        persisted_result = humanize_sandbox_paths(
            persisted_result, self._workspace_root,
        )

        now = datetime.utcnow()
        
        # Calculate execution duration if we tracked the start time
        duration_ms = None
        if run_id in self._tool_start_times:
            start_time = self._tool_start_times.pop(run_id)
            duration_ms = int((now - start_time).total_seconds() * 1000)
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing: Update in correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        
        # Record tool duration in UsageTracker
        if duration_ms is not None:
            scope = sub_agent.id if sub_agent else MAIN_SCOPE
            self._usage_tracker.record_tool_duration(duration_ms, scope)
        
        completed_at = _utc_timestamp(now)

        tool_call = self.get_tool_call(resolved_id)
        if tool_call is not None:
            tool_call.result = persisted_result
            tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
            tool_call.completed_at = completed_at
            tool_call.is_streaming = False
        
        context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
        self.logger.debug(
            f"[TOOL] execution={self.execution_id} {context_desc} "
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
        if run_id and run_id != self._last_llm_run_id.get(ns_key):
            self._last_ai_message.pop(ns_key, None)
            self._last_llm_run_id[ns_key] = run_id
        
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
                expected_non_text_types = frozenset({
                    "thinking", "tool_use", "input_json_delta",
                })
                block_types = [
                    self._block_attr(b, "type", type(b).__name__)
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
                    if self._block_attr(block, "type") == "tool_use":
                        t_name = self._block_attr(block, "name")
                        t_id = self._block_attr(block, "id")
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
                    if self._block_attr(block, "type") == "input_json_delta":
                        partial = self._block_attr(block, "partial_json")
                        if partial:
                            self._accumulate_tool_input(ns_key, partial)
                except Exception:
                    self.logger.exception(
                        f"[TOOL_INPUT_ERROR] execution={self.execution_id} "
                        f"namespace={namespace or 'main'}"
                    )
            
            if thinking_text:
                self._thinking_buffers[ns_key] = (
                    self._thinking_buffers.get(ns_key, "") + thinking_text
                )
                if ns_key not in self._thinking_tool_call_ids:
                    self._start_thinking_stream(
                        ns_key, namespace, self._thinking_buffers[ns_key],
                        llm_run_id=run_id,
                    )
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
                # Empty parent AI messages created by _ensure_parent_ai_message
                # for thinking/tool_use blocks must NOT receive text content.
                # Text should go to a separate AI message so the frontend
                # renders the thread in chronological order: thinking tool
                # group first, then the text response.  Remove the stale
                # registration so the "first token" path below creates a
                # proper text AI message and re-registers the run_id.
                if not ai_message.content and len(ai_message.tool_calls) > 0:
                    del self._llm_run_id_to_message[run_id]
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
            self._llm_run_id_to_message[run_id] = managed_ai_message
        
        # Track as the most recent AI message for this namespace so that
        # subsequent tool calls (on_tool_start, early tool_use) are attached
        # to the correct parent AI message.
        ns_key = namespace or ""
        self._last_ai_message[ns_key] = managed_ai_message
        
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
        ai_message.token_count = total_input_tokens + output_tokens
        
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
        
        # Enrich AgentMessage with per-message cost and model info
        ai_message.input_tokens = regular_input_tokens
        ai_message.output_tokens = output_tokens
        ai_message.cache_read_tokens = cache_read_tokens
        ai_message.estimated_cost_usd = call_metrics.estimated_cost_usd
        ai_message.model = model_name
        
        # Update the usage proto progressively
        if sub_agent:
            sub_agent.usage.CopyFrom(self._usage_tracker.build_usage_metrics(scope))
        else:
            self.current_status.usage.CopyFrom(
                self._usage_tracker.build_usage_metrics(MAIN_SCOPE)
            )
        
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
        """Pre-populate fingerprints and the in-memory index from persisted messages.

        On the resume-after-approval path, the StatusBuilder is initialized with
        the DB-persisted status that already contains tool calls embedded in
        messages.  LangGraph may re-fire ``on_tool_start`` events for resumed
        tools; pre-populating fingerprints prevents duplicate entries.

        Also rebuilds ``_tool_call_index`` so that all subsequent lookups work
        against the message-embedded references.
        """
        def _index_tool_calls(messages: Any) -> None:
            for message in messages:
                if message.type != MessageType.MESSAGE_AI:
                    continue
                for i, tc in enumerate(message.tool_calls):
                    if tc.id:
                        self._tool_call_index[tc.id] = message.tool_calls[i]
                    try:
                        args_dict: dict[str, Any] = dict(tc.args) if tc.args else {}
                        fingerprint = self._get_tool_fingerprint(tc.name, args_dict)
                        self.tool_call_fingerprints.add(fingerprint)
                        if tc.id:
                            self._fingerprint_to_tool_call_id[fingerprint] = tc.id
                    except Exception:
                        pass

        _index_tool_calls(self.current_status.messages)

        for sub_agent in self.current_status.sub_agent_executions:
            _index_tool_calls(sub_agent.messages)
    
    def _extract_tool_result_content(self, result: Any) -> str:
        """Extract displayable content string from a tool result.

        Handles the five result shapes that flow through LangGraph astream_events:
        - str: Direct string results (most common for simple tools)
        - LangGraph message objects (ToolMessage, AIMessage): Extract .content
        - LangGraph Command objects: Extract ToolMessage content from .update
        - dict: Extract from 'output'/'content' keys, or JSON-serialize
        - list: Extract text from MCP content blocks, or JSON-serialize
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
        if isinstance(result, list):
            extracted = self._extract_string_content(result)
            if extracted:
                return extracted
            try:
                return json.dumps(result, indent=2, default=str)
            except (TypeError, ValueError):
                pass
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
        self,
        tool_name: str,
        tool_use_id: str,
        ns_key: str,
        namespace: str,
        llm_run_id: str = "",
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

        temp_id = tool_use_id or f"early-{uuid4()}"

        # On resume, LangGraph replays the AI message from the checkpoint.
        # The replayed tool_use blocks carry the same tool_use_id, so the
        # derived temp_id matches an existing ToolCall from the previous
        # cycle.  Skip creation to avoid duplicate messages and tool calls.
        #
        # However, we MUST still enqueue the existing TC for reconciliation.
        # When on_tool_start fires later, _reconcile_early_tool_call needs
        # to find this entry so it can create a run_id alias to the correct
        # Anthropic tool_call_id.  Without this, the task handler falls
        # through to the run_id fallback, producing UUID-format IDs that
        # diverge from the InjectedToolCallId in the interrupt payload.
        if self._find_tool_call_by_id(temp_id) is not None:
            _, sub_agent = self._get_execution_context(namespace)
            sa_id = sub_agent.id if sub_agent else None
            self._early_tool_call_queue.append((temp_id, sa_id))
            self.logger.info(
                "[RESUME_DEDUP] execution=%s skipping early tool call "
                "creation for %s (id=%s already exists from prior cycle, "
                "re-queued for reconciliation)",
                self.execution_id, tool_name, temp_id,
            )
            return

        mcp_server_slug = ""
        if self._approval_config is not None:
            mcp_server_slug = self._approval_config.get_mcp_server_for_tool(tool_name)

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
            mcp_server_slug=mcp_server_slug,
        )

        parent_ai = self._ensure_parent_ai_message(
            ns_key, namespace, llm_run_id=llm_run_id,
        )
        parent_ai.tool_calls.append(tool_call)
        self._tool_call_index[temp_id] = parent_ai.tool_calls[-1]

        _, sub_agent = self._get_execution_context(namespace)
        sa_id = sub_agent.id if sub_agent else None
        self._early_tool_call_queue.append((temp_id, sa_id))
        self._tool_start_times[temp_id] = now

        self._tool_input_active_tc[ns_key] = temp_id
        self._tool_input_buffers[temp_id] = ""

        self.force_next_update = True

    def _reconcile_early_tool_call(
        self,
        tool_name: str,
        run_id: str,
        tool_args: dict[str, Any],
        namespace: str,
    ) -> ToolCall | None:
        """Match an ``on_tool_start`` event to an early-created ToolCall.

        Pops the first queued entry whose ToolCall name matches *tool_name*
        and whose sub-agent context matches the current namespace.  This
        prevents cross-contamination when concurrent sub-agents invoke the
        same tool (e.g., two sub-agents both calling ``read_file``).

        If found, the existing ToolCall is updated in place (args populated,
        ``is_streaming`` cleared) and the real *run_id* is registered as an
        alias so that downstream handlers (``on_tool_end``, ``tool_progress``)
        resolve to the same proto.

        On the **resume path**, a TC from the prior cycle is re-queued by
        ``_create_early_tool_call`` (it already has args, approval status,
        etc.).  In that case only the run_id alias is registered — the
        existing state is preserved to avoid overwriting approval decisions
        that were already recorded.

        Returns the reconciled ToolCall, or ``None`` if no match exists.
        """
        _, sub_agent = self._get_execution_context(namespace)
        sa_id = sub_agent.id if sub_agent else None

        for idx, (temp_id, queued_sa_id) in enumerate(self._early_tool_call_queue):
            existing = self.get_tool_call(temp_id)
            if existing is None or existing.name != tool_name:
                continue
            if queued_sa_id != sa_id:
                continue

            self._early_tool_call_queue.pop(idx)

            # Resume path: TC from a prior cycle was re-queued by
            # _create_early_tool_call's resume dedup.  The TC is fully
            # populated (not streaming) and may already have an approval
            # decision recorded.  Only register the run_id alias so
            # downstream handlers route correctly.
            is_resume_requeue = not existing.is_streaming
            if is_resume_requeue:
                self._run_id_aliases[run_id] = temp_id
                fingerprint = self._get_tool_fingerprint(tool_name, tool_args)
                self._fingerprint_to_tool_call_id[fingerprint] = temp_id
                self.logger.info(
                    "[RECONCILE] execution=%s resume-path reconciliation: "
                    "tool=%s run_id=%s -> existing_tc=%s "
                    "(alias only, preserving prior-cycle state)",
                    self.execution_id, tool_name, run_id, temp_id,
                )
                return existing

            self._flush_tool_input_buffer(temp_id)

            existing.result = ""

            if tool_args:
                display_args = self._humanize_args_for_display(tool_args)
                args_struct = Struct()
                args_struct.update(display_args)
                existing.args.CopyFrom(args_struct)
                existing.args_preview = self._create_args_preview(tool_args)

            existing.is_streaming = False

            if self._approval_config is not None:
                slug = self._approval_config.get_mcp_server_for_tool(tool_name)
                if slug and not existing.mcp_server_slug:
                    existing.mcp_server_slug = slug

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
            self._tool_start_times[run_id] = self._tool_start_times.pop(
                temp_id, datetime.utcnow()
            )

            fingerprint = self._get_tool_fingerprint(tool_name, tool_args)
            self._fingerprint_to_tool_call_id[fingerprint] = temp_id

            if approval.requires_approval:
                self._set_waiting_for_approval_phase(tool_name, run_id)

            return existing

        return None

    def _start_thinking_stream(
        self,
        ns_key: str,
        namespace: str,
        initial_text: str,
        llm_run_id: str = "",
    ) -> None:
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

        parent_ai = self._ensure_parent_ai_message(
            ns_key, namespace, llm_run_id=llm_run_id,
        )
        parent_ai.tool_calls.append(tool_call)
        self._tool_call_index[tc_id] = parent_ai.tool_calls[-1]

        self._thinking_tool_call_ids[ns_key] = tc_id
        self._thinking_started_at[ns_key] = now

        self.force_next_update = True

        self.logger.debug(
            "[THINK] execution=%s streaming_started id=%s namespace=%s",
            self.execution_id,
            tc_id,
            namespace or "main",
        )

    def _update_thinking_stream(self, ns_key: str) -> None:
        """Update the streaming think ToolCall with the latest accumulated content."""
        tc_id = self._thinking_tool_call_ids.get(ns_key)
        if not tc_id:
            return

        buf = self._thinking_buffers.get(ns_key, "")

        tool_call = self.get_tool_call(tc_id)
        if tool_call is not None:
            tool_call.result = buf

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

        tool_call = self.get_tool_call(temp_id)
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

        _, sub_agent = self._get_execution_context(namespace)
        completed_ts = _utc_timestamp(now)

        if tc_id:
            tool_call = self.get_tool_call(tc_id)
            if tool_call is not None:
                tool_call.args.CopyFrom(args_struct)
                tool_call.result = "ok"
                tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                tool_call.is_streaming = False
                tool_call.completed_at = completed_ts

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
        fallback_tc = ToolCall(
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
            completed_at=completed_ts,
        )

        parent_ai = self._ensure_parent_ai_message(ns_key, namespace)
        parent_ai.tool_calls.append(fallback_tc)
        self._tool_call_index[fallback_tc.id] = parent_ai.tool_calls[-1]

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
        self._pending_tool_approvals.clear()

        if self._approval_wait_started_at is not None:
            wait_ms = int(
                (datetime.utcnow() - self._approval_wait_started_at).total_seconds() * 1000
            )
            self._usage_tracker.record_approval_wait(wait_ms, MAIN_SCOPE)
            self._approval_wait_started_at = None

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
        tc_id = self._run_id_aliases.get(run_id, run_id)
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

        if self._saved_phase_before_approval is None:
            self._saved_phase_before_approval = self.current_status.phase
            self._approval_wait_started_at = datetime.utcnow()
        self.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL

        self._pending_tool_approvals.append(run_id)
        self.force_next_update = True

        self.logger.info(
            f"[APPROVAL] execution={self.execution_id} "
            f"tool={tool_name} run_id={run_id} tc_id={tc_id} "
            f"status=WAITING_APPROVAL "
            f"pending_count={len(self._pending_tool_approvals)}"
        )
    
    def _find_tool_call_by_id(self, run_id: str) -> ToolCall | None:
        """Find a ToolCall by its run_id via the in-memory index.

        Alias for :meth:`get_tool_call` retained for internal callers.
        """
        return self._tool_call_index.get(run_id)
    
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
        sub_agent_id = self._namespace_to_sub_agent_id.get(namespace)
        if sub_agent_id:
            if sub_agent_id in self._active_sub_agents:
                return self._active_sub_agents[sub_agent_id], self._active_sub_agents[sub_agent_id]

            # Late-arriving event: the sub-agent already completed but
            # LangGraph emitted one more event (e.g. on_chat_model_end
            # finalizing a message that was streamed before completion).
            if sub_agent_id in self._completed_sub_agents:
                self.logger.debug(
                    f"[SUBAGENT] execution={self.execution_id} "
                    f"late event routed to completed sub-agent={sub_agent_id} "
                    f"namespace={namespace}"
                )
                return self._completed_sub_agents[sub_agent_id], self._completed_sub_agents[sub_agent_id]

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
        
        Uses four strategies in priority order:
        
        1. **Root-prefix matching**: Multi-segment namespaces (containing "|")
           share a root segment (before the first "|") when they originate
           from the same sub-agent.  If any already-registered namespace
           shares the same root, the new namespace inherits the mapping.
        
        2. **Substring matching** (legacy): Checks if any active sub-agent's
           run_id appears in the namespace string.
        
        3. **Causal correlation**: When "task" tools start sub-agents,
           their IDs are appended to ``_pending_sub_agent_ids`` (FIFO).
           The first unregistered multi-segment namespace is associated
           with the front-of-queue sub-agent.  This handles the common
           case where LangGraph checkpoint UUIDs differ from the task
           tool's event run_id, including concurrent sub-agent launches.
        
        4. **Sole-active-agent fallback**: When exactly one sub-agent is
           active, all multi-segment namespaces must originate from it
           (there is no other candidate).  This covers the common case
           where a sub-agent's internal graph nodes produce events with
           namespace roots that differ from the initially registered one.
        
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
        if is_multi_segment and self._pending_sub_agent_ids:
            sub_agent_id = self._pending_sub_agent_ids[0]
            if sub_agent_id in self._active_sub_agents:
                self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                self._pending_sub_agent_ids.pop(0)
                self.logger.info(
                    f"[SUBAGENT] Causal registration: namespace={namespace} "
                    f"-> sub_agent={sub_agent_id}"
                )
                return
        
        # Strategy 4: sole-active-agent fallback.
        # When exactly one sub-agent is active, all multi-segment namespaces
        # must originate from it -- there is no other candidate.
        if is_multi_segment and len(self._active_sub_agents) == 1:
            sub_agent_id = next(iter(self._active_sub_agents))
            self._namespace_to_sub_agent_id[namespace] = sub_agent_id
            self.logger.debug(
                f"[SUBAGENT] Sole-active fallback: namespace={namespace} "
                f"-> sub_agent={sub_agent_id}"
            )
            return
        
        # Diagnostic: warn about unresolvable multi-segment namespaces.
        # At this point multiple sub-agents are active and we cannot
        # determine which one owns this namespace.  Deduplicate so we
        # only warn once per unique namespace.
        if is_multi_segment and namespace not in self._warned_namespaces:
            self._warned_namespaces.add(namespace)
            self.logger.warning(
                f"[NS_DIAG] Namespace registration failed: "
                f"execution={self.execution_id} "
                f"namespace={namespace} "
                f"active_sub_agents={list(self._active_sub_agents.keys())} "
                f"pending={self._pending_sub_agent_ids}"
            )
    
    async def _handle_sub_agent_start(
        self,
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

        Args:
            event: The on_tool_start event dictionary.
            tool_args: Unwrapped tool arguments.
            run_id: The LangGraph run_id for this tool invocation.
            tool_call_id: The Anthropic tool_use id from the early ToolCall.
                Falls back to *run_id* when unavailable.
        """
        sa_id = tool_call_id or run_id

        # ── Resume deduplication ──────────────────────────────────────────
        # On resume, LangGraph replays from checkpoint and re-fires
        # on_tool_start for task tools.  Avoid creating duplicate
        # SubAgentExecution entries.
        for existing_sa in self.current_status.sub_agent_executions:
            if existing_sa.id == sa_id:
                self._active_sub_agents[run_id] = existing_sa
                self._run_id_to_tool_call_id[run_id] = sa_id
                if run_id not in self._pending_sub_agent_ids:
                    self._pending_sub_agent_ids.append(run_id)
                self.logger.info(
                    "[SUBAGENT] execution=%s resume reactivation: "
                    "sa_id=%s run_id=%s (skipping duplicate creation)",
                    self.execution_id, sa_id, run_id,
                )
                return

        sub_agent_name = tool_args.get("subagent_type", "") or tool_args.get("agent_type", "") or "unknown"
        sub_agent_input = (
            tool_args.get("description", "")
            or tool_args.get("input", "")
            or tool_args.get("task", "")
            or tool_args.get("prompt", "")
        )
        existing = list(self._subject_counts.keys())
        subject = await _generate_sub_agent_subject(
            sub_agent_input, sub_agent_name, existing_subjects=existing,
        )

        if subject:
            count = self._subject_counts.get(subject, 0) + 1
            self._subject_counts[subject] = count
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

        # Append first, then store the proto-managed reference.
        # Protobuf repeated-message append copies the value; the original
        # object is disconnected from the proto.  By storing the element
        # returned by the repeated field we ensure all later mutations
        # (messages, tool_calls, usage) write to the actual status proto.
        self.current_status.sub_agent_executions.append(sub_agent)
        self._active_sub_agents[run_id] = self.current_status.sub_agent_executions[-1]
        self._run_id_to_tool_call_id[run_id] = sa_id

        # Enqueue for causal namespace registration.
        # The next unregistered multi-segment namespace will be associated
        # with the front-of-queue sub-agent (FIFO for concurrent launches).
        self._pending_sub_agent_ids.append(run_id)

        self.force_next_update = True

        self.logger.info(
            f"[SUBAGENT] execution={self.execution_id} "
            f"sub_agent={sub_agent_name} sa_id={sa_id} run_id={run_id} "
            f"subject={subject!r} status=IN_PROGRESS "
            f"(pending namespace registration)"
        )
    
    def _handle_sub_agent_end(self, event: dict[str, Any], run_id: str) -> None:
        """Handle task tool completion — finalize SubAgentExecution.

        Uses ``_active_sub_agents[run_id]`` for a direct proto reference when
        available, falling back to a linear scan by ``tool_call_id`` (the
        SubAgentExecution.id) when the dict entry is missing.

        Also marks the corresponding ToolCall on the parent AI message as
        COMPLETED so the frontend shows the sub-agent as finished.

        Args:
            event: The on_tool_end event dictionary.
            run_id: The LangGraph run_id for this task tool invocation.
        """
        output_raw = event.get("data", {}).get("output", "")
        output = self._extract_tool_result_content(output_raw)
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

        # Prefer the direct proto reference from _active_sub_agents.
        sub_agent_ref = self._active_sub_agents.get(run_id)
        if sub_agent_ref is None:
            # Fallback: scan by tool_call_id (SubAgentExecution.id)
            sa_id = self._run_id_to_tool_call_id.get(run_id, run_id)
            for sa in self.current_status.sub_agent_executions:
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
            self.logger.debug(
                "[SUBAGENT] execution=%s sa_id=%s run_id=%s status=%s",
                self.execution_id, sub_agent_ref.id, run_id,
                "FAILED" if is_error else "COMPLETED",
            )
        else:
            self.logger.warning(
                "[SUBAGENT] execution=%s _handle_sub_agent_end: "
                "no SubAgentExecution found for run_id=%s "
                "known_ids=%s",
                self.execution_id, run_id,
                [sa.id for sa in self.current_status.sub_agent_executions],
            )

        # Mark the parent ToolCall as COMPLETED so the frontend reflects
        # the sub-agent's finished state.
        tc_id = self._run_id_to_tool_call_id.get(run_id)
        if tc_id:
            parent_tc = self.get_tool_call(tc_id)
            if parent_tc is not None:
                parent_tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                parent_tc.completed_at = _utc_timestamp(now)
                parent_tc.result = output[:_MAX_STATUS_RESULT_CHARS] if output else ""

        # Move from active to completed (preserving reference for late events).
        # Namespace mappings are NOT deleted — late-arriving events from
        # LangGraph can still route to the correct SubAgentExecution.
        if run_id in self._active_sub_agents:
            self._completed_sub_agents[run_id] = self._active_sub_agents.pop(run_id)

        if run_id in self._pending_sub_agent_ids:
            self._pending_sub_agent_ids.remove(run_id)

        self.force_next_update = True

    @property
    def has_orphaned_sub_agents(self) -> bool:
        """True when sub-agents remain active after the event stream ended."""
        return bool(self._active_sub_agents)

    def get_orphaned_sub_agents_diagnostic(self) -> dict:
        """Return structured info about orphaned (still-active) sub-agents.

        Useful for logging and error messages when the graph terminates
        abnormally while sub-agents are in progress.

        Returns:
            Dict with ``total``, ``zero_message`` (spawned but never
            executed), ``mid_execution`` (have messages/tool calls),
            and per-sub-agent ``details``.
        """
        zero_message: list[dict] = []
        mid_execution: list[dict] = []

        for run_id, sub_agent in self._active_sub_agents.items():
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
            "total": len(self._active_sub_agents),
            "zero_message_count": len(zero_message),
            "mid_execution_count": len(mid_execution),
            "zero_message": zero_message,
            "mid_execution": mid_execution,
        }

    def finalize_active_sub_agents(self, status: SubAgentStatus, error: str) -> None:
        """Transition all active sub-agents to a terminal state.

        Called when the parent execution terminates abnormally (error or stall)
        to ensure no sub-agent remains stuck in IN_PROGRESS.

        Args:
            status: Terminal status to assign (typically SUB_AGENT_FAILED or
                    SUB_AGENT_CANCELLED).
            error: Explanation of why the sub-agent was terminated.
        """
        if not self._active_sub_agents:
            return

        now = _utc_timestamp()
        finalized_ids: list[str] = []

        for run_id, sub_agent in list(self._active_sub_agents.items()):
            sub_agent.status = status
            sub_agent.error = error
            sub_agent.completed_at = now
            self._completed_sub_agents[run_id] = sub_agent
            finalized_ids.append(run_id)

        self._active_sub_agents.clear()

        self.logger.info(
            f"[SUBAGENT] execution={self.execution_id} "
            f"finalized {len(finalized_ids)} active sub-agent(s) "
            f"-> {SubAgentStatus.Name(status)}: {finalized_ids}"
        )

    def finalize_active_sub_agents_differentiated(self, error_context: str) -> int:
        """Transition active sub-agents using differentiated statuses.

        Zero-message sub-agents (spawned but never executed) receive
        ``SUB_AGENT_CANCELLED``; sub-agents with messages or tool calls
        (mid-execution) receive ``SUB_AGENT_FAILED``.

        Args:
            error_context: High-level description of why termination occurred
                (e.g. "Parent execution terminated abnormally").

        Returns:
            Number of sub-agents finalized.
        """
        if not self._active_sub_agents:
            return 0

        now = _utc_timestamp()
        cancelled_ids: list[str] = []
        failed_ids: list[str] = []

        for run_id, sub_agent in list(self._active_sub_agents.items()):
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
            self._completed_sub_agents[run_id] = sub_agent

        total = len(self._active_sub_agents)
        self._active_sub_agents.clear()

        self.logger.info(
            f"[SUBAGENT] execution={self.execution_id} "
            f"finalized {total} orphaned sub-agent(s) — "
            f"CANCELLED (zero-message): {cancelled_ids}, "
            f"FAILED (mid-execution): {failed_ids}"
        )
        return total

    def finalize_sub_agents_from_checkpoint_validation(
        self,
        missed_event_count: int,
        confirmed_orphan_count: int,
        error_context: str,
    ) -> int:
        """Finalize active sub-agents using checkpoint validation results.

        Unlike ``finalize_active_sub_agents_differentiated`` which treats all
        active sub-agents as failed/cancelled, this method leverages the
        checkpoint's ground truth to give correct terminal statuses:

        - When the checkpoint confirms ALL task tools completed but
          StatusBuilder missed the events (``missed_event_count > 0``,
          ``confirmed_orphan_count == 0``): marks all active sub-agents
          as ``SUB_AGENT_COMPLETED``.
        - When ALL active sub-agents are confirmed orphans
          (``confirmed_orphan_count > 0``, ``missed_event_count == 0``):
          differentiates as FAILED (mid-execution) or CANCELLED
          (zero-message), same as ``finalize_active_sub_agents_differentiated``.
        - Mixed case (both > 0): uses conservative differentiation
          since we cannot determine which specific sub-agents completed
          without ID-level mapping between checkpoint tool_call_ids and
          StatusBuilder run_ids.

        Args:
            missed_event_count: Sub-agents that completed in the checkpoint
                but StatusBuilder still considers active.
            confirmed_orphan_count: Sub-agents incomplete in both checkpoint
                and StatusBuilder.
            error_context: High-level description for error messages.

        Returns:
            Number of sub-agents finalized.
        """
        if not self._active_sub_agents:
            return 0

        now = _utc_timestamp()
        total = len(self._active_sub_agents)

        if missed_event_count > 0 and confirmed_orphan_count == 0:
            completed_ids: list[str] = []
            for run_id, sub_agent in list(self._active_sub_agents.items()):
                sub_agent.status = SubAgentStatus.SUB_AGENT_COMPLETED
                sub_agent.completed_at = now
                self._completed_sub_agents[run_id] = sub_agent
                completed_ids.append(run_id)

            self._active_sub_agents.clear()
            self.logger.info(
                f"[SUBAGENT] execution={self.execution_id} "
                f"checkpoint confirms {total} sub-agent(s) completed "
                f"(StatusBuilder missed on_tool_end events): "
                f"{completed_ids}"
            )
        else:
            cancelled_ids: list[str] = []
            failed_ids: list[str] = []

            for run_id, sub_agent in list(self._active_sub_agents.items()):
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
                self._completed_sub_agents[run_id] = sub_agent

            self._active_sub_agents.clear()

            qualifier = (
                "confirmed orphaned"
                if missed_event_count == 0
                else "mixed (some may have completed per checkpoint)"
            )
            self.logger.info(
                f"[SUBAGENT] execution={self.execution_id} "
                f"finalized {total} {qualifier} sub-agent(s) — "
                f"CANCELLED (zero-message): {cancelled_ids}, "
                f"FAILED (mid-execution): {failed_ids}"
            )

        return total

    # ─────────────────────────────────────────────────────────────────────────────
    # Usage Metrics (Phase 3 — delegated to UsageTracker)
    # ─────────────────────────────────────────────────────────────────────────────
    
    @property
    def usage_tracker(self) -> UsageTracker:
        """Expose tracker for external callers that need cost or call count."""
        return self._usage_tracker
    
    def finalize_usage(self) -> None:
        """Compute total duration and stamp final usage metrics onto the status.

        Called once when the execution reaches a terminal phase (completed,
        failed, or cancelled).  Parses the ISO 8601 ``started_at`` /
        ``completed_at`` timestamps already on the status proto to derive
        ``total_duration_ms``, then builds the final ``UsageMetrics``.
        """
        started = self.current_status.started_at
        completed = self.current_status.completed_at
        if started and completed:
            try:
                t_start = datetime.fromisoformat(started.replace("Z", "+00:00"))
                t_end = datetime.fromisoformat(completed.replace("Z", "+00:00"))
                total_ms = int((t_end - t_start).total_seconds() * 1000)
                self._usage_tracker.set_total_duration(MAIN_SCOPE, max(0, total_ms))
            except (ValueError, TypeError):
                pass
        
        self.current_status.usage.CopyFrom(
            self._usage_tracker.build_usage_metrics(MAIN_SCOPE)
        )
        
        # Also finalize usage for all sub-agents
        for sa in self.current_status.sub_agent_executions:
            sa.usage.CopyFrom(self._usage_tracker.build_usage_metrics(sa.id))
    
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
        excluded_skill_names: list[str] | None = None,
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
            skill_names: Names of skills included in the system prompt.
            excluded_skill_names: Names of skills that were available but excluded
                                  by relevance filtering.  ``None`` means no
                                  filtering was applied.
        
        Note:
            Environment values are intentionally NOT captured for security reasons.
            Only keys are stored to enable debugging without exposing secrets.
        """
        # Build ResolvedExecutionContext proto
        resolved_context = ResolvedExecutionContext(
            environment_keys=sorted(environment_keys),  # Sorted for consistent ordering
            skill_names=sorted(skill_names),            # Sorted for consistent ordering
            excluded_skill_names=sorted(excluded_skill_names or []),
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
        
        excluded_count = len(excluded_skill_names) if excluded_skill_names else 0
        self.logger.info(
            f"[CONTEXT] execution={self.execution_id} "
            f"env_keys={len(environment_keys)} "
            f"mcp_servers={len(mcp_servers)} (resolved={resolved_count}, failed={failed_count}) "
            f"skills={len(skill_names)} "
            f"excluded_skills={excluded_count}"
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
        
        Records the summarization event, syncs context info to the status
        proto for immediate gRPC delivery, and sets force_next_update so
        the event loop pushes the update without waiting for the scheduler.
        
        Args:
            event: Immutable data object containing summarization metrics.
        """
        if self._context_info is None:
            self.logger.warning(
                f"[CONTEXT] execution={self.execution_id} "
                "on_summarization_complete called but context_info not initialized"
            )
            return
        
        try:
            proto_source = SummarizationSource.Value(event.source)
        except ValueError:
            proto_source = SummarizationSource.SUMMARIZATION_SOURCE_UNSPECIFIED

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
            source=proto_source,  # type: ignore[arg-type]
            summarization_input_tokens=event.summarization_input_tokens,
            summarization_output_tokens=event.summarization_output_tokens,
            summarization_cost_usd=event.summarization_cost_usd,
        )
        self._context_info.summarization_events.append(proto_event)
        
        # Record summarization cost in UsageTracker so it flows into
        # the total estimated_cost_usd.
        self._usage_tracker.record_summarization(event, MAIN_SCOPE)
        
        self._context_info.current_token_count = event.tokens_after
        self._update_utilization()
        self._sync_context_info()
        self.force_next_update = True
        
        # Update the usage proto progressively to reflect the new cost
        self.current_status.usage.CopyFrom(
            self._usage_tracker.build_usage_metrics(MAIN_SCOPE)
        )
        
        self.logger.info(
            f"[CONTEXT] execution={self.execution_id} "
            f"summarization completed (source={event.source}): "
            f"{event.tokens_before} -> {event.tokens_after} tokens "
            f"({event.compression_ratio * 100:.1f}% reduction), "
            f"duration={event.duration_ms}ms, "
            f"model={event.summarization_model}, "
            f"summarization_cost=${event.summarization_cost_usd:.6f}"
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
    
    def _sync_context_info(self) -> None:
        """Copy the working ``_context_info`` to ``current_status``.

        Safe to call at any time — ``_context_info.summarization_events``
        is the single source of truth, so repeated calls never duplicate.
        """
        if self._context_info is not None:
            self.current_status.context_info.CopyFrom(self._context_info)

    def finalize_context_info(self) -> None:
        """
        Finalize context info and copy to status proto.
        
        Called at the end of execution to copy accumulated context info,
        summarization events, and execution outputs to the status proto.
        """
        if self._context_info is not None:
            self._sync_context_info()
            
            summarization_count = len(
                self._context_info.summarization_events,
            )
            self.logger.info(
                f"[CONTEXT] execution={self.execution_id} "
                f"context_info finalized: "
                f"final_tokens={self._context_info.current_token_count}, "
                f"utilization={self._context_info.utilization_percent:.1f}%, "
                f"summarizations={summarization_count}"
            )
        
        # Reconcile artifacts: inline publishing already syncs each artifact
        # to current_status.artifacts via add_artifact().  Only append any
        # that were missed (e.g. added by the post-stream safety net after
        # inline publish but before this finalizer ran).
        already_synced = {a.sandbox_path for a in self.current_status.artifacts}
        newly_synced = 0
        for artifact in self._artifacts:
            if artifact.sandbox_path not in already_synced:
                self.current_status.artifacts.append(artifact)
                newly_synced += 1

        if self._artifacts:
            self.logger.info(
                f"[ARTIFACTS] execution={self.execution_id} "
                f"finalized {len(self._artifacts)} artifact(s) "
                f"({newly_synced} newly synced, "
                f"{len(self._artifacts) - newly_synced} already live)"
            )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Execution Artifacts (Artifact Lifecycle)
    #
    # These methods track artifacts published by the agent via the publish_artifact tool.
    # Artifacts are accumulated during execution and added to the final status.
    # ─────────────────────────────────────────────────────────────────────────────
    
    def add_artifact(self, artifact: ExecutionArtifact) -> None:
        """Add a published artifact and make it immediately visible in
        ``current_status`` so the next progressive gRPC update carries it
        to the UI.

        Deduplicates by ``sandbox_path``: if an artifact with the same
        path already exists (e.g. the agent overwrote a file), the older
        entry is replaced in both the internal tracking list and the live
        status proto.
        """
        existing_paths = {a.sandbox_path for a in self._artifacts}
        if artifact.sandbox_path in existing_paths:
            self._artifacts = [
                a for a in self._artifacts
                if a.sandbox_path != artifact.sandbox_path
            ]
        self._artifacts.append(artifact)

        self._sync_artifact_to_status(artifact)
        self.force_next_update = True

        self.logger.info(
            f"[ARTIFACT] execution={self.execution_id} "
            f"name={artifact.name} "
            f"size={artifact.size_bytes} bytes "
            f"path={artifact.sandbox_path}"
        )

    def _sync_artifact_to_status(self, artifact: ExecutionArtifact) -> None:
        """Upsert *artifact* into ``current_status.artifacts`` by
        ``sandbox_path``, preserving insertion order."""
        status_artifacts = self.current_status.artifacts
        for idx, existing in enumerate(status_artifacts):
            if existing.sandbox_path == artifact.sandbox_path:
                status_artifacts[idx].CopyFrom(artifact)
                return
        status_artifacts.append(artifact)

    # ─────────────────────────────────────────────────────────────────────────────
    # Workspace Write-Backs (Platform-Owned Git Workflow)
    # ─────────────────────────────────────────────────────────────────────────────

    def add_workspace_write_back(self, wb) -> None:
        """Register a write-back outcome on the execution status.

        Deduplicates by ``workspace_entry_name``: if a write-back for the
        same entry already exists, it is replaced.
        """
        wbs = self.current_status.workspace_write_backs
        for idx, existing in enumerate(wbs):
            if existing.workspace_entry_name == wb.workspace_entry_name:
                wbs[idx].CopyFrom(wb)
                self.force_next_update = True
                return
        wbs.append(wb)
        self.force_next_update = True

        self.logger.info(
            f"[WRITE_BACK] execution={self.execution_id} "
            f"entry={wb.workspace_entry_name} "
            f"phase={wb.phase}"
        )
    