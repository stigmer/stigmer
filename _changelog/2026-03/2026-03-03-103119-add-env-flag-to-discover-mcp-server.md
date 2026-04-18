# Add --env Flag to `stigmer discover mcp-server`

**Date**: March 3, 2026

## Summary

Added `--env KEY=VALUE` flag to `stigmer discover mcp-server`, bringing it in line with `stigmer run` and `stigmer draft` which already support this flag. Previously, users had to export shell environment variables before running discover; now credentials can be passed inline on the command itself.

## Problem Statement

The `stigmer discover mcp-server` command spawns an MCP server as a subprocess and inherits the caller's shell environment. However, unlike `stigmer run` and `stigmer draft` (which accept `--env KEY=VALUE` flags), the discover command had no way to pass environment variables directly on the command line.

### Pain Points

- Users had to `export PLANTON_API_KEY=pk-xxx` before running discover, which is easy to forget and pollutes the shell session
- Inconsistent UX: `stigmer draft skill --env GITHUB_TOKEN=xxx` works but `stigmer discover mcp-server --env PLANTON_API_KEY=xxx` did not
- The plumbing was already in place (`DiscoverOptions.EnvOverrides` → `mergeEnv(os.Environ(), envOverrides)` in transport.go) but was never wired to a CLI flag

## Solution

Added a `--env` `StringArrayVar` flag to the discover mcp-server cobra command, wired through `discoverMcpServerOptions.EnvOverrides` → `mcpserver.DiscoverOptions.EnvOverrides`. Updated the help text with an "ENVIRONMENT VARIABLES" section and examples showing `--env` usage patterns.

## Implementation Details

- **`client-apps/cli/cmd/stigmer/root/discover.go`**: Added `envFlags []string` variable, registered as `--env` flag via `StringArrayVar` (repeatable, `KEY=VALUE` format). Wired through `discoverMcpServerOptions.EnvOverrides` into `mcpserver.DiscoverOptions.EnvOverrides`.
- **Help text**: Added `ENVIRONMENT VARIABLES` section explaining `--env` behavior, auto-resolution in automated flows, and precedence rules. Added examples for inline `--env`, multiple vars.
- No changes needed to `mcpserver/discover.go` or `mcpdiscovery/transport.go` — the `EnvOverrides` field and `mergeEnv` logic already existed.

## Benefits

- Consistent `--env` flag across `stigmer run`, `stigmer draft`, and `stigmer discover`
- No need to pollute the shell session with exported credentials
- Self-documenting: `--help` now explains how env vars are passed and resolved

## Impact

- CLI users running `stigmer discover mcp-server` with credential-requiring servers (planton, github, etc.)
- Zero breaking changes — shell-inherited env vars continue to work as before

---

**Status**: ✅ Production Ready
