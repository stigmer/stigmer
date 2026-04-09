"""Integration tests: Daytona MCP stdio relay.

Validates that the ``daytona_stdio_client`` transport can start a real
MCP server inside a Daytona sandbox and exchange JSON-RPC messages.

Skipped when ``DAYTONA_API_KEY`` is absent from the environment.

Usage:
    DAYTONA_API_KEY=dtn_... python -m pytest tests/integration/test_daytona_mcp_relay.py -v -s
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import pytest

logger = logging.getLogger(__name__)

_SKIP_DAYTONA = not os.environ.get("DAYTONA_API_KEY")


def _skip_reason() -> str:
    return "Requires DAYTONA_API_KEY env var"


try:
    from daytona import Daytona, DaytonaConfig

    from worker.mcp.daytona_mcp_client import DaytonaMCPClient
    from worker.mcp.daytona_transport import daytona_stdio_client
except ImportError:
    _SKIP_DAYTONA = True

    def _skip_reason() -> str:  # type: ignore[misc]
        return "daytona SDK or worker.mcp not installed"


def _create_daytona_client() -> Any:
    api_key = os.environ["DAYTONA_API_KEY"]
    return Daytona(DaytonaConfig(api_key=api_key))


def _wait_sandbox_ready(sandbox: Any, timeout: int = 180) -> None:
    """Poll until the sandbox responds to echo."""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        try:
            result = sandbox.process.exec("echo ready", timeout=10)
            if result.exit_code == 0:
                return
        except Exception:
            pass
        time.sleep(3)
    raise TimeoutError(f"Sandbox not ready after {timeout}s")


# ─────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def daytona_client():
    if _SKIP_DAYTONA:
        pytest.skip(_skip_reason())
    return _create_daytona_client()


@pytest.fixture(scope="module")
def sandbox(daytona_client):
    """Create a sandbox for the test module and delete it on teardown.

    Uses the basic sandbox image which has Node.js (npx) pre-installed.
    """
    logger.info("Creating Daytona sandbox for MCP relay integration tests...")
    sandbox = daytona_client.create()
    logger.info("Sandbox created: id=%s", sandbox.id)

    try:
        _wait_sandbox_ready(sandbox)
        logger.info("Sandbox is ready")
        yield sandbox
    finally:
        try:
            sandbox.delete()
            logger.info("Sandbox deleted: %s", sandbox.id)
        except Exception as exc:
            logger.warning("Failed to delete sandbox %s: %s", sandbox.id, exc)


# ─────────────────────────────────────────────────────────────────────
# Tests: daytona_stdio_client transport
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestDaytonaStdioTransport:
    """End-to-end transport tests with a real Daytona sandbox."""

    @pytest.mark.asyncio
    async def test_echo_server_roundtrip(self, sandbox: Any) -> None:
        """Verify basic stdin/stdout relay with a minimal echo process.

        Starts ``cat`` (echoes stdin to stdout) as a quick smoke test
        that the Daytona session API plumbing works end-to-end.
        """
        import anyio
        from mcp.shared.message import SessionMessage
        from mcp.types import JSONRPCMessage

        config = {"command": "cat"}

        async with daytona_stdio_client(
            sandbox, config, server_slug="echo-test", startup_timeout=30,
        ) as (read_stream, write_stream):
            request = {"jsonrpc": "2.0", "id": 1, "method": "test", "params": {}}
            msg = JSONRPCMessage.model_validate(request)
            await write_stream.send(SessionMessage(msg))

            with anyio.fail_after(15):
                response = await read_stream.receive()

            assert isinstance(response, SessionMessage)
            assert response.message.model_dump()["id"] == 1

    @pytest.mark.asyncio
    async def test_real_mcp_server_tool_discovery(self, sandbox: Any) -> None:
        """Start a real MCP server and discover its tools.

        Uses ``@modelcontextprotocol/server-everything`` which is a
        test MCP server that exposes a known set of tools.
        """
        from mcp.client.session import ClientSession

        config = {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"],
        }

        async with daytona_stdio_client(
            sandbox, config,
            server_slug="mcp-everything",
            startup_timeout=60,
        ) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                result = await session.list_tools()
                tool_names = [t.name for t in result.tools]

                logger.info(
                    "Discovered %d tools from server-everything: %s",
                    len(tool_names), tool_names,
                )

                assert len(tool_names) > 0, (
                    "server-everything should expose at least one tool"
                )


# ─────────────────────────────────────────────────────────────────────
# Tests: DaytonaMCPClient
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestDaytonaMCPClient:
    """End-to-end tests for the DaytonaMCPClient wrapper."""

    @pytest.mark.asyncio
    async def test_stdio_session_via_client(self, sandbox: Any) -> None:
        """DaytonaMCPClient.session() returns a working ClientSession."""
        servers = {
            "everything": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-everything"],
            },
        }
        client = DaytonaMCPClient(servers=servers, sandbox=sandbox)

        async with client.session("everything") as session:
            result = await session.list_tools()
            tool_names = [t.name for t in result.tools]
            logger.info(
                "DaytonaMCPClient session got %d tools: %s",
                len(tool_names), tool_names,
            )
            assert len(tool_names) > 0

    @pytest.mark.asyncio
    async def test_concurrent_sessions(self, sandbox: Any) -> None:
        """Multiple stdio servers can run concurrently in the same sandbox."""
        import asyncio

        servers = {
            "echo1": {"transport": "stdio", "command": "cat"},
            "echo2": {"transport": "stdio", "command": "cat"},
        }
        _client = DaytonaMCPClient(servers=servers, sandbox=sandbox)  # noqa: F841

        import anyio
        from mcp.shared.message import SessionMessage
        from mcp.types import JSONRPCMessage

        from worker.mcp.daytona_transport import daytona_stdio_client

        async def run_echo(slug: str, config: dict) -> bool:
            async with daytona_stdio_client(
                sandbox, config, server_slug=slug, startup_timeout=30,
            ) as (read_stream, write_stream):
                request = {
                    "jsonrpc": "2.0", "id": 1,
                    "method": "echo", "params": {"slug": slug},
                }
                msg = JSONRPCMessage.model_validate(request)
                await write_stream.send(SessionMessage(msg))

                with anyio.fail_after(15):
                    response = await read_stream.receive()
                return isinstance(response, SessionMessage)

        results = await asyncio.gather(
            run_echo("echo1", servers["echo1"]),
            run_echo("echo2", servers["echo2"]),
        )

        assert all(results), "Both concurrent sessions should succeed"
        logger.info("Concurrent MCP sessions both succeeded")


# ─────────────────────────────────────────────────────────────────────
# Tests: Session cleanup
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSessionCleanup:
    """Verify that Daytona sessions are properly cleaned up."""

    @pytest.mark.asyncio
    async def test_sessions_deleted_after_use(self, sandbox: Any) -> None:
        """Sessions created by the transport are deleted on exit."""
        sessions_before = sandbox.process.list_sessions()
        before_ids = {s.session_id for s in sessions_before}

        config = {"command": "cat"}
        async with daytona_stdio_client(
            sandbox, config, server_slug="cleanup-test", startup_timeout=30,
        ) as (_read, _write):
            sessions_during = sandbox.process.list_sessions()
            during_ids = {s.session_id for s in sessions_during}
            new_ids = during_ids - before_ids
            assert len(new_ids) >= 1, "Transport should create a session"

        sessions_after = sandbox.process.list_sessions()
        after_ids = {s.session_id for s in sessions_after}
        leaked = new_ids & after_ids
        assert len(leaked) == 0, (
            f"Sessions not cleaned up: {leaked}"
        )
