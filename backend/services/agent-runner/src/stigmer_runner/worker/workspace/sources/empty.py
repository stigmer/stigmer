"""Empty workspace source — the default when no ``WorkspaceSource`` is configured.

The workspace directory already exists (created by ``initialize_workspace``).
This handler simply records the fact and returns the existing root.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from stigmer_runner.worker.workspace.provisioner import ProvisionResult, SourceType

if TYPE_CHECKING:
    from stigmer_runner.worker.workspace.backend import WorkspaceBackend


def provision(backend: WorkspaceBackend) -> ProvisionResult:
    """Return a ``ProvisionResult`` for an empty workspace.

    No commands are executed; no credentials are consumed.
    """
    return ProvisionResult(
        root_dir=backend.root_dir,
        source_type=SourceType.EMPTY,
        consumed_keys=(),
        workspace_description=(
            "Your workspace is empty. "
            "Create files and directories as needed for your task."
        ),
    )
