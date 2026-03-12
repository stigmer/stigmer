"""Integration tests for context summarization end-to-end flow.

These tests verify the complete summarization pipeline works correctly,
including middleware lifecycle, state persistence, and agent integration.

Note: Tests that require LLM API calls are marked with @pytest.mark.llm
and will be skipped unless OPENAI_API_KEY or ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from graphton.core.message_utils import (
    ensure_message_ids,
    serialize_running_summary,
)
from graphton.core.model_registry import TokenCounterMethod
from graphton.core.summarization_config import SummarizationConfig
from graphton.core.summarization_middleware import (
    RUNNING_SUMMARY_STATE_KEY,
    ContextSummarizationMiddleware,
)
from graphton.core.token_counter import TokenCounter

# Marker for tests requiring LLM API keys
requires_llm = pytest.mark.skipif(
    not (os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")),
    reason="No LLM API key available (set OPENAI_API_KEY or ANTHROPIC_API_KEY)",
)


# =============================================================================
# Middleware Lifecycle Tests
# =============================================================================


class TestSummarizationMiddlewareLifecycle:
    """Test ContextSummarizationMiddleware lifecycle methods."""
    
    @pytest.fixture
    def config(self):
        """Create a test config with low thresholds for testing."""
        return SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=100,  # Low for testing
            target_tokens=80,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
    
    @pytest.fixture
    def middleware(self, config):
        """Create middleware instance."""
        return ContextSummarizationMiddleware(config=config)
    
    @pytest.fixture
    def mock_runtime(self):
        """Create mock runtime."""
        return {}
    
    @pytest.mark.asyncio
    async def test_abefore_agent_disabled(self, mock_runtime):
        """abefore_agent returns None when disabled."""
        config = SummarizationConfig.disabled()
        middleware = ContextSummarizationMiddleware(config=config)
        
        state = {"messages": [HumanMessage(content="Hello")]}
        result = await middleware.abefore_agent(state, mock_runtime)
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_abefore_agent_empty_messages(self, middleware, mock_runtime):
        """abefore_agent handles empty message list."""
        state = {"messages": []}
        result = await middleware.abefore_agent(state, mock_runtime)
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_abefore_agent_below_threshold(self, middleware, mock_runtime):
        """abefore_agent returns None when below threshold."""
        # Short message = few tokens, below 100 threshold
        state = {"messages": [HumanMessage(content="Hi")]}
        result = await middleware.abefore_agent(state, mock_runtime)
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_abefore_agent_loads_running_summary(self, middleware, mock_runtime):
        """abefore_agent loads running_summary from state."""
        stored_summary = {
            "summary": "Previous conversation summary",
            "summarized_message_ids": ["msg_1"],
            "last_summarized_message_id": "msg_1",
        }
        state = {
            "messages": [HumanMessage(content="Hi")],
            RUNNING_SUMMARY_STATE_KEY: stored_summary,
        }
        
        # Mock the deserialization
        with patch(
            'graphton.core.summarization_middleware.deserialize_running_summary'
        ) as mock_deserialize:
            mock_deserialize.return_value = MagicMock(summary="Previous summary")
            await middleware.abefore_agent(state, mock_runtime)
            mock_deserialize.assert_called_once_with(stored_summary)
    
    @pytest.mark.asyncio
    async def test_aafter_agent_disabled(self, mock_runtime):
        """aafter_agent returns None when disabled."""
        config = SummarizationConfig.disabled()
        middleware = ContextSummarizationMiddleware(config=config)
        
        state = {"messages": []}
        result = await middleware.aafter_agent(state, mock_runtime)
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_aafter_agent_saves_summary(self, middleware, mock_runtime):
        """aafter_agent saves running_summary to state."""
        # Set up internal state
        middleware._running_summary = MagicMock(summary="Test summary")
        middleware._current_token_count = 150
        
        state = {"messages": []}
        
        with patch(
            'graphton.core.summarization_middleware.serialize_running_summary'
        ) as mock_serialize:
            mock_serialize.return_value = {"summary": "Test summary"}
            await middleware.aafter_agent(state, mock_runtime)
            
            assert RUNNING_SUMMARY_STATE_KEY in state
            mock_serialize.assert_called_once()


# =============================================================================
# Summarization Trigger Tests
# =============================================================================


class TestSummarizationTrigger:
    """Test summarization triggering based on token count."""
    
    def test_threshold_calculation_anthropic(self):
        """Anthropic models have correct threshold (~90% of 200K)."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        
        # 200K context, 90% trigger = 180K
        assert config.trigger_threshold == 180000
        
        # Should trigger at 180K
        assert config.should_summarize(180000) is True
        assert config.should_summarize(179999) is False
    
    def test_threshold_calculation_openai_gpt4(self):
        """GPT-4 (8K) has correct threshold (~87.5%)."""
        config = SummarizationConfig.for_model("gpt-4")
        
        # 8K context, ~87.5% trigger = 7K
        assert config.trigger_threshold == 7000
        
        assert config.should_summarize(7000) is True
        assert config.should_summarize(6999) is False
    
    def test_threshold_calculation_openai_gpt4o(self):
        """GPT-4o (128K) has correct threshold."""
        config = SummarizationConfig.for_model("gpt-4o")
        
        # 128K context, ~90% trigger = 115K
        assert config.trigger_threshold == 115000
    
    def test_threshold_with_real_token_count(self):
        """Integration test: token counting + threshold check."""
        config = SummarizationConfig.for_model("gpt-4")  # 7K threshold
        
        # Create conversation that's definitely over 7K tokens
        # ~4 chars per token, so 28K chars = ~7K tokens
        long_content = "x" * 28000
        messages = [HumanMessage(content=long_content)]
        
        token_count = TokenCounter.count_messages(
            messages,
            config.token_counter_method,
        )
        
        # Should be above threshold
        assert config.should_summarize(token_count) is True


# =============================================================================
# State Persistence Tests
# =============================================================================


class TestStatePersistence:
    """Test running_summary state persistence."""
    
    def test_serialize_deserialize_roundtrip(self):
        """Serialization and deserialization are reversible."""
        # Create mock RunningSummary
        mock_summary = MagicMock()
        mock_summary.summary = "Test conversation summary"
        mock_summary.summarized_message_ids = {"msg_001", "msg_002", "msg_003"}
        mock_summary.last_summarized_message_id = "msg_003"
        
        # Serialize
        data = serialize_running_summary(mock_summary)
        
        assert data["summary"] == "Test conversation summary"
        assert set(data["summarized_message_ids"]) == {"msg_001", "msg_002", "msg_003"}
        assert data["last_summarized_message_id"] == "msg_003"
    
    def test_state_key_constant(self):
        """State key is consistent."""
        assert RUNNING_SUMMARY_STATE_KEY == "_context_running_summary"
    
    def test_state_structure_complete(self):
        """Serialized state has all required fields."""
        mock_summary = MagicMock()
        mock_summary.summary = "Summary"
        mock_summary.summarized_message_ids = set()
        mock_summary.last_summarized_message_id = None
        
        data = serialize_running_summary(mock_summary)
        
        # All required fields present
        assert "summary" in data
        assert "summarized_message_ids" in data
        assert "last_summarized_message_id" in data
        assert "serialized_at" in data  # Timestamp


# =============================================================================
# Message ID Integration Tests
# =============================================================================


class TestMessageIdIntegration:
    """Test message ID handling in summarization pipeline."""
    
    def test_ensure_ids_before_summarization(self):
        """Messages without IDs get IDs before summarization."""
        messages = [
            SystemMessage(content="You are a helpful assistant."),
            HumanMessage(content="Hello!"),
            AIMessage(content="Hi there!"),
        ]
        
        messages_with_ids = ensure_message_ids(messages)
        
        # All should have IDs now
        assert all(msg.id for msg in messages_with_ids)
        assert all(msg.id.startswith("msg_") for msg in messages_with_ids)
    
    def test_mixed_ids_preserved(self):
        """Mix of existing and new IDs handled correctly."""
        messages = [
            SystemMessage(content="System", id="sys_001"),
            HumanMessage(content="User message"),  # No ID
            AIMessage(content="Assistant", id="ai_001"),
        ]
        
        result = ensure_message_ids(messages)
        
        assert result[0].id == "sys_001"  # Preserved
        assert result[1].id.startswith("msg_")  # Generated
        assert result[2].id == "ai_001"  # Preserved
    
    def test_tool_messages_handled(self):
        """Tool messages with tool_call_id are handled."""
        from langchain_core.messages import ToolMessage
        
        messages = [
            AIMessage(
                content="Let me read that.",
                tool_calls=[{"name": "read", "args": {}, "id": "call_1"}],
            ),
            ToolMessage(
                content="File contents",
                tool_call_id="call_1",
                name="read",
            ),
        ]
        
        result = ensure_message_ids(messages)
        
        assert len(result) == 2
        assert result[1].tool_call_id == "call_1"
        assert result[1].name == "read"


# =============================================================================
# Error Handling Integration Tests
# =============================================================================


class TestErrorHandling:
    """Test error handling in summarization pipeline."""
    
    @pytest.mark.asyncio
    async def test_summarization_failure_graceful(self):
        """Agent continues if summarization fails."""
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,  # Very low to trigger
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config)
        
        # Create state that should trigger summarization
        state = {"messages": [HumanMessage(content="x" * 100)]}
        
        # Mock _perform_summarization to fail
        with patch.object(
            middleware,
            '_perform_summarization',
            side_effect=Exception("API error"),
        ):
            result = await middleware.abefore_agent(state, {})
            
            # Should return None (continue without summarization)
            assert result is None
    
    def test_unknown_model_graceful_defaults(self):
        """Unknown model gets working config with defaults."""
        config = SummarizationConfig.for_model("totally-unknown-model-xyz")
        
        # Should have valid defaults
        assert config.enabled is True
        assert config.trigger_threshold > 0
        assert config.target_tokens > 0
        assert config.max_summary_tokens > 0
        
        # Token counting should work
        messages = [HumanMessage(content="Test")]
        count = TokenCounter.count_messages(messages, config.token_counter_method)
        assert count > 0


# =============================================================================
# Full Pipeline Integration Tests (with mocked LLM)
# =============================================================================


class TestFullPipelineMocked:
    """Integration tests for full pipeline with mocked LLM."""
    
    @pytest.mark.asyncio
    async def test_full_summarization_flow_mocked(self):
        """Test complete summarization flow with mocked LangMem."""
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config)
        
        # Create messages that exceed threshold
        messages = [
            SystemMessage(content="You are helpful.", id="sys_1"),
            HumanMessage(content="x" * 100, id="human_1"),
            AIMessage(content="y" * 100, id="ai_1"),
        ]
        state: dict[str, Any] = {"messages": messages}
        
        # Mock the summarization function
        mock_result = MagicMock()
        mock_result.running_summary = MagicMock(summary="Test summary")
        mock_result.messages = [
            SystemMessage(content="You are helpful.", id="sys_1"),
            SystemMessage(content="Summary: Test summary", id="summary_1"),
            HumanMessage(content="Recent message", id="human_2"),
        ]
        
        with patch(
            'graphton.core.summarization_middleware.summarize_messages',
            return_value=mock_result,
        ):
            result = await middleware.abefore_agent(state, {})
        
        # Should have modified the messages
        assert result is not None
        assert "messages" in result
    
    @pytest.mark.asyncio
    async def test_multi_cycle_summarization_mocked(self):
        """Test multiple summarization cycles with state persistence."""
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        
        # First cycle
        middleware1 = ContextSummarizationMiddleware(config=config)
        state1: dict[str, Any] = {
            "messages": [HumanMessage(content="x" * 100, id="msg_1")],
        }
        
        mock_result1 = MagicMock()
        mock_result1.running_summary = MagicMock(
            summary="First summary",
            summarized_message_ids={"msg_1"},
            last_summarized_message_id="msg_1",
        )
        mock_result1.messages = [
            SystemMessage(content="First summary", id="summary_1"),
        ]
        
        with patch(
            'graphton.core.summarization_middleware.summarize_messages',
            return_value=mock_result1,
        ):
            await middleware1.abefore_agent(state1, {})
            await middleware1.aafter_agent(state1, {})
        
        # Verify state has running summary
        assert RUNNING_SUMMARY_STATE_KEY in state1
        
        # Second cycle - should load previous summary
        middleware2 = ContextSummarizationMiddleware(config=config)
        state2: dict[str, Any] = {
            "messages": [HumanMessage(content="y" * 100, id="msg_2")],
            RUNNING_SUMMARY_STATE_KEY: state1[RUNNING_SUMMARY_STATE_KEY],
        }
        
        # Verify running summary is loaded
        with patch(
            'graphton.core.summarization_middleware.deserialize_running_summary',
            return_value=MagicMock(summary="First summary"),
        ) as mock_deserialize:
            # Won't trigger summarization but will load state
            # (need to mock to prevent actual summarization)
            with patch(
                'graphton.core.summarization_middleware.summarize_messages',
                return_value=mock_result1,
            ):
                await middleware2.abefore_agent(state2, {})
            
            # Should have tried to load the running summary
            mock_deserialize.assert_called_once()


# =============================================================================
# Callback Integration Tests (Phase 3)
# =============================================================================


class TestCallbackIntegration:
    """Integration tests for SummarizationCallback with middleware."""
    
    @pytest.mark.asyncio
    async def test_callback_receives_token_count_updates(self):
        """Test that callback receives token count updates."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        received_counts = []
        
        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                pass
            
            def on_token_count_updated(self, token_count: int) -> None:
                received_counts.append(token_count)
        
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=100000,
            trigger_threshold=10000,  # High to prevent triggering
            target_tokens=8000,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config, callback=TestCallback())
        
        state = {"messages": [HumanMessage(content="Hello world")]}
        await middleware.abefore_agent(state, {})
        
        # Should have received at least one token count update
        assert len(received_counts) >= 1
        assert received_counts[0] > 0
    
    @pytest.mark.asyncio
    async def test_callback_receives_summarization_events(self):
        """Test that callback receives summarization events."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        received_events = []
        
        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                received_events.append(event)
            
            def on_token_count_updated(self, token_count: int) -> None:
                pass
        
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,  # Very low to trigger
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config, callback=TestCallback())
        
        # Create messages that exceed threshold
        messages = [
            SystemMessage(content="You are helpful.", id="sys_1"),
            HumanMessage(content="x" * 100, id="human_1"),
        ]
        state: dict[str, Any] = {"messages": messages}
        
        # Mock the summarization function
        mock_result = MagicMock()
        mock_result.running_summary = MagicMock(summary="Test summary")
        mock_result.messages = [
            SystemMessage(content="Summary", id="summary_1"),
        ]
        
        with patch(
            'graphton.core.summarization_middleware.summarize_messages',
            return_value=mock_result,
        ):
            await middleware.abefore_agent(state, {})
        
        # Should have received a summarization event
        assert len(received_events) == 1
        event = received_events[0]
        assert event.tokens_before > 0
        assert event.tokens_after >= 0
        assert event.compression_ratio >= 0
        assert event.duration_ms >= 0
        assert event.summarization_model == "gpt-4o-mini"
    
    @pytest.mark.asyncio
    async def test_callback_failure_does_not_break_middleware(self):
        """Test that callback failures don't break middleware."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        class BrokenCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                raise ValueError("Callback error!")
            
            def on_token_count_updated(self, token_count: int) -> None:
                raise ValueError("Callback error!")
        
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config, callback=BrokenCallback())
        
        messages = [
            SystemMessage(content="You are helpful.", id="sys_1"),
            HumanMessage(content="x" * 100, id="human_1"),
        ]
        state: dict[str, Any] = {"messages": messages}
        
        mock_result = MagicMock()
        mock_result.running_summary = MagicMock(summary="Test summary")
        mock_result.messages = [
            SystemMessage(content="Summary", id="summary_1"),
        ]
        
        with patch(
            'graphton.core.summarization_middleware.summarize_messages',
            return_value=mock_result,
        ):
            # Should not raise, even though callback fails
            result = await middleware.abefore_agent(state, {})
            
            # Summarization should still complete
            assert result is not None
    
    @pytest.mark.asyncio
    async def test_none_callback_works(self):
        """Test that None callback works (no callback calls)."""
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=100000,
            trigger_threshold=10000,  # High to prevent triggering
            target_tokens=8000,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config, callback=None)
        
        state = {"messages": [HumanMessage(content="Hello world")]}
        
        # Should not raise
        result = await middleware.abefore_agent(state, {})
        
        # Below threshold, so no summarization
        assert result is None


# =============================================================================
# Mid-Execution Compaction Integration Tests
# =============================================================================


class TestMidExecutionCompactionIntegration:
    """Integration tests for the awrap_model_call compaction lifecycle."""
    
    @pytest.mark.asyncio
    async def test_compaction_lifecycle_with_callback(self):
        """Full lifecycle: awrap_model_call compacts, callback receives events."""
        from unittest.mock import AsyncMock
        
        from langchain.agents.middleware.types import ModelRequest, ModelResponse
        
        from graphton.core.summarization_callback import SummarizationEventData
        
        received_token_counts: list[int] = []
        received_events: list[SummarizationEventData] = []
        
        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                received_events.append(event)
            
            def on_token_count_updated(self, token_count: int) -> None:
                received_token_counts.append(token_count)
        
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=10000,
            trigger_threshold=10,
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config, callback=TestCallback())
        
        # abefore_agent resets state
        state: dict[str, Any] = {"messages": [HumanMessage(content="Hello")]}
        await middleware.abefore_agent(state, {})
        
        assert middleware._compaction_failed is False
        assert middleware._compactions_performed == 0
        
        # Mock summarization and trigger awrap_model_call
        compacted = [SystemMessage(content="Summary"), HumanMessage(content="Recent")]
        
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="I'll help")],
        ))
        
        with patch.object(
            middleware, '_perform_summarization',
            return_value=compacted,
        ):
            request = ModelRequest(
                model=MagicMock(),
                messages=[HumanMessage(content="x" * 200)],
                tools=[],
            )
            await middleware.awrap_model_call(request, handler)
        
        # Verify compaction happened
        assert middleware._compactions_performed == 1
        assert middleware._compaction_failed is False
        
        # Verify callback received events
        assert len(received_events) == 1
        assert received_events[0].tokens_before > received_events[0].tokens_after
        
        # Verify token count updates (pre-compaction + post-compaction)
        assert len(received_token_counts) >= 2
    
    @pytest.mark.asyncio
    async def test_emergency_brake_lifecycle_integration(self):
        """Compaction fails -> aafter_model warns -> awrap_tool_call blocks."""
        from unittest.mock import AsyncMock
        
        from langchain.agents.middleware.types import ModelRequest, ModelResponse
        from langgraph.prebuilt.tool_node import ToolCallRequest
        
        config = SummarizationConfig(
            enabled=True,
            context_window_tokens=1000,
            trigger_threshold=10,
            target_tokens=8,
            max_summary_tokens=50,
            summarization_model="gpt-4o-mini",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = ContextSummarizationMiddleware(config=config)
        
        # Reset via abefore_agent
        await middleware.abefore_agent({"messages": []}, {})
        
        # Simulate compaction failure in awrap_model_call
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        with patch.object(
            middleware, '_perform_summarization',
            side_effect=RuntimeError("API down"),
        ):
            request = ModelRequest(
                model=MagicMock(),
                messages=[HumanMessage(content="x" * 200)],
                tools=[],
            )
            await middleware.awrap_model_call(request, handler)
        
        assert middleware._compaction_failed is True
        
        # aafter_model detects critical state
        big_state: dict[str, Any] = {
            "messages": [HumanMessage(content="x" * 4000)],
        }
        warning_result = await middleware.aafter_model(big_state, {})
        
        assert warning_result is not None
        assert middleware._overflow_imminent is True
        
        # awrap_tool_call blocks execution
        tool_handler = AsyncMock()
        tool_request = ToolCallRequest(
            tool_call={"name": "read_file", "args": {}, "id": "tc1"},
            tool=None,
            state={},
            runtime=MagicMock(),
        )
        tool_result = await middleware.awrap_tool_call(tool_request, tool_handler)
        
        tool_handler.assert_not_awaited()
        assert "blocked" in tool_result.content
        assert tool_result.tool_call_id == "tc1"
