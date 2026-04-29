"""Capture tool_call_id from LangChain's callback API.

LangGraph v2 stream events do not surface the model's ``tool_call_id``
(e.g. ``toolu_01abc…``) on ``on_tool_start`` or ``on_tool_end``.  The
callback API *does* receive it as a keyword argument.  This handler
bridges the gap by storing ``{run_id → tool_call_id}`` so that
StatusBuilder can resolve the identity when processing v2 events.

Also serves as the single authority for run_id → tool_call_id resolution,
including resume-path aliases where LangGraph generates new run_ids for
tools that were already tracked under their original tool_call_id.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler


class ToolCallIdCapture(BaseCallbackHandler):
    """Maps LangGraph tool ``run_id`` to the model's ``tool_call_id``.

    Must be registered as a **sync** callback handler (not async) so the
    mapping is available before the corresponding v2 event is yielded
    from ``astream_events``.

    Two mapping layers:

    1. **Callback capture** (``_run_id_to_tool_call_id``): populated
       automatically by ``on_tool_start`` from the LangChain callback API.
    2. **Aliases** (``_aliases``): populated explicitly by StatusBuilder
       when identity-based dedup detects a resumed tool that already
       exists in the index under a different id.

    ``resolve()`` checks aliases first (resume path), then the callback
    mapping, and falls back to the input ``run_id`` unchanged.
    """

    def __init__(self) -> None:
        self._run_id_to_tool_call_id: dict[str, str] = {}
        self._aliases: dict[str, str] = {}

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        tool_call_id: str | None = None,
        **kwargs: Any,
    ) -> None:
        if tool_call_id is not None:
            self._run_id_to_tool_call_id[str(run_id)] = tool_call_id

    def get(self, run_id: str) -> str | None:
        """Return the ``tool_call_id`` for *run_id*, or ``None``."""
        return self._run_id_to_tool_call_id.get(run_id)

    def register_alias(self, new_run_id: str, tool_call_id: str) -> None:
        """Record that *new_run_id* should resolve to *tool_call_id*.

        Used on the resume-after-approval path where LangGraph generates
        a fresh run_id for a tool that StatusBuilder already tracks under
        its original tool_call_id.
        """
        self._aliases[new_run_id] = tool_call_id

    def resolve(self, run_id: str) -> str:
        """Resolve *run_id* to the canonical tool_call_id.

        Checks aliases first (resume path), then the callback capture,
        and falls back to *run_id* unchanged.
        """
        return self._aliases.get(run_id) or self._run_id_to_tool_call_id.get(run_id) or run_id
