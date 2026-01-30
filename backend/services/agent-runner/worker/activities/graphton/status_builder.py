"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import logging
import json
import hashlib
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    AgentMessage, 
    ToolCall, 
    ComponentMetadata, 
    SubAgentExecution,
    TodoItem,
    UsageMetrics,
    ResolvedExecutionContext,
    McpServerResolutionStatus,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionPhase, 
    MessageType, 
    ToolCallStatus,
    SubAgentStatus,
    TodoStatus
)
from google.protobuf.struct_pb2 import Struct
from worker.component_type_inference import infer_component_type
from worker.command_parser import format_execute_tool_name


# Planning tools that update execution state without UI display
PLANNING_TOOLS = {
    'write_todos',
}


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
    
    def __init__(self, execution_id: str, initial_status: Any):
        """
        Initialize status builder.
        
        Args:
            execution_id: The execution ID
            initial_status: Initial AgentExecutionStatus proto
        """
        self.execution_id = execution_id
        self.current_status = initial_status
        self.logger = logging.getLogger(__name__)
        
        # Track tool calls for deduplication
        self.tool_call_fingerprints: set = set()
        
        # Namespace mapping for sub-agent tool call routing
        self.namespace_mapping: Dict[str, Dict[str, str]] = {}
        
        # Track AI message generation timing for duration calculation
        # Key: message index in messages list, Value: start timestamp
        self._message_start_times: Dict[int, datetime] = {}
        
        # Track tool execution timing for duration calculation (Phase 2.2)
        # Key: run_id, Value: start timestamp
        self._tool_start_times: Dict[str, datetime] = {}
        
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
        self._active_sub_agents: Dict[str, SubAgentExecution] = {}
        
        # Map namespace to sub-agent run_id for event routing
        # Key: namespace string, Value: sub-agent run_id
        self._namespace_to_sub_agent_id: Dict[str, str] = {}
        
        # Track AI message generation timing within sub-agents (separate from main)
        # Key: (sub_agent_id, message_index), Value: start timestamp
        self._sub_agent_message_start_times: Dict[Tuple[str, int], datetime] = {}
        
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
        self._sub_agent_llm_call_count: Dict[str, int] = {}
        self._sub_agent_prompt_tokens: Dict[str, int] = {}
        self._sub_agent_completion_tokens: Dict[str, int] = {}
        self._sub_agent_primary_model: Dict[str, str] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> None:
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
        
        # Route by event type
        if event_type == "on_tool_start":
            self._handle_tool_start_event(event, namespace)
        elif event_type == "on_tool_end":
            self._handle_tool_end_event(event, namespace)
        elif event_type == "on_chat_model_stream":
            self._handle_chat_model_stream_event(event, namespace)
        elif event_type == "on_chat_model_end":
            self._handle_chat_model_end_event(event, namespace)
    
    def _handle_tool_start_event(self, event: Dict[str, Any], namespace: str = "") -> None:
        """Handle on_tool_start event - updates local status."""
        tool_name = event.get("name", "")
        tool_args_raw = event.get("data", {}).get("input", {})
        run_id = event.get("run_id", "")
        
        if not tool_name or not run_id:
            return
        
        tool_args = self._unwrap_tool_args(tool_args_raw)
        
        # Check for duplicate
        fingerprint = self._get_tool_fingerprint(tool_name, tool_args)
        if fingerprint in self.tool_call_fingerprints:
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
        
        # Transform tool name
        display_name = tool_name
        if tool_name.startswith("execute") or tool_name == "Shell":
            command = tool_args.get("command", "")
            if command:
                display_name = format_execute_tool_name(command)
        
        # Create component metadata
        component_type = infer_component_type(tool_name)
        component_metadata = ComponentMetadata(
            component_type=component_type,
            component_group="main-agent-tools",
        )
        
        # Create tool call with RUNNING status (Phase 2.2)
        # In LangGraph, on_tool_start fires when execution begins, not when queued
        args_struct = Struct()
        if tool_args:
            args_struct.update(tool_args)
        
        now = datetime.utcnow()
        tool_call = ToolCall(
            id=run_id,
            name=tool_name,
            args=args_struct,
            result="",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            component_metadata=component_metadata,
            started_at=now.isoformat(),
        )
        
        # Track start time for duration calculation
        self._tool_start_times[run_id] = now
        
        # Create tool message wrapper
        tool_message = AgentMessage(
            type=MessageType.MESSAGE_TOOL,
            content="",
            timestamp=now.isoformat(),
        )
        tool_message.tool_calls.append(tool_call)
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Route to correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        
        if sub_agent:
            # Route to sub-agent's nested lists
            sub_agent.tool_calls.append(tool_call)
            sub_agent.messages.append(tool_message)
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} sub_agent={sub_agent.id} "
                f"tool={tool_name} run_id={run_id} status=RUNNING"
            )
        else:
            # Route to main agent status
            self.current_status.messages.append(tool_message)
            self.current_status.tool_calls.append(tool_call)
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} "
                f"tool={tool_name} run_id={run_id} status=RUNNING"
            )
    
    def _handle_tool_end_event(self, event: Dict[str, Any], namespace: str = "") -> None:
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
                    message.tool_calls[0].id == run_id):
                    
                    tc = message.tool_calls[0]
                    tc.result = tool_result_content
                    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tc.completed_at = now.isoformat()
                    break
            
            # Update in sub-agent's tool_calls list
            for tool_call in sub_agent.tool_calls:
                if tool_call.id == run_id:
                    tool_call.result = tool_result_content
                    tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tool_call.completed_at = now.isoformat()
                    break
            
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} sub_agent={sub_agent.id} "
                f"tool={tool_name} run_id={run_id} status=COMPLETED "
                f"duration_ms={duration_ms or 'N/A'}"
            )
        else:
            # Update in main agent's messages list
            for message in self.current_status.messages:
                if (message.type == MessageType.MESSAGE_TOOL and 
                    len(message.tool_calls) > 0 and 
                    message.tool_calls[0].id == run_id):
                    
                    tc = message.tool_calls[0]
                    tc.result = tool_result_content
                    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tc.completed_at = now.isoformat()
                    break
            
            # Update in main agent's tool_calls list
            for tool_call in self.current_status.tool_calls:
                if tool_call.id == run_id:
                    tool_call.result = tool_result_content
                    tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                    tool_call.completed_at = now.isoformat()
                    break
            
            self.logger.debug(
                f"[TOOL] execution={self.execution_id} "
                f"tool={tool_name} run_id={run_id} status=COMPLETED "
                f"duration_ms={duration_ms or 'N/A'}"
            )
    
    def _handle_chat_model_stream_event(self, event: Dict[str, Any], namespace: str = "") -> None:
        """Handle on_chat_model_stream event - updates local status."""
        chunk_data = event.get("data", {}).get("chunk", {})
        
        if not chunk_data:
            return
        
        # Try to register namespace for event routing
        if namespace:
            self._register_sub_agent_namespace(namespace)
        
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
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Route to correct execution context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        
        # Get the appropriate messages list
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages
        
        # Find or create AI message in the correct context
        ai_message = None
        ai_message_index = None
        for idx in range(len(messages_list) - 1, -1, -1):
            message = messages_list[idx]
            if message.type == MessageType.MESSAGE_AI:
                ai_message = message
                ai_message_index = idx
                break
        
        if not ai_message:
            # Create new AI message and record start time for duration tracking
            now = datetime.utcnow()
            ai_message = AgentMessage(
                type=MessageType.MESSAGE_AI,
                content=token,
                timestamp=now.isoformat(),
                is_streaming=True,  # Mark as actively streaming (finalized in on_chat_model_end)
            )
            messages_list.append(ai_message)
            
            # Track start time using appropriate key
            new_message_index = len(messages_list) - 1
            if sub_agent:
                # Use tuple key for sub-agent messages
                self._sub_agent_message_start_times[(sub_agent.id, new_message_index)] = now
                self.logger.debug(f"Started new AI message in sub_agent={sub_agent.id} at index {new_message_index}")
            else:
                self._message_start_times[new_message_index] = now
                self.logger.debug(f"Started new AI message at index {new_message_index}")
        else:
            ai_message.content += token
    
    def _handle_chat_model_end_event(self, event: Dict[str, Any], namespace: str = "") -> None:
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
        
        # ─────────────────────────────────────────────────────────────────────
        # Namespace-Based Routing (Phase 2.3): Find message in correct context
        # ─────────────────────────────────────────────────────────────────────
        context, sub_agent = self._get_execution_context(namespace)
        messages_list = sub_agent.messages if sub_agent else self.current_status.messages
        
        # Find the most recent AI message to finalize
        ai_message_index = None
        for idx in range(len(messages_list) - 1, -1, -1):
            message = messages_list[idx]
            if message.type == MessageType.MESSAGE_AI:
                ai_message_index = idx
                break
        
        if ai_message_index is None:
            context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
            self.logger.warning(f"on_chat_model_end received but no AI message found to finalize ({context_desc})")
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
    def _unwrap_tool_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Unwrap LangGraph arg wrappers."""
        if "kwargs" in args and isinstance(args["kwargs"], dict):
            return args["kwargs"]
        if "input" in args and isinstance(args["input"], dict) and len(args) == 1:
            return args["input"]
        return args
    
    def _get_tool_fingerprint(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Create fingerprint for deduplication."""
        fingerprint_data = f"{tool_name}:{json.dumps(tool_args, sort_keys=True)}"
        return hashlib.sha256(fingerprint_data.encode()).hexdigest()
    
    def _extract_tool_result_content(self, result: Any) -> str:
        """Extract content from tool result."""
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            if "output" in result:
                return result.get("output", "")
            if "content" in result:
                return str(result["content"])
            return json.dumps(result, indent=2)
        return str(result)
    
    def _extract_string_content(self, content_blocks: list) -> str:
        """Extract text from multimodal content blocks."""
        text_parts = []
        for block in content_blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        return "".join(text_parts)
    
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
                created_at=todo_dict.get("created_at", datetime.utcnow().isoformat()),
                updated_at=datetime.utcnow().isoformat(),
            )
            
            self.current_status.todos[todo_id].CopyFrom(todo_item)
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Sub-Agent Namespace Routing (Phase 2.3)
    # ─────────────────────────────────────────────────────────────────────────────
    
    def _get_execution_context(self, namespace: str) -> Tuple[Any, Optional[SubAgentExecution]]:
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
        
        # Namespace not yet registered - fall back to main agent
        return self.current_status, None
    
    def _register_sub_agent_namespace(self, namespace: str) -> None:
        """
        Register namespace -> sub-agent mapping when child event arrives.
        
        LangGraph namespaces contain the run_id of the sub-agent that spawned them.
        Format: "node_id:uuid" where uuid matches or contains the task tool run_id.
        
        This method is called for each event with a non-empty namespace to
        discover and register the namespace -> sub-agent mapping.
        
        Args:
            namespace: LangGraph checkpoint namespace string
        """
        if not namespace or namespace in self._namespace_to_sub_agent_id:
            return
        
        # Check if this namespace matches any active sub-agent
        # Namespace format is typically "node_name:run_id" or contains run_id
        for sub_agent_id in self._active_sub_agents:
            if sub_agent_id in namespace:
                self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                self.logger.debug(
                    f"[SUBAGENT] Registered namespace={namespace} -> sub_agent={sub_agent_id}"
                )
                return
    
    def _handle_sub_agent_start(self, event: Dict[str, Any], tool_args: Dict[str, Any], run_id: str) -> None:
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
            started_at=now.isoformat(),
        )
        
        # Track for namespace routing and lifecycle management
        self._active_sub_agents[run_id] = sub_agent
        self.current_status.sub_agent_executions.append(sub_agent)
        
        self.logger.debug(
            f"[SUBAGENT] execution={self.execution_id} "
            f"sub_agent={sub_agent_name} id={run_id} status=IN_PROGRESS"
        )
    
    def _handle_sub_agent_end(self, event: Dict[str, Any], run_id: str) -> None:
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
                sub_agent.completed_at = now.isoformat()
                
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
        environment_keys: List[str],
        mcp_servers: Dict[str, Tuple[bool, str, int]],
        skill_names: List[str],
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
