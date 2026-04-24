"""On-demand MCP server package installer.

Pre-installs npm and pip packages required by stdio MCP servers so that
``npx -y`` / ``uvx`` invocations find them locally instead of downloading
at first use.  This eliminates cold-start latency for subprocess-based MCP
servers inside cloud sandboxes where packages are not baked into the image.

Package extraction is heuristic-based, matching the standard patterns used
by seedpack MCP servers:

- ``command="npx"``  with ``-y`` flag → npm package (``npm install -g``)
- ``command="uvx"`` → pip package (``uv tool install``)

Custom commands (``node``, ``python``, ``go run``, etc.) are silently
skipped — those servers install on-demand at first invocation or are
expected to already be available.

Failures on individual packages are logged but never raised: if a
pre-install fails, ``npx -y`` / ``uvx`` will still attempt the download
at runtime (graceful degradation).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass, field
from typing import Any

from ai.stigmer.agentic.mcpserver.v1.api_pb2 import McpServer

logger = logging.getLogger(__name__)

_NPX_COMMANDS = frozenset({"npx"})
_UVX_COMMANDS = frozenset({"uvx"})
_NPX_SKIP_FLAGS = frozenset({"-y", "--yes", "-q", "--quiet"})


@dataclass
class InstallResult:
    """Outcome of a batch package installation."""

    installed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def extract_npm_package(args: list[str]) -> str | None:
    """Extract the npm package name from ``npx`` args.

    Skips known npx flags (``-y``, ``--yes``, ``-q``, ``--quiet``) and any
    other flag-like args (starting with ``-``).  Returns the first
    positional (non-flag) argument, which is the package specifier.

    Returns ``None`` when no package can be identified.
    """
    for arg in args:
        if arg in _NPX_SKIP_FLAGS:
            continue
        if arg.startswith("-"):
            continue
        if arg:
            return arg
    return None


def extract_pip_package(args: list[str]) -> str | None:
    """Extract the pip package name from ``uvx`` args.

    The first non-flag argument is the package specifier.
    Returns ``None`` when no package can be identified.
    """
    if not args:
        return None
    first = args[0]
    return first if (first and not first.startswith("-")) else None


def extract_packages(
    mcp_servers: list[McpServer],
) -> tuple[list[str], list[str]]:
    """Derive installable npm and pip package names from MCP server specs.

    Only stdio servers with ``npx`` or ``uvx`` commands are considered.
    HTTP servers and custom-command servers are silently skipped.

    Returns:
        Tuple of (npm_packages, pip_packages) with unique package names.
    """
    npm_packages: list[str] = []
    pip_packages: list[str] = []
    seen_npm: set[str] = set()
    seen_pip: set[str] = set()

    for server in mcp_servers:
        spec = server.spec
        if not spec.HasField("stdio"):
            continue

        command = spec.stdio.command
        args = list(spec.stdio.args) if spec.stdio.args else []

        if command in _NPX_COMMANDS:
            pkg = extract_npm_package(args)
            if pkg and pkg not in seen_npm:
                npm_packages.append(pkg)
                seen_npm.add(pkg)
        elif command in _UVX_COMMANDS:
            pkg = extract_pip_package(args)
            if pkg and pkg not in seen_pip:
                pip_packages.append(pkg)
                seen_pip.add(pkg)

    return npm_packages, pip_packages


async def _run_install(
    cmd: list[str],
    pkg: str,
    log: logging.Logger,
) -> bool:
    """Run a single install command as an async subprocess.

    Returns True on success, False on failure.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            log.info("Installed package: %s", pkg)
            return True

        log.warning(
            "Failed to install package %s (exit %d): %s",
            pkg,
            proc.returncode,
            stderr.decode(errors="replace").strip(),
        )
        return False

    except Exception as exc:
        log.warning("Failed to install package %s: %s", pkg, exc)
        return False


async def install_mcp_packages(
    mcp_servers: list[Any],
    log: logging.Logger,
) -> InstallResult:
    """Pre-install npm and pip packages required by MCP servers.

    Extracts package names from the stdio server specs and installs them
    concurrently using ``npm install -g`` and ``uv tool install``.

    This function never raises: individual failures are captured in the
    returned ``InstallResult`` so the caller can log/heartbeat them.
    """
    npm_packages, pip_packages = extract_packages(mcp_servers)

    if not npm_packages and not pip_packages:
        return InstallResult()

    log.info(
        "Pre-installing MCP packages: %d npm, %d pip",
        len(npm_packages),
        len(pip_packages),
    )

    result = InstallResult()
    tasks: list[tuple[str, str, list[str]]] = []

    has_npm = shutil.which("npm") is not None
    has_uv = shutil.which("uv") is not None

    for pkg in npm_packages:
        if has_npm:
            tasks.append((pkg, "npm", ["npm", "install", "-g", pkg, "--loglevel=error"]))
        else:
            log.debug("npm not found, skipping pre-install for %s", pkg)
            result.skipped += 1

    for pkg in pip_packages:
        if has_uv:
            tasks.append((pkg, "pip", ["uv", "tool", "install", pkg]))
        else:
            log.debug("uv not found, skipping pre-install for %s", pkg)
            result.skipped += 1

    if not tasks:
        return result

    async def _install_one(pkg: str, kind: str, cmd: list[str]) -> bool:
        ok = await _run_install(cmd, pkg, log)
        if not ok:
            result.errors.append(f"{kind}:{pkg}")
        return ok

    outcomes = await asyncio.gather(
        *[_install_one(pkg, kind, cmd) for pkg, kind, cmd in tasks],
        return_exceptions=True,
    )

    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            result.failed += 1
        elif outcome:
            result.installed += 1
        else:
            result.failed += 1

    log.info(
        "MCP package install complete: %d installed, %d failed, %d skipped",
        result.installed,
        result.failed,
        result.skipped,
    )

    return result
