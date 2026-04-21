"""Process-wide counter for active Temporal activity executions.

The heartbeat emitter reads this counter to determine the runner's phase
(READY vs BUSY) and to report ``current_executions`` on each heartbeat.

All registered activities run on a single asyncio event loop, so no
locking is needed.  Each activity calls :func:`increment` at entry and
:func:`decrement` in a ``finally`` block.
"""

_count: int = 0


def increment() -> int:
    """Record an activity starting. Returns the new count."""
    global _count
    _count += 1
    return _count


def decrement() -> int:
    """Record an activity finishing. Returns the new count (floor 0)."""
    global _count
    _count = max(0, _count - 1)
    return _count


def get_count() -> int:
    """Return the number of currently active executions."""
    return _count
