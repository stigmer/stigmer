"""Think tool for structured agent reasoning.

Provides a no-op ``think`` tool that gives LLMs a dedicated place to reason
before acting.  The thought is captured as a regular tool-call argument,
making it observable through the existing status pipeline (status builder,
gRPC updates, CLI rendering) without any special handling.

The tool follows the Anthropic "think tool" pattern:
https://www.anthropic.com/engineering/claude-think-tool

Key properties:
- **No side effects** — the tool does nothing; it exists purely so the
  model can externalise reasoning as a structured tool call.
- **Model-agnostic** — works with any LLM (Claude, GPT, Ollama, …).
- **Observable** — the thought text appears in ``ToolCall.args.thought``
  and flows through the normal event/status pipeline.
- **Zero dependencies** — no sandbox, storage, or service references.
"""

from __future__ import annotations

import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def create_think_tool():
    """Create a LangChain tool that lets the agent reason without acting.

    Returns a ``@tool``-decorated async function whose only purpose is to
    accept a ``thought`` string and return an acknowledgement.  The real
    value is that the thought is recorded as a tool-call argument, giving
    the platform (and the user) visibility into the agent's reasoning.

    Returns:
        A LangChain ``BaseTool`` instance named ``think``.
    """

    @tool
    async def think(thought: str) -> str:  # noqa: ARG001
        """Use this tool to think through a problem step-by-step.

        The think tool does not read files, execute commands, or make any
        changes — it simply records your reasoning.  Call it when you need
        to pause and work something out before acting.

        Good times to use ``think``:

        - After reading files or tool output, to analyse what you learned
          and decide what to do next.
        - Before a complex or multi-step operation, to plan your approach.
        - When you need to choose between several possible strategies.
        - When debugging — to reason about what might have gone wrong and
          which hypothesis to test first.

        You do NOT need to use ``think`` for every step — only when genuine
        reasoning will improve the quality of your next action.

        Args:
            thought: Your reasoning, analysis, or plan.

        Returns:
            A short acknowledgement (the thought itself is already captured
            in the tool-call arguments).
        """
        logger.debug("think tool invoked (%d chars)", len(thought))
        return "ok"

    return think
