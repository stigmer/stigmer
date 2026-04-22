# Move MCP Package Install Into Agent-Runner from Spec

**Date**: April 22, 2026

## Summary

Reverted the `bootstrap.sh` env-var pipeline introduced in the slim-image change. MCP package installation now happens inside the agent-runner Python process during execution setup, deriving packages directly from the merged (agent + session) MCP server specs. This fixes a bug where session-level MCP servers were missed by the bootstrap, restores user-visible status updates during install, and eliminates a redundant resolution pipeline in stigmer-service.

## Problem Statement

The bootstrap.sh change (2026-04-21) introduced three issues:

### 1. Session-Level MCP Servers Missed

`McpBootstrapResolver.resolveForSession()` only read `agent.spec.mcp_server_usages`. It completely ignored `session.spec.mcp_server_usages`. If a user attached an MCP server at the session level, `bootstrap.sh` never installed its packages.

### 2. Redundant Pipeline

`McpBootstrapResolver` in stigmer-cloud parsed `npx`/`uvx` command patterns from MCP server specs, stuffed package names into runner metadata labels, piped them through `DaytonaSandboxRunnerLauncher` as sandbox env vars. This duplicated knowledge that the agent-runner already had from the same specs via gRPC.

### 3. Silent Status Gap

`bootstrap.sh` ran before the Python process started (`bootstrap.sh && nohup python ...`), so during the 5-15s install window there were no status updates to the user and no Temporal heartbeats.

## Solution

Move package installation into the agent-runner Python process, operating on the merged MCP server list that `setup.py` already computes from both agent and session sources. Delete the entire env-var pipeline.

## Implementation Details

### stigmer repo (agent-runner)

**New `worker/mcp/package_installer.py`:**
- Extracts installable packages from `McpServer` proto specs:
  - `command == "npx"` with `-y` flag → npm package (`npm install -g`)
  - `command == "uvx"` → pip package (`uv tool install`)
  - Custom commands silently skipped
- Installs packages concurrently as async subprocesses
- Individual failures are non-fatal (graceful degradation via `npx -y` / `uvx`)
- Returns `InstallResult` with installed/failed/skipped counts

**`setup.py` integration:**
- Inserted after parallel fetch (which returns merged agent + session servers)
- Reports `"Installing tools…"` via `report_setup_progress`
- Heartbeats with install outcome metadata
- Timer phase `mcp_package_install` for latency tracking

**Deleted:**
- `sandbox/bootstrap.sh`
- Bootstrap COPY/chmod from `Dockerfile.sandbox.full`
- `bootstrap.sh` from CI path triggers in `release.sandbox-cloud.yaml`

### stigmer-cloud repo (stigmer-service)

**Deleted:**
- `McpBootstrapResolver.java` (entire class)

**Cleaned up:**
- `AgentRunnerDispatchService`: removed `mcpBootstrapResolver` field and bootstrap resolution block from `provisionEphemeralRunner()`
- `DaytonaSandboxRunnerLauncher`: removed `STIGMER_BOOTSTRAP_*` label reading from `buildEnvVars()`

**Reverted start command:**
- `RunnerLauncherConfig.java` and `application-runner-launcher.yaml`: removed `bootstrap.sh &&` prefix, back to direct `nohup python ...`

## Benefits

- **Session-level MCP servers included**: `merge_mcp_server_usages(agent.spec, session.spec)` runs before the installer
- **Single source of truth**: package list derived from the same merged MCP server protos that `setup.py` already uses
- **User sees status**: `report_setup_progress("Installing tools…")` sends a visible status line
- **Temporal heartbeats flow**: no silent gap before runner startup
- **Slim image preserved**: ~800 MB, no packages baked in

## Impact

- **agent-runner**: New `package_installer.py` module. `setup.py` integration. `bootstrap.sh` deleted. Docs updated.
- **stigmer-service**: `McpBootstrapResolver` deleted. Dispatch and launcher cleaned up. Start command reverted.
- **Image size**: Unchanged (~800 MB). Packages still installed on-demand, just by the runner instead of a shell script.

---

**Status**: Production Ready
