"""Unit tests for checkpointer infrastructure (HITL Phase 3B Sub-Task 1).

Tests cover:
- Checkpointer parameter acceptance in create_deep_agent
- Checkpointer propagation to deepagents library
- Backward compatibility (None checkpointer works)
- Config validation with checkpointer
"""

import pytest
from unittest.mock import MagicMock, patch

from graphton.core.config import AgentConfig


# =============================================================================
# TestCheckpointerConfig - Tests for AgentConfig checkpointer validation
# =============================================================================


class TestCheckpointerConfig:
    """Tests for checkpointer parameter in AgentConfig."""

    def test_checkpointer_none_default(self):
        """Test that checkpointer defaults to None."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.checkpointer is None

    def test_checkpointer_accepts_mock_saver(self):
        """Test that checkpointer accepts a mock checkpoint saver."""
        mock_checkpointer = MagicMock()
        mock_checkpointer.__class__.__name__ = "MemorySaver"
        
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            checkpointer=mock_checkpointer,
        )
        assert config.checkpointer is mock_checkpointer

    def test_checkpointer_with_other_params(self):
        """Test that checkpointer works with other parameters."""
        mock_checkpointer = MagicMock()
        
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            mcp_servers={"test": {"url": "http://localhost"}},
            mcp_tools={"test": ["tool1"]},
            sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
            checkpointer=mock_checkpointer,
        )
        assert config.checkpointer is mock_checkpointer
        assert config.mcp_servers is not None
        assert config.sandbox_config is not None


# =============================================================================
# TestCreateDeepAgentCheckpointer - Tests for create_deep_agent checkpointer
# =============================================================================


class TestCreateDeepAgentCheckpointer:
    """Tests for checkpointer parameter in create_deep_agent function."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_checkpointer_none_by_default(
        self, mock_parse_model, mock_deepagents_create
    ):
        """Test that checkpointer is None by default."""
        from graphton.core.agent import create_deep_agent
        
        # Setup mocks
        mock_model_instance = MagicMock()
        mock_parse_model.return_value = mock_model_instance
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_deepagents_create.return_value = mock_agent
        
        # Call without checkpointer
        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        
        # Verify checkpointer=None was passed
        call_kwargs = mock_deepagents_create.call_args[1]
        assert call_kwargs.get("checkpointer") is None

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_checkpointer_passed_to_deepagents(
        self, mock_parse_model, mock_deepagents_create
    ):
        """Test that checkpointer is passed to deepagents library."""
        from graphton.core.agent import create_deep_agent
        
        # Setup mocks
        mock_model_instance = MagicMock()
        mock_parse_model.return_value = mock_model_instance
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_deepagents_create.return_value = mock_agent
        
        # Create mock checkpointer
        mock_checkpointer = MagicMock()
        mock_checkpointer.__class__.__name__ = "MemorySaver"
        
        # Call with checkpointer
        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            checkpointer=mock_checkpointer,
        )
        
        # Verify checkpointer was passed
        call_kwargs = mock_deepagents_create.call_args[1]
        assert call_kwargs.get("checkpointer") is mock_checkpointer

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    @patch("graphton.core.middleware.McpToolsLoader")
    @patch("graphton.core.tool_wrappers.create_tool_wrapper")
    def test_checkpointer_with_mcp_config(
        self, mock_wrapper, mock_mcp_loader, mock_parse_model, mock_deepagents_create
    ):
        """Test checkpointer works alongside MCP configuration."""
        from graphton.core.agent import create_deep_agent
        
        # Setup mocks
        mock_model_instance = MagicMock()
        mock_parse_model.return_value = mock_model_instance
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_deepagents_create.return_value = mock_agent
        
        # Setup MCP middleware mock
        mock_middleware = MagicMock()
        mock_middleware._deferred_loading = False
        mock_middleware.get_tool.return_value = MagicMock()
        mock_mcp_loader.return_value = mock_middleware
        mock_wrapper.return_value = MagicMock()
        
        # Create mock checkpointer
        mock_checkpointer = MagicMock()
        
        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant for MCP integration.",
            mcp_servers={"test": {"url": "http://localhost"}},
            mcp_tools={"test": ["tool1"]},
            checkpointer=mock_checkpointer,
        )
        
        # Verify checkpointer was passed even with MCP config
        call_kwargs = mock_deepagents_create.call_args[1]
        assert call_kwargs.get("checkpointer") is mock_checkpointer


# =============================================================================
# TestCheckpointerBackwardCompatibility - Backward compatibility tests
# =============================================================================


class TestCheckpointerBackwardCompatibility:
    """Tests for backward compatibility with existing code."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_no_checkpointer_existing_behavior(
        self, mock_parse_model, mock_deepagents_create
    ):
        """Test that existing code without checkpointer still works."""
        from graphton.core.agent import create_deep_agent
        
        # Setup mocks
        mock_model_instance = MagicMock()
        mock_parse_model.return_value = mock_model_instance
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_deepagents_create.return_value = mock_agent
        
        # Call without checkpointer (existing pattern)
        result = create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=50,
        )
        
        # Should succeed and return agent
        assert result is mock_agent
        mock_deepagents_create.assert_called_once()

    def test_config_without_checkpointer(self):
        """Test that AgentConfig works without checkpointer (backward compat)."""
        # This should work exactly as before
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=50,
            loop_history_size=20,
        )
        assert config.model == "gpt-4"
        assert config.checkpointer is None


# =============================================================================
# TestCheckpointerTypeAcceptance - Tests for various checkpointer types
# =============================================================================


class TestCheckpointerTypeAcceptance:
    """Tests that various checkpoint saver types are accepted."""

    def test_accepts_mock_memory_saver(self):
        """Test that a mock MemorySaver is accepted."""
        mock_saver = MagicMock()
        mock_saver.__class__.__name__ = "MemorySaver"
        
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant for memory saver validation.",
            checkpointer=mock_saver,
        )
        assert config.checkpointer is mock_saver

    def test_accepts_mock_postgres_saver(self):
        """Test that a mock PostgresSaver is accepted."""
        mock_saver = MagicMock()
        mock_saver.__class__.__name__ = "PostgresSaver"
        
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant for postgres saver validation.",
            checkpointer=mock_saver,
        )
        assert config.checkpointer is mock_saver

    def test_accepts_any_object_with_saver_interface(self):
        """Test that any object can be used as checkpointer (duck typing)."""
        # Create a custom object that might implement checkpoint interface
        class CustomCheckpointer:
            def put(self, config, checkpoint, metadata):
                pass
            def get(self, config):
                pass
        
        custom_saver = CustomCheckpointer()
        
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant for custom checkpointer validation.",
            checkpointer=custom_saver,
        )
        assert config.checkpointer is custom_saver
