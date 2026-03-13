"""Comprehensive tests for ContextSummarizationMiddleware.

This test module provides thorough coverage for the ContextSummarizationMiddleware class,
including:
- Model creation with various providers
- Import error handling for LangChain provider packages
- Provider detection using ModelRegistry
- Message selection logic and boundary conditions
- Callback error handling
- awrap_model_call: mid-execution compaction (Layer A)
- aafter_model: emergency monitoring (Layer B)
- awrap_tool_call: emergency brake (Layer B)
- Compaction lifecycle across multiple model calls

These tests ensure robust error handling and correct behavior across all scenarios.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest

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
            context_window_tokens=8192,
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
            context_window_tokens=1000,
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
            context_window_tokens=1000,
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
            context_window_tokens=1000,
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


# =============================================================================
# Test helpers for new hook tests
# =============================================================================


def _make_state(messages: list) -> dict:
    """Build a minimal agent state dict."""
    return {"messages": messages}


def _make_model_request(messages: list | None = None) -> ModelRequest:
    """Build a ModelRequest for awrap_model_call tests."""
    return ModelRequest(
        model=MagicMock(),
        messages=messages or [],
        tools=[],
    )


def _make_tool_call_request(
    name: str = "read_file",
    args: dict | None = None,
    call_id: str = "tc1",
) -> ToolCallRequest:
    """Build a ToolCallRequest for awrap_tool_call tests."""
    tool_call = {"name": name, "args": args or {}, "id": call_id}
    return ToolCallRequest(
        tool_call=tool_call,
        tool=None,
        state={},
        runtime=MagicMock(),
    )


def _compaction_config(
    *,
    trigger_threshold: int = 200,
    target_tokens: int = 100,
    context_window_tokens: int = 1000,
) -> SummarizationConfig:
    """Config tuned for compact unit tests -- small thresholds."""
    return SummarizationConfig(
        enabled=True,
        context_window_tokens=context_window_tokens,
        trigger_threshold=trigger_threshold,
        target_tokens=target_tokens,
        max_summary_tokens=20,
        summarization_model="claude-haiku-4",
        token_counter_method=TokenCounterMethod.APPROXIMATE,
    )


# =============================================================================
# awrap_model_call -- Layer A: Mid-execution compaction
# =============================================================================


class TestAwrapModelCall:
    """Tests for the primary mid-execution compaction hook."""

    @pytest.fixture
    def config(self):
        return _compaction_config()

    @pytest.fixture
    def middleware(self, config):
        return ContextSummarizationMiddleware(config=config)

    @pytest.mark.asyncio
    async def test_passthrough_below_threshold(self, middleware):
        """Messages below trigger_threshold pass through unchanged."""
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        request = _make_model_request([HumanMessage(content="Hi")])

        result = await middleware.awrap_model_call(request, handler)

        handler.assert_awaited_once_with(request)
        assert result.result[0].content == "done"
        assert middleware._compaction_failed is False

    @pytest.mark.asyncio
    async def test_disabled_config_passthrough(self):
        """Disabled config bypasses all compaction logic."""
        config = SummarizationConfig.disabled()
        middleware = ContextSummarizationMiddleware(config=config)
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        request = _make_model_request([HumanMessage(content="x" * 1000)])

        result = await middleware.awrap_model_call(request, handler)

        handler.assert_awaited_once_with(request)
        assert result.result[0].content == "done"

    @pytest.mark.asyncio
    async def test_compaction_triggers_above_threshold(self, middleware):
        """When tokens exceed trigger_threshold, _perform_summarization is called."""
        long_content = "x" * 2000
        original_messages = [HumanMessage(content=long_content)]
        compacted = [HumanMessage(content="summary")]

        handler_received = []

        async def capturing_handler(req):
            handler_received.append(req)
            return ModelResponse(result=[AIMessage(content="done")])

        with patch.object(
            middleware, '_perform_summarization',
            return_value=compacted,
        ) as mock_summarize:
            request = _make_model_request(original_messages)
            await middleware.awrap_model_call(request, capturing_handler)

            mock_summarize.assert_awaited_once_with(original_messages)

        assert len(handler_received) == 1
        assert handler_received[0].messages == compacted
        assert middleware._compactions_performed == 1
        assert middleware._compaction_failed is False

    @pytest.mark.asyncio
    async def test_compaction_failure_forwards_original(self, middleware):
        """When compaction fails, the original request is forwarded."""
        long_content = "x" * 2000
        messages = [HumanMessage(content=long_content)]

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(
            middleware, '_perform_summarization',
            side_effect=RuntimeError("LLM API error"),
        ):
            request = _make_model_request(messages)
            result = await middleware.awrap_model_call(request, handler)

        handler.assert_awaited_once_with(request)
        assert result.result[0].content == "done"
        assert middleware._compaction_failed is True
        assert middleware._compactions_performed == 0

    @pytest.mark.asyncio
    async def test_callback_receives_token_count(self, config):
        """Callback on_token_count_updated is called with pre-compaction count."""
        callback = MagicMock()
        middleware = ContextSummarizationMiddleware(config=config, callback=callback)

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        request = _make_model_request([HumanMessage(content="Hi")])
        await middleware.awrap_model_call(request, handler)

        callback.on_token_count_updated.assert_called()
        token_count = callback.on_token_count_updated.call_args_list[0][0][0]
        assert token_count > 0

    @pytest.mark.asyncio
    async def test_callback_receives_compaction_event(self, config):
        """Callback on_summarization_complete is called after successful compaction."""
        from graphton.core.summarization_callback import SummarizationEventData

        received_events = []

        class TestCallback:
            def on_summarization_complete(self, event: SummarizationEventData) -> None:
                received_events.append(event)

            def on_token_count_updated(self, token_count: int) -> None:
                pass

        middleware = ContextSummarizationMiddleware(config=config, callback=TestCallback())
        compacted = [HumanMessage(content="summary")]

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(middleware, '_perform_summarization', return_value=compacted):
            request = _make_model_request([HumanMessage(content="x" * 2000)])
            await middleware.awrap_model_call(request, handler)

        assert len(received_events) == 1
        event = received_events[0]
        assert event.tokens_before > event.tokens_after
        assert event.compression_ratio > 0
        assert event.summarization_model == "claude-haiku-4"

    @pytest.mark.asyncio
    async def test_callback_error_does_not_break_compaction(self, config):
        """Callback errors are caught and logged, not propagated."""
        callback = MagicMock()
        callback.on_token_count_updated.side_effect = ValueError("boom")
        callback.on_summarization_complete.side_effect = ValueError("boom")

        middleware = ContextSummarizationMiddleware(config=config, callback=callback)
        compacted = [HumanMessage(content="summary")]

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(middleware, '_perform_summarization', return_value=compacted):
            request = _make_model_request([HumanMessage(content="x" * 2000)])
            result = await middleware.awrap_model_call(request, handler)

        assert result.result[0].content == "done"
        assert middleware._compactions_performed == 1

    @pytest.mark.asyncio
    async def test_compaction_resets_failed_flag(self, middleware):
        """Successful compaction clears a previous _compaction_failed."""
        middleware._compaction_failed = True
        compacted = [HumanMessage(content="summary")]

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(middleware, '_perform_summarization', return_value=compacted):
            request = _make_model_request([HumanMessage(content="x" * 2000)])
            await middleware.awrap_model_call(request, handler)

        assert middleware._compaction_failed is False

    @pytest.mark.asyncio
    async def test_below_threshold_clears_failed_flag(self, middleware):
        """Passing below threshold also clears _compaction_failed."""
        middleware._compaction_failed = True

        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        request = _make_model_request([HumanMessage(content="Hi")])
        await middleware.awrap_model_call(request, handler)

        assert middleware._compaction_failed is False

    @pytest.mark.asyncio
    async def test_empty_messages_passthrough(self, middleware):
        """Empty message list passes through (token count = 0 < threshold)."""
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))
        request = _make_model_request([])
        await middleware.awrap_model_call(request, handler)

        handler.assert_awaited_once_with(request)


# =============================================================================
# aafter_model -- Layer B: Monitoring + emergency warning
# =============================================================================


class TestAafterModel:
    """Tests for the emergency monitoring hook."""

    @pytest.fixture
    def config(self):
        return _compaction_config(context_window_tokens=1000)

    @pytest.fixture
    def middleware(self, config):
        return ContextSummarizationMiddleware(config=config)

    @pytest.mark.asyncio
    async def test_normal_operation_returns_none(self, middleware):
        """When compaction succeeded, aafter_model is a no-op."""
        middleware._compaction_failed = False
        state = _make_state([HumanMessage(content="x" * 4000)])

        result = await middleware.aafter_model(state, runtime={})

        assert result is None
        assert middleware._overflow_imminent is False

    @pytest.mark.asyncio
    async def test_disabled_returns_none(self):
        """Disabled config bypasses monitoring."""
        config = SummarizationConfig.disabled()
        middleware = ContextSummarizationMiddleware(config=config)

        result = await middleware.aafter_model(_make_state([HumanMessage(content="x" * 4000)]), runtime={})

        assert result is None

    @pytest.mark.asyncio
    async def test_empty_messages_returns_none(self, middleware):
        result = await middleware.aafter_model(_make_state([]), runtime={})
        assert result is None

    @pytest.mark.asyncio
    async def test_compaction_failed_but_below_overflow(self, middleware):
        """Compaction failed but tokens still below overflow -- no intervention."""
        middleware._compaction_failed = True
        state = _make_state([HumanMessage(content="Hi")])

        result = await middleware.aafter_model(state, runtime={})

        assert result is None
        assert middleware._overflow_imminent is False

    @pytest.mark.asyncio
    async def test_compaction_failed_and_above_overflow(self, middleware):
        """Compaction failed + tokens >= overflow_threshold triggers emergency."""
        middleware._compaction_failed = True
        big_content = "x" * 4000
        state = _make_state([HumanMessage(content=big_content)])

        result = await middleware.aafter_model(state, runtime={})

        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        msg = result["messages"][0]
        assert isinstance(msg, SystemMessage)
        assert "CONTEXT WARNING" in msg.content
        assert middleware._overflow_imminent is True
        assert middleware._mid_execution_warning_issued is True

    @pytest.mark.asyncio
    async def test_callback_receives_state_token_count(self, config):
        """Callback on_token_count_updated is called with state tokens."""
        callback = MagicMock()
        middleware = ContextSummarizationMiddleware(config=config, callback=callback)

        state = _make_state([HumanMessage(content="Hello")])
        await middleware.aafter_model(state, runtime={})

        callback.on_token_count_updated.assert_called()
        assert callback.on_token_count_updated.call_args[0][0] > 0

    @pytest.mark.asyncio
    async def test_callback_error_does_not_break_monitoring(self, config):
        """Callback error is caught; monitoring continues."""
        callback = MagicMock()
        callback.on_token_count_updated.side_effect = RuntimeError("boom")
        middleware = ContextSummarizationMiddleware(config=config, callback=callback)
        middleware._compaction_failed = True

        big_content = "x" * 4000
        state = _make_state([HumanMessage(content=big_content)])
        result = await middleware.aafter_model(state, runtime={})

        assert result is not None
        assert middleware._overflow_imminent is True


# =============================================================================
# awrap_tool_call -- Layer B: Emergency brake
# =============================================================================


class TestAwrapToolCallSummarization:
    """Tests for the emergency brake tool-blocking hook."""

    @pytest.fixture
    def config(self):
        return _compaction_config()

    @pytest.fixture
    def middleware(self, config):
        return ContextSummarizationMiddleware(config=config)

    @pytest.mark.asyncio
    async def test_passthrough_when_not_overflow(self, middleware):
        """Tools execute normally when overflow is not imminent."""
        handler = AsyncMock(return_value=ToolMessage(
            content="file contents",
            tool_call_id="tc1",
        ))
        request = _make_tool_call_request("read_file", {"path": "/foo"}, "tc1")

        result = await middleware.awrap_tool_call(request, handler)

        handler.assert_awaited_once_with(request)
        assert isinstance(result, ToolMessage)
        assert result.content == "file contents"

    @pytest.mark.asyncio
    async def test_blocks_when_overflow_imminent(self, middleware):
        """Tool execution is blocked when _overflow_imminent is True."""
        middleware._overflow_imminent = True
        handler = AsyncMock()
        request = _make_tool_call_request("read_file", {"path": "/foo"}, "tc1")

        result = await middleware.awrap_tool_call(request, handler)

        handler.assert_not_awaited()
        assert isinstance(result, ToolMessage)
        assert result.tool_call_id == "tc1"
        assert "Context limit reached" in result.content
        assert "blocked" in result.content

    @pytest.mark.asyncio
    async def test_blocked_message_has_correct_tool_metadata(self, middleware):
        """Blocked ToolMessage carries the correct tool name and call ID."""
        middleware._overflow_imminent = True
        handler = AsyncMock()
        request = _make_tool_call_request("search_code", {"q": "foo"}, "tc42")

        result = await middleware.awrap_tool_call(request, handler)

        assert result.name == "search_code"
        assert result.tool_call_id == "tc42"

    @pytest.mark.asyncio
    async def test_blocks_multiple_calls(self, middleware):
        """All tool calls are blocked once _overflow_imminent is True."""
        middleware._overflow_imminent = True
        handler = AsyncMock()

        for i in range(3):
            req = _make_tool_call_request(f"tool_{i}", {}, f"tc{i}")
            result = await middleware.awrap_tool_call(req, handler)
            assert isinstance(result, ToolMessage)
            assert "blocked" in result.content

        handler.assert_not_awaited()


# =============================================================================
# Compaction lifecycle
# =============================================================================


class TestCompactionLifecycle:
    """End-to-end lifecycle tests spanning abefore_agent -> model calls -> aafter_agent."""

    @pytest.fixture
    def config(self):
        return _compaction_config(context_window_tokens=1000)

    @pytest.fixture
    def middleware(self, config):
        return ContextSummarizationMiddleware(config=config)

    @pytest.mark.asyncio
    async def test_abefore_agent_resets_compaction_state(self, middleware):
        """abefore_agent resets all mid-execution tracking fields."""
        middleware._compaction_failed = True
        middleware._compactions_performed = 5
        middleware._overflow_imminent = True
        middleware._mid_execution_warning_issued = True

        state = _make_state([HumanMessage(content="Hi")])
        await middleware.abefore_agent(state, runtime={})

        assert middleware._compaction_failed is False
        assert middleware._compactions_performed == 0
        assert middleware._overflow_imminent is False
        assert middleware._mid_execution_warning_issued is False

    @pytest.mark.asyncio
    async def test_successful_compaction_across_model_calls(self, middleware):
        """Multiple model calls with compaction: counter increments each time."""
        compacted = [HumanMessage(content="summary")]
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(middleware, '_perform_summarization', return_value=compacted):
            for _ in range(3):
                request = _make_model_request([HumanMessage(content="x" * 2000)])
                await middleware.awrap_model_call(request, handler)

        assert middleware._compactions_performed == 3
        assert middleware._compaction_failed is False
        assert middleware._overflow_imminent is False

    @pytest.mark.asyncio
    async def test_compaction_failure_triggers_emergency_brake(self, middleware):
        """Compaction fails -> aafter_model detects overflow -> awrap_tool_call blocks."""
        handler = AsyncMock(return_value=ModelResponse(
            result=[AIMessage(content="done")],
        ))

        with patch.object(
            middleware, '_perform_summarization',
            side_effect=RuntimeError("LLM unreachable"),
        ):
            request = _make_model_request([HumanMessage(content="x" * 2000)])
            await middleware.awrap_model_call(request, handler)

        assert middleware._compaction_failed is True

        big_state = _make_state([HumanMessage(content="x" * 4000)])
        warning_result = await middleware.aafter_model(big_state, runtime={})

        assert warning_result is not None
        assert middleware._overflow_imminent is True

        tool_handler = AsyncMock()
        tool_req = _make_tool_call_request("search", {}, "tc1")
        tool_result = await middleware.awrap_tool_call(tool_req, tool_handler)

        tool_handler.assert_not_awaited()
        assert "blocked" in tool_result.content

    @pytest.mark.asyncio
    async def test_reset_between_invocations(self, middleware):
        """abefore_agent clears emergency state from a prior invocation."""
        middleware._overflow_imminent = True
        middleware._compaction_failed = True

        state = _make_state([HumanMessage(content="Hi")])
        await middleware.abefore_agent(state, runtime={})

        assert middleware._overflow_imminent is False
        assert middleware._compaction_failed is False

        tool_handler = AsyncMock(return_value=ToolMessage(
            content="ok", tool_call_id="tc1",
        ))
        tool_req = _make_tool_call_request("read_file", {}, "tc1")
        result = await middleware.awrap_tool_call(tool_req, tool_handler)

        tool_handler.assert_awaited_once()
        assert result.content == "ok"

    @pytest.mark.asyncio
    async def test_aafter_agent_logs_compaction_stats(self, middleware):
        """aafter_agent completes without error after compaction activity."""
        middleware._compactions_performed = 2
        middleware._compaction_failed = False
        middleware._mid_execution_warning_issued = False

        state = _make_state([])
        result = await middleware.aafter_agent(state, runtime={})

        assert result is None


# =============================================================================
# TestSummarizationUsageCapture - Phase 3 token capture tests
# =============================================================================


class TestSummarizationUsageCapture:
    """Tests for _SummarizationUsageCapture callback handler."""

    def test_captures_usage_from_llm_end(self):
        """on_llm_end extracts input/output tokens from usage_metadata."""
        from graphton.core.summarization_middleware import _SummarizationUsageCapture

        capture = _SummarizationUsageCapture()

        msg = MagicMock()
        msg.usage_metadata = MagicMock(input_tokens=1000, output_tokens=200)

        gen = MagicMock()
        gen.message = msg

        response = MagicMock()
        response.generations = [[gen]]

        capture.on_llm_end(response)

        assert capture.input_tokens == 1000
        assert capture.output_tokens == 200

    def test_accumulates_across_multiple_calls(self):
        """Multiple on_llm_end calls accumulate tokens."""
        from graphton.core.summarization_middleware import _SummarizationUsageCapture

        capture = _SummarizationUsageCapture()

        for tokens in [(500, 100), (300, 50)]:
            msg = MagicMock()
            msg.usage_metadata = MagicMock(
                input_tokens=tokens[0], output_tokens=tokens[1],
            )
            gen = MagicMock()
            gen.message = msg
            response = MagicMock()
            response.generations = [[gen]]
            capture.on_llm_end(response)

        assert capture.input_tokens == 800
        assert capture.output_tokens == 150

    def test_handles_missing_usage_metadata(self):
        """Gracefully handles responses without usage_metadata."""
        from graphton.core.summarization_middleware import _SummarizationUsageCapture

        capture = _SummarizationUsageCapture()

        gen = MagicMock()
        gen.message = MagicMock(usage_metadata=None)
        response = MagicMock()
        response.generations = [[gen]]

        capture.on_llm_end(response)

        assert capture.input_tokens == 0
        assert capture.output_tokens == 0


class TestSummarizationEventDataExtendedFields:
    """Tests for new token/cost fields on SummarizationEventData."""

    def test_default_values(self):
        """New fields default to zero."""
        from graphton.core.summarization_callback import SummarizationEventData

        event = SummarizationEventData(
            tokens_before=10000,
            tokens_after=5000,
            compression_ratio=0.5,
            duration_ms=1000,
            summarization_model="claude-haiku-4.5",
            messages_before=20,
            messages_after=5,
            source="graph_start",
        )
        assert event.summarization_input_tokens == 0
        assert event.summarization_output_tokens == 0
        assert event.summarization_cost_usd == 0.0

    def test_explicit_values(self):
        """New fields can be set explicitly."""
        from graphton.core.summarization_callback import SummarizationEventData

        event = SummarizationEventData(
            tokens_before=10000,
            tokens_after=5000,
            compression_ratio=0.5,
            duration_ms=1000,
            summarization_model="claude-haiku-4.5",
            messages_before=20,
            messages_after=5,
            source="graph_start",
            summarization_input_tokens=8000,
            summarization_output_tokens=500,
            summarization_cost_usd=0.003,
        )
        assert event.summarization_input_tokens == 8000
        assert event.summarization_output_tokens == 500
        assert event.summarization_cost_usd == 0.003
