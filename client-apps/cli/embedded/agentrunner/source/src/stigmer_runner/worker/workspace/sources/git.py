"""Git workspace source — clones a repository via HTTPS into the workspace.

Idempotent provisioning:
    On subsequent executions within the same session, the workspace
    already contains the cloned repository.  The provisioner detects
    this by checking for ``.git`` and returns metadata from the
    existing repo without re-cloning.  If the workspace is non-empty
    but lacks ``.git`` (e.g. a crash during a previous clone), the
    contents are cleaned and a fresh clone is performed.

Multi-entry subdirectory mode:
    When ``target_subdir`` is provided, the repository is cloned into
    a named subdirectory of the workspace root instead of the root
    itself.  All idempotency checks, recovery, metadata resolution,
    and git-exclude setup are scoped to the subdirectory.  This
    supports multi-workspace sessions where each git entry occupies
    its own subdirectory (e.g. ``{workspace_root}/my-app/``).

FUSE+S3 volume compatibility:
    Daytona volumes are FUSE-based mounts backed by S3-compatible object
    storage.  They do not support ``rename()`` (returns ``ENOSYS``),
    ``chmod()``, ``link()``, or ``symlink()`` — operations that git
    requires for its internal metadata files (``.git/config``,
    ``.git/index``, etc.).

    In cloud mode, git is cloned with ``--separate-git-dir`` so that
    the working tree (source files) lives on the volume while git
    metadata lives on the local sandbox filesystem.  A small ``.git``
    text file on the volume points git to the metadata location.
    All standard git commands follow this pointer transparently.

    Two global git config entries are required for volume compatibility:

    ``safe.directory = *``
        Volume files are owned by ``nobody:nogroup`` (FUSE default)
        while git runs as ``daytona``.  Without this, git refuses to
        operate due to CVE-2022-24765 ownership checks.

    ``core.fileMode = false``
        ``chmod()`` is not supported on the volume, so all files get
        default ``rw-rw-rw-`` permissions.  Disabling fileMode tracking
        prevents false-positive status changes.

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

Credential persistence (``configure_credentials=True``):
    After a successful clone (or when reusing an existing repo), the
    remote URL is cleaned to remove the embedded token and a git
    credential store is configured at ``/home/daytona/.git-credentials``.
    This enables ``git push``/``fetch`` without the token being visible
    via ``git remote -v`` or present in shell environment variables.

    The credential file lives on the local sandbox filesystem (not the
    FUSE+S3 volume) and does not survive sandbox restarts — but neither
    does the separated git directory, so re-provisioning handles both.

    Credential persistence is controlled by the ``configure_credentials``
    parameter, decoupled from ``is_local_mode``.  Cloud sandboxes on
    local overlay filesystems use ``is_local_mode=True`` (no FUSE hacks)
    but still need credentials for write-back.  Local-mode runs on the
    developer's machine skip credential configuration to avoid modifying
    the user's own git setup.

Git excludes:
    After provisioning (fresh clone or detected existing repo),
    platform directories (``.stigmer``) are added to
    ``.git/info/exclude`` so they do not appear in ``git diff`` or
    ``git status``.  The exclude file location is resolved via
    ``git rev-parse --absolute-git-dir``, which correctly follows
    ``.git`` pointer files created by ``--separate-git-dir``.
"""

from __future__ import annotations

import dataclasses
import logging
import os
import re
import time
from urllib.parse import urlparse

from stigmer_runner.worker.workspace.backend import ExecuteResult, WorkspaceBackend
from stigmer_runner.worker.workspace.provisioner import (
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

_CLONE_MAX_ATTEMPTS = 3
_CLONE_RETRY_DELAY_S = 5
"""Seconds to wait between clone retry attempts.  Kept short because the
clone timeout itself (5 min) provides substantial natural back-off."""

_TRANSIENT_PATTERNS: tuple[str, ...] = (
    "read timed out",
    "connectionreset",
    "remotedisconnected",
    "connectionerror",
    "connection aborted",
    "connection refused",
    "econnreset",
    "broken pipe",
    "timed out",
)
"""Substrings in lower-cased error output that indicate a transient
network or proxy failure suitable for automatic retry."""

_PLATFORM_EXCLUDES = (".stigmer",)

_CREDENTIAL_FILE = "/home/daytona/.git-credentials"
"""Path for the git credential store on Daytona sandboxes.

Lives on the local sandbox filesystem (not the FUSE+S3 volume) so that
``git push``/``fetch`` can authenticate without the token being exposed
in shell environment variables or the remote URL.
"""

_GIT_DIR_BASE = "/home/daytona/.git-repos"
"""Base path for separated git metadata directories on Daytona sandboxes.

On FUSE+S3 volumes, ``.git/`` internals cannot live on the volume because
the filesystem does not support ``rename()``.  Git metadata is placed here
(on the local sandbox filesystem) while the working tree stays on the
volume for persistence across sandbox restarts within a session.
"""


# ---------------------------------------------------------------------------
# Separate git-dir helpers (FUSE+S3 volume compatibility)
# ---------------------------------------------------------------------------


def _git_dir_path(target_subdir: str | None) -> str:
    """Compute the deterministic git-dir path for a workspace entry.

    Each workspace entry gets its own git metadata directory under
    ``_GIT_DIR_BASE``.  Single-entry workspaces use ``"default"``.
    """
    name = target_subdir or "default"
    return f"{_GIT_DIR_BASE}/{name}"


def _prepare_separate_git_dir(
    backend: WorkspaceBackend,
    git_dir: str,
) -> None:
    """Create the parent directory for the separate git dir.

    Only the **parent** is created — git itself creates the target
    directory during ``clone --separate-git-dir``.  Pre-creating the
    target would cause git to refuse with "already exists".
    """
    parent = os.path.dirname(git_dir)
    backend.execute(f"mkdir -p {parent}", timeout=5)


def _configure_fuse_volume_compat(backend: WorkspaceBackend) -> None:
    """Configure git globally for FUSE+S3 volume compatibility.

    Sets ``safe.directory`` and ``core.fileMode`` globally so all
    subsequent git operations in this sandbox work correctly with
    volume-mounted working trees.  Idempotent — safe to call multiple
    times within the same sandbox.
    """
    result = backend.execute(
        "git config --global --add safe.directory '*' && "
        "git config --global core.fileMode false",
        timeout=5,
    )
    if result.exit_code != 0:
        logger.warning(
            "Failed to configure FUSE volume compat (non-fatal): %s",
            result.stderr.strip(),
        )


# ---------------------------------------------------------------------------
# Git credential persistence (cloud mode)
# ---------------------------------------------------------------------------


def _configure_git_credentials(
    backend: WorkspaceBackend,
    url: str,
    token: str,
    *,
    target_subdir: str | None = None,
) -> bool:
    """Configure a git credential store and clean the remote URL.

    After clone, the remote URL embeds the token
    (``https://x-access-token:{token}@github.com/…``).  This function:

    1. Replaces the remote URL with the clean (tokenless) URL so the
       token is not visible via ``git remote -v``.
    2. Configures the global git credential helper to use a file-based
       store at ``_CREDENTIAL_FILE``.
    3. Writes the token into the credential store in the standard
       git-credential-store format.

    Only acts on ``github.com`` URLs, consistent with ``_build_auth_url``.

    Non-fatal: returns ``False`` on any failure so the caller can still
    return a valid ``ProvisionResult`` (the workspace is usable, just
    without push capability).

    Args:
        backend: Workspace backend for command execution.
        url: The clean (tokenless) clone URL.
        token: The ``GITHUB_TOKEN`` value.
        target_subdir: Subdirectory for ``git remote set-url`` (must
            run inside the repo).  ``None`` for single-entry workspaces.

    Returns:
        ``True`` if all credential steps succeeded.
    """
    parsed = urlparse(url)
    if not parsed.hostname or parsed.hostname.lower() != "github.com":
        logger.debug(
            "Skipping credential store — host '%s' is not github.com",
            parsed.hostname,
        )
        return False

    # 1. Clean the remote URL (remove embedded token from clone).
    result = backend.execute(
        f"git remote set-url origin {url}",
        cwd=target_subdir,
        timeout=5,
    )
    if result.exit_code != 0:
        logger.warning(
            "Failed to clean remote URL (non-fatal): %s",
            _scrub_token(result.stderr.strip(), token),
        )
        return False

    # 2. Configure the global credential helper.
    result = backend.execute(
        f"git config --global credential.helper 'store --file={_CREDENTIAL_FILE}'",
        timeout=5,
    )
    if result.exit_code != 0:
        logger.warning(
            "Failed to configure credential helper (non-fatal): %s",
            _scrub_token(result.stderr.strip(), token),
        )
        return False

    # 3. Write the credential entry and restrict permissions.
    #    The token appears in the command string — same security level
    #    as the clone URL passed to backend.execute() during clone.
    cred_entry = f"https://x-access-token:{token}@github.com"
    result = backend.execute(
        f"printf '%s\\n' '{cred_entry}' > {_CREDENTIAL_FILE} "
        f"&& chmod 600 {_CREDENTIAL_FILE}",
        timeout=5,
    )
    if result.exit_code != 0:
        logger.warning(
            "Failed to write credential file (non-fatal): %s",
            _scrub_token(result.stderr.strip(), token),
        )
        return False

    logger.info("Git credential store configured at %s", _CREDENTIAL_FILE)
    return True


# ---------------------------------------------------------------------------
# Subdirectory helpers
# ---------------------------------------------------------------------------


def _effective_root(backend_root: str, target_subdir: str | None) -> str:
    """Compute the effective root directory for a provisioning target.

    When *target_subdir* is set, the repo lives in a named subdirectory
    of the workspace root (multi-entry cloud mode).  Otherwise the repo
    occupies the workspace root directly (single-entry backward compat).
    """
    if target_subdir:
        return os.path.join(backend_root, target_subdir)
    return backend_root


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def provision(
    source: object,
    backend: WorkspaceBackend,
    merged_env: dict[str, str],
    *,
    target_subdir: str | None = None,
    is_local_mode: bool = True,
    configure_credentials: bool = False,
) -> ProvisionResult:
    """Clone a git repository into the workspace, or reuse an existing clone.

    Idempotent: if ``.git`` already exists in the workspace, metadata is
    read from the existing repo and no clone is performed.  If the
    workspace is non-empty but has no ``.git`` (partial/corrupted state),
    the contents are cleaned and a fresh clone is done.

    In cloud mode (``is_local_mode=False``), the clone uses
    ``--separate-git-dir`` to place git metadata on the local sandbox
    filesystem while keeping the working tree on the FUSE+S3 volume.
    See the module docstring for the full rationale.

    Args:
        source: ``GitRepoSource`` proto message (duck-typed).
        backend: Workspace backend for command execution.
        merged_env: Merged environment with potential ``GITHUB_TOKEN``.
        target_subdir: When set, clone into this subdirectory of
            ``backend.root_dir`` instead of the root itself.  Used by
            multi-entry provisioning so each git repo occupies a named
            subdirectory (e.g. ``{workspace_root}/my-app/``).
        is_local_mode: When ``True`` (default), uses standard git clone.
            When ``False``, enables ``--separate-git-dir`` and FUSE
            volume compatibility configuration.
        configure_credentials: When ``True``, configure a git credential
            store for push/fetch access after cloning.  Decoupled from
            ``is_local_mode`` because cloud sandboxes on local overlay
            filesystems need ``is_local_mode=True`` (no FUSE hacks) but
            still require credentials for write-back.

    Returns:
        ``ProvisionResult`` with ``git_metadata`` populated.

    Raises:
        WorkspaceProvisionError: Clone failure, auth error, bad branch, etc.
    """
    url: str = source.url  # type: ignore[attr-defined]
    branch: str = source.branch  # type: ignore[attr-defined]
    commit: str = source.commit  # type: ignore[attr-defined]
    has_depth = source.HasField("depth")  # type: ignore[attr-defined]
    depth: int = source.depth if has_depth else -1  # type: ignore[attr-defined]

    token = merged_env.get(_TOKEN_KEY)
    root_dir = _effective_root(backend.root_dir, target_subdir)

    separate_git_dir: str | None = None
    if not is_local_mode:
        separate_git_dir = _git_dir_path(target_subdir)
        _configure_fuse_volume_compat(backend)

    existing = _detect_existing_repo(backend, url, token, target_subdir=target_subdir)
    if existing is not None:
        _setup_git_excludes(backend, target_subdir=target_subdir)

        if token and configure_credentials:
            creds_ok = _configure_git_credentials(
                backend, url, token, target_subdir=target_subdir,
            )
            if creds_ok and existing.git_metadata:
                existing = dataclasses.replace(
                    existing,
                    git_metadata=dataclasses.replace(
                        existing.git_metadata,
                        git_credentials_configured=True,
                    ),
                )

        return existing

    _recover_non_empty_workspace(backend, target_subdir=target_subdir)

    if separate_git_dir:
        _prepare_separate_git_dir(backend, separate_git_dir)

    auth_url = _build_auth_url(url, token)

    clone_cmd = _build_clone_command(
        auth_url, branch, has_depth, depth, root_dir,
        separate_git_dir=separate_git_dir,
    )
    _clone_with_retry(
        backend, clone_cmd, token,
        target_subdir=target_subdir,
        separate_git_dir=separate_git_dir,
    )

    if commit:
        _run_git(
            backend,
            f"git checkout {commit}",
            token,
            timeout=_POST_CLONE_TIMEOUT,
            context=f"checkout {commit}",
            cwd=target_subdir,
        )

    resolved_branch = _resolve_branch(backend, token, cwd=target_subdir)
    head_sha = _resolve_head(backend, token, cwd=target_subdir)

    consumed_keys: tuple[str, ...] = (_TOKEN_KEY,) if token else ()
    if consumed_keys:
        logger.info(
            "Key '%s' consumed by workspace provisioning (git clone)",
            _TOKEN_KEY,
        )

    _setup_git_excludes(backend, target_subdir=target_subdir)

    creds_configured = False
    if token and configure_credentials:
        creds_configured = _configure_git_credentials(
            backend, url, token, target_subdir=target_subdir,
        )

    return ProvisionResult(
        root_dir=root_dir,
        source_type=_SOURCE,
        consumed_keys=consumed_keys,
        workspace_description=_build_description(url, resolved_branch, head_sha),
        git_metadata=GitMetadata(
            repo_url=url,
            branch=resolved_branch,
            base_commit=head_sha,
            git_credentials_configured=creds_configured,
        ),
    )


# ---------------------------------------------------------------------------
# Idempotent provisioning: detect existing repo / recover corrupted state
# ---------------------------------------------------------------------------


def _detect_existing_repo(
    backend: WorkspaceBackend,
    url: str,
    token: str | None,
    *,
    target_subdir: str | None = None,
) -> ProvisionResult | None:
    """Return a ``ProvisionResult`` if the workspace already contains a repo.

    Detects two forms of ``.git``:

    - **Directory** (standard clone): ``test -d .git`` — the repo is
      self-contained in the workspace.
    - **File** (``--separate-git-dir`` clone): ``test -f .git`` — the
      file contains a ``gitdir:`` pointer to the actual git metadata
      directory on the local filesystem.  When the pointer target does
      not exist (e.g. after a sandbox restart), the repo is considered
      stale and ``None`` is returned so the caller can re-provision.

    Returns ``None`` if the directory is empty or has no ``.git``.
    """
    result = backend.execute(
        "test -d .git && echo dir || (test -f .git && echo file) || echo none",
        cwd=target_subdir,
        timeout=5,
    )
    git_state = result.stdout.strip() if result.exit_code == 0 else "none"

    if git_state == "none":
        return None

    if git_state == "file":
        # .git is a pointer file from --separate-git-dir.  Verify the
        # target git dir still exists (it won't after sandbox restart).
        check = backend.execute(
            "cat .git | sed 's/gitdir: //' | xargs test -d "
            "&& echo valid || echo stale",
            cwd=target_subdir,
            timeout=5,
        )
        if check.stdout.strip() != "valid":
            logger.warning(
                "Stale .git pointer detected (separate git dir lost "
                "after sandbox restart) — workspace will be "
                "re-provisioned",
            )
            return None

    root_dir = _effective_root(backend.root_dir, target_subdir)
    logger.info(
        "Workspace already provisioned (git repo detected as %s), "
        "reusing: root_dir=%s",
        git_state,
        root_dir,
    )

    resolved_branch = _resolve_branch(backend, token=None, cwd=target_subdir)
    head_sha = _resolve_head(backend, token=None, cwd=target_subdir)

    consumed_keys: tuple[str, ...] = (_TOKEN_KEY,) if token else ()

    return ProvisionResult(
        root_dir=root_dir,
        source_type=_SOURCE,
        consumed_keys=consumed_keys,
        workspace_description=_build_description(url, resolved_branch, head_sha),
        git_metadata=GitMetadata(
            repo_url=url,
            branch=resolved_branch,
            base_commit=head_sha,
        ),
    )


def _recover_non_empty_workspace(
    backend: WorkspaceBackend,
    *,
    target_subdir: str | None = None,
) -> None:
    """Clean a non-empty target directory that has no ``.git``.

    This handles the case where a previous provisioning attempt crashed
    mid-clone, leaving partial content without a valid git repository.
    An empty directory (or one that does not exist yet) is left untouched.

    When *target_subdir* is set, only the subdirectory is inspected and
    cleaned — sibling entries are never touched.
    """
    result = backend.execute("ls -A", cwd=target_subdir, timeout=5)
    if result.exit_code != 0 or not result.stdout.strip():
        return

    root_dir = _effective_root(backend.root_dir, target_subdir)
    logger.warning(
        "Workspace contains partial state (no .git), "
        "cleaning up before re-provisioning: root_dir=%s",
        root_dir,
    )
    cleanup = backend.execute(
        "rm -rf * .[!.]* 2>/dev/null; true",
        cwd=target_subdir,
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
    *,
    separate_git_dir: str | None = None,
) -> str:
    parts = ["git", "clone"]

    if separate_git_dir:
        parts.extend(["--separate-git-dir", separate_git_dir])

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
# Clone with retry for transient failures
# ---------------------------------------------------------------------------


def _clone_with_retry(
    backend: WorkspaceBackend,
    clone_cmd: str,
    token: str | None,
    *,
    target_subdir: str | None,
    separate_git_dir: str | None,
) -> None:
    """Execute a git clone command, retrying on transient failures.

    Transient failures — sandbox proxy timeouts, connection resets, and
    similar network errors — are retried up to ``_CLONE_MAX_ATTEMPTS``
    times with a short delay between attempts.  Non-transient errors
    (authentication, repo-not-found, bad branch) fail immediately.

    Between retries, partial state left by the failed clone (working
    tree and, in cloud mode, the separated git-dir) is cleaned so the
    next attempt starts from a clean slate.
    """
    last_err: WorkspaceProvisionError | None = None

    for attempt in range(1, _CLONE_MAX_ATTEMPTS + 1):
        try:
            _run_git(
                backend, clone_cmd, token,
                timeout=_CLONE_TIMEOUT, context="clone",
            )
            if attempt > 1:
                logger.info(
                    "Git clone succeeded on attempt %d/%d",
                    attempt, _CLONE_MAX_ATTEMPTS,
                )
            return
        except WorkspaceProvisionError as err:
            last_err = err
            if not err.transient or attempt == _CLONE_MAX_ATTEMPTS:
                raise

            logger.warning(
                "Git clone failed (attempt %d/%d, transient): %s — "
                "retrying in %ds",
                attempt,
                _CLONE_MAX_ATTEMPTS,
                err,
                _CLONE_RETRY_DELAY_S,
            )

            _recover_non_empty_workspace(backend, target_subdir=target_subdir)
            if separate_git_dir:
                _prepare_separate_git_dir(backend, separate_git_dir)

            time.sleep(_CLONE_RETRY_DELAY_S)

    assert last_err is not None  # unreachable; satisfies type checker
    raise last_err


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
    cwd: str | None = None,
) -> ExecuteResult:
    """Execute a git command, scrub the token from errors, classify failures."""
    result = backend.execute(command, cwd=cwd, timeout=timeout)

    if result.exit_code != 0:
        stderr = _scrub_token(result.stderr, token)
        raise _classify_error(stderr, context)

    return result


def _scrub_token(text: str, token: str | None) -> str:
    """Replace any occurrence of the token in *text* with ``***``."""
    if not token or not text:
        return text
    return text.replace(token, "***")


def _is_transient_error(lower: str) -> bool:
    """Return ``True`` if *lower* (already lower-cased) matches a known
    transient network/proxy pattern suitable for automatic retry."""
    return any(pat in lower for pat in _TRANSIENT_PATTERNS)


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

    if "function not implemented" in lower:
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: the workspace filesystem does not "
            "support an operation git requires (likely rename() on a "
            "FUSE/S3-backed volume).  Git metadata must be placed on a "
            "POSIX-compatible filesystem via --separate-git-dir.\n"
            f"Detail: {stderr.strip()}",
        )

    if _is_transient_error(lower):
        return WorkspaceProvisionError(
            _SOURCE,
            f"Git {context} failed: transient network/proxy error.  "
            "The sandbox proxy or network connection timed out.  "
            "This is usually temporary and succeeds on retry.\n"
            f"Detail: {stderr.strip()}",
            transient=True,
        )

    return WorkspaceProvisionError(
        _SOURCE,
        f"Git {context} failed (exit code non-zero).\n"
        f"Detail: {stderr.strip()}",
    )


# ---------------------------------------------------------------------------
# Post-clone metadata resolution
# ---------------------------------------------------------------------------


def _resolve_branch(
    backend: WorkspaceBackend,
    token: str | None,
    cwd: str | None = None,
) -> str:
    """Get the current branch name (resolves default branch when unspecified)."""
    result = _run_git(
        backend,
        "git rev-parse --abbrev-ref HEAD",
        token,
        timeout=_POST_CLONE_TIMEOUT,
        context="resolve branch",
        cwd=cwd,
    )
    branch = result.stdout.strip()
    # Detached HEAD (after checkout of a specific commit) returns "HEAD".
    return branch if branch and branch != "HEAD" else "HEAD"


def _resolve_head(
    backend: WorkspaceBackend,
    token: str | None,
    cwd: str | None = None,
) -> str:
    """Get the full SHA of HEAD."""
    result = _run_git(
        backend,
        "git rev-parse HEAD",
        token,
        timeout=_POST_CLONE_TIMEOUT,
        context="resolve HEAD",
        cwd=cwd,
    )
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# Git excludes for platform directories
# ---------------------------------------------------------------------------


def _setup_git_excludes(
    backend: WorkspaceBackend,
    *,
    target_subdir: str | None = None,
) -> None:
    """Add platform directories to the local git exclude file.

    When the virtual platform mount is active (``backend.platform_dir``
    is set), platform files don't exist in the workspace tree at all,
    so no git excludes are needed.

    Uses the local exclude file (not ``.gitignore``) so that tracked
    project files are never modified.  Entries are appended only if not
    already present, making the function idempotent across executions.

    The git directory is resolved via ``git rev-parse --absolute-git-dir``
    which correctly follows ``.git`` pointer files created by
    ``--separate-git-dir``.  This means the exclude file may live
    outside the workspace root (on the local sandbox filesystem) when
    a separate git dir is in use.
    """
    if backend.platform_dir:
        logger.info(
            "Skipping git excludes — virtual platform mount is active "
            "(platform_dir=%s)",
            backend.platform_dir,
        )
        return

    git_dir_result = backend.execute(
        "git rev-parse --absolute-git-dir",
        cwd=target_subdir,
        timeout=5,
    )
    if git_dir_result.exit_code != 0:
        logger.warning(
            "Cannot resolve git dir — skipping excludes setup: %s",
            git_dir_result.stderr.strip(),
        )
        return

    git_dir = git_dir_result.stdout.strip()
    excludes_path = f"{git_dir}/info/exclude"

    read_result = backend.execute(
        f"cat {excludes_path} 2>/dev/null || true",
        timeout=5,
    )
    existing = read_result.stdout

    existing_lines = set(existing.splitlines())
    needed = [e for e in _PLATFORM_EXCLUDES if e not in existing_lines]
    if not needed:
        return

    append_content = "\n".join(needed)
    backend.execute(
        f"mkdir -p {git_dir}/info && "
        f"printf '%s\\n' '{append_content}' >> {excludes_path}",
        timeout=5,
    )

    logger.info(
        "Added platform excludes to %s: %s",
        excludes_path,
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
