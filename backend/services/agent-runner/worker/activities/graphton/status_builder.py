"""
Build execution status locally from astream_events.

This module builds status entirely in-memory during agent execution.
Status is returned to the Temporal workflow, which orchestrates persistence
via Java activity (polyglot pattern).
"""

import logging
import json
import hashlib
from typing import Dict, Any
from datetime import datetime

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    AgentMessage, 
    ToolCall, 
    ComponentMetadata, 
    SubAgentExecution,
    TodoItem
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
        
        # Track accumulated token usage across all LLM calls in this execution
        self._total_prompt_tokens: int = 0
        self._total_completion_tokens: int = 0
    
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
        
        # Create tool call
        args_struct = Struct()
        if tool_args:
            args_struct.update(tool_args)
        
        tool_call = ToolCall(
            id=run_id,
            name=tool_name,
            args=args_struct,
            result="",
            status=ToolCallStatus.TOOL_CALL_PENDING,
            component_metadata=component_metadata,
            started_at=datetime.utcnow().isoformat(),
        )
        
        # Add to local status (both messages and tool_calls)
        tool_message = AgentMessage(
            type=MessageType.MESSAGE_TOOL,
            content="",
            timestamp=datetime.utcnow().isoformat(),
        )
        tool_message.tool_calls.append(tool_call)
        
        self.current_status.messages.append(tool_message)
        self.current_status.tool_calls.append(tool_call)
        
        self.logger.debug(f"Tool '{tool_name}' added to local status")
    
    def _handle_tool_end_event(self, event: Dict[str, Any], namespace: str = "") -> None:
        """Handle on_tool_end event - updates local status."""
        tool_name = event.get("name", "")
        run_id = event.get("run_id", "")
        tool_result_raw = event.get("data", {}).get("output", "")
        
        if not run_id or tool_name in PLANNING_TOOLS:
            return
        
        tool_result_content = self._extract_tool_result_content(tool_result_raw)
        
        # Update in messages list
        for message in self.current_status.messages:
            if (message.type == MessageType.MESSAGE_TOOL and 
                len(message.tool_calls) > 0 and 
                message.tool_calls[0].id == run_id):
                
                tc = message.tool_calls[0]
                tc.result = tool_result_content
                tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
                tc.completed_at = datetime.utcnow().isoformat()
                break
        
        # Update in tool_calls list
        for tool_call in self.current_status.tool_calls:
            if tool_call.id == run_id:
                tool_call.result = tool_result_content
                tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
                tool_call.completed_at = datetime.utcnow().isoformat()
                break
        
        self.logger.debug(f"Tool '{tool_name}' completed in local status")
    
    def _handle_chat_model_stream_event(self, event: Dict[str, Any], namespace: str = "") -> None:
        """Handle on_chat_model_stream event - updates local status."""
        chunk_data = event.get("data", {}).get("chunk", {})
        
        if not chunk_data:
            return
        
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
        
        # Find or create AI message
        ai_message = None
        ai_message_index = None
        for idx in range(len(self.current_status.messages) - 1, -1, -1):
            message = self.current_status.messages[idx]
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
            self.current_status.messages.append(ai_message)
            
            # Track start time using message index
            new_message_index = len(self.current_status.messages) - 1
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
        
        # Find the most recent AI message to finalize
        ai_message_index = None
        for idx in range(len(self.current_status.messages) - 1, -1, -1):
            message = self.current_status.messages[idx]
            if message.type == MessageType.MESSAGE_AI:
                ai_message_index = idx
                break
        
        if ai_message_index is None:
            self.logger.warning("on_chat_model_end received but no AI message found to finalize")
            return
        
        # Calculate generation duration if we tracked the start time
        generation_duration_ms = None
        if ai_message_index in self._message_start_times:
            start_time = self._message_start_times[ai_message_index]
            duration = datetime.utcnow() - start_time
            generation_duration_ms = int(duration.total_seconds() * 1000)
            
            # Clean up the start time entry
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
        
        # Accumulate token counts for this execution
        self._total_prompt_tokens += prompt_tokens
        self._total_completion_tokens += completion_tokens
        
        # ─────────────────────────────────────────────────────────────────────────
        # Finalize AI message streaming state fields (Phase 2.1)
        # ─────────────────────────────────────────────────────────────────────────
        ai_message = self.current_status.messages[ai_message_index]
        
        # Mark streaming complete - UI can now show final content
        ai_message.is_streaming = False
        
        # Set per-message token count (this message's tokens, not cumulative)
        ai_message.token_count = prompt_tokens + completion_tokens
        
        # Set generation duration if we tracked the start time
        if generation_duration_ms is not None:
            ai_message.generation_duration_ms = generation_duration_ms
        
        # Log the metrics (structured logging for observability)
        # This prepares for Phase 2.4 (UsageMetrics proto) - for now we log for visibility
        self.logger.info(
            f"[USAGE] execution={self.execution_id} "
            f"prompt_tokens={prompt_tokens} "
            f"completion_tokens={completion_tokens} "
            f"total_tokens={total_tokens} "
            f"duration_ms={generation_duration_ms or 'N/A'} "
            f"model={model_name or 'unknown'} "
            f"cumulative_prompt={self._total_prompt_tokens} "
            f"cumulative_completion={self._total_completion_tokens}"
        )
        
        self.logger.debug(
            f"AI message finalized at index {ai_message_index} "
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
