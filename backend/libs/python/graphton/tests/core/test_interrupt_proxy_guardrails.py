"""Tests for sub-agent guardrail middleware injection in compile_subagent_with_proxy.

Verifies that compile_subagent_with_proxy auto-injects the same guardrail
middleware that create_deep_agent provides for the main agent:
- LoopDetectionMiddleware
- ExecutionBudgetMiddleware
- ToolTruncationMiddleware

Also tests recursion_limit forwarding to the compiled graph.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from graphton.core.execution_budget import ExecutionBudgetMiddleware
from graphton.core.interrupt_proxy import (
    _DEFAULT_SUB_AGENT_RECURSION_LIMIT,
    compile_subagent_with_proxy,
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
    """Verify that compile_subagent_with_proxy injects guardrail middleware."""

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_injects_loop_detection(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
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
    def test_injects_execution_budget(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
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
        assert budget_mw[0].recursion_limit == _DEFAULT_SUB_AGENT_RECURSION_LIMIT

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_injects_tool_truncation(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
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
    def test_preserves_caller_middleware(self, mock_create_agent, mock_model, mock_tools):
        """Caller-provided middleware is preserved alongside auto-injected ones."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        sentinel = MagicMock()
        sentinel.__class__.__name__ = "CallerMiddleware"

        compile_subagent_with_proxy(
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


class TestRecursionLimitForwarding:
    """Verify recursion_limit is forwarded to the compiled graph."""

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_default_recursion_limit(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
        )

        mock_graph.with_config.assert_called_once_with(
            {"recursion_limit": _DEFAULT_SUB_AGENT_RECURSION_LIMIT},
        )

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_custom_recursion_limit(self, mock_create_agent, mock_model, mock_tools):
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
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

        call_kwargs = mock_create_agent.call_args
        middleware_list = call_kwargs.kwargs.get("middleware") or call_kwargs[1].get("middleware", [])
        budget_mw = [m for m in middleware_list if isinstance(m, ExecutionBudgetMiddleware)]
        assert budget_mw[0].recursion_limit == 100

    @patch("graphton.core.interrupt_proxy.create_agent")
    def test_none_recursion_limit_uses_default(self, mock_create_agent, mock_model, mock_tools):
        """Passing recursion_limit=None falls back to the default."""
        mock_graph = MagicMock()
        mock_graph.with_config = MagicMock(return_value=mock_graph)
        mock_create_agent.return_value = mock_graph

        compile_subagent_with_proxy(
            model=mock_model,
            tools=mock_tools,
            system_prompt="test",
            name="test-sa",
            description="test sub-agent",
            recursion_limit=None,
        )

        mock_graph.with_config.assert_called_once_with(
            {"recursion_limit": _DEFAULT_SUB_AGENT_RECURSION_LIMIT},
        )
