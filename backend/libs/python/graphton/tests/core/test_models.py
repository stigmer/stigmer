"""Unit tests for the model parser and Anthropic message sanitization.

Tests cover:
- Native extended thinking configuration for supported Anthropic models
- Temperature removal when thinking is enabled
- Explicit thinking config respected (not overridden)
- Non-thinking models unaffected
- Non-leading SystemMessage sanitization for Anthropic API compatibility
"""

from unittest.mock import patch

import pytest
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from graphton.core.models import (
    DEFAULT_THINKING_BUDGET,
    DEFAULT_THINKING_EFFORT,
    _reorder_tool_result_pairing,
    _sanitize_non_leading_system_messages,
    parse_model_string,
)

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

    def test_adaptive_thinking_for_opus_4_6(self):
        """Test that Opus 4.6 gets adaptive thinking with effort in output_config."""
        model = parse_model_string("claude-opus-4.6")
        assert isinstance(model, ChatAnthropic)
        thinking = getattr(model, "thinking", None)
        assert thinking is not None, "Opus 4.6 should have thinking enabled"
        assert thinking["type"] == "adaptive"
        assert "effort" not in thinking, "effort must not be inside thinking dict"
        assert model._effort == DEFAULT_THINKING_EFFORT

    def test_adaptive_thinking_strips_temperature(self):
        """Test that temperature is stripped when adaptive thinking is auto-enabled."""
        model = parse_model_string("claude-opus-4.6", temperature=0.7)
        assert isinstance(model, ChatAnthropic)
        assert getattr(model, "thinking", None) is not None
        assert getattr(model, "temperature", None) is None

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


# =============================================================================
# TestSanitizeNonLeadingSystemMessages - Anthropic system message compatibility
# =============================================================================


class TestSanitizeNonLeadingSystemMessages:
    """Tests for _sanitize_non_leading_system_messages.

    Anthropic's _format_messages() requires all SystemMessage objects to be
    contiguous at the start.  Guardrail middleware injects SystemMessage
    mid-conversation via aafter_model.  The sanitizer converts those trailing
    SystemMessages to HumanMessage with a [System] prefix.
    """

    def test_empty_list_returns_empty(self):
        result = _sanitize_non_leading_system_messages([])
        assert result == []

    def test_no_system_messages_passthrough(self):
        msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
        result = _sanitize_non_leading_system_messages(msgs)
        assert result is msgs

    def test_only_leading_system_messages_passthrough(self):
        msgs = [
            SystemMessage(content="prompt"),
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert result is msgs

    def test_multiple_consecutive_leading_system_messages_passthrough(self):
        msgs = [
            SystemMessage(content="prompt A"),
            SystemMessage(content="prompt B"),
            HumanMessage(content="hi"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert result is msgs

    def test_single_trailing_system_message_converted(self):
        msgs = [
            SystemMessage(content="prompt"),
            HumanMessage(content="hi"),
            AIMessage(content="response"),
            SystemMessage(content="budget warning"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert len(result) == 4
        assert isinstance(result[0], SystemMessage)
        assert result[0].content == "prompt"
        assert isinstance(result[1], HumanMessage)
        assert isinstance(result[2], AIMessage)
        assert isinstance(result[3], HumanMessage)
        assert result[3].content == "[System] budget warning"

    def test_multiple_trailing_system_messages_all_converted(self):
        """Both loop detection and budget warnings fire in the same execution.

        AIMessage(tool_calls) at positions [2] and [5] have SystemMessages
        injected after them.  After sanitization + reordering, each advisory
        should appear after its corresponding ToolMessage, not before.
        """
        msgs = [
            SystemMessage(content="prompt"),
            HumanMessage(content="hi"),
            AIMessage(content="first response", tool_calls=[{"id": "tc_1", "name": "read", "args": {}}]),
            SystemMessage(content="loop warning"),
            ToolMessage(content="result", tool_call_id="tc_1"),
            AIMessage(content="second response", tool_calls=[{"id": "tc_2", "name": "write", "args": {}}]),
            SystemMessage(content="budget warning"),
            ToolMessage(content="result2", tool_call_id="tc_2"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert len(result) == 8
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[2], AIMessage)
        assert isinstance(result[3], ToolMessage)
        assert result[3].tool_call_id == "tc_1"
        assert isinstance(result[4], HumanMessage)
        assert result[4].content == "[System] loop warning"
        assert isinstance(result[5], AIMessage)
        assert isinstance(result[6], ToolMessage)
        assert result[6].tool_call_id == "tc_2"
        assert isinstance(result[7], HumanMessage)
        assert result[7].content == "[System] budget warning"

    def test_no_leading_system_with_mid_conversation_system(self):
        """Sub-agent where system_prompt is handled via closure, not state."""
        msgs = [
            HumanMessage(content="task description"),
            AIMessage(content="working..."),
            SystemMessage(content="wrap up"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert len(result) == 3
        assert isinstance(result[0], HumanMessage)
        assert isinstance(result[2], HumanMessage)
        assert result[2].content == "[System] wrap up"

    def test_single_system_message_only_stays_as_leading(self):
        msgs = [SystemMessage(content="prompt")]
        result = _sanitize_non_leading_system_messages(msgs)
        assert result is msgs

    def test_tool_messages_adjacent_to_converted_system_preserved(self):
        """ToolMessages must remain ToolMessages for Anthropic tool_result pairing.

        After reordering, the ToolMessage should appear immediately after the
        AIMessage with tool_calls, and the converted advisory should follow.
        """
        msgs = [
            SystemMessage(content="prompt"),
            HumanMessage(content="hi"),
            AIMessage(content="call", tool_calls=[{"id": "tc_1", "name": "read", "args": {}}]),
            SystemMessage(content="budget warning"),
            ToolMessage(content="file content", tool_call_id="tc_1"),
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert len(result) == 5
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[2], AIMessage)
        assert isinstance(result[3], ToolMessage)
        assert result[3].tool_call_id == "tc_1"
        assert isinstance(result[4], HumanMessage)
        assert result[4].content == "[System] budget warning"

    def test_non_system_messages_untouched(self):
        """All non-SystemMessage types pass through without modification."""
        human = HumanMessage(content="hi")
        ai = AIMessage(content="hello")
        tool = ToolMessage(content="result", tool_call_id="tc_1")
        msgs = [
            SystemMessage(content="prompt"),
            human,
            ai,
            SystemMessage(content="warning"),
            tool,
        ]
        result = _sanitize_non_leading_system_messages(msgs)
        assert result[1] is human
        assert result[2] is ai
        assert result[4] is tool

    def test_warning_logged_on_sanitization(self):
        msgs = [
            SystemMessage(content="prompt"),
            HumanMessage(content="hi"),
            SystemMessage(content="warning1"),
            SystemMessage(content="warning2"),
        ]
        with patch("graphton.core.models.logger") as mock_logger:
            _sanitize_non_leading_system_messages(msgs)
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args[0]
            assert "2" in str(call_args)
            assert "Anthropic" in str(call_args)


# =============================================================================
# TestReorderToolResultPairing - Defensive reordering for tool_use → tool_result
# =============================================================================


class TestReorderToolResultPairing:
    """Tests for _reorder_tool_result_pairing.

    Guardrail middleware (ExecutionBudgetMiddleware, LoopDetectionMiddleware)
    inject messages between AIMessage(tool_calls) and ToolMessage via
    aafter_model.  The reordering function moves those interleaved messages
    to AFTER the ToolMessages so the Anthropic API's tool_use → tool_result
    contract is structurally unbroken.
    """

    def test_empty_list(self):
        assert _reorder_tool_result_pairing([]) == []

    def test_no_tool_calls_passthrough(self):
        msgs = [
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
            HumanMessage(content="thanks"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert result == msgs

    def test_normal_sequence_unchanged(self):
        """AIMessage(tool_calls) → ToolMessage is already correct."""
        msgs = [
            HumanMessage(content="hi"),
            AIMessage(
                content="calling",
                tool_calls=[{"id": "tc_1", "name": "read", "args": {}}],
            ),
            ToolMessage(content="result", tool_call_id="tc_1"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert [type(m).__name__ for m in result] == [
            "HumanMessage", "AIMessage", "ToolMessage",
        ]

    def test_single_advisory_reordered(self):
        """HumanMessage between AIMessage(tool_calls) and ToolMessage is moved."""
        msgs = [
            AIMessage(
                content="calling",
                tool_calls=[{"id": "tc_1", "name": "read", "args": {}}],
            ),
            HumanMessage(content="[System] budget advisory"),
            ToolMessage(content="result", tool_call_id="tc_1"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert isinstance(result[0], AIMessage)
        assert isinstance(result[1], ToolMessage)
        assert result[1].tool_call_id == "tc_1"
        assert isinstance(result[2], HumanMessage)
        assert result[2].content == "[System] budget advisory"

    def test_multiple_advisories_reordered(self):
        """Both budget and loop advisories between AIMessage and ToolMessages."""
        msgs = [
            AIMessage(
                content="calling",
                tool_calls=[{"id": "tc_1", "name": "read", "args": {}}],
            ),
            HumanMessage(content="[System] budget advisory"),
            HumanMessage(content="[System] loop warning"),
            ToolMessage(content="result", tool_call_id="tc_1"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert isinstance(result[0], AIMessage)
        assert isinstance(result[1], ToolMessage)
        assert isinstance(result[2], HumanMessage)
        assert result[2].content == "[System] budget advisory"
        assert isinstance(result[3], HumanMessage)
        assert result[3].content == "[System] loop warning"

    def test_multiple_tool_calls_with_advisory(self):
        """Model called two tools; advisory interleaved before both results."""
        msgs = [
            AIMessage(
                content="calling two tools",
                tool_calls=[
                    {"id": "tc_1", "name": "read", "args": {}},
                    {"id": "tc_2", "name": "write", "args": {}},
                ],
            ),
            HumanMessage(content="[System] advisory"),
            ToolMessage(content="result1", tool_call_id="tc_1"),
            ToolMessage(content="result2", tool_call_id="tc_2"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert isinstance(result[0], AIMessage)
        assert isinstance(result[1], ToolMessage)
        assert isinstance(result[2], ToolMessage)
        assert isinstance(result[3], HumanMessage)
        assert result[3].content == "[System] advisory"

    def test_multi_round_with_advisory_in_one(self):
        """30-round-like scenario: advisory fires in one round, not others."""
        msgs = [
            HumanMessage(content="task"),
            AIMessage(
                content="round 1",
                tool_calls=[{"id": "tc_1", "name": "read", "args": {}}],
            ),
            ToolMessage(content="r1", tool_call_id="tc_1"),
            AIMessage(
                content="round 2",
                tool_calls=[{"id": "tc_2", "name": "write", "args": {}}],
            ),
            HumanMessage(content="[System] advisory at round 2"),
            ToolMessage(content="r2", tool_call_id="tc_2"),
            AIMessage(content="done"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        types = [type(m).__name__ for m in result]
        assert types == [
            "HumanMessage",
            "AIMessage", "ToolMessage",
            "AIMessage", "ToolMessage", "HumanMessage",
            "AIMessage",
        ]
        assert result[4].tool_call_id == "tc_2"
        assert result[5].content == "[System] advisory at round 2"

    def test_ai_message_without_tool_calls_not_affected(self):
        """AIMessage(no tool_calls) → HumanMessage → ToolMessage stays as-is."""
        msgs = [
            AIMessage(content="thinking..."),
            HumanMessage(content="[System] advisory"),
            ToolMessage(content="orphan", tool_call_id="tc_x"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert [type(m).__name__ for m in result] == [
            "AIMessage", "HumanMessage", "ToolMessage",
        ]

    def test_system_message_between_ai_and_tool_also_reordered(self):
        """SystemMessage (not yet converted) is also moved after ToolMessages."""
        msgs = [
            AIMessage(
                content="call",
                tool_calls=[{"id": "tc_1", "name": "read", "args": {}}],
            ),
            SystemMessage(content="raw advisory"),
            ToolMessage(content="result", tool_call_id="tc_1"),
        ]
        result = _reorder_tool_result_pairing(msgs)
        assert isinstance(result[0], AIMessage)
        assert isinstance(result[1], ToolMessage)
        assert isinstance(result[2], SystemMessage)
