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
  eliminating checkpoint contention.

See ``tests/core/test_native_subgraph_interrupt.py`` for the verification
tests that confirm this contract.

Usage (inside ``agent.py``)::

    from graphton.core.subagent import compile_subagent

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

_TOOL_COUNT_WARNING_THRESHOLD: int = 25
_TOOL_DESC_MAX_CHARS: int = 500

_SUB_AGENT_ADVISORY_INTERVAL: int = 30
_SUB_AGENT_MAX_ADVISORIES: int = 4


def audit_tool_set(
    tools: list[BaseTool],
    *,
    context_label: str = "agent",
) -> None:
    """Log tool count warnings and truncate verbose descriptions.

    Shared between ``create_deep_agent`` (main agent) and
    ``compile_subagent`` (sub-agents) so both benefit from the same
    observability guardrails.

    - Warns when the tool count exceeds the threshold (25) because
      model tool-selection accuracy degrades above ~20-25 tools.
    - Truncates descriptions longer than 500 characters to prevent
      bloated tool-calling payloads that waste tokens.

    Mutates *tools* in place (description truncation only).
    """
    total = len(tools)
    if total > _TOOL_COUNT_WARNING_THRESHOLD:
        logger.warning(
            "[TOOL-COUNT] %s: %d tools bound (threshold=%d). "
            "High tool counts degrade model selection accuracy. "
            "Consider reducing MCP enabled_tools.",
            context_label,
            total,
            _TOOL_COUNT_WARNING_THRESHOLD,
        )
    logger.info(
        "[TOOL-COUNT] %s: total=%d (threshold=%d)",
        context_label,
        total,
        _TOOL_COUNT_WARNING_THRESHOLD,
    )

    truncated_count = 0
    for tool in tools:
        desc = getattr(tool, "description", None)
        if desc and len(desc) > _TOOL_DESC_MAX_CHARS:
            tool.description = desc[:_TOOL_DESC_MAX_CHARS] + "..."  # type: ignore[union-attr]
            truncated_count += 1
    if truncated_count:
        logger.info(
            "[TOOL-COUNT] %s: truncated descriptions on %d tool(s) "
            "exceeding %d chars",
            context_label,
            truncated_count,
            _TOOL_DESC_MAX_CHARS,
        )


def compile_subagent(
    *,
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    name: str,
    description: str,
    middleware: list[Any] | None = None,
    recursion_limit: int | None = None,
    cost_cap: Any | None = None,
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
    - **CostCapMiddleware** sub-agent view (when provided) — accumulates
      model call costs against the parent's shared budget.

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
        cost_cap: A ``_CostCapSubAgentView`` (from
            ``CostCapMiddleware.for_sub_agent()``) that shares the
            parent's cost budget.  When provided, sub-agent model calls
            accumulate against the same cap and tools are blocked when
            the shared budget is exceeded.

    Returns a dict compatible with deepagents' ``CompiledSubAgent`` TypedDict
    (keys: ``name``, ``description``, ``runnable``).
    """
    from graphton.core.execution_budget import ExecutionBudgetMiddleware
    from graphton.core.loop_detection import LoopDetectionMiddleware
    from graphton.core.tool_truncation import (
        _DEFAULT_MAX_CHARS as _DEFAULT_TRUNCATION,
    )
    from graphton.core.tool_truncation import (
        ToolTruncationMiddleware,
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

    if cost_cap is not None:
        effective_middleware.append(cost_cap)

    audit_tool_set(tools, context_label=f"sub-agent:{name}")

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
        "advisory_interval=%d, max_advisories=%d, cost_cap=%s)",
        name,
        len(tools),
        len(effective_middleware),
        effective_limit,
        " (unlimited)" if recursion_limit is None else "",
        _SUB_AGENT_ADVISORY_INTERVAL,
        _SUB_AGENT_MAX_ADVISORIES,
        "shared" if cost_cap is not None else "none",
    )

    return {
        "name": name,
        "description": description,
        "runnable": compiled_graph,
    }
