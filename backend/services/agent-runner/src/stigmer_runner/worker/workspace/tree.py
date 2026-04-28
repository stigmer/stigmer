"""Workspace file-tree generation for system prompt injection.

Provides two tree-walking strategies behind a single public API:

    build_directory_tree     Local ``os.*`` walker (fast, rich metadata).
    build_workspace_file_tree  Public entry point — picks the right walker
                               (local or remote) and formats the result into
                               a prompt-ready ``### Project Structure`` section.

The local walker is also used by ``build_referenced_files_prompt_section``
in ``execute_graphton.py`` for inline directory expansion.

Remote tree generation uses ``backend.execute("find ...")`` with GNU
``find -printf`` to walk the tree inside a Daytona sandbox, then parses
and sorts the output to match the local walker's DFS dirs-first ordering.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graphton.core.backends.gitignore_filter import GitIgnoreFilter

    from stigmer_runner.worker.workspace.backend import WorkspaceBackend

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Directories excluded from the system-prompt directory tree.  Hidden entries
# (names starting with ".") are filtered separately in build_directory_tree().
#
# NOTE: graphton's FilesystemBackend._SKIP_DIR_NAMES (filesystem.py) mirrors
# this set for tool-level traversals (ls, glob, grep).  Keep them aligned.
TREE_SKIP_DIRS: frozenset[str] = frozenset({
    ".git", "__pycache__", "node_modules", ".stigmer",
    "venv", "dist", "target", "vendor", "coverage", "bower_components",
})

TREE_DEFAULT_MAX_DEPTH: int = 3
TREE_DEFAULT_MAX_ENTRIES: int = 200

_WORKSPACE_TREE_MAX_DEPTH: int = 4
_WORKSPACE_TREE_MAX_ENTRIES: int = 500


# ---------------------------------------------------------------------------
# Shared formatting
# ---------------------------------------------------------------------------


def human_size(size_bytes: int) -> str:
    """Format a byte count as a compact human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} bytes"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


# ---------------------------------------------------------------------------
# Local walker (os.* calls)
# ---------------------------------------------------------------------------


def build_directory_tree(
    root: str,
    prefix: str,
    *,
    skip_dirs: frozenset[str] = TREE_SKIP_DIRS,
    max_depth: int = TREE_DEFAULT_MAX_DEPTH,
    max_entries: int = TREE_DEFAULT_MAX_ENTRIES,
    gitignore_filter: GitIgnoreFilter | None = None,
) -> tuple[list[str], int]:
    """Recursively collect a file-tree manifest for a local directory.

    Returns ``(lines, total_count)`` where *lines* contains at most
    *max_entries* formatted strings and *total_count* is the true number
    of entries discovered (used to signal truncation).

    Each line is a markdown list item: ``    - `rel/path/` `` for
    directories or ``    - `rel/path` (size)`` for files.  Directories
    are listed before files at each level, both sorted alphabetically.

    When *gitignore_filter* is provided, entries matching ``.gitignore``
    patterns are excluded in addition to the hardcoded *skip_dirs* set.
    """
    lines: list[str] = []
    total = 0

    def _walk(dir_path: str, rel_prefix: str, depth: int) -> None:
        nonlocal total
        if depth > max_depth:
            return
        try:
            entries = sorted(os.listdir(dir_path))
        except OSError:
            return

        child_dirs: list[tuple[str, str, str]] = []
        child_files: list[tuple[str, str, int | None]] = []

        for name in entries:
            if name.startswith(".") or name in skip_dirs:
                continue
            full = os.path.join(dir_path, name)
            rel = f"{rel_prefix}{name}" if rel_prefix else name
            try:
                is_dir = os.path.isdir(full)
            except OSError:
                is_dir = False
            if gitignore_filter is not None and gitignore_filter.is_ignored(
                rel, is_dir=is_dir,
            ):
                continue
            try:
                if is_dir:
                    child_dirs.append((full, rel, name))
                else:
                    child_files.append((rel, name, os.path.getsize(full)))
            except OSError:
                child_files.append((rel, name, None))

        for full, rel, _name in child_dirs:
            total += 1
            if len(lines) < max_entries:
                lines.append(f"    - `{rel}/`")
            _walk(full, f"{rel}/", depth + 1)

        for rel, _name, size in child_files:
            total += 1
            if len(lines) < max_entries:
                size_str = f" ({human_size(size)})" if size is not None else ""
                lines.append(f"    - `{rel}`{size_str}")

    _walk(root, prefix, 1)
    return lines, total


# ---------------------------------------------------------------------------
# Remote walker (backend.execute with GNU find)
# ---------------------------------------------------------------------------


def _build_find_command(
    *,
    skip_dirs: frozenset[str],
    max_depth: int,
) -> str:
    """Build a GNU ``find`` command that mirrors the local walker's filtering.

    The command outputs tab-delimited lines:
        ``D\\t<relative-path>``    for directories
        ``F\\t<size>\\t<relative-path>``  for files

    Hidden entries and skip directories are pruned.
    """
    prune_names = sorted({*skip_dirs, ".*"})
    prune_clauses = " -o ".join(f"-name '{n}'" for n in prune_names)

    return (
        f"find . -maxdepth {max_depth} "
        f"\\( {prune_clauses} \\) -prune "
        f"-o -type d -printf 'D\\t%P\\n' "
        f"-o -type f -printf 'F\\t%s\\t%P\\n'"
    )


def _parse_find_output(
    stdout: str,
    *,
    max_entries: int,
    gitignore_filter: GitIgnoreFilter | None = None,
) -> tuple[list[str], int]:
    """Parse GNU ``find -printf`` output into formatted tree lines.

    Entries are sorted into DFS dirs-first order (matching the local
    walker) and capped at *max_entries*.  When *gitignore_filter* is
    provided, matching entries are excluded before sorting.
    """
    dirs: list[str] = []
    files: list[tuple[str, int | None]] = []

    for line in stdout.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0] == "D":
            path = parts[1]
            if path:
                if gitignore_filter is not None and gitignore_filter.is_ignored(
                    path, is_dir=True,
                ):
                    continue
                dirs.append(path)
        elif len(parts) >= 3 and parts[0] == "F":
            path = parts[2]
            if path:
                if gitignore_filter is not None and gitignore_filter.is_ignored(
                    path, is_dir=False,
                ):
                    continue
                try:
                    size = int(parts[1])
                except ValueError:
                    size = None
                files.append((path, size))

    return _sort_and_format(dirs, files, max_entries=max_entries)


def _sort_and_format(
    dirs: list[str],
    files: list[tuple[str, int | None]],
    *,
    max_entries: int,
) -> tuple[list[str], int]:
    """Sort parsed entries into DFS dirs-first order and format as lines.

    Reproduces the local walker's traversal: at each directory level,
    child directories come first (alphabetically), then child files
    (alphabetically), with recursive descent into each directory before
    moving to the next sibling.
    """
    from collections import defaultdict

    dir_children: dict[str, list[str]] = defaultdict(list)
    file_children: dict[str, list[tuple[str, int | None]]] = defaultdict(list)

    for d in dirs:
        parent = os.path.dirname(d) or ""
        dir_children[parent].append(d)
    for path, size in files:
        parent = os.path.dirname(path) or ""
        file_children[parent].append((path, size))

    for key in dir_children:
        dir_children[key].sort(key=lambda p: os.path.basename(p).lower())
    for key in file_children:
        file_children[key].sort(key=lambda t: os.path.basename(t[0]).lower())

    lines: list[str] = []
    total = 0

    def _dfs(parent: str) -> None:
        nonlocal total
        for d in dir_children.get(parent, []):
            total += 1
            if len(lines) < max_entries:
                lines.append(f"    - `{d}/`")
            _dfs(d)
        for path, size in file_children.get(parent, []):
            total += 1
            if len(lines) < max_entries:
                size_str = f" ({human_size(size)})" if size is not None else ""
                lines.append(f"    - `{path}`{size_str}")

    _dfs("")
    return lines, total


def _build_directory_tree_via_find(
    backend: WorkspaceBackend,
    *,
    skip_dirs: frozenset[str] = TREE_SKIP_DIRS,
    max_depth: int = _WORKSPACE_TREE_MAX_DEPTH,
    max_entries: int = _WORKSPACE_TREE_MAX_ENTRIES,
    gitignore_filter: GitIgnoreFilter | None = None,
    cwd: str | None = None,
) -> tuple[list[str], int] | None:
    """Walk a remote workspace directory tree using ``backend.execute()``.

    When *cwd* is set, the ``find`` command runs inside that
    subdirectory (relative to ``backend.root_dir``) so only the
    entry's files are included.  Used for multi-entry cloud mode.

    Returns ``(lines, total_count)`` on success, or ``None`` if the
    command fails or produces no parseable output.
    """
    cmd = _build_find_command(skip_dirs=skip_dirs, max_depth=max_depth)

    try:
        result = backend.execute(cmd, cwd=cwd, timeout=30)
    except Exception:
        logger.warning("Tree generation via find failed with exception", exc_info=True)
        return None

    if result.exit_code != 0:
        logger.warning(
            "Tree generation via find exited with code %d: %s",
            result.exit_code,
            result.stderr[:200],
        )
        return None

    if not result.stdout.strip():
        return [], 0

    return _parse_find_output(
        result.stdout, max_entries=max_entries, gitignore_filter=gitignore_filter,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_workspace_file_tree(
    root_dir: str,
    backend: WorkspaceBackend,
    *,
    is_local_mode: bool,
    max_depth: int = _WORKSPACE_TREE_MAX_DEPTH,
    max_entries: int = _WORKSPACE_TREE_MAX_ENTRIES,
    gitignore_filter: GitIgnoreFilter | None = None,
    cwd: str | None = None,
    heading_level: int = 3,
) -> str | None:
    """Generate a formatted workspace file-tree section for the system prompt.

    Picks the right walker based on *is_local_mode*:

    - **Local mode:** Uses ``os.listdir`` / ``os.path.isdir`` directly
      on *root_dir*.  Fast and produces rich metadata (file sizes).
    - **Remote mode (Daytona):** Uses ``backend.execute("find ...")``
      with GNU ``find -printf`` to walk the tree inside the sandbox.

    When *cwd* is set (multi-entry cloud mode), the remote ``find``
    runs inside that subdirectory of ``backend.root_dir``.  Local mode
    is unaffected — it always uses *root_dir* directly.

    When *gitignore_filter* is provided, entries matching ``.gitignore``
    patterns are excluded from the tree.

    Args:
        heading_level: Markdown heading depth for the tree heading
            (default 3 → ``### Project Structure``).  Multi-entry
            callers pass 4 so the tree nests under per-entry headings.

    Returns a prompt-ready string starting with the ``Project Structure``
    heading (including header, tree lines, and truncation notice), or
    ``None`` if the workspace is empty or tree generation fails.
    """
    if is_local_mode:
        lines, total = build_directory_tree(
            root_dir,
            "",
            max_depth=max_depth,
            max_entries=max_entries,
            gitignore_filter=gitignore_filter,
        )
    else:
        result = _build_directory_tree_via_find(
            backend,
            max_depth=max_depth,
            max_entries=max_entries,
            gitignore_filter=gitignore_filter,
            cwd=cwd,
        )
        if result is None:
            return None
        lines, total = result

    if not lines:
        return None

    return _format_workspace_tree(lines, total, max_entries, heading_level=heading_level)


TREE_HEADING_TITLE = "Project Structure"
"""Heading text used in the formatted tree section.

The default heading level is ``###`` (H3), suitable for the legacy
single-workspace prompt (``## Workspace`` → ``### Project Structure``).
Multi-entry prompts pass ``heading_level=4`` so the tree nests under
the per-entry ``### {name}`` heading.
"""


def _format_workspace_tree(
    lines: list[str],
    total: int,
    max_entries: int,
    *,
    heading_level: int = 3,
) -> str:
    """Format tree lines into a complete prompt section.

    Args:
        heading_level: Markdown heading depth (default 3 → ``###``).
    """
    tree_text = "\n".join(lines)

    if total > len(lines):
        footer = (
            f"\nShowing {len(lines):,} of {total:,} entries. "
            "Use `glob` and `grep` to discover additional files."
        )
    else:
        label = "entry" if total == 1 else "entries"
        footer = (
            f"\n{total:,} {label}. "
            "Use `read` to view file contents, `grep` to search, "
            "and `glob` to find specific files."
        )

    heading = "#" * heading_level
    return f"{heading} {TREE_HEADING_TITLE}\n\n{tree_text}\n{footer}"
