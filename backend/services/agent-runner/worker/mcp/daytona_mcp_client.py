"""MCP client that routes stdio servers through a Daytona sandbox.

``DaytonaMCPClient`` presents the same ``session(server_name)`` interface
as ``langchain_mcp_adapters.client.MultiServerMCPClient``, so it can be
used as a drop-in replacement in ``connect_mcp_client``.

Routing logic:

-  **stdio** servers  → started inside the Daytona sandbox via
   ``daytona_stdio_client``, providing security isolation.
-  **non-stdio** servers (streamable_http, etc.) → delegated to the
   standard ``MultiServerMCPClient`` which handles them natively.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from mcp.client.session import ClientSession

from worker.mcp.daytona_transport import daytona_stdio_client

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


class DaytonaMCPClient:
    """MCP client that isolates stdio servers in a Daytona sandbox.

    Construction splits the server configs by transport type.  When
    ``session()`` is called for a stdio server, the process is started
    inside the sandbox.  Non-stdio servers pass through to the standard
    ``MultiServerMCPClient``.

    This class is intentionally **not** a subclass of
    ``MultiServerMCPClient`` — it composes rather than inherits, keeping
    a clean boundary between Daytona-specific transport code and the
    upstream library.
    """

    def __init__(
        self,
        servers: dict[str, dict[str, Any]],
        sandbox: Any,
    ) -> None:
        self._servers = servers
        self._sandbox = sandbox

        self._stdio_servers: dict[str, dict[str, Any]] = {}
        self._http_servers: dict[str, dict[str, Any]] = {}

        for name, config in servers.items():
            if config.get("transport") == "stdio":
                self._stdio_servers[name] = config
            else:
                self._http_servers[name] = config

        self._http_client: MultiServerMCPClient | None = None
        if self._http_servers:
            from langchain_mcp_adapters.client import (
                MultiServerMCPClient as _MCPClient,  # type: ignore[import-untyped]
            )

            self._http_client = _MCPClient(self._http_servers)  # type: ignore[arg-type]

        logger.info(
            "DaytonaMCPClient: %d stdio server(s) via sandbox, "
            "%d HTTP server(s) via standard client — %s",
            len(self._stdio_servers),
            len(self._http_servers),
            list(servers.keys()),
        )

    @asynccontextmanager
    async def session(
        self, server_name: str,
    ) -> AsyncGenerator[ClientSession, None]:
        """Open a ``ClientSession`` for the named server.

        For stdio servers the process runs inside the Daytona sandbox.
        For non-stdio servers, delegates to ``MultiServerMCPClient``.
        """
        if server_name in self._stdio_servers:
            config = self._stdio_servers[server_name]
            async with daytona_stdio_client(
                self._sandbox, config, server_slug=server_name,
            ) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as mcp_session:
                    await mcp_session.initialize()
                    logger.info(
                        "MCP session initialized for sandbox stdio server '%s'",
                        server_name,
                    )
                    yield mcp_session

        elif self._http_client is not None and server_name in self._http_servers:
            async with self._http_client.session(server_name) as mcp_session:
                yield mcp_session

        else:
            raise ValueError(
                f"Server '{server_name}' not found. "
                f"Available: {sorted(self._servers.keys())}"
            )
