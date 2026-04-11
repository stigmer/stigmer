"""Daytona-backed MCP stdio transport.

Mirrors ``mcp.client.stdio.stdio_client`` but runs the MCP server
process inside a Daytona sandbox, relaying stdin/stdout through the
Daytona session API instead of a local subprocess.

The transport yields the same ``(read_stream, write_stream)`` pair that
``stdio_client`` produces, so it can be used as a drop-in replacement
for constructing an ``mcp.ClientSession``.

Daytona session API mapping:

-  ``create_session``           → one-time session creation
-  ``execute_session_command``  → start MCP server with ``run_async=True``
-  ``get_session_command_logs_async`` → stream stdout via async callback
-  ``send_session_command_input``     → write JSON-RPC to stdin
-  ``delete_session``           → cleanup on teardown

NDJSON framing follows the same buffering strategy as the upstream
``mcp.client.stdio`` module: partial chunks are buffered and split on
newlines, each complete line is parsed as a ``JSONRPCMessage``.
"""

from __future__ import annotations

import logging
import shlex
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import json as _json

import anyio
import mcp.types as types
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from mcp.shared.message import SessionMessage

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)

_STARTUP_TIMEOUT_SECONDS = 60

# MCP methods that the *server* is allowed to send to the *client*.
# Any JSON-RPC request arriving on stdout with a method NOT in this set
# is almost certainly a Daytona stdin echo and should be dropped.
_SERVER_TO_CLIENT_METHODS = frozenset({
    "ping",
    "sampling/createMessage",
    "sampling/createMessageWithTools",
    "roots/list",
    "elicitation/create",
    "tasks/get",
    "tasks/result",
    "tasks/list",
    "tasks/cancel",
})


def _build_shell_command(config: dict[str, Any]) -> str:
    """Build a shell command string from a stdio MCP server config.

    Replicates the same env-export + cd pattern used by
    ``DaytonaWorkspaceBackend.execute``.
    """
    command = config["command"]
    args = config.get("args", [])

    parts = [command, *(shlex.quote(a) for a in args)]
    cmd = " ".join(parts)

    env: dict[str, str] = dict(config.get("env") or {})
    env.setdefault("PYTHONUNBUFFERED", "1")

    segments: list[str] = []
    if env:
        exports = "; ".join(
            f"export {k}={shlex.quote(v)}" for k, v in sorted(env.items())
        )
        segments.append(exports)

    cwd: str | None = config.get("cwd")
    if cwd:
        segments.append(f"cd {shlex.quote(cwd)}")

    segments.append(cmd)
    return "; ".join(segments)


@asynccontextmanager
async def daytona_stdio_client(
    sandbox: Any,
    server_config: dict[str, Any],
    *,
    server_slug: str = "",
    startup_timeout: float = _STARTUP_TIMEOUT_SECONDS,
) -> AsyncGenerator[
    tuple[
        MemoryObjectReceiveStream[SessionMessage | Exception],
        MemoryObjectSendStream[SessionMessage],
    ],
    None,
]:
    """Start an MCP server in a Daytona sandbox and relay stdio.

    This is the Daytona equivalent of ``mcp.client.stdio.stdio_client``.
    It creates a Daytona session, launches the MCP server process with
    ``run_async=True``, and bridges the Daytona log-streaming /
    stdin-input APIs to anyio memory object streams.

    Args:
        sandbox: A Daytona ``Sandbox`` instance (sync API).
        server_config: Stdio server config dict as produced by
            ``config_transformer._transform_stdio_config`` — must contain
            ``command`` and optionally ``args``, ``env``, ``cwd``.
        server_slug: Human-readable slug for log messages.
        startup_timeout: Seconds to wait for the MCP server process to
            start producing stdout before raising.

    Yields:
        ``(read_stream, write_stream)`` — same types as
        ``mcp.client.stdio.stdio_client``.
    """
    slug = server_slug or server_config.get("command", "unknown")
    session_id = f"mcp-{slug}-{uuid4().hex[:8]}"

    read_stream_writer: MemoryObjectSendStream[SessionMessage | Exception]
    read_stream: MemoryObjectReceiveStream[SessionMessage | Exception]
    write_stream: MemoryObjectSendStream[SessionMessage]
    write_stream_reader: MemoryObjectReceiveStream[SessionMessage]

    read_stream_writer, read_stream = anyio.create_memory_object_stream[
        SessionMessage | Exception
    ](0)
    write_stream, write_stream_reader = anyio.create_memory_object_stream[
        SessionMessage
    ](0)

    shell_cmd = _build_shell_command(server_config)
    logger.info(
        "Starting MCP server '%s' in Daytona session '%s': %s",
        slug, session_id, shell_cmd,
    )

    sandbox.process.create_session(session_id)

    try:
        from daytona import SessionExecuteRequest  # type: ignore[import-untyped]

        result = sandbox.process.execute_session_command(
            session_id,
            SessionExecuteRequest(command=shell_cmd, run_async=True),
        )
        cmd_id: str = result.cmd_id
        logger.info(
            "MCP server '%s' started (cmd_id=%s, session=%s)",
            slug, cmd_id, session_id,
        )

        # -- NDJSON stdout reader (Daytona callback → read stream) --------

        buffer = ""
        got_first_output = anyio.Event()
        stderr_lines: list[str] = []
        got_stdout = False

        async def _on_stdout(chunk: str) -> None:
            nonlocal buffer, got_stdout
            got_stdout = True
            if not got_first_output.is_set():
                got_first_output.set()

            lines = (buffer + chunk).split("\n")
            buffer = lines.pop()

            for line in lines:
                if not line.strip():
                    continue

                # Daytona sessions may echo stdin back to stdout.
                # Detect and drop echoed client-to-server requests so
                # the MCP client session doesn't receive its own
                # outgoing messages (which would fail validation and
                # could disrupt the session).
                try:
                    raw = _json.loads(line)
                except _json.JSONDecodeError:
                    pass
                else:
                    method = raw.get("method") if isinstance(raw, dict) else None
                    if (
                        method is not None
                        and "id" in raw
                        and method not in _SERVER_TO_CLIENT_METHODS
                    ):
                        logger.debug(
                            "MCP server '%s': dropped echoed client "
                            "request from stdout (method=%s)",
                            slug, method,
                        )
                        continue

                try:
                    message = types.JSONRPCMessage.model_validate_json(line)
                    session_message = SessionMessage(message)
                    await read_stream_writer.send(session_message)
                except Exception as exc:
                    logger.warning(
                        "MCP server '%s': failed to parse JSONRPC: %s",
                        slug, exc,
                    )
                    await read_stream_writer.send(exc)

        async def _on_stderr(chunk: str) -> None:
            if not got_first_output.is_set():
                got_first_output.set()
            for line in chunk.splitlines():
                stripped = line.strip()
                if stripped:
                    stderr_lines.append(stripped)
                    logger.warning("MCP server '%s' stderr: %s", slug, stripped)

        async def _stdout_reader() -> None:
            try:
                async with read_stream_writer:
                    await sandbox.process.get_session_command_logs_async(
                        session_id, cmd_id,
                        _on_stdout,
                        _on_stderr,
                    )
                    if not got_stdout and stderr_lines:
                        logger.error(
                            "MCP server '%s' exited without producing "
                            "stdout. stderr:\n  %s",
                            slug,
                            "\n  ".join(stderr_lines[-20:]),
                        )
            except anyio.ClosedResourceError:
                pass
            except Exception:
                logger.exception(
                    "MCP server '%s': stdout reader error", slug,
                )

        # -- Stdin writer (write stream → Daytona stdin) ------------------

        async def _stdin_writer() -> None:
            try:
                async with write_stream_reader:
                    async for session_message in write_stream_reader:
                        json_str = session_message.message.model_dump_json(
                            by_alias=True, exclude_none=True,
                        )
                        await anyio.to_thread.run_sync(
                            lambda data=json_str: (  # type: ignore[misc]
                                sandbox.process.send_session_command_input(
                                    session_id, cmd_id, data + "\n",
                                )
                            ),
                        )
            except anyio.ClosedResourceError:
                pass
            except Exception:
                stderr_context = (
                    "; stderr: " + " | ".join(stderr_lines[-5:])
                    if stderr_lines
                    else ""
                )
                logger.error(
                    "MCP server '%s': stdin write failed — process likely "
                    "exited%s",
                    slug,
                    stderr_context,
                    exc_info=True,
                )

        # -- Run transport tasks ------------------------------------------

        async with anyio.create_task_group() as tg:
            tg.start_soon(_stdout_reader)
            tg.start_soon(_stdin_writer)

            with anyio.move_on_after(startup_timeout) as cancel_scope:
                await got_first_output.wait()

            if cancel_scope.cancelled_caught:
                logger.warning(
                    "MCP server '%s' produced no output within %ss — "
                    "the process may have failed to start",
                    slug, startup_timeout,
                )

            try:
                yield read_stream, write_stream
            finally:
                tg.cancel_scope.cancel()

    finally:
        try:
            sandbox.process.delete_session(session_id)
            logger.debug(
                "Deleted Daytona MCP session '%s' for server '%s'",
                session_id, slug,
            )
        except Exception as exc:
            logger.warning(
                "Failed to delete Daytona MCP session '%s': %s",
                session_id, exc,
            )

        await read_stream.aclose()
        await write_stream.aclose()
