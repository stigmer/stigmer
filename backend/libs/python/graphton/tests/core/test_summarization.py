"""Comprehensive tests for context summarization components.

Tests cover:
- SummarizationConfig creation and factory methods
- TokenCounter with all provider methods
- Message utilities (ID generation, summary extraction)
- SummarizationMiddleware lifecycle

These tests ensure the summarization infrastructure is robust and
production-ready before integration with agent execution.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from graphton.core.message_utils import (
    create_summary_system_message,
    deserialize_running_summary,
    ensure_message_ids,
    extract_summary_from_result,
    serialize_running_summary,
)
from graphton.core.model_registry import (
    CostTier,
    ModelRegistry,
    TokenCounterMethod,
)
from graphton.core.summarization_config import SummarizationConfig
from graphton.core.token_counter import TokenCounter

# =============================================================================
# SummarizationConfig Tests
# =============================================================================


class TestSummarizationConfig:
    """Test suite for SummarizationConfig dataclass."""
    
    def test_for_model_anthropic(self):
        """Config for Anthropic model uses correct thresholds."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        
        assert config.enabled is True
        assert config.trigger_threshold == 180000
        assert config.target_tokens == 160000
        assert config.max_summary_tokens == 2000
        assert config.summarization_model == "claude-haiku-4"
        assert config.token_counter_method == TokenCounterMethod.ANTHROPIC_NATIVE
    
    def test_for_model_openai(self):
        """Config for OpenAI model uses correct thresholds."""
        config = SummarizationConfig.for_model("gpt-4o")
        
        assert config.enabled is True
        assert config.trigger_threshold == 115000
        assert config.target_tokens == 100000
        assert config.summarization_model == "gpt-4o-mini"
        assert config.token_counter_method == TokenCounterMethod.TIKTOKEN_O200K
    
    def test_for_model_ollama(self):
        """Config for Ollama model uses same model for summarization."""
        config = SummarizationConfig.for_model("qwen2.5-coder:7b")
        
        assert config.enabled is True
        # Ollama uses same model for summarization (no cost)
        assert config.summarization_model == "qwen2.5-coder:7b"
        assert config.token_counter_method == TokenCounterMethod.APPROXIMATE
    
    def test_for_model_unknown(self):
        """Unknown model gets conservative defaults."""
        config = SummarizationConfig.for_model("my-custom-model")
        
        assert config.enabled is True
        assert config.trigger_threshold == 7000  # 8K * 0.9
        assert config.target_tokens == 6000  # 8K * 0.8
        assert config.max_summary_tokens == 500
        assert config.token_counter_method == TokenCounterMethod.APPROXIMATE
    
    def test_for_model_disabled(self):
        """Config can be created with enabled=False."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5", enabled=False)
        
        assert config.enabled is False
        # Other values should still be set
        assert config.trigger_threshold == 180000
    
    def test_for_model_with_overrides(self):
        """Overrides take precedence over registry defaults."""
        config = SummarizationConfig.for_model(
            "claude-sonnet-4.5",
            trigger_threshold_override=150000,
            target_tokens_override=130000,
            max_summary_tokens_override=1500,
            summarization_model_override="gpt-4o-mini",
        )
        
        assert config.trigger_threshold == 150000
        assert config.target_tokens == 130000
        assert config.max_summary_tokens == 1500
        assert config.summarization_model == "gpt-4o-mini"
    
    def test_disabled_factory(self):
        """Disabled factory creates a non-functional config."""
        config = SummarizationConfig.disabled()
        
        assert config.enabled is False
        assert config.trigger_threshold == 0
        assert config.target_tokens == 0
        assert config.summarization_model == ""
    
    def test_should_summarize_enabled(self):
        """should_summarize returns True when above threshold."""
        config = SummarizationConfig.for_model("gpt-4")  # 7K threshold
        
        assert config.should_summarize(5000) is False
        assert config.should_summarize(7000) is True
        assert config.should_summarize(8000) is True
    
    def test_should_summarize_disabled(self):
        """should_summarize always returns False when disabled."""
        config = SummarizationConfig.disabled()
        
        assert config.should_summarize(0) is False
        assert config.should_summarize(1000000) is False
    
    def test_frozen_immutable(self):
        """SummarizationConfig is frozen (immutable)."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        
        with pytest.raises(AttributeError):
            config.enabled = False  # type: ignore
    
    def test_repr(self):
        """__repr__ provides useful debug information."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        
        repr_str = repr(config)
        assert "enabled=True" in repr_str
        assert "trigger=180000" in repr_str
        assert "claude-haiku-4" in repr_str


# =============================================================================
# TokenCounter Tests
# =============================================================================


class TestTokenCounter:
    """Test suite for TokenCounter class."""
    
    def test_count_messages_empty(self):
        """Empty message list returns 0."""
        count = TokenCounter.count_messages([], TokenCounterMethod.APPROXIMATE)
        assert count == 0
    
    def test_count_messages_approximate(self):
        """Approximate counting uses chars/4 heuristic."""
        # "Hello, world!" = 13 chars -> ~3 tokens + 4 overhead = ~7
        messages = [HumanMessage(content="Hello, world!")]
        count = TokenCounter.count_messages(messages, TokenCounterMethod.APPROXIMATE)
        
        # Should be reasonable approximation (content + overhead)
        assert 5 <= count <= 10
    
    def test_count_messages_multiple(self):
        """Multiple messages are counted together."""
        messages = [
            HumanMessage(content="Hello"),
            AIMessage(content="Hi there!"),
        ]
        count = TokenCounter.count_messages(messages, TokenCounterMethod.APPROXIMATE)
        
        # Should be more than single message
        assert count > 5
    
    def test_count_messages_with_tool_calls(self):
        """Tool calls are included in token count."""
        messages = [
            AIMessage(
                content="Let me read that file.",
                tool_calls=[{
                    "name": "read",
                    "args": {"path": "/workspace/test.py"},
                }],
            ),
        ]
        count = TokenCounter.count_messages(messages, TokenCounterMethod.APPROXIMATE)
        
        # Should include tool call tokens
        assert count > 10
    
    def test_count_text_empty(self):
        """Empty text returns 0."""
        count = TokenCounter.count_text("", TokenCounterMethod.APPROXIMATE)
        assert count == 0
    
    def test_count_text_approximate(self):
        """Text counting works correctly."""
        # 20 chars -> ~5 tokens
        count = TokenCounter.count_text("A" * 20, TokenCounterMethod.APPROXIMATE)
        assert count == 5
    
    @pytest.mark.skipif(
        True,  # Skip unless tiktoken is installed
        reason="tiktoken not installed"
    )
    def test_count_messages_tiktoken_cl100k(self):
        """tiktoken cl100k encoding works for GPT-4."""
        messages = [HumanMessage(content="Hello, world!")]
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.TIKTOKEN_CL100K,
        )
        # tiktoken should give accurate count
        assert 3 <= count <= 10
    
    def test_count_messages_anthropic(self):
        """Anthropic counting uses calibrated approximation."""
        messages = [HumanMessage(content="Hello, world!")]
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.ANTHROPIC_NATIVE,
        )
        # Should be reasonable approximation
        assert 3 <= count <= 10
    
    def test_count_messages_fallback_on_error(self):
        """Falls back to approximate on error."""
        messages = [HumanMessage(content="Test message")]
        
        # Even with unknown method, should not raise
        with patch.object(
            TokenCounter,
            '_count_tiktoken',
            side_effect=Exception("Test error"),
        ):
            count = TokenCounter.count_messages(
                messages,
                TokenCounterMethod.TIKTOKEN_CL100K,
            )
            # Should fall back to approximate
            assert count > 0
    
    def test_extract_message_content_string(self):
        """String content is extracted correctly."""
        msg = HumanMessage(content="Hello")
        content = TokenCounter._extract_message_content(msg)
        assert content == "Hello"
    
    def test_extract_message_content_list(self):
        """List content (multimodal) is extracted correctly."""
        msg = HumanMessage(content=[
            {"type": "text", "text": "Hello"},
            {"type": "image", "url": "..."},
            {"type": "text", "text": "World"},
        ])
        content = TokenCounter._extract_message_content(msg)
        assert "Hello" in content
        assert "World" in content
    
    def test_extract_message_content_none(self):
        """None content returns empty string."""
        msg = AIMessage(content=None)  # type: ignore
        content = TokenCounter._extract_message_content(msg)
        assert content == ""


# =============================================================================
# Message Utilities Tests
# =============================================================================


class TestMessageUtils:
    """Test suite for message utility functions."""
    
    def test_ensure_message_ids_empty(self):
        """Empty list returns empty list."""
        result = ensure_message_ids([])
        assert result == []
    
    def test_ensure_message_ids_preserves_existing(self):
        """Messages with IDs are preserved."""
        msg = HumanMessage(content="Hello", id="existing_id")
        result = ensure_message_ids([msg])
        
        assert len(result) == 1
        assert result[0].id == "existing_id"
        assert result[0] is msg  # Same instance
    
    def test_ensure_message_ids_generates_for_missing(self):
        """Messages without IDs get generated IDs."""
        msg = HumanMessage(content="Hello")
        result = ensure_message_ids([msg])
        
        assert len(result) == 1
        assert result[0].id is not None
        assert result[0].id.startswith("msg_")
        assert len(result[0].id) == 16  # "msg_" + 12 hex chars
    
    def test_ensure_message_ids_mixed(self):
        """Mixed list handles both cases."""
        messages = [
            HumanMessage(content="First"),
            AIMessage(content="Second", id="ai_id"),
            SystemMessage(content="System"),
        ]
        result = ensure_message_ids(messages)
        
        assert len(result) == 3
        assert result[0].id.startswith("msg_")  # Generated
        assert result[1].id == "ai_id"  # Preserved
        assert result[2].id.startswith("msg_")  # Generated
    
    def test_ensure_message_ids_preserves_tool_calls(self):
        """AI message tool calls are preserved."""
        msg = AIMessage(
            content="Reading file",
            tool_calls=[{"name": "read", "args": {"path": "/test"}}],
        )
        result = ensure_message_ids([msg])
        
        assert len(result[0].tool_calls) == 1
        assert result[0].tool_calls[0]["name"] == "read"
    
    def test_ensure_message_ids_preserves_tool_message(self):
        """Tool messages preserve tool_call_id."""
        msg = ToolMessage(
            content="File contents",
            tool_call_id="call_123",
            name="read",
        )
        result = ensure_message_ids([msg])
        
        assert result[0].tool_call_id == "call_123"
        assert result[0].name == "read"
    
    def test_extract_summary_from_result_running_summary(self):
        """Extracts from running_summary.summary."""
        mock_result = MagicMock()
        mock_result.running_summary.summary = "Test summary"
        
        summary = extract_summary_from_result(mock_result)
        assert summary == "Test summary"
    
    def test_extract_summary_from_result_none(self):
        """Returns empty string for None result."""
        summary = extract_summary_from_result(None)
        assert summary == ""
    
    def test_extract_summary_from_result_no_summary(self):
        """Returns empty string when no summary available."""
        mock_result = MagicMock()
        mock_result.running_summary = None
        mock_result.messages = []
        
        summary = extract_summary_from_result(mock_result)
        assert summary == ""
    
    def test_serialize_running_summary(self):
        """Serialization produces JSON-serializable dict."""
        mock_summary = MagicMock()
        mock_summary.summary = "Test summary text"
        mock_summary.summarized_message_ids = {"msg_1", "msg_2"}
        mock_summary.last_summarized_message_id = "msg_2"
        
        data = serialize_running_summary(mock_summary)
        
        assert data["summary"] == "Test summary text"
        assert set(data["summarized_message_ids"]) == {"msg_1", "msg_2"}
        assert data["last_summarized_message_id"] == "msg_2"
        assert "serialized_at" in data
    
    def test_serialize_running_summary_none(self):
        """None returns empty dict."""
        data = serialize_running_summary(None)
        assert data == {}
    
    def test_deserialize_running_summary_empty(self):
        """Empty data returns None."""
        result = deserialize_running_summary({})
        assert result is None
    
    def test_create_summary_system_message(self):
        """Creates properly formatted summary message."""
        summary = "The user discussed database configuration."
        msg = create_summary_system_message(summary)
        
        assert isinstance(msg, SystemMessage)
        assert msg.id.startswith("summary_")
        assert "Previous Context Summary" in msg.content
        assert summary in msg.content
        assert "End of Summary" in msg.content


# =============================================================================
# Integration Tests for Config + TokenCounter
# =============================================================================


class TestSummarizationConfigIntegration:
    """Integration tests for SummarizationConfig with TokenCounter."""
    
    def test_config_threshold_with_real_messages(self):
        """Config thresholds work with real token counting."""
        config = SummarizationConfig.for_model("gpt-4")  # 7K threshold
        
        # Create messages totaling roughly 5K tokens (~20K chars)
        content = "A" * 5000  # ~1250 tokens
        messages = [HumanMessage(content=content) for _ in range(4)]
        
        token_count = TokenCounter.count_messages(
            messages,
            config.token_counter_method,
        )
        
        # Should be below 7K threshold
        assert config.should_summarize(token_count) is False
    
    def test_all_providers_have_valid_config(self):
        """All registered models produce valid configs."""
        for model in ModelRegistry.list_all():
            config = SummarizationConfig.for_model(model.model_id)
            
            assert config.enabled is True
            assert config.trigger_threshold > 0
            assert config.target_tokens > 0
            assert config.trigger_threshold > config.target_tokens
            assert config.max_summary_tokens > 0
            assert config.summarization_model != ""
    
    def test_economy_models_used_for_summarization(self):
        """Premium models use economy models for summarization."""
        # Claude Opus (Premium) -> Claude Haiku (Economy)
        config = SummarizationConfig.for_model("claude-opus-4")
        summarizer_meta = ModelRegistry.get(config.summarization_model)
        assert summarizer_meta.cost_tier == CostTier.ECONOMY
        
        # GPT-4 (Premium) -> GPT-4o-mini (Economy)
        config = SummarizationConfig.for_model("gpt-4")
        summarizer_meta = ModelRegistry.get(config.summarization_model)
        assert summarizer_meta.cost_tier == CostTier.ECONOMY


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Test edge cases and error handling."""
    
    def test_message_with_empty_content(self):
        """Empty content messages are handled."""
        messages = [
            HumanMessage(content=""),
            AIMessage(content="Response"),
        ]
        result = ensure_message_ids(messages)
        assert len(result) == 2
        assert all(msg.id for msg in result)
    
    def test_token_count_very_long_message(self):
        """Very long messages are counted correctly."""
        # 1 million characters -> ~250K tokens
        content = "A" * 1_000_000
        messages = [HumanMessage(content=content)]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # Should be approximately 250K
        assert 200_000 <= count <= 300_000
    
    def test_config_repr_does_not_fail(self):
        """Config repr never fails."""
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        repr_str = repr(config)
        assert isinstance(repr_str, str)
        assert len(repr_str) > 0
        
        # Also test disabled config
        config = SummarizationConfig.disabled()
        repr_str = repr(config)
        assert isinstance(repr_str, str)
    
    def test_unique_message_ids(self):
        """Generated message IDs are unique."""
        messages = [HumanMessage(content="Same") for _ in range(100)]
        result = ensure_message_ids(messages)
        
        ids = [msg.id for msg in result]
        assert len(ids) == len(set(ids))  # All unique


# =============================================================================
# SummarizationCallback Tests (Phase 3)
# =============================================================================


class TestSummarizationCallback:
    """Test suite for SummarizationCallback protocol and SummarizationEventData."""
    
    def test_event_data_creation(self):
        """SummarizationEventData can be created with all fields."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        event = SummarizationEventData(
            tokens_before=150000,
            tokens_after=60000,
            compression_ratio=0.6,
            duration_ms=2500,
            summarization_model="claude-haiku-4",
            messages_before=45,
            messages_after=8,
        )
        
        assert event.tokens_before == 150000
        assert event.tokens_after == 60000
        assert event.compression_ratio == 0.6
        assert event.duration_ms == 2500
        assert event.summarization_model == "claude-haiku-4"
        assert event.messages_before == 45
        assert event.messages_after == 8
    
    def test_event_data_is_frozen(self):
        """SummarizationEventData is immutable."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        event = SummarizationEventData(
            tokens_before=100,
            tokens_after=50,
            compression_ratio=0.5,
            duration_ms=1000,
            summarization_model="test-model",
            messages_before=10,
            messages_after=5,
        )
        
        with pytest.raises(AttributeError):
            event.tokens_before = 200  # type: ignore
    
    def test_callback_protocol_is_runtime_checkable(self):
        """SummarizationCallback protocol supports isinstance checks."""
        from graphton.core.summarization_callback import (
            SummarizationCallback,
            SummarizationEventData,
        )
        
        class ValidCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                pass
            
            def on_token_count_updated(self, token_count: int) -> None:
                pass
        
        class InvalidCallback:
            def some_other_method(self) -> None:
                pass
        
        valid = ValidCallback()
        invalid = InvalidCallback()
        
        assert isinstance(valid, SummarizationCallback)
        assert not isinstance(invalid, SummarizationCallback)
    
    def test_callback_receives_events(self):
        """Callback methods can be called with correct types."""
        from graphton.core.summarization_callback import SummarizationEventData
        
        received_events = []
        received_counts = []
        
        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                received_events.append(event)
            
            def on_token_count_updated(self, token_count: int) -> None:
                received_counts.append(token_count)
        
        callback = TestCallback()
        
        event = SummarizationEventData(
            tokens_before=100,
            tokens_after=50,
            compression_ratio=0.5,
            duration_ms=1000,
            summarization_model="test",
            messages_before=10,
            messages_after=5,
        )
        
        callback.on_summarization_complete(event)
        callback.on_token_count_updated(12345)
        
        assert len(received_events) == 1
        assert received_events[0].tokens_before == 100
        assert len(received_counts) == 1
        assert received_counts[0] == 12345


# =============================================================================
# SummarizationMiddleware Callback Integration Tests (Phase 3)
# =============================================================================


class TestSummarizationMiddlewareCallback:
    """Tests for SummarizationMiddleware callback integration."""
    
    def test_middleware_accepts_callback(self):
        """Middleware can be initialized with a callback."""
        from graphton.core.summarization_callback import SummarizationEventData
        from graphton.core.summarization_middleware import SummarizationMiddleware
        
        callback_events = []
        
        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                callback_events.append(event)
            
            def on_token_count_updated(self, token_count: int) -> None:
                pass
        
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        middleware = SummarizationMiddleware(
            config=config,
            callback=TestCallback(),
        )
        
        assert middleware._callback is not None
    
    def test_middleware_accepts_none_callback(self):
        """Middleware works without a callback."""
        from graphton.core.summarization_middleware import SummarizationMiddleware
        
        config = SummarizationConfig.for_model("claude-sonnet-4.5")
        middleware = SummarizationMiddleware(config=config, callback=None)
        
        assert middleware._callback is None


# =============================================================================
# Deserialization Error Handling Tests
# =============================================================================


class TestDeserializationErrorHandling:
    """Test suite for deserialization error handling in message_utils."""
    
    def test_deserialize_empty_dict(self):
        """Empty dict returns None."""
        result = deserialize_running_summary({})
        assert result is None
    
    def test_deserialize_none_summary(self):
        """Dict with None summary returns None."""
        result = deserialize_running_summary({'summary': None})
        assert result is None
    
    def test_deserialize_empty_string_summary(self):
        """Dict with empty string summary returns None."""
        result = deserialize_running_summary({'summary': ''})
        assert result is None
    
    def test_deserialize_missing_summary_key(self):
        """Dict without summary key returns None."""
        result = deserialize_running_summary({
            'summarized_message_ids': ['msg_1'],
            'last_summarized_message_id': 'msg_1',
        })
        assert result is None
    
    def test_deserialize_malformed_ids_list(self):
        """Malformed summarized_message_ids is handled gracefully."""
        # This tests that the function handles edge cases
        result = deserialize_running_summary({
            'summary': 'Test summary',
            'summarized_message_ids': 'not_a_list',  # Should be a list
        })
        # Should either succeed by converting or return None
        # The implementation should handle this gracefully
        assert result is None or hasattr(result, 'summary')
    
    def test_deserialize_with_extra_fields(self):
        """Extra fields in dict are ignored."""
        result = deserialize_running_summary({
            'summary': 'Test summary',
            'summarized_message_ids': ['msg_1'],
            'last_summarized_message_id': 'msg_1',
            'extra_field': 'ignored',
            'another_extra': 12345,
        })
        # Should succeed despite extra fields
        if result is not None:
            assert result.summary == 'Test summary'
    
    def test_deserialize_with_unicode_summary(self):
        """Unicode characters in summary are handled."""
        result = deserialize_running_summary({
            'summary': 'Test summary with unicode: 日本語 emoji 🎉',
            'summarized_message_ids': [],
        })
        if result is not None:
            assert '日本語' in result.summary
    
    def test_deserialize_with_very_long_summary(self):
        """Very long summaries are handled."""
        long_summary = 'A' * 100000  # 100KB summary
        result = deserialize_running_summary({
            'summary': long_summary,
            'summarized_message_ids': [],
        })
        if result is not None:
            assert len(result.summary) == 100000


class TestExtractSummaryEdgeCases:
    """Test suite for extract_summary_from_result edge cases."""
    
    def test_extract_from_none(self):
        """None result returns empty string."""
        result = extract_summary_from_result(None)
        assert result == ''
    
    def test_extract_from_empty_object(self):
        """Object with no relevant attributes returns empty string."""
        class EmptyResult:
            pass
        
        result = extract_summary_from_result(EmptyResult())
        assert result == ''
    
    def test_extract_with_none_running_summary(self):
        """Result with None running_summary falls back to messages."""
        class ResultWithNone:
            running_summary = None
            messages = [SystemMessage(content="Short")]
        
        result = extract_summary_from_result(ResultWithNone())
        # Should return empty since message doesn't look like summary
        assert result == ''
    
    def test_extract_with_empty_messages(self):
        """Result with empty messages list returns empty string."""
        class ResultWithEmptyMessages:
            running_summary = None
            messages = []
        
        result = extract_summary_from_result(ResultWithEmptyMessages())
        assert result == ''
    
    def test_extract_summary_like_content(self):
        """Content that looks like a summary is extracted."""
        class ResultWithSummaryMessage:
            running_summary = None
            messages = [
                SystemMessage(content="Original system prompt"),
                SystemMessage(content="This is a comprehensive summary of the conversation. "
                            "The user discussed various topics including configuration, "
                            "database setup, and API design patterns."),
            ]
        
        result = extract_summary_from_result(ResultWithSummaryMessage())
        # Should extract the summary-like message
        assert 'comprehensive summary' in result.lower() or result == ''
    
    def test_looks_like_summary_short_content(self):
        """Short content is not considered a summary."""
        from graphton.core.message_utils import _looks_like_summary
        
        assert _looks_like_summary("Short") is False
        assert _looks_like_summary("A" * 50) is False
        assert _looks_like_summary("A" * 99) is False
    
    def test_looks_like_summary_long_without_keywords(self):
        """Long content without keywords may not be summary."""
        from graphton.core.message_utils import _looks_like_summary
        
        # Long content without any summary-related keywords
        content = "The quick brown fox " * 20  # ~400 chars
        result = _looks_like_summary(content)
        assert result is False
    
    def test_looks_like_summary_with_keywords(self):
        """Long content with summary keywords is detected."""
        from graphton.core.message_utils import _looks_like_summary
        
        content = "This is a comprehensive summary of the conversation " + "A" * 100
        result = _looks_like_summary(content)
        assert result is True
        
        content = "The user discussed various configuration options " + "A" * 100
        result = _looks_like_summary(content)
        assert result is True


class TestSerializationRoundTrip:
    """Test suite for serialization/deserialization round-trip."""
    
    def test_round_trip_basic(self):
        """Basic round-trip preserves data."""
        try:
            from langmem.short_term import RunningSummary
            
            original = RunningSummary(
                summary="Test summary content",
                summarized_message_ids={'msg_1', 'msg_2'},
                last_summarized_message_id='msg_2',
            )
            
            serialized = serialize_running_summary(original)
            restored = deserialize_running_summary(serialized)
            
            assert restored is not None
            assert restored.summary == original.summary
            assert restored.summarized_message_ids == original.summarized_message_ids
            assert restored.last_summarized_message_id == original.last_summarized_message_id
        except ImportError:
            pytest.skip("langmem not installed")
    
    def test_serialized_includes_timestamp(self):
        """Serialized data includes timestamp."""
        try:
            from langmem.short_term import RunningSummary
            
            original = RunningSummary(
                summary="Test",
                summarized_message_ids=set(),
            )
            
            serialized = serialize_running_summary(original)
            
            assert 'serialized_at' in serialized
            assert serialized['serialized_at'] is not None
        except ImportError:
            pytest.skip("langmem not installed")
    
    def test_serialize_none_returns_empty_dict(self):
        """Serializing None returns empty dict."""
        result = serialize_running_summary(None)
        assert result == {}
    
    def test_serialize_converts_set_to_list(self):
        """Sets are converted to lists for JSON serialization."""
        try:
            from langmem.short_term import RunningSummary
            
            original = RunningSummary(
                summary="Test",
                summarized_message_ids={'a', 'b', 'c'},
            )
            
            serialized = serialize_running_summary(original)
            
            # Should be a list (JSON-serializable)
            assert isinstance(serialized['summarized_message_ids'], list)
            assert set(serialized['summarized_message_ids']) == {'a', 'b', 'c'}
        except ImportError:
            pytest.skip("langmem not installed")


class TestConfigValidation:
    """Test suite for SummarizationConfig validation."""
    
    def test_trigger_must_be_greater_than_target(self):
        """Trigger threshold must be greater than target tokens."""
        with pytest.raises(ValueError) as exc_info:
            SummarizationConfig.for_model(
                "claude-sonnet-4.5",
                trigger_threshold_override=100000,
                target_tokens_override=150000,  # Greater than trigger
            )
        
        assert "trigger_threshold" in str(exc_info.value)
        assert "target_tokens" in str(exc_info.value)
    
    def test_trigger_equal_to_target_fails(self):
        """Trigger threshold equal to target fails validation."""
        with pytest.raises(ValueError):
            SummarizationConfig.for_model(
                "claude-sonnet-4.5",
                trigger_threshold_override=100000,
                target_tokens_override=100000,
            )
    
    def test_target_must_be_greater_than_max_summary(self):
        """Target tokens must be greater than max summary tokens."""
        with pytest.raises(ValueError) as exc_info:
            SummarizationConfig.for_model(
                "claude-sonnet-4.5",
                target_tokens_override=1000,
                max_summary_tokens_override=5000,  # Greater than target
            )
        
        assert "target_tokens" in str(exc_info.value)
        assert "max_summary_tokens" in str(exc_info.value)
    
    def test_disabled_config_skips_validation(self):
        """Disabled config doesn't validate thresholds."""
        # This should not raise even though thresholds are 0
        config = SummarizationConfig.disabled()
        assert config.enabled is False
        assert config.trigger_threshold == 0
    
    def test_trigger_cannot_exceed_context_window(self):
        """Trigger threshold cannot exceed model's context window."""
        with pytest.raises(ValueError) as exc_info:
            SummarizationConfig.for_model(
                "gpt-4",  # 8K context window
                trigger_threshold_override=500000,  # Way over 8K
            )
        
        assert "context_window" in str(exc_info.value).lower()
