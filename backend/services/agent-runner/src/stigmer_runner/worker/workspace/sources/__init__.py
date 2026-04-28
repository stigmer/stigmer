"""Workspace source handlers.

Each module in this package implements provisioning logic for a single
``WorkspaceSource`` variant:

    empty       No source configured — workspace starts empty.
    git         Clone a git repository via HTTPS.
    local_path  Use an existing host directory (local mode only).
"""
