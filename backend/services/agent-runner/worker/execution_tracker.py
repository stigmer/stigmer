"""Process-wide counter for active Temporal activity executions.

The idle watchdog reads :func:`last_activity_at` to determine how long
the runner has been idle.  The timestamp is monotonic (immune to wall-
clock adjustments) and is updated on every :func:`increment` and
:func:`decrement` call — so any activity event resets the idle timer.

All registered activities run on a single asyncio event loop, so no
locking is needed.  Each activity calls :func:`increment` at entry and
:func:`decrement` in a ``finally`` block.
"""

from time import monotonic

_count: int = 0
_last_activity_at: float = monotonic()


def increment() -> int:
    """Record an activity starting. Returns the new count."""
    global _count, _last_activity_at
    _count += 1
    _last_activity_at = monotonic()
    return _count


def decrement() -> int:
    """Record an activity finishing. Returns the new count (floor 0)."""
    global _count, _last_activity_at
    _count = max(0, _count - 1)
    _last_activity_at = monotonic()
    return _count


def get_count() -> int:
    """Return the number of currently active executions."""
    return _count


def last_activity_at() -> float:
    """Return the monotonic timestamp of the last activity event.

    Initialized to process startup time, so a runner that never receives
    work will also be considered idle after the timeout elapses.
    """
    return _last_activity_at
