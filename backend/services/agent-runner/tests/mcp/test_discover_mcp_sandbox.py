"""Unit tests for sandbox-aware MCP discovery.

Tests cover:
- _maybe_create_discovery_sandbox gating logic (local/cloud x stdio/HTTP)
- _connect_and_discover client routing (DaytonaMCPClient vs MultiServerMCPClient)
- Ephemeral sandbox cleanup (success and error paths)
- Workflow timeout budget values
"""

from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# _maybe_create_discovery_sandbox gating tests
# =============================================================================


class TestMaybeCreateDiscoverySandbox:
    """Verify the three-way gating decision for ephemeral discovery sandbox.

    1. Local/OSS mode -> (None, None) regardless of transport
    2. Cloud mode + HTTP -> (None, None) -- no sandbox needed
    3. Cloud mode + stdio -> create sandbox via SandboxManager
    """

    @pytest.mark.asyncio
    async def test_local_mode_returns_none(self) -> None:
        from worker.activities.discover_mcp_server import _maybe_create_discovery_sandbox

        mock_config = MagicMock()
        mock_config.is_local_mode.return_value = True

        with patch("worker.config.Config.load_from_env", return_value=mock_config):
            result = await _maybe_create_discovery_sandbox(
                config={"transport": "stdio", "command": "npx"},
            )
            assert result == (None, None)

    @pytest.mark.asyncio
    async def test_cloud_http_returns_none(self) -> None:
        from worker.activities.discover_mcp_server import _maybe_create_discovery_sandbox

        mock_config = MagicMock()
        mock_config.is_local_mode.return_value = False

        with patch("worker.config.Config.load_from_env", return_value=mock_config):
            result = await _maybe_create_discovery_sandbox(
                config={"transport": "streamable_http", "url": "https://mcp.example.com"},
            )
            assert result == (None, None)

    @pytest.mark.asyncio
    async def test_cloud_stdio_creates_sandbox(self) -> None:
        from worker.activities.discover_mcp_server import _maybe_create_discovery_sandbox

        mock_config = MagicMock()
        mock_config.is_local_mode.return_value = False
        mock_config.get_sandbox_config.return_value = {"type": "daytona"}

        mock_sandbox = MagicMock()
        mock_sandbox.id = "sb-discovery-001"
        mock_manager = AsyncMock()
        mock_manager.get_or_create_daytona_sandbox = AsyncMock(
            return_value=(mock_sandbox, True),
        )

        with patch(
            "worker.config.Config.load_from_env",
            return_value=mock_config,
        ), patch.dict(
            "os.environ",
            {"DAYTONA_API_KEY": "test-key"},
        ), patch(
            "worker.sandbox_manager.SandboxManager",
            return_value=mock_manager,
        ):
            sandbox, manager = await _maybe_create_discovery_sandbox(
                config={"transport": "stdio", "command": "npx", "args": ["-y", "@mcp/github"]},
                heartbeat_fn=MagicMock(),
            )

            assert sandbox is mock_sandbox
            assert manager is mock_manager
            mock_manager.get_or_create_daytona_sandbox.assert_awaited_once()

            call_kwargs = mock_manager.get_or_create_daytona_sandbox.call_args
            assert call_kwargs.kwargs["session_id"] is None
            assert call_kwargs.kwargs["session_client"] is None

    @pytest.mark.asyncio
    async def test_cloud_stdio_missing_api_key_raises(self) -> None:
        from worker.activities.discover_mcp_server import _maybe_create_discovery_sandbox

        mock_config = MagicMock()
        mock_config.is_local_mode.return_value = False

        with patch(
            "worker.config.Config.load_from_env",
            return_value=mock_config,
        ), patch.dict(
            "os.environ",
            {"DAYTONA_API_KEY": ""},
            clear=False,
        ):
            import os
            orig = os.environ.get("DAYTONA_API_KEY")
            os.environ.pop("DAYTONA_API_KEY", None)
            try:
                with pytest.raises(RuntimeError, match="DAYTONA_API_KEY"):
                    await _maybe_create_discovery_sandbox(
                        config={"transport": "stdio", "command": "npx"},
                    )
            finally:
                if orig is not None:
                    os.environ["DAYTONA_API_KEY"] = orig

    @pytest.mark.asyncio
    async def test_local_mode_stdio_no_sandbox_manager_created(self) -> None:
        """Local mode never creates a SandboxManager, even for stdio servers."""
        from worker.activities.discover_mcp_server import _maybe_create_discovery_sandbox

        mock_config = MagicMock()
        mock_config.is_local_mode.return_value = True

        with patch(
            "worker.config.Config.load_from_env",
            return_value=mock_config,
        ), patch(
            "worker.sandbox_manager.SandboxManager",
        ) as mock_sm_cls:
            result = await _maybe_create_discovery_sandbox(
                config={"transport": "stdio", "command": "npx"},
            )
            assert result == (None, None)
            mock_sm_cls.assert_not_called()


# =============================================================================
# _connect_and_discover client routing tests
# =============================================================================


def _make_mock_session(
    *,
    tools: list[dict[str, Any]] | None = None,
    supports_resources: bool = False,
) -> MagicMock:
    """Create a mock MCP ClientSession with list_tools / list_resource_templates."""
    session = MagicMock()

    mock_tools = []
    for t in (tools or []):
        mock_tool = MagicMock()
        mock_tool.name = t["name"]
        mock_tool.description = t.get("description", "")
        mock_tool.inputSchema = t.get("input_schema")
        mock_tools.append(mock_tool)

    tools_result = MagicMock()
    tools_result.tools = mock_tools
    session.list_tools = AsyncMock(return_value=tools_result)

    if supports_resources:
        init_result = MagicMock()
        init_result.capabilities.resources = True
        session.initialize_result = init_result
        templates_result = MagicMock()
        templates_result.resourceTemplates = []
        session.list_resource_templates = AsyncMock(return_value=templates_result)
    else:
        session.initialize_result = None

    return session


class TestConnectAndDiscoverClientRouting:
    """Verify _connect_and_discover selects the right client based on sandbox."""

    @pytest.mark.asyncio
    async def test_sandbox_stdio_uses_daytona_client(self) -> None:
        from worker.activities.discover_mcp_server import _connect_and_discover

        mock_session = _make_mock_session(tools=[{"name": "search"}])
        mock_sandbox = MagicMock()

        @asynccontextmanager
        async def _fake_session(name: str):
            yield mock_session

        with patch(
            "worker.mcp.daytona_mcp_client.DaytonaMCPClient",
        ) as mock_daytona_cls, patch(
            "langchain_mcp_adapters.client.MultiServerMCPClient",
        ) as mock_msmc_cls:
            mock_daytona_instance = MagicMock()
            mock_daytona_instance.session = MagicMock(side_effect=_fake_session)
            mock_daytona_cls.return_value = mock_daytona_instance

            tools, templates = await _connect_and_discover(
                "github",
                {"transport": "stdio", "command": "npx"},
                sandbox=mock_sandbox,
            )

            mock_daytona_cls.assert_called_once()
            mock_msmc_cls.assert_not_called()
            assert len(tools) == 1
            assert tools[0].name == "search"

    @pytest.mark.asyncio
    async def test_no_sandbox_uses_multi_server_client(self) -> None:
        from worker.activities.discover_mcp_server import _connect_and_discover

        mock_session = _make_mock_session(tools=[{"name": "list_files"}])

        @asynccontextmanager
        async def _fake_session(name: str):
            yield mock_session

        with patch(
            "langchain_mcp_adapters.client.MultiServerMCPClient",
        ) as mock_msmc_cls:
            mock_msmc_instance = MagicMock()
            mock_msmc_instance.session = MagicMock(side_effect=_fake_session)
            mock_msmc_cls.return_value = mock_msmc_instance

            tools, templates = await _connect_and_discover(
                "planton",
                {"transport": "stdio", "command": "npx"},
                sandbox=None,
            )

            mock_msmc_cls.assert_called_once()
            assert len(tools) == 1
            assert tools[0].name == "list_files"

    @pytest.mark.asyncio
    async def test_http_transport_ignores_sandbox(self) -> None:
        """HTTP transport always uses MultiServerMCPClient, even when sandbox is set."""
        from worker.activities.discover_mcp_server import _connect_and_discover

        mock_session = _make_mock_session(tools=[{"name": "deploy"}])

        @asynccontextmanager
        async def _fake_session(name: str):
            yield mock_session

        with patch(
            "worker.mcp.daytona_mcp_client.DaytonaMCPClient",
        ) as mock_daytona_cls, patch(
            "langchain_mcp_adapters.client.MultiServerMCPClient",
        ) as mock_msmc_cls:
            mock_msmc_instance = MagicMock()
            mock_msmc_instance.session = MagicMock(side_effect=_fake_session)
            mock_msmc_cls.return_value = mock_msmc_instance

            tools, templates = await _connect_and_discover(
                "remote-server",
                {"transport": "streamable_http", "url": "https://mcp.example.com"},
                sandbox=MagicMock(),
            )

            mock_msmc_cls.assert_called_once()
            mock_daytona_cls.assert_not_called()
            assert len(tools) == 1

    @pytest.mark.asyncio
    async def test_resource_templates_discovered(self) -> None:
        from worker.activities.discover_mcp_server import _connect_and_discover

        mock_session = _make_mock_session(
            tools=[{"name": "query"}],
            supports_resources=True,
        )

        @asynccontextmanager
        async def _fake_session(name: str):
            yield mock_session

        with patch(
            "langchain_mcp_adapters.client.MultiServerMCPClient",
        ) as mock_msmc_cls:
            mock_msmc_instance = MagicMock()
            mock_msmc_instance.session = MagicMock(side_effect=_fake_session)
            mock_msmc_cls.return_value = mock_msmc_instance

            tools, templates = await _connect_and_discover(
                "db-server",
                {"transport": "streamable_http", "url": "https://db.example.com"},
            )

            mock_session.list_resource_templates.assert_awaited_once()


# =============================================================================
# Ephemeral sandbox cleanup tests
# =============================================================================


class TestDiscoverySandboxCleanup:
    """Verify ephemeral sandbox is always cleaned up after discovery."""

    @pytest.mark.asyncio
    async def test_sandbox_deleted_on_success(self) -> None:
        from worker.activities.discover_mcp_server import _cleanup_discovery_sandbox

        mock_manager = AsyncMock()

        await _cleanup_discovery_sandbox(mock_manager, "sb-001")

        mock_manager.cleanup_daytona_sandbox.assert_awaited_once_with("sb-001")

    @pytest.mark.asyncio
    async def test_cleanup_called_even_on_discovery_error(self) -> None:
        """Simulate the finally block: cleanup runs even when discovery raises."""
        from worker.activities.discover_mcp_server import (
            _cleanup_discovery_sandbox,
            _connect_and_discover,
        )

        mock_manager = AsyncMock()
        sandbox_id = "sb-error-test"

        @asynccontextmanager
        async def _failing_session(name: str):
            raise ConnectionError("MCP server unreachable")
            yield  # pragma: no cover

        sandbox = MagicMock()
        cleanup_called = False

        try:
            with patch(
                "worker.mcp.daytona_mcp_client.DaytonaMCPClient",
            ) as mock_cls:
                mock_instance = MagicMock()
                mock_instance.session = MagicMock(side_effect=_failing_session)
                mock_cls.return_value = mock_instance

                await _connect_and_discover(
                    "broken-server",
                    {"transport": "stdio", "command": "broken"},
                    sandbox=sandbox,
                )
        except ConnectionError:
            pass
        finally:
            await _cleanup_discovery_sandbox(mock_manager, sandbox_id)
            cleanup_called = True

        assert cleanup_called
        mock_manager.cleanup_daytona_sandbox.assert_awaited_once_with(sandbox_id)


# =============================================================================
# Workflow timeout budget tests
# =============================================================================


class TestDiscoveryWorkflowTimeouts:
    """Verify workflow definitions use the correct timeout budgets.

    The discovery activity timeout must accommodate both sandbox creation
    (up to 180s) and MCP server initialization (270s).
    """

    def test_connect_workflow_discovery_timeout(self) -> None:
        """ConnectMcpServerWorkflow uses 600s start_to_close for discovery."""
        from worker.activities.discover_mcp_server import ConnectMcpServerWorkflow

        source = inspect.getsource(ConnectMcpServerWorkflow)

        assert "seconds=600" in source, "Expected start_to_close_timeout of 600s"
        assert "heartbeat_timeout" in source, "Expected heartbeat_timeout to be set"

    def test_legacy_workflow_discovery_timeout(self) -> None:
        """DiscoverMcpServerWorkflow uses 600s start_to_close for discovery."""
        from worker.activities.discover_mcp_server import DiscoverMcpServerWorkflow

        source = inspect.getsource(DiscoverMcpServerWorkflow)

        assert "seconds=600" in source, "Expected start_to_close_timeout of 600s"
        assert "heartbeat_timeout" in source, "Expected heartbeat_timeout to be set"
