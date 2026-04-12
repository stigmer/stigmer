# Fix MCP Snapshot Build Cascade Failure and Harden Package Installation

**Date**: April 12, 2026

## Summary

Diagnosed and fixed a production failure where the MCP snapshot build was failing entirely due to a single misconfigured package (`@modelcontextprotocol/server-fetch`), and hardened the build pipeline so that individual package failures can never again take down the entire snapshot.

## Problem Statement

The scheduled MCP snapshot build (every 6h) was failing with an `npm ERR! 404` for `@modelcontextprotocol/server-fetch`. Because the build used a single `npm install -g` command for all 19 npm packages, the one 404 caused **all** packages to fail, and the entire snapshot creation was aborted.

### Pain Points

- `mcp-server-fetch.yaml` incorrectly declared the Fetch MCP server as an npm/npx package (`npx -y @modelcontextprotocol/server-fetch`), but this npm package does not exist — the Fetch server is Python-only (`uvx mcp-server-fetch` / `pip install mcp-server-fetch`)
- The Java `ResolveSnapshotPackagesActivity` correctly extracted it as an npm package based on the `npx` command, so the bad identifier propagated into the build
- The Python `_build_image` function used a single `npm install -g pkg1 pkg2 ... pkg19` command — npm treats this atomically, so one 404 killed all 19 installs
- The same fragility applied to pip and go package installation
- The `mcp-server-fetch` Python package was already correctly included in the baseline pip packages (both in `McpSnapshotTemporalConfig.java` and `build_mcp_snapshot.py`), making the bad npm entry a phantom duplicate

## Solution

Two-part fix:

1. **Correct the seedpack YAML**: Changed `mcp-server-fetch.yaml` from `npx`/`@modelcontextprotocol/server-fetch` to `uvx`/`mcp-server-fetch`, matching the actual Python runtime
2. **Harden the build pipeline**: Replaced the single bulk install command with per-package installation via a shell `for` loop that continues on failure, logging warnings for any packages that fail without aborting the build

## Implementation Details

### Seedpack YAML Fix

`seedpack/mcp-servers/mcp-server-fetch.yaml`: Changed `command: "npx"` with args `["-y", "@modelcontextprotocol/server-fetch"]` to `command: "uvx"` with args `["mcp-server-fetch"]`.

### Build Pipeline Hardening

`backend/services/agent-runner/worker/activities/build_mcp_snapshot.py`:

- Added `_build_install_script(manager_cmd, packages)` helper that generates a shell snippet installing each package individually:
  ```
  failed=""; for pkg in PKG1 PKG2 ...; do CMD "$pkg" || failed="$failed $pkg"; done; [ -z "$failed" ] || echo "WARN: failed to install:$failed"
  ```
- Updated `_build_image` to use this helper for all three runtimes (npm, pip, go)
- Failed packages are collected and emitted as a single `WARN` line visible in snapshot build logs via the `_on_logs` callback
- The Dockerfile `RUN` layer always succeeds, so the snapshot is created with all packages that **did** install successfully

### Architecture Context (Polyglot Workflow)

The snapshot build is a polyglot Temporal workflow:
- **Java** (`BuildMcpSnapshotWorkflow` on `mcp_server` queue): Runs `ResolveSnapshotPackagesActivity` as a local activity — queries MongoDB for all stdio MCP servers, extracts package identifiers by runtime (`npx` → npm, `uvx` → pip, `go run` → go), merges with curated baseline, caps at configured maximums
- **Python** (`BuildMcpSnapshot` on `agent_execution_runner` queue): Builds a Daytona Docker image with the packages pre-installed, creates a named snapshot (`stigmer-mcp-YYYYMMDD-HHMMSS`), rotates old snapshots, invalidates the `SnapshotResolver` cache

## Benefits

- **Immediate**: Unblocks the snapshot build that was failing every 6 hours
- **Resilience**: A single bad or temporarily unavailable package can never again prevent the remaining packages from being installed
- **Observability**: Failed packages are logged explicitly, making it easy to spot and fix bad entries without needing to dig through npm error output
- **Correctness**: The Fetch MCP server YAML now reflects the actual Python runtime, so the Java package resolver classifies it correctly as a pip package

## Impact

- **Agent sandbox cold-start latency**: Restored — new snapshots with pre-installed MCP servers will be created on the next scheduled run
- **All MCP server seedpack entries**: Any future bad entry (typo, renamed package, delisted package) will degrade gracefully instead of causing a total build failure
- **No changes to Java workflow code**: The fix is entirely in the Python activity and the seedpack YAML; the Java `ResolveSnapshotPackagesActivity` was working correctly based on the data it received

## Related Work

- [Polyglot MCP Snapshot Workflow](2026-04-09-192355-polyglot-mcp-snapshot-workflow.md) — original implementation of the snapshot build pipeline
- [Fix MCP Snapshot Build Heartbeat and GHCR Auth](2026-04-10-111731-fix-mcp-snapshot-build-heartbeat-and-ghcr-auth.md) — previous snapshot build fix
- [Fix Sandbox Snapshot Priority and Transport Diagnostics](2026-04-11-150149-fix-sandbox-snapshot-priority-and-transport-diagnostics.md) — snapshot resolver priority chain

---

**Status**: ✅ Production Ready
