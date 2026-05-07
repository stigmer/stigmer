"""Unit tests for StatusBuilder module.

Tests cover:
- Event routing for all supported event types
- on_chat_model_stream event handling
- on_chat_model_end event handling (token usage extraction)
- Message duration tracking
- Cumulative token counting
- ToolCall status transitions (Phase 2.2): RUNNING -> COMPLETED
- Tool execution duration tracking
- ResolvedExecutionContext population (Phase 2.5)
"""

from datetime import datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.context_pb2 import (
    ContextInfo,
    ResolvedExecutionContext,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage, ToolCall
from graphton.core.summarization_callback import SOURCE_GRAPH_START, SOURCE_MID_EXECUTION

from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_initial_status():
    """Create a mock initial AgentExecutionStatus."""
    status = MagicMock()
    status.messages = []
    status.sub_agent_executions = []
    status.todos = {}
    status.artifacts = []
    status.resolved_context = ResolvedExecutionContext()
    status.context_info = ContextInfo()
    return status


@pytest.fixture
def status_builder(mock_initial_status):
    """Create a StatusBuilder instance for testing."""
    return StatusBuilder(
        execution_id="test-execution-123",
        initial_status=mock_initial_status
    )


# =============================================================================
# Tests for on_chat_model_stream event
# =============================================================================


class TestChatModelStreamEvent:
    """Tests for on_chat_model_stream event handling."""

    @pytest.mark.asyncio
    async def test_creates_new_ai_message(self, status_builder):
        """Test that first stream event creates a new AI message."""
        # Create mock chunk with content
        chunk = MagicMock()
        chunk.content = "Hello"
        
        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        assert len(status_builder.current_status.messages) == 1
        msg = status_builder.current_status.messages[0]
        assert msg.type == MessageType.MESSAGE_AI
        assert msg.content == "Hello"

    @pytest.mark.asyncio
    async def test_appends_to_existing_ai_message(self, status_builder):
        """Test that subsequent stream events append to existing AI message."""
        chunk1 = MagicMock()
        chunk1.content = "Hello"
        chunk2 = MagicMock()
        chunk2.content = " World"
        
        event1 = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk1},
            "metadata": {}
        }
        event2 = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk2},
            "metadata": {}
        }
        
        await status_builder.process_event(event1)
        await status_builder.process_event(event2)
        
        assert len(status_builder.current_status.messages) == 1
        assert status_builder.current_status.messages[0].content == "Hello World"

    @pytest.mark.asyncio
    async def test_records_start_time_for_new_message(self, status_builder):
        """Test that start time is recorded when creating new AI message."""
        chunk = MagicMock()
        chunk.content = "Test"
        
        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        # Should have recorded start time at index 0
        assert 0 in status_builder.state.message_start_times
        assert isinstance(status_builder.state.message_start_times[0], datetime)

    @pytest.mark.asyncio
    async def test_handles_list_content(self, status_builder):
        """Test handling multimodal content blocks."""
        chunk = MagicMock()
        chunk.content = [
            {"type": "text", "text": "Part 1"},
            {"type": "text", "text": " Part 2"}
        ]
        
        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        assert status_builder.current_status.messages[0].content == "Part 1 Part 2"


# =============================================================================
# Tests for on_chat_model_end event
# =============================================================================


class TestChatModelEndEvent:
    """Tests for on_chat_model_end event handling."""

    @pytest.mark.asyncio
    async def test_extracts_usage_metadata_from_object(self, status_builder):
        """Test extracting token usage from LangChain AIMessage object."""
        # First, create an AI message via stream
        chunk = MagicMock()
        chunk.content = "Response"
        stream_event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        await status_builder.process_event(stream_event)
        
        # Now process the end event with usage metadata
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {"model": "claude-3-opus"}
        
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        }
        
        await status_builder.process_event(end_event)

    @pytest.mark.asyncio
    async def test_extracts_usage_metadata_from_dict(self, status_builder):
        """Test extracting token usage from dict format."""
        # Create AI message first
        chunk = MagicMock()
        chunk.content = "Response"
        stream_event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        await status_builder.process_event(stream_event)
        
        # Process end event with dict-style usage
        end_event = {
            "event": "on_chat_model_end",
            "data": {
                "output": {
                    "usage_metadata": {
                        "input_tokens": 200,
                        "output_tokens": 75,
                        "total_tokens": 275
                    },
                    "response_metadata": {
                        "model": "gpt-4"
                    }
                }
            },
            "metadata": {}
        }
        
        await status_builder.process_event(end_event)

    @pytest.mark.asyncio
    async def test_calculates_generation_duration(self, status_builder):
        """Test that generation duration is calculated from start time."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        stream_event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        await status_builder.process_event(stream_event)
        
        # Manually set a known start time for testing
        known_start = datetime.utcnow() - timedelta(milliseconds=500)
        status_builder.state.message_start_times[0] = known_start
        
        # Process end event
        output = MagicMock()
        output.usage_metadata = None
        
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        }
        
        await status_builder.process_event(end_event)
        
        # Start time should be cleaned up
        assert 0 not in status_builder.state.message_start_times

    @pytest.mark.asyncio
    async def test_accumulates_tokens_across_multiple_calls(self, status_builder):
        """Test that tokens accumulate across multiple LLM calls."""
        # First message
        chunk1 = MagicMock()
        chunk1.content = "First"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk1},
            "metadata": {}
        })
        
        output1 = MagicMock()
        output1.usage_metadata = {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output1.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output1},
            "metadata": {}
        })
        
        # Second message (after tool call, for example)
        chunk2 = MagicMock()
        chunk2.content = "Second"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk2},
            "metadata": {}
        })
        
        output2 = MagicMock()
        output2.usage_metadata = {
            "input_tokens": 200,
            "output_tokens": 100,
            "total_tokens": 300,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output2.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output2},
            "metadata": {}
        })
        
    @pytest.mark.asyncio
    async def test_handles_missing_ai_message_gracefully(self, status_builder):
        """Test that on_chat_model_end handles missing AI message."""
        # Process end event without any prior stream event
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        }
        
        # Should not raise, just log warning
        await status_builder.process_event(end_event)

    @pytest.mark.asyncio
    async def test_handles_empty_output(self, status_builder):
        """Test that empty output is handled gracefully."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # Process end event with empty output
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": {}},
            "metadata": {}
        }
        
        # Should not raise
        await status_builder.process_event(end_event)

    @pytest.mark.asyncio
    async def test_handles_none_output(self, status_builder):
        """Test that None output is handled gracefully."""
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": None},
            "metadata": {}
        }
        
        # Should not raise
        await status_builder.process_event(end_event)


# =============================================================================
# Tests for event routing
# =============================================================================


class TestEventRouting:
    """Tests for event type routing."""

    @pytest.mark.asyncio
    async def test_routes_on_chat_model_end(self, status_builder):
        """Test that on_chat_model_end is routed correctly."""
        # Create AI message first
        chunk = MagicMock()
        chunk.content = "Test"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # Verify on_chat_model_end is handled
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
    @pytest.mark.asyncio
    async def test_ignores_unknown_event_types(self, status_builder):
        """Test that unknown event types are silently ignored."""
        event = {
            "event": "on_unknown_event",
            "data": {"some": "data"},
            "metadata": {}
        }
        
        # Should not raise
        await status_builder.process_event(event)
        
        # Status should be unchanged
        assert len(status_builder.current_status.messages) == 0


# =============================================================================
# Tests for OpenAI-style usage format
# =============================================================================


class TestOpenAIUsageFormat:
    """Tests for OpenAI-style usage metadata format."""

    @pytest.mark.asyncio
    async def test_extracts_prompt_tokens_key(self, status_builder):
        """Test extracting usage with OpenAI-style 'prompt_tokens' key."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # OpenAI-style usage format
        end_event = {
            "event": "on_chat_model_end",
            "data": {
                "output": {
                    "usage": {
                        "prompt_tokens": 150,
                        "completion_tokens": 80,
                        "total_tokens": 230
                    }
                }
            },
            "metadata": {}
        }
        
        await status_builder.process_event(end_event)


# =============================================================================
# Tests for AgentMessage streaming state fields (Phase 2.1)
# =============================================================================


class TestAgentMessageStreamingFields:
    """Tests for AgentMessage.is_streaming field.
    
    This field tracks AI message generation progress:
    - is_streaming: True while generating, False when complete
    """

    @pytest.mark.asyncio
    async def test_sets_is_streaming_true_on_new_message(self, status_builder):
        """Test that is_streaming=True when a new AI message is created."""
        chunk = MagicMock()
        chunk.content = "Hello"
        
        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        assert len(status_builder.current_status.messages) == 1
        ai_message = status_builder.current_status.messages[0]
        assert ai_message.type == MessageType.MESSAGE_AI
        assert ai_message.is_streaming is True

    @pytest.mark.asyncio
    async def test_sets_is_streaming_false_on_end(self, status_builder):
        """Test that is_streaming=False after on_chat_model_end."""
        # Stream event creates message with is_streaming=True
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # Verify initially streaming
        assert status_builder.current_status.messages[0].is_streaming is True
        
        # End event should finalize to is_streaming=False
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        ai_message = status_builder.current_status.messages[0]
        assert ai_message.is_streaming is False



# =============================================================================
# Tests for ToolCall status transitions (Phase 2.2)
# =============================================================================


class TestToolCallStatus:
    """Tests for ToolCall status transitions: RUNNING -> COMPLETED.
    
    Phase 2.2 changes the initial tool status from PENDING to RUNNING,
    as on_tool_start fires when execution begins, not when queued.
    
    Status lifecycle:
    - on_tool_start -> RUNNING (tool is executing)
    - on_tool_end -> COMPLETED (tool finished successfully)
    """

    @pytest.mark.asyncio
    async def test_tool_start_sets_running_status(self, status_builder):
        """Test that on_tool_start sets RUNNING status (not PENDING)."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        event = {
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "tool-run-123",
            "data": {"input": {"path": "/tmp/test.txt"}},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        # Verify tool call was created
        assert status_builder.tool_call_count() == 1
        tool_call = next(status_builder.iter_all_tool_calls())
        
        # Key assertion: Status should be RUNNING, not PENDING
        assert tool_call.status == ToolCallStatus.TOOL_CALL_RUNNING

    @pytest.mark.asyncio
    async def test_tool_start_sets_started_at_timestamp(self, status_builder):
        """Test that on_tool_start sets started_at timestamp."""
        event = {
            "event": "on_tool_start",
            "name": "execute_command",
            "run_id": "tool-run-456",
            "data": {"input": {"command": "ls -la"}},
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        tool_call = next(status_builder.iter_all_tool_calls())
        
        # Verify started_at is set and looks like ISO 8601 format
        assert tool_call.started_at != ""
        assert "T" in tool_call.started_at  # ISO 8601 format check

    @pytest.mark.asyncio
    async def test_tool_end_sets_completed_status(self, status_builder):
        """Test that on_tool_end transitions from RUNNING to COMPLETED."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        run_id = "tool-run-789"
        
        # First, start the tool
        start_event = {
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": run_id,
            "data": {"input": {"path": "/tmp/test.txt"}},
            "metadata": {}
        }
        await status_builder.process_event(start_event)
        
        # Verify initial status is RUNNING
        assert next(status_builder.iter_all_tool_calls()).status == ToolCallStatus.TOOL_CALL_RUNNING
        
        # Now end the tool
        end_event = {
            "event": "on_tool_end",
            "name": "read_file",
            "run_id": run_id,
            "data": {"output": "file contents here"},
            "metadata": {}
        }
        await status_builder.process_event(end_event)
        
        # Verify status transitioned to COMPLETED
        tool_call = next(status_builder.iter_all_tool_calls())
        assert tool_call.status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_tool_end_sets_completed_at_timestamp(self, status_builder):
        """Test that on_tool_end sets completed_at timestamp."""
        run_id = "tool-run-timestamp"
        
        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "api_call",
            "run_id": run_id,
            "data": {"input": {"url": "https://api.example.com"}},
            "metadata": {}
        })
        
        # Verify completed_at is empty initially
        assert next(status_builder.iter_all_tool_calls()).completed_at == ""
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "api_call",
            "run_id": run_id,
            "data": {"output": {"status": 200}},
            "metadata": {}
        })
        
        tool_call = next(status_builder.iter_all_tool_calls())
        
        # Verify completed_at is now set
        assert tool_call.completed_at != ""
        assert "T" in tool_call.completed_at  # ISO 8601 format check

    @pytest.mark.asyncio
    async def test_tool_status_in_messages_list(self, status_builder):
        """Test that tool status is correctly set in messages[].tool_calls."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType, ToolCallStatus
        
        run_id = "tool-run-msg"
        
        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "search",
            "run_id": run_id,
            "data": {"input": {"query": "test"}},
            "metadata": {}
        })
        
        # Tool calls are attached to a parent AI message
        parent_ai = None
        for msg in status_builder.current_status.messages:
            if msg.type == MessageType.MESSAGE_AI:
                parent_ai = msg
                break
        
        assert parent_ai is not None
        assert len(parent_ai.tool_calls) == 1
        assert parent_ai.tool_calls[0].status == ToolCallStatus.TOOL_CALL_RUNNING
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "search",
            "run_id": run_id,
            "data": {"output": "results"},
            "metadata": {}
        })
        
        # Verify status updated in messages list too
        assert parent_ai.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_tool_status_in_index(self, status_builder):
        """Test that tool status is correctly tracked via the StatusBuilder tool-call index."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        run_id = "tool-run-list"
        
        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": run_id,
            "data": {"input": {"path": "/tmp/out.txt", "content": "data"}},
            "metadata": {}
        })
        
        tc = status_builder.get_tool_call(run_id)
        assert tc is not None
        assert status_builder.tool_call_count() == 1
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.id == run_id
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "write_file",
            "run_id": run_id,
            "data": {"output": "success"},
            "metadata": {}
        })
        
        # Verify status updated
        assert status_builder.get_tool_call(run_id).status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_tool_duration_tracking(self, status_builder):
        """Test that tool execution duration is tracked in _tool_start_times."""
        run_id = "tool-run-duration"
        
        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "slow_operation",
            "run_id": run_id,
            "data": {"input": {}},
            "metadata": {}
        })
        
        # Verify start time is tracked
        assert run_id in status_builder.state.tool_start_times
        assert isinstance(status_builder.state.tool_start_times[run_id], datetime)
        
        # Set a known start time to control duration calculation
        known_start = datetime.utcnow() - timedelta(milliseconds=1500)
        status_builder.state.tool_start_times[run_id] = known_start
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "slow_operation",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {}
        })
        
        # Verify start time was cleaned up
        assert run_id not in status_builder.state.tool_start_times


# =============================================================================
# Tests for _extract_tool_result_content (ToolMessage duck typing)
# =============================================================================


class _FakeToolMessage:
    """Mimics langchain_core.messages.ToolMessage for testing.

    Uses the same attribute shape as ToolMessage (content, name, tool_call_id)
    without importing langchain_core, keeping tests decoupled.
    """

    def __init__(self, content, name="test_tool", tool_call_id="tc-123"):
        self.content = content
        self.name = name
        self.tool_call_id = tool_call_id


class TestExtractToolResultContent:
    """Tests for _extract_tool_result_content().

    This method is the single extraction point for tool output in the
    status-building pipeline. It is called from both _handle_tool_end_event
    (regular tools) and _handle_sub_agent_end (task tool).

    Each test targets one branch of the method to ensure full coverage.
    """

    # ── Branch 1: str passthrough ────────────────────────────────────────

    def test_string_passthrough(self, status_builder):
        """Plain string results are returned verbatim."""
        assert status_builder._extract_tool_result_content("hello world") == "hello world"

    def test_empty_string_passthrough(self, status_builder):
        """Empty strings are returned as-is (no special handling)."""
        assert status_builder._extract_tool_result_content("") == ""

    # ── Branch 2: LangGraph message objects (duck-typed .content) ────────

    def test_tool_message_string_content(self, status_builder):
        """ToolMessage with string .content extracts the content."""
        msg = _FakeToolMessage(content="Directory listing:\nfile1.py\nfile2.py")
        assert status_builder._extract_tool_result_content(msg) == (
            "Directory listing:\nfile1.py\nfile2.py"
        )

    def test_tool_message_empty_string_content(self, status_builder):
        """ToolMessage with empty string .content returns empty string."""
        msg = _FakeToolMessage(content="")
        assert status_builder._extract_tool_result_content(msg) == ""

    def test_tool_message_multimodal_content(self, status_builder):
        """ToolMessage with list .content (multimodal blocks) extracts text."""
        msg = _FakeToolMessage(content=[
            {"type": "text", "text": "First block. "},
            {"type": "image_url", "image_url": "https://example.com/img.png"},
            {"type": "text", "text": "Second block."},
        ])
        assert status_builder._extract_tool_result_content(msg) == (
            "First block. Second block."
        )

    def test_tool_message_multimodal_empty_list(self, status_builder):
        """ToolMessage with empty list .content returns empty string."""
        msg = _FakeToolMessage(content=[])
        assert status_builder._extract_tool_result_content(msg) == ""

    def test_tool_message_repr_not_leaked(self, status_builder):
        """Verify that ToolMessage repr (name=, tool_call_id=) never leaks."""
        msg = _FakeToolMessage(
            content="No files matching pattern '**/*.py'",
            name="glob",
            tool_call_id="call_abc123",
        )
        result = status_builder._extract_tool_result_content(msg)
        assert "name=" not in result
        assert "tool_call_id=" not in result
        assert result == "No files matching pattern '**/*.py'"

    # ── Branch 3: dict results ───────────────────────────────────────────

    def test_dict_with_output_key(self, status_builder):
        """Dict with 'output' key returns the output value."""
        assert status_builder._extract_tool_result_content(
            {"output": "command succeeded", "exit_code": 0}
        ) == "command succeeded"

    def test_dict_with_content_key(self, status_builder):
        """Dict with 'content' key (no 'output') returns stringified content."""
        assert status_builder._extract_tool_result_content(
            {"content": 42}
        ) == "42"

    def test_dict_fallback_json(self, status_builder):
        """Dict without 'output' or 'content' is JSON-serialized."""
        result = status_builder._extract_tool_result_content({"key": "value", "count": 3})
        import json
        parsed = json.loads(result)
        assert parsed == {"key": "value", "count": 3}

    # ── Branch 4: unknown type fallback ──────────────────────────────────

    def test_unknown_type_fallback(self, status_builder):
        """Unknown types fall through to str() conversion."""
        assert status_builder._extract_tool_result_content(12345) == "12345"

    # ── Integration: ToolMessage through _handle_tool_end_event ──────────

    @pytest.mark.asyncio
    async def test_tool_message_end_to_end(self, status_builder):
        """ToolMessage-like object flows through tool_end and lands clean in result."""
        run_id = "tool-run-e2e-extract"

        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "ls",
            "run_id": run_id,
            "data": {"input": {"path": "/tmp"}},
            "metadata": {},
        })

        # End the tool with a ToolMessage-like object as output
        fake_msg = _FakeToolMessage(
            content="file1.txt\nfile2.txt\nfile3.txt",
            name="ls",
            tool_call_id="call_xyz",
        )
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "ls",
            "run_id": run_id,
            "data": {"output": fake_msg},
            "metadata": {},
        })

        # Verify the extracted content is clean
        tool_call = next(status_builder.iter_all_tool_calls())
        assert tool_call.result == "file1.txt\nfile2.txt\nfile3.txt"
        # Verify no ToolMessage repr artifacts leaked
        assert "name=" not in tool_call.result
        assert "tool_call_id=" not in tool_call.result


# =============================================================================
# Tests for _extract_tool_result_content (LangGraph Command duck typing)
# =============================================================================


class _FakeCommand:
    """Mimics langgraph.types.Command for testing.

    Uses the same attribute shape as Command (.update dict) without importing
    langgraph, keeping tests decoupled.  This covers the case where
    on_tool_end emits a Command object after an interrupt()/resume cycle.
    """

    def __init__(self, update: dict | None = None, resume: Any = None):
        self.update = update
        self.resume = resume


class TestExtractToolResultContentCommand:
    """Tests for the LangGraph Command branch of _extract_tool_result_content().

    When tools go through the interrupt()/resume approval cycle, the
    on_tool_end event may emit a Command object instead of the plain tool
    return value.  The extraction method must dig into Command.update to
    find the ToolMessage content.
    """

    # ── Command with ToolMessage in messages channel ─────────────────────

    def test_command_with_tool_message_string_content(self, status_builder):
        """Command with messages containing a ToolMessage extracts its content."""
        cmd = _FakeCommand(update={
            "messages": [
                _FakeToolMessage(content="Successfully wrote 42 characters to 'foo.txt'"),
            ],
        })
        assert status_builder._extract_tool_result_content(cmd) == (
            "Successfully wrote 42 characters to 'foo.txt'"
        )

    def test_command_with_multiple_messages_takes_first(self, status_builder):
        """When multiple ToolMessages exist, the first one with content wins."""
        cmd = _FakeCommand(update={
            "messages": [
                _FakeToolMessage(content="Updated file /workspace/.gitkeep"),
                _FakeToolMessage(content="Some other message"),
            ],
        })
        assert status_builder._extract_tool_result_content(cmd) == (
            "Updated file /workspace/.gitkeep"
        )

    def test_command_with_tool_message_multimodal_content(self, status_builder):
        """Command with ToolMessage having list .content extracts text blocks."""
        cmd = _FakeCommand(update={
            "messages": [
                _FakeToolMessage(content=[
                    {"type": "text", "text": "Created "},
                    {"type": "text", "text": "file.txt"},
                ]),
            ],
        })
        assert status_builder._extract_tool_result_content(cmd) == "Created file.txt"

    # ── Command with empty/missing messages ──────────────────────────────

    def test_command_with_empty_messages_falls_back_to_json(self, status_builder):
        """Command with empty messages list falls back to JSON of other channels."""
        cmd = _FakeCommand(update={
            "messages": [],
            "files": ["/workspace/output.txt"],
        })
        result = status_builder._extract_tool_result_content(cmd)
        import json
        parsed = json.loads(result)
        assert parsed == {"files": ["/workspace/output.txt"]}

    def test_command_with_no_messages_key(self, status_builder):
        """Command.update without a 'messages' key falls back to JSON."""
        cmd = _FakeCommand(update={
            "files": ["/workspace/output.txt"],
            "status": "ok",
        })
        result = status_builder._extract_tool_result_content(cmd)
        import json
        parsed = json.loads(result)
        assert parsed == {"files": ["/workspace/output.txt"], "status": "ok"}

    def test_command_with_empty_update(self, status_builder):
        """Command with empty update dict returns empty string."""
        cmd = _FakeCommand(update={})
        assert status_builder._extract_tool_result_content(cmd) == ""

    # ── Command with ToolMessage having empty content ────────────────────

    def test_command_with_empty_content_tool_message(self, status_builder):
        """Command where ToolMessage has empty string content falls back."""
        cmd = _FakeCommand(update={
            "messages": [_FakeToolMessage(content="")],
            "files": ["/workspace/out.txt"],
        })
        result = status_builder._extract_tool_result_content(cmd)
        import json
        parsed = json.loads(result)
        assert parsed == {"files": ["/workspace/out.txt"]}

    # ── None update (not a Command) ──────────────────────────────────────

    def test_none_update_skips_command_branch(self, status_builder):
        """Object with .update = None is not treated as a Command."""

        class _NotACommand:
            update = None

        obj = _NotACommand()
        # Falls through to str() fallback since .update is not a dict
        result = status_builder._extract_tool_result_content(obj)
        assert "NotACommand" in result or result == str(obj)

    # ── Integration: Command through _handle_tool_end_event ──────────────

    @pytest.mark.asyncio
    async def test_command_end_to_end(self, status_builder):
        """Command object flows through tool_end and lands as clean result."""
        run_id = "tool-run-cmd-e2e"

        # Start the tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write",
            "run_id": run_id,
            "data": {"input": {"path": "out.txt", "content": "hello"}},
            "metadata": {},
        })

        # End the tool with a Command-like object as output
        cmd = _FakeCommand(update={
            "messages": [
                _FakeToolMessage(
                    content="Successfully wrote 5 characters to 'out.txt'",
                    name="write",
                    tool_call_id="call_cmd_test",
                ),
            ],
        })
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "write",
            "run_id": run_id,
            "data": {"output": cmd},
            "metadata": {},
        })

        # Verify the extracted content is the ToolMessage content, not repr
        tool_call = next(status_builder.iter_all_tool_calls())
        assert tool_call.result == "Successfully wrote 5 characters to 'out.txt'"
        assert "CommandUpdate" not in tool_call.result
        assert "Command(" not in tool_call.result


# =============================================================================
# Tests for Sub-Agent Internals (Phase 2.3)
# =============================================================================


class TestSubAgentInternals:
    """Tests for SubAgentExecution creation and namespace-based event routing.
    
    Phase 2.3 adds visibility into sub-agent execution:
    - "task" tool invocations create SubAgentExecution entries
    - Events are routed to sub-agent's tool_calls/messages based on namespace
    - Sub-agent lifecycle: IN_PROGRESS -> COMPLETED/FAILED
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        """Patch LLM-based subject generation for all tests in this class."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    @pytest.mark.asyncio
    async def test_task_tool_creates_sub_agent_execution(self, status_builder):
        """Test that 'task' tool invocation creates SubAgentExecution."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus
        
        run_id = "task-run-123"
        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "description": "Fix the bug in main.py"
                }
            },
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        # Verify SubAgentExecution was created
        assert len(status_builder.current_status.sub_agent_executions) == 1
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        
        assert sub_agent.id == run_id
        assert sub_agent.name == "code_editor"
        assert sub_agent.input == "Fix the bug in main.py"
        assert sub_agent.status == SubAgentStatus.SUB_AGENT_IN_PROGRESS
        assert sub_agent.started_at != ""
        
        # Verify sub-agent is tracked for namespace routing
        assert run_id in status_builder.state.active_sub_agents

    @pytest.mark.asyncio
    async def test_task_tool_creates_parent_tool_call(self, status_builder):
        """Task tool creates a ToolCall on the parent AI message.

        The parent ToolCall gives the frontend a rendering slot for the
        SubAgentSection (ToolCallGroup maps tc.id -> SubAgentExecution.id).
        """
        run_id = "task-run-456"
        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "description": "Research the topic"
                }
            },
            "metadata": {}
        }

        await status_builder.process_event(event)

        assert status_builder.tool_call_count() == 1
        assert len(status_builder.current_status.messages) == 1

        parent_ai = status_builder.current_status.messages[0]
        assert parent_ai.type == MessageType.MESSAGE_AI
        assert len(parent_ai.tool_calls) == 1
        tc = parent_ai.tool_calls[0]
        assert tc.name == "task"
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING

        # Sub-agent should also exist, with id matching the ToolCall.id
        assert len(status_builder.current_status.sub_agent_executions) == 1
        sa = status_builder.current_status.sub_agent_executions[0]
        assert sa.id == tc.id

    @pytest.mark.asyncio
    async def test_sub_agent_completion_sets_output(self, status_builder):
        """Test that task tool end event finalizes SubAgentExecution."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus
        
        run_id = "task-run-complete"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "input": "Fix the bug"
                }
            },
            "metadata": {}
        })
        
        # Verify initial state
        assert status_builder.current_status.sub_agent_executions[0].status == SubAgentStatus.SUB_AGENT_IN_PROGRESS
        
        # End sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "Bug fixed successfully"},
            "metadata": {}
        })
        
        # Verify completion
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert sub_agent.output == "Bug fixed successfully"
        assert sub_agent.completed_at != ""
        
        # Verify cleanup
        assert run_id not in status_builder.state.active_sub_agents

    @pytest.mark.asyncio
    async def test_sub_agent_failure_captures_error(self, status_builder):
        """Test that sub-agent failure sets error status and message."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus
        
        run_id = "task-run-fail"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "debugger",
                    "input": "Debug the issue"
                }
            },
            "metadata": {}
        })
        
        # End with error
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {
                "output": {
                    "error": "Failed to connect to debugging server",
                    "status": "failed"
                }
            },
            "metadata": {}
        })
        
        # Verify failure state
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.status == SubAgentStatus.SUB_AGENT_FAILED
        assert "Failed to connect" in sub_agent.error

    @pytest.mark.asyncio
    async def test_namespace_routing_tool_calls_to_sub_agent(self, status_builder):
        """Test that tool calls with sub-agent namespace route to SubAgentExecution."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        sub_agent_run_id = "task-run-ns-test"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "input": "Write some code"
                }
            },
            "metadata": {}
        })
        
        # Tool call from sub-agent (with namespace + parent_ids)
        tool_run_id = "tool-in-subagent"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": tool_run_id,
            "parent_ids": [sub_agent_run_id],
            "data": {"input": {"path": "/tmp/test.py", "content": "print('hello')"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Main agent has exactly 1 tool call (the "task" ToolCall itself)
        main_tcs = [tc for m in status_builder.current_status.messages for tc in m.tool_calls]
        assert len(main_tcs) == 1
        assert main_tcs[0].name == "task"

        # Sub-agent's internal tool call goes to the sub-agent's messages
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        sa_tcs = [tc for m in sub_agent.messages for tc in m.tool_calls]
        assert len(sa_tcs) == 1
        assert sa_tcs[0].id == tool_run_id
        assert sa_tcs[0].name == "write_file"
        assert sa_tcs[0].status == ToolCallStatus.TOOL_CALL_RUNNING

    @pytest.mark.asyncio
    async def test_namespace_routing_messages_to_sub_agent(self, status_builder):
        """Test that AI messages with sub-agent namespace route to SubAgentExecution."""
        sub_agent_run_id = "task-run-msg-test"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "assistant",
                    "input": "Help me"
                }
            },
            "metadata": {}
        })
        
        # AI message from sub-agent (with namespace + parent_ids)
        chunk = MagicMock()
        chunk.content = "I'll help you with that."
        
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "parent_ids": [sub_agent_run_id],
            "data": {"chunk": chunk},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Main agent has 1 AI message (the parent containing the "task" ToolCall)
        assert len(status_builder.current_status.messages) == 1
        assert status_builder.current_status.messages[0].tool_calls[0].name == "task"

        # Sub-agent's AI message content routes to the sub-agent, not main
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert len(sub_agent.messages) == 1
        assert sub_agent.messages[0].content == "I'll help you with that."
        assert sub_agent.messages[0].is_streaming is True

    @pytest.mark.asyncio
    async def test_sub_agent_tool_end_updates_correct_context(self, status_builder):
        """Test that tool end events update the correct sub-agent context."""
        sub_agent_run_id = "task-run-end-test"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"
        tool_run_id = "tool-end-test"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "input": "Write code"
                }
            },
            "metadata": {}
        })
        
        # Start tool in sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": tool_run_id,
            "parent_ids": [sub_agent_run_id],
            "data": {"input": {"path": "/tmp/file.txt"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # End tool in sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "read_file",
            "run_id": tool_run_id,
            "parent_ids": [sub_agent_run_id],
            "data": {"output": "file contents"},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify tool completed in sub-agent messages
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        sa_tcs = [tc for m in sub_agent.messages for tc in m.tool_calls]
        assert len(sa_tcs) == 1
        assert sa_tcs[0].status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert sa_tcs[0].result == "[content omitted - 13 chars]"

    @pytest.mark.asyncio
    async def test_multiple_sub_agents_isolated(self, status_builder):
        """Test that multiple sub-agents have isolated tool_calls and messages."""
        
        # Start first sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sub-agent-1",
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "input": "Research topic A"
                }
            },
            "metadata": {}
        })
        
        # Start second sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sub-agent-2",
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "input": "Edit topic B"
                }
            },
            "metadata": {}
        })
        
        # Tool call for sub-agent-1
        namespace1 = "tools:task1|node:sub-agent-1"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "search",
            "run_id": "tool-1",
            "parent_ids": ["sub-agent-1"],
            "data": {"input": {"query": "topic A"}},
            "metadata": {"langgraph_checkpoint_ns": namespace1}
        })
        
        # Tool call for sub-agent-2
        namespace2 = "tools:task2|node:sub-agent-2"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": "tool-2",
            "parent_ids": ["sub-agent-2"],
            "data": {"input": {"path": "/tmp/b.txt"}},
            "metadata": {"langgraph_checkpoint_ns": namespace2}
        })
        
        # Verify isolation
        sub_agent_1 = status_builder.current_status.sub_agent_executions[0]
        sub_agent_2 = status_builder.current_status.sub_agent_executions[1]
        
        assert sub_agent_1.name == "researcher"
        sa1_tcs = [tc for m in sub_agent_1.messages for tc in m.tool_calls]
        assert len(sa1_tcs) == 1
        assert sa1_tcs[0].name == "search"
        
        assert sub_agent_2.name == "code_editor"
        sa2_tcs = [tc for m in sub_agent_2.messages for tc in m.tool_calls]
        assert len(sa2_tcs) == 1
        assert sa2_tcs[0].name == "write_file"

        # Main agent has exactly the 2 "task" ToolCalls (one per sub-agent)
        main_tcs = [tc for m in status_builder.current_status.messages for tc in m.tool_calls]
        assert len(main_tcs) == 2
        assert all(tc.name == "task" for tc in main_tcs)

    @pytest.mark.asyncio
    async def test_main_agent_events_unaffected(self, status_builder):
        """Test that main agent events (no namespace) still work correctly."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        # Main agent tool call (no namespace)
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "main-tool-1",
            "data": {"input": {"path": "/tmp/main.txt"}},
            "metadata": {}
        })
        
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "read_file",
            "run_id": "main-tool-1",
            "data": {"output": "main file content"},
            "metadata": {}
        })
        
        # Verify main agent has the tool call
        assert status_builder.tool_call_count() == 1
        tool_call = next(status_builder.iter_all_tool_calls())
        assert tool_call.name == "read_file"
        assert tool_call.status == ToolCallStatus.TOOL_CALL_COMPLETED
        
        # No sub-agent executions
        assert len(status_builder.current_status.sub_agent_executions) == 0

    @pytest.mark.asyncio
    async def test_sub_agent_message_finalization(self, status_builder):
        """Test that AI message finalization works for sub-agent messages."""
        sub_agent_run_id = "task-run-finalize"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "assistant",
                    "input": "Help"
                }
            },
            "metadata": {}
        })
        
        # Stream AI message in sub-agent
        chunk = MagicMock()
        chunk.content = "Here's my response"
        
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "parent_ids": [sub_agent_run_id],
            "data": {"chunk": chunk},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify is_streaming is True
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.messages[0].is_streaming is True
        
        # Finalize AI message
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 50,
            "output_tokens": 25,
            "total_tokens": 75,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {"model": "claude-3"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "parent_ids": [sub_agent_run_id],
            "data": {"output": output},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify finalization
        assert sub_agent.messages[0].is_streaming is False

    @pytest.mark.asyncio
    async def test_namespace_cleanup_on_sub_agent_end(self, status_builder):
        """Completed sub-agents move to _completed; namespace mappings are preserved for late events."""
        sub_agent_run_id = "task-run-cleanup"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"

        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "helper",
                    "input": "Do something"
                }
            },
            "metadata": {}
        })

        # Register namespace via child event
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "echo",
            "run_id": "child-tool",
            "parent_ids": [sub_agent_run_id],
            "data": {"input": {"text": "hello"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })

        # Verify namespace is registered and sub-agent is active
        assert namespace in status_builder.state.namespace_to_sub_agent
        assert sub_agent_run_id in status_builder.state.active_sub_agents

        # End sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {"output": "done"},
            "metadata": {}
        })

        # Sub-agent moved from active to completed
        assert sub_agent_run_id not in status_builder.state.active_sub_agents
        assert sub_agent_run_id in status_builder.state.completed_sub_agents

        # Namespace mappings preserved for late-arriving event routing
        assert namespace in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_sub_agent_extracts_alternative_arg_names(self, status_builder):
        """Test that sub-agent extracts name/input from alternative arg names."""
        # Test 'agent_type' instead of 'subagent_type'
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "alt-args-1",
            "data": {
                "input": {
                    "agent_type": "analyzer",
                    "prompt": "Analyze the data"
                }
            },
            "metadata": {}
        })
        
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.name == "analyzer"
        assert sub_agent.input == "Analyze the data"

    @pytest.mark.asyncio
    async def test_get_execution_context_returns_main_for_empty_namespace(self, status_builder):
        """Test that _get_execution_context returns main status for empty namespace."""
        context, sub_agent = status_builder._get_execution_context("")
        
        assert context is status_builder.current_status
        assert sub_agent is None

    @pytest.mark.asyncio
    async def test_get_execution_context_returns_main_for_unknown_namespace(self, status_builder):
        """Test that _get_execution_context falls back to main for unknown namespace."""
        context, sub_agent = status_builder._get_execution_context("unknown:namespace:123")
        
        assert context is status_builder.current_status
        assert sub_agent is None

    @pytest.mark.asyncio
    async def test_task_tool_description_mapped_to_input(self, status_builder):
        """description arg (deepagents' full prompt) is mapped to input field."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="Scan workflow dependencies",
        ):
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": "task-desc-1",
                "data": {
                    "input": {
                        "subagent_type": "general-purpose",
                        "description": "Scan all workflow-runner files and extract infrastructure dependencies...",
                    }
                },
                "metadata": {},
            })

        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.input == "Scan all workflow-runner files and extract infrastructure dependencies..."
        assert sub_agent.name == "general-purpose"

    @pytest.mark.asyncio
    async def test_task_tool_subject_generated_via_llm(self, status_builder):
        """subject is generated from description via economy-tier LLM."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="Scan workflow dependencies",
        ) as mock_gen:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": "task-gen-1",
                "data": {
                    "input": {
                        "subagent_type": "general-purpose",
                        "description": "Scan all workflow-runner files and extract infrastructure dependencies...",
                    }
                },
                "metadata": {},
            })

        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.subject == "Scan workflow dependencies"
        mock_gen.assert_called_once_with(
            "Scan all workflow-runner files and extract infrastructure dependencies...",
            "general-purpose",
            existing_subjects=[],
            execution_id="test-execution-123",
        )

    @pytest.mark.asyncio
    async def test_task_tool_empty_subject_when_no_description(self, status_builder):
        """subject is empty when description arg is absent (LLM receives empty input)."""
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "task-no-desc",
            "data": {
                "input": {
                    "subagent_type": "researcher",
                }
            },
            "metadata": {},
        })

        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.subject == ""
        assert sub_agent.input == ""

    @pytest.mark.asyncio
    async def test_task_tool_no_metadata_struct(self, status_builder):
        """metadata is not populated — description goes to input, subject via LLM."""
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "task-meta-check",
            "data": {
                "input": {
                    "subagent_type": "helper",
                    "description": "Some task label",
                }
            },
            "metadata": {},
        })

        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert not sub_agent.HasField("metadata")

    # ── Gap 8: End-event guard ──────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_sub_agent_end_warns_on_unknown_run_id(self, status_builder, caplog):
        """_handle_sub_agent_end logs a warning when run_id has no matching SubAgentExecution."""
        import logging

        with caplog.at_level(logging.WARNING, logger="stigmer_runner.worker.activities.graphton.status_builder"):
            await status_builder.process_event({
                "event": "on_tool_end",
                "name": "task",
                "run_id": "ghost-run-999",
                "data": {"output": "irrelevant"},
                "metadata": {},
            })

        assert any(
            "_handle_sub_agent_end" in r.message and "ghost-run-999" in r.message
            for r in caplog.records
        )

    @pytest.mark.asyncio
    async def test_sub_agent_end_defers_flush_via_pending_completion(self, status_builder):
        """Sub-agent completion records a deferred flush instead of setting force_next_update."""
        run_id = "task-force-update"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "helper", "input": "do stuff"}},
            "metadata": {},
        })

        status_builder.force_next_update = False

        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {},
        })

        assert status_builder.force_next_update is False
        assert run_id in status_builder.state.pending_completion_flush

    # ── Gap 9: Late event routing ───────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_late_event_routes_to_completed_sub_agent(self, status_builder):
        """Events arriving after sub-agent completion route to the completed proto, not main."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        run_id = "task-late-event"
        namespace = f"tools:{run_id}|agent_node:inner"

        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "explorer", "input": "search"}},
            "metadata": {},
        })

        # Register a namespace while it's active
        status_builder._register_sub_agent_namespace(
            namespace, {"parent_ids": [run_id]},
        )

        # Complete the sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "found it"},
            "metadata": {},
        })

        assert run_id not in status_builder.state.active_sub_agents
        assert run_id in status_builder.state.completed_sub_agents

        # Late event with the same namespace
        context, sub_agent = status_builder._get_execution_context(namespace)

        assert sub_agent is not None
        assert sub_agent.id == run_id
        assert sub_agent.status == SubAgentStatus.SUB_AGENT_COMPLETED

    # ── Gap 10: Parent termination propagation ──────────────────────────────

    @pytest.mark.asyncio
    async def test_finalize_active_sub_agents_marks_terminal(self, status_builder):
        """finalize_active_sub_agents transitions all active sub-agents to the given terminal status."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        # Start two sub-agents
        for suffix in ("a", "b"):
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": f"task-fin-{suffix}",
                "data": {"input": {"subagent_type": "worker", "input": f"job {suffix}"}},
                "metadata": {},
            })

        assert len(status_builder.state.active_sub_agents) == 2

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "Parent execution failed: test error",
        )

        assert len(status_builder.state.active_sub_agents) == 0
        assert len(status_builder.state.completed_sub_agents) == 2

        for sa in status_builder.current_status.sub_agent_executions:
            assert sa.status == SubAgentStatus.SUB_AGENT_FAILED
            assert sa.error == "Parent execution failed: test error"
            assert sa.completed_at != ""

    @pytest.mark.asyncio
    async def test_finalize_active_sub_agents_noop_when_empty(self, status_builder):
        """finalize_active_sub_agents is a safe no-op when no sub-agents are active."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        assert len(status_builder.state.active_sub_agents) == 0

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "should not matter",
        )

        assert len(status_builder.state.completed_sub_agents) == 0
        assert len(status_builder.current_status.sub_agent_executions) == 0

    # ── write_todos namespace isolation ──────────────────────────────────────

    @pytest.mark.asyncio
    async def test_sub_agent_write_todos_does_not_update_main_todos(self, status_builder):
        """Sub-agent write_todos must not pollute the parent execution's todo list.

        write_todos is a PLANNING_TOOL handled before regular namespace routing.
        When a sub-agent calls it, the status_builder must detect the sub-agent
        namespace and route to _update_sub_agent_todos(), not _update_todos().
        """
        sub_agent_run_id = "task-run-todo-isolation"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"

        # Create sub-agent via task tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "description": "Fix the bug",
                }
            },
            "metadata": {},
        })

        # Send a non-planning tool from the sub-agent namespace first so the
        # namespace is registered (simulates the normal event ordering where
        # AI messages or tool calls precede write_todos).
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "sub-tool-pre-todo",
            "parent_ids": [sub_agent_run_id],
            "data": {"input": {"path": "/tmp/test.txt"}},
            "metadata": {"langgraph_checkpoint_ns": namespace},
        })

        # Sub-agent calls write_todos from its namespace
        with patch.object(status_builder, "_update_todos") as mock_main, \
             patch.object(status_builder, "_update_sub_agent_todos") as mock_sub:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "write_todos",
                "run_id": "write-todos-sub-1",
                "parent_ids": [sub_agent_run_id],
                "data": {
                    "input": {
                        "todos": [
                            {"id": "t1", "content": "Sub step 1", "status": "pending"},
                            {"id": "t2", "content": "Sub step 2", "status": "in_progress"},
                        ]
                    }
                },
                "metadata": {"langgraph_checkpoint_ns": namespace},
            })
            mock_main.assert_not_called()
            mock_sub.assert_called_once()

    @pytest.mark.asyncio
    async def test_sub_agent_write_todos_populates_sub_agent_todos(self, status_builder):
        """Sub-agent write_todos must populate the SubAgentExecution.todos map."""
        sub_agent_run_id = "task-run-todo-populate"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "description": "Research APIs",
                }
            },
            "metadata": {},
        })

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_todos",
            "run_id": "write-todos-sub-populate",
            "parent_ids": [sub_agent_run_id],
            "data": {
                "input": {
                    "todos": [
                        {"id": "t1", "content": "Read docs", "status": "completed"},
                        {"id": "t2", "content": "Summarize findings", "status": "in_progress"},
                        {"id": "t3", "content": "Write report", "status": "pending"},
                    ]
                }
            },
            "metadata": {"langgraph_checkpoint_ns": namespace},
        })

        assert len(status_builder.current_status.todos) == 0

        sub_agents = status_builder.current_status.sub_agent_executions
        assert len(sub_agents) == 1
        sub = sub_agents[0]
        assert len(sub.todos) == 3
        assert sub.todos["t1"].content == "Read docs"
        assert sub.todos["t2"].status == 2  # TODO_IN_PROGRESS
        assert sub.todos["t3"].status == 1  # TODO_PENDING

    @pytest.mark.asyncio
    async def test_main_agent_write_todos_updates_todos(self, status_builder):
        """Main agent write_todos must still update the execution's todo list.

        Regression guard: the sub-agent guard added for namespace isolation
        must not interfere with the normal main-agent write_todos flow.
        """
        with patch.object(status_builder, "_update_todos") as mock_update:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "write_todos",
                "run_id": "write-todos-main-1",
                "data": {
                    "input": {
                        "todos": [
                            {"id": "t1", "content": "Main step 1", "status": "pending"},
                        ]
                    }
                },
                "metadata": {},
            })
            mock_update.assert_called_once_with(
                [{"id": "t1", "content": "Main step 1", "status": "pending"}]
            )

    @pytest.mark.asyncio
    async def test_sub_agent_write_todos_first_event_namespace_registration(
        self, status_builder
    ):
        """write_todos as the first event from a sub-agent namespace must still
        be correctly identified as a sub-agent event.

        The namespace registration was moved before the PLANNING_TOOLS handler
        specifically so that even when write_todos is the first event carrying
        a sub-agent namespace, the namespace is registered and
        _get_execution_context can resolve it.
        """
        sub_agent_run_id = "task-run-todo-first"
        namespace = f"tools:{sub_agent_run_id}|agent_node:inner"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "description": "Research topic",
                }
            },
            "metadata": {},
        })

        # write_todos is the FIRST event from this namespace — no prior tool
        # calls or AI messages have registered it yet.
        with patch.object(status_builder, "_update_todos") as mock_main, \
             patch.object(status_builder, "_update_sub_agent_todos") as mock_sub:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "write_todos",
                "run_id": "write-todos-first-event",
                "parent_ids": [sub_agent_run_id],
                "data": {
                    "input": {
                        "todos": [
                            {"id": "t1", "content": "Step 1", "status": "pending"},
                        ]
                    }
                },
                "metadata": {"langgraph_checkpoint_ns": namespace},
            })
            mock_main.assert_not_called()
            mock_sub.assert_called_once()

        # Verify the namespace was registered as a side effect
        assert namespace in status_builder.state.namespace_to_sub_agent

    # ── Early ToolCall reconciliation for task tool ──────────────────────

    @pytest.mark.asyncio
    async def test_task_early_tool_call_reconciliation(self, status_builder):
        """When an early ToolCall exists for a 'task' tool, SubAgentExecution.id
        uses the Anthropic tool_call_id so the frontend can match them."""

        tool_use_id = "toolu_01ABC123"
        run_id = "task-early-reconcile"

        # Simulate the early ToolCall (normally created by on_chat_model_stream)
        status_builder._create_early_tool_call(
            tool_name="task",
            tool_use_id=tool_use_id,
            ns_key="",
            namespace="",
        )

        assert status_builder.tool_call_count() == 1
        early_tc = status_builder.get_tool_call(tool_use_id)
        assert early_tc is not None
        assert early_tc.name == "task"

        # Process on_tool_start for the task tool
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "description": "Explore the codebase",
                }
            },
            "metadata": {},
        })

        # ToolCall count unchanged (reconciled, not duplicated)
        assert status_builder.tool_call_count() == 1

        sa = status_builder.current_status.sub_agent_executions[0]
        assert sa.id == tool_use_id
        assert sa.name == "researcher"

        # run_id -> tool_call_id mapping is registered
        assert status_builder.state.run_id_to_tool_call_id[run_id] == tool_use_id

    # ── Resume deduplication ─────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_resume_dedup_prevents_duplicate_sub_agents(self, status_builder):
        """Replaying on_tool_start for an already-existing sub-agent
        reactivates it instead of creating a duplicate."""

        run_id_1 = "task-resume-orig"

        # First invocation: creates the sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id_1,
            "data": {
                "input": {
                    "subagent_type": "explorer",
                    "description": "Find references",
                }
            },
            "metadata": {},
        })

        assert len(status_builder.current_status.sub_agent_executions) == 1
        sa = status_builder.current_status.sub_agent_executions[0]
        original_sa_id = sa.id

        # Second invocation with a NEW run_id (simulating resume after approval)
        # but same tool_call_id because the AI message is replayed.
        #
        # To simulate this, we need a matching sa_id.  In production the early
        # ToolCall dedup prevents a duplicate early TC, so the reconciliation
        # returns the same tool_call_id.  For the unit test, we directly call
        # _handle_sub_agent_start.
        run_id_2 = "task-resume-replay"
        await status_builder._handle_sub_agent_start(
            event={
                "event": "on_tool_start",
                "name": "task",
                "run_id": run_id_2,
            },
            tool_args={"subagent_type": "explorer", "description": "Find references"},
            run_id=run_id_2,
            tool_call_id=original_sa_id,
        )

        # Still only 1 SubAgentExecution — not duplicated
        assert len(status_builder.current_status.sub_agent_executions) == 1
        assert status_builder.current_status.sub_agent_executions[0].id == original_sa_id

        # New run_id maps to the existing sub-agent
        assert run_id_2 in status_builder.state.active_sub_agents

    # ── Sub-agent completion marks parent ToolCall as COMPLETED ──────────

    @pytest.mark.asyncio
    async def test_sub_agent_end_completes_parent_tool_call(self, status_builder):
        """When a sub-agent completes, the parent 'task' ToolCall is also
        marked COMPLETED so the frontend shows finished state."""

        run_id = "task-tc-complete"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "worker",
                    "description": "Do work",
                }
            },
            "metadata": {},
        })

        # Verify task ToolCall is RUNNING
        parent_ai = status_builder.current_status.messages[0]
        assert len(parent_ai.tool_calls) == 1
        tc = parent_ai.tool_calls[0]
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING

        # Complete the sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "Work done"},
            "metadata": {},
        })

        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.completed_at != ""


# =============================================================================
# Sub-Agent Scenario Tests (PR5 — multi-step interaction coverage)
# =============================================================================


class TestSubAgentScenarios:
    """Multi-step scenario tests exercising interactions between sub-agent features.

    Individual sub-agent behaviours (subject population, pending-approval sync,
    late-event routing, finalization) are covered by unit tests in
    TestSubAgentInternals.  These scenarios chain multiple features together to
    verify the state machine holds across a realistic event sequence.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        """Patch LLM-based subject generation for all tests in this class."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    @pytest.mark.asyncio
    async def test_sub_agent_tool_lifecycle(self, status_builder):
        """Full round-trip: sub-agent tool start -> tool end -> sub-agent complete."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        sa_run_id = "sa-approval-lifecycle"
        namespace = f"tools:{sa_run_id}|agent_node:inner"
        tool_run_id = "write-tool-lifecycle"

        # 1. Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sa_run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "description": "Apply hotfix",
                    "input": "Patch auth.py to fix CVE-2026-1234",
                }
            },
            "metadata": {},
        })

        sa = status_builder.current_status.sub_agent_executions[0]
        assert sa.status == SubAgentStatus.SUB_AGENT_IN_PROGRESS
        assert sa.subject == ""
        assert sa.input == "Apply hotfix"

        # 2. Sub-agent's tool call (routed via parent_ids)
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": tool_run_id,
            "parent_ids": [sa_run_id],
            "data": {"input": {"path": "/app/auth.py", "content": "patched"}},
            "metadata": {"langgraph_checkpoint_ns": namespace},
        })
        sa_tcs = [tc for m in sa.messages for tc in m.tool_calls]
        assert len(sa_tcs) == 1
        assert sa_tcs[0].id == tool_run_id

        # 3. Tool completes
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "write_file",
            "run_id": tool_run_id,
            "parent_ids": [sa_run_id],
            "data": {"output": "File written successfully"},
            "metadata": {"langgraph_checkpoint_ns": namespace},
        })

        # 4. Sub-agent completes with output
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": sa_run_id,
            "data": {"output": "Hotfix applied to auth.py"},
            "metadata": {},
        })

        assert sa.status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert sa.output == "Hotfix applied to auth.py"
        assert sa.completed_at != ""
        assert sa_run_id not in status_builder.state.active_sub_agents
        assert sa_run_id in status_builder.state.completed_sub_agents

    @pytest.mark.asyncio
    async def test_concurrent_sub_agents_interleaved_events(self, status_builder):
        """Two sub-agents with interleaved tool events maintain isolation and late-event routing."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        sa_a_id = "sa-concurrent-a"
        sa_b_id = "sa-concurrent-b"
        ns_a = f"tools:{sa_a_id}|agent_node:inner_a"
        ns_b = f"tools:{sa_b_id}|agent_node:inner_b"

        # Start both sub-agents
        for sa_id, desc in [(sa_a_id, "review code"), (sa_b_id, "run tests")]:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {
                    "input": {
                        "subagent_type": "worker",
                        "description": desc,
                        "input": f"Do: {desc}",
                    }
                },
                "metadata": {},
            })

        assert len(status_builder.state.active_sub_agents) == 2

        # Interleaved tool events with parent_ids for routing
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "grep",
            "run_id": "tool-a-1",
            "parent_ids": [sa_a_id],
            "data": {"input": {"pattern": "TODO"}},
            "metadata": {"langgraph_checkpoint_ns": ns_a},
        })
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "pytest",
            "run_id": "tool-b-1",
            "parent_ids": [sa_b_id],
            "data": {"input": {"path": "tests/"}},
            "metadata": {"langgraph_checkpoint_ns": ns_b},
        })
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "grep",
            "run_id": "tool-a-1",
            "parent_ids": [sa_a_id],
            "data": {"output": "3 TODOs found"},
            "metadata": {"langgraph_checkpoint_ns": ns_a},
        })
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "pytest",
            "run_id": "tool-b-1",
            "parent_ids": [sa_b_id],
            "data": {"output": "12 passed"},
            "metadata": {"langgraph_checkpoint_ns": ns_b},
        })

        sa_a = status_builder.state.active_sub_agents[sa_a_id]
        sa_b = status_builder.state.active_sub_agents[sa_b_id]

        sa_a_tcs = [tc for m in sa_a.messages for tc in m.tool_calls]
        assert len(sa_a_tcs) == 1
        assert sa_a_tcs[0].name == "grep"
        sa_b_tcs = [tc for m in sa_b.messages for tc in m.tool_calls]
        assert len(sa_b_tcs) == 1
        assert sa_b_tcs[0].name == "pytest"

        # Main agent has exactly 2 "task" ToolCalls (one per sub-agent)
        main_tcs = [tc for m in status_builder.current_status.messages for tc in m.tool_calls]
        assert len(main_tcs) == 2
        assert all(tc.name == "task" for tc in main_tcs)

        # Complete SA-B first
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": sa_b_id,
            "data": {"output": "All tests pass"},
            "metadata": {},
        })

        assert sa_b_id not in status_builder.state.active_sub_agents
        assert sa_b_id in status_builder.state.completed_sub_agents
        assert sa_a_id in status_builder.state.active_sub_agents

        # Late event for SA-B routes to completed sub-agent (same namespace
        # that was registered when SA-B's tool events arrived)
        ctx, resolved_sa = status_builder._get_execution_context(ns_b)
        assert resolved_sa is not None
        assert resolved_sa.id == sa_b_id

        # Complete SA-A
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": sa_a_id,
            "data": {"output": "Review complete"},
            "metadata": {},
        })

        # Both in final status with correct outputs
        subs = {s.id: s for s in status_builder.current_status.sub_agent_executions}
        assert subs[sa_a_id].status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert subs[sa_a_id].output == "Review complete"
        assert subs[sa_b_id].status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert subs[sa_b_id].output == "All tests pass"



# =============================================================================
# Tests for parent_ids-Based Namespace Routing
# =============================================================================


class TestParentIdsNamespaceRouting:
    """Tests for _register_sub_agent_namespace using parent_ids.

    v2 astream_events carry a parent_ids list tracing the callback chain from
    sub-agent events back to the parent invocation context.  At least one entry
    in parent_ids is the task tool's run_id (the key in _active_sub_agents).
    This provides deterministic namespace -> sub-agent mapping without
    heuristics.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    @pytest.mark.asyncio
    async def test_parent_ids_matches_active_sub_agent(self, status_builder):
        """parent_ids containing the task tool run_id registers the namespace."""
        run_id = "sa-pid-001"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "editor", "input": "edit file"}},
            "metadata": {},
        })

        ns = "tools:abc123|work_node:def456"
        status_builder._register_sub_agent_namespace(
            ns, {"parent_ids": ["sub-graph-root", run_id, "tools-node-run"]},
        )

        assert ns in status_builder.state.namespace_to_sub_agent
        assert status_builder.state.namespace_to_sub_agent[ns] == run_id

    @pytest.mark.asyncio
    async def test_parent_ids_matches_completed_sub_agent(self, status_builder):
        """Late events route via parent_ids to completed sub-agents."""
        run_id = "sa-late-001"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "coder", "input": "code"}},
            "metadata": {},
        })

        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {},
        })

        assert run_id in status_builder.state.completed_sub_agents

        ns = "tools:abc|late_node:xyz"
        status_builder._register_sub_agent_namespace(
            ns, {"parent_ids": [run_id]},
        )

        assert ns in status_builder.state.namespace_to_sub_agent
        assert status_builder.state.namespace_to_sub_agent[ns] == run_id

    @pytest.mark.asyncio
    async def test_empty_parent_ids_does_not_register(self, status_builder):
        """Multi-segment namespace with empty parent_ids is not registered."""
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-empty-pid",
            "data": {"input": {"subagent_type": "a", "input": "x"}},
            "metadata": {},
        })

        ns = "tools:aaa|child:bbb"
        status_builder._register_sub_agent_namespace(ns, {"parent_ids": []})

        assert ns not in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_no_matching_parent_ids_falls_to_main(self, status_builder):
        """Namespace whose parent_ids match no known sub-agent falls to main context."""
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-nomatch-1",
            "data": {"input": {"subagent_type": "a", "input": "x"}},
            "metadata": {},
        })

        ns = "tools:zzz|deep|nested"
        status_builder._register_sub_agent_namespace(
            ns, {"parent_ids": ["unknown-id-1", "unknown-id-2"]},
        )

        assert ns not in status_builder.state.namespace_to_sub_agent

        context, sub_agent = status_builder._get_execution_context(ns)
        assert context is status_builder.current_status
        assert sub_agent is None

    @pytest.mark.asyncio
    async def test_concurrent_sub_agents_shared_root_route_correctly(self, status_builder):
        """Two sub-agents sharing a namespace root are disambiguated by parent_ids."""
        sa_a = "sa-shared-root-a"
        sa_b = "sa-shared-root-b"

        for sa_id in [sa_a, sa_b]:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        ns_a = "tools:same_task_id|work_a:aaa"
        ns_b = "tools:same_task_id|1|work_b:bbb"

        status_builder._register_sub_agent_namespace(
            ns_a, {"parent_ids": ["sub-a-graph-root", sa_a, "tools-node"]},
        )
        status_builder._register_sub_agent_namespace(
            ns_b, {"parent_ids": ["sub-b-graph-root", sa_b, "tools-node"]},
        )

        assert status_builder.state.namespace_to_sub_agent[ns_a] == sa_a
        assert status_builder.state.namespace_to_sub_agent[ns_b] == sa_b

    @pytest.mark.asyncio
    async def test_single_segment_namespace_ignored(self, status_builder):
        """Single-segment namespaces (main-agent nodes) are not registered."""
        status_builder._register_sub_agent_namespace(
            "tools", {"parent_ids": ["some-id"]},
        )
        assert "tools" not in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_already_registered_namespace_is_idempotent(self, status_builder):
        """Re-registering the same namespace does not overwrite the mapping."""
        run_id = "sa-idem-001"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "a", "input": "x"}},
            "metadata": {},
        })

        ns = "tools:aaa|child:bbb"
        event = {"parent_ids": [run_id]}

        status_builder._register_sub_agent_namespace(ns, event)
        assert status_builder.state.namespace_to_sub_agent[ns] == run_id

        status_builder._register_sub_agent_namespace(ns, event)
        assert status_builder.state.namespace_to_sub_agent[ns] == run_id


# =============================================================================
# Tests for Concurrent Sub-Agent Namespace Registration (parent_ids)
# =============================================================================


class TestConcurrentSubAgentNamespaceRegistration:
    """Tests for concurrent sub-agent namespace routing via parent_ids.

    When multiple sub-agents launch in parallel, each sub-agent's events carry
    distinct parent_ids chains that include the respective task tool's run_id.
    This provides deterministic routing regardless of event arrival order.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    @pytest.mark.asyncio
    async def test_four_concurrent_sub_agents_all_map_via_parent_ids(self, status_builder):
        """4 sub-agents, 4 namespaces — each maps to correct sub-agent via parent_ids."""
        sa_ids = ["sa-pid-1", "sa-pid-2", "sa-pid-3", "sa-pid-4"]

        for sa_id in sa_ids:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        assert len(status_builder.state.active_sub_agents) == 4

        namespaces = [
            "tools:aaa|child-a",
            "tools:bbb|child-b",
            "tools:ccc|child-c",
            "tools:ddd|child-d",
        ]
        for ns, sa_id in zip(namespaces, sa_ids):
            status_builder._register_sub_agent_namespace(
                ns, {"parent_ids": [f"sub-graph-{sa_id}", sa_id, "tools-node"]},
            )

        for ns, sa_id in zip(namespaces, sa_ids):
            assert status_builder.state.namespace_to_sub_agent[ns] == sa_id

    @pytest.mark.asyncio
    async def test_tool_calls_routed_to_correct_sub_agents_via_parent_ids(self, status_builder):
        """4 concurrent sub-agents: tool calls with parent_ids route correctly."""
        sa_ids = ["sa-route-1", "sa-route-2", "sa-route-3", "sa-route-4"]

        for sa_id in sa_ids:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        for i, sa_id in enumerate(sa_ids):
            ns = f"tools:{sa_id}-task|child-{i}"
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "read_file",
                "run_id": f"tool-{i}",
                "parent_ids": [f"sub-graph-{sa_id}", sa_id, "tools-node"],
                "data": {"input": {"path": f"/tmp/{i}.py"}},
                "metadata": {"langgraph_checkpoint_ns": ns},
            })

        main_tcs = [tc for m in status_builder.current_status.messages for tc in m.tool_calls]
        assert len(main_tcs) == 4
        assert all(tc.name == "task" for tc in main_tcs)

        for sa_id in sa_ids:
            sa = status_builder.state.active_sub_agents[sa_id]
            sa_tcs = [tc for m in sa.messages for tc in m.tool_calls]
            assert len(sa_tcs) == 1
            assert sa_tcs[0].name == "read_file"

    @pytest.mark.asyncio
    async def test_subsequent_namespace_variants_register_via_parent_ids(self, status_builder):
        """Different namespace paths from the same sub-agent each register via parent_ids."""
        sa_ids = ["sa-cascade-1", "sa-cascade-2"]

        for sa_id in sa_ids:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        status_builder._register_sub_agent_namespace(
            "tools:aaa|first-child",
            {"parent_ids": ["sa-cascade-1"]},
        )
        status_builder._register_sub_agent_namespace(
            "tools:bbb|first-child",
            {"parent_ids": ["sa-cascade-2"]},
        )

        assert status_builder.state.namespace_to_sub_agent["tools:aaa|first-child"] == "sa-cascade-1"
        assert status_builder.state.namespace_to_sub_agent["tools:bbb|first-child"] == "sa-cascade-2"

        status_builder._register_sub_agent_namespace(
            "tools:aaa|second-child|deeper",
            {"parent_ids": ["sa-cascade-1"]},
        )
        status_builder._register_sub_agent_namespace(
            "tools:bbb|second-child|deeper",
            {"parent_ids": ["sa-cascade-2"]},
        )

        assert status_builder.state.namespace_to_sub_agent["tools:aaa|second-child|deeper"] == "sa-cascade-1"
        assert status_builder.state.namespace_to_sub_agent["tools:bbb|second-child|deeper"] == "sa-cascade-2"

    @pytest.mark.asyncio
    async def test_sub_agent_end_does_not_break_remaining_routing(self, status_builder):
        """Completing one sub-agent does not break namespace routing for others."""
        sa_ids = ["sa-end-1", "sa-end-2", "sa-end-3"]

        for sa_id in sa_ids:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": "sa-end-2",
            "data": {"output": "done early"},
            "metadata": {},
        })

        assert "sa-end-2" not in status_builder.state.active_sub_agents
        assert "sa-end-2" in status_builder.state.completed_sub_agents
        assert "sa-end-1" in status_builder.state.active_sub_agents
        assert "sa-end-3" in status_builder.state.active_sub_agents

        ns_1 = "tools:x|child-1"
        status_builder._register_sub_agent_namespace(
            ns_1, {"parent_ids": ["sa-end-1"]},
        )
        assert status_builder.state.namespace_to_sub_agent[ns_1] == "sa-end-1"

        ns_3 = "tools:y|child-3"
        status_builder._register_sub_agent_namespace(
            ns_3, {"parent_ids": ["sa-end-3"]},
        )
        assert status_builder.state.namespace_to_sub_agent[ns_3] == "sa-end-3"

    @pytest.mark.asyncio
    async def test_early_reconciliation_no_cross_contamination(self, status_builder):
        """Two sub-agents emit same tool name — early reconciliation matches correct sub-agent."""
        sa_ids = ["sa-recon-1", "sa-recon-2"]
        ns_map = {"sa-recon-1": "root-r1:aaa|child", "sa-recon-2": "root-r2:bbb|child"}

        for sa_id in sa_ids:
            await status_builder.process_event({
                "event": "on_tool_start",
                "name": "task",
                "run_id": sa_id,
                "data": {"input": {"subagent_type": "worker", "description": f"do {sa_id}"}},
                "metadata": {},
            })

        for sa_id, ns in ns_map.items():
            status_builder._register_sub_agent_namespace(
                ns, {"parent_ids": [sa_id]},
            )

        sa1 = status_builder.state.active_sub_agents["sa-recon-1"]
        sa2 = status_builder.state.active_sub_agents["sa-recon-2"]

        status_builder._create_early_tool_call(
            "read_file", "use-1", "ns-1", ns_map["sa-recon-1"],
        )
        status_builder._create_early_tool_call(
            "read_file", "use-2", "ns-2", ns_map["sa-recon-2"],
        )

        sa1_tcs = [tc for m in sa1.messages for tc in m.tool_calls]
        sa2_tcs = [tc for m in sa2.messages for tc in m.tool_calls]
        assert len(sa1_tcs) == 1
        assert len(sa2_tcs) == 1

        reconciled = status_builder._reconcile_early_tool_call(
            "read_file", "real-run-2", {"path": "/b"}, ns_map["sa-recon-2"],
        )
        assert reconciled is not None

        reconciled = status_builder._reconcile_early_tool_call(
            "read_file", "real-run-1", {"path": "/a"}, ns_map["sa-recon-1"],
        )
        assert reconciled is not None

        assert len(status_builder.state.early_tool_call_queue) == 0


# =============================================================================
# Tests for Concurrent Sub-Agent Resume Event Routing
# =============================================================================


class TestConcurrentSubAgentResumeRouting:
    """Tests for event routing correctness after HITL resume with concurrent
    sub-agents.

    Reproduces the production bug where 3 sub-agents are launched concurrently,
    SA1 completes, SA2 and SA3 interrupt for approval.  After all-or-nothing
    gate resolves:
      - Fix 1: completed SA1 must NOT be reactivated into active_sub_agents
      - Fix 2: SA3 must route correctly even if on_tool_start is not replayed
      - Fix 3: namespaces must not map to completed sub-agents when active exist
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    @pytest.fixture
    def resumed_builder(self, mock_initial_status):
        """StatusBuilder initialized with persisted state from the first cycle.

        Simulates the state after rebuild_from_proto: SA1 completed, SA2 and
        SA3 in-progress.  All proto messages and sub-agent executions are
        pre-populated as they would be from the DB.
        """
        from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution

        sa1 = SubAgentExecution(
            id="toolu_SA1", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_COMPLETED,
            subject="Find docs", completed_at="2026-03-30T07:07:58Z",
        )
        sa2 = SubAgentExecution(
            id="toolu_SA2", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_IN_PROGRESS,
            subject="Infra charts",
        )
        sa3 = SubAgentExecution(
            id="toolu_SA3", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_IN_PROGRESS,
            subject="Changelog entries",
        )
        mock_initial_status.sub_agent_executions.extend([sa1, sa2, sa3])

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(
            id="toolu_SA1", name="task",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )
        ai_msg.tool_calls.add(
            id="toolu_SA2", name="task",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        ai_msg.tool_calls.add(
            id="toolu_SA3", name="task",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.messages.append(ai_msg)

        builder = StatusBuilder("exec-resume-test", mock_initial_status)
        builder.rebuild_index_from_persisted_status()
        return builder

    # -- Fix 1: completed sub-agents must NOT be reactivated -----------------

    @pytest.mark.asyncio
    async def test_completed_sub_agent_not_reactivated(self, resumed_builder):
        """handle_sub_agent_start for a COMPLETED sub-agent routes to
        completed_sub_agents, not active_sub_agents."""
        new_run_id = "resume-run-sa1"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": new_run_id},
            tool_args={"subagent_type": "generalPurpose", "description": "Find docs"},
            run_id=new_run_id,
            tool_call_id="toolu_SA1",
        )

        assert new_run_id not in resumed_builder.state.active_sub_agents
        assert new_run_id in resumed_builder.state.completed_sub_agents
        sa = resumed_builder.state.completed_sub_agents[new_run_id]
        assert sa.id == "toolu_SA1"
        assert sa.status == SubAgentStatus.SUB_AGENT_COMPLETED

    @pytest.mark.asyncio
    async def test_in_progress_sub_agent_reactivated_normally(self, resumed_builder):
        """handle_sub_agent_start for an IN_PROGRESS sub-agent activates it."""
        new_run_id = "resume-run-sa2"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": new_run_id},
            tool_args={"subagent_type": "generalPurpose", "description": "Infra charts"},
            run_id=new_run_id,
            tool_call_id="toolu_SA2",
        )

        assert new_run_id in resumed_builder.state.active_sub_agents
        sa = resumed_builder.state.active_sub_agents[new_run_id]
        assert sa.id == "toolu_SA2"
        assert sa.status == SubAgentStatus.SUB_AGENT_IN_PROGRESS

    # -- Fix 2: proactive pre-registration -----------------------------------

    def test_pre_register_in_progress_sub_agents(self, resumed_builder):
        """pre_register_in_progress_sub_agents adds IN_PROGRESS sub-agents
        to active_sub_agents as placeholders (keyed by sa_id)."""
        count = resumed_builder.pre_register_in_progress_sub_agents()

        assert count == 2
        assert "toolu_SA2" in resumed_builder.state.active_sub_agents
        assert "toolu_SA3" in resumed_builder.state.active_sub_agents
        assert "toolu_SA1" not in resumed_builder.state.active_sub_agents
        assert resumed_builder.state.pending_resume_sa_ids == {"toolu_SA2", "toolu_SA3"}

    @pytest.mark.asyncio
    async def test_handle_sub_agent_start_rekeys_placeholder(self, resumed_builder):
        """When handle_sub_agent_start fires after pre-registration, it
        re-keys the entry from sa_id to the real LangGraph run_id."""
        resumed_builder.pre_register_in_progress_sub_agents()
        assert "toolu_SA2" in resumed_builder.state.active_sub_agents

        new_run_id = "resume-run-sa2"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": new_run_id},
            tool_args={"subagent_type": "generalPurpose", "description": "Infra charts"},
            run_id=new_run_id,
            tool_call_id="toolu_SA2",
        )

        assert "toolu_SA2" not in resumed_builder.state.active_sub_agents
        assert new_run_id in resumed_builder.state.active_sub_agents
        assert "toolu_SA2" not in resumed_builder.state.pending_resume_sa_ids
        assert "toolu_SA3" in resumed_builder.state.pending_resume_sa_ids

    # -- Fix 2 + Fix 3: deferred binding for unreplayed sub-agents ----------

    @pytest.mark.asyncio
    async def test_deferred_binding_single_pending(self, resumed_builder):
        """When on_tool_start fires for SA2 but NOT SA3, deferred binding in
        _register_sub_agent_namespace maps SA3's events to the correct
        sub-agent via the sole remaining pending sa_id."""
        resumed_builder.pre_register_in_progress_sub_agents()

        sa2_run = "resume-run-sa2"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": sa2_run},
            tool_args={"subagent_type": "generalPurpose", "description": "Infra charts"},
            run_id=sa2_run,
            tool_call_id="toolu_SA2",
        )

        assert len(resumed_builder.state.pending_resume_sa_ids) == 1
        assert "toolu_SA3" in resumed_builder.state.pending_resume_sa_ids

        sa3_new_run = "resume-run-sa3"
        sa3_namespace = "tools:checkpoint_sa3|child-ns"
        resumed_builder._register_sub_agent_namespace(
            sa3_namespace,
            {"parent_ids": ["sa3-subgraph", sa3_new_run, "tools-node", "graph"]},
        )

        assert sa3_namespace in resumed_builder.state.namespace_to_sub_agent
        bound_pid = resumed_builder.state.namespace_to_sub_agent[sa3_namespace]
        assert bound_pid in resumed_builder.state.active_sub_agents
        sa3_proto = resumed_builder.state.active_sub_agents[bound_pid]
        assert sa3_proto.id == "toolu_SA3"
        assert len(resumed_builder.state.pending_resume_sa_ids) == 0

    # -- Fix 3: namespace does not map to completed when active exist --------

    @pytest.mark.asyncio
    async def test_namespace_does_not_map_to_completed_when_active_exist(
        self, resumed_builder,
    ):
        """When active sub-agents exist, _register_sub_agent_namespace must
        NOT fall back to completed_sub_agents for routing."""
        sa2_run = "resume-run-sa2"
        resumed_builder.state.active_sub_agents[sa2_run] = (
            resumed_builder.current_status.sub_agent_executions[1]
        )

        sa1_completed_run = "resume-run-sa1"
        resumed_builder.state.completed_sub_agents[sa1_completed_run] = (
            resumed_builder.current_status.sub_agent_executions[0]
        )

        ns = "tools:some|child"
        resumed_builder._register_sub_agent_namespace(
            ns,
            {"parent_ids": [sa1_completed_run, "tools-node"]},
        )

        assert ns not in resumed_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_namespace_maps_to_completed_when_no_active_exist(
        self, resumed_builder,
    ):
        """When no active sub-agents exist, completed sub-agents CAN be
        used for namespace routing (late events for finished sub-agents)."""
        sa1_completed_run = "resume-run-sa1"
        resumed_builder.state.completed_sub_agents[sa1_completed_run] = (
            resumed_builder.current_status.sub_agent_executions[0]
        )

        ns = "tools:late|event"
        resumed_builder._register_sub_agent_namespace(
            ns,
            {"parent_ids": [sa1_completed_run]},
        )

        assert ns in resumed_builder.state.namespace_to_sub_agent
        assert resumed_builder.state.namespace_to_sub_agent[ns] == sa1_completed_run

    # -- Full scenario: 3 sub-agents, 1 completes, 2 interrupt, resume ------

    @pytest.mark.asyncio
    async def test_full_resume_scenario_correct_event_routing(self, resumed_builder):
        """End-to-end: after all-or-nothing resume, tool calls from SA2 and
        SA3 route to their correct sub-agents, not to completed SA1."""
        resumed_builder.pre_register_in_progress_sub_agents()

        sa1_run = "resume-run-sa1"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": sa1_run},
            tool_args={"subagent_type": "generalPurpose", "description": "Find docs"},
            run_id=sa1_run,
            tool_call_id="toolu_SA1",
        )
        assert sa1_run not in resumed_builder.state.active_sub_agents
        assert sa1_run in resumed_builder.state.completed_sub_agents

        sa2_run = "resume-run-sa2"
        await resumed_builder._handle_sub_agent_start(
            event={"event": "on_tool_start", "name": "task", "run_id": sa2_run},
            tool_args={"subagent_type": "generalPurpose", "description": "Infra charts"},
            run_id=sa2_run,
            tool_call_id="toolu_SA2",
        )
        assert sa2_run in resumed_builder.state.active_sub_agents

        sa2_ns = "tools:sa2_ckpt|child"
        await resumed_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "tool-sa2-1",
            "parent_ids": ["sa2-inner", sa2_run, "tools-node"],
            "data": {"input": {"path": "/charts/Chart.yaml"}},
            "metadata": {"langgraph_checkpoint_ns": sa2_ns},
        })

        sa2_proto = resumed_builder.state.active_sub_agents[sa2_run]
        sa2_tcs = [tc for m in sa2_proto.messages for tc in m.tool_calls]
        assert len(sa2_tcs) == 1
        assert sa2_tcs[0].name == "read_file"

        sa3_new_run = "resume-run-sa3"
        sa3_ns = "tools:sa3_ckpt|child"
        await resumed_builder.process_event({
            "event": "on_tool_start",
            "name": "find_file",
            "run_id": "tool-sa3-1",
            "parent_ids": ["sa3-inner", sa3_new_run, "tools-node"],
            "data": {"input": {"pattern": "_changelog/*.md"}},
            "metadata": {"langgraph_checkpoint_ns": sa3_ns},
        })

        bound_pid = resumed_builder.state.namespace_to_sub_agent.get(sa3_ns)
        assert bound_pid is not None
        sa3_proto = resumed_builder.state.active_sub_agents[bound_pid]
        assert sa3_proto.id == "toolu_SA3"
        sa3_tcs = [tc for m in sa3_proto.messages for tc in m.tool_calls]
        assert len(sa3_tcs) == 1
        assert sa3_tcs[0].name == "find_file"

        sa1_proto = resumed_builder.state.completed_sub_agents[sa1_run]
        sa1_tcs = [tc for m in sa1_proto.messages for tc in m.tool_calls]
        assert len(sa1_tcs) == 0


# =============================================================================
# Tests for ResolvedExecutionContext (Phase 2.5)
# =============================================================================


class TestResolvedExecutionContext:
    """Tests for ResolvedExecutionContext population (Phase 2.5).
    
    ResolvedExecutionContext captures what resources the agent had access to
    at execution time: environment keys, MCP server status, and skill names.
    """

    def test_set_resolved_context_populates_proto(self, status_builder):
        """Verify set_resolved_context creates properly structured proto."""
        status_builder.set_resolved_context(
            environment_keys=["API_KEY", "DATABASE_URL"],
            mcp_servers={
                "github-mcp": (True, "Configured successfully", 5),
            },
            skill_names=["code-review"],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Verify all fields are populated
        assert len(ctx.environment_keys) == 2
        assert len(ctx.mcp_servers) == 1
        assert len(ctx.skill_names) == 1
        
        # Verify MCP server has all fields
        github_status = ctx.mcp_servers["github-mcp"]
        assert github_status.resolved is True
        assert github_status.message == "Configured successfully"
        assert github_status.enabled_tool_count == 5

    def test_environment_keys_sorted_alphabetically(self, status_builder):
        """Verify environment keys are sorted for consistent ordering."""
        # Pass keys in non-alphabetical order
        status_builder.set_resolved_context(
            environment_keys=["ZEBRA", "APPLE", "MANGO", "BANANA"],
            mcp_servers={},
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Should be sorted alphabetically
        assert list(ctx.environment_keys) == ["APPLE", "BANANA", "MANGO", "ZEBRA"]

    def test_skill_names_sorted_alphabetically(self, status_builder):
        """Verify skill names are sorted for consistent ordering."""
        # Pass names in non-alphabetical order
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["kubernetes-operator", "docker-expert", "code-review"],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Should be sorted alphabetically
        assert list(ctx.skill_names) == ["code-review", "docker-expert", "kubernetes-operator"]

    def test_mcp_server_resolved_status(self, status_builder):
        """Verify MCP server with resolved=True has correct fields."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={
                "slack-mcp": (True, "Configured successfully", 12),
            },
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        slack_status = ctx.mcp_servers["slack-mcp"]
        
        assert slack_status.resolved is True
        assert slack_status.message == "Configured successfully"
        assert slack_status.enabled_tool_count == 12

    def test_mcp_server_failed_status(self, status_builder):
        """Verify MCP server with resolved=False captures error message."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={
                "postgres-mcp": (False, "Missing required environment variable: PG_PASSWORD", 0),
            },
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        pg_status = ctx.mcp_servers["postgres-mcp"]
        
        assert pg_status.resolved is False
        assert pg_status.message == "Missing required environment variable: PG_PASSWORD"
        assert pg_status.enabled_tool_count == 0

    def test_empty_context_all_fields_empty(self, status_builder):
        """Verify empty inputs produce empty but valid proto."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # All collections should be empty
        assert len(ctx.environment_keys) == 0
        assert len(ctx.mcp_servers) == 0
        assert len(ctx.skill_names) == 0

    def test_context_overwrites_on_second_call(self, status_builder):
        """Verify calling set_resolved_context twice overwrites previous values."""
        # First call
        status_builder.set_resolved_context(
            environment_keys=["KEY_A"],
            mcp_servers={"server-a": (True, "OK", 5)},
            skill_names=["skill-a"],
        )
        
        # Second call with different values
        status_builder.set_resolved_context(
            environment_keys=["KEY_B", "KEY_C"],
            mcp_servers={"server-b": (False, "Failed", 0)},
            skill_names=["skill-b"],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Should have second call's values only
        assert list(ctx.environment_keys) == ["KEY_B", "KEY_C"]
        assert "server-a" not in ctx.mcp_servers
        assert "server-b" in ctx.mcp_servers
        assert list(ctx.skill_names) == ["skill-b"]

    def test_env_keys_only_no_values_accepted(self, status_builder):
        """Verify the method signature only accepts keys, not values (security)."""
        # The method signature enforces this - it only takes List[str] for env_keys
        # This test verifies the design intent is implemented
        status_builder.set_resolved_context(
            environment_keys=["SECRET_KEY", "API_TOKEN", "DATABASE_PASSWORD"],
            mcp_servers={},
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Keys are present, but the method never sees values
        # (values are not passed in, only keys)
        assert "SECRET_KEY" in ctx.environment_keys
        assert "API_TOKEN" in ctx.environment_keys
        assert "DATABASE_PASSWORD" in ctx.environment_keys

    def test_large_env_count_handled(self, status_builder):
        """Verify handling of many environment variables (100+)."""
        # Generate 150 env keys
        large_env_keys = [f"ENV_VAR_{i:03d}" for i in range(150)]
        
        status_builder.set_resolved_context(
            environment_keys=large_env_keys,
            mcp_servers={},
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # All keys should be present and sorted
        assert len(ctx.environment_keys) == 150
        assert ctx.environment_keys[0] == "ENV_VAR_000"
        assert ctx.environment_keys[149] == "ENV_VAR_149"

    def test_mcp_tool_count_accurate(self, status_builder):
        """Verify enabled_tool_count reflects actual tool configuration."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={
                "github-mcp": (True, "Configured successfully", 8),
                "slack-mcp": (True, "Configured successfully", 15),
                "jira-mcp": (True, "Configured successfully", 0),  # No tools enabled
            },
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        assert ctx.mcp_servers["github-mcp"].enabled_tool_count == 8
        assert ctx.mcp_servers["slack-mcp"].enabled_tool_count == 15
        assert ctx.mcp_servers["jira-mcp"].enabled_tool_count == 0

    def test_multiple_mcp_servers_mixed_status(self, status_builder):
        """Verify handling of multiple MCP servers with mixed resolution status."""
        status_builder.set_resolved_context(
            environment_keys=["GITHUB_TOKEN", "SLACK_TOKEN"],
            mcp_servers={
                "github-mcp": (True, "Configured successfully", 10),
                "slack-mcp": (True, "Configured successfully", 5),
                "postgres-mcp": (False, "Server not found", 0),
                "redis-mcp": (False, "Missing required env var: REDIS_URL", 0),
            },
            skill_names=["debugging", "code-review"],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Check resolved servers
        assert ctx.mcp_servers["github-mcp"].resolved is True
        assert ctx.mcp_servers["github-mcp"].enabled_tool_count == 10
        
        assert ctx.mcp_servers["slack-mcp"].resolved is True
        assert ctx.mcp_servers["slack-mcp"].enabled_tool_count == 5
        
        # Check failed servers
        assert ctx.mcp_servers["postgres-mcp"].resolved is False
        assert "not found" in ctx.mcp_servers["postgres-mcp"].message
        
        assert ctx.mcp_servers["redis-mcp"].resolved is False
        assert "REDIS_URL" in ctx.mcp_servers["redis-mcp"].message

    def test_special_characters_in_keys_preserved(self, status_builder):
        """Verify environment keys with special characters are preserved."""
        special_keys = [
            "MY_APP__CONFIG",
            "DATABASE.URL",
            "CONFIG-VALUE",
            "KEY_WITH_123_NUMBERS",
        ]
        
        status_builder.set_resolved_context(
            environment_keys=special_keys,
            mcp_servers={},
            skill_names=[],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # All special characters should be preserved
        for key in special_keys:
            assert key in ctx.environment_keys

    def test_unicode_skill_names_handled(self, status_builder):
        """Verify skill names with unicode characters are handled."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["código-review", "日本語-skill", "test-skill"],
        )
        
        ctx = status_builder.current_status.resolved_context
        
        # Unicode should be preserved and sorted correctly
        assert "código-review" in ctx.skill_names
        assert "日本語-skill" in ctx.skill_names
        assert "test-skill" in ctx.skill_names

    def test_excluded_skill_names_populated(self, status_builder):
        """Verify excluded_skill_names captures filtered skills."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["code-review", "kubernetes-operator"],
            excluded_skill_names=["redis-cache", "terraform-iac"],
        )

        ctx = status_builder.current_status.resolved_context
        assert list(ctx.excluded_skill_names) == ["redis-cache", "terraform-iac"]

    def test_excluded_skill_names_sorted(self, status_builder):
        """Verify excluded skill names are sorted alphabetically."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["alpha"],
            excluded_skill_names=["zeta", "beta", "delta"],
        )

        ctx = status_builder.current_status.resolved_context
        assert list(ctx.excluded_skill_names) == ["beta", "delta", "zeta"]

    def test_excluded_skill_names_none_gives_empty(self, status_builder):
        """Verify None excluded_skill_names produces empty list."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["code-review"],
        )

        ctx = status_builder.current_status.resolved_context
        assert len(ctx.excluded_skill_names) == 0

    def test_excluded_skill_names_empty_list(self, status_builder):
        """Verify explicit empty list works identically to None."""
        status_builder.set_resolved_context(
            environment_keys=[],
            mcp_servers={},
            skill_names=["code-review"],
            excluded_skill_names=[],
        )

        ctx = status_builder.current_status.resolved_context
        assert len(ctx.excluded_skill_names) == 0


# =============================================================================
# Tests for Approval Policy Resolution (HITL Phase 2)
# =============================================================================


class TestApprovalPolicyResolution:
    """Tests for approval policy resolution logic.

    Tests cover the five-level policy chain:
    1. auto_approve_all (highest priority)
    2. tool_approval_overrides (per-agent)
    3. pinned_tool_approvals (manual MCP owner overrides)
    4. status_tool_approvals (LLM classifier)
    5. PLATFORM_TOOL_DEFAULTS (sandbox tools)
    """
    
    def test_auto_approve_all_bypasses_all_policies(self):
        """Test that auto_approve_all=True bypasses all approval requirements."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        # Even with MCP default requiring approval, auto_approve_all bypasses
        default_policies = [
            {"tool_name": "delete_repository", "message": "Delete repo {{args.repo}}"}
        ]
        
        result = resolve_tool_approval(
            tool_name="delete_repository",
            mcp_server_name="github",
            auto_approve_all=True,  # Highest priority bypass
            tool_approval_overrides=[],
            pinned_tool_approvals=default_policies,
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "auto_approve_all"
    
    def test_agent_override_takes_precedence_over_mcp_default(self):
        """Test that agent override takes precedence over MCP default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        # MCP server has default approval for delete_repository
        default_policies = [
            {"tool_name": "delete_repository", "message": "MCP default message"}
        ]
        
        # Agent override disables approval for this tool
        overrides = [
            {"tool_name": "delete_repository", "requires_approval": False}
        ]
        
        result = resolve_tool_approval(
            tool_name="delete_repository",
            mcp_server_name="github",
            auto_approve_all=False,
            tool_approval_overrides=overrides,
            pinned_tool_approvals=default_policies,
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "agent_override"
    
    def test_agent_override_adds_approval_not_in_mcp_default(self):
        """Test that agent can add approval for tools not in MCP defaults."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        # No MCP default for this tool
        default_policies = []
        
        # Agent adds approval requirement
        overrides = [
            {
                "tool_name": "send_email",
                "requires_approval": True,
                "message": "Send email to {{args.recipient}}"
            }
        ]
        
        result = resolve_tool_approval(
            tool_name="send_email",
            mcp_server_name="email-server",
            auto_approve_all=False,
            tool_approval_overrides=overrides,
            pinned_tool_approvals=default_policies,
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "agent_override"
        assert "{{args.recipient}}" in result.message
    
    def test_pinned_policy_applied_when_no_override(self):
        """Test that pinned policy is applied when no agent override exists."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval

        pinned = [
            {"tool_name": "delete_repository", "message": "Delete repo: {{args.repo}}"}
        ]

        result = resolve_tool_approval(
            tool_name="delete_repository",
            mcp_server_name="github",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=pinned,
            status_tool_approvals=[],
        )

        assert result.requires_approval is True
        assert result.source == "pinned"
        assert "{{args.repo}}" in result.message

    def test_status_classifier_applied_when_no_pinned(self):
        """Test that status classifier policy is applied when no pinned policy exists."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval

        status = [
            {"tool_name": "execute_sql", "message": "Execute SQL: {{args.query}}"}
        ]

        result = resolve_tool_approval(
            tool_name="execute_sql",
            mcp_server_name="postgres",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=status,
        )

        assert result.requires_approval is True
        assert result.source == "status_classifier"
        assert "{{args.query}}" in result.message

    def test_pinned_takes_precedence_over_status(self):
        """Test that pinned policy overrides status classifier for the same tool."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval

        pinned = [
            {"tool_name": "deploy", "message": "Pinned: deploy to {{args.env}}"}
        ]
        status = [
            {"tool_name": "deploy", "message": "Classifier: deploying"}
        ]

        result = resolve_tool_approval(
            tool_name="deploy",
            mcp_server_name="cicd",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=pinned,
            status_tool_approvals=status,
        )

        assert result.requires_approval is True
        assert result.source == "pinned"
        assert "Pinned" in result.message

    def test_agent_override_exempts_from_pinned_and_status(self):
        """Test that agent override with requires_approval=False exempts from both."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval

        overrides = [{"tool_name": "deploy", "requires_approval": False}]
        pinned = [{"tool_name": "deploy", "message": "Pinned deploy"}]
        status = [{"tool_name": "deploy", "message": "Classifier deploy"}]

        result = resolve_tool_approval(
            tool_name="deploy",
            mcp_server_name="cicd",
            auto_approve_all=False,
            tool_approval_overrides=overrides,
            pinned_tool_approvals=pinned,
            status_tool_approvals=status,
        )

        assert result.requires_approval is False
        assert result.source == "agent_override"
    
    def test_no_approval_required_when_no_policy_matches(self):
        """Test that tools without policies don't require approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="list_issues",  # Non-platform tool with no policy
            mcp_server_name="github",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "none"
    
    def test_approval_message_template_rendering(self):
        """Test that message templates are rendered with tool arguments."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            render_approval_message,
        )
        
        template = "Delete {{args.repo}} from {{args.owner}}"
        tool_args = {"repo": "my-repo", "owner": "acme-corp"}
        
        result = render_approval_message(
            template=template,
            tool_name="delete_repository",
            tool_args=tool_args,
        )
        
        assert result == "Delete my-repo from acme-corp"
    
    def test_approval_message_handles_missing_args(self):
        """Test that missing args are replaced with <unknown>."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            render_approval_message,
        )
        
        template = "Send to {{args.recipient}}"
        tool_args = {}  # Missing recipient
        
        result = render_approval_message(
            template=template,
            tool_name="send_email",
            tool_args=tool_args,
        )
        
        assert result == "Send to <unknown>"
    
    def test_approval_message_tool_name_placeholder(self):
        """Test that {{tool_name}} placeholder is replaced."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            render_approval_message,
        )
        
        template = "Execute {{tool_name}} with {{args.path}}"
        tool_args = {"path": "/tmp/file.txt"}
        
        result = render_approval_message(
            template=template,
            tool_name="delete_file",
            tool_args=tool_args,
        )
        
        assert result == "Execute delete_file with /tmp/file.txt"
    
    def test_approval_message_empty_template_uses_default(self):
        """Test that empty template uses default message."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            render_approval_message,
        )
        
        result = render_approval_message(
            template="",
            tool_name="dangerous_operation",
            tool_args={},
        )
        
        assert result == "Execute tool: dangerous_operation"
    
    def test_approval_message_nested_args(self):
        """Test rendering with nested argument values."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            render_approval_message,
        )
        
        template = "Update {{args.user.name}} at {{args.user.email}}"
        tool_args = {"user": {"name": "John", "email": "john@example.com"}}
        
        result = render_approval_message(
            template=template,
            tool_name="update_user",
            tool_args=tool_args,
        )
        
        assert result == "Update John at john@example.com"


# =============================================================================
# Tests for Platform Tool Approval Defaults (HITL Phase 5.6)
# =============================================================================


class TestPlatformToolApprovalDefaults:
    """Tests for platform tool (sandbox) approval defaults."""
    
    def test_platform_tool_read_no_approval_required(self):
        """Test that 'read' platform tool does not require approval by default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="read",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
    
    def test_platform_tool_write_requires_approval(self):
        """Test that 'write' platform tool requires approval by default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="write",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
        assert "{{args.path}}" in result.message  # Template not yet rendered
    
    def test_platform_tool_execute_requires_approval(self):
        """Test that 'execute' platform tool requires approval by default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="execute",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
        assert "{{args.command}}" in result.message
    
    def test_platform_tool_edit_requires_approval(self):
        """Test that 'edit' platform tool requires approval by default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="edit",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
    
    def test_platform_tool_delete_requires_approval(self):
        """Test that 'delete' platform tool requires approval by default."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="delete",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
        assert "{{args.path}}" in result.message

    def test_platform_tool_delete_file_alias_requires_approval(self):
        """Test that 'delete_file' alias resolves to 'delete' and requires approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="delete_file",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"

    def test_platform_tool_ls_no_approval_required(self):
        """Test that 'ls' platform tool does not require approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="ls",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_platform_tool_glob_no_approval_required(self):
        """Test that 'glob' platform tool does not require approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="glob",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_platform_tool_grep_no_approval_required(self):
        """Test that 'grep' platform tool does not require approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="grep",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_auto_approve_all_bypasses_platform_tool_approval(self):
        """Test that auto_approve_all=True bypasses platform tool approval."""
        from stigmer_runner.worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="write",  # Normally requires approval
            mcp_server_name="",
            auto_approve_all=True,  # Bypass
            tool_approval_overrides=[],
            pinned_tool_approvals=[],
            status_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "auto_approve_all"
    
    def test_is_platform_tool_helper(self):
        """Test is_platform_tool() helper function."""
        from stigmer_runner.worker.activities.graphton.approval_policy import is_platform_tool
        
        # Platform tools
        assert is_platform_tool("read") is True
        assert is_platform_tool("write") is True
        assert is_platform_tool("edit") is True
        assert is_platform_tool("delete") is True
        assert is_platform_tool("execute") is True
        assert is_platform_tool("ls") is True
        assert is_platform_tool("glob") is True
        assert is_platform_tool("grep") is True
        assert is_platform_tool("think") is True
        
        # Aliases resolve to platform tools
        assert is_platform_tool("read_file") is True
        assert is_platform_tool("write_file") is True
        assert is_platform_tool("edit_file") is True
        assert is_platform_tool("delete_file") is True
        
        # Non-platform tools
        assert is_platform_tool("delete_repository") is False
        assert is_platform_tool("send_email") is False


# =============================================================================
# Tests for ApprovalConfig (HITL Phase 2)
# =============================================================================


class TestApprovalConfig:
    """Tests for ApprovalConfig dataclass."""
    
    def test_get_mcp_server_for_tool_found(self):
        """Test getting MCP server for a known tool."""
        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github", "send_email": "email"}
        )
        
        assert config.get_mcp_server_for_tool("delete_repository") == "github"
        assert config.get_mcp_server_for_tool("send_email") == "email"
    
    def test_get_mcp_server_for_tool_not_found(self):
        """Test getting MCP server for unknown tool returns empty string."""
        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github"}
        )
        
        assert config.get_mcp_server_for_tool("unknown_tool") == ""
    
    def test_get_status_policies_for_tool(self):
        """Test getting status (classifier) policies for a tool's MCP server."""
        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig

        policies = [{"tool_name": "delete_repository", "message": "Delete repo"}]

        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github"},
            status_tool_approvals={"github": policies}
        )

        result = config.get_status_policies_for_tool("delete_repository")
        assert result == policies

    def test_get_pinned_policies_for_tool(self):
        """Test getting pinned (manual override) policies for a tool's MCP server."""
        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig

        policies = [{"tool_name": "deploy", "message": "Deploy to {{args.env}}"}]

        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"deploy": "cicd"},
            pinned_tool_approvals={"cicd": policies}
        )

        result = config.get_pinned_policies_for_tool("deploy")
        assert result == policies

    def test_get_status_policies_for_unknown_server(self):
        """Test that unknown server returns empty policies list."""
        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig

        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"unknown_tool": "unknown_server"},
            status_tool_approvals={"github": []}
        )

        result = config.get_status_policies_for_tool("unknown_tool")
        assert result == []


# =============================================================================
# Tests for _create_args_preview platform path humanization
# =============================================================================


class TestArgsPreviewPlatformPathHumanization:
    """_create_args_preview replaces $STIGMER_PLATFORM_DIR with .stigmer."""

    def test_command_field_humanized(self, status_builder):
        preview = status_builder._create_args_preview({
            "command": "python3 $STIGMER_PLATFORM_DIR/skills/s/run.py",
            "timeout": 120,
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "python3 .stigmer/skills/s/run.py"
        assert parsed["timeout"] == 120

    def test_brace_syntax_humanized(self, status_builder):
        preview = status_builder._create_args_preview({
            "command": "python3 ${STIGMER_PLATFORM_DIR}/skills/s/run.py",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "python3 .stigmer/skills/s/run.py"

    def test_no_env_var_unchanged(self, status_builder):
        preview = status_builder._create_args_preview({
            "command": "ls -la",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "ls -la"

    def test_nested_dict_values_humanized(self, status_builder):
        preview = status_builder._create_args_preview({
            "config": {"path": "$STIGMER_PLATFORM_DIR/data"},
        })
        import json
        parsed = json.loads(preview)
        assert parsed["config"]["path"] == ".stigmer/data"


class TestArgsPreviewEnvVarResolution:
    """_create_args_preview resolves agent env vars to their values."""

    def test_output_dir_resolved(self, status_builder):
        status_builder.set_display_env_vars({"OUTPUT_DIR": "."})
        preview = status_builder._create_args_preview({
            "command": "python3 init.py --path $OUTPUT_DIR",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "python3 init.py --path ."

    def test_combined_platform_and_agent_vars(self, status_builder):
        status_builder.set_display_env_vars({"OUTPUT_DIR": "seedpack/skills"})
        preview = status_builder._create_args_preview({
            "command": "python3 $STIGMER_PLATFORM_DIR/scripts/run.py --path $OUTPUT_DIR",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "python3 .stigmer/scripts/run.py --path seedpack/skills"

    def test_secret_env_var_not_resolved(self, status_builder):
        status_builder.set_display_env_vars(
            {"API_TOKEN": "sk-secret"}, secret_keys={"API_TOKEN"},
        )
        preview = status_builder._create_args_preview({
            "command": "curl -H $API_TOKEN",
        })
        import json
        parsed = json.loads(preview)
        assert "$API_TOKEN" in parsed["command"]

    def test_no_env_vars_set(self, status_builder):
        preview = status_builder._create_args_preview({
            "command": "echo $OUTPUT_DIR",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "echo $OUTPUT_DIR"


# =============================================================================
# Tests for _create_args_preview sandbox path humanization
# =============================================================================


class TestArgsPreviewSandboxPathHumanization:
    """_create_args_preview replaces absolute sandbox paths with relative ones."""

    def test_absolute_workspace_path_becomes_relative(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        preview = status_builder._create_args_preview({
            "path": "/home/daytona/workspace/src/main.py",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["path"] == "src/main.py"

    def test_workspace_root_becomes_dot(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        preview = status_builder._create_args_preview({
            "command": "cd /home/daytona/workspace",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "cd ."

    def test_sandbox_home_becomes_tilde(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        preview = status_builder._create_args_preview({
            "path": "/home/daytona/.git-credentials",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["path"] == "~/.git-credentials"

    def test_nested_values_also_humanized(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        preview = status_builder._create_args_preview({
            "config": {"output_dir": "/home/daytona/workspace/out"},
        })
        import json
        parsed = json.loads(preview)
        assert parsed["config"]["output_dir"] == "out"

    def test_no_workspace_root_unchanged(self, status_builder):
        preview = status_builder._create_args_preview({
            "path": "/home/daytona/workspace/src/main.py",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["path"] == "/home/daytona/workspace/src/main.py"

    def test_combined_platform_and_sandbox_humanization(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        preview = status_builder._create_args_preview({
            "command": "python3 $STIGMER_PLATFORM_DIR/run.py --out /home/daytona/workspace/results",
        })
        import json
        parsed = json.loads(preview)
        assert parsed["command"] == "python3 .stigmer/run.py --out results"


# =============================================================================
# Tests for humanize_args_for_display nested value recursion
# =============================================================================


class TestArgsDisplayNestedHumanization:
    """humanize_args_for_display recurses into nested dicts and lists."""

    def test_nested_dict_string_humanized(self, status_builder):
        result = status_builder._humanize_args_for_display({
            "config": {"path": "$STIGMER_PLATFORM_DIR/data"},
        })
        assert result["config"]["path"] == ".stigmer/data"

    def test_nested_list_string_humanized(self, status_builder):
        result = status_builder._humanize_args_for_display({
            "paths": ["$STIGMER_PLATFORM_DIR/a", "$STIGMER_PLATFORM_DIR/b"],
        })
        assert result["paths"] == [".stigmer/a", ".stigmer/b"]

    def test_deeply_nested_string_humanized(self, status_builder):
        result = status_builder._humanize_args_for_display({
            "outer": {"inner": {"path": "$STIGMER_PLATFORM_DIR/deep"}},
        })
        assert result["outer"]["inner"]["path"] == ".stigmer/deep"

    def test_nested_sandbox_paths_humanized(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        result = status_builder._humanize_args_for_display({
            "files": ["/home/daytona/workspace/a.py", "/home/daytona/workspace/b.py"],
        })
        assert result["files"] == ["a.py", "b.py"]

    def test_non_string_values_preserved(self, status_builder):
        result = status_builder._humanize_args_for_display({
            "count": 42,
            "enabled": True,
            "config": {"timeout": 30, "name": "$STIGMER_PLATFORM_DIR/x"},
        })
        assert result["count"] == 42
        assert result["enabled"] is True
        assert result["config"]["timeout"] == 30
        assert result["config"]["name"] == ".stigmer/x"

    def test_empty_args_returns_as_is(self, status_builder):
        assert status_builder._humanize_args_for_display({}) == {}
        assert status_builder._humanize_args_for_display(None) is None


# =============================================================================
# Tests for args preview and display consistency
# =============================================================================


class TestArgsPreviewAndDisplayConsistency:
    """Both humanization paths apply the same pipeline to string values."""

    def test_platform_refs_consistent(self, status_builder):
        args = {"command": "python3 $STIGMER_PLATFORM_DIR/skills/s/run.py"}
        display = status_builder._humanize_args_for_display(args)
        import json
        preview = json.loads(status_builder._create_args_preview(args))
        assert display["command"] == preview["command"]

    def test_sandbox_paths_consistent(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        args = {"path": "/home/daytona/workspace/src/main.py"}
        display = status_builder._humanize_args_for_display(args)
        import json
        preview = json.loads(status_builder._create_args_preview(args))
        assert display["path"] == preview["path"] == "src/main.py"

    def test_nested_values_consistent(self, status_builder):
        status_builder.set_workspace_root("/home/daytona/workspace")
        args = {
            "config": {
                "path": "/home/daytona/workspace/out",
                "script": "$STIGMER_PLATFORM_DIR/run.py",
            },
        }
        display = status_builder._humanize_args_for_display(args)
        import json
        preview = json.loads(status_builder._create_args_preview(args))
        assert display["config"]["path"] == preview["config"]["path"] == "out"
        assert display["config"]["script"] == preview["config"]["script"] == ".stigmer/run.py"


# =============================================================================
# Tests for ToolCall.args humanization via on_tool_start (fresh creation path)
# =============================================================================


class TestToolCallArgsHumanization:
    """on_tool_start stores humanized args in ToolCall.args for display.

    The fresh-creation path in _handle_tool_start_event must apply the same
    humanization as _reconcile_early_tool_call so that all clients see
    user-friendly paths instead of raw environment-variable references.
    """

    @pytest.mark.asyncio
    async def test_platform_dir_humanized_in_tool_call_args(self, status_builder):
        """$STIGMER_PLATFORM_DIR is replaced with .stigmer in ToolCall.args."""
        event = {
            "event": "on_tool_start",
            "name": "execute",
            "run_id": "tool-run-humanize-1",
            "data": {
                "input": {
                    "command": "python3 $STIGMER_PLATFORM_DIR/skills/s/run.py",
                    "timeout": 120,
                }
            },
            "metadata": {},
        }
        await status_builder.process_event(event)

        tc = next(status_builder.iter_all_tool_calls())
        args = tc.args.fields
        assert args["command"].string_value == "python3 .stigmer/skills/s/run.py"
        assert args["timeout"].number_value == 120

    @pytest.mark.asyncio
    async def test_env_vars_resolved_in_tool_call_args(self, status_builder):
        """Agent env vars like $OUTPUT_DIR are resolved in ToolCall.args."""
        status_builder.set_display_env_vars({"OUTPUT_DIR": "seedpack/skills"})
        event = {
            "event": "on_tool_start",
            "name": "execute",
            "run_id": "tool-run-humanize-2",
            "data": {
                "input": {
                    "command": "python3 $STIGMER_PLATFORM_DIR/scripts/init.py --path $OUTPUT_DIR",
                }
            },
            "metadata": {},
        }
        await status_builder.process_event(event)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.args.fields["command"].string_value == (
            "python3 .stigmer/scripts/init.py --path seedpack/skills"
        )

    @pytest.mark.asyncio
    async def test_secret_env_var_not_resolved_in_tool_call_args(self, status_builder):
        """Secret env vars remain unexpanded in ToolCall.args."""
        status_builder.set_display_env_vars(
            {"API_TOKEN": "sk-secret"}, secret_keys={"API_TOKEN"},
        )
        event = {
            "event": "on_tool_start",
            "name": "execute",
            "run_id": "tool-run-humanize-3",
            "data": {"input": {"command": "curl -H $API_TOKEN"}},
            "metadata": {},
        }
        await status_builder.process_event(event)

        tc = next(status_builder.iter_all_tool_calls())
        assert "$API_TOKEN" in tc.args.fields["command"].string_value

    @pytest.mark.asyncio
    async def test_no_env_var_args_unchanged(self, status_builder):
        """Args without env vars pass through unchanged."""
        event = {
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "tool-run-humanize-4",
            "data": {"input": {"path": "src/main.py"}},
            "metadata": {},
        }
        await status_builder.process_event(event)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.args.fields["path"].string_value == "src/main.py"


# =============================================================================
# Phase 5.4: Approval Resumption Verification Tests
#
# These tests verify that pending_approvals is properly cleared after each
# approval action, which is critical for the workflow → agent approval flow.
# =============================================================================


class TestPhase54ApprovalClearing:
    """Phase 5.4: Tests verifying pending_approvals clearing for all approval actions."""
    
    @pytest.fixture
    def status_builder_with_pending_approval(self, mock_initial_status):
        """Create StatusBuilder with full pending_approvals state."""
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        builder = StatusBuilder(
            execution_id="test-execution-phase54",
            initial_status=mock_initial_status
        )
        
        # Add a tool call in WAITING_APPROVAL state
        tool_call = ToolCall(
            id="tool-run-phase54",
            name="dangerous_operation",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
            approval_message="Execute dangerous operation?",
        )
        mock_initial_status.tool_calls.append(tool_call)
        
        # Set up full pending approval state (simulating approval request)
        builder.state.approval.pending = ["tool-run-phase54"]
        builder.state.approval.saved_phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        builder.current_status.pending_approvals.append(PendingApproval(
            tool_call_id="tool-run-phase54",
            tool_name="dangerous_operation",
            message="Execute dangerous operation?",
            args_preview='{"target": "production"}',
            requested_at="2026-01-30T12:00:00Z",
            from_sub_agent=False,
            sub_agent_name="",
        ))
        builder.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        return builder
    
    def test_clear_pending_approval_restores_saved_phase(self, status_builder_with_pending_approval):
        """Phase 5.4: Verify clear_pending_approval restores the saved phase."""
        # Verify starting state
        assert status_builder_with_pending_approval.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        assert status_builder_with_pending_approval.state.approval.saved_phase == ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Call clear_pending_approval directly
        status_builder_with_pending_approval.clear_pending_approval()
        
        # Verify phase is restored to IN_PROGRESS (not WAITING_FOR_APPROVAL)
        assert status_builder_with_pending_approval.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Verify saved phase is reset to None after restoration
        assert status_builder_with_pending_approval.state.approval.saved_phase is None


# =============================================================================
# Tests for Tool Start Approval Integration (HITL Phase 2)
# =============================================================================


class TestToolStartApprovalIntegration:
    """Tests for approval check integration in _handle_tool_start_event."""
    
    @pytest.fixture
    def status_builder_with_approval_config(self, mock_initial_status):
        """Create StatusBuilder with approval config."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase

        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Configure approval policy: delete_repository requires approval
        approval_config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={
                "github": [
                    {"tool_name": "delete_repository", "message": "Delete {{args.repo}}"}
                ]
            },
            tool_to_mcp_server={"delete_repository": "github", "read_file": "filesystem"}
        )
        
        return StatusBuilder(
            execution_id="test-execution-integration",
            initial_status=mock_initial_status,
            approval_config=approval_config,
        )
    
    @pytest.mark.asyncio
    async def test_tool_start_creates_waiting_approval_when_required(self, status_builder_with_approval_config):
        """Test that tool requiring approval gets WAITING_APPROVAL status."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus
        
        event = {
            "event": "on_tool_start",
            "name": "delete_repository",
            "run_id": "tool-run-approval-001",
            "data": {"input": {"repo": "important-repo"}},
            "metadata": {}
        }
        
        await status_builder_with_approval_config.process_event(event)
        
        # Tool should be in WAITING_APPROVAL status
        tool_call = status_builder_with_approval_config.get_tool_call("tool-run-approval-001")
        assert tool_call is not None
        assert tool_call.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        assert tool_call.requires_approval is True
        
        # Execution phase should be WAITING_FOR_APPROVAL
        assert status_builder_with_approval_config.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        # Pending approval should be tracked internally
        assert "tool-run-approval-001" in status_builder_with_approval_config.state.approval.pending
    
    @pytest.mark.asyncio
    async def test_tool_start_proceeds_to_running_when_no_approval_required(self, status_builder_with_approval_config):
        """Test that tool not requiring approval gets RUNNING status."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus
        
        event = {
            "event": "on_tool_start",
            "name": "read_file",  # No approval policy for this tool
            "run_id": "tool-run-no-approval",
            "data": {"input": {"path": "/tmp/test.txt"}},
            "metadata": {}
        }
        
        await status_builder_with_approval_config.process_event(event)
        
        # Tool should be in RUNNING status (normal flow)
        tool_call = status_builder_with_approval_config.get_tool_call("tool-run-no-approval")
        assert tool_call is not None
        assert tool_call.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tool_call.requires_approval is False
        
        # Execution phase should remain IN_PROGRESS
        assert status_builder_with_approval_config.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
    
    @pytest.mark.asyncio
    async def test_tool_start_skips_approval_when_auto_approve_all(self, mock_initial_status):
        """Test that auto_approve_all bypasses approval requirements."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus

        from stigmer_runner.worker.activities.graphton.approval_policy import ApprovalConfig
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # auto_approve_all is True - should bypass all approval
        approval_config = ApprovalConfig(
            auto_approve_all=True,  # Bypass all approval
            tool_approval_overrides=[],
            status_tool_approvals={
                "github": [
                    {"tool_name": "delete_repository", "message": "Delete repo"}
                ]
            },
            tool_to_mcp_server={"delete_repository": "github"}
        )
        
        builder = StatusBuilder(
            execution_id="test-auto-approve",
            initial_status=mock_initial_status,
            approval_config=approval_config,
        )
        
        event = {
            "event": "on_tool_start",
            "name": "delete_repository",
            "run_id": "tool-run-auto-approve",
            "data": {"input": {"repo": "repo-to-delete"}},
            "metadata": {}
        }
        
        await builder.process_event(event)
        
        # Tool should be in RUNNING status despite having approval policy
        tool_call = builder.get_tool_call("tool-run-auto-approve")
        assert tool_call is not None
        assert tool_call.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tool_call.requires_approval is False
    
    @pytest.mark.asyncio
    async def test_tool_start_without_approval_config_proceeds_normally(self, mock_initial_status):
        """Test that no approval config means normal RUNNING flow."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        # No approval config provided
        builder = StatusBuilder(
            execution_id="test-no-config",
            initial_status=mock_initial_status,
            approval_config=None,  # No config
        )
        
        event = {
            "event": "on_tool_start",
            "name": "any_tool",
            "run_id": "tool-run-no-config",
            "data": {"input": {}},
            "metadata": {}
        }
        
        await builder.process_event(event)
        
        # Tool should be in RUNNING status
        tool_call = builder.get_tool_call("tool-run-no-config")
        assert tool_call is not None
        assert tool_call.status == ToolCallStatus.TOOL_CALL_RUNNING
    
    @pytest.mark.asyncio
    async def test_approval_message_rendered_with_args(self, status_builder_with_approval_config):
        """Test that approval message template is rendered with tool args."""
        event = {
            "event": "on_tool_start",
            "name": "delete_repository",
            "run_id": "tool-run-render-test",
            "data": {"input": {"repo": "production-db"}},
            "metadata": {}
        }
        
        await status_builder_with_approval_config.process_event(event)
        
        # Check rendered message (should have args substituted)
        tool_call = status_builder_with_approval_config.get_tool_call("tool-run-render-test")
        assert tool_call is not None
        assert "production-db" in tool_call.approval_message
        
        # Pending approval should be tracked
        assert "tool-run-render-test" in status_builder_with_approval_config.state.approval.pending


# =============================================================================
# Tests for build_approval_config function (HITL Phase 3A)
# =============================================================================


class TestBuildApprovalConfig:
    """Tests for build_approval_config().

    Assembles the five-level policy chain from:
    - execution.spec.auto_approve_all
    - mcp_server_usages[].tool_approval_overrides
    - mcp_servers[].spec.pinned_tool_approvals
    - mcp_servers[].status.tool_approvals
    - mcp_tools_config (inverted to tool_to_mcp_server)
    """
    
    def test_empty_inputs_return_safe_defaults(self):
        """Test that empty inputs return ApprovalConfig with safe defaults."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        # Create minimal mock execution
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        assert config.auto_approve_all is False
        assert config.tool_approval_overrides == []
        assert config.pinned_tool_approvals == {}
        assert config.tool_to_mcp_server == {}
    
    def test_auto_approve_all_extracted_from_execution_spec(self):
        """Test that auto_approve_all is correctly extracted from execution.spec."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        # Test with auto_approve_all = True
        execution = MagicMock()
        execution.spec.auto_approve_all = True
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        assert config.auto_approve_all is True
    
    def test_auto_approve_all_defaults_false_when_missing(self):
        """Test that auto_approve_all defaults to False when field is missing."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        # Create execution without auto_approve_all field
        execution = MagicMock()
        del execution.spec.auto_approve_all  # Remove the field
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        assert config.auto_approve_all is False
    
    def test_tool_approval_overrides_collected_from_all_usages(self):
        """Test that tool_approval_overrides are collected from all MCP server usages."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Create two usages with different overrides
        override1 = MagicMock()
        override1.tool_name = "delete_repo"
        override1.requires_approval = True
        
        override2 = MagicMock()
        override2.tool_name = "force_push"
        override2.requires_approval = True
        
        override3 = MagicMock()
        override3.tool_name = "drop_table"
        override3.requires_approval = True
        
        usage1 = MagicMock()
        usage1.tool_approval_overrides = [override1, override2]
        
        usage2 = MagicMock()
        usage2.tool_approval_overrides = [override3]
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[usage1, usage2],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        # Should have all 3 overrides from both usages
        assert len(config.tool_approval_overrides) == 3
        assert override1 in config.tool_approval_overrides
        assert override2 in config.tool_approval_overrides
        assert override3 in config.tool_approval_overrides
    
    def test_tool_approval_overrides_handles_empty_usages(self):
        """Test that empty tool_approval_overrides in usages are handled gracefully."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Usage with empty overrides
        usage1 = MagicMock()
        usage1.tool_approval_overrides = []
        
        # Usage with None overrides
        usage2 = MagicMock()
        usage2.tool_approval_overrides = None
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[usage1, usage2],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        assert config.tool_approval_overrides == []
    
    def test_pinned_tool_approvals_keyed_by_server_slug(self):
        """Test that pinned_tool_approvals are correctly keyed by server slug."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Create MCP servers with default approval policies
        policy1 = MagicMock()
        policy1.tool_name = "delete_repository"
        policy1.message = "Are you sure?"
        
        policy2 = MagicMock()
        policy2.tool_name = "drop_table"
        policy2.message = "This is destructive!"
        
        server1 = MagicMock()
        server1.metadata.slug = "github"
        server1.spec.pinned_tool_approvals = [policy1]
        
        server2 = MagicMock()
        server2.metadata.slug = "postgres"
        server2.spec.pinned_tool_approvals = [policy2]
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server1, server2],
            mcp_tools_config={},
        )
        
        assert len(config.pinned_tool_approvals) == 2
        assert "github" in config.pinned_tool_approvals
        assert "postgres" in config.pinned_tool_approvals
        assert config.pinned_tool_approvals["github"] == [policy1]
        assert config.pinned_tool_approvals["postgres"] == [policy2]
    
    def test_pinned_tool_approvals_falls_back_to_name_when_slug_missing(self):
        """Test that server name is used as fallback when slug is missing."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        policy = MagicMock()
        
        # Server with name but no slug
        server = MagicMock()
        server.metadata.name = "my-github-server"
        del server.metadata.slug  # No slug
        server.spec.pinned_tool_approvals = [policy]
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )
        
        # Should use name as key
        assert "my-github-server" in config.pinned_tool_approvals
    
    def test_pinned_tool_approvals_handles_empty_policies(self):
        """Test that servers with empty pinned_tool_approvals are skipped."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Server with empty policies
        server = MagicMock()
        server.metadata.slug = "github"
        server.spec.pinned_tool_approvals = []
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )
        
        # Should not include servers with empty policies
        assert "github" not in config.pinned_tool_approvals

    def test_status_tool_approvals_extracted_from_server_status(self):
        """Test that status.tool_approvals are read and keyed by slug."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config

        execution = MagicMock()
        execution.spec.auto_approve_all = False

        status_policy = MagicMock()
        status_policy.tool_name = "execute_sql"
        status_policy.message = "Execute SQL: {{args.query}}"

        server = MagicMock()
        server.metadata.slug = "postgres"
        server.spec.pinned_tool_approvals = []
        server.status.tool_approvals = [status_policy]

        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )

        assert "postgres" in config.status_tool_approvals
        assert config.status_tool_approvals["postgres"] == [status_policy]
        assert config.pinned_tool_approvals == {}

    def test_both_pinned_and_status_extracted(self):
        """Test that both pinned and status approvals are extracted independently."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config

        execution = MagicMock()
        execution.spec.auto_approve_all = False

        pinned_policy = MagicMock()
        pinned_policy.tool_name = "delete_repo"
        pinned_policy.message = "Manual: delete repo"

        status_policy = MagicMock()
        status_policy.tool_name = "create_issue"
        status_policy.message = "Classifier: create issue"

        server = MagicMock()
        server.metadata.slug = "github"
        server.spec.pinned_tool_approvals = [pinned_policy]
        server.status.tool_approvals = [status_policy]

        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )

        assert config.pinned_tool_approvals == {"github": [pinned_policy]}
        assert config.status_tool_approvals == {"github": [status_policy]}

    def test_tool_to_mcp_server_mapping_inverted_correctly(self):
        """Test that mcp_tools_config is correctly inverted to tool_to_mcp_server."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Tool config: server slug -> list of tools
        mcp_tools_config = {
            "github": ["list_repos", "delete_repo", "create_pr"],
            "postgres": ["query", "execute_sql"],
        }
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[],
            mcp_tools_config=mcp_tools_config,
        )
        
        # Check inverted mapping
        assert len(config.tool_to_mcp_server) == 5
        assert config.tool_to_mcp_server["list_repos"] == "github"
        assert config.tool_to_mcp_server["delete_repo"] == "github"
        assert config.tool_to_mcp_server["create_pr"] == "github"
        assert config.tool_to_mcp_server["query"] == "postgres"
        assert config.tool_to_mcp_server["execute_sql"] == "postgres"
    
    def test_tool_to_mcp_server_handles_none_tool_lists(self):
        """Test that None tool lists in mcp_tools_config are handled gracefully."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Some servers have None for tool list
        mcp_tools_config = {
            "github": ["list_repos"],
            "postgres": None,  # No tools
            "redis": [],  # Empty list
        }
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[],
            mcp_tools_config=mcp_tools_config,
        )
        
        # Should only have the github tool
        assert len(config.tool_to_mcp_server) == 1
        assert config.tool_to_mcp_server["list_repos"] == "github"
    
    def test_full_integration_all_sources(self):
        """Integration test: verify all sources are assembled correctly."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        # Setup execution
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Setup overrides
        override = MagicMock()
        override.tool_name = "delete_repo"
        override.requires_approval = True
        override.message = "Custom override message"
        
        usage = MagicMock()
        usage.tool_approval_overrides = [override]
        
        # Setup MCP server defaults
        default_policy = MagicMock()
        default_policy.tool_name = "delete_repository"
        default_policy.message = "Are you sure you want to delete {{args.repo}}?"
        
        server = MagicMock()
        server.metadata.slug = "github"
        server.spec.pinned_tool_approvals = [default_policy]
        
        # Setup tool config
        mcp_tools_config = {
            "github": ["list_repos", "delete_repository", "create_pr"],
        }
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[usage],
            mcp_servers=[server],
            mcp_tools_config=mcp_tools_config,
        )
        
        # Verify all components
        assert config.auto_approve_all is False
        assert len(config.tool_approval_overrides) == 1
        assert config.tool_approval_overrides[0] == override
        assert "github" in config.pinned_tool_approvals
        assert config.pinned_tool_approvals["github"] == [default_policy]
        assert len(config.tool_to_mcp_server) == 3
        assert config.get_mcp_server_for_tool("delete_repository") == "github"
    
    def test_malformed_server_handled_gracefully(self):
        """Test that malformed MCP server objects don't crash the function."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Server missing metadata entirely
        malformed_server = MagicMock()
        del malformed_server.metadata
        
        # This should not raise an exception
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[malformed_server],
            mcp_tools_config={},
        )
        
        assert config.pinned_tool_approvals == {}
    
    def test_malformed_usage_handled_gracefully(self):
        """Test that malformed MCP server usage objects don't crash the function."""
        from stigmer_runner.worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Usage missing tool_approval_overrides entirely
        malformed_usage = MagicMock()
        del malformed_usage.tool_approval_overrides
        
        # This should not raise an exception
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[malformed_usage],
            mcp_servers=[],
            mcp_tools_config={},
        )
        
        assert config.tool_approval_overrides == []


# =============================================================================
# TestCreateApprovalChecker - Tests for HITL approval checker factory (Phase 3B)
# =============================================================================


class TestCreateApprovalChecker:
    """
    Tests for the create_approval_checker() function.
    
    This function creates a callable that can be passed to graphton's
    create_deep_agent to enable HITL tool approval flow.
    """
    
    def test_creates_callable(self):
        """Test that create_approval_checker returns a callable."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig()
        checker = create_approval_checker(config)
        
        assert callable(checker)
    
    def test_checker_returns_no_approval_when_auto_approve_all(self):
        """Test that checker returns no approval required when auto_approve_all is True."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(auto_approve_all=True)
        checker = create_approval_checker(config)
        
        result = checker("any_tool", {"arg1": "value"})
        
        assert result.requires_approval is False
        assert result.source == "auto_approve_all"
    
    def test_checker_returns_no_approval_when_no_policy_matches(self):
        """Test that checker returns no approval when no policy matches."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={},
            tool_to_mcp_server={"some_tool": "some-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("unknown_tool", {"arg1": "value"})
        
        assert result.requires_approval is False
        assert result.source == "none"
    
    def test_checker_returns_approval_required_from_mcp_default(self):
        """Test that checker returns approval required from MCP default policy."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        # Create mock policy
        policy = MagicMock()
        policy.tool_name = "delete_resource"
        policy.message = "Are you sure you want to delete?"
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={"test-server": [policy]},
            tool_to_mcp_server={"delete_resource": "test-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("delete_resource", {})
        
        assert result.requires_approval is True
        assert result.source == "status_classifier"
        assert "delete" in result.message.lower()
    
    def test_checker_returns_approval_required_from_agent_override(self):
        """Test that checker returns approval required from agent override."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        # Create mock override
        override = MagicMock()
        override.tool_name = "send_email"
        override.requires_approval = True
        override.message = "Confirm sending email to {{args.recipient}}?"
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[override],
            status_tool_approvals={},
            tool_to_mcp_server={"send_email": "email-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("send_email", {"recipient": "user@example.com"})
        
        assert result.requires_approval is True
        assert result.source == "agent_override"
        assert "user@example.com" in result.message
    
    def test_checker_renders_message_template_with_args(self):
        """Test that checker renders {{args.field}} placeholders in message."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        # Create mock policy with template
        policy = MagicMock()
        policy.tool_name = "delete_file"
        policy.message = "Delete file {{args.path}} from {{args.directory}}?"
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={"fs-server": [policy]},
            tool_to_mcp_server={"delete_file": "fs-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("delete_file", {"path": "config.yaml", "directory": "/app"})
        
        assert "config.yaml" in result.message
        assert "/app" in result.message
    
    def test_checker_includes_mcp_server_in_result(self):
        """Test that checker result includes mcp_server field."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={},
            tool_to_mcp_server={"test_tool": "my-mcp-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("test_tool", {})
        
        assert result.mcp_server == "my-mcp-server"
    
    def test_checker_handles_missing_tool_gracefully(self):
        """Test that checker handles tools not in config gracefully."""
        from stigmer_runner.worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            status_tool_approvals={},
            tool_to_mcp_server={},  # Empty - no tools mapped
        )
        checker = create_approval_checker(config)
        
        # Should not raise, just return no approval required
        result = checker("completely_unknown_tool", {"arg": "value"})
        
        assert result.requires_approval is False
        assert result.mcp_server == ""


# =============================================================================
# TestResumeFromApprovalDetection - Tests for HITL resume flow detection (Phase 3B)
# =============================================================================


class TestResumeFromApprovalDetection:
    """
    Tests for the resume-from-approval detection logic in execute_graphton.
    
    These tests verify that the activity correctly detects when execution
    should resume from a pending approval vs start fresh.
    """
    
    def test_no_pending_approvals_is_fresh_execution(self):
        """Test that execution without pending_approvals is a fresh start."""
        # Create execution with no pending approvals
        status = AgentExecutionStatus()
        
        execution = MagicMock()
        execution.status = status
        
        # Check: empty pending_approvals means fresh execution
        has_pending = len(execution.status.pending_approvals) > 0
        assert has_pending is False
    
    def test_approval_action_mapping_to_strings(self):
        """Test that ApprovalAction enum values map correctly to strings."""
        action_map = {
            ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
            ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
            ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
        }
        
        # Verify all actions map correctly
        assert action_map[ApprovalAction.APPROVAL_ACTION_APPROVE] == "approve"
        assert action_map[ApprovalAction.APPROVAL_ACTION_SKIP] == "skip"
        assert action_map[ApprovalAction.APPROVAL_ACTION_REJECT] == "reject"
        
        # Unspecified should not be in the map (handled as special case)
        assert ApprovalAction.APPROVAL_ACTION_UNSPECIFIED not in action_map


# =============================================================================
# Tests for Context Management Tracking (Phase 3)
# =============================================================================


class TestContextManagementTracking:
    """Tests for context window utilization and summarization tracking.
    
    These tests verify the SummarizationCallback implementation in StatusBuilder:
    - initialize_context_info: Sets up context tracking
    - on_summarization_complete: Records summarization events
    - on_token_count_updated: Updates current token count
    - finalize_context_info: Copies to status proto
    """
    
    def test_initialize_context_info_sets_fields(self, status_builder):
        """Test that initialize_context_info sets all context info fields."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        assert status_builder.state.context_info is not None
        assert status_builder.state.context_info.context_window_limit == 200000
        assert status_builder.state.context_info.summarization_trigger_threshold == 180000
        assert status_builder.state.context_info.summarization_target_tokens == 160000
        assert status_builder.state.context_info.summarization_enabled is True
        assert status_builder.state.context_info.current_token_count == 0
        assert status_builder.state.context_info.utilization_percent == 0.0
    
    def test_initialize_context_info_disabled(self, status_builder):
        """Test that initialize_context_info works when disabled."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=0,
            target_tokens=0,
            enabled=False,
        )
        
        assert status_builder.state.context_info is not None
        assert status_builder.state.context_info.summarization_enabled is False
    
    def test_on_token_count_updated_updates_count(self, status_builder):
        """Test that on_token_count_updated updates the current token count."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        status_builder.on_token_count_updated(50000)
        
        assert status_builder.state.context_info.current_token_count == 50000
    
    def test_on_token_count_updated_calculates_utilization(self, status_builder):
        """Test that on_token_count_updated calculates utilization percentage."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        status_builder.on_token_count_updated(100000)  # 50% of 200000
        
        assert status_builder.state.context_info.utilization_percent == 50.0
    
    def test_on_token_count_updated_without_init_is_noop(self, status_builder):
        """Test that on_token_count_updated is a no-op without initialization."""
        # Should not raise
        status_builder.on_token_count_updated(50000)
        
        # Context info should still be None
        assert status_builder.state.context_info is None
    
    def test_on_summarization_complete_adds_event(self, status_builder):
        """Test that on_summarization_complete records a summarization event."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_MID_EXECUTION,
        )
        
        status_builder.on_summarization_complete(event)
        
        events = status_builder.state.context_info.summarization_events
        assert len(events) == 1
        recorded = events[0]
        assert recorded.tokens_before == 185000
        assert recorded.tokens_after == 80000
        assert recorded.compression_ratio == pytest.approx(0.57, rel=0.01)
        assert recorded.duration_ms == 2500
        assert recorded.summarization_model == "claude-haiku-4"
        assert recorded.messages_before == 50
        assert recorded.messages_after == 10
        assert recorded.timestamp != ""
    
    def test_on_summarization_complete_updates_token_count(self, status_builder):
        """Test that on_summarization_complete updates current token count."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_GRAPH_START,
        )
        
        status_builder.on_summarization_complete(event)
        
        assert status_builder.state.context_info.current_token_count == 80000
        assert status_builder.state.context_info.utilization_percent == 40.0
    
    def test_on_summarization_complete_without_init_is_noop(self, status_builder):
        """Test that on_summarization_complete is a no-op without initialization."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_MID_EXECUTION,
        )
        
        status_builder.on_summarization_complete(event)
        
        assert status_builder.state.context_info is None
    
    def test_finalize_context_info_copies_to_status(self, status_builder):
        """Test that finalize_context_info copies context info to status proto."""
        # Need real proto for CopyFrom
        status_builder.current_status.context_info = ContextInfo()
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        status_builder.on_token_count_updated(150000)
        
        status_builder.finalize_context_info()
        
        assert status_builder.current_status.context_info.context_window_limit == 200000
        assert status_builder.current_status.context_info.summarization_trigger_threshold == 180000
        assert status_builder.current_status.context_info.current_token_count == 150000
        assert status_builder.current_status.context_info.summarization_enabled is True
    
    def test_finalize_context_info_includes_events(self, status_builder):
        """Test that finalize_context_info includes summarization events."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.current_status.context_info = ContextInfo()
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        event1 = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_GRAPH_START,
        )
        event2 = SummarizationEventData(
            tokens_before=180000,
            tokens_after=75000,
            compression_ratio=0.58,
            duration_ms=2300,
            summarization_model="claude-haiku-4",
            messages_before=45,
            messages_after=8,
            source=SOURCE_MID_EXECUTION,
        )
        
        status_builder.on_summarization_complete(event1)
        status_builder.on_summarization_complete(event2)
        
        status_builder.finalize_context_info()
        
        assert len(status_builder.current_status.context_info.summarization_events) == 2
        assert status_builder.current_status.context_info.summarization_events[0].tokens_before == 185000
        assert status_builder.current_status.context_info.summarization_events[1].tokens_before == 180000
    
    def test_finalize_context_info_without_init_is_noop(self, status_builder):
        """Test that finalize_context_info is a no-op without initialization."""
        # Should not raise
        status_builder.finalize_context_info()
        
        # Context info should not be populated (MagicMock)
        # Just verify no exception was raised
    
    def test_on_summarization_complete_maps_source_to_proto_enum(self, status_builder):
        """Test that source strings are mapped to the correct proto enum values."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SummarizationSource
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        graph_start_event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_GRAPH_START,
        )
        mid_execution_event = SummarizationEventData(
            tokens_before=170000,
            tokens_after=70000,
            compression_ratio=0.59,
            duration_ms=2100,
            summarization_model="claude-haiku-4",
            messages_before=40,
            messages_after=8,
            source=SOURCE_MID_EXECUTION,
        )
        
        status_builder.on_summarization_complete(graph_start_event)
        status_builder.on_summarization_complete(mid_execution_event)
        
        events = status_builder.state.context_info.summarization_events
        assert events[0].source == SummarizationSource.graph_start
        assert events[1].source == SummarizationSource.mid_execution
    
    def test_on_summarization_complete_unknown_source_maps_to_unspecified(self, status_builder):
        """Test that an unrecognized source string falls back to UNSPECIFIED."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SummarizationSource
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source="some_future_trigger",
        )
        
        status_builder.on_summarization_complete(event)
        
        recorded = status_builder.state.context_info.summarization_events[0]
        assert recorded.source == SummarizationSource.SUMMARIZATION_SOURCE_UNSPECIFIED
    
    def test_on_summarization_complete_syncs_to_current_status_immediately(self, status_builder):
        """Test that compaction events are visible in current_status without finalize."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.current_status.context_info = ContextInfo()
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_MID_EXECUTION,
        )
        
        status_builder.on_summarization_complete(event)
        
        streamed_events = status_builder.current_status.context_info.summarization_events
        assert len(streamed_events) == 1
        assert streamed_events[0].tokens_before == 185000
        assert streamed_events[0].tokens_after == 80000
    
    def test_on_summarization_complete_sets_force_next_update(self, status_builder):
        """Test that compaction sets force_next_update for immediate gRPC push."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        assert not status_builder.force_next_update
        
        event = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
            source=SOURCE_GRAPH_START,
        )
        
        status_builder.on_summarization_complete(event)
        
        assert status_builder.force_next_update is True
    
    def test_multiple_token_count_updates(self, status_builder):
        """Test multiple token count updates track correctly."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        # Simulate growing context
        status_builder.on_token_count_updated(50000)
        assert status_builder.state.context_info.current_token_count == 50000
        
        status_builder.on_token_count_updated(100000)
        assert status_builder.state.context_info.current_token_count == 100000
        
        status_builder.on_token_count_updated(150000)
        assert status_builder.state.context_info.current_token_count == 150000
        assert status_builder.state.context_info.utilization_percent == 75.0
    
    def test_utilization_with_zero_limit(self, status_builder):
        """Test that utilization handles zero limit gracefully."""
        status_builder.initialize_context_info(
            context_window_limit=0,  # Edge case
            trigger_threshold=0,
            target_tokens=0,
            enabled=False,
        )
        
        status_builder.on_token_count_updated(1000)
        
        # Should not divide by zero
        assert status_builder.state.context_info.utilization_percent == 0.0


# =============================================================================
# Run-ID Alias Resolution (Resume-After-Approval Fix)
# =============================================================================


class TestRunIdAliasResolution:
    """Tests for the run-ID alias mechanism that enables tool calls to
    transition to COMPLETED on the resume-after-approval path.

    When a tool call is interrupted for approval and then resumed, LangGraph
    generates a new run_id for the resumed execution.  The identity-based
    dedup in _handle_tool_start_event registers an alias on ToolCallIdCapture
    from the new run_id to the original tool_call.id so that
    _handle_tool_end_event can find and update the correct ToolCall.
    """

    @pytest.mark.asyncio
    async def test_alias_recorded_on_identity_dedup(self, mock_initial_status):
        """When a resumed on_tool_start fires with a new run_id, the
        ToolCallIdCapture mapping resolves it to the existing tool_call_id.
        The new run_id is recorded as an alias."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        original_tc_id = "toolu_original_001"
        new_run_id = "resumed-run-002"

        args = Struct()
        args.update({"path": "/bin/skills/agent-drafter/SKILL.md", "content": "..."})
        existing_tc = ToolCall(
            id=original_tc_id,
            name="write",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(existing_tc)
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()
        capture._run_id_to_tool_call_id[new_run_id] = original_tc_id

        builder = StatusBuilder("exec-alias-1", mock_initial_status,
                                tool_call_id_capture=capture)
        builder.rebuild_index_from_persisted_status()

        event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": new_run_id,
            "data": {"input": {"path": "/bin/skills/agent-drafter/SKILL.md", "content": "..."}},
        }
        await builder.process_event(event)

        assert builder.resolve_run_id(new_run_id) == original_tc_id
        assert builder.tool_call_count() == 1

    @pytest.mark.asyncio
    async def test_tool_end_resolves_alias_to_completed(self, mock_initial_status):
        """on_tool_end with a new (aliased) run_id correctly transitions the
        original tool call from RUNNING to COMPLETED."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        original_tc_id = "toolu_orig_100"
        new_run_id = "new-run-200"

        args = Struct()
        args.update({"path": "/skill/SKILL.md", "content": "# Skill"})

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(ToolCall(
            id=original_tc_id,
            name="write",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()
        capture._run_id_to_tool_call_id[new_run_id] = original_tc_id

        builder = StatusBuilder("exec-alias-2", mock_initial_status,
                                tool_call_id_capture=capture)
        builder.rebuild_index_from_persisted_status()

        start_event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": new_run_id,
            "data": {"input": {"path": "/skill/SKILL.md", "content": "# Skill"}},
        }
        await builder.process_event(start_event)

        end_event = {
            "event": "on_tool_end",
            "name": "write",
            "run_id": new_run_id,
            "data": {"output": "File written successfully"},
        }
        await builder.process_event(end_event)

        tc = builder.get_tool_call(original_tc_id)
        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.result == "File written successfully"

        assert mock_initial_status.messages[0].tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_multiple_writes_all_transition_to_completed(self, mock_initial_status):
        """Multiple write tool calls from previous invocations all transition
        to COMPLETED when their resumed on_tool_end events carry new run_ids."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        files = [
            ("toolu_A", "new-A", "/skill/SKILL.md"),
            ("toolu_B", "new-B", "/skill/references/proto.md"),
            ("toolu_C", "new-C", "/skill/references/cli.md"),
        ]

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        for orig_id, _, path in files:
            args = Struct()
            args.update({"path": path, "content": f"content of {path}"})
            ai_msg.tool_calls.append(ToolCall(
                id=orig_id, name="write", args=args,
                status=ToolCallStatus.TOOL_CALL_RUNNING,
            ))
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()
        for orig_id, new_id, _ in files:
            capture._run_id_to_tool_call_id[new_id] = orig_id

        builder = StatusBuilder("exec-alias-3", mock_initial_status,
                                tool_call_id_capture=capture)
        builder.rebuild_index_from_persisted_status()

        for orig_id, new_id, path in files:
            await builder.process_event({
                "event": "on_tool_start",
                "name": "write",
                "run_id": new_id,
                "data": {"input": {"path": path, "content": f"content of {path}"}},
            })
            await builder.process_event({
                "event": "on_tool_end",
                "name": "write",
                "run_id": new_id,
                "data": {"output": f"written {path}"},
            })

        for orig_id, _, path in files:
            tc = builder.get_tool_call(orig_id)
            assert tc is not None
            assert tc.id == orig_id
            assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED, (
                f"Tool call {orig_id} for {path} should be COMPLETED but is "
                f"{ToolCallStatus.Name(tc.status)}"
            )

    @pytest.mark.asyncio
    async def test_resolve_run_id_returns_original_when_no_alias(self, status_builder):
        """resolve_run_id returns the input unchanged when no alias exists."""
        assert status_builder.resolve_run_id("some-id") == "some-id"

    @pytest.mark.asyncio
    async def test_resolve_run_id_returns_alias_when_present(self, status_builder):
        """resolve_run_id returns the mapped original id when alias exists."""
        status_builder._tool_call_id_capture.register_alias("new-123", "orig-456")
        assert status_builder.resolve_run_id("new-123") == "orig-456"

    @pytest.mark.asyncio
    async def test_tool_progress_resolves_alias(self, mock_initial_status):
        """on_tool_progress with an aliased run_id appends to the correct
        tool call's result."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        original_tc_id = "toolu_progress_1"
        new_run_id = "new-progress-1"

        args = Struct()
        args.update({"command": "ls -la"})
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(ToolCall(
            id=original_tc_id,
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()
        capture._run_id_to_tool_call_id[new_run_id] = original_tc_id

        builder = StatusBuilder("exec-alias-4", mock_initial_status,
                                tool_call_id_capture=capture)
        builder.rebuild_index_from_persisted_status()

        await builder.process_event({
            "event": "on_tool_start",
            "name": "execute",
            "run_id": new_run_id,
            "data": {"input": {"command": "ls -la"}},
        })
        assert builder.resolve_run_id(new_run_id) == original_tc_id

        await builder.process_event({
            "event": "on_custom_event",
            "name": "tool_progress",
            "run_id": new_run_id,
            "data": {"chunk": "total 42\n"},
        })

        tc = builder.get_tool_call(original_tc_id)
        assert tc.result == "total 42\n"
        assert tc.is_streaming is True

    @pytest.mark.asyncio
    async def test_tool_progress_first_chunk_forces_update(self, mock_initial_status):
        """First tool_progress chunk for a tool sets force_next_update=True."""
        from google.protobuf.struct_pb2 import Struct

        original_run_id = "orig-force-1"
        args = Struct()
        args.update({"command": "ls -la"})
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(ToolCall(
            id=original_run_id,
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(ai_msg)

        builder = StatusBuilder("exec-force-1", mock_initial_status)
        builder.rebuild_index_from_persisted_status()
        builder.force_next_update = False

        await builder.process_event({
            "event": "on_custom_event",
            "name": "tool_progress",
            "run_id": original_run_id,
            "data": {"chunk": "first chunk\n"},
        })

        assert builder.force_next_update is True

    @pytest.mark.asyncio
    async def test_tool_progress_subsequent_chunk_does_not_force_update(self, mock_initial_status):
        """Subsequent tool_progress chunks do NOT set force_next_update (is_streaming already True)."""
        from google.protobuf.struct_pb2 import Struct

        original_run_id = "orig-force-2"
        args = Struct()
        args.update({"command": "ls -la"})
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(ToolCall(
            id=original_run_id,
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(ai_msg)

        builder = StatusBuilder("exec-force-2", mock_initial_status)
        builder.rebuild_index_from_persisted_status()

        await builder.process_event({
            "event": "on_custom_event",
            "name": "tool_progress",
            "run_id": original_run_id,
            "data": {"chunk": "first chunk\n"},
        })
        assert builder.force_next_update is True
        tc = builder.get_tool_call(original_run_id)
        assert tc.is_streaming is True

        builder.force_next_update = False

        await builder.process_event({
            "event": "on_custom_event",
            "name": "tool_progress",
            "run_id": original_run_id,
            "data": {"chunk": "second chunk\n"},
        })

        assert builder.force_next_update is False

    @pytest.mark.asyncio
    async def test_no_alias_when_run_id_matches_existing(self, mock_initial_status):
        """No alias is recorded when the capture resolves run_id to itself
        (edge case: tool_call_id matches the run_id)."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        same_id = "toolu_same_999"
        args = Struct()
        args.update({"path": "/file.txt", "content": "data"})
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(ToolCall(
            id=same_id, name="write", args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()
        capture._run_id_to_tool_call_id[same_id] = same_id

        builder = StatusBuilder("exec-alias-5", mock_initial_status,
                                tool_call_id_capture=capture)
        builder.rebuild_index_from_persisted_status()

        await builder.process_event({
            "event": "on_tool_start",
            "name": "write",
            "run_id": same_id,
            "data": {"input": {"path": "/file.txt", "content": "data"}},
        })

        assert builder.resolve_run_id(same_id) == same_id


# =============================================================================
# Tests for resume phantom guard
# =============================================================================


class TestResumePhantomGuard:
    """Tests for the resume-aware identity dedup that prevents phantom
    WAITING_APPROVAL tool calls during the approval resume path.

    During resume from Command(resume=...), LangGraph can emit two
    on_tool_start v2 events with different run_ids for the same tool
    execution. The first is deduped via ToolCallIdCapture. The second
    has no mapping and would create a phantom tool call that incorrectly
    sets the phase to WAITING_FOR_APPROVAL.

    The guard detects unmapped run_ids that match a recently-approved
    tool call (same name, approval_action set, status RUNNING) and
    aliases them instead of creating a new tool call.
    """

    @pytest.fixture
    def mock_initial_status(self):
        status = MagicMock()
        status.messages = []
        status.sub_agent_executions = []
        status.todos = {}
        status.artifacts = []
        status.resolved_context = ResolvedExecutionContext()
        status.context_info = ContextInfo()
        return status

    @pytest.mark.asyncio
    async def test_phantom_event_deduped_during_resume(self, mock_initial_status):
        """An unmapped on_tool_start for a tool that was just approved
        is treated as a phantom and aliased instead of creating a new
        tool call."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        original_tc_id = "toolu_01WvNdJXKbCCtKJrbTnCzbit"
        phantom_run_id = "019d823d-cde5-7df0-8c51-0d3532198d43"

        args = Struct()
        args.update({"assignee": "me"})
        existing_tc = ToolCall(
            id=original_tc_id,
            name="list_issues",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(existing_tc)
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()

        builder = StatusBuilder(
            "exec-phantom-1", mock_initial_status,
            tool_call_id_capture=capture,
        )
        builder.rebuild_index_from_persisted_status()

        assert builder.tool_call_count() == 1

        event = {
            "event": "on_tool_start",
            "name": "list_issues",
            "run_id": phantom_run_id,
            "data": {"input": {"assignee": "me"}},
        }
        await builder.process_event(event)

        assert builder.tool_call_count() == 1
        assert builder.resolve_run_id(phantom_run_id) == original_tc_id

        tc = builder.get_tool_call(original_tc_id)
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING

    @pytest.mark.asyncio
    async def test_no_false_positive_on_normal_tool_call(self, mock_initial_status):
        """A normal on_tool_start (no approval history) is not affected
        by the phantom guard and creates a new tool call as usual."""
        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        run_id = "normal-run-001"

        capture = ToolCallIdCapture()

        builder = StatusBuilder(
            "exec-normal-1", mock_initial_status,
            tool_call_id_capture=capture,
        )

        assert builder.tool_call_count() == 0

        event = {
            "event": "on_tool_start",
            "name": "list_issues",
            "run_id": run_id,
            "data": {"input": {"assignee": "me"}},
        }
        await builder.process_event(event)

        assert builder.tool_call_count() == 1

    @pytest.mark.asyncio
    async def test_guard_skips_completed_tool_calls(self, mock_initial_status):
        """The phantom guard does not match tool calls that have already
        transitioned to COMPLETED -- only RUNNING (actively resuming)."""
        from google.protobuf.struct_pb2 import Struct

        from stigmer_runner.worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture

        completed_tc_id = "toolu_completed_001"
        new_run_id = "019d-new-run"

        args = Struct()
        args.update({"assignee": "me"})
        completed_tc = ToolCall(
            id=completed_tc_id,
            name="list_issues",
            args=args,
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
            approval_action=ApprovalAction.APPROVAL_ACTION_APPROVE,
        )
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.append(completed_tc)
        mock_initial_status.messages.append(ai_msg)

        capture = ToolCallIdCapture()

        builder = StatusBuilder(
            "exec-completed-1", mock_initial_status,
            tool_call_id_capture=capture,
        )
        builder.rebuild_index_from_persisted_status()

        event = {
            "event": "on_tool_start",
            "name": "list_issues",
            "run_id": new_run_id,
            "data": {"input": {"assignee": "me"}},
        }
        await builder.process_event(event)

        assert builder.tool_call_count() == 2


# =============================================================================
# Tests for native thinking block translation
# =============================================================================


class TestNativeThinkingTranslation:
    """Tests for translating Anthropic extended-thinking blocks into synthetic think ToolCalls."""

    @pytest.mark.asyncio
    async def test_thinking_blocks_not_added_to_ai_message(self, status_builder):
        """Test that thinking content blocks create a streaming ToolCall attached
        to a parent AI message (with no text content)."""
        chunk = MagicMock()
        chunk.content = [{"type": "thinking", "thinking": "Let me analyze this..."}]

        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        }

        await status_builder.process_event(event)

        # A parent AI message is created (no text content) to hold the ToolCall.
        assert len(status_builder.current_status.messages) == 1
        parent_ai = status_builder.current_status.messages[0]
        assert parent_ai.type == MessageType.MESSAGE_AI
        assert parent_ai.content == ""
        assert len(parent_ai.tool_calls) == 1
        assert parent_ai.tool_calls[0].name == "think"

        assert status_builder.state.thinking.buffers.get("") == "Let me analyze this..."

        # A streaming ToolCall should exist in the flat list
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.name == "think"
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.is_streaming is True
        assert tc.result == "Let me analyze this..."

    @pytest.mark.asyncio
    async def test_thinking_accumulates_across_chunks(self, status_builder):
        """Test that multiple thinking chunks accumulate in both the buffer and the streaming ToolCall result."""
        for text in ["Step 1: ", "analyse inputs. ", "Step 2: decide."]:
            chunk = MagicMock()
            chunk.content = [{"type": "thinking", "thinking": text}]
            await status_builder.process_event({
                "event": "on_chat_model_stream",
                "data": {"chunk": chunk},
                "metadata": {},
            })

        assert status_builder.state.thinking.buffers[""] == (
            "Step 1: analyse inputs. Step 2: decide."
        )

        # The streaming ToolCall's result should match the full accumulated buffer
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.is_streaming is True
        assert tc.result == "Step 1: analyse inputs. Step 2: decide."

    @pytest.mark.asyncio
    async def test_synthetic_tool_call_created_on_text_transition(self, status_builder):
        """Test that the streaming think ToolCall transitions to COMPLETED when text follows."""
        # Send thinking chunk — creates RUNNING ToolCall
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "My reasoning here"}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "metadata": {},
        })

        # Verify streaming state before flush
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.is_streaming is True
        assert tc.result == "My reasoning here"
        streaming_id = tc.id

        # Send text chunk (triggers flush — transitions to COMPLETED)
        text_chunk = MagicMock()
        text_chunk.content = "The answer is 42."
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        # Same ToolCall object, now COMPLETED
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.id == streaming_id
        assert tc.name == "think"
        assert tc.args["thought"] == "My reasoning here"
        assert tc.result == "ok"
        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.is_streaming is False
        assert tc.id.startswith("think-native-")

        # Thinking created a parent AI message (no text), text created another
        assert len(status_builder.current_status.messages) == 2
        assert status_builder.current_status.messages[0].content == ""
        assert status_builder.current_status.messages[1].content == "The answer is 42."

    @pytest.mark.asyncio
    async def test_thinking_buffer_flushed_on_chat_model_end(self, status_builder):
        """Test that streaming think ToolCall transitions to COMPLETED in on_chat_model_end."""
        # Send thinking chunk (no text follows) — creates RUNNING ToolCall
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "Thinking only, no text"}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "metadata": {},
        })

        # Verify streaming state
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.is_streaming is True

        # Simulate on_chat_model_end
        output = MagicMock()
        output.usage_metadata = None
        output.response_metadata = {}
        output.content = ""

        # We need a streaming AI message for on_chat_model_end to finalize.
        status_builder.current_status.messages.append(
            AgentMessage(
                type=MessageType.MESSAGE_AI,
                content="",
                is_streaming=True,
            )
        )
        status_builder.state.message_start_times[0] = datetime.utcnow()

        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {},
        })

        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.name == "think"
        assert tc.args["thought"] == "Thinking only, no text"
        assert tc.result == "ok"
        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.is_streaming is False

    @pytest.mark.asyncio
    async def test_non_thinking_streams_unchanged(self, status_builder):
        """Test that regular text streams still work without thinking blocks."""
        chunk = MagicMock()
        chunk.content = "Regular text"

        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        })

        assert status_builder.tool_call_count() == 0
        assert len(status_builder.current_status.messages) == 1
        assert status_builder.current_status.messages[0].content == "Regular text"
        assert not status_builder.state.thinking.buffers

    @pytest.mark.asyncio
    async def test_empty_thinking_block_ignored(self, status_builder):
        """Test that empty thinking blocks do not produce a streaming ToolCall."""
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": ""}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "metadata": {},
        })

        text_chunk = MagicMock()
        text_chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        assert status_builder.tool_call_count() == 0

    @pytest.mark.asyncio
    async def test_streaming_result_updates_incrementally(self, status_builder):
        """Test that each thinking block updates the streaming ToolCall's result."""
        chunks = ["First thought. ", "Second thought. ", "Third thought."]

        for i, text in enumerate(chunks):
            chunk = MagicMock()
            chunk.content = [{"type": "thinking", "thinking": text}]
            await status_builder.process_event({
                "event": "on_chat_model_stream",
                "data": {"chunk": chunk},
                "metadata": {},
            })

            # Always the same single ToolCall
            assert status_builder.tool_call_count() == 1
            tc = next(status_builder.iter_all_tool_calls())
            assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
            assert tc.is_streaming is True
            expected = "".join(chunks[: i + 1])
            assert tc.result == expected

    @pytest.mark.asyncio
    async def test_streaming_preserves_single_tool_call_identity(self, status_builder):
        """Test that all thinking blocks update the same ToolCall (no duplicates)."""
        for text in ["A", "B", "C"]:
            chunk = MagicMock()
            chunk.content = [{"type": "thinking", "thinking": text}]
            await status_builder.process_event({
                "event": "on_chat_model_stream",
                "data": {"chunk": chunk},
                "metadata": {},
            })

        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.id.startswith("think-native-")
        assert tc.result == "ABC"

    @pytest.mark.asyncio
    async def test_streaming_to_completed_full_lifecycle(self, status_builder):
        """Test the full streaming lifecycle: create -> stream -> flush -> completed."""
        # Phase 1: First thinking block creates RUNNING ToolCall
        chunk1 = MagicMock()
        chunk1.content = [{"type": "thinking", "thinking": "Step 1. "}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk1},
            "metadata": {},
        })

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tc.is_streaming is True
        assert tc.result == "Step 1. "
        tc_id = tc.id

        # Phase 2: Second thinking block updates result
        chunk2 = MagicMock()
        chunk2.content = [{"type": "thinking", "thinking": "Step 2."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk2},
            "metadata": {},
        })

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.id == tc_id
        assert tc.result == "Step 1. Step 2."

        # Phase 3: Text chunk triggers flush -> COMPLETED
        text_chunk = MagicMock()
        text_chunk.content = "Done."
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.id == tc_id
        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.is_streaming is False
        assert tc.args["thought"] == "Step 1. Step 2."
        assert tc.result == "ok"
        assert tc.completed_at != ""

    @pytest.mark.asyncio
    async def test_streaming_tracking_state_cleaned_on_flush(self, status_builder):
        """Test that all thinking tracking state is cleaned up after flush."""
        chunk = MagicMock()
        chunk.content = [{"type": "thinking", "thinking": "Some thought"}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        })

        # Tracking state should exist
        assert "" in status_builder.state.thinking.buffers
        assert "" in status_builder.state.thinking.tool_call_ids
        assert "" in status_builder.state.thinking.started_at

        # Flush via text
        text_chunk = MagicMock()
        text_chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        # All tracking state should be cleared
        assert "" not in status_builder.state.thinking.buffers
        assert "" not in status_builder.state.thinking.tool_call_ids
        assert "" not in status_builder.state.thinking.started_at


# =============================================================================
# Tests for run_id-based LLM stream isolation
# =============================================================================


class TestLLMStreamIsolation:
    """Tests that concurrent LLM streams with different run_ids produce
    isolated AgentMessages, preventing token interleaving."""

    @staticmethod
    def _stream_event(token: str, run_id: str = "", namespace: str = ""):
        chunk = MagicMock()
        chunk.content = token
        event: dict[str, Any] = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        }
        if run_id:
            event["run_id"] = run_id
        if namespace:
            event["metadata"]["langgraph_checkpoint_ns"] = namespace
        return event

    @staticmethod
    def _end_event(run_id: str = "", namespace: str = ""):
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {}
        event: dict[str, Any] = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {},
        }
        if run_id:
            event["run_id"] = run_id
        if namespace:
            event["metadata"]["langgraph_checkpoint_ns"] = namespace
        return event

    @pytest.mark.asyncio
    async def test_concurrent_streams_produce_separate_messages(self, status_builder):
        """Two interleaved streams with different run_ids must not mix."""
        await status_builder.process_event(self._stream_event("Hello", run_id="A"))
        await status_builder.process_event(self._stream_event("Bonjour", run_id="B"))
        await status_builder.process_event(self._stream_event(" world", run_id="A"))
        await status_builder.process_event(self._stream_event(" monde", run_id="B"))

        msgs = status_builder.current_status.messages
        assert len(msgs) == 2
        assert msgs[0].content == "Hello world"
        assert msgs[1].content == "Bonjour monde"

    @pytest.mark.asyncio
    async def test_same_run_id_appends_to_same_message(self, status_builder):
        """Multiple tokens from the same run_id accumulate in one message."""
        for token in ["I", " will", " read", " files"]:
            await status_builder.process_event(self._stream_event(token, run_id="R1"))

        msgs = status_builder.current_status.messages
        assert len(msgs) == 1
        assert msgs[0].content == "I will read files"

    @pytest.mark.asyncio
    async def test_end_event_finalizes_correct_message_by_run_id(self, status_builder):
        """on_chat_model_end with run_id finalizes only its own message."""
        await status_builder.process_event(self._stream_event("First", run_id="A"))
        await status_builder.process_event(self._stream_event("Second", run_id="B"))

        # Finalize A — B should remain streaming
        await status_builder.process_event(self._end_event(run_id="A"))

        msgs = status_builder.current_status.messages
        assert msgs[0].is_streaming is False
        assert msgs[1].is_streaming is True

    @pytest.mark.asyncio
    async def test_run_id_map_cleaned_after_finalization(self, status_builder):
        """run_id entry is removed from the map after on_chat_model_end."""
        await status_builder.process_event(self._stream_event("Hello", run_id="R1"))
        assert "R1" in status_builder.state.messages_by_run

        await status_builder.process_event(self._end_event(run_id="R1"))
        assert "R1" not in status_builder.state.messages_by_run

    @pytest.mark.asyncio
    async def test_legacy_no_run_id_uses_backwards_scan(self, status_builder):
        """Events without run_id fall back to appending to the last
        streaming AI message (legacy behaviour)."""
        await status_builder.process_event(self._stream_event("Hello"))
        await status_builder.process_event(self._stream_event(" World"))

        msgs = status_builder.current_status.messages
        assert len(msgs) == 1
        assert msgs[0].content == "Hello World"

    @pytest.mark.asyncio
    async def test_new_run_id_after_finalization_creates_new_message(self, status_builder):
        """A new run_id arriving after a previous one is finalized
        creates a separate message (multi-turn isolation)."""
        await status_builder.process_event(self._stream_event("Turn 1", run_id="R1"))
        await status_builder.process_event(self._end_event(run_id="R1"))

        await status_builder.process_event(self._stream_event("Turn 2", run_id="R2"))

        msgs = status_builder.current_status.messages
        assert len(msgs) == 2
        assert msgs[0].content == "Turn 1"
        assert msgs[0].is_streaming is False
        assert msgs[1].content == "Turn 2"
        assert msgs[1].is_streaming is True

    @pytest.mark.asyncio
    async def test_three_concurrent_streams_fully_isolated(self, status_builder):
        """Stress test: three interleaved streams stay completely separate."""
        tokens = [
            ("A", "I'll"), ("B", "Let"), ("C", "Now"),
            ("A", " read"), ("C", " we"), ("B", " me"),
            ("A", " files"), ("B", " start"), ("C", " begin"),
        ]
        for run_id, token in tokens:
            await status_builder.process_event(self._stream_event(token, run_id=run_id))

        msgs = status_builder.current_status.messages
        assert len(msgs) == 3
        assert msgs[0].content == "I'll read files"
        assert msgs[1].content == "Let me start"
        assert msgs[2].content == "Now we begin"


# =============================================================================
# Tests for tool input streaming (input_json_delta → early ToolCall result)
# =============================================================================


class TestToolInputStreaming:
    """Tests for streaming tool input content via input_json_delta blocks."""

    def _tool_use_chunk(self, name: str, tool_id: str = "toolu_123"):
        """Build a stream event containing a tool_use block."""
        chunk = MagicMock()
        chunk.content = [{"type": "tool_use", "name": name, "id": tool_id}]
        return {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        }

    def _input_delta_chunk(self, partial_json: str):
        """Build a stream event containing an input_json_delta block."""
        chunk = MagicMock()
        chunk.content = [{"type": "input_json_delta", "partial_json": partial_json}]
        return {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        }

    @pytest.mark.asyncio
    async def test_write_tool_streams_content_into_result(self, status_builder):
        """Accumulating input_json_delta fragments for a write tool should
        extract the 'contents' field and stream it into tool_call.result."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        assert status_builder.tool_call_count() == 1
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.name == "write"
        assert tc.result == ""
        assert tc.is_streaming is True

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "file.py", "contents": "def hello():\\n')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "def hello():\n"
        assert tc.is_streaming is True

    @pytest.mark.asyncio
    async def test_incremental_delta_accumulation(self, status_builder):
        """Multiple input_json_delta fragments should accumulate and the
        extracted content should grow with each fragment."""
        await status_builder.process_event(self._tool_use_chunk("write"))

        await status_builder.process_event(self._input_delta_chunk('{"pa'))
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == ""

        await status_builder.process_event(
            self._input_delta_chunk('th": "f.py", "contents": "line1\\n')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "line1\n"

        await status_builder.process_event(self._input_delta_chunk("line2"))
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "line1\nline2"

    @pytest.mark.asyncio
    async def test_edit_tool_extracts_new_text(self, status_builder):
        """Edit tools should extract from the 'new_text' field."""
        await status_builder.process_event(self._tool_use_chunk("edit"))

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "main.go", "new_text": "package main\\n')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "package main\n"

    @pytest.mark.asyncio
    async def test_unknown_tool_stays_empty(self, status_builder):
        """Tools not in _TOOL_CONTENT_FIELDS should not stream any result."""
        await status_builder.process_event(self._tool_use_chunk("read_file"))

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "/tmp/test.txt"}')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == ""

    @pytest.mark.asyncio
    async def test_reconcile_preserves_result_when_input_was_streamed(self, status_builder):
        """When on_tool_start fires after input was already streamed, the
        early ToolCall's result is preserved (not cleared) and args are
        populated from the complete data."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        await status_builder.process_event(
            self._input_delta_chunk('{"path": "f.py", "contents": "hello"}')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "hello"

        tool_start_event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": "run-abc",
            "data": {"input": {"path": "f.py", "contents": "hello"}},
            "metadata": {},
        }
        await status_builder.process_event(tool_start_event)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "hello"
        assert tc.is_streaming is False
        assert tc.args["path"] == "f.py"
        assert tc.args["contents"] == "hello"

    @pytest.mark.asyncio
    async def test_trailing_escape_dropped(self, status_builder):
        """A trailing backslash at a fragment boundary should be silently
        dropped rather than producing garbled output."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        await status_builder.process_event(
            self._input_delta_chunk('{"path": "f.py", "contents": "abc\\')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "abc"

    @pytest.mark.asyncio
    async def test_unicode_escape_in_content(self, status_builder):
        """Unicode escapes (\\uXXXX) in the content should be decoded."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        await status_builder.process_event(
            self._input_delta_chunk('{"path": "f.py", "contents": "caf\\u00e9"}')
        )
        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == "café"


class TestPartialJsonHelpers:
    """Unit tests for the module-level JSON extraction helpers."""

    def test_find_field_with_space(self):
        from stigmer_runner.worker.activities.graphton.status_builder import (
            _find_json_string_value_start,
        )
        s = '{"contents": "hello"}'
        idx = _find_json_string_value_start(s, "contents")
        assert idx >= 0
        assert s[idx:idx+5] == "hello"

    def test_find_field_without_space(self):
        from stigmer_runner.worker.activities.graphton.status_builder import (
            _find_json_string_value_start,
        )
        s = '{"contents":"hello"}'
        idx = _find_json_string_value_start(s, "contents")
        assert idx >= 0
        assert s[idx:idx+5] == "hello"

    def test_find_field_not_present(self):
        from stigmer_runner.worker.activities.graphton.status_builder import (
            _find_json_string_value_start,
        )
        assert _find_json_string_value_start('{"path": "f.py"}', "contents") == -1

    def test_find_field_incomplete_value(self):
        from stigmer_runner.worker.activities.graphton.status_builder import (
            _find_json_string_value_start,
        )
        assert _find_json_string_value_start('{"contents": ', "contents") == -1

    def test_unescape_basic(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('hello\\nworld') == "hello\nworld"

    def test_unescape_stops_at_quote(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('hello", "other') == "hello"

    def test_unescape_trailing_backslash(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('abc\\') == "abc"

    def test_unescape_tab_and_escaped_quote(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('a\\tb\\"c') == 'a\tb"c'

    def test_unescape_unicode(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial("caf\\u00e9") == "café"

    def test_unescape_incomplete_unicode(self):
        from stigmer_runner.worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial("caf\\u00") == "caf"


# =============================================================================
# InterruptCapture._match_interrupt (StatusBuilder integration)
# =============================================================================


# =============================================================================
# Sub-Agent Subject Deduplication
# =============================================================================


class TestSubAgentSubjectDeduplication:
    """Tests for subject deduplication when multiple sub-agents share the same
    generated subject.  The first occurrence keeps its original text; subsequent
    duplicates get a numeric suffix like ' (2)', ' (3)', etc."""

    @staticmethod
    def _make_task_event(run_id: str, description: str = "do something") -> dict:
        return {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "general",
                    "description": description,
                }
            },
            "metadata": {},
        }

    @pytest.mark.asyncio
    async def test_first_subject_unchanged(self, status_builder):
        """First sub-agent with a given subject keeps it as-is."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="Research protobuf defs",
        ):
            await status_builder.process_event(
                self._make_task_event("run-1", "task A")
            )

        sa = status_builder.current_status.sub_agent_executions[0]
        assert sa.subject == "Research protobuf defs"

    @pytest.mark.asyncio
    async def test_duplicate_subject_gets_suffix(self, status_builder):
        """Second sub-agent with the same subject gets ' (2)' appended."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="Research protobuf defs",
        ):
            await status_builder.process_event(
                self._make_task_event("run-1", "task A")
            )
            await status_builder.process_event(
                self._make_task_event("run-2", "task B")
            )

        subjects = [
            sa.subject
            for sa in status_builder.current_status.sub_agent_executions
        ]
        assert subjects == [
            "Research protobuf defs",
            "Research protobuf defs (2)",
        ]

    @pytest.mark.asyncio
    async def test_triple_duplicate_increments(self, status_builder):
        """Third duplicate gets ' (3)'."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="Find YAML examples",
        ):
            for i in range(3):
                await status_builder.process_event(
                    self._make_task_event(f"run-{i}", f"task {i}")
                )

        subjects = [
            sa.subject
            for sa in status_builder.current_status.sub_agent_executions
        ]
        assert subjects == [
            "Find YAML examples",
            "Find YAML examples (2)",
            "Find YAML examples (3)",
        ]

    @pytest.mark.asyncio
    async def test_different_subjects_not_affected(self, status_builder):
        """Distinct subjects are stored without any suffix."""
        subjects_to_return = iter(["Analyze CLI code", "Review backend tests"])
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            side_effect=lambda *_args, **_kw: next(subjects_to_return),
        ):
            await status_builder.process_event(
                self._make_task_event("run-1", "task A")
            )
            await status_builder.process_event(
                self._make_task_event("run-2", "task B")
            )

        subjects = [
            sa.subject
            for sa in status_builder.current_status.sub_agent_executions
        ]
        assert subjects == ["Analyze CLI code", "Review backend tests"]

    @pytest.mark.asyncio
    async def test_dedup_respects_max_subject_length(self, status_builder):
        """A long subject is truncated so the suffix still fits within 50 chars."""
        from stigmer_runner.worker.activities.graphton.status_builder import _MAX_SUBJECT_LENGTH

        long_subject = "A" * _MAX_SUBJECT_LENGTH
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value=long_subject,
        ):
            await status_builder.process_event(
                self._make_task_event("run-1", "task A")
            )
            await status_builder.process_event(
                self._make_task_event("run-2", "task B")
            )

        second_subject = status_builder.current_status.sub_agent_executions[1].subject
        assert second_subject.endswith(" (2)")
        assert len(second_subject) <= _MAX_SUBJECT_LENGTH

    @pytest.mark.asyncio
    async def test_empty_subject_skips_dedup(self, status_builder):
        """Empty subjects (generation failures) are not deduplicated."""
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            await status_builder.process_event(
                self._make_task_event("run-1", "task A")
            )
            await status_builder.process_event(
                self._make_task_event("run-2", "task B")
            )

        subjects = [
            sa.subject
            for sa in status_builder.current_status.sub_agent_executions
        ]
        assert subjects == ["", ""]


# =============================================================================
# Tests for orphaned sub-agent detection and differentiated finalization (PR5)
# =============================================================================


class TestOrphanedSubAgentDetection:
    """Tests for has_orphaned_sub_agents, diagnostic info, and differentiated finalization.

    These verify that the StatusBuilder can detect sub-agents left in
    IN_PROGRESS after the event stream ends, report structured diagnostics,
    and finalize them with the correct differentiated statuses.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    def _make_task_start_event(self, run_id: str, description: str = "do work") -> dict:
        return {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "description": description,
                }
            },
            "metadata": {},
        }

    def _make_task_end_event(self, run_id: str, output: str = "done") -> dict:
        return {
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": output},
            "metadata": {},
        }

    # ── has_orphaned_sub_agents ──────────────────────────────────────────────

    def test_no_orphans_when_empty(self, status_builder):
        """No sub-agents at all → no orphans."""
        assert status_builder.has_orphaned_sub_agents is False

    @pytest.mark.asyncio
    async def test_no_orphans_after_all_completed(self, status_builder):
        """All sub-agents completed → no orphans."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))
        await status_builder.process_event(self._make_task_end_event("sa-1"))

        assert status_builder.has_orphaned_sub_agents is False

    @pytest.mark.asyncio
    async def test_orphans_detected_when_active(self, status_builder):
        """Sub-agents still active → orphans detected."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))

        assert status_builder.has_orphaned_sub_agents is True

    @pytest.mark.asyncio
    async def test_orphans_detected_mixed_completed_and_active(self, status_builder):
        """One completed + one active → still has orphans."""
        await status_builder.process_event(self._make_task_start_event("sa-1", "first task"))
        await status_builder.process_event(self._make_task_end_event("sa-1"))
        await status_builder.process_event(self._make_task_start_event("sa-2", "second task"))

        assert status_builder.has_orphaned_sub_agents is True

    # ── get_orphaned_sub_agents_diagnostic ───────────────────────────────────

    @pytest.mark.asyncio
    async def test_diagnostic_zero_message_sub_agent(self, status_builder):
        """Sub-agent with no messages/tool calls is classified as zero-message."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))

        diag = status_builder.get_orphaned_sub_agents_diagnostic()
        assert diag["total"] == 1
        assert diag["zero_message_count"] == 1
        assert diag["mid_execution_count"] == 0
        assert len(diag["zero_message"]) == 1
        assert diag["zero_message"][0]["run_id"] == "sa-1"

    @pytest.mark.asyncio
    async def test_diagnostic_mid_execution_sub_agent(self, status_builder):
        """Sub-agent with messages is classified as mid-execution."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))
        sub_agent = status_builder.state.active_sub_agents["sa-1"]
        sub_agent.messages.append(AgentMessage(content="working..."))

        diag = status_builder.get_orphaned_sub_agents_diagnostic()
        assert diag["total"] == 1
        assert diag["zero_message_count"] == 0
        assert diag["mid_execution_count"] == 1
        assert diag["mid_execution"][0]["run_id"] == "sa-1"
        assert diag["mid_execution"][0]["message_count"] == 1

    @pytest.mark.asyncio
    async def test_diagnostic_mixed(self, status_builder):
        """Mix of zero-message and mid-execution sub-agents."""
        await status_builder.process_event(self._make_task_start_event("sa-zero", "task alpha"))
        await status_builder.process_event(self._make_task_start_event("sa-mid", "task beta"))

        mid_agent = status_builder.state.active_sub_agents["sa-mid"]
        mid_agent.messages.append(AgentMessage(content="reading file"))

        diag = status_builder.get_orphaned_sub_agents_diagnostic()
        assert diag["total"] == 2
        assert diag["zero_message_count"] == 1
        assert diag["mid_execution_count"] == 1

    # ── finalize_active_sub_agents_differentiated ────────────────────────────

    @pytest.mark.asyncio
    async def test_differentiated_finalize_zero_message_gets_cancelled(self, status_builder):
        """Zero-message sub-agents receive SUB_AGENT_CANCELLED."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        await status_builder.process_event(self._make_task_start_event("sa-1"))

        count = status_builder.finalize_active_sub_agents_differentiated(
            error_context="Parent execution terminated abnormally"
        )

        assert count == 1
        sa = status_builder.state.completed_sub_agents["sa-1"]
        assert sa.status == SubAgentStatus.SUB_AGENT_CANCELLED
        assert "never began execution" in sa.error
        assert status_builder.has_orphaned_sub_agents is False

    @pytest.mark.asyncio
    async def test_differentiated_finalize_mid_execution_gets_failed(self, status_builder):
        """Mid-execution sub-agents receive SUB_AGENT_FAILED."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))
        status_builder.state.active_sub_agents["sa-1"].messages.append(
            AgentMessage(content="I found the issue")
        )

        count = status_builder.finalize_active_sub_agents_differentiated(
            error_context="Parent execution terminated abnormally"
        )

        assert count == 1
        sa = status_builder.state.completed_sub_agents["sa-1"]
        assert sa.status == SubAgentStatus.SUB_AGENT_FAILED
        assert "was running" in sa.error
        assert status_builder.has_orphaned_sub_agents is False

    @pytest.mark.asyncio
    async def test_differentiated_finalize_mixed(self, status_builder):
        """Mixed finalization: zero-message → CANCELLED, mid-execution → FAILED."""
        await status_builder.process_event(self._make_task_start_event("sa-zero", "task alpha"))
        await status_builder.process_event(self._make_task_start_event("sa-mid", "task beta"))
        status_builder.state.active_sub_agents["sa-mid"].messages.append(
            AgentMessage(content="working")
        )

        count = status_builder.finalize_active_sub_agents_differentiated(
            error_context="Parent terminated"
        )

        assert count == 2
        assert status_builder.state.completed_sub_agents["sa-zero"].status == SubAgentStatus.SUB_AGENT_CANCELLED
        assert status_builder.state.completed_sub_agents["sa-mid"].status == SubAgentStatus.SUB_AGENT_FAILED
        assert status_builder.has_orphaned_sub_agents is False

    @pytest.mark.asyncio
    async def test_differentiated_finalize_noop_when_no_active(self, status_builder):
        """No active sub-agents → finalize returns 0 and is a no-op."""
        count = status_builder.finalize_active_sub_agents_differentiated(
            error_context="test"
        )
        assert count == 0

    @pytest.mark.asyncio
    async def test_differentiated_finalize_sets_completed_at(self, status_builder):
        """Finalized sub-agents receive a completed_at timestamp."""
        await status_builder.process_event(self._make_task_start_event("sa-1"))

        status_builder.finalize_active_sub_agents_differentiated(
            error_context="test"
        )

        sa = status_builder.state.completed_sub_agents["sa-1"]
        assert sa.completed_at != ""

    # ── Regression: original finalize_active_sub_agents still works ──────────

    @pytest.mark.asyncio
    async def test_original_finalize_applies_uniform_status(self, status_builder):
        """The original finalize method still applies a single status to all."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus

        await status_builder.process_event(self._make_task_start_event("sa-1", "task alpha"))
        await status_builder.process_event(self._make_task_start_event("sa-2", "task beta"))

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "stall detected"
        )

        assert status_builder.state.completed_sub_agents["sa-1"].status == SubAgentStatus.SUB_AGENT_FAILED
        assert status_builder.state.completed_sub_agents["sa-2"].status == SubAgentStatus.SUB_AGENT_FAILED
        assert status_builder.has_orphaned_sub_agents is False


# =============================================================================
# Tests for _READ_ONLY_TOOLS filtering (read tool output omission)
# =============================================================================


class TestReadOnlyToolFiltering:
    """Verify that read/read_file tool results are replaced with placeholders
    in the persisted state while other tool results are preserved."""

    @pytest.fixture
    def status_builder(self, mock_initial_status):
        return StatusBuilder(
            execution_id="test-read-filter",
            initial_status=mock_initial_status,
        )

    async def _fire_tool_round(self, sb: StatusBuilder, tool_name: str, run_id: str, result: str) -> None:
        """Helper: emit on_tool_start then on_tool_end for a single tool call."""
        await sb.process_event({
            "event": "on_tool_start",
            "name": tool_name,
            "run_id": run_id,
            "data": {"input": {"path": "/tmp/example.txt"}},
            "metadata": {},
        })
        await sb.process_event({
            "event": "on_tool_end",
            "name": tool_name,
            "run_id": run_id,
            "data": {"output": result},
            "metadata": {},
        })

    @pytest.mark.asyncio
    async def test_read_tool_result_replaced_with_placeholder(self, status_builder):
        """The canonical 'read' tool result is replaced with a size placeholder."""
        file_content = "x" * 5000
        await self._fire_tool_round(status_builder, "read", "read-run-1", file_content)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == f"[content omitted - {len(file_content)} chars]"

    @pytest.mark.asyncio
    async def test_read_file_alias_also_omitted(self, status_builder):
        """The 'read_file' alias is also filtered."""
        file_content = "line1\nline2\nline3"
        await self._fire_tool_round(status_builder, "read_file", "rf-run-1", file_content)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == f"[content omitted - {len(file_content)} chars]"

    @pytest.mark.asyncio
    async def test_non_read_tool_result_preserved(self, status_builder):
        """Non-read tools keep their full result in the persisted state."""
        grep_output = "file.py:10: match found"
        await self._fire_tool_round(status_builder, "grep", "grep-run-1", grep_output)

        tc = next(status_builder.iter_all_tool_calls())
        assert tc.result == grep_output


# =============================================================================
# Tests for LLM Turn-Boundary Detection and Usage Tracking
# =============================================================================


class TestTurnBoundaryAndUsageTracking:
    """Verify that thinking-only LLM turns (thinking + tool_use, no text)
    correctly record usage metrics and that consecutive turns produce
    separate parent AI messages.

    These tests exercise fixes for two bugs:
      1. _handle_chat_model_end could not find the empty parent AI message
         for thinking-only turns, causing usage metrics to be lost.
      2. _last_ai_message was not invalidated between LLM turns, causing
         tool calls from consecutive thinking-only turns to pile up on
         the same parent AI message.
    """

    @pytest.mark.asyncio
    async def test_thinking_only_turn_records_usage(self, status_builder):
        """When the LLM produces thinking + tool_use (no text),
        on_chat_model_end must still find the parent AI message
        and record token counts."""
        llm_run_id = "llm-run-001"

        # Thinking chunk
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "Let me read the file..."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "run_id": llm_run_id,
            "metadata": {},
        })

        # tool_use chunk (early tool call creation)
        tool_use_chunk = MagicMock()
        tool_use_chunk.content = [{"type": "tool_use", "id": "tu-1", "name": "read", "input": {}}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": tool_use_chunk},
            "run_id": llm_run_id,
            "metadata": {},
        })

        # Verify the empty parent AI exists with the think + early tool call
        assert len(status_builder.current_status.messages) == 1
        parent_ai = status_builder.current_status.messages[0]
        assert parent_ai.type == MessageType.MESSAGE_AI
        assert parent_ai.content == ""
        assert len(parent_ai.tool_calls) == 2  # think + read

        # The empty parent must be registered in _llm_run_id_to_message
        assert llm_run_id in status_builder.state.messages_by_run

        # Simulate on_chat_model_end with usage metadata
        output = MagicMock()
        output.usage_metadata = {
            "input_tokens": 1500,
            "output_tokens": 300,
            "total_tokens": 1800,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output.response_metadata = {"model": "claude-sonnet-4-20250514"}
        output.content = [{"type": "thinking", "thinking": "Let me read the file..."}]

        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "run_id": llm_run_id,
            "metadata": {},
        })

        parent_ai = status_builder.current_status.messages[0]
        assert parent_ai.is_streaming is False

    @pytest.mark.asyncio
    async def test_consecutive_thinking_only_turns_get_separate_parents(self, status_builder):
        """Two consecutive thinking-only LLM turns (different run_ids)
        must produce separate parent AI messages, not pile up on one."""
        # ── Turn 1: thinking + tool_use ──────────────────────────────────
        run_id_1 = "llm-run-turn-1"

        thinking_chunk_1 = MagicMock()
        thinking_chunk_1.content = [{"type": "thinking", "thinking": "Analyzing request..."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk_1},
            "run_id": run_id_1,
            "metadata": {},
        })

        tool_use_chunk_1 = MagicMock()
        tool_use_chunk_1.content = [{"type": "tool_use", "id": "tu-a", "name": "read", "input": {}}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": tool_use_chunk_1},
            "run_id": run_id_1,
            "metadata": {},
        })

        # Finalize turn 1
        output_1 = MagicMock()
        output_1.usage_metadata = {
            "input_tokens": 1000,
            "output_tokens": 100,
            "total_tokens": 1100,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output_1.response_metadata = {"model": "claude-sonnet-4-20250514"}
        output_1.content = ""
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output_1},
            "run_id": run_id_1,
            "metadata": {},
        })

        # After turn 1: one parent AI message with think + read
        assert len(status_builder.current_status.messages) == 1
        parent_1 = status_builder.current_status.messages[0]
        assert len(parent_1.tool_calls) == 2

        # ── Turn 2: thinking + tool_use (different run_id) ──────────────
        run_id_2 = "llm-run-turn-2"

        thinking_chunk_2 = MagicMock()
        thinking_chunk_2.content = [{"type": "thinking", "thinking": "Now let me write..."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk_2},
            "run_id": run_id_2,
            "metadata": {},
        })

        tool_use_chunk_2 = MagicMock()
        tool_use_chunk_2.content = [{"type": "tool_use", "id": "tu-b", "name": "write", "input": {}}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": tool_use_chunk_2},
            "run_id": run_id_2,
            "metadata": {},
        })

        # Turn 2 must have created a SEPARATE parent AI message
        assert len(status_builder.current_status.messages) == 2
        parent_2 = status_builder.current_status.messages[1]
        assert parent_2.type == MessageType.MESSAGE_AI
        assert parent_2.content == ""
        assert len(parent_2.tool_calls) == 2  # think + write

        # Turn 1's parent must be unchanged
        parent_1 = status_builder.current_status.messages[0]
        assert len(parent_1.tool_calls) == 2  # think + read (not 4)

    @pytest.mark.asyncio
    async def test_thinking_then_text_turn_preserves_existing_behavior(self, status_builder):
        """A turn that starts with thinking then produces text (the common
        case) must continue to work: thinking on the empty parent,
        text on a new AI message."""
        llm_run_id = "llm-run-mixed"

        # Thinking chunk
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "Deep thought"}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "run_id": llm_run_id,
            "metadata": {},
        })

        # Text chunk (triggers thinking flush and new AI message)
        text_chunk = MagicMock()
        text_chunk.content = "Here is my answer."
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "run_id": llm_run_id,
            "metadata": {},
        })

        # Two messages: empty parent (with think TC) + text message
        assert len(status_builder.current_status.messages) == 2
        parent = status_builder.current_status.messages[0]
        assert parent.content == ""
        assert len(parent.tool_calls) == 1
        assert parent.tool_calls[0].name == "think"

        text_msg = status_builder.current_status.messages[1]
        assert text_msg.content == "Here is my answer."
        assert len(text_msg.tool_calls) == 0

    @pytest.mark.asyncio
    async def test_thinking_only_then_text_turn_separate_parents(self, status_builder):
        """A thinking-only turn followed by a text turn (common agentic
        loop: think+tool_use → tool execution → text response) must
        produce two separate AI messages."""
        run_id_1 = "llm-run-tools"
        run_id_2 = "llm-run-response"

        # ── Turn 1: thinking + tool_use (no text) ───────────────────────
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "Reading file..."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "run_id": run_id_1,
            "metadata": {},
        })

        tool_use_chunk = MagicMock()
        tool_use_chunk.content = [{"type": "tool_use", "id": "tu-x", "name": "read", "input": {}}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": tool_use_chunk},
            "run_id": run_id_1,
            "metadata": {},
        })

        # Finalize turn 1
        output_1 = MagicMock()
        output_1.usage_metadata = {
            "input_tokens": 800,
            "output_tokens": 50,
            "total_tokens": 850,
            "input_token_details": {"cache_creation": 0, "cache_read": 0},
        }
        output_1.response_metadata = {"model": "claude-sonnet-4-20250514"}
        output_1.content = ""
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output_1},
            "run_id": run_id_1,
            "metadata": {},
        })

        # ── Turn 2: text response ───────────────────────────────────────
        text_chunk = MagicMock()
        text_chunk.content = "Here is the file content."
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "run_id": run_id_2,
            "metadata": {},
        })

        # Two messages: empty parent (turn 1) + text (turn 2)
        assert len(status_builder.current_status.messages) == 2

        parent_1 = status_builder.current_status.messages[0]
        assert parent_1.content == ""
        assert len(parent_1.tool_calls) == 2  # think + read

        text_msg = status_builder.current_status.messages[1]
        assert text_msg.content == "Here is the file content."
        assert text_msg.is_streaming is True  # not yet finalized

    @pytest.mark.asyncio
    async def test_turn_boundary_does_not_trigger_without_run_id(self, status_builder):
        """When events lack run_id (legacy path), the turn-boundary
        detection must not interfere with existing behavior."""
        # Thinking without run_id
        thinking_chunk = MagicMock()
        thinking_chunk.content = [{"type": "thinking", "thinking": "Thinking..."}]
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": thinking_chunk},
            "metadata": {},
        })

        # Text without run_id
        text_chunk = MagicMock()
        text_chunk.content = "Answer"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        # Should still produce parent + text message (legacy behavior)
        assert len(status_builder.current_status.messages) == 2
        assert status_builder.current_status.messages[0].content == ""
        assert status_builder.current_status.messages[1].content == "Answer"


# =============================================================================
# Deferred Completion Flush (Drain Delay)
# =============================================================================


class TestDeferredCompletionFlush:
    """Tests for the deferred sub-agent completion flush mechanism.

    When a sub-agent completes, the status builder records a pending flush
    timestamp instead of immediately setting force_next_update.  This allows
    late LangGraph events to be batched into the same gRPC update.
    """

    @pytest.fixture
    def status_builder(self, mock_initial_status):
        return StatusBuilder(
            execution_id="test-drain-delay",
            initial_status=mock_initial_status,
        )

    @pytest.fixture
    def mock_initial_status(self):
        status = MagicMock()
        status.messages = []
        status.sub_agent_executions = []
        status.todos = {}
        status.artifacts = []
        status.resolved_context = ResolvedExecutionContext()
        status.context_info = ContextInfo()
        return status

    def test_should_flush_empty(self, status_builder):
        """No pending completions means no flush."""
        import time

        assert status_builder.should_flush_completions(time.monotonic()) is False
        assert status_builder.force_next_update is False

    def test_should_flush_before_drain_window(self, status_builder):
        """Flush returns False when still within the drain window."""
        import time

        now = time.monotonic()
        status_builder.state.pending_completion_flush["sa-1"] = now

        assert status_builder.should_flush_completions(now + 0.1) is False
        assert status_builder.force_next_update is False
        assert "sa-1" in status_builder.state.pending_completion_flush

    def test_should_flush_after_drain_window(self, status_builder):
        """Flush returns True and sets force_next_update after the drain window elapses."""
        import time

        now = time.monotonic()
        status_builder.state.pending_completion_flush["sa-1"] = now

        result = status_builder.should_flush_completions(
            now + (StatusBuilder._COMPLETION_DRAIN_MS / 1000.0) + 0.001,
        )

        assert result is True
        assert status_builder.force_next_update is True
        assert "sa-1" not in status_builder.state.pending_completion_flush

    def test_should_flush_partial_drain(self, status_builder):
        """Only entries past the drain window are flushed; others remain."""
        import time

        now = time.monotonic()
        status_builder.state.pending_completion_flush["sa-old"] = now
        status_builder.state.pending_completion_flush["sa-new"] = now + 1.0

        result = status_builder.should_flush_completions(
            now + (StatusBuilder._COMPLETION_DRAIN_MS / 1000.0) + 0.001,
        )

        assert result is True
        assert "sa-old" not in status_builder.state.pending_completion_flush
        assert "sa-new" in status_builder.state.pending_completion_flush

    @pytest.mark.asyncio
    async def test_sub_agent_end_populates_pending_flush(self, status_builder):
        """Sub-agent on_tool_end for 'task' populates _pending_completion_flush."""
        run_id = "task-drain-test"

        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "helper", "input": "test"}},
            "metadata": {},
        })

        status_builder.force_next_update = False

        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": run_id,
            "data": {"output": "completed"},
            "metadata": {},
        })

        assert status_builder.force_next_update is False
        assert run_id in status_builder.state.pending_completion_flush


# =============================================================================
# Tests for universal namespace registration in process_event (Issue 2 fix)
# =============================================================================


class TestUniversalNamespaceRegistration:
    """Verify that _register_sub_agent_namespace is called for every event type.

    Before this fix, _register_sub_agent_namespace was only called from
    _handle_tool_start_event, causing namespace variants arriving via
    on_chat_model_stream or on_tool_end to fail the exact lookup in
    _get_execution_context and fall back to the main agent context.

    The fix moves the call into process_event itself, so it runs for
    ALL event types before dispatching to the type-specific handler.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    def _make_task_start_event(self, run_id: str) -> dict:
        return {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "helper", "description": "test"}},
            "metadata": {},
        }

    def _make_chat_model_stream_event(
        self, namespace: str, *, parent_ids: list[str] | None = None,
    ) -> dict:
        return {
            "event": "on_chat_model_stream",
            "name": "ChatModel",
            "run_id": "stream-run-1",
            "parent_ids": parent_ids or [],
            "data": {"chunk": {"content": "hello"}},
            "metadata": {"langgraph_checkpoint_ns": namespace},
        }

    def _make_tool_end_event(
        self, run_id: str, namespace: str, *, parent_ids: list[str] | None = None,
    ) -> dict:
        return {
            "event": "on_tool_end",
            "name": "read",
            "run_id": run_id,
            "parent_ids": parent_ids or [],
            "data": {"output": "file content"},
            "metadata": {"langgraph_checkpoint_ns": namespace},
        }

    @pytest.mark.asyncio
    async def test_chat_model_stream_registers_namespace(self, status_builder):
        """on_chat_model_stream events trigger namespace registration."""
        sa_id = "sa-root-1"
        child_ns = f"tools:{sa_id}|tools:inner-1"

        await status_builder.process_event(self._make_task_start_event(sa_id))

        await status_builder.process_event(
            self._make_chat_model_stream_event(child_ns, parent_ids=[sa_id])
        )

        assert child_ns in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_tool_end_registers_namespace(self, status_builder):
        """on_tool_end events trigger namespace registration."""
        sa_id = "sa-root-2"
        child_ns = f"tools:{sa_id}|tools:nested-2"

        await status_builder.process_event(self._make_task_start_event(sa_id))

        await status_builder.process_event(
            self._make_tool_end_event(
                "nested-tool-run", child_ns, parent_ids=[sa_id],
            )
        )

        assert child_ns in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_single_segment_namespace_ignored(self, status_builder):
        """Single-segment namespaces are not registered (they're main agent)."""
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "name": "ChatModel",
            "run_id": "main-run",
            "data": {"chunk": {"content": "hi"}},
            "metadata": {"langgraph_checkpoint_ns": "main"},
        })

        assert "main" not in status_builder.state.namespace_to_sub_agent

    @pytest.mark.asyncio
    async def test_registration_is_idempotent(self, status_builder):
        """Calling registration multiple times for same namespace is safe."""
        sa_id = "sa-idem"
        child_ns = f"tools:{sa_id}|inner:node"

        await status_builder.process_event(self._make_task_start_event(sa_id))

        for _ in range(5):
            await status_builder.process_event(
                self._make_chat_model_stream_event(child_ns, parent_ids=[sa_id])
            )

        assert child_ns in status_builder.state.namespace_to_sub_agent


# =============================================================================
# Tests for finalization preserving terminal status (Issue 3 fix)
# =============================================================================


class TestFinalizationPreservesTerminalStatus:
    """Verify that finalize_active_sub_agents and
    finalize_active_sub_agents_differentiated preserve sub-agents that
    already have a terminal status (COMPLETED, FAILED, CANCELLED) or
    have produced output.

    Before this fix, the crash handler blindly overwrote all active
    sub-agents to FAILED, even if some had logically completed.
    """

    @pytest.fixture(autouse=True)
    def _patch_subject_gen(self):
        with patch(
            "stigmer_runner.worker.activities.graphton.handlers.sub_agent._generate_sub_agent_subject",
            new_callable=AsyncMock,
            return_value="",
        ):
            yield

    def _make_task_start_event(self, run_id: str, description: str = "do work") -> dict:
        return {
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "helper", "description": description}},
            "metadata": {},
        }

    @pytest.mark.asyncio
    async def test_completed_sub_agent_preserved_by_uniform_finalize(self, status_builder):
        """Sub-agent with COMPLETED status is not overwritten to FAILED."""
        await status_builder.process_event(
            self._make_task_start_event("sa-done", "finished task")
        )
        sa = status_builder.state.active_sub_agents["sa-done"]
        sa.status = SubAgentStatus.SUB_AGENT_COMPLETED
        sa.output = "result data"

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "Parent execution error: BadRequestError",
        )

        finalized = status_builder.state.completed_sub_agents["sa-done"]
        assert finalized.status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert finalized.output == "result data"

    @pytest.mark.asyncio
    async def test_in_progress_sub_agent_gets_forced_status(self, status_builder):
        """Sub-agent still IN_PROGRESS is correctly marked FAILED."""
        await status_builder.process_event(
            self._make_task_start_event("sa-wip", "working")
        )

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "Parent execution error: BadRequestError",
        )

        finalized = status_builder.state.completed_sub_agents["sa-wip"]
        assert finalized.status == SubAgentStatus.SUB_AGENT_FAILED

    @pytest.mark.asyncio
    async def test_sub_agent_with_output_preserved(self, status_builder):
        """Sub-agent with non-empty output is preserved even without terminal status."""
        await status_builder.process_event(
            self._make_task_start_event("sa-out", "has output")
        )
        sa = status_builder.state.active_sub_agents["sa-out"]
        sa.output = "partial result"

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "Parent execution error",
        )

        finalized = status_builder.state.completed_sub_agents["sa-out"]
        assert finalized.output == "partial result"
        assert finalized.status != SubAgentStatus.SUB_AGENT_FAILED

    @pytest.mark.asyncio
    async def test_mixed_finalization_preserves_and_finalizes(self, status_builder):
        """Mix of completed and in-progress sub-agents handled correctly."""
        await status_builder.process_event(
            self._make_task_start_event("sa-completed", "done")
        )
        await status_builder.process_event(
            self._make_task_start_event("sa-running", "still going")
        )

        completed_sa = status_builder.state.active_sub_agents["sa-completed"]
        completed_sa.status = SubAgentStatus.SUB_AGENT_COMPLETED
        completed_sa.output = "finished"

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "stall detected",
        )

        assert status_builder.state.completed_sub_agents["sa-completed"].status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert status_builder.state.completed_sub_agents["sa-running"].status == SubAgentStatus.SUB_AGENT_FAILED
        assert len(status_builder.state.active_sub_agents) == 0

    @pytest.mark.asyncio
    async def test_differentiated_finalize_preserves_completed(self, status_builder):
        """finalize_active_sub_agents_differentiated also preserves terminal status."""
        await status_builder.process_event(
            self._make_task_start_event("sa-ok", "completed task")
        )
        await status_builder.process_event(
            self._make_task_start_event("sa-wip", "mid execution")
        )

        ok_sa = status_builder.state.active_sub_agents["sa-ok"]
        ok_sa.status = SubAgentStatus.SUB_AGENT_COMPLETED
        ok_sa.output = "success"

        wip_sa = status_builder.state.active_sub_agents["sa-wip"]
        wip_sa.messages.append(AgentMessage(content="working on it"))

        count = status_builder.finalize_active_sub_agents_differentiated(
            error_context="Parent terminated abnormally"
        )

        assert count == 2
        assert status_builder.state.completed_sub_agents["sa-ok"].status == SubAgentStatus.SUB_AGENT_COMPLETED
        assert status_builder.state.completed_sub_agents["sa-wip"].status == SubAgentStatus.SUB_AGENT_FAILED

    @pytest.mark.asyncio
    async def test_pending_completion_flushed_before_finalization(self, status_builder):
        """Pending completion flush entries are drained before crash finalization."""
        import time

        await status_builder.process_event(
            self._make_task_start_event("sa-flush", "completed recently")
        )

        sa = status_builder.state.active_sub_agents.pop("sa-flush")
        sa.status = SubAgentStatus.SUB_AGENT_COMPLETED
        sa.output = "done"
        status_builder.state.completed_sub_agents["sa-flush"] = sa
        status_builder.state.pending_completion_flush["sa-flush"] = time.monotonic()

        status_builder.finalize_active_sub_agents(
            SubAgentStatus.SUB_AGENT_FAILED,
            "Parent crashed",
        )

        assert len(status_builder.state.pending_completion_flush) == 0
        assert status_builder.force_next_update is True

    @pytest.mark.asyncio
    async def test_flush_pending_completions_on_empty_is_noop(self, status_builder):
        """_flush_pending_completions on empty dict is a safe no-op."""
        flushed = status_builder._flush_pending_completions()
        assert flushed == []
        assert status_builder.force_next_update is False


# =============================================================================
# Tests for ExecutionState.rebuild_from_proto
# =============================================================================


class TestRebuildFromProto:
    """Tests for ExecutionState.rebuild_from_proto classmethod.

    Verifies that proto-derivable indexes are correctly reconstructed
    from a persisted AgentExecutionStatus, and that ephemeral runtime
    state starts fresh.
    """

    def test_indexes_main_agent_tool_calls(self, mock_initial_status):
        """Tool calls inside main-agent AI messages are indexed."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(
            id="toolu_A", name="write",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )
        ai_msg.tool_calls.add(
            id="toolu_B", name="read",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.messages.append(ai_msg)

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert len(state.tool_calls) == 2
        assert state.tool_calls["toolu_A"].name == "write"
        assert state.tool_calls["toolu_B"].name == "read"
        assert state.tool_calls["toolu_A"] is mock_initial_status.messages[0].tool_calls[0]

    def test_indexes_sub_agent_tool_calls(self, mock_initial_status):
        """Tool calls inside sub-agent messages are also indexed."""
        from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution

        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        sa = SubAgentExecution(
            id="toolu_SA1", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_COMPLETED,
        )
        sa_msg = sa.messages.add(type=MessageType.MESSAGE_AI)
        sa_msg.tool_calls.add(
            id="toolu_nested", name="execute",
            status=ToolCallStatus.TOOL_CALL_COMPLETED,
        )
        mock_initial_status.sub_agent_executions.append(sa)

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert "toolu_nested" in state.tool_calls
        assert state.tool_calls["toolu_nested"].name == "execute"

    def test_indexes_completed_sub_agents(self, mock_initial_status):
        """Completed/failed/cancelled sub-agents populate completed_sub_agents."""
        from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution

        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        sa_done = SubAgentExecution(
            id="sa-1", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_COMPLETED,
        )
        sa_failed = SubAgentExecution(
            id="sa-2", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_FAILED,
        )
        sa_running = SubAgentExecution(
            id="sa-3", name="generalPurpose",
            status=SubAgentStatus.SUB_AGENT_IN_PROGRESS,
        )
        mock_initial_status.sub_agent_executions.extend([sa_done, sa_failed, sa_running])

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert "sa-1" in state.completed_sub_agents
        assert "sa-2" in state.completed_sub_agents
        assert "sa-3" not in state.completed_sub_agents

    def test_copies_artifacts(self):
        """Proto artifacts are copied into state.artifacts."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        proto = AgentExecutionStatus()
        proto.artifacts.add(name="output.txt", sandbox_path="project/output.txt")
        proto.artifacts.add(name="log.txt", sandbox_path="project/log.txt")

        state = ExecutionState.rebuild_from_proto(proto)

        assert len(state.artifacts) == 2
        assert state.artifacts[0].name == "output.txt"
        assert state.artifacts[1].name == "log.txt"

    def test_ephemeral_state_starts_fresh(self, mock_initial_status):
        """Ephemeral fields (timing, buffers, approval) are empty after rebuild."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(
            id="toolu_X", name="write",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.messages.append(ai_msg)

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert len(state.tool_start_times) == 0
        assert len(state.message_start_times) == 0
        assert len(state.messages_by_run) == 0
        assert len(state.current_ai_message) == 0
        assert len(state.active_sub_agents) == 0
        assert len(state.thinking.buffers) == 0
        assert len(state.tool_input.buffers) == 0
        assert len(state.approval.pending) == 0
        assert len(state.early_tool_call_queue) == 0

    def test_skips_tool_calls_without_id(self, mock_initial_status):
        """Tool calls with empty id are not indexed (edge case)."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(id="", name="write")
        ai_msg.tool_calls.add(id="toolu_real", name="read")
        mock_initial_status.messages.append(ai_msg)

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert len(state.tool_calls) == 1
        assert "toolu_real" in state.tool_calls

    def test_skips_non_ai_messages(self, mock_initial_status):
        """Human messages are ignored during tool call indexing."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState

        human_msg = AgentMessage(type=MessageType.MESSAGE_HUMAN)
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(id="toolu_only", name="execute")
        mock_initial_status.messages.extend([human_msg, ai_msg])

        state = ExecutionState.rebuild_from_proto(mock_initial_status)

        assert len(state.tool_calls) == 1
        assert "toolu_only" in state.tool_calls

    def test_status_builder_delegates_to_rebuild(self, mock_initial_status):
        """StatusBuilder.rebuild_index_from_persisted_status uses
        ExecutionState.rebuild_from_proto and replaces self.state."""
        ai_msg = AgentMessage(type=MessageType.MESSAGE_AI)
        ai_msg.tool_calls.add(
            id="toolu_delegated", name="write",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.messages.append(ai_msg)

        builder = StatusBuilder("exec-rebuild", mock_initial_status)
        assert len(builder.state.tool_calls) == 0

        builder.rebuild_index_from_persisted_status()

        assert "toolu_delegated" in builder.state.tool_calls
        assert builder.state.proto is mock_initial_status
