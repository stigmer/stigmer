"""Sub-agent compilation for LangGraph Deep Agents.

Provides ``compile_subagent()`` — the single factory for compiling sub-agent
graphs used by deepagents' ``task`` tool.

Sub-agents are compiled with ``checkpointer=None`` so they inherit the
parent graph's checkpointer at invocation time (LangGraph's "per-invocation"
subgraph mode).  This means:

- ``interrupt()`` in a sub-agent automatically propagates to the parent
  checkpoint with the **direct** interrupt value shape — identical to
  root-agent tool interrupts.
- ``Command(resume=...)`` on the parent graph correctly resumes the
  sub-agent from its checkpoint.
- Concurrent sub-agent invocations get distinct ``checkpoint_ns`` values,
  preventing the deadlock that the old ``InterruptProxyRunnable`` caused
  with its shared ``MemorySaver`` and ``_thread_counter``.

See ``tests/core/test_native_subgraph_interrupt.py`` for the verification
tests that confirm this contract.

Usage (inside ``agent.py``)::

    from graphton.core.interrupt_proxy import compile_subagent

    compiled = compile_subagent(
        model=model_instance,
        tools=subagent_tools,
        system_prompt=subagent_prompt,
        name=subagent_name,
        description=subagent_description,
    )
    # 'compiled' is a CompiledSubAgent dict with a 'runnable' key
"""

from __future__ import annotations

import logging
from typing import Any

from langchain.agents import create_agent  # type: ignore[import-untyped]
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)


_UNLIMITED_RECURSION: int = 10_000_000


_SUB_AGENT_ADVISORY_INTERVAL: int = 30
_SUB_AGENT_MAX_ADVISORIES: int = 4


def compile_subagent(
    *,
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    name: str,
    description: str,
    middleware: list[Any] | None = None,
    recursion_limit: int | None = None,
) -> dict[str, Any]:
    """Compile a sub-agent graph using LangGraph native per-invocation mode.

    The compiled graph uses ``checkpointer=None`` (the default from
    ``create_agent``), so it inherits the parent's checkpointer at runtime.
    This enables native interrupt propagation without a proxy layer.

    Automatically injects guardrail middleware:

    - **LoopDetectionMiddleware** — prevents infinite tool loops by
      detecting repetitive invocation patterns.
    - **ToolTruncationMiddleware** — caps per-tool-result character
      count to prevent context blowup.
    - **ExecutionBudgetMiddleware** (periodic mode) — nudges the model
      every 30 model rounds with escalating urgency (up to 4 times).

    Sub-agents run with effectively unlimited recursion (matching the
    main agent and industry peers like Cursor and Claude Code).  The
    primary safety mechanisms are loop detection (catches stuck agents),
    cost cap (when configured), and context summarization (prevents
    token overflow) — not a step-count ceiling.  The budget middleware
    provides advisory nudges only; it does not stop execution.

    Args:
        recursion_limit: Maximum super-steps for the sub-agent graph.
            ``None`` (default) means unlimited — the sub-agent runs
            until loop detection or the task completes.  When set to a
            positive integer, LangGraph enforces that hard limit.

    Returns a dict compatible with deepagents' ``CompiledSubAgent`` TypedDict
    (keys: ``name``, ``description``, ``runnable``).
    """
    from graphton.core.execution_budget import ExecutionBudgetMiddleware
    from graphton.core.loop_detection import LoopDetectionMiddleware
    from graphton.core.tool_truncation import (
        ToolTruncationMiddleware,
        _DEFAULT_MAX_CHARS as _DEFAULT_TRUNCATION,
    )

    effective_limit = (
        recursion_limit
        if recursion_limit is not None
        else _UNLIMITED_RECURSION
    )

    effective_middleware = list(middleware or [])

    effective_middleware.append(LoopDetectionMiddleware(enabled=True))

    effective_middleware.append(ToolTruncationMiddleware(
        max_chars=_DEFAULT_TRUNCATION,
    ))

    effective_middleware.append(ExecutionBudgetMiddleware(
        warning_interval=_SUB_AGENT_ADVISORY_INTERVAL,
        max_warnings=_SUB_AGENT_MAX_ADVISORIES,
    ))

    compiled_graph = create_agent(
        model,
        system_prompt=system_prompt,
        tools=tools,
        middleware=effective_middleware,
    )

    compiled_graph = compiled_graph.with_config(
        {"recursion_limit": effective_limit},
    )

    logger.info(
        "Compiled sub-agent '%s' with native interrupt propagation "
        "(tools=%d, middleware=%d, recursion_limit=%d%s, "
        "advisory_interval=%d, max_advisories=%d)",
        name,
        len(tools),
        len(effective_middleware),
        effective_limit,
        " (unlimited)" if recursion_limit is None else "",
        _SUB_AGENT_ADVISORY_INTERVAL,
        _SUB_AGENT_MAX_ADVISORIES,
    )

    return {
        "name": name,
        "description": description,
        "runnable": compiled_graph,
    }
