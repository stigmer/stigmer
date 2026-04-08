# Stdio Arg Interpolation, GitHub MCP Update, and Tag Fix

**Date**: April 8, 2026

## Summary

Added `${VAR_NAME}` placeholder interpolation to stdio arguments in the MCP config transformer, enabling MCP servers that take core configuration as positional CLI arguments (PostgreSQL, Filesystem, SQLite) to be parameterized per-user through `env_spec`. Also updated the GitHub marketplace entry to use the official `github/github-mcp-server` Go binary and fixed `mcp-server-stigmer.yaml` tags for search indexing.

## Problem Statement

Three issues blocked progress on the MCP marketplace catalog:

### Pain Points

- **Positional-arg servers excluded**: MCP servers like PostgreSQL and Filesystem take core config (connection URL, directory paths) as CLI arguments, not environment variables. The agent-runner passed `stdio.args` as literal strings with no variable substitution, so these servers couldn't be parameterized per-user through the marketplace model.
- **Deprecated GitHub package**: The `github.yaml` marketplace entry used `@modelcontextprotocol/server-github`, which has a deprecation notice — development moved to the official `github/github-mcp-server` Go repository with a significantly larger toolset.
- **Non-searchable tags**: `mcp-server-stigmer.yaml` used `spec.tags` instead of `metadata.tags`, but the FTS5 search indexer only reads `metadata.tags`, making the system server's tags invisible to search.

## Solution

Extended the existing `PlaceholderResolver` infrastructure (already used for HTTP header/query param interpolation) to also resolve `${VAR_NAME}` placeholders in stdio args. The design preserves `env_spec` as the universal "what does this server need from the user?" declaration — unchanged UI/UX for both end users and platform builders.

## Implementation Details

### Stdio arg interpolation (agent-runner)

Added `_resolve_stdio_args()` to `config_transformer.py` using a **strict** `PlaceholderResolver` instance. Unlike HTTP interpolation (lenient mode for backward compat), stdio uses strict mode because an unresolved `${VAR}` passed literally as a CLI arg would cause a confusing server startup failure.

Key files:
- `backend/services/agent-runner/worker/mcp/config_transformer.py` — new `_resolve_stdio_args()` function, updated `_transform_stdio_config()`, added `PlaceholderResolutionError` to multi-server catch clause
- `backend/services/agent-runner/tests/mcp/test_config_transformer.py` — 10 new tests covering passthrough, single/multiple/partial/mixed resolution, strict error on missing vars, empty args, immutability
- `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` — documented `${VAR_NAME}` syntax on `StdioServerConfig.args` with examples and security note

### GitHub MCP server update (seedpack)

Switched `github.yaml` from `npx -y @modelcontextprotocol/server-github` (deprecated npm) to `go run github.com/github/github-mcp-server/cmd/github-mcp-server@latest stdio` (official Go binary). Added `GITHUB_HOST` (Enterprise support) and `GITHUB_TOOLSETS` (tool filtering) to env_spec.

### Tag fix (seedpack)

Moved `spec.tags` to `metadata.tags` in `mcp-server-stigmer.yaml` so the `system` and `built-in` tags are now indexed for search.

### Contributor guide update

Updated `seedpack/mcp-servers/CONTRIBUTING.md` to document arg interpolation as a supported pattern, updated the compatibility check section, and added a security note about argv visibility vs env var visibility.

## Benefits

- **PostgreSQL, Filesystem, SQLite unblocked**: These popular MCP servers can now be added to the marketplace catalog using `${VAR}` in their stdio args
- **No UI/UX changes needed**: The `EnvVarForm` experience is identical for env-var servers and arg-interpolated servers — `env_spec` cleanly abstracts the consumption model
- **Official GitHub server**: Larger toolset (Actions, code security, projects), active maintenance, Go binary consistent with `mcp-server-stigmer` pattern
- **Searchable system tags**: `mcp-server-stigmer` tags now appear in search results

## Impact

- **Agent-runner**: New interpolation logic in `_transform_stdio_config` — affects all stdio MCP server transforms (backward compatible: args without `${VAR}` pass through unchanged)
- **Proto documentation**: Updated `StdioServerConfig.args` comments — no schema change
- **Seedpack**: 2 YAML files updated, 1 contributor guide updated
- **Tests**: 42/42 config transformer tests pass, 58/58 placeholder resolver tests pass

## Related Work

- Follows from the [MCP Marketplace Catalog Session 1](2026-04-08-152617-mcp-marketplace-catalog-first-3-servers.md) which established the pattern and identified these three blockers
- Unblocks T02 (Tier 1 Developer Tools & Databases) in the marketplace catalog project

---

**Status**: Production Ready
**Timeline**: Single session
