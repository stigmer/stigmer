"""Concurrency gate for sub-agent execution.

Wraps each sub-agent ``Runnable`` with a shared ``asyncio.Semaphore`` so
that no more than ``max_concurrent`` sub-agents execute simultaneously
within a single agent execution.

When the LLM generates N ``task`` tool calls in one assistant turn,
LangGraph's tool node fires all N concurrently via ``asyncio.gather``.
Without a gate, all N sub-agents start in parallel — burning tokens,
exhausting context, and producing noisy UX.

The gate uses **non-blocking rejection**: if the semaphore is fully
acquired, additional ``ainvoke`` calls return an error message
immediately rather than queuing.  This gives the LLM explicit feedback
("limit reached, wait for active sub-agents") so it can self-correct.

Usage (inside ``agent.py``)::

    from graphton.core.subagent_limiter import SubAgentGate

    gate = SubAgentGate(max_concurrent=3)
    wrapped = gate.wrap(inner_runnable, name="researcher")
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.runnables import Runnable, RunnableConfig

logger = logging.getLogger(__name__)

MAX_CONCURRENT_SUBAGENTS = 3


class SubAgentGate:
    """Shared concurrency gate for all sub-agents in an execution.

    One ``SubAgentGate`` instance is created per ``create_deep_agent``
    call and shared across every sub-agent runnable via ``wrap()``.
    """

    def __init__(self, max_concurrent: int = MAX_CONCURRENT_SUBAGENTS) -> None:
        self._max = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active = 0

    def wrap(self, runnable: Runnable, *, name: str) -> _GatedRunnable:
        """Return a concurrency-gated wrapper around *runnable*."""
        return _GatedRunnable(
            inner=runnable,
            gate=self,
            name=name,
        )


class _GatedRunnable(Runnable):
    """Thin ``Runnable`` wrapper that enforces the shared concurrency gate.

    On ``ainvoke``:

    * Tries to acquire the semaphore **without blocking**.
    * If acquired, delegates to the inner runnable and releases on
      completion (success or failure).
    * If the semaphore is full, returns immediately with a structured
      error dict that deepagents' ``task`` tool translates into a
      ``ToolMessage`` for the LLM.
    """

    def __init__(
        self,
        inner: Runnable,
        gate: SubAgentGate,
        name: str,
    ) -> None:
        super().__init__()
        self._inner = inner
        self._gate = gate
        self._name = name

    # Passthrough properties that deepagents or LangGraph may inspect.

    @property
    def config_specs(self) -> list:  # type: ignore[override]
        return getattr(self._inner, "config_specs", [])

    def get_graph(self, **kwargs: Any) -> Any:
        if hasattr(self._inner, "get_graph"):
            return self._inner.get_graph(**kwargs)
        return super().get_graph(**kwargs)

    # ------------------------------------------------------------------
    # Runnable interface
    # ------------------------------------------------------------------

    def invoke(self, input: Any, config: RunnableConfig | None = None, **kw: Any) -> Any:  # noqa: A002
        import asyncio as _aio

        return _aio.get_event_loop().run_until_complete(
            self.ainvoke(input, config, **kw),
        )

    async def ainvoke(self, input: Any, config: RunnableConfig | None = None, **kw: Any) -> Any:  # noqa: A002
        if not self._gate._semaphore._value:  # noqa: SLF001 — fast non-blocking check
            active = self._gate._active
            logger.warning(
                "[SubAgentGate] Rejected sub-agent '%s': %d/%d slots in use",
                self._name,
                active,
                self._gate._max,
            )
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": (
                            f"Sub-agent '{self._name}' was NOT started — "
                            f"the maximum of {self._gate._max} concurrent "
                            f"sub-agents has been reached. Wait for active "
                            f"sub-agents to finish before delegating more work."
                        ),
                    }
                ]
            }

        await self._gate._semaphore.acquire()
        self._gate._active += 1
        logger.info(
            "[SubAgentGate] Sub-agent '%s' acquired slot (%d/%d active)",
            self._name,
            self._gate._active,
            self._gate._max,
        )
        try:
            return await self._inner.ainvoke(input, config, **kw)
        finally:
            self._gate._active -= 1
            self._gate._semaphore.release()
            logger.info(
                "[SubAgentGate] Sub-agent '%s' released slot (%d/%d active)",
                self._name,
                self._gate._active,
                self._gate._max,
            )
