"""Comprehensive tests for TokenCounter with tiktoken integration.

This test module provides thorough coverage for the TokenCounter class,
including:
- Tiktoken encoding tests (cl100k_base and o200k_base)
- Encoding cache behavior
- Import error handling and fallback
- Invalid encoding names
- Edge cases and boundary conditions

These tests ensure accurate token counting across all supported providers.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from graphton.core.model_registry import TokenCounterMethod
from graphton.core.token_counter import TokenCounter, TokenCountingError

# =============================================================================
# Tiktoken CL100K Encoding Tests (GPT-4, GPT-3.5)
# =============================================================================


class TestTiktokenCL100K:
    """Test suite for TIKTOKEN_CL100K encoding (GPT-4, GPT-3.5-turbo)."""

    def test_count_messages_simple(self):
        """Count tokens for simple messages using cl100k_base."""
        messages = [
            HumanMessage(content="Hello, how are you?"),
            AIMessage(content="I'm doing well, thank you!"),
        ]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
        
        # Should return a reasonable token count (actual tiktoken counting)
        assert count > 0
        assert isinstance(count, int)
        # These simple messages should be roughly 15-25 tokens
        assert 10 < count < 50

    def test_count_messages_empty(self):
        """Empty message list returns zero tokens."""
        count = TokenCounter.count_messages([], TokenCounterMethod.TIKTOKEN_CL100K)
        assert count == 0

    def test_count_messages_with_system_prompt(self):
        """System prompts are counted correctly."""
        messages = [
            SystemMessage(content="You are a helpful assistant."),
            HumanMessage(content="Hello!"),
        ]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
        
        assert count > 0
        # System message adds significant tokens
        assert count > 5

    def test_count_messages_long_content(self):
        """Long content is counted correctly."""
        # Create a message with ~1000 characters (roughly 250 tokens)
        long_content = "This is a test message. " * 50
        messages = [HumanMessage(content=long_content)]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
        
        # Should be roughly 250-300 tokens for ~1200 characters
        assert 200 < count < 400

    def test_count_messages_with_tool_calls(self):
        """Tool calls are included in token count."""
        messages = [
            AIMessage(
                content="Let me search for that.",
                tool_calls=[
                    {
                        "id": "call_001",
                        "name": "search_web",
                        "args": {"query": "python best practices"},
                    }
                ],
            ),
        ]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
        
        # Should include both content and tool call tokens
        assert count > 10

    def test_count_messages_multimodal_content(self):
        """Multimodal content (text blocks) is handled correctly."""
        messages = [
            HumanMessage(
                content=[
                    {"type": "text", "text": "What is in this image?"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
                ]
            ),
        ]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
        
        # Should extract and count text content
        assert count > 0

    def test_count_text_simple(self):
        """Count tokens in a simple text string."""
        text = "Hello, world! This is a test."
        
        count = TokenCounter.count_text(text, TokenCounterMethod.TIKTOKEN_CL100K)
        
        assert count > 0
        # Simple sentence should be ~8-10 tokens
        assert 5 < count < 15

    def test_count_text_empty(self):
        """Empty text returns zero tokens."""
        count = TokenCounter.count_text("", TokenCounterMethod.TIKTOKEN_CL100K)
        assert count == 0


# =============================================================================
# Tiktoken O200K Encoding Tests (GPT-4o, o1)
# =============================================================================


class TestTiktokenO200K:
    """Test suite for TIKTOKEN_O200K encoding (GPT-4o, o1 family)."""

    def test_count_messages_simple(self):
        """Count tokens for simple messages using o200k_base."""
        messages = [
            HumanMessage(content="What is 2 + 2?"),
            AIMessage(content="2 + 2 equals 4."),
        ]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_O200K)
        
        assert count > 0
        assert isinstance(count, int)

    def test_count_messages_code(self):
        """Code content is tokenized correctly with o200k."""
        code = '''
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
'''
        messages = [HumanMessage(content=code)]
        
        count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_O200K)
        
        # Code should be tokenized reasonably
        assert count > 10
        assert count < 100

    def test_count_text_code(self):
        """Code is tokenized correctly as raw text."""
        code = "def hello(): return 'world'"
        
        count = TokenCounter.count_text(code, TokenCounterMethod.TIKTOKEN_O200K)
        
        assert count > 0
        assert count < 20

    def test_encoding_difference_from_cl100k(self):
        """O200K and CL100K may produce different counts for same text."""
        text = "The quick brown fox jumps over the lazy dog."
        
        cl100k_count = TokenCounter.count_text(text, TokenCounterMethod.TIKTOKEN_CL100K)
        o200k_count = TokenCounter.count_text(text, TokenCounterMethod.TIKTOKEN_O200K)
        
        # Both should return positive counts
        assert cl100k_count > 0
        assert o200k_count > 0
        # Counts may differ due to different encodings
        # (but this is implementation-dependent)


# =============================================================================
# Encoding Cache Tests
# =============================================================================


class TestEncodingCache:
    """Test suite for tiktoken encoding caching behavior."""

    def test_encoding_is_cached(self):
        """Encoding instances are cached for reuse."""
        # Clear any existing cache
        TokenCounter._get_tiktoken_encoding.cache_clear()
        
        # First call should create encoding
        enc1 = TokenCounter._get_tiktoken_encoding("cl100k_base")
        
        # Second call should return cached encoding
        enc2 = TokenCounter._get_tiktoken_encoding("cl100k_base")
        
        # Should be the same object (cached)
        assert enc1 is enc2

    def test_different_encodings_cached_separately(self):
        """Different encoding names are cached separately."""
        TokenCounter._get_tiktoken_encoding.cache_clear()
        
        enc_cl100k = TokenCounter._get_tiktoken_encoding("cl100k_base")
        enc_o200k = TokenCounter._get_tiktoken_encoding("o200k_base")
        
        # Should be different encoding objects
        assert enc_cl100k is not enc_o200k

    def test_cache_info_tracks_hits(self):
        """Cache correctly tracks hits and misses."""
        TokenCounter._get_tiktoken_encoding.cache_clear()
        
        # First call - miss
        TokenCounter._get_tiktoken_encoding("cl100k_base")
        info1 = TokenCounter._get_tiktoken_encoding.cache_info()
        assert info1.misses == 1
        assert info1.hits == 0
        
        # Second call - hit
        TokenCounter._get_tiktoken_encoding("cl100k_base")
        info2 = TokenCounter._get_tiktoken_encoding.cache_info()
        assert info2.hits == 1


# =============================================================================
# Import Error and Fallback Tests
# =============================================================================


class TestTiktokenFallback:
    """Test suite for tiktoken import error handling and fallback."""

    def test_fallback_on_tiktoken_import_error(self):
        """Falls back to approximate counting when tiktoken unavailable."""
        messages = [HumanMessage(content="Hello, world!")]
        
        with patch.dict('sys.modules', {'tiktoken': None}):
            with patch.object(
                TokenCounter,
                '_get_tiktoken_encoding',
                side_effect=ImportError("tiktoken not installed"),
            ):
                # Should not raise, should fall back to approximate
                count = TokenCounter.count_messages(
                    messages,
                    TokenCounterMethod.TIKTOKEN_CL100K,
                )
                
                # Should return approximate count (chars/4 + overhead)
                assert count > 0

    def test_fallback_preserves_reasonable_count(self):
        """Fallback produces a reasonable approximate count."""
        content = "This is a test message with about forty characters."
        messages = [HumanMessage(content=content)]
        
        with patch.object(
            TokenCounter,
            '_count_tiktoken',
            side_effect=TokenCountingError("Encoding failed"),
        ):
            count = TokenCounter.count_messages(
                messages,
                TokenCounterMethod.TIKTOKEN_CL100K,
            )
            
            # Approximate: ~50 chars / 4 = ~12 tokens + overhead
            assert 10 < count < 30


# =============================================================================
# Invalid Encoding Name Tests
# =============================================================================


class TestInvalidEncoding:
    """Test suite for handling invalid encoding names."""

    def test_invalid_encoding_name_raises(self):
        """Invalid encoding name raises appropriate error."""
        with pytest.raises(Exception):  # tiktoken raises KeyError
            TokenCounter._get_tiktoken_encoding("invalid_encoding_name")

    def test_messages_with_invalid_encoding_falls_back(self):
        """Invalid encoding falls back to approximate counting."""
        messages = [HumanMessage(content="Test message")]
        
        with patch.object(
            TokenCounter,
            '_get_tiktoken_encoding',
            side_effect=KeyError("Unknown encoding"),
        ):
            # Should fall back gracefully
            count = TokenCounter.count_messages(
                messages,
                TokenCounterMethod.TIKTOKEN_CL100K,
            )
            
            assert count > 0


# =============================================================================
# Method Validation Tests
# =============================================================================


class TestMethodValidation:
    """Test suite for token counter method validation."""

    def test_invalid_method_type_falls_back(self):
        """Invalid method type logs warning and falls back to approximate."""
        messages = [HumanMessage(content="Test")]
        
        # Pass an invalid type (not TokenCounterMethod)
        count = TokenCounter.count_messages(messages, "invalid_string")  # type: ignore
        
        # Should return approximate count, not crash
        assert count > 0

    def test_invalid_method_type_for_text_falls_back(self):
        """Invalid method type for text falls back to approximate."""
        count = TokenCounter.count_text("Hello world", 123)  # type: ignore
        
        # Should return approximate: 11 chars / 4 = 2 tokens
        assert count >= 2


# =============================================================================
# Anthropic Native Counting Tests
# =============================================================================


class TestAnthropicNative:
    """Test suite for Anthropic native token counting."""

    def test_count_messages_anthropic(self):
        """Anthropic native counting produces reasonable results."""
        messages = [
            HumanMessage(content="Hello, Claude!"),
            AIMessage(content="Hello! How can I help you today?"),
        ]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.ANTHROPIC_NATIVE,
        )
        
        assert count > 0
        # Should be reasonable for ~50 chars total
        assert 10 < count < 50

    def test_count_text_anthropic(self):
        """Anthropic text counting uses calibrated approximation."""
        text = "This is a test message for Claude."
        
        count = TokenCounter.count_text(text, TokenCounterMethod.ANTHROPIC_NATIVE)
        
        # ~35 chars / 3.8 = ~9 tokens
        assert 5 < count < 15


# =============================================================================
# Approximate Counting Tests
# =============================================================================


class TestApproximateCounting:
    """Test suite for approximate token counting (fallback method)."""

    def test_count_messages_approximate(self):
        """Approximate counting uses chars/4 heuristic."""
        messages = [HumanMessage(content="Hello world")]  # 11 chars
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # 11 chars / 4 = 2 tokens + 4 overhead = 6
        assert count == 6

    def test_count_text_approximate(self):
        """Approximate text counting uses chars/4."""
        text = "abcdefghijklmnop"  # 16 chars
        
        count = TokenCounter.count_text(text, TokenCounterMethod.APPROXIMATE)
        
        # 16 / 4 = 4 tokens
        assert count == 4

    def test_approximate_with_tool_calls(self):
        """Approximate counting includes tool call tokens."""
        messages = [
            AIMessage(
                content="Searching...",
                tool_calls=[
                    {"id": "call_001", "name": "search", "args": {"query": "test"}},
                ],
            ),
        ]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # Content: 12 chars / 4 = 3
        # Tool name: 6 chars / 4 = 1
        # Tool args: ~17 chars / 4 = 4
        # Overhead: 4
        assert count > 5


# =============================================================================
# Edge Cases
# =============================================================================


class TestEdgeCases:
    """Test suite for edge cases and boundary conditions."""

    def test_none_content_message(self):
        """Message with None content is handled gracefully."""
        from unittest.mock import MagicMock
        mock_msg = MagicMock()
        mock_msg.content = None
        mock_msg.tool_calls = []
        messages = [mock_msg]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # Should return just overhead
        assert count == 4

    def test_empty_string_content(self):
        """Message with empty string content."""
        messages = [HumanMessage(content="")]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # Should return just overhead
        assert count == 4

    def test_very_long_message(self):
        """Very long messages are counted correctly."""
        # Create 10KB of content (~2500 tokens)
        long_content = "x" * 10000
        messages = [HumanMessage(content=long_content)]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        # 10000 / 4 = 2500 + 4 overhead = 2504
        assert count == 2504

    def test_unicode_content(self):
        """Unicode characters are handled correctly."""
        messages = [HumanMessage(content="Hello 世界! 🌍")]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.TIKTOKEN_CL100K,
        )
        
        # Should handle unicode without crashing
        assert count > 0

    def test_special_characters(self):
        """Special characters don't cause issues."""
        messages = [HumanMessage(content="<script>alert('xss')</script>")]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.TIKTOKEN_CL100K,
        )
        
        assert count > 0

    def test_tool_message(self):
        """ToolMessage is counted correctly."""
        messages = [
            ToolMessage(
                content='{"result": "success"}',
                tool_call_id="call_123",
            ),
        ]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.APPROXIMATE,
        )
        
        assert count > 0

    def test_mixed_message_types(self):
        """Mixed message types are all counted."""
        messages = [
            SystemMessage(content="You are helpful."),
            HumanMessage(content="Hello!"),
            AIMessage(content="Hi there!"),
            ToolMessage(content="Done", tool_call_id="123"),
        ]
        
        count = TokenCounter.count_messages(
            messages,
            TokenCounterMethod.TIKTOKEN_CL100K,
        )
        
        # Should count all message types
        assert count > 15
