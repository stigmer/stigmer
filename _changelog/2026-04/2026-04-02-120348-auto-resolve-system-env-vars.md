# Auto-Resolve Stigmer System Environment Variables

**Date**: April 2, 2026

## Summary

Added automatic resolution of `STIGMER_SERVER_ADDRESS` and `STIGMER_API_KEY` environment variables across the SDK layer, eliminating unnecessary user prompts when adding MCP servers or agents that need to communicate with the Stigmer backend. The SDK client already knows the server address and auth credential — setup hooks now leverage that context transparently.

## Problem Statement

When users added `mcp-server-stigmer` (or any resource declaring `STIGMER_SERVER_ADDRESS` / `STIGMER_API_KEY` in its `env_spec`) to a session, the UI prompted them for values the platform already knew. This created friction in the most common onboarding path: the built-in Stigmer MCP server requires these two env vars, yet the web app inherently has both values available from its own connection context.

### Pain Points

- Users were asked to manually enter the Stigmer server address — a value the SDK client was already connected to
- Users were asked for an API key in OSS mode (disabled auth) where no real key is needed
- The MCP server credential form appeared for env vars that should never require manual input
- Platform builders embedding Stigmer faced the same unnecessary prompt in their own products

## Solution

Introduced a two-phase system env var resolution mechanism in the SDK layer:

1. **Setup phase (sync)**: A static set of well-known keys (`SYSTEM_ENV_VAR_KEYS`) is merged into `poolKeys`, causing `diffEnvSpec` to skip them — no prompt shown to the user.
2. **Submit phase (async)**: Values are resolved from the live `Stigmer` client (`baseUrl` → gRPC address, `getAuthCredential()` → API key) and injected into runtime env at the lowest priority, so any explicit user-provided value always wins.

## Implementation Details

### `@stigmer/sdk` — Expose connection context

- Added `readonly baseUrl: string` to the `Stigmer` class (stored from config)
- Added `getAuthCredential(): Promise<string | null>` method that calls the stored token provider (static API key or dynamic `getAccessToken`)

### `@stigmer/react` — New system env var module

Created `sdk/react/src/environment/systemEnvVars.ts` with:

- `SYSTEM_ENV_VAR_KEYS` — `ReadonlySet` of the two well-known keys
- `toGrpcAddress(httpUrl)` — converts HTTP base URL to gRPC `host:port` (`http://localhost:7234` → `localhost:7234`, `https://api.stigmer.ai` → `api.stigmer.ai:443`)
- `buildSystemEnvVars(baseUrl, credential)` — pure function returning both env vars
- `resolveSystemEnvVarValues(stigmer)` — async function that calls `getAuthCredential()` then `buildSystemEnvVars()`

### `@stigmer/react` — SessionComposer integration

- `poolKeysWithSystem` memo combines pool keys with `SYSTEM_ENV_VAR_KEYS`, passed to both `useAgentSetup` and `useMcpServerSetup`
- `handleSubmit` resolves system env var values and injects them at lowest priority before other runtime env sources

### `@stigmer/react` — Detail page credentials hook

- `useMcpServerCredentials` now filters `SYSTEM_ENV_VAR_KEYS` from `missingVariables`, so the MCP server detail page discovery flow also skips these vars

### Tests

- 15 unit tests for `toGrpcAddress`, `buildSystemEnvVars`, and `SYSTEM_ENV_VAR_KEYS` — all passing
- Full SDK test suite (128 tests across 10 files) — all passing

## Benefits

- **Zero-prompt MCP server setup**: Adding `mcp-server-stigmer` to a session no longer requires manual env var entry
- **SDK-layer solution**: Platform builders get the same auto-resolution behavior without any wiring
- **Override-friendly**: Users who explicitly set these vars in personal env or session variables take precedence
- **No architectural changes**: `diffEnvSpec`, `useMcpServerSetup`, `useAgentSetup`, and `useSessionEnvPool` remain unchanged

## Impact

- **Direct users**: Smoother onboarding — the built-in MCP server "just works" without credential prompts
- **Platform builders**: Same benefit when their users add Stigmer-backend-connected MCP servers
- **OSS users**: `STIGMER_API_KEY` auto-resolves to a placeholder value (`"unused"`) when auth is disabled

## Related Work

- CLI already bridges these env vars via `applyCLIConfigEnv` in `mcp_server.go`
- The MCP server env resolver (`env_resolver.go`) uses the same logical defaults
- This work brings the web app to parity with the CLI's env var handling

---

**Status**: ✅ Production Ready
