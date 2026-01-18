"""Global API key holder for worker activities."""

from typing import Optional


# Global API key accessible to activities
_api_key: Optional[str] = None


def get_api_key() -> Optional[str]:
    """Get the global API key."""
    return _api_key


def set_api_key(api_key: str) -> None:
    """Set the global API key."""
    global _api_key
    _api_key = api_key
