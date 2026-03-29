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
"""
