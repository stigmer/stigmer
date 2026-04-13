"""Top-level Stigmer API client."""

from __future__ import annotations

from types import TracebackType

import grpc

from ._gen._client import GeneratedClient
from ._github import GitHubClient
from ._search import SearchClient
from ._transport import DEFAULT_TARGET, create_channel


class StigmerClient(GeneratedClient):
    """Stigmer API client.

    Extends the code-generated :class:`GeneratedClient` so every resource
    sub-client (agents, sessions, mcp_servers, oauthapps, …) is inherited
    automatically — new resource clients added by codegen appear on this
    class without manual wiring.

    On top of the generated resource clients, ``StigmerClient`` adds:

    - Configuration and gRPC channel setup
    - Cross-resource :attr:`search` client
    - :attr:`github` OAuth integration client

    Usage::

        client = StigmerClient("sk_live_abc123")
        agent = client.agents.get("agent-id")
        client.close()

    As a context manager::

        with StigmerClient("sk_live_abc123") as client:
            agent = client.agents.get("agent-id")
    """

    search: SearchClient
    github: GitHubClient

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_TARGET,
        insecure: bool = False,
    ) -> None:
        if not api_key:
            raise ValueError("stigmer: API key is required")

        self._channel = create_channel(base_url, api_key, insecure=insecure)
        super().__init__(self._channel)

        self.search = SearchClient(self._channel)
        self.github = GitHubClient(self._channel)

    def close(self) -> None:
        """Release the underlying gRPC channel."""
        if self._channel is not None:
            self._channel.close()

    def __enter__(self) -> StigmerClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()
