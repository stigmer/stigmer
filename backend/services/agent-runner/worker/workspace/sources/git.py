"""Git workspace source — clones a repository via HTTPS into the workspace.

Idempotent provisioning:
    On subsequent executions within the same session, the workspace
    already contains the cloned repository.  The provisioner detects
    this by checking for ``.git`` and returns metadata from the
    existing repo without re-cloning.  If the workspace is non-empty
    but lacks ``.git`` (e.g. a crash during a previous clone), the
    contents are cleaned and a fresh clone is performed.

Authentication (AD-07, GitHub-only for MVP):
    If ``GITHUB_TOKEN`` is present in the merged environment **and** the
    clone URL points to ``github.com``, the token is injected into the
    URL as ``https://x-access-token:{token}@github.com/…``.  Public
    repositories (or non-GitHub hosts) are cloned without authentication.

Security:
    - The authenticated URL is constructed in memory and passed directly
      to ``backend.execute()``.  It is never logged or stored.
    - If the clone fails, git's stderr is sanitised: any occurrence of
      the token is replaced with ``***`` before it reaches the error
      message or ``WorkspaceProvisionError``.
    - ``GITHUB_TOKEN`` is reported in ``consumed_keys`` so the caller
      can strip it from the agent's runtime environment (AD-05).

Git excludes:
    After provisioning (fresh clone or detected existing repo),
    platform directories (``.stigmer-inputs``, ``bin/skills``) are
    added to ``.git/info/exclude`` so they do not appear in
    ``git diff`` or ``git status``.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
    WorkspaceProvisionError,
)

logger = logging.getLogger(__name__)

_SOURCE = SourceType.GIT_REPO
_TOKEN_KEY = "GITHUB_TOKEN"
_CLONE_TIMEOUT = 300  # 5 minutes — large repos need headroom
_POST_CLONE_TIMEOUT = 30
_CLEANUP_TIMEOUT = 60

_PLATFORM_EXCLUDES = (".stigmer-inputs", "bin/skills")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def provision(
    source: object,
    backend: WorkspaceBackend,
    merged_env: dict[str, str],
) -> ProvisionResult:
    """Clone a git repository into the workspace, or reuse an existing clone.

    Idempotent: if ``.git`` already exists in the workspace, metadata is
    read from the existing repo and no clone is performed.  If the
    workspace is non-empty but has no ``.git`` (partial/corrupted state),
    the contents are cleaned and a fresh clone is done.

    Args:
        source: ``GitRepoSource`` proto message (duck-typed).
        backend: Workspace backend for command execution.
        merged_env: Merged environment with potential ``GITHUB_TOKEN``.

    Returns:
        ``ProvisionResult`` with ``git_metadata`` populated.

    Raises:
        WorkspaceProvisionError: Clone failure, auth error, bad branch, etc.
    """
    url: str = source.url  # type: ignore[union-attr]
    branch: str = source.branch  # type: ignore[union-attr]
    commit: str = source.commit  # type: ignore[union-attr]
    has_depth = source.HasField("depth")  # type: ignore[union-attr]
    depth: int = source.depth if has_depth else -1  # type: ignore[union-attr]

    token = merged_env.get(_TOKEN_KEY)

    existing = _detect_existing_repo(backend, url, token)
    if existing is not None:
        _setup_git_excludes(backend)
        return existing

    _recover_non_empty_workspace(backend)

    auth_url = _build_auth_url(url, token)

    clone_cmd = _build_clone_command(auth_url, branch, has_depth, depth, backend.root_dir)
    _run_git(backend, clone_cmd, token, timeout=_CLONE_TIMEOUT, context="clone")

    if commit:
        _run_git(
            backend,
            f"git checkout {commit}",
            token,
            timeout=_POST_CLONE_TIMEOUT,
            context=f"checkout {commit}",
        )

    resolved_branch = _resolve_branch(backend, token)
    head_sha = _resolve_head(backend, token)

    consumed_keys: tuple[str, ...] = (_TOKEN_KEY,) if token else ()
    if consumed_keys:
        logger.info(
            "Key '%s' consumed by workspace provisioning (git clone)",
            _TOKEN_KEY,
        )

    _setup_git_excludes(backend)

    return ProvisionResult(
        root_dir=backend.root_dir,
        source_type=_SOURCE,
        consumed_keys=consumed_keys,
        workspace_description=_build_description(url, resolved_branch, head_sha),
        git_metadata=GitMetadata(
            repo_url=url,
            branch=resolved_branch,
            base_commit=head_sha,
        ),
    )


# ---------------------------------------------------------------------------
# Idempotent provisioning: detect existing repo / recover corrupted state
# ---------------------------------------------------------------------------


def _detect_existing_repo(
    backend: WorkspaceBackend,
    url: str,
    token: str | None,
) -> ProvisionResult | None:
    """Return a ``ProvisionResult`` if the workspace already contains a repo.

    Checks for ``.git`` in the workspace root.  When found, reads branch
    and HEAD from the existing clone — no network operations, no auth.

    Returns ``None`` if the workspace is empty or has no ``.git``.
    """
    result = backend.execute("test -d .git && echo yes || echo no", timeout=5)
    if result.exit_code != 0 or result.stdout.strip() != "yes":
        return None

    logger.info(
        "Workspace already provisioned (git repo detected), reusing: "
        "root_dir=%s",
        backend.root_dir,
    )

    resolved_branch = _resolve_branch(backend, token=None)
    head_sha = _resolve_head(backend, token=None)

    consumed_keys: tuple[str, ...] = (_TOKEN_KEY,) if token else ()

    return ProvisionResult(
        root_dir=backend.root_dir,
        source_type=_SOURCE,
        consumed_keys=consumed_keys,
        workspace_description=_build_description(url, resolved_branch, head_sha),
        git_metadata=GitMetadata(
            repo_url=url,
            branch=resolved_branch,
            base_commit=head_sha,
        ),
    )


def _recover_non_empty_workspace(backend: WorkspaceBackend) -> None:
    """Clean a non-empty workspace that has no ``.git`` directory.

    This handles the case where a previous provisioning attempt crashed
    mid-clone, leaving partial content without a valid git repository.
    An empty workspace (the normal case) is left untouched.
    """
    result = backend.execute("ls -A", timeout=5)
    if result.exit_code != 0 or not result.stdout.strip():
        return

    logger.warning(
        "Workspace contains partial state (no .git), "
        "cleaning up before re-provisioning: root_dir=%s",
        backend.root_dir,
    )
    cleanup = backend.execute(
        "rm -rf * .[!.]* 2>/dev/null; true",
        timeout=_CLEANUP_TIMEOUT,
    )
    if cleanup.exit_code != 0:
        raise WorkspaceProvisionError(
            _SOURCE,
            f"Failed to clean corrupted workspace: {cleanup.stderr.strip()}",
        )


# ---------------------------------------------------------------------------
# URL / auth helpers
# ---------------------------------------------------------------------------


def _build_auth_url(url: str, token: str | None) -> str:
    """Inject a PAT into the URL if the host is ``github.com``."""
    if not token:
        return url

    parsed = urlparse(url)
    if parsed.hostname and parsed.hostname.lower() == "github.com":
        # https://x-access-token:{token}@github.com/org/repo.git
        authed = parsed._replace(
            netloc=f"x-access-token:{token}@{parsed.hostname}"
            + (f":{parsed.port}" if parsed.port else ""),
        )
        return authed.geturl()

    logger.warning(
        "GITHUB_TOKEN is present but clone URL host is '%s' (not github.com). "
        "Token will not be injected — attempting unauthenticated clone.",
        parsed.hostname,
    )
    return url


# ---------------------------------------------------------------------------
# Command builders
# ---------------------------------------------------------------------------


def _build_clone_command(
    url: str,
    branch: str,
    has_depth: bool,
    depth: int,
    target: str,
) -> str:
    parts = ["git", "clone"]

    if not has_depth:
        parts.extend(["--depth", "1"])
    elif depth > 0:
        parts.extend(["--depth", str(depth)])
    # depth == 0 → full clone, no --depth flag

    if branch:
        parts.extend(["--branch", branch])

    parts.append(url)
    parts.append(target)
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Git command execution with token scrubbing
# ---------------------------------------------------------------------------


def _run_git(
    backend: WorkspaceBackend,
    command: str,
    token: str | None,
    *,
    timeout: int,
    context: str,
) -> ExecuteResult:
    """Execute a git command, scrub the token from errors, classify failures."""
    result = backend.execute(command, timeout=timeout)

    if result.exit_code != 0:
        stderr = _scrub_token(result.stderr, token)
        raise _classify_error(stderr, context)

    return result


def _scrub_token(text: str, token: str | None) -> str:
    """Replace any occurrence of the token in *text* with ``***``."""
    if not token or not text:
        return text
    return text.replace(token, "***")


def _classify_error(stderr: str, context: str) -> WorkspaceProvisionError:
    """Turn git stderr into a structured ``WorkspaceProvisionError``."""
    lower = stderr.lower()

    if "authentication failed" in lower or "could not read from remote" in lower:
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: authentication error.  "
            "If this is a private repository, ensure GITHUB_TOKEN is set "
            "in your Environment or runtime_env.\n"
            f"Detail: {stderr.strip()}",
        )

    if re.search(r"repository\b.*\bnot found", lower):
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: repository not found.  "
            "Check that the URL is correct and you have access.\n"
            f"Detail: {stderr.strip()}",
        )

    if "remote branch" in lower and "not found" in lower:
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: branch not found on remote.\n"
            f"Detail: {stderr.strip()}",
        )

    if "could not resolve host" in lower or "unable to access" in lower:
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: network error.  "
            "Check your network connection and the repository URL.\n"
            f"Detail: {stderr.strip()}",
        )

    return WorkspaceProvisionError(
        _SOURCE,
        f"Git {context} failed (exit code non-zero).\n"
        f"Detail: {stderr.strip()}",
    )


# ---------------------------------------------------------------------------
# Post-clone metadata resolution
# ---------------------------------------------------------------------------


def _resolve_branch(backend: WorkspaceBackend, token: str | None) -> str:
    """Get the current branch name (resolves default branch when unspecified)."""
    result = _run_git(
        backend,
        "git rev-parse --abbrev-ref HEAD",
        token,
        timeout=_POST_CLONE_TIMEOUT,
        context="resolve branch",
    )
    branch = result.stdout.strip()
    # Detached HEAD (after checkout of a specific commit) returns "HEAD".
    return branch if branch and branch != "HEAD" else "HEAD"


def _resolve_head(backend: WorkspaceBackend, token: str | None) -> str:
    """Get the full SHA of HEAD."""
    result = _run_git(
        backend,
        "git rev-parse HEAD",
        token,
        timeout=_POST_CLONE_TIMEOUT,
        context="resolve HEAD",
    )
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# Git excludes for platform directories
# ---------------------------------------------------------------------------


def _setup_git_excludes(backend: WorkspaceBackend) -> None:
    """Add platform directories to ``.git/info/exclude``.

    Uses the local exclude file (not ``.gitignore``) so that tracked
    project files are never modified.  Entries are appended only if not
    already present, making the function idempotent across executions.
    """
    excludes_path = ".git/info/exclude"

    existing = ""
    try:
        existing = backend.read_file(excludes_path).decode("utf-8")
    except FileNotFoundError:
        pass

    existing_lines = set(existing.splitlines())
    needed = [e for e in _PLATFORM_EXCLUDES if e not in existing_lines]
    if not needed:
        return

    separator = "" if existing.endswith("\n") or not existing else "\n"
    new_content = existing + separator + "\n".join(needed) + "\n"

    backend.mkdir(".git/info")
    backend.write_file(excludes_path, new_content.encode("utf-8"))

    logger.info(
        "Added platform excludes to .git/info/exclude: %s",
        ", ".join(needed),
    )


# ---------------------------------------------------------------------------
# Description builder
# ---------------------------------------------------------------------------


def _build_description(url: str, branch: str, commit: str) -> str:
    short_sha = commit[:7] if len(commit) >= 7 else commit
    return (
        f"Your workspace has been initialized from: {url} "
        f"(branch: {branch}, commit: {short_sha})\n"
        "Use your file system tools (ls, read, glob, grep) to explore the codebase.\n"
        "Start by listing the root directory to understand the project structure.\n\n"
        "Changes you make will be captured as artifacts when execution completes."
    )
