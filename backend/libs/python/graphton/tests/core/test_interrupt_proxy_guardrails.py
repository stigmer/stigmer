"""Tests for sub-agent guardrail middleware injection in compile_subagent.

Verifies that compile_subagent auto-injects guardrail middleware:
- LoopDetectionMiddleware (prevents infinite tool loops)
- ToolTruncationMiddleware (caps per-tool-result character count)
- ExecutionBudgetMiddleware (periodic advisory nudges every 30 rounds)

Sub-agents run with effectively unlimited recursion (matching the main
agent).  The budget middleware operates in periodic mode — advisory
nudges only, no hard stop.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from graphton.core.execution_budget import ExecutionBudgetMiddleware
from graphton.core.interrupt_proxy import (
    _SUB_AGENT_ADVISORY_INTERVAL,
    _SUB_AGENT_MAX_ADVISORIES,
    _UNLIMITED_RECURSION,
    compile_subagent,
)
from graphton.core.loop_detection import LoopDetectionMiddleware
from graphton.core.tool_truncation import ToolTruncationMiddleware


@pytest.fixture
def mock_model():
    model = MagicMock()
    model.bind_tools = MagicMock(return_value=model)
    return model


@pytest.fixture
def mock_tools():
    tool = MagicMock()
    tool.name = "read_file"
    tool.description = "Reads a file"
    return [tool]


class TestGuardrailInjection:
    """Verify that compile_subagent injects guardrail middleware."""

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_injects_loop_detection(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])

        loop_detection = [m for m in middleware_list if isinstance(m, LoopDetectionMiddleware)]
        assert len(loop_detection) == 1

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_injects_tool_truncation(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])

        truncation_mw = [m for m in middleware_list if isinstance(m, ToolTruncationMiddleware)]
        assert len(truncation_mw) == 1

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_injects_execution_budget_periodic(self, mock_create_agent, mock_model, mock_tools):
        """ExecutionBudgetMiddleware is injected in periodic mode."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])

        budget_mw = [m for m in middleware_list if isinstance(m, ExecutionBudgetMiddleware)]
        assert len(budget_mw) == 1

        mw = budget_mw[0]
        assert mw._periodic is True
        assert mw.warning_interval == _SUB_AGENT_ADVISORY_INTERVAL
        assert mw.max_warnings == _SUB_AGENT_MAX_ADVISORIES

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_preserves_caller_middleware(self, mock_create_agent, mock_model, mock_tools):
        """Caller-provided middleware is preserved alongside auto-injected ones."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        sentinel = MagicMock()
        sentinel.__class__.__name__ = "CallerMiddleware"

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
            middleware=[sentinel],
        )

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])

        assert sentinel in middleware_list
        assert len(middleware_list) == 4  # sentinel + 3 guardrails

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_total_guardrail_count(self, mock_create_agent, mock_model, mock_tools):
        """Three guardrails are injected: loop detection, truncation, budget."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])

        assert len(middleware_list) == 3

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_no_checkpointer_passed(self, mock_create_agent, mock_model, mock_tools):
        """compile_subagent must NOT pass checkpointer to create_agent
        (LangGraph per-invocation mode: sub-agent inherits parent's)."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        call_kwargs = mock_create_agent.call_args
        assert "checkpointer" not in (call_kwargs.kwargs or {})

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_returns_compiled_graph_directly(self, mock_create_agent, mock_model, mock_tools):
        """The returned runnable should be the compiled graph, not a proxy wrapper."""
        mock_graph = MagicMock()
        configured_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=configured_graph)
        mock_create_agent.return_value = mock_graph

        result = compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        assert result["runnable"] is configured_graph
        assert result["name"] == "test-sa"
        assert result["description"] == "test sub-agent"


class TestRecursionLimitForwarding:
    """Verify recursion_limit is forwarded to the compiled graph."""

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_default_recursion_limit_is_unlimited(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        mock_graph.with_config.assert_called_once_with(
            {"recursion_limit": _UNLIMITED_RECURSION},
        )

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_custom_recursion_limit(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
            recursion_limit=100,
        )

        mock_graph.with_config.assert_called_once_with(
            {"recursion_limit": 100},
        )

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_none_recursion_limit_uses_unlimited(self, mock_create_agent, mock_model, mock_tools):
        """Passing recursion_limit=None falls back to unlimited."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
            recursion_limit=None,
        )

        mock_graph.with_config.assert_called_once_with(
            {"recursion_limit": _UNLIMITED_RECURSION},
        )
