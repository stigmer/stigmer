"""Unit tests for the model parser (parse_model_string).

Tests cover:
- Native extended thinking configuration for supported Anthropic models
- Temperature removal when thinking is enabled
- Explicit thinking config respected (not overridden)
- Non-thinking models unaffected
"""

from unittest.mock import patch

import pytest
from langchain_anthropic import ChatAnthropic

from graphton.core.models import DEFAULT_THINKING_BUDGET, parse_model_string


# =============================================================================
# TestNativeThinkingConfig - Tests for extended thinking in parse_model_string
# =============================================================================


class TestNativeThinkingConfig:
    """Tests for automatic extended thinking configuration."""

    @pytest.mark.parametrize("model_name", [
        "claude-sonnet-4.6",
        "claude-opus-4.5",
        "claude-sonnet-4.5",
        "claude-opus-4",
    ])
    def test_thinking_enabled_for_supported_models(self, model_name):
        """Test that parse_model_string sets thinking config for supported models."""
        model = parse_model_string(model_name)
        assert isinstance(model, ChatAnthropic)
        thinking = getattr(model, "thinking", None)
        assert thinking is not None, f"{model_name} should have thinking enabled"
        assert thinking["type"] == "enabled"
        assert thinking["budget_tokens"] == DEFAULT_THINKING_BUDGET

    @pytest.mark.parametrize("model_name", [
        "claude-opus-4.6",
        "claude-haiku-4",
        "claude-sonnet-3.5",
        "claude-haiku-3.5",
    ])
    def test_thinking_not_enabled_for_unsupported_models(self, model_name):
        """Test that parse_model_string does NOT set thinking for unsupported models."""
        model = parse_model_string(model_name)
        assert isinstance(model, ChatAnthropic)
        thinking = getattr(model, "thinking", None)
        assert thinking is None, f"{model_name} should NOT have thinking enabled"

    def test_temperature_removed_when_thinking_enabled(self):
        """Test that temperature is stripped when thinking is auto-enabled."""
        model = parse_model_string("claude-sonnet-4.5", temperature=0.7)
        assert isinstance(model, ChatAnthropic)
        # Thinking should be enabled (model supports it)
        assert getattr(model, "thinking", None) is not None
        # Temperature should have been removed (Anthropic API rejects it with thinking)
        assert getattr(model, "temperature", None) is None

    def test_explicit_thinking_respected(self):
        """Test that an explicit thinking config passed via kwargs is not overridden."""
        custom_thinking = {"type": "enabled", "budget_tokens": 5000}
        model = parse_model_string("claude-sonnet-4.5", thinking=custom_thinking)
        assert isinstance(model, ChatAnthropic)
        thinking = getattr(model, "thinking", None)
        assert thinking is not None
        assert thinking["budget_tokens"] == 5000

    def test_temperature_warning_logged(self):
        """Test that a warning is logged when temperature is removed."""
        with patch("graphton.core.models.logger") as mock_logger:
            parse_model_string("claude-sonnet-4.5", temperature=0.5)
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args[0]
            assert "temperature" in call_args[0].lower()
