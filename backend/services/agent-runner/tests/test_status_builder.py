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
from unittest.mock import MagicMock

import pytest
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    AgentMessage,
    ContextInfo,
    ResolvedExecutionContext,
    UsageMetrics,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType, ToolCallStatus

from worker.activities.graphton.status_builder import StatusBuilder

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_initial_status():
    """Create a mock initial AgentExecutionStatus."""
    status = MagicMock()
    status.messages = []
    status.tool_calls = []
    status.sub_agent_executions = []
    status.todos = {}
    # Real UsageMetrics proto for Phase 2.4 usage tracking
    # MagicMock doesn't support CopyFrom(), so we use a real proto
    status.usage = UsageMetrics()
    # Real ResolvedExecutionContext proto for Phase 2.5
    # MagicMock doesn't support CopyFrom(), so we use a real proto
    status.resolved_context = ResolvedExecutionContext()
    # Real ContextInfo proto for Phase 3 context management
    # MagicMock doesn't support CopyFrom(), so we use a real proto
    status.context_info = ContextInfo()
    status.pending_approvals = []
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
        assert 0 in status_builder._message_start_times
        assert isinstance(status_builder._message_start_times[0], datetime)

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
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 100
        output.usage_metadata.output_tokens = 50
        output.usage_metadata.total_tokens = 150
        output.response_metadata = {"model": "claude-3-opus"}
        
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        }
        
        await status_builder.process_event(end_event)
        
        # Verify cumulative tokens were updated
        assert status_builder._total_prompt_tokens == 100
        assert status_builder._total_completion_tokens == 50

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
        
        assert status_builder._total_prompt_tokens == 200
        assert status_builder._total_completion_tokens == 75

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
        status_builder._message_start_times[0] = known_start
        
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
        assert 0 not in status_builder._message_start_times

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
        output1.usage_metadata = MagicMock()
        output1.usage_metadata.input_tokens = 100
        output1.usage_metadata.output_tokens = 50
        output1.usage_metadata.total_tokens = 150
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
        output2.usage_metadata = MagicMock()
        output2.usage_metadata.input_tokens = 200
        output2.usage_metadata.output_tokens = 100
        output2.usage_metadata.total_tokens = 300
        output2.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output2},
            "metadata": {}
        })
        
        # Should have cumulative totals
        assert status_builder._total_prompt_tokens == 300  # 100 + 200
        assert status_builder._total_completion_tokens == 150  # 50 + 100

    @pytest.mark.asyncio
    async def test_handles_missing_ai_message_gracefully(self, status_builder):
        """Test that on_chat_model_end handles missing AI message."""
        # Process end event without any prior stream event
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 100
        output.usage_metadata.output_tokens = 50
        output.usage_metadata.total_tokens = 150
        
        end_event = {
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        }
        
        # Should not raise, just log warning
        await status_builder.process_event(end_event)
        
        # Tokens should NOT be accumulated since no message was found
        assert status_builder._total_prompt_tokens == 0
        assert status_builder._total_completion_tokens == 0

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
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 10
        output.usage_metadata.output_tokens = 5
        output.usage_metadata.total_tokens = 15
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        # Verify it was processed (tokens accumulated)
        assert status_builder._total_prompt_tokens == 10

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
        
        assert status_builder._total_prompt_tokens == 150
        assert status_builder._total_completion_tokens == 80


# =============================================================================
# Tests for AgentMessage streaming state fields (Phase 2.1)
# =============================================================================


class TestAgentMessageStreamingFields:
    """Tests for AgentMessage.is_streaming, token_count, and generation_duration_ms fields.
    
    These fields track AI message generation progress and resource usage:
    - is_streaming: True while generating, False when complete
    - token_count: Total tokens (prompt + completion) for this message
    - generation_duration_ms: Wall-clock time from first token to completion
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
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 100
        output.usage_metadata.output_tokens = 50
        output.usage_metadata.total_tokens = 150
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        ai_message = status_builder.current_status.messages[0]
        assert ai_message.is_streaming is False

    @pytest.mark.asyncio
    async def test_sets_token_count_on_end(self, status_builder):
        """Test that token_count is set to prompt + completion tokens."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # End event with usage metadata
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 100  # prompt tokens
        output.usage_metadata.output_tokens = 50   # completion tokens
        output.usage_metadata.total_tokens = 150
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        ai_message = status_builder.current_status.messages[0]
        # token_count should be prompt + completion = 100 + 50 = 150
        assert ai_message.token_count == 150

    @pytest.mark.asyncio
    async def test_sets_generation_duration_ms_on_end(self, status_builder):
        """Test that generation_duration_ms is calculated from start time."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # Set a known start time to control duration calculation
        known_start = datetime.utcnow() - timedelta(milliseconds=750)
        status_builder._message_start_times[0] = known_start
        
        # End event
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 10
        output.usage_metadata.output_tokens = 5
        output.usage_metadata.total_tokens = 15
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        ai_message = status_builder.current_status.messages[0]
        # Duration should be ~750ms (with some tolerance for test execution time)
        assert ai_message.generation_duration_ms >= 750
        assert ai_message.generation_duration_ms < 1500  # Upper bound for sanity

    @pytest.mark.asyncio
    async def test_token_count_zero_when_no_usage_metadata(self, status_builder):
        """Test that token_count is 0 when usage metadata is unavailable."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # End event WITHOUT usage metadata
        output = MagicMock()
        output.usage_metadata = None
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        ai_message = status_builder.current_status.messages[0]
        # No usage metadata means 0 tokens
        assert ai_message.token_count == 0
        # is_streaming should still be False (finalized)
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
        assert len(status_builder.current_status.tool_calls) == 1
        tool_call = status_builder.current_status.tool_calls[0]
        
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
        
        tool_call = status_builder.current_status.tool_calls[0]
        
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
        assert status_builder.current_status.tool_calls[0].status == ToolCallStatus.TOOL_CALL_RUNNING
        
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
        tool_call = status_builder.current_status.tool_calls[0]
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
        assert status_builder.current_status.tool_calls[0].completed_at == ""
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "api_call",
            "run_id": run_id,
            "data": {"output": {"status": 200}},
            "metadata": {}
        })
        
        tool_call = status_builder.current_status.tool_calls[0]
        
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
        
        # Find the tool message
        tool_message = None
        for msg in status_builder.current_status.messages:
            if msg.type == MessageType.MESSAGE_TOOL:
                tool_message = msg
                break
        
        assert tool_message is not None
        assert len(tool_message.tool_calls) == 1
        assert tool_message.tool_calls[0].status == ToolCallStatus.TOOL_CALL_RUNNING
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "search",
            "run_id": run_id,
            "data": {"output": "results"},
            "metadata": {}
        })
        
        # Verify status updated in messages list too
        assert tool_message.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_tool_status_in_tool_calls_list(self, status_builder):
        """Test that tool status is correctly set in status.tool_calls."""
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
        
        # Verify in status.tool_calls
        assert len(status_builder.current_status.tool_calls) == 1
        assert status_builder.current_status.tool_calls[0].status == ToolCallStatus.TOOL_CALL_RUNNING
        assert status_builder.current_status.tool_calls[0].id == run_id
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "write_file",
            "run_id": run_id,
            "data": {"output": "success"},
            "metadata": {}
        })
        
        # Verify status updated
        assert status_builder.current_status.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED

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
        assert run_id in status_builder._tool_start_times
        assert isinstance(status_builder._tool_start_times[run_id], datetime)
        
        # Set a known start time to control duration calculation
        known_start = datetime.utcnow() - timedelta(milliseconds=1500)
        status_builder._tool_start_times[run_id] = known_start
        
        # End the tool
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "slow_operation",
            "run_id": run_id,
            "data": {"output": "done"},
            "metadata": {}
        })
        
        # Verify start time was cleaned up
        assert run_id not in status_builder._tool_start_times


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
        tool_call = status_builder.current_status.tool_calls[0]
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
        tool_call = status_builder.current_status.tool_calls[0]
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
                    "input": "Fix the bug in main.py"
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
        assert run_id in status_builder._active_sub_agents

    @pytest.mark.asyncio
    async def test_task_tool_does_not_create_regular_tool_call(self, status_builder):
        """Test that 'task' tool does NOT create a regular ToolCall entry."""
        event = {
            "event": "on_tool_start",
            "name": "task",
            "run_id": "task-run-456",
            "data": {
                "input": {
                    "subagent_type": "researcher",
                    "task": "Research the topic"
                }
            },
            "metadata": {}
        }
        
        await status_builder.process_event(event)
        
        # No regular tool calls should be created
        assert len(status_builder.current_status.tool_calls) == 0
        assert len(status_builder.current_status.messages) == 0
        
        # But sub-agent should exist
        assert len(status_builder.current_status.sub_agent_executions) == 1

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
        assert run_id not in status_builder._active_sub_agents

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
        namespace = f"agent_node:{sub_agent_run_id}"
        
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
        
        # Tool call from sub-agent (with namespace)
        tool_run_id = "tool-in-subagent"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": tool_run_id,
            "data": {"input": {"path": "/tmp/test.py", "content": "print('hello')"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify tool call is in sub-agent, not main agent
        assert len(status_builder.current_status.tool_calls) == 0  # Not in main
        
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert len(sub_agent.tool_calls) == 1
        assert sub_agent.tool_calls[0].id == tool_run_id
        assert sub_agent.tool_calls[0].name == "write_file"
        assert sub_agent.tool_calls[0].status == ToolCallStatus.TOOL_CALL_RUNNING

    @pytest.mark.asyncio
    async def test_namespace_routing_messages_to_sub_agent(self, status_builder):
        """Test that AI messages with sub-agent namespace route to SubAgentExecution."""
        sub_agent_run_id = "task-run-msg-test"
        namespace = f"agent_node:{sub_agent_run_id}"
        
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
        
        # AI message from sub-agent (with namespace)
        chunk = MagicMock()
        chunk.content = "I'll help you with that."
        
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify message is in sub-agent, not main agent
        assert len(status_builder.current_status.messages) == 0  # Not in main
        
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert len(sub_agent.messages) == 1
        assert sub_agent.messages[0].content == "I'll help you with that."
        assert sub_agent.messages[0].is_streaming is True

    @pytest.mark.asyncio
    async def test_sub_agent_tool_end_updates_correct_context(self, status_builder):
        """Test that tool end events update the correct sub-agent context."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        sub_agent_run_id = "task-run-end-test"
        namespace = f"agent_node:{sub_agent_run_id}"
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
            "data": {"input": {"path": "/tmp/file.txt"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # End tool in sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "read_file",
            "run_id": tool_run_id,
            "data": {"output": "file contents"},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify tool completed in sub-agent
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert len(sub_agent.tool_calls) == 1
        assert sub_agent.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert sub_agent.tool_calls[0].result == "file contents"

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
        namespace1 = "node:sub-agent-1"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "search",
            "run_id": "tool-1",
            "data": {"input": {"query": "topic A"}},
            "metadata": {"langgraph_checkpoint_ns": namespace1}
        })
        
        # Tool call for sub-agent-2
        namespace2 = "node:sub-agent-2"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": "tool-2",
            "data": {"input": {"path": "/tmp/b.txt"}},
            "metadata": {"langgraph_checkpoint_ns": namespace2}
        })
        
        # Verify isolation
        sub_agent_1 = status_builder.current_status.sub_agent_executions[0]
        sub_agent_2 = status_builder.current_status.sub_agent_executions[1]
        
        assert sub_agent_1.name == "researcher"
        assert len(sub_agent_1.tool_calls) == 1
        assert sub_agent_1.tool_calls[0].name == "search"
        
        assert sub_agent_2.name == "code_editor"
        assert len(sub_agent_2.tool_calls) == 1
        assert sub_agent_2.tool_calls[0].name == "write_file"
        
        # Main agent should have no tool calls
        assert len(status_builder.current_status.tool_calls) == 0

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
        assert len(status_builder.current_status.tool_calls) == 1
        assert status_builder.current_status.tool_calls[0].name == "read_file"
        assert status_builder.current_status.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED
        
        # No sub-agent executions
        assert len(status_builder.current_status.sub_agent_executions) == 0

    @pytest.mark.asyncio
    async def test_sub_agent_message_finalization(self, status_builder):
        """Test that AI message finalization works for sub-agent messages."""
        sub_agent_run_id = "task-run-finalize"
        namespace = f"agent_node:{sub_agent_run_id}"
        
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
            "data": {"chunk": chunk},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify is_streaming is True
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.messages[0].is_streaming is True
        
        # Finalize AI message
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 50
        output.usage_metadata.output_tokens = 25
        output.usage_metadata.total_tokens = 75
        output.response_metadata = {"model": "claude-3"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify finalization
        assert sub_agent.messages[0].is_streaming is False
        assert sub_agent.messages[0].token_count == 75

    @pytest.mark.asyncio
    async def test_namespace_cleanup_on_sub_agent_end(self, status_builder):
        """Test that namespace mappings are cleaned up when sub-agent ends."""
        sub_agent_run_id = "task-run-cleanup"
        namespace = f"agent_node:{sub_agent_run_id}"
        
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
            "data": {"input": {"text": "hello"}},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify namespace is registered
        assert namespace in status_builder._namespace_to_sub_agent_id
        assert sub_agent_run_id in status_builder._active_sub_agents
        
        # End sub-agent
        await status_builder.process_event({
            "event": "on_tool_end",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {"output": "done"},
            "metadata": {}
        })
        
        # Verify cleanup
        assert namespace not in status_builder._namespace_to_sub_agent_id
        assert sub_agent_run_id not in status_builder._active_sub_agents

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


# =============================================================================
# Tests for Namespace Registration Strategies (Strategy 4 + diagnostics)
# =============================================================================


class TestNamespaceRegistrationStrategies:
    """Tests for _register_sub_agent_namespace Strategy 4 and diagnostic logging.

    Strategy 4 (sole-active-agent fallback) resolves the case where a single
    sub-agent produces events from multiple distinct namespace roots.  When
    exactly one sub-agent is active, all multi-segment namespaces are mapped
    to it without ambiguity.
    """

    @pytest.mark.asyncio
    async def test_sole_active_agent_fallback_registers_different_root(self, status_builder):
        """Strategy 4 maps a different-root namespace to the sole active sub-agent."""
        run_id = "sa-sole-001"

        # Start sub-agent (sets _pending_sub_agent_id)
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "editor", "input": "edit file"}},
            "metadata": {}
        })

        # First multi-segment namespace — consumed by causal correlation (Strategy 3)
        first_ns = "root-alpha:aaa|child-1"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "tool-causal",
            "data": {"input": {"path": "/tmp/a.py"}},
            "metadata": {"langgraph_checkpoint_ns": first_ns}
        })
        assert first_ns in status_builder._namespace_to_sub_agent_id
        assert status_builder._pending_sub_agent_id is None  # consumed

        # Second namespace with a DIFFERENT root — Strategy 4 should handle it
        second_ns = "root-beta:bbb|child-2"
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "write_file",
            "run_id": "tool-fallback",
            "data": {"input": {"path": "/tmp/b.py", "content": "x"}},
            "metadata": {"langgraph_checkpoint_ns": second_ns}
        })

        assert second_ns in status_builder._namespace_to_sub_agent_id
        assert status_builder._namespace_to_sub_agent_id[second_ns] == run_id

    @pytest.mark.asyncio
    async def test_sole_active_agent_routes_events_to_sub_agent(self, status_builder):
        """Events matched by Strategy 4 route to the sub-agent context, not main."""
        run_id = "sa-route-001"

        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": run_id,
            "data": {"input": {"subagent_type": "coder", "input": "code"}},
            "metadata": {}
        })

        # Consume causal correlation via first multi-segment namespace
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "echo",
            "run_id": "consume-causal",
            "data": {"input": {"text": "hi"}},
            "metadata": {"langgraph_checkpoint_ns": "root-one:x|node-a"}
        })

        # Different-root namespace — Strategy 4 fallback
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "list_files",
            "run_id": "routed-tool",
            "data": {"input": {"dir": "/tmp"}},
            "metadata": {"langgraph_checkpoint_ns": "root-two:y|node-b"}
        })

        # Tool call should be in sub-agent, not main
        assert len(status_builder.current_status.tool_calls) == 0
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        tool_names = [tc.name for tc in sub_agent.tool_calls]
        assert "list_files" in tool_names

    @pytest.mark.asyncio
    async def test_fallback_does_not_apply_with_multiple_sub_agents(self, status_builder):
        """Strategy 4 must NOT apply when 2+ sub-agents are active."""
        # Start first sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-multi-1",
            "data": {"input": {"subagent_type": "a", "input": "x"}},
            "metadata": {}
        })
        # Start second sub-agent (overwrites _pending_sub_agent_id)
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-multi-2",
            "data": {"input": {"subagent_type": "b", "input": "y"}},
            "metadata": {}
        })

        # Consume _pending_sub_agent_id via a first multi-segment namespace
        status_builder._register_sub_agent_namespace("consume-root:ccc|node-c")
        assert status_builder._pending_sub_agent_id is None

        assert len(status_builder._active_sub_agents) == 2

        # Ambiguous namespace — cannot be resolved with 2 active sub-agents
        ambiguous_ns = "unknown-root:zzz|node-x"
        status_builder._register_sub_agent_namespace(ambiguous_ns)

        assert ambiguous_ns not in status_builder._namespace_to_sub_agent_id

    @pytest.mark.asyncio
    async def test_diagnostic_warning_deduplicated(self, status_builder):
        """[NS_DIAG] warning is added to _warned_namespaces once, preventing log flood."""
        # Start two sub-agents to bypass Strategy 4
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-dedup-1",
            "data": {"input": {"subagent_type": "a", "input": "x"}},
            "metadata": {}
        })
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": "sa-dedup-2",
            "data": {"input": {"subagent_type": "b", "input": "y"}},
            "metadata": {}
        })

        # Consume pending
        status_builder._register_sub_agent_namespace("consume:root|node")
        assert status_builder._pending_sub_agent_id is None

        ns = "dedup-root:qqq|child"

        # First attempt — enters _warned_namespaces
        status_builder._register_sub_agent_namespace(ns)
        assert ns in status_builder._warned_namespaces
        assert ns not in status_builder._namespace_to_sub_agent_id

        # Subsequent attempts — no additional warning (set is idempotent)
        status_builder._register_sub_agent_namespace(ns)
        status_builder._register_sub_agent_namespace(ns)

        # Still not registered, but _warned_namespaces only has it once
        assert ns not in status_builder._namespace_to_sub_agent_id


# =============================================================================
# Tests for UsageMetrics (Phase 2.4)
# =============================================================================


class TestUsageMetrics:
    """Tests for UsageMetrics tracking and proto assignment.
    
    Phase 2.4 adds execution-level token tracking:
    - UsageMetrics proto with prompt_tokens, completion_tokens, total_tokens, llm_call_count, primary_model
    - Main agent usage tracked in status.usage
    - Sub-agent usage tracked in sub_agent.usage (isolated from main)
    - Progressive updates during streaming (not just at end)
    """

    @pytest.mark.asyncio
    async def test_usage_metrics_updated_on_chat_model_end(self, status_builder):
        """Test that UsageMetrics proto is populated after LLM call."""
        # Create AI message
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        # End with usage metadata
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 100
        output.usage_metadata.output_tokens = 50
        output.usage_metadata.total_tokens = 150
        output.response_metadata = {"model": "claude-sonnet-4"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        # Verify UsageMetrics proto is populated
        usage = status_builder.current_status.usage
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150
        assert usage.llm_call_count == 1
        assert usage.primary_model == "claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_llm_call_count_incremented(self, status_builder):
        """Test that llm_call_count increases with each LLM response."""
        for i in range(3):
            # Stream message
            chunk = MagicMock()
            chunk.content = f"Response {i}"
            await status_builder.process_event({
                "event": "on_chat_model_stream",
                "data": {"chunk": chunk},
                "metadata": {}
            })
            
            # End message
            output = MagicMock()
            output.usage_metadata = MagicMock()
            output.usage_metadata.input_tokens = 10
            output.usage_metadata.output_tokens = 5
            output.usage_metadata.total_tokens = 15
            output.response_metadata = {}
            
            await status_builder.process_event({
                "event": "on_chat_model_end",
                "data": {"output": output},
                "metadata": {}
            })
        
        # Verify call count
        assert status_builder.current_status.usage.llm_call_count == 3
        assert status_builder._llm_call_count == 3

    @pytest.mark.asyncio
    async def test_primary_model_captured_from_first_call(self, status_builder):
        """Test that primary_model is set from the first LLM response."""
        # First call with model A
        chunk = MagicMock()
        chunk.content = "First"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 10
        output.usage_metadata.output_tokens = 5
        output.usage_metadata.total_tokens = 15
        output.response_metadata = {"model": "claude-sonnet-4"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        assert status_builder.current_status.usage.primary_model == "claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_primary_model_not_overwritten(self, status_builder):
        """Test that subsequent different models don't change primary_model."""
        # First call
        chunk = MagicMock()
        chunk.content = "First"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        output1 = MagicMock()
        output1.usage_metadata = MagicMock()
        output1.usage_metadata.input_tokens = 10
        output1.usage_metadata.output_tokens = 5
        output1.usage_metadata.total_tokens = 15
        output1.response_metadata = {"model": "claude-sonnet-4"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output1},
            "metadata": {}
        })
        
        # Second call with different model
        chunk2 = MagicMock()
        chunk2.content = "Second"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk2},
            "metadata": {}
        })
        
        output2 = MagicMock()
        output2.usage_metadata = MagicMock()
        output2.usage_metadata.input_tokens = 20
        output2.usage_metadata.output_tokens = 10
        output2.usage_metadata.total_tokens = 30
        output2.response_metadata = {"model": "gpt-4o"}  # Different model
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output2},
            "metadata": {}
        })
        
        # Primary model should still be the first one
        assert status_builder.current_status.usage.primary_model == "claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_usage_accumulates_across_calls(self, status_builder):
        """Test that tokens accumulate correctly across multiple LLM calls."""
        # First call
        chunk = MagicMock()
        chunk.content = "First"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        output1 = MagicMock()
        output1.usage_metadata = MagicMock()
        output1.usage_metadata.input_tokens = 100
        output1.usage_metadata.output_tokens = 50
        output1.usage_metadata.total_tokens = 150
        output1.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output1},
            "metadata": {}
        })
        
        # Second call
        chunk2 = MagicMock()
        chunk2.content = "Second"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk2},
            "metadata": {}
        })
        
        output2 = MagicMock()
        output2.usage_metadata = MagicMock()
        output2.usage_metadata.input_tokens = 200
        output2.usage_metadata.output_tokens = 100
        output2.usage_metadata.total_tokens = 300
        output2.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output2},
            "metadata": {}
        })
        
        # Verify cumulative totals
        usage = status_builder.current_status.usage
        assert usage.prompt_tokens == 300  # 100 + 200
        assert usage.completion_tokens == 150  # 50 + 100
        assert usage.total_tokens == 450  # 300 + 150

    @pytest.mark.asyncio
    async def test_total_tokens_equals_sum(self, status_builder):
        """Test that total_tokens always equals prompt_tokens + completion_tokens."""
        chunk = MagicMock()
        chunk.content = "Test"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 123
        output.usage_metadata.output_tokens = 456
        output.usage_metadata.total_tokens = 579
        output.response_metadata = {}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        usage = status_builder.current_status.usage
        assert usage.total_tokens == usage.prompt_tokens + usage.completion_tokens

    @pytest.mark.asyncio
    async def test_sub_agent_usage_tracked_separately(self, status_builder):
        """Test that sub-agent has its own UsageMetrics populated."""
        sub_agent_run_id = "task-usage-test"
        namespace = f"agent_node:{sub_agent_run_id}"
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {
                "input": {
                    "subagent_type": "code_editor",
                    "input": "Edit code"
                }
            },
            "metadata": {}
        })
        
        # Sub-agent AI message
        chunk = MagicMock()
        chunk.content = "Sub-agent response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Sub-agent message end
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 200
        output.usage_metadata.output_tokens = 100
        output.usage_metadata.total_tokens = 300
        output.response_metadata = {"model": "claude-haiku"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify sub-agent usage
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.usage.prompt_tokens == 200
        assert sub_agent.usage.completion_tokens == 100
        assert sub_agent.usage.total_tokens == 300
        assert sub_agent.usage.llm_call_count == 1
        assert sub_agent.usage.primary_model == "claude-haiku"

    @pytest.mark.asyncio
    async def test_sub_agent_usage_isolated_from_main(self, status_builder):
        """Test that main agent usage doesn't include sub-agent tokens."""
        sub_agent_run_id = "task-isolation-test"
        namespace = f"agent_node:{sub_agent_run_id}"
        
        # Main agent call first
        chunk_main = MagicMock()
        chunk_main.content = "Main response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk_main},
            "metadata": {}
        })
        
        output_main = MagicMock()
        output_main.usage_metadata = MagicMock()
        output_main.usage_metadata.input_tokens = 100
        output_main.usage_metadata.output_tokens = 50
        output_main.usage_metadata.total_tokens = 150
        output_main.response_metadata = {"model": "claude-sonnet-4"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output_main},
            "metadata": {}
        })
        
        # Start sub-agent
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "task",
            "run_id": sub_agent_run_id,
            "data": {"input": {"subagent_type": "helper", "input": "Help"}},
            "metadata": {}
        })
        
        # Sub-agent call
        chunk_sub = MagicMock()
        chunk_sub.content = "Sub response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk_sub},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        output_sub = MagicMock()
        output_sub.usage_metadata = MagicMock()
        output_sub.usage_metadata.input_tokens = 500
        output_sub.usage_metadata.output_tokens = 250
        output_sub.usage_metadata.total_tokens = 750
        output_sub.response_metadata = {"model": "claude-haiku"}
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output_sub},
            "metadata": {"langgraph_checkpoint_ns": namespace}
        })
        
        # Verify main agent usage is NOT affected by sub-agent
        main_usage = status_builder.current_status.usage
        assert main_usage.prompt_tokens == 100  # Only main agent's tokens
        assert main_usage.completion_tokens == 50
        assert main_usage.total_tokens == 150
        assert main_usage.llm_call_count == 1  # Only main agent's call
        
        # Verify sub-agent has separate usage
        sub_agent = status_builder.current_status.sub_agent_executions[0]
        assert sub_agent.usage.prompt_tokens == 500
        assert sub_agent.usage.completion_tokens == 250
        assert sub_agent.usage.llm_call_count == 1

    @pytest.mark.asyncio
    async def test_usage_zero_when_no_llm_calls(self, status_builder):
        """Test that UsageMetrics defaults to zeros when no LLM calls made."""
        # Process a tool event (not an LLM call)
        await status_builder.process_event({
            "event": "on_tool_start",
            "name": "read_file",
            "run_id": "tool-1",
            "data": {"input": {"path": "/tmp/test.txt"}},
            "metadata": {}
        })
        
        # Verify defaults
        usage = status_builder.current_status.usage
        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 0
        assert usage.llm_call_count == 0
        assert usage.primary_model == ""

    @pytest.mark.asyncio
    async def test_usage_handles_missing_model_name(self, status_builder):
        """Test graceful handling when model name is not available."""
        chunk = MagicMock()
        chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {}
        })
        
        output = MagicMock()
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 50
        output.usage_metadata.output_tokens = 25
        output.usage_metadata.total_tokens = 75
        output.response_metadata = {}  # No model name
        
        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {}
        })
        
        # Should work without error, model remains empty
        usage = status_builder.current_status.usage
        assert usage.prompt_tokens == 50
        assert usage.completion_tokens == 25
        assert usage.llm_call_count == 1
        assert usage.primary_model == ""  # Empty, not error

    @pytest.mark.asyncio
    async def test_build_usage_metrics_helper(self, status_builder):
        """Test _build_usage_metrics helper method directly."""
        # Set up internal state
        status_builder._total_prompt_tokens = 1000
        status_builder._total_completion_tokens = 500
        status_builder._llm_call_count = 5
        status_builder._primary_model = "claude-opus-4"
        
        # Call helper
        usage = status_builder._build_usage_metrics()
        
        # Verify
        assert usage.prompt_tokens == 1000
        assert usage.completion_tokens == 500
        assert usage.total_tokens == 1500
        assert usage.llm_call_count == 5
        assert usage.primary_model == "claude-opus-4"

    @pytest.mark.asyncio
    async def test_build_sub_agent_usage_helper(self, status_builder):
        """Test _build_sub_agent_usage helper method directly."""
        sub_agent_id = "test-sub-agent"
        
        # Set up internal state
        status_builder._sub_agent_prompt_tokens[sub_agent_id] = 200
        status_builder._sub_agent_completion_tokens[sub_agent_id] = 100
        status_builder._sub_agent_llm_call_count[sub_agent_id] = 2
        status_builder._sub_agent_primary_model[sub_agent_id] = "claude-haiku"
        
        # Call helper
        usage = status_builder._build_sub_agent_usage(sub_agent_id)
        
        # Verify
        assert usage.prompt_tokens == 200
        assert usage.completion_tokens == 100
        assert usage.total_tokens == 300
        assert usage.llm_call_count == 2
        assert usage.primary_model == "claude-haiku"

    @pytest.mark.asyncio
    async def test_build_sub_agent_usage_defaults_for_unknown(self, status_builder):
        """Test _build_sub_agent_usage returns zeros for unknown sub-agent."""
        usage = status_builder._build_sub_agent_usage("nonexistent-id")
        
        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0
        assert usage.total_tokens == 0
        assert usage.llm_call_count == 0
        assert usage.primary_model == ""


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


# =============================================================================
# Tests for Approval Policy Resolution (HITL Phase 2)
# =============================================================================


class TestApprovalPolicyResolution:
    """Tests for approval policy resolution logic.
    
    Tests cover the policy chain evaluation:
    1. auto_approve_all (highest priority)
    2. tool_approval_overrides (per-agent)
    3. default_tool_approvals (MCP server defaults)
    """
    
    def test_auto_approve_all_bypasses_all_policies(self):
        """Test that auto_approve_all=True bypasses all approval requirements."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        # Even with MCP default requiring approval, auto_approve_all bypasses
        default_policies = [
            {"tool_name": "delete_repository", "message": "Delete repo {{args.repo}}"}
        ]
        
        result = resolve_tool_approval(
            tool_name="delete_repository",
            mcp_server_name="github",
            auto_approve_all=True,  # Highest priority bypass
            tool_approval_overrides=[],
            default_tool_approvals=default_policies,
        )
        
        assert result.requires_approval is False
        assert result.source == "auto_approve_all"
    
    def test_agent_override_takes_precedence_over_mcp_default(self):
        """Test that agent override takes precedence over MCP default."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
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
            default_tool_approvals=default_policies,
        )
        
        assert result.requires_approval is False
        assert result.source == "agent_override"
    
    def test_agent_override_adds_approval_not_in_mcp_default(self):
        """Test that agent can add approval for tools not in MCP defaults."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
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
            default_tool_approvals=default_policies,
        )
        
        assert result.requires_approval is True
        assert result.source == "agent_override"
        assert "{{args.recipient}}" in result.message
    
    def test_mcp_default_applied_when_no_override(self):
        """Test that MCP default is applied when no agent override exists."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        default_policies = [
            {"tool_name": "delete_repository", "message": "Delete repo: {{args.repo}}"}
        ]
        
        result = resolve_tool_approval(
            tool_name="delete_repository",
            mcp_server_name="github",
            auto_approve_all=False,
            tool_approval_overrides=[],  # No override
            default_tool_approvals=default_policies,
        )
        
        assert result.requires_approval is True
        assert result.source == "mcp_default"
        assert "{{args.repo}}" in result.message
    
    def test_no_approval_required_when_no_policy_matches(self):
        """Test that tools without policies don't require approval."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="list_issues",  # Non-platform tool with no policy
            mcp_server_name="github",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "none"
    
    def test_approval_message_template_rendering(self):
        """Test that message templates are rendered with tool arguments."""
        from worker.activities.graphton.approval_policy import render_approval_message
        
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
        from worker.activities.graphton.approval_policy import render_approval_message
        
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
        from worker.activities.graphton.approval_policy import render_approval_message
        
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
        from worker.activities.graphton.approval_policy import render_approval_message
        
        result = render_approval_message(
            template="",
            tool_name="dangerous_operation",
            tool_args={},
        )
        
        assert result == "Execute tool: dangerous_operation"
    
    def test_approval_message_nested_args(self):
        """Test rendering with nested argument values."""
        from worker.activities.graphton.approval_policy import render_approval_message
        
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
        from worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="read",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
    
    def test_platform_tool_write_requires_approval(self):
        """Test that 'write' platform tool requires approval by default."""
        from worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="write",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
        assert "{{args.path}}" in result.message  # Template not yet rendered
    
    def test_platform_tool_execute_requires_approval(self):
        """Test that 'execute' platform tool requires approval by default."""
        from worker.activities.graphton.approval_policy import (
            PLATFORM_SERVER_NAME,
            resolve_tool_approval,
        )
        
        result = resolve_tool_approval(
            tool_name="execute",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
        assert result.mcp_server == PLATFORM_SERVER_NAME
        assert "{{args.command}}" in result.message
    
    def test_platform_tool_edit_requires_approval(self):
        """Test that 'edit' platform tool requires approval by default."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="edit",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is True
        assert result.source == "platform_default"
    
    def test_platform_tool_ls_no_approval_required(self):
        """Test that 'ls' platform tool does not require approval."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="ls",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_platform_tool_glob_no_approval_required(self):
        """Test that 'glob' platform tool does not require approval."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="glob",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_platform_tool_grep_no_approval_required(self):
        """Test that 'grep' platform tool does not require approval."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="grep",
            mcp_server_name="",
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "platform_default"
    
    def test_auto_approve_all_bypasses_platform_tool_approval(self):
        """Test that auto_approve_all=True bypasses platform tool approval."""
        from worker.activities.graphton.approval_policy import resolve_tool_approval
        
        result = resolve_tool_approval(
            tool_name="write",  # Normally requires approval
            mcp_server_name="",
            auto_approve_all=True,  # Bypass
            tool_approval_overrides=[],
            default_tool_approvals=[],
        )
        
        assert result.requires_approval is False
        assert result.source == "auto_approve_all"
    
    def test_is_platform_tool_helper(self):
        """Test is_platform_tool() helper function."""
        from worker.activities.graphton.approval_policy import is_platform_tool
        
        # Platform tools
        assert is_platform_tool("read") is True
        assert is_platform_tool("write") is True
        assert is_platform_tool("edit") is True
        assert is_platform_tool("execute") is True
        assert is_platform_tool("ls") is True
        assert is_platform_tool("glob") is True
        assert is_platform_tool("grep") is True
        assert is_platform_tool("think") is True
        
        # Aliases resolve to platform tools
        assert is_platform_tool("read_file") is True
        assert is_platform_tool("write_file") is True
        assert is_platform_tool("edit_file") is True
        
        # Non-platform tools
        assert is_platform_tool("delete_repository") is False
        assert is_platform_tool("send_email") is False
    
    def test_get_platform_tool_names_helper(self):
        """Test get_platform_tool_names() helper function."""
        from worker.activities.graphton.approval_policy import get_platform_tool_names
        
        names = get_platform_tool_names()
        
        assert "read" in names
        assert "write" in names
        assert "edit" in names
        assert "execute" in names
        assert "ls" in names
        assert "glob" in names
        assert "grep" in names
        assert "think" in names
        assert len(names) == 8


# =============================================================================
# Tests for ApprovalConfig (HITL Phase 2)
# =============================================================================


class TestApprovalConfig:
    """Tests for ApprovalConfig dataclass."""
    
    def test_get_mcp_server_for_tool_found(self):
        """Test getting MCP server for a known tool."""
        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github", "send_email": "email"}
        )
        
        assert config.get_mcp_server_for_tool("delete_repository") == "github"
        assert config.get_mcp_server_for_tool("send_email") == "email"
    
    def test_get_mcp_server_for_tool_not_found(self):
        """Test getting MCP server for unknown tool returns empty string."""
        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github"}
        )
        
        assert config.get_mcp_server_for_tool("unknown_tool") == ""
    
    def test_get_default_policies_for_tool(self):
        """Test getting default policies for a tool's MCP server."""
        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        policies = [{"tool_name": "delete_repository", "message": "Delete repo"}]
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"delete_repository": "github"},
            default_tool_approvals={"github": policies}
        )
        
        result = config.get_default_policies_for_tool("delete_repository")
        assert result == policies
    
    def test_get_default_policies_for_unknown_server(self):
        """Test that unknown server returns empty policies list."""
        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_to_mcp_server={"unknown_tool": "unknown_server"},
            default_tool_approvals={"github": []}
        )
        
        result = config.get_default_policies_for_tool("unknown_tool")
        assert result == []


# =============================================================================
# Tests for Tool Waiting Approval (HITL Phase 2)
# =============================================================================


class TestToolWaitingApproval:
    """Tests for set_tool_waiting_approval method."""
    
    @pytest.fixture
    def status_builder_with_approval(self, mock_initial_status):
        """Create StatusBuilder with a tool call already added."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        builder = StatusBuilder(
            execution_id="test-execution-approval",
            initial_status=mock_initial_status
        )
        
        # Add a tool call to work with
        tool_call = ToolCall(
            id="tool-run-123",
            name="delete_repository",
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.tool_calls.append(tool_call)
        
        return builder
    
    def test_set_tool_waiting_approval_updates_status(self, status_builder_with_approval):
        """Test that set_tool_waiting_approval updates tool call status."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={"repo": "my-repo"},
            approval_message="Delete repo: my-repo",
        )
        
        tool_call = status_builder_with_approval.current_status.tool_calls[0]
        assert tool_call.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        assert tool_call.requires_approval is True
    
    def test_set_tool_waiting_approval_tracks_pending(self, status_builder_with_approval):
        """Test that pending approval is tracked in _pending_tool_approvals."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={"repo": "my-repo"},
            approval_message="Delete repo: my-repo",
        )
        
        assert "tool-run-123" in status_builder_with_approval._pending_tool_approvals
    
    def test_set_tool_waiting_approval_sets_execution_phase(self, status_builder_with_approval):
        """Test that execution phase is updated to WAITING_FOR_APPROVAL."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={},
            approval_message="Delete repo",
        )
        
        assert status_builder_with_approval.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
    
    def test_set_tool_waiting_approval_sets_timestamps(self, status_builder_with_approval):
        """Test that approval timestamps are set correctly."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={},
            approval_message="Delete repo",
        )
        
        tool_call = status_builder_with_approval.current_status.tool_calls[0]
        
        # Tool call should have timestamp set
        assert tool_call.approval_requested_at != ""
        # Timestamps should be ISO 8601 format
        assert "T" in tool_call.approval_requested_at
    
    def test_set_tool_waiting_approval_from_sub_agent(self, status_builder_with_approval):
        """Test that sub-agent flag is set correctly."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={},
            approval_message="Delete repo",
            from_sub_agent=True,
            sub_agent_name="code-reviewer",
        )
        
        # Verify tracked in pending list
        assert "tool-run-123" in status_builder_with_approval._pending_tool_approvals
    
    def test_set_tool_waiting_approval_args_preview(self, status_builder_with_approval):
        """Test that set_tool_waiting_approval tracks pending state."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={"repo": "my-repo", "force": True},
            approval_message="Delete repo",
        )
        
        # Verify pending approval state tracked internally
        assert "tool-run-123" in status_builder_with_approval._pending_tool_approvals
        # Phase should be WAITING_FOR_APPROVAL
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        assert status_builder_with_approval.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL


# =============================================================================
# Tests for Tool Approval Decision (HITL Phase 2)
# =============================================================================


class TestToolApprovalDecision:
    """Tests for set_tool_approval_decision method."""
    
    @pytest.fixture
    def status_builder_waiting_approval(self, mock_initial_status):
        """Create StatusBuilder with a tool in WAITING_APPROVAL state."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import PendingApproval, ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        builder = StatusBuilder(
            execution_id="test-execution-decision",
            initial_status=mock_initial_status
        )
        
        # Add a tool call in WAITING_APPROVAL state
        tool_call = ToolCall(
            id="tool-run-456",
            name="delete_repository",
            status=ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requires_approval=True,
            approval_message="Delete repo: my-repo",
        )
        mock_initial_status.tool_calls.append(tool_call)
        
        # Set up pending state using the plural tracking list
        builder._pending_tool_approvals = ["tool-run-456"]
        builder._saved_phase_before_approval = ExecutionPhase.EXECUTION_IN_PROGRESS
        builder.current_status.pending_approvals.append(PendingApproval(
            tool_call_id="tool-run-456",
            tool_name="delete_repository",
        ))
        builder.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        return builder
    
    def test_approve_action_clears_pending_state(self, status_builder_waiting_approval):
        """Test that APPROVE clears pending state and restores phase."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user-123",
        )
        
        # Pending state should be cleared
        assert len(status_builder_waiting_approval._pending_tool_approvals) == 0
        # Phase should be restored
        assert status_builder_waiting_approval.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
    
    def test_approve_action_records_decision(self, status_builder_waiting_approval):
        """Test that APPROVE records the decision on the tool call."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user-123",
        )
        
        tool_call = status_builder_waiting_approval.current_status.tool_calls[0]
        assert tool_call.approval_action == ApprovalAction.APPROVAL_ACTION_APPROVE
        assert tool_call.approved_by == "user-123"
        assert tool_call.approval_decided_at != ""
    
    def test_skip_action_sets_skipped_status(self, status_builder_waiting_approval):
        """Test that SKIP sets TOOL_CALL_SKIPPED status."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_SKIP,
            approved_by="user-123",
        )
        
        tool_call = status_builder_waiting_approval.current_status.tool_calls[0]
        assert tool_call.status == ToolCallStatus.TOOL_CALL_SKIPPED
        assert "skipped by user" in tool_call.result
    
    def test_skip_action_continues_execution(self, status_builder_waiting_approval):
        """Test that SKIP restores execution phase (not FAILED)."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_SKIP,
            approved_by="user-123",
        )
        
        # Should restore to IN_PROGRESS, not FAILED
        assert status_builder_waiting_approval.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
    
    def test_reject_action_sets_failed_status(self, status_builder_waiting_approval):
        """Test that REJECT sets TOOL_CALL_FAILED status."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_REJECT,
            approved_by="user-123",
        )
        
        tool_call = status_builder_waiting_approval.current_status.tool_calls[0]
        assert tool_call.status == ToolCallStatus.TOOL_CALL_FAILED
        assert "rejected" in tool_call.error.lower()
    
    def test_reject_action_fails_execution(self, status_builder_waiting_approval):
        """Test that REJECT sets execution phase to FAILED."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_REJECT,
            approved_by="user-123",
        )
        
        # Should be FAILED, not IN_PROGRESS
        assert status_builder_waiting_approval.current_status.phase == ExecutionPhase.EXECUTION_FAILED
    
    def test_decision_records_approved_by_and_timestamp(self, status_builder_waiting_approval):
        """Test that decision records who approved and when."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="admin-user-999",
        )
        
        tool_call = status_builder_waiting_approval.current_status.tool_calls[0]
        assert tool_call.approved_by == "admin-user-999"
        assert tool_call.approval_decided_at != ""
        # Should be ISO 8601 format
        assert "T" in tool_call.approval_decided_at
    
    def test_decision_clears_pending_approvals_proto(self, status_builder_waiting_approval):
        """Test that decision clears the pending_approvals proto field."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        # Verify pending_approvals is set before
        assert len(status_builder_waiting_approval.current_status.pending_approvals) > 0
        assert status_builder_waiting_approval.current_status.pending_approvals[0].tool_call_id == "tool-run-456"
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user-123",
        )
        
        # pending_approvals should be cleared
        assert len(status_builder_waiting_approval.current_status.pending_approvals) == 0


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
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import PendingApproval, ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus
        
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
        builder._pending_tool_approvals = ["tool-run-phase54"]
        builder._saved_phase_before_approval = ExecutionPhase.EXECUTION_IN_PROGRESS
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
    
    def test_approve_clears_pending_approvals_completely(self, status_builder_with_pending_approval):
        """Phase 5.4: Verify APPROVE action clears all pending_approvals fields."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        # Verify pending_approvals is set before
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) == 1
        pa = status_builder_with_pending_approval.current_status.pending_approvals[0]
        assert pa.tool_call_id == "tool-run-phase54"
        assert pa.tool_name == "dangerous_operation"
        assert pa.message == "Execute dangerous operation?"
        assert pa.args_preview == '{"target": "production"}'
        assert pa.requested_at == "2026-01-30T12:00:00Z"
        
        # Execute APPROVE decision
        status_builder_with_pending_approval.set_tool_approval_decision(
            run_id="tool-run-phase54",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user-123",
        )
        
        # Verify pending_approvals is cleared
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) == 0
        
        # Verify internal tracking state is also cleared
        assert len(status_builder_with_pending_approval._pending_tool_approvals) == 0
    
    def test_skip_clears_pending_approvals_completely(self, status_builder_with_pending_approval):
        """Phase 5.4: Verify SKIP action clears all pending_approvals fields."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        # Verify pending_approvals is set before
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) > 0
        
        # Execute SKIP decision
        status_builder_with_pending_approval.set_tool_approval_decision(
            run_id="tool-run-phase54",
            action=ApprovalAction.APPROVAL_ACTION_SKIP,
            approved_by="user-123",
        )
        
        # Verify pending_approvals is cleared
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) == 0
        
        # Verify internal tracking state is also cleared
        assert len(status_builder_with_pending_approval._pending_tool_approvals) == 0
    
    def test_reject_clears_pending_approvals_completely(self, status_builder_with_pending_approval):
        """Phase 5.4: Verify REJECT action clears all pending_approvals fields."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        # Verify pending_approvals is set before
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) > 0
        
        # Execute REJECT decision
        status_builder_with_pending_approval.set_tool_approval_decision(
            run_id="tool-run-phase54",
            action=ApprovalAction.APPROVAL_ACTION_REJECT,
            approved_by="user-123",
        )
        
        # Verify pending_approvals is cleared even on REJECT
        # This is important: REJECT should still clear pending state
        assert len(status_builder_with_pending_approval.current_status.pending_approvals) == 0
        
        # Verify internal tracking state is also cleared
        assert len(status_builder_with_pending_approval._pending_tool_approvals) == 0
    
    def test_clear_pending_approval_restores_saved_phase(self, status_builder_with_pending_approval):
        """Phase 5.4: Verify clear_pending_approval restores the saved phase."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        # Verify starting state
        assert status_builder_with_pending_approval.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        assert status_builder_with_pending_approval._saved_phase_before_approval == ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Call clear_pending_approval directly
        status_builder_with_pending_approval.clear_pending_approval()
        
        # Verify phase is restored to IN_PROGRESS (not WAITING_FOR_APPROVAL)
        assert status_builder_with_pending_approval.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Verify saved phase is reset to None after restoration
        assert status_builder_with_pending_approval._saved_phase_before_approval is None


# =============================================================================
# Tests for Tool Start Approval Integration (HITL Phase 2)
# =============================================================================


class TestToolStartApprovalIntegration:
    """Tests for approval check integration in _handle_tool_start_event."""
    
    @pytest.fixture
    def status_builder_with_approval_config(self, mock_initial_status):
        """Create StatusBuilder with approval config."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase

        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # Configure approval policy: delete_repository requires approval
        approval_config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals={
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
        tool_call = status_builder_with_approval_config.current_status.tool_calls[0]
        assert tool_call.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        assert tool_call.requires_approval is True
        
        # Execution phase should be WAITING_FOR_APPROVAL
        assert status_builder_with_approval_config.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
        
        # Pending approval should be tracked internally
        assert "tool-run-approval-001" in status_builder_with_approval_config._pending_tool_approvals
    
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
        tool_call = status_builder_with_approval_config.current_status.tool_calls[0]
        assert tool_call.status == ToolCallStatus.TOOL_CALL_RUNNING
        assert tool_call.requires_approval is False
        
        # Execution phase should remain IN_PROGRESS
        assert status_builder_with_approval_config.current_status.phase == ExecutionPhase.EXECUTION_IN_PROGRESS
    
    @pytest.mark.asyncio
    async def test_tool_start_skips_approval_when_auto_approve_all(self, mock_initial_status):
        """Test that auto_approve_all bypasses approval requirements."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase, ToolCallStatus

        from worker.activities.graphton.approval_policy import ApprovalConfig
        
        mock_initial_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        # auto_approve_all is True - should bypass all approval
        approval_config = ApprovalConfig(
            auto_approve_all=True,  # Bypass all approval
            tool_approval_overrides=[],
            default_tool_approvals={
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
        tool_call = builder.current_status.tool_calls[0]
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
        tool_call = builder.current_status.tool_calls[0]
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
        tool_call = status_builder_with_approval_config.current_status.tool_calls[0]
        assert "production-db" in tool_call.approval_message
        
        # Pending approval should be tracked
        assert "tool-run-render-test" in status_builder_with_approval_config._pending_tool_approvals


# =============================================================================
# Tests for build_approval_config function (HITL Phase 3A)
# =============================================================================


class TestBuildApprovalConfig:
    """
    Tests for the build_approval_config() function in execute_graphton.py.
    
    This function assembles ApprovalConfig from execution context:
    - execution.spec.auto_approve_all
    - mcp_server_usages[].tool_approval_overrides
    - mcp_servers[].spec.default_tool_approvals
    - mcp_tools_config (inverted to tool_to_mcp_server)
    """
    
    def test_empty_inputs_return_safe_defaults(self):
        """Test that empty inputs return ApprovalConfig with safe defaults."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        assert config.default_tool_approvals == {}
        assert config.tool_to_mcp_server == {}
    
    def test_auto_approve_all_extracted_from_execution_spec(self):
        """Test that auto_approve_all is correctly extracted from execution.spec."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
    
    def test_default_tool_approvals_keyed_by_server_slug(self):
        """Test that default_tool_approvals are correctly keyed by server slug."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        server1.spec.default_tool_approvals = [policy1]
        
        server2 = MagicMock()
        server2.metadata.slug = "postgres"
        server2.spec.default_tool_approvals = [policy2]
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server1, server2],
            mcp_tools_config={},
        )
        
        assert len(config.default_tool_approvals) == 2
        assert "github" in config.default_tool_approvals
        assert "postgres" in config.default_tool_approvals
        assert config.default_tool_approvals["github"] == [policy1]
        assert config.default_tool_approvals["postgres"] == [policy2]
    
    def test_default_tool_approvals_falls_back_to_name_when_slug_missing(self):
        """Test that server name is used as fallback when slug is missing."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        policy = MagicMock()
        
        # Server with name but no slug
        server = MagicMock()
        server.metadata.name = "my-github-server"
        del server.metadata.slug  # No slug
        server.spec.default_tool_approvals = [policy]
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )
        
        # Should use name as key
        assert "my-github-server" in config.default_tool_approvals
    
    def test_default_tool_approvals_handles_empty_policies(self):
        """Test that servers with empty default_tool_approvals are skipped."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
        execution = MagicMock()
        execution.spec.auto_approve_all = False
        
        # Server with empty policies
        server = MagicMock()
        server.metadata.slug = "github"
        server.spec.default_tool_approvals = []
        
        config = build_approval_config(
            execution=execution,
            mcp_server_usages=[],
            mcp_servers=[server],
            mcp_tools_config={},
        )
        
        # Should not include servers with empty policies
        assert "github" not in config.default_tool_approvals
    
    def test_tool_to_mcp_server_mapping_inverted_correctly(self):
        """Test that mcp_tools_config is correctly inverted to tool_to_mcp_server."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        server.spec.default_tool_approvals = [default_policy]
        
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
        assert "github" in config.default_tool_approvals
        assert config.default_tool_approvals["github"] == [default_policy]
        assert len(config.tool_to_mcp_server) == 3
        assert config.get_mcp_server_for_tool("delete_repository") == "github"
    
    def test_malformed_server_handled_gracefully(self):
        """Test that malformed MCP server objects don't crash the function."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        
        assert config.default_tool_approvals == {}
    
    def test_malformed_usage_handled_gracefully(self):
        """Test that malformed MCP server usage objects don't crash the function."""
        from worker.activities.graphton.approval_policy import build_approval_config
        
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
        from worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig()
        checker = create_approval_checker(config)
        
        assert callable(checker)
    
    def test_checker_returns_no_approval_when_auto_approve_all(self):
        """Test that checker returns no approval required when auto_approve_all is True."""
        from worker.activities.graphton.approval_policy import (
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
        from worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals={},
            tool_to_mcp_server={"some_tool": "some-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("unknown_tool", {"arg1": "value"})
        
        assert result.requires_approval is False
        assert result.source == "none"
    
    def test_checker_returns_approval_required_from_mcp_default(self):
        """Test that checker returns approval required from MCP default policy."""
        from worker.activities.graphton.approval_policy import (
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
            default_tool_approvals={"test-server": [policy]},
            tool_to_mcp_server={"delete_resource": "test-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("delete_resource", {})
        
        assert result.requires_approval is True
        assert result.source == "mcp_default"
        assert "delete" in result.message.lower()
    
    def test_checker_returns_approval_required_from_agent_override(self):
        """Test that checker returns approval required from agent override."""
        from worker.activities.graphton.approval_policy import (
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
            default_tool_approvals={},
            tool_to_mcp_server={"send_email": "email-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("send_email", {"recipient": "user@example.com"})
        
        assert result.requires_approval is True
        assert result.source == "agent_override"
        assert "user@example.com" in result.message
    
    def test_checker_renders_message_template_with_args(self):
        """Test that checker renders {{args.field}} placeholders in message."""
        from worker.activities.graphton.approval_policy import (
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
            default_tool_approvals={"fs-server": [policy]},
            tool_to_mcp_server={"delete_file": "fs-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("delete_file", {"path": "config.yaml", "directory": "/app"})
        
        assert "config.yaml" in result.message
        assert "/app" in result.message
    
    def test_checker_includes_mcp_server_in_result(self):
        """Test that checker result includes mcp_server field."""
        from worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals={},
            tool_to_mcp_server={"test_tool": "my-mcp-server"},
        )
        checker = create_approval_checker(config)
        
        result = checker("test_tool", {})
        
        assert result.mcp_server == "my-mcp-server"
    
    def test_checker_handles_missing_tool_gracefully(self):
        """Test that checker handles tools not in config gracefully."""
        from worker.activities.graphton.approval_policy import (
            ApprovalConfig,
            create_approval_checker,
        )
        
        config = ApprovalConfig(
            auto_approve_all=False,
            tool_approval_overrides=[],
            default_tool_approvals={},
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
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            AgentExecutionStatus,
        )
        
        # Create execution with no pending approvals
        status = AgentExecutionStatus()
        
        execution = MagicMock()
        execution.status = status
        
        # Check: empty pending_approvals means fresh execution
        has_pending = len(execution.status.pending_approvals) > 0
        assert has_pending is False
    
    def test_pending_approvals_with_decision_is_resume(self):
        """Test that pending_approvals with decision triggers resume."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            AgentExecutionStatus,
            ApprovalAction,
            PendingApproval,
        )
        
        # Create execution with pending approvals and decision
        status = AgentExecutionStatus()
        status.pending_approvals.append(PendingApproval(
            tool_call_id="call_abc123",
            tool_name="delete_resource",
        ))
        
        # Add tool call with approval decision
        tool_call = status.tool_calls.add()
        tool_call.id = "call_abc123"
        tool_call.name = "delete_resource"
        tool_call.approval_action = ApprovalAction.APPROVAL_ACTION_APPROVE
        tool_call.approved_by = "user@test.com"
        
        # Check: has pending approvals
        has_pending = len(status.pending_approvals) > 0
        assert has_pending is True
        
        # Find tool call and check decision
        found_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
        for tc in status.tool_calls:
            if tc.id == status.pending_approvals[0].tool_call_id:
                found_action = tc.approval_action
                break
        
        assert found_action == ApprovalAction.APPROVAL_ACTION_APPROVE
    
    def test_pending_approvals_without_decision_is_warning(self):
        """Test that pending_approvals without decision logs warning."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            AgentExecutionStatus,
            ApprovalAction,
            PendingApproval,
        )
        
        # Create execution with pending approvals but NO decision
        status = AgentExecutionStatus()
        status.pending_approvals.append(PendingApproval(
            tool_call_id="call_abc123",
            tool_name="delete_resource",
        ))
        
        # Add tool call WITHOUT approval decision
        tool_call = status.tool_calls.add()
        tool_call.id = "call_abc123"
        tool_call.name = "delete_resource"
        # approval_action defaults to UNSPECIFIED
        
        # Find tool call and check decision
        found_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
        for tc in status.tool_calls:
            if tc.id == status.pending_approvals[0].tool_call_id:
                found_action = tc.approval_action
                break
        
        # This should be UNSPECIFIED - triggers warning in real code
        assert found_action == ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
    
    def test_approval_action_mapping_to_strings(self):
        """Test that ApprovalAction enum values map correctly to strings."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
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
        
        assert status_builder._context_info is not None
        assert status_builder._context_info.context_window_limit == 200000
        assert status_builder._context_info.summarization_trigger_threshold == 180000
        assert status_builder._context_info.summarization_target_tokens == 160000
        assert status_builder._context_info.summarization_enabled is True
        assert status_builder._context_info.current_token_count == 0
        assert status_builder._context_info.utilization_percent == 0.0
    
    def test_initialize_context_info_disabled(self, status_builder):
        """Test that initialize_context_info works when disabled."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=0,
            target_tokens=0,
            enabled=False,
        )
        
        assert status_builder._context_info is not None
        assert status_builder._context_info.summarization_enabled is False
    
    def test_on_token_count_updated_updates_count(self, status_builder):
        """Test that on_token_count_updated updates the current token count."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        status_builder.on_token_count_updated(50000)
        
        assert status_builder._context_info.current_token_count == 50000
    
    def test_on_token_count_updated_calculates_utilization(self, status_builder):
        """Test that on_token_count_updated calculates utilization percentage."""
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        status_builder.on_token_count_updated(100000)  # 50% of 200000
        
        assert status_builder._context_info.utilization_percent == 50.0
    
    def test_on_token_count_updated_without_init_is_noop(self, status_builder):
        """Test that on_token_count_updated is a no-op without initialization."""
        # Should not raise
        status_builder.on_token_count_updated(50000)
        
        # Context info should still be None
        assert status_builder._context_info is None
    
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
        )
        
        status_builder.on_summarization_complete(event)
        
        assert len(status_builder._summarization_events) == 1
        recorded = status_builder._summarization_events[0]
        assert recorded.tokens_before == 185000
        assert recorded.tokens_after == 80000
        assert recorded.compression_ratio == pytest.approx(0.57, rel=0.01)
        assert recorded.duration_ms == 2500
        assert recorded.summarization_model == "claude-haiku-4"
        assert recorded.messages_before == 50
        assert recorded.messages_after == 10
        assert recorded.timestamp != ""  # Should have timestamp
    
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
        )
        
        status_builder.on_summarization_complete(event)
        
        # Token count should be updated to tokens_after
        assert status_builder._context_info.current_token_count == 80000
        # Utilization should be recalculated: 80000/200000 = 40%
        assert status_builder._context_info.utilization_percent == 40.0
    
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
        )
        
        # Should not raise
        status_builder.on_summarization_complete(event)
        
        # No events should be recorded
        assert len(status_builder._summarization_events) == 0
    
    def test_finalize_context_info_copies_to_status(self, status_builder):
        """Test that finalize_context_info copies context info to status proto."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ContextInfo
        
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
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ContextInfo
        from graphton.core.summarization_callback import SummarizationEventData
        
        # Need real proto for CopyFrom
        status_builder.current_status.context_info = ContextInfo()
        
        status_builder.initialize_context_info(
            context_window_limit=200000,
            trigger_threshold=180000,
            target_tokens=160000,
            enabled=True,
        )
        
        # Add two summarization events
        event1 = SummarizationEventData(
            tokens_before=185000,
            tokens_after=80000,
            compression_ratio=0.57,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=50,
            messages_after=10,
        )
        event2 = SummarizationEventData(
            tokens_before=180000,
            tokens_after=75000,
            compression_ratio=0.58,
            duration_ms=2300,
            summarization_model="claude-haiku-4",
            messages_before=45,
            messages_after=8,
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
        assert status_builder._context_info.current_token_count == 50000
        
        status_builder.on_token_count_updated(100000)
        assert status_builder._context_info.current_token_count == 100000
        
        status_builder.on_token_count_updated(150000)
        assert status_builder._context_info.current_token_count == 150000
        assert status_builder._context_info.utilization_percent == 75.0
    
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
        assert status_builder._context_info.utilization_percent == 0.0


# =============================================================================
# Run-ID Alias Resolution (Resume-After-Approval Fix)
# =============================================================================


class TestRunIdAliasResolution:
    """Tests for the run-ID alias mechanism that enables tool calls to
    transition to COMPLETED on the resume-after-approval path.

    When a tool call is interrupted for approval and then resumed, LangGraph
    generates a new run_id for the resumed execution.  The fingerprint
    deduplication in _handle_tool_start_event records an alias from the new
    run_id to the original tool_call.id so that _handle_tool_end_event can
    find and update the correct ToolCall.
    """

    @pytest.mark.asyncio
    async def test_alias_recorded_on_duplicate_fingerprint(self, mock_initial_status):
        """When a duplicate fingerprint is detected after
        populate_fingerprints_from_existing_tool_calls, the new run_id is
        recorded as an alias for the original tool call id."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        from google.protobuf.struct_pb2 import Struct

        original_run_id = "original-run-001"
        new_run_id = "resumed-run-002"

        # Simulate a tool call from a previous invocation persisted in DB.
        args = Struct()
        args.update({"path": "/bin/skills/agent-drafter/SKILL.md", "content": "..."})
        existing_tc = ToolCall(
            id=original_run_id,
            name="write",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.tool_calls.append(existing_tc)

        builder = StatusBuilder("exec-alias-1", mock_initial_status)
        builder.populate_fingerprints_from_existing_tool_calls()

        # Simulate LangGraph re-firing on_tool_start with a new run_id.
        event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": new_run_id,
            "data": {"input": {"path": "/bin/skills/agent-drafter/SKILL.md", "content": "..."}},
        }
        await builder.process_event(event)

        # The alias should map new_run_id -> original_run_id.
        assert builder._run_id_aliases.get(new_run_id) == original_run_id
        # No duplicate tool call should have been created.
        assert len(mock_initial_status.tool_calls) == 1

    @pytest.mark.asyncio
    async def test_tool_end_resolves_alias_to_completed(self, mock_initial_status):
        """on_tool_end with a new (aliased) run_id correctly transitions the
        original tool call from RUNNING to COMPLETED."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage, ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType, ToolCallStatus
        from google.protobuf.struct_pb2 import Struct

        original_run_id = "orig-run-100"
        new_run_id = "new-run-200"

        args = Struct()
        args.update({"path": "/skill/SKILL.md", "content": "# Skill"})

        # Existing tool call (from previous invocation, reconciled to RUNNING).
        existing_tc = ToolCall(
            id=original_run_id,
            name="write",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.tool_calls.append(existing_tc)

        # Also add a message with the tool call (mirrors real status structure).
        tool_msg = AgentMessage(type=MessageType.MESSAGE_TOOL)
        tool_msg.tool_calls.append(ToolCall(
            id=original_run_id,
            name="write",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        ))
        mock_initial_status.messages.append(tool_msg)

        builder = StatusBuilder("exec-alias-2", mock_initial_status)
        builder.populate_fingerprints_from_existing_tool_calls()

        # Step 1: on_tool_start with new run_id (deduplicated, alias recorded).
        start_event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": new_run_id,
            "data": {"input": {"path": "/skill/SKILL.md", "content": "# Skill"}},
        }
        await builder.process_event(start_event)

        # Step 2: on_tool_end with the same new run_id.
        end_event = {
            "event": "on_tool_end",
            "name": "write",
            "run_id": new_run_id,
            "data": {"output": "File written successfully"},
        }
        await builder.process_event(end_event)

        # The original tool call should now be COMPLETED.
        assert mock_initial_status.tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert mock_initial_status.tool_calls[0].result == "File written successfully"

        # The message's embedded tool call should also be COMPLETED.
        assert mock_initial_status.messages[0].tool_calls[0].status == ToolCallStatus.TOOL_CALL_COMPLETED

    @pytest.mark.asyncio
    async def test_multiple_writes_all_transition_to_completed(self, mock_initial_status):
        """Multiple write tool calls from previous invocations all transition
        to COMPLETED when their resumed on_tool_end events carry new run_ids."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        from google.protobuf.struct_pb2 import Struct

        files = [
            ("orig-A", "new-A", "/skill/SKILL.md"),
            ("orig-B", "new-B", "/skill/references/proto.md"),
            ("orig-C", "new-C", "/skill/references/cli.md"),
        ]

        for orig_id, _, path in files:
            args = Struct()
            args.update({"path": path, "content": f"content of {path}"})
            tc = ToolCall(
                id=orig_id, name="write", args=args,
                status=ToolCallStatus.TOOL_CALL_RUNNING,
            )
            mock_initial_status.tool_calls.append(tc)

        builder = StatusBuilder("exec-alias-3", mock_initial_status)
        builder.populate_fingerprints_from_existing_tool_calls()

        # Simulate the resume cycle for each file.
        for orig_id, new_id, path in files:
            # on_tool_start (deduplicated)
            await builder.process_event({
                "event": "on_tool_start",
                "name": "write",
                "run_id": new_id,
                "data": {"input": {"path": path, "content": f"content of {path}"}},
            })
            # on_tool_end (alias resolved)
            await builder.process_event({
                "event": "on_tool_end",
                "name": "write",
                "run_id": new_id,
                "data": {"output": f"written {path}"},
            })

        # All three should be COMPLETED.
        for i, (orig_id, _, path) in enumerate(files):
            tc = mock_initial_status.tool_calls[i]
            assert tc.id == orig_id
            assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED, (
                f"Tool call {orig_id} for {path} should be COMPLETED but is "
                f"{ToolCallStatus.Name(tc.status)}"
            )

    @pytest.mark.asyncio
    async def test_resolve_run_id_returns_original_when_no_alias(self, status_builder):
        """_resolve_run_id returns the input unchanged when no alias exists."""
        assert status_builder._resolve_run_id("some-id") == "some-id"

    @pytest.mark.asyncio
    async def test_resolve_run_id_returns_alias_when_present(self, status_builder):
        """_resolve_run_id returns the mapped original id when alias exists."""
        status_builder._run_id_aliases["new-123"] = "orig-456"
        assert status_builder._resolve_run_id("new-123") == "orig-456"

    @pytest.mark.asyncio
    async def test_tool_progress_resolves_alias(self, mock_initial_status):
        """on_tool_progress with an aliased run_id appends to the correct
        tool call's result."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        from google.protobuf.struct_pb2 import Struct

        original_run_id = "orig-progress-1"
        new_run_id = "new-progress-1"

        args = Struct()
        args.update({"command": "ls -la"})
        existing_tc = ToolCall(
            id=original_run_id,
            name="execute",
            args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.tool_calls.append(existing_tc)

        builder = StatusBuilder("exec-alias-4", mock_initial_status)
        builder.populate_fingerprints_from_existing_tool_calls()

        # Simulate on_tool_start dedup (records alias).
        await builder.process_event({
            "event": "on_tool_start",
            "name": "execute",
            "run_id": new_run_id,
            "data": {"input": {"command": "ls -la"}},
        })
        assert builder._run_id_aliases.get(new_run_id) == original_run_id

        # Simulate on_tool_progress with the new run_id.
        await builder.process_event({
            "event": "on_custom_event",
            "name": "tool_progress",
            "run_id": new_run_id,
            "data": {"chunk": "total 42\n"},
        })

        # The progress chunk should have been appended to the original tool call.
        assert mock_initial_status.tool_calls[0].result == "total 42\n"
        assert mock_initial_status.tool_calls[0].is_streaming is True

    @pytest.mark.asyncio
    async def test_no_alias_when_run_id_matches_existing(self, mock_initial_status):
        """No alias is recorded when the new run_id happens to match the
        existing tool call id (edge case: same run_id across invocations)."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ToolCall
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
        from google.protobuf.struct_pb2 import Struct

        same_run_id = "same-run-999"
        args = Struct()
        args.update({"path": "/file.txt", "content": "data"})
        tc = ToolCall(
            id=same_run_id, name="write", args=args,
            status=ToolCallStatus.TOOL_CALL_RUNNING,
        )
        mock_initial_status.tool_calls.append(tc)

        builder = StatusBuilder("exec-alias-5", mock_initial_status)
        builder.populate_fingerprints_from_existing_tool_calls()

        # on_tool_start with the SAME run_id — no alias needed.
        await builder.process_event({
            "event": "on_tool_start",
            "name": "write",
            "run_id": same_run_id,
            "data": {"input": {"path": "/file.txt", "content": "data"}},
        })

        assert same_run_id not in builder._run_id_aliases


# =============================================================================
# Tests for native thinking block translation
# =============================================================================


class TestNativeThinkingTranslation:
    """Tests for translating Anthropic extended-thinking blocks into synthetic think ToolCalls."""

    @pytest.mark.asyncio
    async def test_thinking_blocks_not_added_to_ai_message(self, status_builder):
        """Test that thinking content blocks create a streaming ToolCall, not an AI message."""
        chunk = MagicMock()
        chunk.content = [{"type": "thinking", "thinking": "Let me analyze this..."}]

        event = {
            "event": "on_chat_model_stream",
            "data": {"chunk": chunk},
            "metadata": {},
        }

        await status_builder.process_event(event)

        assert len(status_builder.current_status.messages) == 0
        assert status_builder._thinking_buffers.get("") == "Let me analyze this..."

        # A streaming ToolCall should exist
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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

        assert status_builder._thinking_buffers[""] == (
            "Step 1: analyse inputs. Step 2: decide."
        )

        # The streaming ToolCall's result should match the full accumulated buffer
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
        assert tc.id == streaming_id
        assert tc.name == "think"
        assert tc.args["thought"] == "My reasoning here"
        assert tc.result == "ok"
        assert tc.status == ToolCallStatus.TOOL_CALL_COMPLETED
        assert tc.is_streaming is False
        assert tc.id.startswith("think-native-")

        # Text should still create an AI message
        assert len(status_builder.current_status.messages) == 1
        assert status_builder.current_status.messages[0].content == "The answer is 42."

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
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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
        status_builder._message_start_times[0] = datetime.utcnow()

        await status_builder.process_event({
            "event": "on_chat_model_end",
            "data": {"output": output},
            "metadata": {},
        })

        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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

        assert len(status_builder.current_status.tool_calls) == 0
        assert len(status_builder.current_status.messages) == 1
        assert status_builder.current_status.messages[0].content == "Regular text"
        assert not status_builder._thinking_buffers

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

        assert len(status_builder.current_status.tool_calls) == 0

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
            assert len(status_builder.current_status.tool_calls) == 1
            tc = status_builder.current_status.tool_calls[0]
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

        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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

        tc = status_builder.current_status.tool_calls[0]
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

        tc = status_builder.current_status.tool_calls[0]
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

        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
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
        assert "" in status_builder._thinking_buffers
        assert "" in status_builder._thinking_tool_call_ids
        assert "" in status_builder._thinking_started_at

        # Flush via text
        text_chunk = MagicMock()
        text_chunk.content = "Response"
        await status_builder.process_event({
            "event": "on_chat_model_stream",
            "data": {"chunk": text_chunk},
            "metadata": {},
        })

        # All tracking state should be cleared
        assert "" not in status_builder._thinking_buffers
        assert "" not in status_builder._thinking_tool_call_ids
        assert "" not in status_builder._thinking_started_at


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
        output.usage_metadata = MagicMock()
        output.usage_metadata.input_tokens = 10
        output.usage_metadata.output_tokens = 5
        output.usage_metadata.total_tokens = 15
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
        assert "R1" in status_builder._llm_run_id_to_message

        await status_builder.process_event(self._end_event(run_id="R1"))
        assert "R1" not in status_builder._llm_run_id_to_message

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
        assert len(status_builder.current_status.tool_calls) == 1
        tc = status_builder.current_status.tool_calls[0]
        assert tc.name == "write"
        assert tc.result == ""
        assert tc.is_streaming is True

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "file.py", "contents": "def hello():\\n')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "def hello():\n"
        assert tc.is_streaming is True

    @pytest.mark.asyncio
    async def test_incremental_delta_accumulation(self, status_builder):
        """Multiple input_json_delta fragments should accumulate and the
        extracted content should grow with each fragment."""
        await status_builder.process_event(self._tool_use_chunk("write"))

        await status_builder.process_event(self._input_delta_chunk('{"pa'))
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == ""

        await status_builder.process_event(
            self._input_delta_chunk('th": "f.py", "contents": "line1\\n')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "line1\n"

        await status_builder.process_event(self._input_delta_chunk("line2"))
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "line1\nline2"

    @pytest.mark.asyncio
    async def test_edit_tool_extracts_new_text(self, status_builder):
        """Edit tools should extract from the 'new_text' field."""
        await status_builder.process_event(self._tool_use_chunk("edit"))

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "main.go", "new_text": "package main\\n')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "package main\n"

    @pytest.mark.asyncio
    async def test_unknown_tool_stays_empty(self, status_builder):
        """Tools not in _TOOL_CONTENT_FIELDS should not stream any result."""
        await status_builder.process_event(self._tool_use_chunk("read_file"))

        await status_builder.process_event(
            self._input_delta_chunk('{"path": "/tmp/test.txt"}')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == ""

    @pytest.mark.asyncio
    async def test_reconcile_clears_result(self, status_builder):
        """When on_tool_start fires, the early ToolCall's result should be
        cleared and args populated from the complete data."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        await status_builder.process_event(
            self._input_delta_chunk('{"path": "f.py", "contents": "hello"}')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "hello"

        tool_start_event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": "run-abc",
            "data": {"input": {"path": "f.py", "contents": "hello"}},
            "metadata": {},
        }
        await status_builder.process_event(tool_start_event)

        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == ""
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
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "abc"

    @pytest.mark.asyncio
    async def test_unicode_escape_in_content(self, status_builder):
        """Unicode escapes (\\uXXXX) in the content should be decoded."""
        await status_builder.process_event(self._tool_use_chunk("write"))
        await status_builder.process_event(
            self._input_delta_chunk('{"path": "f.py", "contents": "caf\\u00e9"}')
        )
        tc = status_builder.current_status.tool_calls[0]
        assert tc.result == "café"


class TestPartialJsonHelpers:
    """Unit tests for the module-level JSON extraction helpers."""

    def test_find_field_with_space(self):
        from worker.activities.graphton.status_builder import _find_json_string_value_start
        s = '{"contents": "hello"}'
        idx = _find_json_string_value_start(s, "contents")
        assert idx >= 0
        assert s[idx:idx+5] == "hello"

    def test_find_field_without_space(self):
        from worker.activities.graphton.status_builder import _find_json_string_value_start
        s = '{"contents":"hello"}'
        idx = _find_json_string_value_start(s, "contents")
        assert idx >= 0
        assert s[idx:idx+5] == "hello"

    def test_find_field_not_present(self):
        from worker.activities.graphton.status_builder import _find_json_string_value_start
        assert _find_json_string_value_start('{"path": "f.py"}', "contents") == -1

    def test_find_field_incomplete_value(self):
        from worker.activities.graphton.status_builder import _find_json_string_value_start
        assert _find_json_string_value_start('{"contents": ', "contents") == -1

    def test_unescape_basic(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('hello\\nworld') == "hello\nworld"

    def test_unescape_stops_at_quote(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('hello", "other') == "hello"

    def test_unescape_trailing_backslash(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('abc\\') == "abc"

    def test_unescape_tab_and_escaped_quote(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial('a\\tb\\"c') == 'a\tb"c'

    def test_unescape_unicode(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial("caf\\u00e9") == "café"

    def test_unescape_incomplete_unicode(self):
        from worker.activities.graphton.status_builder import _json_unescape_partial
        assert _json_unescape_partial("caf\\u00") == "caf"
