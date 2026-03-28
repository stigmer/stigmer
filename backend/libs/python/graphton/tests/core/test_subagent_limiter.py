"""Tests for SubAgentGate concurrency limiter.

Validates that:
- Sub-agents within the limit run normally.
- Sub-agents exceeding the limit are rejected immediately with an
  informative error dict (not queued).
- The semaphore is released after both success and failure.
- The gate handles concurrent invocations correctly.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from graphton.core.subagent_limiter import MAX_CONCURRENT_SUBAGENTS, SubAgentGate


def _make_inner(*, delay: float = 0.0, return_value=None, side_effect=None):
    """Create an async mock Runnable with configurable behavior."""
    inner = AsyncMock()
    if side_effect is not None:
        inner.ainvoke.side_effect = side_effect
    elif delay > 0:
        async def _delayed(*args, **kwargs):
            await asyncio.sleep(delay)
            return return_value or {"messages": [{"role": "assistant", "content": "done"}]}
        inner.ainvoke = _delayed
    else:
        inner.ainvoke.return_value = return_value or {
            "messages": [{"role": "assistant", "content": "done"}]
        }
    return inner


class TestSubAgentGate:

    def test_default_max_concurrent(self):
        gate = SubAgentGate()
        assert gate._max == MAX_CONCURRENT_SUBAGENTS
        assert gate._max == 3

    def test_custom_max_concurrent(self):
        gate = SubAgentGate(max_concurrent=5)
        assert gate._max == 5

    @pytest.mark.asyncio
    async def test_single_invocation_succeeds(self):
        gate = SubAgentGate()
        inner = _make_inner()
        wrapped = gate.wrap(inner, name="test-agent")

        result = await wrapped.ainvoke({"messages": [{"role": "user", "content": "hi"}]})

        assert result == {"messages": [{"role": "assistant", "content": "done"}]}
        assert gate._active == 0

    @pytest.mark.asyncio
    async def test_within_limit_all_succeed(self):
        """Launch exactly max_concurrent sub-agents — all should succeed."""
        gate = SubAgentGate(max_concurrent=3)
        agents = [
            gate.wrap(_make_inner(delay=0.05), name=f"agent-{i}")
            for i in range(3)
        ]

        results = await asyncio.gather(
            *[a.ainvoke({"messages": []}) for a in agents]
        )

        assert all(r["messages"][0]["content"] == "done" for r in results)
        assert gate._active == 0

    @pytest.mark.asyncio
    async def test_exceeding_limit_rejected(self):
        """Launch more than max_concurrent — excess should be rejected."""
        gate = SubAgentGate(max_concurrent=2)
        agents = [
            gate.wrap(_make_inner(delay=0.1), name=f"agent-{i}")
            for i in range(5)
        ]

        results = await asyncio.gather(
            *[a.ainvoke({"messages": []}) for a in agents]
        )

        successes = [r for r in results if r["messages"][0]["content"] == "done"]
        rejections = [r for r in results if "NOT started" in r["messages"][0]["content"]]

        assert len(successes) == 2
        assert len(rejections) == 3
        assert gate._active == 0

    @pytest.mark.asyncio
    async def test_rejection_message_content(self):
        """Rejected sub-agents return an informative error message."""
        gate = SubAgentGate(max_concurrent=1)

        slow = gate.wrap(_make_inner(delay=0.2), name="slow-agent")
        fast = gate.wrap(_make_inner(), name="blocked-agent")

        task_slow = asyncio.create_task(slow.ainvoke({"messages": []}))
        await asyncio.sleep(0.01)
        result_fast = await fast.ainvoke({"messages": []})
        await task_slow

        msg = result_fast["messages"][0]["content"]
        assert "blocked-agent" in msg
        assert "NOT started" in msg
        assert "maximum of 1" in msg

    @pytest.mark.asyncio
    async def test_semaphore_released_on_exception(self):
        """Semaphore is released even when the inner runnable raises."""
        gate = SubAgentGate(max_concurrent=1)
        inner = _make_inner(side_effect=RuntimeError("boom"))
        wrapped = gate.wrap(inner, name="error-agent")

        with pytest.raises(RuntimeError, match="boom"):
            await wrapped.ainvoke({"messages": []})

        assert gate._active == 0
        assert gate._semaphore._value == 1

    @pytest.mark.asyncio
    async def test_sequential_reuse(self):
        """After sub-agents complete, slots are available for new ones."""
        gate = SubAgentGate(max_concurrent=1)
        inner = _make_inner()
        wrapped = gate.wrap(inner, name="reusable")

        for _ in range(5):
            result = await wrapped.ainvoke({"messages": []})
            assert result["messages"][0]["content"] == "done"

        assert gate._active == 0
