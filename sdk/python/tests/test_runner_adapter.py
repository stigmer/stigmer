"""Tests for RunnerAdapter protocol and StigmerClient integration."""

from __future__ import annotations

import pytest

from stigmer import StigmerClient, RunnerAdapter
from stigmer._runner_adapter import RunnerAdapter as RunnerAdapterProtocol


class MockRunnerAdapter:
    """Mock adapter that records all lifecycle calls."""

    def __init__(self) -> None:
        self.sessions_opened: list[str] = []
        self.sessions_closed: list[str] = []
        self.executions_created: list[str] = []
        self.executions_terminated: list[str] = []

    async def on_session_opened(self, session_id: str) -> None:
        self.sessions_opened.append(session_id)

    async def on_session_closed(self, session_id: str) -> None:
        self.sessions_closed.append(session_id)

    async def on_workflow_execution_created(self, execution_id: str) -> None:
        self.executions_created.append(execution_id)

    async def on_workflow_execution_terminated(self, execution_id: str) -> None:
        self.executions_terminated.append(execution_id)


class TestRunnerAdapterProtocol:
    """Tests for the RunnerAdapter Protocol definition."""

    def test_mock_satisfies_protocol(self) -> None:
        adapter = MockRunnerAdapter()
        assert isinstance(adapter, RunnerAdapterProtocol)

    def test_incomplete_impl_does_not_satisfy_protocol(self) -> None:
        class IncompleteAdapter:
            async def on_session_opened(self, session_id: str) -> None: ...

        adapter = IncompleteAdapter()
        assert not isinstance(adapter, RunnerAdapterProtocol)

    def test_protocol_is_exported_from_package(self) -> None:
        assert RunnerAdapter is RunnerAdapterProtocol


class TestStigmerClientRunnerAdapter:
    """Tests for runner_adapter on StigmerClient."""

    def test_adapter_stored_on_client(self) -> None:
        adapter = MockRunnerAdapter()
        with StigmerClient(
            "test-key",
            base_url="localhost:7234",
            insecure=True,
            runner_adapter=adapter,
        ) as client:
            assert client.runner_adapter is adapter

    def test_no_adapter_defaults_to_none(self) -> None:
        with StigmerClient(
            "test-key",
            base_url="localhost:7234",
            insecure=True,
        ) as client:
            assert client.runner_adapter is None

    def test_adapter_with_execution_target(self) -> None:
        adapter = MockRunnerAdapter()
        with StigmerClient(
            "test-key",
            base_url="localhost:7234",
            insecure=True,
            execution_target="local",
            runner_adapter=adapter,
        ) as client:
            assert client.runner_adapter is adapter
            assert client.default_execution_target == 1


@pytest.mark.asyncio
class TestMockRunnerAdapterBehavior:
    """Tests for mock adapter recording calls correctly."""

    async def test_records_session_lifecycle(self) -> None:
        adapter = MockRunnerAdapter()

        await adapter.on_session_opened("ses-1")
        await adapter.on_session_opened("ses-2")
        await adapter.on_session_closed("ses-1")

        assert adapter.sessions_opened == ["ses-1", "ses-2"]
        assert adapter.sessions_closed == ["ses-1"]

    async def test_records_execution_lifecycle(self) -> None:
        adapter = MockRunnerAdapter()

        await adapter.on_workflow_execution_created("wfexec-1")
        await adapter.on_workflow_execution_terminated("wfexec-1")

        assert adapter.executions_created == ["wfexec-1"]
        assert adapter.executions_terminated == ["wfexec-1"]
