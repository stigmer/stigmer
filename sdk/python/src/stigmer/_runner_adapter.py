"""RunnerAdapter protocol for local execution lifecycle management.

When ``execution_target`` is ``"local"``, a consumer drives the adapter at
the appropriate lifecycle points. Cloud consumers do not provide an adapter.

Sessions and workflow executions have different lifecycles. A session is a
long-lived, multi-turn conversation with no terminal phase, so its worker is
tied to whether the session is open (in use): ``on_session_opened`` when the
session is opened, ``on_session_closed`` when it is closed. A workflow
execution runs to a terminal phase, so its worker is tied to creation and
completion.

Each environment provides its own implementation:

- Desktop app: wraps the embedded runner process
- CLI: wraps the daemon runner
- Customer self-hosted: wraps their own runner management API

Usage::

    class MyRunnerAdapter:
        async def on_session_opened(self, session_id: str) -> None:
            await start_worker(session_id)

        async def on_session_closed(self, session_id: str) -> None:
            await stop_worker(session_id)

        async def on_workflow_execution_created(self, execution_id: str) -> None:
            await start_execution_worker(execution_id)

        async def on_workflow_execution_terminated(self, execution_id: str) -> None:
            await stop_execution_worker(execution_id)

    client = StigmerClient("sk_live_...", runner_adapter=MyRunnerAdapter())
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class RunnerAdapter(Protocol):
    """Protocol for runner lifecycle management.

    Implementations handle starting and stopping runner workers in
    response to session and workflow execution lifecycle events.
    Methods are async to support I/O-bound operations (process
    management, HTTP calls to runner APIs, etc.).
    """

    async def on_session_opened(self, session_id: str) -> None:
        """Called when a local session is opened (engaged).

        The adapter should ensure a runner worker is polling the session's
        task queue. Must be idempotent: it may be called again for an
        already-open session (e.g. on re-open).
        """
        ...

    async def on_session_closed(self, session_id: str) -> None:
        """Called when a local session is closed (no longer in use).

        The adapter should tear down the session's runner worker.
        """
        ...

    async def on_workflow_execution_created(self, execution_id: str) -> None:
        """Called after a workflow execution is created with execution_target=LOCAL."""
        ...

    async def on_workflow_execution_terminated(self, execution_id: str) -> None:
        """Called when a workflow execution reaches a terminal phase."""
        ...
