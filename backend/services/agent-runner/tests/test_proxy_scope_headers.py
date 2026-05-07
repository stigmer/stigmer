"""Unit tests for proxy scope header plumbing (T07).

Covers:
- ``build_llm_kwargs`` with ``mcp_server_id`` parameter
- ``classify_tools`` forwarding ``mcp_server_id`` to ``build_llm_kwargs``
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stigmer_runner.worker.config import LLMConfig

# ---------------------------------------------------------------------------
# build_llm_kwargs — mcp_server_id header
# ---------------------------------------------------------------------------


class TestBuildLlmKwargsMcpServerId:
    """LLMConfig.build_llm_kwargs() X-Stigmer-Mcp-Server-Id support."""

    def _make_llm_config(self, provider: str = "openai") -> LLMConfig:
        return LLMConfig(
            provider=provider,
            model_name="gpt-4o-mini",
            api_key="sk-test",
        )

    def test_mcp_server_id_only(self):
        cfg = self._make_llm_config("openai")
        result = cfg.build_llm_kwargs(
            proxy_endpoint="https://api.stigmer.ai",
            proxy_auth_token="tok",
            mcp_server_id="mcp-abc-123",
        )
        assert result["default_headers"] == {
            "X-Stigmer-Mcp-Server-Id": "mcp-abc-123",
        }

    def test_execution_id_only(self):
        cfg = self._make_llm_config("openai")
        result = cfg.build_llm_kwargs(
            proxy_endpoint="https://api.stigmer.ai",
            proxy_auth_token="tok",
            execution_id="exec-456",
        )
        assert result["default_headers"] == {
            "X-Stigmer-Execution-Id": "exec-456",
        }

    def test_both_headers(self):
        cfg = self._make_llm_config("anthropic")
        result = cfg.build_llm_kwargs(
            proxy_endpoint="https://api.stigmer.ai",
            proxy_auth_token="tok",
            execution_id="exec-789",
            mcp_server_id="mcp-def-456",
        )
        headers = result["default_headers"]
        assert headers["X-Stigmer-Execution-Id"] == "exec-789"
        assert headers["X-Stigmer-Mcp-Server-Id"] == "mcp-def-456"

    def test_no_scope_headers_omits_default_headers_key(self):
        cfg = self._make_llm_config("openai")
        result = cfg.build_llm_kwargs(
            proxy_endpoint="https://api.stigmer.ai",
            proxy_auth_token="tok",
        )
        assert "default_headers" not in result

    def test_non_proxy_provider_ignores_mcp_server_id(self):
        cfg = self._make_llm_config("ollama")
        cfg.base_url = "http://localhost:11434"
        result = cfg.build_llm_kwargs(
            proxy_endpoint="https://api.stigmer.ai",
            proxy_auth_token="tok",
            mcp_server_id="mcp-ignored",
        )
        assert "default_headers" not in result

    def test_no_proxy_endpoint_ignores_mcp_server_id(self):
        cfg = self._make_llm_config("openai")
        result = cfg.build_llm_kwargs(
            mcp_server_id="mcp-ignored",
        )
        assert "default_headers" not in result


# ---------------------------------------------------------------------------
# classify_tools — mcp_server_id forwarded
# ---------------------------------------------------------------------------

# Stub transitive deps before importing classify module.
_CLASSIFY_STUBS: dict[str, MagicMock] = {}
for _mod in (
    "temporalio", "temporalio.activity", "temporalio.workflow",
    "temporalio.common", "grpc", "grpc.aio",
    "graphton.core", "graphton.core.models",
    "langchain_core", "langchain_core.messages",
    "stigmer_runner.worker.execution_tracker",
):
    if _mod not in sys.modules:
        _CLASSIFY_STUBS[_mod] = MagicMock()
sys.modules.update(_CLASSIFY_STUBS)

from stigmer_runner.worker.activities.classify_tool_approvals import (  # noqa: E402
    ClassifyToolApprovalsOutput,
    ToolApprovalClassification,
    classify_tools,
)


class TestClassifyToolsMcpServerIdForwarding:
    """classify_tools() passes mcp_server_id to build_llm_kwargs."""

    @pytest.mark.asyncio
    async def test_mcp_server_id_forwarded(self):
        captured_kwargs: dict = {}

        fake_config = MagicMock()
        fake_config.llm.model_name = "gpt-4o-mini"
        fake_config.stigmer_proxy_endpoint = "https://proxy"
        fake_config.stigmer_token = "tok"
        fake_config.llm.build_llm_kwargs = lambda **kw: (
            captured_kwargs.update(kw) or {"api_key": "fake"}
        )

        mock_model = MagicMock()
        mock_structured = MagicMock()
        mock_structured.ainvoke = AsyncMock(
            return_value=ClassifyToolApprovalsOutput(
                approvals=[
                    ToolApprovalClassification(
                        tool_name="search", requires_approval=False
                    )
                ]
            )
        )
        mock_model.with_structured_output = MagicMock(return_value=mock_structured)

        with (
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.Config.load_from_env",
                return_value=fake_config,
            ),
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.ModelRegistry.get_summarization_model",
                return_value="gpt-4o-mini",
            ),
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.parse_model_string",
                return_value=mock_model,
            ),
        ):
            await classify_tools(
                tools=[{"name": "search", "description": "Search code"}],
                server_name="test-server",
                server_description="",
                mcp_server_id="mcp-test-id",
            )

        assert captured_kwargs["mcp_server_id"] == "mcp-test-id"

    @pytest.mark.asyncio
    async def test_no_mcp_server_id_omits_from_kwargs(self):
        captured_kwargs: dict = {}

        fake_config = MagicMock()
        fake_config.llm.model_name = "gpt-4o-mini"
        fake_config.stigmer_proxy_endpoint = "https://proxy"
        fake_config.stigmer_token = "tok"
        fake_config.llm.build_llm_kwargs = lambda **kw: (
            captured_kwargs.update(kw) or {"api_key": "fake"}
        )

        mock_model = MagicMock()
        mock_structured = MagicMock()
        mock_structured.ainvoke = AsyncMock(
            return_value=ClassifyToolApprovalsOutput(approvals=[])
        )
        mock_model.with_structured_output = MagicMock(return_value=mock_structured)

        with (
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.Config.load_from_env",
                return_value=fake_config,
            ),
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.ModelRegistry.get_summarization_model",
                return_value="gpt-4o-mini",
            ),
            patch(
                "stigmer_runner.worker.activities.classify_tool_approvals.parse_model_string",
                return_value=mock_model,
            ),
        ):
            await classify_tools(
                tools=[{"name": "list", "description": "List items"}],
                server_name="test",
                server_description="",
            )

        assert captured_kwargs.get("mcp_server_id") is None

    @pytest.mark.asyncio
    async def test_empty_tools_skips_llm(self):
        result = await classify_tools(
            tools=[],
            server_name="empty",
            server_description="",
            mcp_server_id="mcp-123",
        )
        assert result.approvals == []
