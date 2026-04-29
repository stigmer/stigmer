"""StatusBuilder event handler modules.

This package contains the event-processing logic extracted from
``StatusBuilder``.  Each module groups a cohesive set of handler
functions that operate on a ``StatusBuilder`` instance passed as the
first argument (``sb``).  StatusBuilder remains the thin orchestrator
that dispatches events and exposes the public API surface.

Modules
-------
formatting
    Stateless content-extraction and display-formatting utilities.
streaming_buffers
    Streaming buffer management for early tool calls, thinking, and tool input.
sub_agent
    Sub-agent lifecycle: start, end, finalization, subject generation.
context
    Context info, summarization events, artifacts, workspace write-backs.
tool_event
    Tool start/end/progress, approval checks, todos, arg humanization.
chat_model
    Chat model stream/end: AI message creation, usage metric capture.
"""
