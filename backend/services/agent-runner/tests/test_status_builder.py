"""Unit tests for StatusBuilder module.

Tests cover:
- Event routing for all supported event types
- on_chat_model_stream event handling
- on_chat_model_end event handling (token usage extraction)
- Message duration tracking
- Cumulative token counting
- ToolCall status transitions (Phase 2.2): RUNNING -> COMPLETED
- Tool execution duration tracking
"""

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta

from worker.activities.graphton.status_builder import StatusBuilder
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType


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
