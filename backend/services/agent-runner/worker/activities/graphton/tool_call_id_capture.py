"""Capture tool_call_id from LangChain's callback API.

LangGraph v2 stream events do not surface the model's ``tool_call_id``
(e.g. ``toolu_01abc…``) on ``on_tool_start`` or ``on_tool_end``.  The
callback API *does* receive it as a keyword argument.  This handler
bridges the gap by storing ``{run_id → tool_call_id}`` so that
StatusBuilder can resolve the identity when processing v2 events.
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
    """

    def __init__(self) -> None:
        self._run_id_to_tool_call_id: dict[str, str] = {}

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
