"""RunnerAdapter protocol for local execution lifecycle management.

When ``execution_target`` is ``"local"``, the SDK client automatically
calls adapter methods after session/execution creation and on terminal
phase detection. Cloud consumers do not provide an adapter.

Each environment provides its own implementation:

- Desktop app: wraps the embedded runner process
- CLI: wraps the daemon runner
- Customer self-hosted: wraps their own runner management API

Usage::

    class MyRunnerAdapter:
        async def on_session_created(self, session_id: str) -> None:
            await start_worker(session_id)

        async def on_session_terminated(self, session_id: str) -> None:
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

    async def on_session_created(self, session_id: str) -> None:
        """Called after a session is created with execution_target=LOCAL."""
        ...

    async def on_session_terminated(self, session_id: str) -> None:
        """Called when a session reaches a terminal phase."""
        ...

    async def on_workflow_execution_created(self, execution_id: str) -> None:
        """Called after a workflow execution is created with execution_target=LOCAL."""
        ...

    async def on_workflow_execution_terminated(self, execution_id: str) -> None:
        """Called when a workflow execution reaches a terminal phase."""
        ...
