"""Top-level Stigmer API client."""

from __future__ import annotations

import time
from typing import Iterable, Literal
from types import TracebackType

import grpc

from ._billing import BillingClient
from ._file import RoutedFileClient
from ._gen._client import GeneratedClient
from ._gen._run import RunConfigInput, SessionSpecInput
from ._github import GitHubClient
from ._runner_adapter import RunnerAdapter
from ._search import SearchClient
from ._skill import RoutedSkillClient
from ._tokens import TokenClient
from ._transport import DEFAULT_TARGET, create_channel
from ._turns import TurnOutcome, send_and_wait, wait_for_turn

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
    - :meth:`send_and_wait` and :meth:`wait_for_turn`: send a message and
      wait for the agent's answer

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

    def send_and_wait(
        self,
        *,
        org: str,
        message: str,
        session_id: str = "",
        session_spec: SessionSpecInput | None = None,
        name: str = "",
        run_config: RunConfigInput | None = None,
        file_ids: Iterable[str] = (),
        timeout: float | None = None,
    ) -> TurnOutcome:
        """Send a message as a new turn and wait for its answer.

        The turn runs in ``session_id``, or in a session bootstrapped from
        ``session_spec``: exactly one of them is required, and so is ``org``,
        the organization the turn runs in; both are checked before any call.
        An empty ``name`` becomes ``run-<epoch ms>``, as the console names
        its turns. For an existing session the log's newest place is read
        first, so the wait sees only this turn's events.

        Returns when the turn ends (``phase`` completed, failed, cancelled or
        terminated) or waits for a person's answer (``phase`` ``"waiting"``,
        with its ``asks``); answer each ask, then call :meth:`wait_for_turn`
        with the outcome's ``last_seq``. For a run field this call does not
        take, create the run with ``runs.create`` and call
        :meth:`wait_for_turn`.

        Raises:
            StigmerError: the server refused the run, or the stream with a
                code a reconnect cannot fix; or the input was invalid.
            TimeoutError: ``timeout`` seconds passed, reconnections included.
        """
        return send_and_wait(
            self._channel,
            self.runs,
            self.sessions,
            org=org,
            message=message,
            session_id=session_id,
            session_spec=session_spec,
            name=name,
            run_config=run_config,
            file_ids=file_ids,
            timeout=timeout,
        )

    def wait_for_turn(
        self,
        session_id: str,
        run_id: str,
        after_seq: int = 0,
        *,
        timeout: float | None = None,
    ) -> TurnOutcome:
        """Wait for one turn of a session: until it ends, or waits for an answer.

        ``after_seq`` is where in the log the turn's events begin, or later:
        pass a previous outcome's ``last_seq`` to resume after answering its
        asks, or 0 to read the whole log.

        Raises:
            StigmerError: the stream was refused with a code a reconnect
                cannot fix.
            TimeoutError: ``timeout`` seconds passed, reconnections included.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        return wait_for_turn(self._channel, session_id, run_id, after_seq, deadline=deadline)

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
