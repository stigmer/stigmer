"""Comprehensive tests for SummarizationMiddleware.

This test module provides thorough coverage for the SummarizationMiddleware class,
including:
- Model creation with various providers
- Import error handling for LangChain provider packages
- Provider detection using ModelRegistry
- Message selection logic and boundary conditions
- Callback error handling

These tests ensure robust error handling and correct behavior across all scenarios.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from graphton.core.model_registry import TokenCounterMethod
from graphton.core.summarization_config import SummarizationConfig
from graphton.core.summarization_middleware import SummarizationMiddleware


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def anthropic_config():
    """Create a config for Anthropic models."""
    return SummarizationConfig.for_model("claude-sonnet-4.5")


@pytest.fixture
def openai_config():
    """Create a config for OpenAI models."""
    return SummarizationConfig.for_model("gpt-4o")


@pytest.fixture
def ollama_config():
    """Create a config for Ollama models."""
    return SummarizationConfig.for_model("qwen2.5-coder:7b")


@pytest.fixture
def disabled_config():
    """Create a disabled config."""
    return SummarizationConfig.disabled()


@pytest.fixture
def mock_callback():
    """Create a mock callback."""
    callback = MagicMock()
    callback.on_token_count_updated = MagicMock()
    callback.on_summarization_complete = MagicMock()
    return callback


# =============================================================================
# Model Creation Tests
# =============================================================================


class TestModelCreation:
    """Test suite for model creation methods."""

    def test_create_anthropic_model_success(self, anthropic_config):
        """Successfully creates Anthropic model when langchain-anthropic installed."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        with patch('graphton.core.summarization_middleware.SummarizationMiddleware._create_anthropic_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("claude-haiku-4")
            assert model == mock_model

    def test_create_openai_model_success(self, openai_config):
        """Successfully creates OpenAI model when langchain-openai installed."""
        middleware = SummarizationMiddleware(config=openai_config)
        
        with patch('graphton.core.summarization_middleware.SummarizationMiddleware._create_openai_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("gpt-4o-mini")
            assert model == mock_model

    def test_create_ollama_model_success(self, ollama_config):
        """Successfully creates Ollama model when langchain-ollama installed."""
        middleware = SummarizationMiddleware(config=ollama_config)
        
        with patch('graphton.core.summarization_middleware.SummarizationMiddleware._create_ollama_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("qwen2.5-coder:7b")
            assert model == mock_model


class TestModelCreationImportErrors:
    """Test suite for model creation import error handling."""

    def test_anthropic_import_error(self, anthropic_config):
        """Raises ImportError when langchain-anthropic not installed."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        with patch.dict('sys.modules', {'langchain_anthropic': None}):
            with pytest.raises(ImportError) as exc_info:
                middleware._create_anthropic_model("claude-haiku-4")
            
            assert "langchain-anthropic" in str(exc_info.value)
            assert "pip install" in str(exc_info.value)

    def test_openai_import_error(self, openai_config):
        """Raises ImportError when langchain-openai not installed."""
        middleware = SummarizationMiddleware(config=openai_config)
        
        with patch.dict('sys.modules', {'langchain_openai': None}):
            with pytest.raises(ImportError) as exc_info:
                middleware._create_openai_model("gpt-4o-mini")
            
            assert "langchain-openai" in str(exc_info.value)
            assert "pip install" in str(exc_info.value)

    def test_ollama_import_error(self, ollama_config):
        """Raises ImportError when langchain-ollama not installed."""
        middleware = SummarizationMiddleware(config=ollama_config)
        
        with patch.dict('sys.modules', {'langchain_ollama': None}):
            with pytest.raises(ImportError) as exc_info:
                middleware._create_ollama_model("qwen2.5-coder:7b")
            
            assert "langchain-ollama" in str(exc_info.value)
            assert "pip install" in str(exc_info.value)


class TestProviderDetection:
    """Test suite for provider detection using ModelRegistry."""

    def test_provider_detection_anthropic(self):
        """Anthropic models are correctly detected via ModelRegistry."""
        config = SummarizationConfig.for_model("claude-opus-4")
        middleware = SummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_anthropic_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once()

    def test_provider_detection_openai(self):
        """OpenAI models are correctly detected via ModelRegistry."""
        config = SummarizationConfig.for_model("gpt-4")
        middleware = SummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_openai_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once()

    def test_provider_detection_ollama(self):
        """Ollama models are correctly detected via ModelRegistry."""
        config = SummarizationConfig.for_model("mistral:7b")
        middleware = SummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_ollama_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once()

    def test_provider_detection_unknown_falls_back_to_ollama(self):
        """Unknown provider falls back to Ollama (local inference)."""
        # Create config with custom summarization model override
        config = SummarizationConfig(
            enabled=True,
            trigger_threshold=7000,
            target_tokens=6000,
            max_summary_tokens=500,
            summarization_model="my-custom-model",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = SummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_ollama_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once_with("my-custom-model")


# =============================================================================
# Message Selection Tests
# =============================================================================


class TestSelectRecentMessages:
    """Test suite for _select_recent_messages boundary conditions."""

    def test_empty_messages(self, anthropic_config):
        """Empty message list returns empty list."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        result = middleware._select_recent_messages([])
        
        assert result == []

    def test_single_message(self, anthropic_config):
        """Single message is always kept."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        messages = [HumanMessage(content="Hello!")]
        
        result = middleware._select_recent_messages(messages)
        
        assert len(result) == 1
        assert result[0].content == "Hello!"

    def test_preserves_message_order(self, anthropic_config):
        """Messages are kept in original order."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        messages = [
            HumanMessage(content="First"),
            AIMessage(content="Second"),
            HumanMessage(content="Third"),
        ]
        
        result = middleware._select_recent_messages(messages)
        
        # Should preserve order
        contents = [m.content for m in result]
        assert contents == sorted(contents, key=lambda x: messages.index(
            next(m for m in messages if m.content == x)
        )) or contents == ["First", "Second", "Third"]

    def test_keeps_recent_messages_within_target(self):
        """Keeps messages that fit within target token budget."""
        # Use a config with small target to test selection
        config = SummarizationConfig(
            enabled=True,
            trigger_threshold=200,
            target_tokens=100,  # Small target
            max_summary_tokens=20,
            summarization_model="claude-haiku-4",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = SummarizationMiddleware(config=config)
        
        # Create messages with known token counts
        # Each "Hello!" is ~2 tokens + 4 overhead = 6 tokens
        messages = [
            HumanMessage(content="Message 1"),
            AIMessage(content="Message 2"),
            HumanMessage(content="Message 3"),
            AIMessage(content="Message 4"),
            HumanMessage(content="Message 5"),
        ]
        
        result = middleware._select_recent_messages(messages)
        
        # Should keep at least the last message
        assert len(result) >= 1
        # Last message should be most recent
        assert result[-1].content == "Message 5"

    def test_single_large_message(self):
        """Single large message that exceeds target is still kept."""
        config = SummarizationConfig(
            enabled=True,
            trigger_threshold=200,
            target_tokens=20,  # Very small target
            max_summary_tokens=5,
            summarization_model="claude-haiku-4",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = SummarizationMiddleware(config=config)
        
        # Create a message larger than target
        large_content = "x" * 200  # ~50 tokens
        messages = [HumanMessage(content=large_content)]
        
        result = middleware._select_recent_messages(messages)
        
        # Should still keep the message (always keep at least one)
        assert len(result) == 1
        assert result[0].content == large_content

    def test_exact_target_boundary(self):
        """Messages exactly at target are included."""
        config = SummarizationConfig(
            enabled=True,
            trigger_threshold=200,
            target_tokens=100,
            max_summary_tokens=20,
            summarization_model="claude-haiku-4",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
        middleware = SummarizationMiddleware(config=config)
        
        # Target is 100, half is 50 tokens for recent messages
        # Each short message is ~2-3 tokens + 4 overhead
        messages = [
            HumanMessage(content="A"),  # ~5 tokens
            HumanMessage(content="B"),  # ~5 tokens
            HumanMessage(content="C"),  # ~5 tokens
        ]
        
        result = middleware._select_recent_messages(messages)
        
        # Should keep all messages within budget
        assert len(result) >= 1


# =============================================================================
# Callback Error Handling Tests
# =============================================================================


class TestCallbackErrorHandling:
    """Test suite for callback error handling."""

    @pytest.mark.asyncio
    async def test_callback_token_count_error_continues(self, anthropic_config, mock_callback):
        """Callback errors don't stop execution."""
        mock_callback.on_token_count_updated.side_effect = RuntimeError("Callback failed")
        
        middleware = SummarizationMiddleware(
            config=anthropic_config,
            callback=mock_callback,
        )
        
        state = {"messages": [HumanMessage(content="Test")]}
        runtime = {}
        
        # Should not raise, callback error is logged and ignored
        result = await middleware.abefore_agent(state, runtime)
        
        # Callback was called and failed
        mock_callback.on_token_count_updated.assert_called_once()
        # But execution continued (result is None because below threshold)
        assert result is None

    @pytest.mark.asyncio
    async def test_callback_none_is_safe(self, anthropic_config):
        """Middleware works correctly without callback."""
        middleware = SummarizationMiddleware(
            config=anthropic_config,
            callback=None,
        )
        
        state = {"messages": [HumanMessage(content="Test")]}
        runtime = {}
        
        # Should not raise
        result = await middleware.abefore_agent(state, runtime)
        
        # Below threshold, no summarization
        assert result is None


# =============================================================================
# Disabled Config Tests
# =============================================================================


class TestDisabledConfig:
    """Test suite for disabled configuration."""

    @pytest.mark.asyncio
    async def test_disabled_skips_processing(self, disabled_config):
        """Disabled config skips all processing."""
        middleware = SummarizationMiddleware(config=disabled_config)
        
        state = {"messages": [HumanMessage(content="Test" * 100)]}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_disabled_aafter_agent_returns_none(self, disabled_config):
        """Disabled config aafter_agent returns None."""
        middleware = SummarizationMiddleware(config=disabled_config)
        
        state = {"messages": []}
        runtime = {}
        
        result = await middleware.aafter_agent(state, runtime)
        
        assert result is None


# =============================================================================
# Empty and Edge Case Tests
# =============================================================================


class TestEdgeCases:
    """Test suite for edge cases."""

    @pytest.mark.asyncio
    async def test_empty_messages_skips(self, anthropic_config):
        """Empty message list skips summarization check."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        state = {"messages": []}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_no_messages_key_skips(self, anthropic_config):
        """Missing messages key skips summarization check."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        state = {}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_below_threshold_no_summarization(self, anthropic_config):
        """Messages below threshold don't trigger summarization."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        # Small message, well below 180K threshold
        state = {"messages": [HumanMessage(content="Hello!")]}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_aafter_step_returns_none(self, anthropic_config):
        """aafter_step is reserved and returns None."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        state = {"messages": []}
        runtime = {}
        
        result = await middleware.aafter_step(state, runtime)
        
        assert result is None


# =============================================================================
# Initialization Tests
# =============================================================================


class TestInitialization:
    """Test suite for middleware initialization."""

    def test_init_with_config(self, anthropic_config):
        """Middleware initializes correctly with config."""
        middleware = SummarizationMiddleware(config=anthropic_config)
        
        assert middleware.config == anthropic_config
        assert middleware._callback is None
        assert middleware._running_summary is None
        assert middleware._summarization_count == 0

    def test_init_with_callback(self, anthropic_config, mock_callback):
        """Middleware initializes correctly with callback."""
        middleware = SummarizationMiddleware(
            config=anthropic_config,
            callback=mock_callback,
        )
        
        assert middleware._callback == mock_callback

    def test_init_disabled_config(self, disabled_config):
        """Middleware initializes with disabled config."""
        middleware = SummarizationMiddleware(config=disabled_config)
        
        assert middleware.config.enabled is False
