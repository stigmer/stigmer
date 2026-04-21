# Slim Sandbox Image with On-Demand MCP Bootstrap

**Date**: April 21, 2026

## Summary

Slimmed the cloud sandbox image from ~995 MB to ~800 MB by removing all pre-installed MCP server packages (12 npm, 6 pip). MCP packages are now installed on-demand at sandbox startup by a bootstrap script that reads agent-specific package lists from environment variables set by stigmer-service. The Go toolchain is retained because core MCP servers (Stigmer, Planton, GitHub) are Go-based.

## Problem Statement

The `Dockerfile.sandbox.full` baked in 12 npm packages, 6 pip packages, and the Go toolchain (~206 MB) — regardless of what any given agent actually needed. This caused:

### Pain Points

- **Image bloat**: 995 MB image where ~200 MB was pre-installed MCP packages most agents never use
- **Rigidity**: Adding or removing an MCP server package required rebuilding the entire base image via CI
- **Unbounded growth**: As MCP servers proliferate, the image size grows without limit
- **No agent-specificity**: The system has rich knowledge about each agent's MCP server needs (`Agent.spec.mcp_server_usages`) but didn't use it for image optimization

## Solution

Split the image into a slim base (runtimes only) and an on-demand bootstrap layer that installs only what each agent needs.

## Implementation Details

### stigmer repo (agent-runner)

**Dockerfile.sandbox.full slimmed:**
- Removed all 12 pre-installed npm packages (`@modelcontextprotocol/server-*`, `@brave/brave-search-mcp-server`, etc.)
- Removed all 6 pre-installed pip packages (`mcp-server-fetch`, `postgres-mcp`, etc.)
- Go toolchain retained — core MCP servers (Stigmer, Planton, GitHub) are Go-based
- Updated header comments

**New bootstrap.sh script:**
- Reads `STIGMER_BOOTSTRAP_NPM_PACKAGES` (comma-separated) and `STIGMER_BOOTSTRAP_PIP_PACKAGES` (comma-separated) env vars
- Installs npm packages via `npm install -g`, pip packages via `uv tool install`
- Individual failures are logged but do not abort — failed packages fall back to on-demand install via `npx -y` / `uvx`
- No-op when both env vars are empty (HTTP-only MCP servers, or agents with no MCP servers)

**CI workflow updated:** Added `bootstrap.sh` to the path trigger in `release.sandbox-cloud.yaml`.

**Docs updated:** `PERFORMANCE.md` reflects new image size and bootstrap latency. `execution-modes.md` documents bootstrap env vars and on-demand install behavior.

### stigmer-cloud repo (stigmer-service)

**New McpBootstrapResolver service:**
- Traces session → agent_instance → agent → mcp_server_usages → McpServer specs
- Extracts npm package names from `npx -y <package>` command patterns
- Extracts pip package names from `uvx <package>` command patterns
- Custom commands (`node`, `python`, etc.) are silently skipped — those servers install on-demand

**AgentRunnerDispatchService updated:**
- When provisioning ephemeral runners, resolves MCP bootstrap packages via `McpBootstrapResolver`
- Sets `STIGMER_BOOTSTRAP_NPM_PACKAGES` and `STIGMER_BOOTSTRAP_PIP_PACKAGES` as labels on the runner resource

**DaytonaSandboxRunnerLauncher updated:**
- Reads bootstrap package labels from the runner resource
- Includes them as env vars on the sandbox

**Runner start command updated:**
- Default changed from `nohup /app/.venv/bin/python /app/main.py ...` to `/app/sandbox/bootstrap.sh && nohup /app/.venv/bin/python /app/main.py ...`
- Bootstrap runs and completes before the runner process starts

## Benefits

- **~20% smaller image**: ~800 MB down from 995 MB
- **Agent-specific packages**: Each sandbox installs only what its agent's MCP servers actually reference
- **Faster CI**: Smaller image builds faster, pushes faster, warms faster
- **Extensible**: Adding new MCP servers to the seedpack no longer requires Dockerfile changes — just define the McpServer resource and the bootstrap handles installation
- **Graceful degradation**: If bootstrap fails, `npx -y` / `uvx` still install on first use

## Impact

- **agent-runner**: Dockerfile slimmed. New `bootstrap.sh` script added. No Python code changes.
- **stigmer-service**: New `McpBootstrapResolver`. Dispatch service resolves packages and sets labels. Launcher reads labels and sets env vars. Start command runs bootstrap first.
- **CI**: No structural changes — same image name, same build/push/warm flow. Bootstrap script path added to triggers.
- **Bootstrap latency**: 5-15 seconds one-time cost per sandbox (not per execution). Sandboxes persist for the session lifetime.

---

**Status**: Production Ready
