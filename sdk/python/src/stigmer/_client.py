"""Top-level Stigmer API client."""

from __future__ import annotations

from typing import Literal
from types import TracebackType

import grpc

from ._billing import BillingClient
from ._file import RoutedFileClient
from ._gen._client import GeneratedClient
from ._github import GitHubClient
from ._runner_adapter import RunnerAdapter
from ._search import SearchClient
from ._skill import RoutedSkillClient
from ._tokens import TokenClient
from ._transport import DEFAULT_TARGET, create_channel

ExecutionTargetOption = Literal["local", "cloud"]

_EXECUTION_TARGET_MAP = {
    "local": 1,   # EXECUTION_TARGET_LOCAL
    "cloud": 2,   # EXECUTION_TARGET_CLOUD
}


class StigmerClient(GeneratedClient):
    """Stigmer API client.

    Extends the code-generated :class:`GeneratedClient` so every resource
    sub-client (agents, sessions, plugins, oauthapps, …) is inherited
    automatically — new resource clients added by codegen appear on this
    class without manual wiring.

    On top of the generated resource clients, ``StigmerClient`` adds:

    - Configuration and gRPC channel setup
    - Cross-resource :attr:`search` client
    - :attr:`github` OAuth integration client
    - :attr:`billing` bounded-context client
    - :attr:`tokens` user-token minting client (service-account keys)

    Usage (keys read ``stk_…``)::

        client = StigmerClient(os.environ["STIGMER_API_KEY"])
        agent = client.agents.get("agent-id")
        client.close()

    As a context manager::

        with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
            agent = client.agents.get("agent-id")

    On your machine, against ``stigmer up`` (no key on a plain-text
    connection)::

        client = StigmerClient(base_url="localhost:7234", insecure=True)

    With an app-level execution target::

        client = StigmerClient(os.environ["STIGMER_API_KEY"], execution_target="local")
    """

    search: SearchClient
    github: GitHubClient
    billing: BillingClient
    tokens: TokenClient
    skills: RoutedSkillClient
    files: RoutedFileClient
    default_execution_target: int
    runner_adapter: RunnerAdapter | None

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_TARGET,
        insecure: bool = False,
        execution_target: ExecutionTargetOption | None = None,
        runner_adapter: RunnerAdapter | None = None,
    ) -> None:
        """Create a Stigmer client.

        Args:
            api_key: Stigmer API key (``stk_…``), sent as
                ``Authorization: Bearer <key>``. Required on a TLS
                connection; may be left out with ``insecure=True``, where
                the client sends no ``authorization`` header (a local
                server started by ``stigmer up`` needs none).
            base_url: gRPC target address. Defaults to ``api.stigmer.ai:443``.
            insecure: Disable TLS (local development only).
            execution_target: Default execution target for all sessions
                created through this client. ``"local"`` means the client
                provides runners; ``"cloud"`` means the server provisions
                sandboxes. ``None`` lets the server decide.
            runner_adapter: Runner adapter for local execution lifecycle
                management. When ``execution_target`` is ``"local"``, the
                adapter is driven when a session opens and closes.
                Cloud consumers omit this.
        """
        # The same rule as the Go SDK: only a plain-text connection, which
        # is a local server's, may go without a credential. An empty string
        # is a misconfiguration (an unset variable read as ""), never a
        # request for a keyless connection.
        if api_key is not None and not api_key:
            raise ValueError(
                "stigmer: API key is required: the key given is empty"
                " (leave it out only with insecure=True for a local server)"
            )
        if api_key is None and not insecure:
            raise ValueError(
                "stigmer: API key is required on a TLS connection: pass an"
                " API key, or insecure=True for a local server"
            )

        self._channel = create_channel(base_url, api_key, insecure=insecure)
        super().__init__(self._channel)

        self.default_execution_target = (
            _EXECUTION_TARGET_MAP[execution_target] if execution_target else 0
        )
        self.runner_adapter = runner_adapter
        self.search = SearchClient(self._channel)
        self.github = GitHubClient(self._channel)
        self.billing = BillingClient(self._channel)
        self.tokens = TokenClient(self._channel)
        # Shadow the inherited generated client with the size-routing wrapper
        # (stigmer#675): `client.skills.push` simply works for any valid
        # skill size — large artifacts ride the HTTP transfer lane.
        self.skills = RoutedSkillClient(self._channel)
        # The same for files: `client.files.upload_file` routes a file's
        # content by size, so a large file rides the same lane.
        self.files = RoutedFileClient(self._channel)

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
