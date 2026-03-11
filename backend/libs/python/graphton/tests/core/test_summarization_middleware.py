"""Comprehensive tests for ContextSummarizationMiddleware.

This test module provides thorough coverage for the ContextSummarizationMiddleware class,
including:
- Model creation with various providers
- Import error handling for LangChain provider packages
- Provider detection using ModelRegistry
- Message selection logic and boundary conditions
- Callback error handling

These tests ensure robust error handling and correct behavior across all scenarios.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from graphton.core.model_registry import TokenCounterMethod
from graphton.core.summarization_config import SummarizationConfig
from graphton.core.summarization_middleware import ContextSummarizationMiddleware

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
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        with patch('graphton.core.summarization_middleware.ContextSummarizationMiddleware._create_anthropic_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("claude-haiku-4")
            assert model == mock_model

    def test_create_openai_model_success(self, openai_config):
        """Successfully creates OpenAI model when langchain-openai installed."""
        middleware = ContextSummarizationMiddleware(config=openai_config)
        
        with patch('graphton.core.summarization_middleware.ContextSummarizationMiddleware._create_openai_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("gpt-4o-mini")
            assert model == mock_model

    def test_create_ollama_model_success(self, ollama_config):
        """Successfully creates Ollama model when langchain-ollama installed."""
        middleware = ContextSummarizationMiddleware(config=ollama_config)
        
        with patch('graphton.core.summarization_middleware.ContextSummarizationMiddleware._create_ollama_model') as mock:
            mock_model = MagicMock()
            mock.return_value = mock_model
            
            model = middleware._create_summarization_model()
            
            mock.assert_called_once_with("qwen2.5-coder:7b")
            assert model == mock_model


class TestModelCreationImportErrors:
    """Test suite for model creation import error handling."""

    def test_anthropic_import_error(self, anthropic_config):
        """Raises ImportError when langchain-anthropic not installed."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        with patch.dict('sys.modules', {'langchain_anthropic': None}):
            with pytest.raises(ImportError) as exc_info:
                middleware._create_anthropic_model("claude-haiku-4")
            
            assert "langchain-anthropic" in str(exc_info.value)
            assert "pip install" in str(exc_info.value)

    def test_openai_import_error(self, openai_config):
        """Raises ImportError when langchain-openai not installed."""
        middleware = ContextSummarizationMiddleware(config=openai_config)
        
        with patch.dict('sys.modules', {'langchain_openai': None}):
            with pytest.raises(ImportError) as exc_info:
                middleware._create_openai_model("gpt-4o-mini")
            
            assert "langchain-openai" in str(exc_info.value)
            assert "pip install" in str(exc_info.value)

    def test_ollama_import_error(self, ollama_config):
        """Raises ImportError when langchain-ollama not installed."""
        middleware = ContextSummarizationMiddleware(config=ollama_config)
        
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
        middleware = ContextSummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_anthropic_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once()

    def test_provider_detection_openai(self):
        """OpenAI models are correctly detected via ModelRegistry."""
        config = SummarizationConfig.for_model("gpt-4")
        middleware = ContextSummarizationMiddleware(config=config)
        
        with patch.object(middleware, '_create_openai_model') as mock:
            mock.return_value = MagicMock()
            middleware._create_summarization_model()
            mock.assert_called_once()

    def test_provider_detection_ollama(self):
        """Ollama models are correctly detected via ModelRegistry."""
        config = SummarizationConfig.for_model("mistral:7b")
        middleware = ContextSummarizationMiddleware(config=config)
        
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
        middleware = ContextSummarizationMiddleware(config=config)
        
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
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        result = middleware._select_recent_messages([])
        
        assert result == []

    def test_single_message(self, anthropic_config):
        """Single message is always kept."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        messages = [HumanMessage(content="Hello!")]
        
        result = middleware._select_recent_messages(messages)
        
        assert len(result) == 1
        assert result[0].content == "Hello!"

    def test_preserves_message_order(self, anthropic_config):
        """Messages are kept in original order."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
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
        middleware = ContextSummarizationMiddleware(config=config)
        
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
        middleware = ContextSummarizationMiddleware(config=config)
        
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
        middleware = ContextSummarizationMiddleware(config=config)
        
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
        
        middleware = ContextSummarizationMiddleware(
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
        middleware = ContextSummarizationMiddleware(
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
        middleware = ContextSummarizationMiddleware(config=disabled_config)
        
        state = {"messages": [HumanMessage(content="Test" * 100)]}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_disabled_aafter_agent_returns_none(self, disabled_config):
        """Disabled config aafter_agent returns None."""
        middleware = ContextSummarizationMiddleware(config=disabled_config)
        
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
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        state = {"messages": []}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_no_messages_key_skips(self, anthropic_config):
        """Missing messages key skips summarization check."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        state = {}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_below_threshold_no_summarization(self, anthropic_config):
        """Messages below threshold don't trigger summarization."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        # Small message, well below 180K threshold
        state = {"messages": [HumanMessage(content="Hello!")]}
        runtime = {}
        
        result = await middleware.abefore_agent(state, runtime)
        
        assert result is None

    @pytest.mark.asyncio
    async def test_aafter_step_returns_none(self, anthropic_config):
        """aafter_step is reserved and returns None."""
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
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
        middleware = ContextSummarizationMiddleware(config=anthropic_config)
        
        assert middleware.config == anthropic_config
        assert middleware._callback is None
        assert middleware._running_summary is None
        assert middleware._summarization_count == 0

    def test_init_with_callback(self, anthropic_config, mock_callback):
        """Middleware initializes correctly with callback."""
        middleware = ContextSummarizationMiddleware(
            config=anthropic_config,
            callback=mock_callback,
        )
        
        assert middleware._callback == mock_callback

    def test_init_disabled_config(self, disabled_config):
        """Middleware initializes with disabled config."""
        middleware = ContextSummarizationMiddleware(config=disabled_config)
        
        assert middleware.config.enabled is False


# =============================================================================
# Sub-Agent Propagation Tests
# =============================================================================


class TestSubAgentSummarizationPropagation:
    """Test that create_deep_agent() propagates summarization middleware to sub-agents."""

    @pytest.fixture
    def summarization_config(self):
        return SummarizationConfig.for_model("claude-sonnet-4.5")

    @pytest.fixture
    def subagents(self):
        return [
            {
                "name": "researcher",
                "description": "Research sub-agent",
                "system_prompt": "You research things.",
                "tools": [],
            },
            {
                "name": "writer",
                "description": "Writer sub-agent",
                "system_prompt": "You write things.",
                "tools": [],
            },
        ]

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent_with_proxy")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_path_injects_summarization_middleware(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
        summarization_config,
        subagents,
    ):
        """HITL path: each sub-agent receives ContextSummarizationMiddleware."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_compile_proxy.return_value = {
            "name": "test",
            "description": "test",
            "runnable": MagicMock(),
        }
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
            summarization_config=summarization_config,
        )

        assert mock_compile_proxy.call_count == 2

        for call in mock_compile_proxy.call_args_list:
            mw_list = call.kwargs.get("middleware") or call[1].get("middleware", [])
            summarization_mws = [
                m for m in mw_list
                if isinstance(m, ContextSummarizationMiddleware)
            ]
            assert len(summarization_mws) == 1
            assert summarization_mws[0].config == summarization_config
            assert summarization_mws[0]._callback is None

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent_with_proxy")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_path_distinct_middleware_instances(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
        summarization_config,
        subagents,
    ):
        """HITL path: each sub-agent gets its own middleware instance (not shared)."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_compile_proxy.return_value = {
            "name": "test",
            "description": "test",
            "runnable": MagicMock(),
        }
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
            summarization_config=summarization_config,
        )

        instances = []
        for call in mock_compile_proxy.call_args_list:
            mw_list = call.kwargs.get("middleware") or call[1].get("middleware", [])
            for m in mw_list:
                if isinstance(m, ContextSummarizationMiddleware):
                    instances.append(m)

        assert len(instances) == 2
        assert instances[0] is not instances[1]

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent_with_proxy")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_path_skips_precompiled_subagents(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
        summarization_config,
    ):
        """HITL path: pre-compiled sub-agents (with 'runnable' key) are not modified."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        precompiled = {
            "name": "pre",
            "description": "pre",
            "system_prompt": "Pre-compiled prompt",
            "runnable": MagicMock(),
        }
        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=[precompiled],
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
            summarization_config=summarization_config,
        )

        mock_compile_proxy.assert_not_called()

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent_with_proxy")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_path_no_injection_when_disabled(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
        subagents,
    ):
        """HITL path: disabled summarization config does not inject middleware."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_compile_proxy.return_value = {
            "name": "test",
            "description": "test",
            "runnable": MagicMock(),
        }
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
            summarization_config=SummarizationConfig.disabled(),
        )

        for call in mock_compile_proxy.call_args_list:
            mw_list = call.kwargs.get("middleware") or call[1].get("middleware", [])
            summarization_mws = [
                m for m in mw_list
                if isinstance(m, ContextSummarizationMiddleware)
            ]
            assert len(summarization_mws) == 0

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_non_hitl_path_injects_summarization_middleware(
        self,
        mock_parse_model,
        mock_deepagents_create,
        summarization_config,
        subagents,
    ):
        """Non-HITL path: sub-agent dicts get middleware key with summarization."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=None,
            approval_checker=None,
            summarization_config=summarization_config,
        )

        call_kwargs = mock_deepagents_create.call_args
        passed_subagents = call_kwargs.kwargs.get("subagents") or call_kwargs[1].get("subagents", [])

        assert len(passed_subagents) == 2
        for sa in passed_subagents:
            mw_list = sa.get("middleware", [])
            summarization_mws = [
                m for m in mw_list
                if isinstance(m, ContextSummarizationMiddleware)
            ]
            assert len(summarization_mws) == 1
            assert summarization_mws[0].config == summarization_config
            assert summarization_mws[0]._callback is None

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_non_hitl_path_does_not_mutate_original(
        self,
        mock_parse_model,
        mock_deepagents_create,
        summarization_config,
        subagents,
    ):
        """Non-HITL path: original subagent dicts are not mutated."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=None,
            approval_checker=None,
            summarization_config=summarization_config,
        )

        for sa in subagents:
            assert "middleware" not in sa

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_non_hitl_path_skips_precompiled(
        self,
        mock_parse_model,
        mock_deepagents_create,
        summarization_config,
    ):
        """Non-HITL path: pre-compiled sub-agents are passed through unchanged."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        precompiled = {
            "name": "pre",
            "description": "pre",
            "system_prompt": "Pre-compiled prompt",
            "runnable": MagicMock(),
        }
        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=[precompiled],
            checkpointer=None,
            approval_checker=None,
            summarization_config=summarization_config,
        )

        call_kwargs = mock_deepagents_create.call_args
        passed_subagents = call_kwargs.kwargs.get("subagents") or call_kwargs[1].get("subagents", [])

        assert len(passed_subagents) == 1
        assert "runnable" in passed_subagents[0]
        assert "middleware" not in passed_subagents[0]

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_non_hitl_path_no_injection_when_disabled(
        self,
        mock_parse_model,
        mock_deepagents_create,
        subagents,
    ):
        """Non-HITL path: disabled config passes subagents unchanged."""
        from graphton.core.agent import create_deep_agent

        mock_model = MagicMock()
        mock_parse_model.return_value = mock_model
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4.5",
            system_prompt="Test prompt",
            subagents=subagents,
            checkpointer=None,
            approval_checker=None,
            summarization_config=SummarizationConfig.disabled(),
        )

        call_kwargs = mock_deepagents_create.call_args
        passed_subagents = call_kwargs.kwargs.get("subagents") or call_kwargs[1].get("subagents", [])

        for sa in passed_subagents:
            assert "middleware" not in sa
