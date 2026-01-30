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

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta

from worker.activities.graphton.status_builder import StatusBuilder
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    UsageMetrics,
    ResolvedExecutionContext,
)


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
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus, MessageType
        
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
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SubAgentStatus
        
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
            tool_name="read_file",  # No policy for this tool
            mcp_server_name="filesystem",
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
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            ToolCall, PendingApproval
        )
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
            ToolCallStatus, ExecutionPhase
        )
        
        # Add real PendingApproval proto (MagicMock doesn't support CopyFrom)
        mock_initial_status.pending_approval = PendingApproval()
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
    
    def test_set_tool_waiting_approval_populates_pending_approval(self, status_builder_with_approval):
        """Test that pending_approval is populated correctly."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={"repo": "my-repo"},
            approval_message="Delete repo: my-repo",
        )
        
        pending = status_builder_with_approval.current_status.pending_approval
        assert pending.tool_call_id == "tool-run-123"
        assert pending.tool_name == "delete_repository"
        assert pending.message == "Delete repo: my-repo"
        assert pending.from_sub_agent is False
    
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
        pending = status_builder_with_approval.current_status.pending_approval
        
        # Both should have timestamps set
        assert tool_call.approval_requested_at != ""
        assert pending.requested_at != ""
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
        
        pending = status_builder_with_approval.current_status.pending_approval
        assert pending.from_sub_agent is True
        assert pending.sub_agent_name == "code-reviewer"
    
    def test_set_tool_waiting_approval_args_preview(self, status_builder_with_approval):
        """Test that args preview is generated correctly."""
        status_builder_with_approval.set_tool_waiting_approval(
            run_id="tool-run-123",
            tool_name="delete_repository",
            tool_args={"repo": "my-repo", "force": True},
            approval_message="Delete repo",
        )
        
        pending = status_builder_with_approval.current_status.pending_approval
        assert "my-repo" in pending.args_preview
        assert "force" in pending.args_preview


# =============================================================================
# Tests for Tool Approval Decision (HITL Phase 2)
# =============================================================================


class TestToolApprovalDecision:
    """Tests for set_tool_approval_decision method."""
    
    @pytest.fixture
    def status_builder_waiting_approval(self, mock_initial_status):
        """Create StatusBuilder with a tool in WAITING_APPROVAL state."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
            ToolCall, PendingApproval
        )
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
            ToolCallStatus, ExecutionPhase
        )
        
        # Set up real protos
        mock_initial_status.pending_approval = PendingApproval()
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
        
        # Set up pending state
        builder._pending_tool_approval = "tool-run-456"
        builder._saved_phase_before_approval = ExecutionPhase.EXECUTION_IN_PROGRESS
        builder.current_status.pending_approval.CopyFrom(PendingApproval(
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
        assert status_builder_waiting_approval._pending_tool_approval is None
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
    
    def test_decision_clears_pending_approval_proto(self, status_builder_waiting_approval):
        """Test that decision clears the pending_approval proto field."""
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import ApprovalAction
        
        # Verify pending_approval is set before
        assert status_builder_waiting_approval.current_status.pending_approval.tool_call_id == "tool-run-456"
        
        status_builder_waiting_approval.set_tool_approval_decision(
            run_id="tool-run-456",
            action=ApprovalAction.APPROVAL_ACTION_APPROVE,
            approved_by="user-123",
        )
        
        # pending_approval should be cleared
        assert status_builder_waiting_approval.current_status.pending_approval.tool_call_id == ""


# =============================================================================
# Tests for Tool Start Approval Integration (HITL Phase 2)
# =============================================================================


class TestToolStartApprovalIntegration:
    """Tests for approval check integration in _handle_tool_start_event."""
    
    @pytest.fixture
    def status_builder_with_approval_config(self, mock_initial_status):
        """Create StatusBuilder with approval config."""
        from worker.activities.graphton.approval_policy import ApprovalConfig
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import PendingApproval
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
        
        # Set up real protos
        mock_initial_status.pending_approval = PendingApproval()
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
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus, ExecutionPhase
        
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
        
        # Pending approval should be populated
        pending = status_builder_with_approval_config.current_status.pending_approval
        assert pending.tool_call_id == "tool-run-approval-001"
        assert pending.tool_name == "delete_repository"
    
    @pytest.mark.asyncio
    async def test_tool_start_proceeds_to_running_when_no_approval_required(self, status_builder_with_approval_config):
        """Test that tool not requiring approval gets RUNNING status."""
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus, ExecutionPhase
        
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
        from worker.activities.graphton.approval_policy import ApprovalConfig
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import PendingApproval
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus, ExecutionPhase
        
        mock_initial_status.pending_approval = PendingApproval()
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
        
        pending = status_builder_with_approval_config.current_status.pending_approval
        assert "production-db" in pending.message
