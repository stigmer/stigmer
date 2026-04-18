# Lenient MCP Server Discovery for Optional Environment Variables

**Date**: March 4, 2026

## Summary

MCP server discovery no longer skips servers when non-secret environment variables (like endpoint overrides or environment selectors) can't be resolved locally. Only missing credentials (secret env vars) now block discovery, allowing servers with sensible defaults to be discovered without requiring every declared env var to be present.

## Problem Statement

The `stigmer apply` and bootstrap discovery flows iterate over every variable declared in an MCP server's `env_spec`. If any variable couldn't be resolved from the shell environment or a well-known local credential store, discovery was skipped entirely for that server.

### Pain Points

- Optional configuration variables (e.g. `PLANTON_APIS_GRPC_ENDPOINT`) blocked discovery even though the MCP server has built-in defaults and can start without them.
- Users saw confusing "Discovery skipped" messages and had to manually export variables that were genuinely optional.
- The GitHub MCP server model (only a token is truly required; everything else is optional) wasn't reflected in the discovery logic.

## Solution

Use the existing `is_secret` flag on each `env_spec` entry to distinguish between blocking and non-blocking unresolved variables:

- **Secret (credential) vars** that can't be resolved remain blocking — the server can't authenticate without them.
- **Non-secret (configuration) vars** that can't be resolved are treated as optional — the MCP server is expected to have sensible defaults.

## Implementation Details

**`EnvResolutionResult`** gained a new `UnresolvedOptional` field alongside the existing `Unresolved` field. In `ResolveEnvForDiscovery`, when a variable can't be resolved via `resolveKnownVar`, it checks `envSpec[name].GetIsSecret()` to route to the correct bucket.

**`DiscoverAll` and `DiscoverOne`** continue to skip only when `Unresolved` (secrets) is non-empty. When `UnresolvedOptional` is non-empty, a debug log is emitted and discovery proceeds.

No proto changes were needed — the `is_secret` field already existed on `EnvironmentValue`.

## Benefits

- MCP servers with optional configuration variables (like Planton's endpoint override) are now discoverable out of the box with just a credential.
- Clearer separation of concerns: credentials block, configuration doesn't.
- Zero breaking changes — servers that only declare secret env vars behave identically to before.

## Impact

- **CLI users**: Fewer "Discovery skipped" messages during `stigmer apply` and daemon bootstrap.
- **MCP server authors**: Can declare optional configuration variables in `env_spec` without worrying about blocking discovery for users who don't need overrides.

## Related Work

- [Add Planton environment well-known var](2026-03-03-103741-add-planton-environment-well-known-var.md) — added `PLANTON_CLOUD_ENVIRONMENT` to well-known vars.
- [Add --env flag to discover mcp-server](2026-03-03-103119-add-env-flag-to-discover-mcp-server.md) — manual discovery with explicit env overrides.

---

**Status**: ✅ Production Ready
