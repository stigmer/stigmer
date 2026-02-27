"""Virtual platform mount — shared path classification for `.stigmer/` routing.

The platform owns the ``.stigmer/`` namespace inside the agent's virtual view
of the workspace.  Platform files (skills, inputs) physically live in an
external ``platform_dir`` that is separate from the workspace ``root_dir``.

Backend path-resolution methods call :func:`classify_platform_path` to decide
whether a given path targets the platform mount or the workspace.  This keeps
the routing decision in a single place while each backend handles resolution
in its own way (``Path.resolve()`` vs string concat, containment checks vs
sandbox enforcement, etc.).

See design decision AD-01 v3 (virtual platform mount) for full rationale.
"""

from __future__ import annotations

PLATFORM_PREFIX = ".stigmer/"
"""Prefix that identifies paths targeting the virtual platform mount."""

PLATFORM_DIR_NAME = ".stigmer"
"""Directory name used in listings and equality checks."""

STIGMER_PLATFORM_DIR_ENV = "STIGMER_PLATFORM_DIR"
"""Environment variable injected into ``execute()`` calls so shell commands
can access platform files via ``$STIGMER_PLATFORM_DIR/skills/…``."""


def classify_platform_path(rel_path: str) -> tuple[bool, str]:
    """Classify whether *rel_path* targets the virtual platform mount.

    Strips leading slashes before checking so that absolute-looking paths
    (``/.stigmer/skills/…``) are handled identically to relative ones.

    Returns:
        A two-tuple ``(is_platform, remainder)``.

        *is_platform* is ``True`` when the path falls under ``.stigmer/``.
        *remainder* is the path relative to whichever root applies:

        - When ``is_platform`` is ``True``, *remainder* is relative to
          ``platform_dir`` (e.g. ``"skills/my-skill/SKILL.md"``).
        - When ``is_platform`` is ``False``, *remainder* is the cleaned
          path relative to the workspace ``root_dir``.

    Examples::

        >>> classify_platform_path(".stigmer/skills/a/SKILL.md")
        (True, 'skills/a/SKILL.md')
        >>> classify_platform_path("/.stigmer/inputs/data.pdf")
        (True, 'inputs/data.pdf')
        >>> classify_platform_path(".stigmer")
        (True, '')
        >>> classify_platform_path("src/main.py")
        (False, 'src/main.py')
        >>> classify_platform_path("/bin/skills")
        (False, 'bin/skills')
    """
    clean = rel_path.lstrip("/")

    if clean.startswith(PLATFORM_PREFIX):
        return True, clean[len(PLATFORM_PREFIX):]

    if clean == PLATFORM_DIR_NAME:
        return True, ""

    return False, clean
