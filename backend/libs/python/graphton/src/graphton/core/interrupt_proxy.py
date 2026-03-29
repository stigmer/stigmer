"""Interrupt-aware wrapper for sub-agent runnables.

deepagents' ``task`` tool invokes sub-agents via ``.ainvoke()``.  When a
sub-agent tool calls ``interrupt()`` for HITL approval, the behaviour depends
on whether the sub-agent graph has a checkpointer:

*Without* a checkpointer (deepagents 0.4.x default for custom sub-agents):
  ``interrupt()`` raises ``GraphInterrupt``.  The exception propagates through
  ``.ainvoke()`` to the parent's tool node, which records it as a *single*
  interrupt for the entire ``task`` tool call.  If the sub-agent batch had
  multiple approval-requiring tools, only the **first** interrupt survives —
  the rest are cancelled by asyncio.  On parent resume the ``task`` function
  re-executes, but the sub-agent starts fresh and can never be properly
  resumed, creating a permanent approval deadlock.

*With* a checkpointer (what this module provides):
  ``interrupt()`` checkpoints the sub-agent state with **all** pending
  interrupts.  ``.ainvoke()`` returns the interrupted snapshot instead of
  raising.  This module detects the interrupts, proxies them to the parent
  graph via a parent-level ``interrupt()`` call, and — on resume — passes
  the approval decisions back to the sub-agent to continue execution.

Usage (inside ``agent.py``)::

    from graphton.core.interrupt_proxy import compile_subagent_with_proxy

    compiled = compile_subagent_with_proxy(
        model=model_instance,
        tools=subagent_tools,
        system_prompt=subagent_prompt,
        name=subagent_name,
    )
    # 'compiled' is a CompiledSubAgent dict with a 'runnable' key
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from langchain.agents import create_agent  # type: ignore[import-untyped]
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.runnables.config import ensure_config, merge_configs
from langchain_core.tools import BaseTool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt

logger = logging.getLogger(__name__)


class InterruptProxyRunnable(Runnable):
    """Wraps a sub-agent graph to proxy interrupts to the parent.

    Lifecycle for a single ``task`` tool invocation:

    1. **Fresh call** — no prior checkpoint exists.  The sub-agent runs from
       scratch.  If it pauses with interrupts, ``ainvoke()`` returns the
       interrupted snapshot (thanks to the MemorySaver).  We then call
       ``interrupt()`` on the parent to surface those payloads to the user.

    2. **Resumed call** — the parent tool-node re-executes after the user
       approved.  ``interrupt()`` at the same index now returns the cached
       decisions.  We detect the existing interrupted checkpoint and resume
       the sub-agent with the decisions via ``Command(resume=…)``.

    3. **Loop** — if the sub-agent hits *more* interrupts after a partial
       resume, we proxy again (step 1-like) and the cycle repeats until the
       sub-agent runs to completion.

    Important: the MemorySaver lives on ``self`` so it survives parent
    tool-node re-executions within the *same* Python activity invocation.
    Between Temporal activity re-invocations (which recreate the graph) the
    MemorySaver is fresh, but the parent's ``interrupt()`` replay mechanism
    feeds the cached decisions so the sub-agent re-derives the same
    interrupts and receives the correct approvals.
    """

    def __init__(
        self,
        inner_graph: Any,
        name: str,
    ) -> None:
        super().__init__()
        self.inner_graph = inner_graph
        self.name = name
        self._checkpointer = MemorySaver()
        self._thread_counter = 0

    # ------------------------------------------------------------------
    # Runnable interface
    # ------------------------------------------------------------------

    def invoke(self, input: Any, config: RunnableConfig | None = None, **kwargs: Any) -> Any:  # noqa: A002
        import asyncio

        return asyncio.get_event_loop().run_until_complete(
            self.ainvoke(input, config, **kwargs)
        )

    async def ainvoke(self, input: Any, config: RunnableConfig | None = None, **kwargs: Any) -> Any:  # noqa: A002
        thread_id, sa_config = self._current_thread_config()

        # Merge the parent's callback context with our thread config.
        # ensure_config() inherits the active callback manager from the
        # parent graph's astream_events context.  merge_configs() layers
        # our thread_id on top so checkpointing stays isolated while
        # callback events flow through the parent for proper namespace
        # metadata propagation to StatusBuilder.
        parent_ctx = ensure_config(config)
        merged = merge_configs(parent_ctx, sa_config)

        # Probe the current thread's checkpoint to decide: resume vs fresh.
        # Checkpoint lookups only need thread_id, so bare sa_config suffices.
        state = await self._safe_get_state(sa_config)

        if state is not None and getattr(state, "interrupts", None):
            # RESUME: sub-agent was interrupted on this thread in a prior
            # parent execution.  The parent tool-node is replaying after an
            # HITL approval — reuse the same thread so we resume from the
            # checkpoint instead of starting over.
            proxy_payload = self._build_proxy_payload(state.interrupts)
            decisions = interrupt(proxy_payload)
            logger.info(
                "[InterruptProxy:%s] Resuming sub-agent on thread %s "
                "with %d decision(s)",
                self.name, thread_id,
                len(decisions) if isinstance(decisions, dict) else 1,
            )
            result = await self.inner_graph.ainvoke(
                Command(resume=decisions), config=merged,
            )
        else:
            # If a completed checkpoint exists on this thread, a previous
            # ainvoke() already ran to completion.  Advance to a new thread
            # so sequential calls to the same sub-agent stay isolated.
            if state is not None and getattr(state, "values", None):
                self._thread_counter += 1
                thread_id, sa_config = self._current_thread_config()
                merged = merge_configs(parent_ctx, sa_config)
                logger.info(
                    "[InterruptProxy:%s] Prior thread completed, "
                    "advancing to thread %s",
                    self.name, thread_id,
                )

            # FRESH: first invocation (or new sequential call).
            logger.info(
                "[InterruptProxy:%s] Starting fresh sub-agent on thread %s",
                self.name, thread_id,
            )
            result = await self.inner_graph.ainvoke(input, config=merged)

        # After the invocation, check whether the sub-agent paused again.
        state = await self._safe_get_state(sa_config)
        if state is not None and getattr(state, "interrupts", None):
            proxy_payload = self._build_proxy_payload(state.interrupts)
            logger.info(
                "[InterruptProxy:%s] Sub-agent paused with %d interrupt(s), "
                "proxying to parent",
                self.name,
                len(state.interrupts),
            )
            # This interrupt() will either:
            #   a) raise GraphInterrupt (first parent execution) → parent pauses
            #   b) return decisions (parent was already resumed for this index)
            maybe_decisions = interrupt(proxy_payload)
            if maybe_decisions is not None:
                logger.info(
                    "[InterruptProxy:%s] Got inline decisions, resuming sub-agent",
                    self.name,
                )
                result = await self.inner_graph.ainvoke(
                    Command(resume=maybe_decisions), config=merged,
                )

        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _current_thread_config(self) -> tuple[str, RunnableConfig]:
        """Return the thread id and config for the current counter value.

        Unlike the previous ``_next_thread_id``, the counter is NOT
        incremented here.  Advancing only happens inside ``ainvoke()`` after
        detecting that the current thread's checkpoint is complete.  This
        ensures parent tool-node replays (after HITL approval) reuse the same
        thread and resume from the interrupted checkpoint instead of starting
        a fresh sub-agent on a new thread.
        """
        tid = f"sa-{self.name}-{self._thread_counter}"
        return tid, {"configurable": {"thread_id": tid}}

    async def _safe_get_state(self, config: RunnableConfig) -> Any:
        try:
            return await self.inner_graph.aget_state(config)
        except Exception:
            return None

    @staticmethod
    def _build_proxy_payload(interrupts: Any) -> dict[str, Any]:
        """Convert sub-agent interrupt objects into a proxy payload.

        The payload is a dict mapping interrupt-id → interrupt-value, which
        matches the ``Command(resume={id: decision, …})`` format that
        LangGraph expects for targeted resume.
        """
        payload: dict[str, Any] = {}
        for intr in interrupts:
            intr_id = getattr(intr, "id", None) or uuid.uuid4().hex
            intr_value = getattr(intr, "value", intr)

            if isinstance(intr_value, dict):
                intr_value = {**intr_value, "_proxy_interrupt_id": intr_id}

            payload[intr_id] = intr_value
        return payload


def compile_subagent_with_proxy(
    *,
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    name: str,
    description: str,
    middleware: list[Any] | None = None,
) -> dict[str, Any]:
    """Compile a sub-agent graph with a MemorySaver and wrap it in an
    :class:`InterruptProxyRunnable`.

    Returns a dict compatible with deepagents' ``CompiledSubAgent`` TypedDict
    (keys: ``name``, ``description``, ``runnable``).
    """
    from langgraph.checkpoint.memory import MemorySaver

    checkpointer = MemorySaver()

    compiled_graph = create_agent(
        model,
        system_prompt=system_prompt,
        tools=tools,
        middleware=middleware or [],
        checkpointer=checkpointer,
    )

    proxy = InterruptProxyRunnable(
        inner_graph=compiled_graph,
        name=name,
    )

    logger.info(
        "Compiled sub-agent '%s' with InterruptProxy "
        "(tools=%d, middleware=%d)",
        name,
        len(tools),
        len(middleware or []),
    )

    return {
        "name": name,
        "description": description,
        "runnable": proxy,
    }
