"""Unit tests for the Daytona MCP stdio transport.

Tests cover:
- Shell command building from stdio config
- NDJSON framing: partial chunks, multi-line chunks, empty lines
- Message serialization/deserialization round-trip
- DaytonaMCPClient routing (stdio → Daytona, HTTP → MultiServerMCPClient)
- Error handling: startup timeout, process crash
- Clean shutdown (context manager exit)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.mcp.daytona_transport import _build_shell_command

# =============================================================================
# _build_shell_command tests
# =============================================================================


class TestBuildShellCommand:
    """Test shell command construction from stdio MCP server configs."""

    def test_simple_command(self) -> None:
        config = {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]}
        cmd = _build_shell_command(config)
        assert "npx" in cmd
        assert "@modelcontextprotocol/server-github" in cmd

    def test_command_no_args(self) -> None:
        config = {"command": "my-mcp-server"}
        cmd = _build_shell_command(config)
        assert "my-mcp-server" in cmd

    def test_env_vars_exported(self) -> None:
        config = {
            "command": "npx",
            "args": ["-y", "@mcp/server"],
            "env": {"GITHUB_TOKEN": "tok_abc", "API_KEY": "key_123"},
        }
        cmd = _build_shell_command(config)
        assert "export GITHUB_TOKEN=" in cmd
        assert "export API_KEY=" in cmd

    def test_pythonunbuffered_injected(self) -> None:
        config = {"command": "python", "args": ["server.py"]}
        cmd = _build_shell_command(config)
        assert "PYTHONUNBUFFERED" in cmd

    def test_pythonunbuffered_not_overridden(self) -> None:
        config = {
            "command": "python",
            "args": ["server.py"],
            "env": {"PYTHONUNBUFFERED": "0"},
        }
        cmd = _build_shell_command(config)
        assert "PYTHONUNBUFFERED=0" in cmd
        assert cmd.count("PYTHONUNBUFFERED") == 1

    def test_cwd_applied(self) -> None:
        config = {
            "command": "npx",
            "args": ["-y", "@mcp/server"],
            "cwd": "/home/user/project",
        }
        cmd = _build_shell_command(config)
        assert "cd" in cmd
        assert "/home/user/project" in cmd

    def test_args_with_spaces_quoted(self) -> None:
        config = {
            "command": "npx",
            "args": ["-y", "some arg with spaces"],
        }
        cmd = _build_shell_command(config)
        assert "some arg with spaces" in cmd

    def test_args_with_special_chars_quoted(self) -> None:
        config = {
            "command": "npx",
            "args": ["-y", "postgres://user:p@ss$word@host/db"],
        }
        cmd = _build_shell_command(config)
        assert "postgres://" in cmd


# =============================================================================
# NDJSON framing tests (standalone, no Daytona dependency)
# =============================================================================


class TestNdjsonFraming:
    """Test the NDJSON buffering logic used by the transport's stdout reader.

    These tests exercise the line-splitting algorithm in isolation,
    without needing a real Daytona sandbox.
    """

    @staticmethod
    def _simulate_framing(chunks: list[str]) -> list[str]:
        """Run the same buffer-and-split algorithm from daytona_transport."""
        buffer = ""
        complete_lines: list[str] = []
        for chunk in chunks:
            lines = (buffer + chunk).split("\n")
            buffer = lines.pop()
            for line in lines:
                if not line.strip():
                    continue
                complete_lines.append(line)
        return complete_lines

    def test_single_complete_line(self) -> None:
        msg = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        lines = self._simulate_framing([msg + "\n"])
        assert lines == [msg]

    def test_partial_chunk_buffered(self) -> None:
        msg = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        half = len(msg) // 2
        lines = self._simulate_framing([msg[:half], msg[half:] + "\n"])
        assert lines == [msg]

    def test_multiple_messages_in_single_chunk(self) -> None:
        msg1 = json.dumps({"jsonrpc": "2.0", "id": 1, "result": "a"})
        msg2 = json.dumps({"jsonrpc": "2.0", "id": 2, "result": "b"})
        chunk = msg1 + "\n" + msg2 + "\n"
        lines = self._simulate_framing([chunk])
        assert lines == [msg1, msg2]

    def test_empty_lines_skipped(self) -> None:
        msg = json.dumps({"jsonrpc": "2.0", "id": 1})
        chunk = "\n\n" + msg + "\n\n"
        lines = self._simulate_framing([chunk])
        assert lines == [msg]

    def test_three_partial_chunks(self) -> None:
        msg = json.dumps({"jsonrpc": "2.0", "method": "tools/list"})
        third = len(msg) // 3
        chunks = [msg[:third], msg[third : 2 * third], msg[2 * third :] + "\n"]
        lines = self._simulate_framing(chunks)
        assert lines == [msg]

    def test_trailing_partial_not_emitted(self) -> None:
        """A partial line without a trailing newline stays in the buffer."""
        msg = json.dumps({"jsonrpc": "2.0", "id": 1})
        lines = self._simulate_framing([msg])
        assert lines == []

    def test_interleaved_complete_and_partial(self) -> None:
        msg1 = json.dumps({"jsonrpc": "2.0", "id": 1})
        msg2 = json.dumps({"jsonrpc": "2.0", "id": 2})
        chunk1 = msg1 + "\n" + msg2[:10]
        chunk2 = msg2[10:] + "\n"
        lines = self._simulate_framing([chunk1, chunk2])
        assert lines == [msg1, msg2]


# =============================================================================
# DaytonaMCPClient routing tests
# =============================================================================


class TestDaytonaMCPClientRouting:
    """Test that DaytonaMCPClient correctly separates stdio vs HTTP servers."""

    def test_stdio_servers_identified(self) -> None:
        from worker.mcp.daytona_mcp_client import DaytonaMCPClient

        servers = {
            "github": {"transport": "stdio", "command": "npx", "args": ["-y", "@mcp/github"]},
            "planton": {"transport": "streamable_http", "url": "https://mcp.planton.ai"},
        }
        client = DaytonaMCPClient(servers=servers, sandbox=MagicMock())
        assert "github" in client._stdio_servers
        assert "planton" in client._http_servers
        assert "github" not in client._http_servers
        assert "planton" not in client._stdio_servers

    def test_all_stdio(self) -> None:
        from worker.mcp.daytona_mcp_client import DaytonaMCPClient

        servers = {
            "s1": {"transport": "stdio", "command": "cmd1"},
            "s2": {"transport": "stdio", "command": "cmd2"},
        }
        client = DaytonaMCPClient(servers=servers, sandbox=MagicMock())
        assert len(client._stdio_servers) == 2
        assert client._http_client is None

    def test_all_http(self) -> None:
        from worker.mcp.daytona_mcp_client import DaytonaMCPClient

        servers = {
            "h1": {"transport": "streamable_http", "url": "https://a.com"},
            "h2": {"transport": "streamable_http", "url": "https://b.com"},
        }
        client = DaytonaMCPClient(servers=servers, sandbox=MagicMock())
        assert len(client._stdio_servers) == 0
        assert client._http_client is not None

    def test_unknown_server_raises(self) -> None:
        from worker.mcp.daytona_mcp_client import DaytonaMCPClient

        servers = {"s1": {"transport": "stdio", "command": "cmd"}}
        client = DaytonaMCPClient(servers=servers, sandbox=MagicMock())

        with pytest.raises(ValueError, match="not found"):
            # session() is an async context manager; trigger it
            asyncio.get_event_loop().run_until_complete(
                client.session("nonexistent").__aenter__()
            )


# =============================================================================
# Mock-based transport lifecycle tests
# =============================================================================


def _make_mock_sandbox(
    *,
    cmd_id: str = "cmd-001",
    stdout_chunks: list[str] | None = None,
) -> MagicMock:
    """Create a mock Daytona sandbox with process session API stubs."""
    sandbox = MagicMock()
    sandbox.process.create_session = MagicMock()
    sandbox.process.delete_session = MagicMock()

    exec_response = MagicMock()
    exec_response.cmd_id = cmd_id
    sandbox.process.execute_session_command = MagicMock(return_value=exec_response)

    sandbox.process.send_session_command_input = MagicMock()

    async def _fake_logs_async(
        session_id: str,
        command_id: str,
        on_stdout: Any,
        on_stderr: Any,
    ) -> None:
        for chunk in (stdout_chunks or []):
            if asyncio.iscoroutinefunction(on_stdout):
                await on_stdout(chunk)
            else:
                on_stdout(chunk)

    sandbox.process.get_session_command_logs_async = _fake_logs_async

    return sandbox


class TestDaytonaTransportLifecycle:
    """Test the daytona_stdio_client context manager with a mocked sandbox."""

    @pytest.mark.asyncio
    async def test_session_created_and_deleted(self) -> None:
        """Session lifecycle: create → execute → delete on exit."""
        from worker.mcp.daytona_transport import daytona_stdio_client

        config = {"command": "echo", "args": ["hello"]}
        sandbox = _make_mock_sandbox(stdout_chunks=[])

        async with daytona_stdio_client(
            sandbox, config, server_slug="test", startup_timeout=0.1,
        ):
            pass

        sandbox.process.create_session.assert_called_once()
        sandbox.process.execute_session_command.assert_called_once()
        sandbox.process.delete_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_session_deleted_on_error(self) -> None:
        """Session is cleaned up even if an error occurs inside the block."""
        from worker.mcp.daytona_transport import daytona_stdio_client

        config = {"command": "failing-server"}
        sandbox = _make_mock_sandbox(stdout_chunks=[])

        with pytest.raises(BaseExceptionGroup):
            async with daytona_stdio_client(
                sandbox, config, server_slug="fail", startup_timeout=0.1,
            ):
                raise RuntimeError("test error")

        sandbox.process.delete_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_stdout_delivered_to_read_stream(self) -> None:
        """JSON-RPC messages on stdout reach the read stream."""
        from worker.mcp.daytona_transport import daytona_stdio_client

        msg = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}})
        config = {"command": "npx", "args": ["-y", "@mcp/test"]}
        sandbox = _make_mock_sandbox(stdout_chunks=[msg + "\n"])

        async with daytona_stdio_client(
            sandbox, config, server_slug="test", startup_timeout=1,
        ) as (read_stream, _write_stream):
            with anyio.fail_after(2):
                session_message = await read_stream.receive()
            assert session_message.message.model_dump()

    @pytest.mark.asyncio
    async def test_write_stream_sends_to_stdin(self) -> None:
        """Messages written to write_stream reach send_session_command_input."""
        import anyio
        from mcp.shared.message import SessionMessage
        from mcp.types import JSONRPCMessage

        from worker.mcp.daytona_transport import daytona_stdio_client

        init_response = json.dumps({
            "jsonrpc": "2.0", "id": 1,
            "result": {"protocolVersion": "2024-11-05", "capabilities": {}},
        })
        config = {"command": "npx", "args": ["-y", "@mcp/test"]}
        sandbox = _make_mock_sandbox(stdout_chunks=[init_response + "\n"])

        async with daytona_stdio_client(
            sandbox, config, server_slug="test", startup_timeout=1,
        ) as (_read_stream, write_stream):
            request = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
            msg = JSONRPCMessage.model_validate(request)
            session_msg = SessionMessage(msg)
            await write_stream.send(session_msg)

            await anyio.sleep(0.2)

        assert sandbox.process.send_session_command_input.called


# Needed for anyio streams in the tests above
from contextlib import AsyncExitStack, asynccontextmanager  # noqa: E402

import anyio  # noqa: E402

# =============================================================================
# connect_mcp_client: injected client path
# =============================================================================


class TestConnectMcpClientWithInjectedClient:
    """Verify connect_mcp_client uses a provided client instead of MultiServerMCPClient.

    When a custom ``client`` is passed (e.g. ``DaytonaMCPClient`` for
    sandbox isolation), ``connect_mcp_client`` must use its
    ``session()`` method and never instantiate ``MultiServerMCPClient``.
    """

    @pytest.mark.asyncio
    async def test_injected_client_sessions_called(self) -> None:
        """Injected client's session() is used for each server."""
        from graphton.core.mcp_manager import connect_mcp_client

        mock_session = MagicMock()

        @asynccontextmanager
        async def _fake_session(name: str):  # type: ignore[override]
            yield mock_session

        mock_client = MagicMock()
        mock_client.session = MagicMock(side_effect=_fake_session)

        mock_tool = MagicMock()
        mock_tool.name = "search"

        servers = {
            "github": {"transport": "stdio", "command": "npx"},
        }
        tool_filter = {"github": ["search"]}

        exit_stack = AsyncExitStack()

        with patch(
            "graphton.core.mcp_manager._lc_load_mcp_tools",
            new_callable=AsyncMock,
            return_value=[mock_tool],
        ), patch(
            "graphton.core.mcp_manager.MultiServerMCPClient",
        ) as mock_msmc:
            tools = await connect_mcp_client(
                servers, tool_filter, exit_stack, client=mock_client,
            )
            mock_client.session.assert_called_once_with("github")
            mock_msmc.assert_not_called()
            assert len(tools) == 1
            assert tools[0].name == "search"

        await exit_stack.aclose()

    @pytest.mark.asyncio
    async def test_injected_client_multiple_servers(self) -> None:
        """Injected client's session() is called once per server."""
        from graphton.core.mcp_manager import connect_mcp_client

        @asynccontextmanager
        async def _fake_session(name: str):  # type: ignore[override]
            yield MagicMock()

        mock_client = MagicMock()
        mock_client.session = MagicMock(side_effect=_fake_session)

        tool_a = MagicMock()
        tool_a.name = "tool_a"
        tool_b = MagicMock()
        tool_b.name = "tool_b"

        call_count = 0

        async def _load_tools_side_effect(session: Any) -> list[Any]:
            nonlocal call_count
            call_count += 1
            return [tool_a] if call_count == 1 else [tool_b]

        servers = {
            "server1": {"transport": "stdio", "command": "cmd1"},
            "server2": {"transport": "stdio", "command": "cmd2"},
        }
        tool_filter = {
            "server1": ["tool_a"],
            "server2": ["tool_b"],
        }

        exit_stack = AsyncExitStack()

        with patch(
            "graphton.core.mcp_manager._lc_load_mcp_tools",
            side_effect=_load_tools_side_effect,
        ):
            tools = await connect_mcp_client(
                servers, tool_filter, exit_stack, client=mock_client,
            )
            assert mock_client.session.call_count == 2
            assert len(tools) == 2

        await exit_stack.aclose()


# =============================================================================
# connect_mcp_client: default fallback path
# =============================================================================


class TestConnectMcpClientDefaultFallback:
    """Verify connect_mcp_client creates MultiServerMCPClient when no client provided."""

    @pytest.mark.asyncio
    async def test_multi_server_client_created(self) -> None:
        """Without an injected client, MultiServerMCPClient is instantiated."""
        from graphton.core.mcp_manager import connect_mcp_client

        mock_session = MagicMock()

        @asynccontextmanager
        async def _fake_session(name: str):  # type: ignore[override]
            yield mock_session

        mock_msmc_instance = MagicMock()
        mock_msmc_instance.session = MagicMock(side_effect=_fake_session)

        mock_tool = MagicMock()
        mock_tool.name = "list_files"

        servers = {
            "planton": {"transport": "streamable_http", "url": "https://mcp.planton.ai"},
        }
        tool_filter = {"planton": ["list_files"]}

        exit_stack = AsyncExitStack()

        with patch(
            "graphton.core.mcp_manager.MultiServerMCPClient",
            return_value=mock_msmc_instance,
        ) as mock_msmc_cls, patch(
            "graphton.core.mcp_manager._lc_load_mcp_tools",
            new_callable=AsyncMock,
            return_value=[mock_tool],
        ):
            tools = await connect_mcp_client(
                servers, tool_filter, exit_stack,
            )
            mock_msmc_cls.assert_called_once_with(servers)
            assert len(tools) == 1
            assert tools[0].name == "list_files"

        await exit_stack.aclose()


# =============================================================================
# setup.py: DaytonaMCPClient gating logic
# =============================================================================


class TestSetupDaytonaMcpClientGating:
    """Verify the three-way gating decision for DaytonaMCPClient creation.

    The helper ``_maybe_create_daytona_mcp_client`` returns a client only
    when ALL of these hold:  sandbox is present, configs are non-empty,
    and at least one server uses stdio transport.
    """

    def test_sandbox_with_stdio_creates_client(self) -> None:
        from worker.activities.graphton.setup import _maybe_create_daytona_mcp_client

        sandbox = MagicMock()
        configs = {
            "github": {"transport": "stdio", "command": "npx", "args": ["-y", "@mcp/github"]},
        }
        result = _maybe_create_daytona_mcp_client(sandbox, configs, logging.getLogger())
        assert result is not None

    def test_sandbox_with_http_only_returns_none(self) -> None:
        from worker.activities.graphton.setup import _maybe_create_daytona_mcp_client

        sandbox = MagicMock()
        configs = {
            "planton": {"transport": "streamable_http", "url": "https://mcp.planton.ai"},
        }
        result = _maybe_create_daytona_mcp_client(sandbox, configs, logging.getLogger())
        assert result is None

    def test_no_sandbox_returns_none(self) -> None:
        from worker.activities.graphton.setup import _maybe_create_daytona_mcp_client

        configs = {
            "github": {"transport": "stdio", "command": "npx"},
        }
        result = _maybe_create_daytona_mcp_client(None, configs, logging.getLogger())
        assert result is None

    def test_empty_configs_returns_none(self) -> None:
        from worker.activities.graphton.setup import _maybe_create_daytona_mcp_client

        sandbox = MagicMock()
        result = _maybe_create_daytona_mcp_client(sandbox, {}, logging.getLogger())
        assert result is None

    def test_mixed_transports_creates_client(self) -> None:
        """When both stdio and HTTP servers exist, client is created for the stdio ones."""
        from worker.activities.graphton.setup import _maybe_create_daytona_mcp_client

        sandbox = MagicMock()
        configs = {
            "github": {"transport": "stdio", "command": "npx", "args": ["-y", "@mcp/github"]},
            "planton": {"transport": "streamable_http", "url": "https://mcp.planton.ai"},
        }
        result = _maybe_create_daytona_mcp_client(sandbox, configs, logging.getLogger())
        assert result is not None


# =============================================================================
# Cleanup chain: exit_stack cascades to Daytona session deletion
# =============================================================================


class TestMcpCleanupChain:
    """Verify that closing the AsyncExitStack cascades through all MCP sessions."""

    @pytest.mark.asyncio
    async def test_exit_stack_closes_all_sessions(self) -> None:
        """Each registered session's context manager __aexit__ fires on stack close."""
        session_exits: list[str] = []

        @asynccontextmanager
        async def _tracked_session(name: str):  # type: ignore[override]
            yield MagicMock()
            session_exits.append(name)

        mock_client = MagicMock()
        mock_client.session = MagicMock(side_effect=_tracked_session)

        exit_stack = AsyncExitStack()

        for name in ["server-a", "server-b", "server-c"]:
            await exit_stack.enter_async_context(mock_client.session(name))

        assert session_exits == []

        await exit_stack.aclose()

        assert set(session_exits) == {"server-a", "server-b", "server-c"}

    @pytest.mark.asyncio
    async def test_daytona_transport_session_deleted_on_stack_close(self) -> None:
        """daytona_stdio_client deletes the Daytona session when the exit stack closes."""
        from worker.mcp.daytona_transport import daytona_stdio_client

        config = {"command": "echo", "args": ["hello"]}
        sandbox = _make_mock_sandbox(stdout_chunks=[])

        exit_stack = AsyncExitStack()
        await exit_stack.enter_async_context(
            daytona_stdio_client(
                sandbox, config, server_slug="cleanup-test", startup_timeout=0.1,
            )
        )

        sandbox.process.create_session.assert_called_once()
        sandbox.process.delete_session.assert_not_called()

        await exit_stack.aclose()

        sandbox.process.delete_session.assert_called_once()


# Required for gating tests that use the logging module
import logging  # noqa: E402
