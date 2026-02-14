"""Global API key holder for worker activities."""


# Global API key accessible to activities
_api_key: str | None = None


def get_api_key() -> str | None:
    """Get the global API key."""
    return _api_key


def set_api_key(api_key: str) -> None:
    """Set the global API key."""
    global _api_key
    _api_key = api_key
