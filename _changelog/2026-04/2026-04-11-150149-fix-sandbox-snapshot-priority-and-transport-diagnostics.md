# Fix Sandbox Snapshot Resolution Priority and MCP Transport Diagnostics

**Date**: April 11, 2026

## Summary

Fixed MCP server discovery failures in cloud mode caused by the sandbox using the wrong snapshot (`daytona-small`, which lacks Go) instead of the custom `stigmer-mcp-*` snapshot. Also improved the Daytona transport's diagnostic output so that immediate process crashes produce actionable error messages instead of opaque "Connection closed" errors.

## Problem Statement

After completing the MCP server sandbox security project (moving stdio MCP server execution from the agent-runner pod into Daytona sandboxes), the `DiscoverMcpServerCapabilities` activity failed repeatedly for `mcp-server-stigmer`.

### Pain Points

- The sandbox snapshot resolution priority was inverted: the `DAYTONA_DEV_TOOLS_SNAPSHOT_ID` env var (`daytona-small`) was consulted first, blocking the `SnapshotResolver` from ever discovering custom snapshots with Go pre-installed
- `daytona-small` has Node.js + Python but no Go, so `go run github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest` failed immediately with "command not found"
- The Daytona transport logged stderr at `DEBUG` level (invisible in production), never checked process exit codes, and surfaced crashes as generic "Connection closed" — making diagnosis extremely difficult

## Solution

Two targeted fixes:

1. **Invert snapshot resolution priority** so the `SnapshotResolver` (which discovers custom `stigmer-mcp-*` snapshots with all runtimes) runs first, and the env var serves only as a bootstrap fallback.

2. **Improve transport diagnostics** so MCP server process crashes during startup produce visible, actionable log output.

## Implementation Details

### Snapshot Resolution (`worker/config.py`)

Changed the resolution order in `Config.get_sandbox_config()`:

| Priority | Before | After |
|----------|--------|-------|
| 1st | `DAYTONA_DEV_TOOLS_SNAPSHOT_ID` env var | `SnapshotResolver` (Daytona API) |
| 2nd | `SnapshotResolver` (never reached) | `DAYTONA_DEV_TOOLS_SNAPSHOT_ID` (fallback) |
| 3rd | None (vanilla sandbox) | None (vanilla sandbox) |

Added `logging` import and a fallback log message so it's visible when the env var is used as a safety net.

### Transport Diagnostics (`worker/mcp/daytona_transport.py`)

- **Stderr promoted to WARNING**: MCP server stderr during startup (e.g., `go: command not found`) is now visible in production logs
- **Early exit detection**: When the process exits without producing any stdout, an `ERROR`-level log includes the collected stderr content
- **Meaningful stdin write errors**: When `send_session_command_input` fails because the process died, the error includes stderr context instead of an opaque traceback

## Benefits

- MCP server discovery now uses the correct snapshot with Go + Node.js + Python pre-installed
- When MCP servers crash on startup, the logs immediately show *why* (stderr content, exit context)
- The `daytona-small` env var remains as a fallback for environments where custom snapshots don't exist yet (bootstrapping)

## Impact

- Cloud-mode MCP server discovery and agent execution for Go-based MCP servers (including `mcp-server-stigmer`)
- Improved operability for all sandboxed MCP server startups (any runtime)
- No changes to local/OSS mode, HTTP transport, or any other components

## Related Work

- MCP Server Sandbox Security project (`_projects/2026-04/20260409.01.mcp-server-sandbox-security/`)
- Snapshot build workflow (T01) — creates `stigmer-mcp-*` snapshots with polyglot runtimes
- Domain migration from `stigmer-prod-api.planton.live` to `api.stigmer.ai` (`_changelog/2026-03/2026-03-31-201945`)

---

**Status**: ✅ Production Ready
