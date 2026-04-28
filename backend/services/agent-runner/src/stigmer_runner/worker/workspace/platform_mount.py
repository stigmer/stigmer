"""Backward-compatible re-exports from the canonical platform_mount module.

All platform-mount logic lives in ``graphton.core.backends.platform_mount``.
This module re-exports the subset used by ``worker.workspace`` consumers
so existing imports continue to work without changes.
"""

from graphton.core.backends.platform_mount import (  # noqa: F401
    PLATFORM_DIR_NAME,
    PLATFORM_PREFIX,
    STIGMER_PLATFORM_DIR_ENV,
    classify_platform_path,
    resolve_platform_command,
)
