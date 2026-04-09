"""Temporal activity for building Daytona MCP snapshots.

Programmatically creates Daytona snapshots that have popular MCP server
packages pre-installed, eliminating cold-start latency for sandbox-based
MCP server execution. The activity also rotates old snapshots, keeping
the most recent N.

The workflow that orchestrates this activity is a polyglot Java workflow
in stigmer-service (``BuildMcpSnapshotWorkflow``). It runs a local Java
activity to resolve the package list from registry-synced MCP servers,
then dispatches this Python activity on the ``agent_execution_runner``
queue to perform the actual Daytona image build and snapshot creation.

The package list can also be overridden via the
``STIGMER_MCP_SNAPSHOT_PACKAGES`` environment variable (JSON format),
with a curated default list as a final fallback.

Naming convention: ``stigmer-mcp-YYYYMMDD-HHMMSS``

See ``worker.snapshot_resolver`` for how the latest snapshot is discovered
at sandbox creation time.

Architecture (polyglot):
    Java: ``BuildMcpSnapshotWorkflow`` (Temporal scheduled workflow, mcp_server_sync queue)
      -> Java: ``ResolveSnapshotPackages`` (local activity, queries MongoDB)
      -> Python: ``BuildMcpSnapshot`` (this activity, agent_execution_runner queue)
           -> Daytona Image API (build)
           -> Daytona Snapshot API (create, list, delete)
           -> SnapshotResolver cache invalidation
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field

from temporalio import activity

from worker.snapshot_resolver import (
    SNAPSHOT_NAME_PREFIX,
    generate_snapshot_name,
    get_snapshot_resolver,
)

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "BuildMcpSnapshot"

# Curated default list of popular MCP server packages.
# Override at runtime with the STIGMER_MCP_SNAPSHOT_PACKAGES env var (JSON).
_DEFAULT_PACKAGES: dict[str, list[str]] = {
    "npm": [
        "@modelcontextprotocol/server-github",
        "@modelcontextprotocol/server-filesystem",
        "@modelcontextprotocol/server-memory",
        "@modelcontextprotocol/server-brave-search",
        "@modelcontextprotocol/server-puppeteer",
    ],
    "pip": [
        "mcp-server-sqlite",
        "mcp-server-fetch",
    ],
    "go": [],
}

DEFAULT_SNAPSHOTS_TO_KEEP = 3


# ---------------------------------------------------------------------------
# Temporal dataclasses
# ---------------------------------------------------------------------------


@dataclass
class BuildMcpSnapshotInput:
    """Input for the snapshot builder activity.

    All fields are optional. When omitted the activity reads defaults
    from environment variables and the curated package list.

    Fields:
        npm_packages: npm packages to ``npm install -g``.
        pip_packages: Python packages to ``pip install``.
        go_packages: Go modules to ``go install``.
        base_image: Base Docker image for the snapshot. Defaults to
            ``STIGMER_MCP_SNAPSHOT_BASE_IMAGE`` env var.
        snapshots_to_keep: Number of recent snapshots to retain.
    """

    npm_packages: list[str] | None = None
    pip_packages: list[str] | None = None
    go_packages: list[str] | None = None
    base_image: str | None = None
    snapshots_to_keep: int = DEFAULT_SNAPSHOTS_TO_KEEP


@dataclass
class BuildMcpSnapshotOutput:
    """Output from the snapshot builder activity.

    Fields:
        snapshot_name: Name of the newly created snapshot, or ``None``
            if creation was skipped or failed.
        deleted_snapshots: Names of old snapshots that were deleted
            during rotation.
        errors: Non-fatal errors encountered during execution.
    """

    snapshot_name: str | None = None
    deleted_snapshots: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Package list resolution
# ---------------------------------------------------------------------------


def _resolve_packages(
    input: BuildMcpSnapshotInput,
) -> dict[str, list[str]]:
    """Resolve the final MCP server package list.

    Priority:
        1. Explicit values in ``input`` (workflow-provided overrides)
        2. ``STIGMER_MCP_SNAPSHOT_PACKAGES`` env var (JSON)
        3. ``_DEFAULT_PACKAGES`` (curated list)
    """
    env_raw = os.getenv("STIGMER_MCP_SNAPSHOT_PACKAGES")
    env_packages: dict[str, list[str]] | None = None
    if env_raw:
        try:
            env_packages = json.loads(env_raw)
        except json.JSONDecodeError:
            logger.warning(
                "STIGMER_MCP_SNAPSHOT_PACKAGES is not valid JSON, "
                "falling back to defaults"
            )

    base = env_packages if env_packages else _DEFAULT_PACKAGES

    return {
        "npm": input.npm_packages if input.npm_packages is not None else base.get("npm", []),
        "pip": input.pip_packages if input.pip_packages is not None else base.get("pip", []),
        "go": input.go_packages if input.go_packages is not None else base.get("go", []),
    }


# ---------------------------------------------------------------------------
# Image building
# ---------------------------------------------------------------------------


def _build_image(
    base_image: str,
    packages: dict[str, list[str]],
):
    """Build a ``daytona.Image`` with the given packages pre-installed.

    Returns:
        A ``daytona.Image`` instance ready for snapshot creation.
    """
    from daytona.common.image import Image

    image = Image.base(base_image)

    if packages["npm"]:
        cmd = "npm install -g " + " ".join(packages["npm"])
        image = image.run_commands(cmd)

    if packages["pip"]:
        image = image.pip_install(*packages["pip"])

    if packages["go"]:
        cmds = [f"go install {pkg}" for pkg in packages["go"]]
        image = image.run_commands(*cmds)

    return image


# ---------------------------------------------------------------------------
# Snapshot rotation
# ---------------------------------------------------------------------------


def _rotate_snapshots(
    daytona,
    keep: int,
    output: BuildMcpSnapshotOutput,
) -> None:
    """Delete old ``stigmer-mcp-*`` snapshots, keeping the most recent *keep*.

    Deletion is best-effort: failures are logged and added to
    ``output.errors`` but do not prevent the activity from succeeding.
    """
    from daytona_api_client import SnapshotState

    page = 1
    our_snapshots = []

    while True:
        result = daytona.snapshot.list(page=page, limit=100)
        for snap in result.items:
            if snap.name.startswith(SNAPSHOT_NAME_PREFIX):
                our_snapshots.append(snap)
        if page >= result.total_pages:
            break
        page += 1

    active = [s for s in our_snapshots if s.state == SnapshotState.ACTIVE]
    active.sort(key=lambda s: s.created_at, reverse=True)

    to_delete = active[keep:]
    if not to_delete:
        logger.info("No snapshots to rotate (have %d, keep %d)", len(active), keep)
        return

    for snap in to_delete:
        try:
            daytona.snapshot.delete(snap)
            output.deleted_snapshots.append(snap.name)
            logger.info("Deleted old snapshot: %s", snap.name)
        except Exception as e:
            msg = f"Failed to delete snapshot {snap.name}: {e}"
            logger.warning(msg)
            output.errors.append(msg)


# ---------------------------------------------------------------------------
# Temporal activity
# ---------------------------------------------------------------------------


@activity.defn(name=ACTIVITY_NAME)
async def build_mcp_snapshot(
    input: BuildMcpSnapshotInput,
) -> BuildMcpSnapshotOutput:
    """Build a Daytona snapshot with popular MCP servers pre-installed.

    Steps:
        1. Resolve the package list (input > env > defaults).
        2. Build a ``daytona.Image`` from the base sandbox image.
        3. Create a Daytona snapshot.
        4. Rotate old snapshots (keep last N).
        5. Invalidate the snapshot resolver cache.

    Guard: Returns immediately if ``DAYTONA_API_KEY`` is not set.
    """
    output = BuildMcpSnapshotOutput()

    api_key = os.getenv("DAYTONA_API_KEY")
    if not api_key:
        logger.info("DAYTONA_API_KEY not set — skipping snapshot build")
        return output

    from daytona import Daytona, DaytonaConfig

    daytona = Daytona(DaytonaConfig(api_key=api_key))

    if input.base_image:
        base_image = input.base_image
    else:
        base_image = os.getenv(
            "STIGMER_MCP_SNAPSHOT_BASE_IMAGE",
            "ghcr.io/stigmer/agent-sandbox-full:latest",
        )
    packages = _resolve_packages(input)

    total_count = sum(len(v) for v in packages.values())
    if total_count == 0:
        logger.info("No MCP server packages configured — skipping snapshot build")
        return output

    logger.info(
        "Building MCP snapshot: base=%s, npm=%d, pip=%d, go=%d",
        base_image,
        len(packages["npm"]),
        len(packages["pip"]),
        len(packages["go"]),
    )

    # 1. Build image
    image = _build_image(base_image, packages)

    # 2. Create snapshot
    from daytona.common.snapshot import CreateSnapshotParams

    snapshot_name = generate_snapshot_name()
    logger.info("Creating snapshot: %s", snapshot_name)

    def _on_logs(line: str) -> None:
        logger.info("[snapshot-build] %s", line)
        activity.heartbeat(f"snapshot_build:{snapshot_name}")

    try:
        daytona.snapshot.create(
            CreateSnapshotParams(name=snapshot_name, image=image),
            on_logs=_on_logs,
        )
        output.snapshot_name = snapshot_name
        logger.info("Snapshot created successfully: %s", snapshot_name)
    except Exception as e:
        msg = f"Snapshot creation failed: {e}"
        logger.error(msg)
        output.errors.append(msg)
        return output

    # 3. Rotate old snapshots
    _rotate_snapshots(daytona, keep=input.snapshots_to_keep, output=output)

    # 4. Invalidate the resolver cache so the next sandbox uses the new snapshot
    resolver = get_snapshot_resolver()
    if resolver:
        resolver.invalidate()
        logger.info("Snapshot resolver cache invalidated")

    return output
