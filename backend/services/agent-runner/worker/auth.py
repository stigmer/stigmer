"""Process-wide auth token for worker activities.

The runner authenticates to the Stigmer backend using a single credential
(JWT or API key) stored here at worker startup.  Activities retrieve the
token via :func:`get_token` and pass it to :class:`ChannelProvider` or
individual gRPC clients.
"""

_token: str | None = None


def configure(token: str) -> None:
    """Set the process-wide auth token (called once at worker startup)."""
    global _token
    _token = token


def get_token() -> str | None:
    """Return the current auth token, or None if not yet configured."""
    return _token
