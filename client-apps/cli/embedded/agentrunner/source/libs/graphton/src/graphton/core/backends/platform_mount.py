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

import os
import re

PLATFORM_PREFIX = ".stigmer/"
"""Prefix that identifies paths targeting the virtual platform mount."""

PLATFORM_DIR_NAME = ".stigmer"
"""Directory name used in listings and equality checks."""

STIGMER_PLATFORM_DIR_ENV = "STIGMER_PLATFORM_DIR"
"""Environment variable injected into ``execute()`` calls so shell commands
can access platform files via ``$STIGMER_PLATFORM_DIR/skills/…``."""

_PLATFORM_ENV_RE = re.compile(
    r"\$\{" + STIGMER_PLATFORM_DIR_ENV + r"\}"
    r"|\$" + STIGMER_PLATFORM_DIR_ENV + r"(?![A-Za-z0-9_])"
)
"""Matches ``$STIGMER_PLATFORM_DIR`` and ``${STIGMER_PLATFORM_DIR}`` in
display strings.  Brace form is tried first so the replacement does not
leave stray braces.  The negative lookahead on the bare-dollar form
prevents matching ``$STIGMER_PLATFORM_DIR_OTHER`` as a false positive."""


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


def humanize_platform_refs(text: str) -> str:
    """Replace platform environment-variable references with the user-facing
    ``.stigmer`` virtual-mount prefix.

    Intended for display strings only (approval previews, messages) — **not**
    for the actual command executed in the sandbox, where the shell must expand
    the real environment variable.

    Handles both ``$STIGMER_PLATFORM_DIR`` and ``${STIGMER_PLATFORM_DIR}``.

    Examples::

        >>> humanize_platform_refs("python3 $STIGMER_PLATFORM_DIR/skills/s/run.py")
        'python3 .stigmer/skills/s/run.py'
        >>> humanize_platform_refs("${STIGMER_PLATFORM_DIR}/skills/s/run.py")
        '.stigmer/skills/s/run.py'
        >>> humanize_platform_refs("echo $STIGMER_PLATFORM_DIR")
        'echo .stigmer'
        >>> humanize_platform_refs("ls -la")
        'ls -la'
    """
    if not text:
        return text
    return _PLATFORM_ENV_RE.sub(PLATFORM_DIR_NAME, text)


_STIGMER_DIR_CMD_RE = re.compile(
    r"(?<!\w)(?<!/)"
    r"\.stigmer"
    r"(?![a-zA-Z0-9_])"
)
"""Matches ``.stigmer`` in shell commands when it appears as a standalone
path component (e.g. ``.stigmer/skills/…``), not as part of a longer name
(``my.stigmer``) or a subdirectory (``foo/.stigmer``)."""


def resolve_platform_command(command: str) -> str:
    """Replace ``.stigmer`` virtual-mount references in a shell command with
    the ``$STIGMER_PLATFORM_DIR`` environment variable.

    The execute environment already has ``STIGMER_PLATFORM_DIR`` set (via
    ``_build_execute_env``), so the shell expands the variable at runtime.

    This is the inverse of :func:`humanize_platform_refs`: that function
    rewrites ``$STIGMER_PLATFORM_DIR`` → ``.stigmer`` for display, while
    this function rewrites ``.stigmer`` → ``$STIGMER_PLATFORM_DIR`` for
    execution.

    Callers **must** guard this behind ``if platform_root is not None`` to
    avoid replacing ``.stigmer`` when it is a real directory (no virtual
    mount active).

    Examples::

        >>> resolve_platform_command("python3 .stigmer/skills/s/run.py")
        'python3 $STIGMER_PLATFORM_DIR/skills/s/run.py'
        >>> resolve_platform_command("ls .stigmer")
        'ls $STIGMER_PLATFORM_DIR'
        >>> resolve_platform_command("echo foo/.stigmer/bar")
        'echo foo/.stigmer/bar'
        >>> resolve_platform_command("ls -la")
        'ls -la'
    """
    if not command:
        return command
    return _STIGMER_DIR_CMD_RE.sub(f"${STIGMER_PLATFORM_DIR_ENV}", command)


def humanize_sandbox_paths(text: str, workspace_root: str) -> str:
    """Replace absolute sandbox workspace paths with workspace-relative display
    paths.

    Intended for display strings only (approval previews, streamed messages) —
    **not** for the actual command executed in the sandbox, where absolute paths
    must resolve correctly.

    Performs two ordered replacements:

    1. ``workspace_root + "/"`` → empty string (strips the prefix so paths
       become workspace-relative, e.g. ``plantonhq/agent-fleet/…``).
    2. ``workspace_root`` (exact, at a word boundary) → ``"."`` (the workspace
       root itself, e.g. ``cd /home/daytona/workspace`` → ``cd .``).
    3. The sandbox home directory (parent of ``workspace_root``) → ``"~"``
       for paths outside the workspace (e.g. ``/home/daytona/.bashrc`` →
       ``~/.bashrc``).

    Returns *text* unchanged when *workspace_root* is empty (local mode or
    not yet resolved).

    Examples::

        >>> humanize_sandbox_paths(
        ...     "ls /home/daytona/workspace/plantonhq/",
        ...     "/home/daytona/workspace",
        ... )
        'ls plantonhq/'
        >>> humanize_sandbox_paths(
        ...     "cd /home/daytona/workspace && ls",
        ...     "/home/daytona/workspace",
        ... )
        'cd . && ls'
        >>> humanize_sandbox_paths(
        ...     "cat /home/daytona/.bashrc",
        ...     "/home/daytona/workspace",
        ... )
        'cat ~/.bashrc'
        >>> humanize_sandbox_paths("ls -la", "/home/daytona/workspace")
        'ls -la'
        >>> humanize_sandbox_paths("anything", "")
        'anything'
    """
    if not text or not workspace_root:
        return text

    # Normalize: strip trailing slashes for consistent matching.
    ws_root = workspace_root.rstrip("/")

    # 1) Replace workspace_root + "/" prefix with empty string
    #    (turns absolute workspace paths into relative ones).
    text = text.replace(ws_root + "/", "")

    # 2) Replace bare workspace_root references (e.g. `cd /home/daytona/workspace`)
    #    with "." — must run after the slash-suffixed replacement above.
    text = text.replace(ws_root, ".")

    # 3) Replace sandbox home directory prefix with "~" for paths outside
    #    the workspace (e.g. /home/daytona/.git-credentials → ~/.git-credentials).
    sandbox_home = os.path.dirname(ws_root)
    if sandbox_home and sandbox_home != "/":
        text = text.replace(sandbox_home + "/", "~/")
        text = text.replace(sandbox_home, "~")

    return text


def resolve_display_env_vars(
    text: str,
    env_vars: dict[str, str] | None,
    secret_keys: set[str] | None = None,
) -> str:
    """Resolve agent environment-variable references to their values in a
    display string.

    Replaces ``$KEY`` and ``${KEY}`` with the corresponding value from
    *env_vars* for every key that is **not** marked as secret.  The
    *secret_keys* set is derived from the ``is_secret`` flag on the
    ``EnvironmentValue`` proto — the authoritative contract for whether a
    value should be treated as sensitive.

    ``$STIGMER_PLATFORM_DIR`` is handled separately by
    :func:`humanize_platform_refs` and is always skipped here.

    Call this **after** :func:`humanize_platform_refs` so platform paths
    are humanized before general env-var resolution runs.

    Args:
        text: The display string (e.g. a shell command preview).
        env_vars: Mapping of env-var names to their resolved values.  ``None``
            or empty dict is a safe no-op.
        secret_keys: Set of env-var names marked ``is_secret=true`` in the
            proto definition.  These are never resolved into display strings.
            ``None`` is treated as an empty set (no keys are secret).

    Examples::

        >>> resolve_display_env_vars("--path $OUTPUT_DIR", {"OUTPUT_DIR": "."})
        '--path .'
        >>> resolve_display_env_vars("--path ${OUTPUT_DIR}", {"OUTPUT_DIR": "out"})
        '--path out'
        >>> resolve_display_env_vars("--key $API_TOKEN", {"API_TOKEN": "sk-xx"}, {"API_TOKEN"})
        '--key $API_TOKEN'
        >>> resolve_display_env_vars("ls -la", None)
        'ls -la'
    """
    if not text or not env_vars:
        return text

    secrets = secret_keys or set()

    for key, value in env_vars.items():
        if key == STIGMER_PLATFORM_DIR_ENV:
            continue
        if key in secrets:
            continue
        text = re.sub(
            r"\$\{" + re.escape(key) + r"\}"
            r"|\$" + re.escape(key) + r"(?![A-Za-z0-9_])",
            value,
            text,
        )
    return text
