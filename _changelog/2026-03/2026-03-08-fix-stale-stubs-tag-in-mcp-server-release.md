# Fix Stale Proto Stubs Tag in MCP Server Release

**Date**: March 8, 2026

## Summary

Added `apis/stubs/go` to the release tagging process and bumped the MCP server seedpack to `v0.0.28`. The published `mcp-server-stigmer` binary was resolving proto stubs from `apis/stubs/go/v0.0.1` (tagged Feb 20) which predates the `McpServerStatus.discovered_capabilities` field (added Feb 25), causing discovered tools to be silently dropped from `get_mcp_server` responses.

## Problem Statement

The `mcp-server-stigmer` binary is consumed remotely via `go run ...@version`. Unlike every other module in the monorepo (which use `replace` directives to resolve `apis/stubs/go` from the local tree), the `mcp-server` module cannot use `replace` because Go ignores it in published modules.

The `apis/stubs/go` sub-module had only one tag (`v0.0.1`, created Feb 20). Five days later the `McpServerStatus` proto was expanded with `discovered_capabilities` (field 3), but no new stubs tag was created. All subsequent `mcp-server` releases (`v0.0.18` through `v0.0.27`) continued to resolve `v0.0.1` of the stubs from the Go module proxy.

At runtime the old proto deserializer placed field 3 into the unknown-fields bucket, and `protojson.Marshal` silently dropped it — so `get_mcp_server` returned status with only `audit`, no `discovered_capabilities`.

### Why it was invisible locally

The repo's `go.work` file includes both `./apis/stubs/go` and `./mcp-server`, so local builds always used the latest stubs. The CLI (which has a `replace` directive) also worked. The bug only manifested in the published binary fetched by `go run @version`.

## Root Cause

| Date | Event |
|------|-------|
| Feb 20 | `apis/stubs/go/v0.0.1` tagged — `McpServerStatus` has `validation_state`, `validation_message`, `audit`. No `discovered_capabilities`. |
| Feb 25 | `discovered_capabilities` (field 3) added to `McpServerStatus` proto and Go stubs — **no new stubs tag created** |
| Mar 8 | `mcp-server/v0.0.27` released — still depends on `apis/stubs/go v0.0.1` |

## Solution

### Files Changed

| File | Change |
|------|--------|
| `Makefile` | Release target now creates `apis/stubs/go/$NEW_TAG` alongside `$NEW_TAG` and `mcp-server/$NEW_TAG` |
| `mcp-server/go.mod` | Bumped `apis/stubs/go` from `v0.0.1` to `v0.0.28` |
| `mcp-server/go.sum` | Removed stale `v0.0.1` hash entries (Go re-verifies via sumdb on download) |
| `seedpack/mcp-servers/mcp-server-stigmer.yaml` | Bumped from `@v0.0.27` to `@v0.0.28` |

### Release Process Change

The `make release` target now creates three tags per release instead of two:

1. `apis/stubs/go/vX.Y.Z` — Go sub-module tag for the proto stubs (created first)
2. `vX.Y.Z` — root repo tag
3. `mcp-server/vX.Y.Z` — Go sub-module tag for the MCP server

All three are pushed in a single `git push` so they're available atomically on the proxy.

## Benefits

- `get_mcp_server` tool calls now return the full `McpServerStatus` including `discovered_capabilities`
- The `mcp-server-creator` agent can inspect tool metadata for approval-policy generation
- Future proto additions to status messages will be included in published binaries automatically

---

**Status**: Production Ready (after `make release` and `stigmer apply`)
