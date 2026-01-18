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
        for message in reversed(self.current_status.messages):
            if message.type == MessageType.MESSAGE_AI:
                ai_message = message
                break
        
        if not ai_message:
            ai_message = AgentMessage(
                type=MessageType.MESSAGE_AI,
                content=token,
                timestamp=datetime.utcnow().isoformat(),
            )
            self.current_status.messages.append(ai_message)
        else:
            ai_message.content += token
    
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
            "pending": TodoStatus.TODO_STATUS_PENDING,
            "in_progress": TodoStatus.TODO_STATUS_IN_PROGRESS,
            "completed": TodoStatus.TODO_STATUS_COMPLETED,
            "cancelled": TodoStatus.TODO_STATUS_CANCELLED,
        }
        
        for todo_dict in todos_data:
            todo_id = todo_dict.get("id", "")
            if not todo_id:
                continue
            
            status_str = todo_dict.get("status", "pending").lower()
            status_enum = status_map.get(status_str, TodoStatus.TODO_STATUS_PENDING)
            
            todo_item = TodoItem(
                id=todo_id,
                content=todo_dict.get("content", ""),
                status=status_enum,
                created_at=todo_dict.get("created_at", datetime.utcnow().isoformat()),
                updated_at=datetime.utcnow().isoformat(),
            )
            
            self.current_status.todos[todo_id].CopyFrom(todo_item)
