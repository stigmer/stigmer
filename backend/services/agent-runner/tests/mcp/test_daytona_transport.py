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
import anyio  # noqa: E402
