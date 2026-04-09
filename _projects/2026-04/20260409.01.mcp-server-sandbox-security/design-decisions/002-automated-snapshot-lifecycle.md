# Design Decision 002: Automated Snapshot Lifecycle via Temporal Scheduled Workflow

**Date**: 2026-04-09
**Status**: Accepted
**Context**: MCP server security brainstorming session

## Decision

Automate Daytona snapshot creation and lifecycle management through a Temporal scheduled workflow that programmatically builds snapshots with popular MCP server packages pre-installed, replacing the manual snapshot setup process.

## Problem

When MCP servers run in the sandbox, `npx -y @package/name` downloads the package on first use. In a new session (new sandbox), this cold start adds 3-10 seconds per MCP server. Manual snapshot management (documented in `docs/sandbox/daytona-setup.md`) is tedious and doesn't adapt to changing MCP server popularity.

## Solution

1. **Temporal scheduled workflow** runs every N hours
2. Queries DB for the most-used MCP servers in a configurable time window
3. Builds a `daytona.Image` declaratively: `Image.base(sandbox-basic).run_commands(npm install -g ...).pip_install(...)`
4. Creates a new snapshot via `daytona.snapshot.create()`
5. Stores the active snapshot name in MongoDB
6. Cleans up old snapshots (keep last 3)

## Key Technical Findings

- **Daytona SDK v0.151.0** fully supports programmatic snapshot management
- `Image.run_commands()` adds `RUN` lines to a generated Dockerfile -- works for any shell command
- `Image.pip_install()` provides first-class pip support
- Snapshot creation polls until ACTIVE/ERROR/BUILD_FAILED (handled by SDK)
- `daytona.snapshot.delete()` is safe for running sandboxes (they are independent after creation)

## Snapshot Deletion Safety

Deleting an old snapshot does NOT affect running sandboxes. Once created, a sandbox has its own independent filesystem. The `sandbox.snapshot` attribute is metadata only. Keeping the last 3 snapshots handles the narrow race condition during in-flight sandbox creation.

## Dynamic Configuration

Replace static `DAYTONA_DEV_TOOLS_SNAPSHOT_ID` env var with DB-driven active snapshot name:
- DB value updated by the Temporal snapshot builder
- Env var preserved as fallback for local dev and testing
- Enables zero-downtime snapshot updates without pod restarts

## Consequences

- Zero manual snapshot management
- Self-adapting to user MCP server popularity
- Marketplace servers have near-zero cold start (pre-installed in snapshot)
- User-defined servers still have first-use download, but cached within the session
