"""Top-level Stigmer API client."""

from __future__ import annotations

from typing import Literal
from types import TracebackType

import grpc

from ._gen._client import GeneratedClient
from ._github import GitHubClient
from ._runner_adapter import RunnerAdapter
from ._search import SearchClient
from ._transport import DEFAULT_TARGET, create_channel

ExecutionTargetOption = Literal["local", "cloud"]

_EXECUTION_TARGET_MAP = {
    "local": 1,   # EXECUTION_TARGET_LOCAL
    "cloud": 2,   # EXECUTION_TARGET_CLOUD
}


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

    With an app-level execution target::

        client = StigmerClient("sk_live_abc123", execution_target="local")
    """

    search: SearchClient
    github: GitHubClient
    default_execution_target: int
    runner_adapter: RunnerAdapter | None

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_TARGET,
        insecure: bool = False,
        execution_target: ExecutionTargetOption | None = None,
        runner_adapter: RunnerAdapter | None = None,
    ) -> None:
        """Create a Stigmer client.

        Args:
            api_key: Stigmer API key (``sk_live_...``).
            base_url: gRPC target address. Defaults to ``api.stigmer.ai:443``.
            insecure: Disable TLS (local development only).
            execution_target: Default execution target for all sessions
                created through this client. ``"local"`` means the client
                provides runners; ``"cloud"`` means the server provisions
                sandboxes. ``None`` lets the server decide.
            runner_adapter: Runner adapter for local execution lifecycle
                management. When ``execution_target`` is ``"local"``, the
                SDK calls adapter methods after session/execution creation
                and on terminal phase detection. Cloud consumers omit this.
        """
        if not api_key:
            raise ValueError("stigmer: API key is required")

        self._channel = create_channel(base_url, api_key, insecure=insecure)
        super().__init__(self._channel)

        self.default_execution_target = (
            _EXECUTION_TARGET_MAP[execution_target] if execution_target else 0
        )
        self.runner_adapter = runner_adapter
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
