"""Exception classes for Stigmer SDK."""


class StigmerError(Exception):
    """Base exception for all Stigmer errors."""

    pass


class ValidationError(StigmerError):
    """Raised when validation fails."""

    def __init__(self, message: str, field: str | None = None):
        self.field = field
        super().__init__(message)
