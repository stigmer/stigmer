"""Task-aware relevance signaling for agent system prompts.

Extracts file path candidates from the user's message, resolves them
against the workspace filesystem, and produces a prompt section listing
confirmed paths so the agent starts with targeted file awareness.

Phase A covers explicit file path references only (paths with ``/``
separators or recognised source-code extensions).  Identifier-based
search (class names, function names) is deferred to Phase B.

Architecture
------------
Three pure-ish functions compose left-to-right::

    extract_file_path_candidates    (str -> list[str])
    resolve_workspace_paths         (list[str], Sequence[WorkspaceRoot] -> list[ResolvedPath])
    build_relevance_prompt_section  (str, Sequence[WorkspaceRoot] -> str)

The public entry point is ``build_relevance_prompt_section``.

Multi-workspace support
~~~~~~~~~~~~~~~~~~~~~~~
Both ``resolve_workspace_paths`` and ``build_relevance_prompt_section``
accept a sequence of ``WorkspaceRoot`` entries.  Each candidate path is
tried against roots in order; the first existing match wins and is
stamped with that entry's name.  Single-workspace sessions pass a list
of length 1 with an empty name — output is identical to the original
single-root behaviour.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass

from stigmer_runner.worker.workspace.tree import human_size

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_RESULTS: int = 15

# Extensions that identify a token as a likely file reference even when it
# contains no ``/``.  Kept intentionally broad — false positives are cheap
# (we verify existence) while false negatives silently lose value.
_SOURCE_EXTENSIONS: frozenset[str] = frozenset({
    # Languages
    ".py", ".pyi", ".go", ".rs", ".ts", ".tsx", ".js", ".jsx",
    ".java", ".kt", ".kts", ".scala", ".rb", ".php", ".swift",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".lua", ".zig",
    ".ex", ".exs", ".erl", ".hs", ".ml", ".mli", ".r",
    # Config / data
    ".yaml", ".yml", ".json", ".toml", ".cfg", ".ini", ".env",
    ".xml", ".html", ".css", ".scss", ".less", ".svg",
    # Docs / markup
    ".md", ".rst", ".txt", ".adoc",
    # Build / infra
    ".sh", ".bash", ".zsh", ".fish",
    ".tf", ".hcl", ".proto", ".graphql", ".sql",
    # Speciality files (matched by exact name later)
    ".lock", ".mod", ".sum",
})

# Exact filenames (no extension pattern) that are common project files.
_KNOWN_FILENAMES: frozenset[str] = frozenset({
    "Dockerfile", "Makefile", "Procfile", "Vagrantfile",
    "Gemfile", "Rakefile", "Justfile", "Taskfile",
    "docker-compose.yml", "docker-compose.yaml",
    "go.mod", "go.sum",
})


# ---------------------------------------------------------------------------
# Value Objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkspaceRoot:
    """A labeled workspace entry root for relevance resolution.

    Attributes:
        name:     Entry label (e.g. ``"svc-api"``).  Empty string for
                  single-workspace sessions.
        root_dir: Absolute path to the entry's root directory.
    """

    name: str
    root_dir: str


@dataclass(frozen=True)
class ResolvedPath:
    """A workspace-relative path confirmed to exist on the filesystem.

    Attributes:
        path:         Workspace-relative path (forward slashes).
        is_directory: ``True`` when the path points to a directory.
        size_bytes:   File size in bytes, or ``None`` for directories.
        entry_name:   Which workspace entry the path was found in.
                      Empty string for single-workspace sessions.
    """

    path: str
    is_directory: bool
    size_bytes: int | None = None
    entry_name: str = ""


# ---------------------------------------------------------------------------
# Step 1 — Extraction
# ---------------------------------------------------------------------------

# Characters stripped from both ends of a raw token before evaluation.
_STRIP_CHARS = "`\"'()[]{},:;<>!?"


def _clean_token(token: str) -> str:
    """Strip common surrounding punctuation / markdown formatting."""
    return token.strip(_STRIP_CHARS)


def _has_path_separator(token: str) -> bool:
    return "/" in token


def _is_url(token: str) -> bool:
    return "://" in token


def _is_email_like(token: str) -> bool:
    return token.startswith("@") or ("@" in token and "." in token.split("@")[-1])


def _has_source_extension(token: str) -> bool:
    _, ext = os.path.splitext(token)
    return ext.lower() in _SOURCE_EXTENSIONS


def _is_known_filename(token: str) -> bool:
    basename = os.path.basename(token)
    return basename in _KNOWN_FILENAMES


def extract_file_path_candidates(message: str) -> list[str]:
    """Extract tokens from *message* that look like workspace file paths.

    Heuristics (applied after stripping surrounding punctuation):
    * Contains ``/`` but not ``://`` (URL exclusion).
    * OR has a recognised source-code file extension.
    * OR is a known project filename (``Dockerfile``, ``Makefile``, ...).

    Tokens prefixed with ``@`` and tokens containing ``://`` are excluded.
    Results are deduplicated (preserving first-seen order).

    Returns an empty list when no candidates are found.
    """
    if not message or not message.strip():
        return []

    seen: set[str] = set()
    candidates: list[str] = []

    for raw_token in message.split():
        token = _clean_token(raw_token)
        if not token:
            continue

        if _is_url(token) or _is_email_like(token):
            continue

        # Trailing slash is valid for directory references, but strip a
        # trailing period that often ends a sentence ("... in src/auth/.")
        if token.endswith(".") and not _has_source_extension(token):
            token = token.rstrip(".")

        is_candidate = (
            _has_path_separator(token)
            or _has_source_extension(token)
            or _is_known_filename(token)
        )
        if is_candidate and token not in seen:
            seen.add(token)
            candidates.append(token)

    return candidates


# ---------------------------------------------------------------------------
# Step 2 — Resolution
# ---------------------------------------------------------------------------


def resolve_workspace_paths(
    candidates: list[str],
    workspace_roots: Sequence[WorkspaceRoot],
) -> list[ResolvedPath]:
    """Check each candidate against workspace entry roots and return confirmed paths.

    For each candidate, roots are tried in order; the first existing
    match wins and is stamped with that entry's name.  Non-existent
    paths are silently dropped (false positives from extraction are
    expected).  Stat failures are logged and skipped.
    """
    resolved: list[ResolvedPath] = []

    for candidate in candidates:
        for root in workspace_roots:
            full_path = os.path.join(root.root_dir, candidate)
            try:
                if os.path.isdir(full_path):
                    resolved.append(ResolvedPath(
                        path=candidate.rstrip("/") + "/",
                        is_directory=True,
                        entry_name=root.name,
                    ))
                    break
                if os.path.isfile(full_path):
                    try:
                        size = os.path.getsize(full_path)
                    except OSError:
                        size = None
                    resolved.append(ResolvedPath(
                        path=candidate,
                        is_directory=False,
                        size_bytes=size,
                        entry_name=root.name,
                    ))
                    break
            except OSError:
                logger.debug(
                    "Stat failed for candidate %r under root %r, skipping",
                    candidate,
                    root.root_dir,
                )

    return resolved


# ---------------------------------------------------------------------------
# Step 3 — Prompt formatting
# ---------------------------------------------------------------------------


def _format_resolved_path(rp: ResolvedPath) -> str:
    """Format a single resolved path as a markdown list item."""
    suffix = f" — in **{rp.entry_name}**" if rp.entry_name else ""
    if rp.is_directory:
        return f"- `{rp.path}` (directory){suffix}"
    if rp.size_bytes is not None:
        return f"- `{rp.path}` ({human_size(rp.size_bytes)}){suffix}"
    return f"- `{rp.path}`{suffix}"


def build_relevance_prompt_section(
    user_message: str,
    workspace_roots: Sequence[WorkspaceRoot],
    *,
    max_results: int = _MAX_RESULTS,
) -> str:
    """Build the ``## Potentially Relevant Files`` system prompt section.

    Extracts file-path candidates from *user_message*, resolves them
    against *workspace_roots*, and formats the confirmed paths into a
    prompt section.  Returns an empty string when no paths resolve.

    Args:
        user_message:    The raw user message text.
        workspace_roots: Ordered workspace entry roots to resolve against.
        max_results:     Maximum number of resolved paths to include.

    Returns:
        The formatted prompt section (with leading newlines for
        concatenation), or ``""`` if nothing resolved.
    """
    candidates = extract_file_path_candidates(user_message)
    if not candidates:
        return ""

    resolved = resolve_workspace_paths(candidates, workspace_roots)
    if not resolved:
        return ""

    capped = resolved[:max_results]

    lines = [_format_resolved_path(rp) for rp in capped]

    section = (
        "\n\n## Potentially Relevant Files\n\n"
        "Based on your message, these workspace files may be relevant:\n\n"
    )
    section += "\n".join(lines)

    if len(resolved) > max_results:
        section += (
            f"\n\n({len(resolved) - max_results} additional match(es) omitted)"
        )

    logger.info(
        "Relevance signaling: %d candidate(s) extracted, %d resolved, "
        "%d included in prompt",
        len(candidates),
        len(resolved),
        len(capped),
    )

    return section
