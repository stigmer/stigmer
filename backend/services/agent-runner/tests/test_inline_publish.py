"""Unit tests for inline artifact publishing during streaming.

Tests cover:
- StatusBuilder.add_artifact dedup by sandbox_path (replace, not duplicate)
- StatusBuilder.add_artifact immediately syncs to current_status.artifacts
- StatusBuilder.add_artifact sets force_next_update
- StatusBuilder.finalize_context_info reconciles inline-synced artifacts
- StreamExecutor._on_file_modifying_tool_end fires on write/edit tool_end
- StreamExecutor._on_file_modifying_tool_end ignores non-write tools
- StreamExecutor.pending_publish_tasks tracks background tasks
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
from google.protobuf.struct_pb2 import Struct

# =============================================================================
# Helpers
# =============================================================================


def _make_artifact(name: str, sandbox_path: str, size: int = 100) -> ExecutionArtifact:
    """Create a real ExecutionArtifact proto."""
    return ExecutionArtifact(
        name=name,
        sandbox_path=sandbox_path,
        size_bytes=size,
        storage_key=f"artifacts/test-exec/{name}",
        download_url=f"https://example.com/{name}",
    )


def _make_tool_call_proto(name: str, path: str, tc_id: str = ""):
    """Create a mock ToolCall proto for status_builder.current_status.tool_calls."""
    tc = MagicMock()
    tc.name = name
    tc.id = tc_id or f"tc-{name}-{path}"
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED
    args = Struct()
    if path:
        args.update({"path": path})
    tc.args = args
    return tc


# =============================================================================
# StatusBuilder.add_artifact tests
# =============================================================================


class TestStatusBuilderAddArtifact:
    """Tests for the enhanced add_artifact with dedup and live sync."""

    def _import_and_create(self):
        """Import StatusBuilder and create an instance with minimal deps."""
        from stigmer_runner.worker.activities.graphton.execution_state import ExecutionState
        from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder

        sb = StatusBuilder.__new__(StatusBuilder)
        sb.state = ExecutionState(proto=AgentExecutionStatus())
        sb.execution_id = "test-exec"
        sb.force_next_update = False
        sb.logger = logging.getLogger("test")
        return sb

    def test_add_artifact_syncs_to_status_immediately(self):
        sb = self._import_and_create()
        artifact = _make_artifact("file.txt", "project/file.txt")

        sb.add_artifact(artifact)

        assert len(sb.current_status.artifacts) == 1
        assert sb.current_status.artifacts[0].sandbox_path == "project/file.txt"
        assert len(sb.state.artifacts) == 1

    def test_add_artifact_sets_force_next_update(self):
        sb = self._import_and_create()
        assert sb.force_next_update is False

        artifact = _make_artifact("file.txt", "project/file.txt")
        sb.add_artifact(artifact)

        assert sb.force_next_update is True

    def test_add_artifact_dedup_replaces_same_path(self):
        sb = self._import_and_create()
        artifact_v1 = _make_artifact("file.txt", "project/file.txt", size=100)
        artifact_v2 = _make_artifact("file.txt", "project/file.txt", size=200)

        sb.add_artifact(artifact_v1)
        sb.add_artifact(artifact_v2)

        assert len(sb.current_status.artifacts) == 1
        assert sb.current_status.artifacts[0].size_bytes == 200
        assert len(sb.state.artifacts) == 1
        assert sb.state.artifacts[0].size_bytes == 200

    def test_add_artifact_different_paths_appended(self):
        sb = self._import_and_create()
        artifact_a = _make_artifact("a.txt", "project/a.txt")
        artifact_b = _make_artifact("b.txt", "project/b.txt")

        sb.add_artifact(artifact_a)
        sb.add_artifact(artifact_b)

        assert len(sb.current_status.artifacts) == 2
        assert len(sb.state.artifacts) == 2

    def test_finalize_context_info_does_not_duplicate(self):
        sb = self._import_and_create()
        sb.state.context_info = None
        artifact = _make_artifact("file.txt", "project/file.txt")

        sb.add_artifact(artifact)
        assert len(sb.current_status.artifacts) == 1

        sb.finalize_context_info()
        assert len(sb.current_status.artifacts) == 1

    def test_finalize_context_info_syncs_missed_artifacts(self):
        """Artifacts added to _artifacts but not yet in current_status
        (e.g. from post-stream safety net before finalize) are synced."""
        sb = self._import_and_create()
        sb.state.context_info = None

        artifact_inline = _make_artifact("a.txt", "a.txt")
        sb.add_artifact(artifact_inline)

        artifact_safety = _make_artifact("b.txt", "b.txt")
        sb.state.artifacts.append(artifact_safety)

        sb.finalize_context_info()
        paths = [a.sandbox_path for a in sb.current_status.artifacts]
        assert "a.txt" in paths
        assert "b.txt" in paths
        assert len(sb.current_status.artifacts) == 2


# =============================================================================
# StreamExecutor inline publish trigger tests
# =============================================================================


class TestStreamExecutorInlinePublish:
    """Tests for _on_file_modifying_tool_end in StreamExecutor."""

    def _make_executor(self, on_file_written=None):
        from stigmer_runner.worker.activities.graphton.streaming import StreamExecutor

        tc_write = MagicMock()
        tc_write.id = "run-write-1"
        tc_write.name = "write"
        args = Struct()
        args.update({"path": "output/result.txt"})
        tc_write.args = args

        tc_read = MagicMock()
        tc_read.id = "run-read-1"
        tc_read.name = "read"
        read_args = Struct()
        read_args.update({"path": "input.txt"})
        tc_read.args = read_args

        sb = MagicMock()
        sb.current_status = MagicMock()
        sb.current_status.tool_calls = [tc_write, tc_read]
        sb.force_next_update = False
        sb.resolve_run_id = lambda rid: rid
        sb.get_tool_call = lambda tc_id: next(
            (tc for tc in sb.current_status.tool_calls if tc.id == tc_id), None
        )

        executor = StreamExecutor(
            agent_graph=MagicMock(),
            config={},
            execution_id="test-exec",
            thread_id="test-thread",
            status_builder=sb,
            execution_client=MagicMock(),
            streaming_config=MagicMock(),
            stall_timeout_seconds=300,
            grpc_update_timeout_seconds=10,
            effective_recursion_limit=100,
            heartbeat_fn=MagicMock(),
            is_cancelled_fn=lambda: False,
            slim_status_fn=lambda s: s,
            logger=logging.getLogger("test"),
            on_file_written=on_file_written,
        )
        return executor

    @pytest.mark.asyncio
    async def test_trigger_fires_on_write_tool_end(self):
        callback = AsyncMock()
        executor = self._make_executor(on_file_written=callback)

        event = {
            "event": "on_tool_end",
            "name": "write",
            "run_id": "run-write-1",
            "data": {"output": "ok"},
        }
        executor._on_file_modifying_tool_end(event)

        assert len(executor._pending_publishes) == 1
        task = next(iter(executor._pending_publishes))
        assert "output/result.txt" in task.get_name()
        await task

    def test_trigger_ignores_read_tool_end(self):
        callback = AsyncMock()
        executor = self._make_executor(on_file_written=callback)

        event = {
            "event": "on_tool_end",
            "name": "read",
            "run_id": "run-read-1",
            "data": {"output": "content"},
        }
        executor._on_file_modifying_tool_end(event)

        assert len(executor._pending_publishes) == 0

    def test_trigger_ignores_non_tool_end_events(self):
        callback = AsyncMock()
        executor = self._make_executor(on_file_written=callback)

        event = {
            "event": "on_tool_start",
            "name": "write",
            "run_id": "run-write-1",
        }
        executor._on_file_modifying_tool_end(event)

        assert len(executor._pending_publishes) == 0

    def test_trigger_noop_when_no_callback(self):
        executor = self._make_executor(on_file_written=None)

        event = {
            "event": "on_tool_end",
            "name": "write",
            "run_id": "run-write-1",
            "data": {"output": "ok"},
        }
        executor._on_file_modifying_tool_end(event)

        assert len(executor._pending_publishes) == 0

    @pytest.mark.asyncio
    async def test_trigger_fires_for_edit_tool(self):
        callback = AsyncMock()
        executor = self._make_executor(on_file_written=callback)

        tc_edit = MagicMock()
        tc_edit.id = "run-edit-1"
        tc_edit.name = "edit"
        args = Struct()
        args.update({"path": "config.yaml"})
        tc_edit.args = args
        executor._sb.current_status.tool_calls = list(
            executor._sb.current_status.tool_calls
        ) + [tc_edit]

        event = {
            "event": "on_tool_end",
            "name": "edit",
            "run_id": "run-edit-1",
            "data": {"output": "ok"},
        }
        executor._on_file_modifying_tool_end(event)

        assert len(executor._pending_publishes) == 1
        await next(iter(executor._pending_publishes))

    @pytest.mark.asyncio
    async def test_pending_publish_tasks_cleans_completed(self):
        async def quick_publish(path: str) -> None:
            pass

        executor = self._make_executor(on_file_written=quick_publish)

        event = {
            "event": "on_tool_end",
            "name": "write",
            "run_id": "run-write-1",
            "data": {"output": "ok"},
        }
        executor._on_file_modifying_tool_end(event)

        await asyncio.sleep(0.05)

        pending = executor.pending_publish_tasks
        assert len(pending) == 0
