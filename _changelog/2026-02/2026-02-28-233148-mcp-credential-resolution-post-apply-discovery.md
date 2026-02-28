# MCP Server Credential Resolution and Post-Apply Discovery

**Date**: February 28, 2026

## Summary

Extended the Stigmer CLI's MCP server credential resolution to support GitHub and Planton tokens from local credential stores, added automatic post-apply discovery so MCP server capabilities are immediately available after `stigmer apply`, and introduced actionable skip messages when credentials cannot be resolved.

## Problem Statement

When users applied MCP server resources via `stigmer apply`, the servers were registered with the backend but their capabilities were not discovered until the next daemon restart. Additionally, the CLI only knew how to resolve Stigmer-specific environment variables (`STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`) — third-party MCP servers like GitHub or Planton required manual env var configuration.

### Pain Points

- MCP servers applied via `stigmer apply` required a daemon restart before their tools were discoverable
- GitHub MCP server users had to manually set `GITHUB_TOKEN` even when `gh` CLI was authenticated
- Planton MCP server users had to manually set `PLANTON_API_KEY` even when `planton login` had been run
- When discovery was skipped due to missing credentials, users received no guidance on how to fix it

## Solution

Three interconnected changes:

1. **Credential resolution** — Extended the existing `resolveKnownVar()` pattern with `GITHUB_TOKEN` (via `gh auth token` subprocess) and `PLANTON_API_KEY` (via `~/.planton/credentials/{env}/token.json` file reading)
2. **Post-apply discovery** — After `stigmer apply` registers MCP servers, automatically trigger capability discovery for each one using the same resolution logic
3. **Actionable skip messages** — When credentials can't be resolved, show the user an exact `stigmer discover` command they can run with the required env vars

## Implementation Details

### Credential Resolvers (`env_resolver.go`)

- `resolveGithubToken()` — Runs `gh auth token` with a 5-second timeout. Works with macOS Keychain, Linux keyring, Windows credential manager, or legacy `hosts.yml`. Returns empty on any failure.
- `resolvePlantonAPIKey()` — Reads `~/.planton/config.yaml` for `current_environment` (defaults to `"production"`), then reads `~/.planton/credentials/{env}/token.json` and extracts `access_token`. Silent on all errors.
- `resolvePlantonEnvironment()` — Helper that reads the Planton CLI config to determine the active environment.

### Env Resolution Result

Refactored `ResolveEnvForDiscovery()` to return `EnvResolutionResult` with both resolved overrides and unresolved variable names, enabling callers to show actionable messages.

### Post-Apply Discovery

- Added `DiscoverOne()` function for single-server discovery (post-apply entry point)
- Added `discoverAppliedMcpServers()` to the file and declarative apply flows
- Added `discoverAppliedMcpServersSDK()` to the SDK synthesis apply flow
- Extended `fileApplyContext` with `cfg` and `appliedMcpServers` fields to collect applied servers during the apply loop

### Skip Messages

`FormatDiscoverySkipMessage()` generates messages like:
```
Discovery skipped for github-mcp-server: GITHUB_TOKEN not available
  To discover manually:
    GITHUB_TOKEN=<your-token> stigmer discover mcp-server github-mcp-server
```

### Files Changed

- `client-apps/cli/internal/cli/mcpserver/env_resolver.go` — New resolvers and `EnvResolutionResult` type
- `client-apps/cli/internal/cli/mcpserver/discover_all.go` — `DiscoverOne()`, `FormatDiscoverySkipMessage()`, skip message tracking
- `client-apps/cli/cmd/stigmer/root/apply_file.go` — Post-apply discovery trigger, extended `fileApplyContext`
- `client-apps/cli/cmd/stigmer/root/apply_file_handlers.go` — Collect applied MCP servers
- `client-apps/cli/cmd/stigmer/root/apply_declarative.go` — Wire post-apply discovery
- `client-apps/cli/cmd/stigmer/root/apply_project.go` — SDK path post-apply discovery
- `client-apps/cli/cmd/stigmer/root/server.go` — Show skip messages during bootstrap discovery
- `client-apps/cli/internal/cli/mcpserver/env_resolver_test.go` — 18 new tests
- `client-apps/cli/internal/cli/mcpserver/BUILD.bazel` — Updated test deps

## Benefits

- **Zero-friction discovery** — MCP server tools are available immediately after `stigmer apply`, no daemon restart needed
- **Automatic credential bridging** — Reuses existing `gh` and `planton` CLI credentials without manual env var setup
- **Actionable error recovery** — Users get exact commands to run when credentials are missing
- **Extensible pattern** — Adding new credential sources requires only a new case in `resolveKnownVar()` and a resolver function

## Impact

- **End users**: MCP servers like GitHub and Planton "just work" if the user has the respective CLIs authenticated
- **CLI maintainers**: Clear, bounded pattern for adding new credential sources
- **Platform**: Foundation for seamless third-party MCP server integration

## Related Work

- Seedpack bootstrap and auto-discovery (existing `DiscoverAll` flow)
- Environment spec proto (`env_spec.data` on `McpServerSpec`)

---

**Status**: Production Ready
**Timeline**: Single session
