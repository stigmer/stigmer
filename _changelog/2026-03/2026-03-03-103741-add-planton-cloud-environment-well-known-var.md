# Add PLANTON_CLOUD_ENVIRONMENT as Well-Known Environment Variable

**Date**: March 3, 2026

## Summary

Added `PLANTON_CLOUD_ENVIRONMENT` to the CLI's well-known environment variable registry so that MCP servers requiring a Planton environment name get it auto-resolved without user intervention. The value is read from `~/.planton/config.yaml` (the Planton CLI's local config) and defaults to `"production"` when absent.

## Problem Statement

MCP servers that integrate with Planton (e.g., the `planton` MCP server) declare `PLANTON_CLOUD_ENVIRONMENT` in their `env_spec`. Without auto-resolution, users had to manually supply `PLANTON_CLOUD_ENVIRONMENT=<value>` every time they ran `stigmer discover` or `stigmer run` — friction that the well-known variable system was designed to eliminate.

### Pain Points

- Users had to remember and type `PLANTON_CLOUD_ENVIRONMENT=production` on every invocation
- Discovery of Planton-integrated MCP servers would skip with an "unresolved variable" warning
- The Planton CLI already stores this information locally — duplicating it manually was unnecessary

## Solution

Register `PLANTON_CLOUD_ENVIRONMENT` alongside the existing well-known variables (`STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`, `GITHUB_TOKEN`, `PLANTON_API_KEY`) in `env_resolver.go`. Resolution reuses the existing `resolvePlantonEnvironment` helper that reads `current_environment` from `~/.planton/config.yaml`.

## Implementation Details

- Added `"PLANTON_CLOUD_ENVIRONMENT"` to the `wellKnownVars` slice
- Added a `case "PLANTON_CLOUD_ENVIRONMENT"` in `resolveKnownVar` dispatching to new `resolvePlantonEnvironment()` function
- `resolvePlantonEnvironment()` delegates to the existing `resolvePlantonEnvironment()` helper, always returning `true` (a sensible default of `"production"` is always available)
- Not added to `secretVars` — environment names are not credentials
- Updated `ResolveEnvForDiscovery` doc comment to list the new variable

## Benefits

- Zero-friction discovery and execution of Planton MCP servers
- Consistent with existing well-known variable auto-resolution pattern
- Shell environment still takes priority if explicitly set

## Impact

- **CLI users**: Planton-integrated MCP servers now auto-resolve during `stigmer discover` and `stigmer run`
- **MCP server authors**: Can declare `PLANTON_CLOUD_ENVIRONMENT` in `env_spec` knowing it will be resolved automatically

---

**Status**: ✅ Production Ready
