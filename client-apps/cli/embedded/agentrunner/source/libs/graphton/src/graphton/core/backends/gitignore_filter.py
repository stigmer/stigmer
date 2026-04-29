""".gitignore pattern matching for workspace file filtering.

Provides :class:`GitIgnoreFilter`, an immutable value object that wraps a
compiled ``pathspec.PathSpec`` matcher.  Consumers obtain an instance via the
``from_file`` or ``from_content`` factory methods and then call
:meth:`is_ignored` to test individual paths.

The filter is intentionally decoupled from any backend or filesystem
abstraction so that it can be used by:

* ``FilesystemBackend`` (local agent runtime)
* ``WorkspaceNormalizingBackend`` (Daytona sandbox)
* ``tree.py`` (system-prompt tree generation)

v1 scope: root-level ``.gitignore`` only.  The interface is
forward-compatible with nested ``.gitignore`` support — the implementation
can be swapped later without changing callers.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pathspec

logger = logging.getLogger(__name__)


class GitIgnoreFilter:
    """Immutable filter that checks paths against ``.gitignore`` patterns.

    Constructed via :meth:`from_file` or :meth:`from_content`; never
    instantiated directly by callers.

    The compiled ``pathspec.PathSpec`` is stored once and reused for every
    :meth:`is_ignored` call.
    """

    __slots__ = ("_spec",)

    def __init__(self, spec: pathspec.PathSpec) -> None:
        self._spec = spec

    # -- Factory methods ---------------------------------------------------

    @classmethod
    def from_file(cls, gitignore_path: Path) -> GitIgnoreFilter | None:
        """Parse a ``.gitignore`` file on disk.

        Returns ``None`` when the file does not exist, is unreadable, or
        contains no actionable patterns — so callers can use a simple
        ``if filter is not None`` guard without special-casing errors.
        """
        try:
            content = gitignore_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeDecodeError):
            return None
        return cls.from_content(content)

    @classmethod
    def from_content(cls, content: str) -> GitIgnoreFilter | None:
        """Parse raw ``.gitignore`` text.

        Returns ``None`` when *content* is empty or contains only blank
        lines / comments (no actionable patterns).
        """
        spec = pathspec.PathSpec.from_lines("gitwildmatch", content.splitlines())
        if not any(p.regex is not None for p in spec.patterns):
            return None
        return cls(spec)

    # -- Query -------------------------------------------------------------

    def is_ignored(self, rel_path: str, *, is_dir: bool | None = None) -> bool:
        """Check whether *rel_path* matches a ``.gitignore`` pattern.

        Args:
            rel_path: Path relative to the workspace root, using forward
                slashes (e.g. ``"src/utils/helper.py"``).  Must **not**
                have a trailing ``/``.
            is_dir: Entry type hint used for directory-only patterns
                (patterns ending with ``/`` in ``.gitignore``).

                * ``True``  — known directory: checks *rel_path* and
                  *rel_path/* (catches ``venv/``-style patterns).
                * ``False`` — known file: checks *rel_path* only.
                * ``None``  — type unknown (e.g. remote Daytona entries):
                  checks both, accepting a negligible over-filter risk
                  for the extremely rare case of a *file* whose name
                  matches a directory-only pattern.
        """
        if self._spec.match_file(rel_path):
            return True
        if is_dir is not False:
            return self._spec.match_file(rel_path + "/")
        return False
