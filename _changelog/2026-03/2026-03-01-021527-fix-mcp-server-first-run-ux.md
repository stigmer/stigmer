# Fix MCP Server First-Run UX: Seedpack Timing, Search Index, Discovery

**Date**: March 1, 2026

## Summary

Fixed three interconnected bugs that produced a broken first-run experience when starting Stigmer and listing MCP servers. Seedpack was not applied during `stigmer server`, the FTS5 search index was never updated after resource creation, and MCP server discovery was incorrectly skipped for the local backend due to a false-negative credential check.

## Problem Statement

Running `stigmer server` followed by `stigmer list mcp-server` produced a cascade of failures:

1. The seedpack (system agents, skills, MCP servers) was not applied during `stigmer server start` — it was deferred to the first `EnsureRunning()` call from any subsequent CLI command, leaking internal bootstrap noise into unrelated commands like `list`.
2. Even after seedpack successfully created resources, the FTS5 search index (used by `list` and `search`) was never updated. The index was only rebuilt at server startup, before any resources existed. Resources created afterward were invisible until a daemon restart.
3. MCP server discovery pre-emptively skipped the built-in `stigmer-mcp-server` because `STIGMER_API_KEY` resolved to an empty string on local backend, which the resolver incorrectly treated as "unresolved".

### Pain Points

- `stigmer list mcp-server` showed "No MCP Server found" immediately after the server created one
- Discovery printed "Discovery skipped for stigmer-mcp-server: STIGMER_API_KEY not available" even though local backend doesn't need auth
- Running any CLI command after `stigmer server` triggered a seedpack apply, producing confusing output unrelated to the command

## Solution

Three targeted fixes, each addressing an independent root cause:

1. **Seedpack timing**: Export `EnsureSeedpackBootstrapped` and call it from `handleServerStart()` between daemon start and bootstrap discovery, making `stigmer server` the canonical bootstrap point.
2. **Real-time search indexing**: New `IndexSearchStep` and `DeleteSearchIndexStep` pipeline steps that update the FTS5 index inline during create/update/delete operations, eliminating the stale-index problem.
3. **Discovery credential resolution**: Change `resolveStigmerAPIKey` to return `(string, bool)`, distinguishing "resolved to intentionally empty" (local backend) from "genuinely unresolved" (cloud backend without token).

## Implementation Details

### Bug 1: Seedpack Timing

- **daemon.go**: Renamed `ensureSeedpackBootstrapped` → `EnsureSeedpackBootstrapped` (exported). Updated two internal call sites in `EnsureRunning()`.
- **server.go**: Added `daemon.EnsureSeedpackBootstrapped(dataDir)` call between `StartWithOptions()` completion and `runBootstrapDiscovery()`.

The `stigmer server` command now runs seedpack before discovery, and `EnsureRunning()` remains as a safety net for edge cases.

### Bug 2: Real-Time Search Indexing

**New file**: `backend/libs/go/grpc/request/pipeline/steps/index_search.go`

- `IndexSearchStep[T]` — accepts `store.Store` and a `SearchIndexExtractor` interface (defined locally to avoid libs→services dependency). Reads resource from `ctx.NewState()`, extracts search fields, calls `store.UpsertSearchIndex()`. Best-effort: failures log warnings but do not fail the pipeline.
- `DeleteSearchIndexStep[T]` — reads resource ID from context, calls `store.DeleteSearchIndex()`. Also best-effort.

**Wired into 11 controller pipelines across 4 domains**:

| Domain | Create | Update | Delete | Push |
|--------|--------|--------|--------|------|
| agent | IndexSearchStep after step 7 (final persist) | after PersistStep | DeleteSearchIndexStep | — |
| workflow | IndexSearchStep after step 8 (final persist) | after PersistStep | DeleteSearchIndexStep | — |
| mcp_server | after PersistStep | after PersistStep | DeleteSearchIndexStep | — |
| skill | — | — | DeleteSearchIndexStep | custom indexSkillSearchStep |

The skill domain required a custom step (`indexSkillSearchStep`) because its push pipeline's type parameter is `*PushSkillRequest`, not `*Skill` — the skill is read from a context key instead of `ctx.NewState()`.

### Bug 3: Discovery Credential Resolution

- **`resolveStigmerAPIKey`** changed from `string` return to `(string, bool)`:
  - Local backend: `("", true)` — resolved, intentionally empty
  - Cloud backend with token: `(token, true)`
  - Cloud backend without token: `("", false)` — genuinely unresolved
- **`resolveKnownVar`** updated to pass through the two-value return directly.
- **`ResolveEnvForDiscovery`** already handled this correctly: `("", true)` adds `STIGMER_API_KEY=` to overrides, passing the empty value to the MCP server process which decides whether it needs auth.

## Benefits

- **Clean first-run**: `stigmer server` → seedpack → discovery → ready. No bootstrap leaking into subsequent commands.
- **Consistent list/search**: Resources appear in `stigmer list` immediately after creation, not after a daemon restart.
- **Local discovery works**: `stigmer-mcp-server` capabilities are discovered on local backend without requiring a non-existent API key.
- **Architectural integrity**: The `SearchIndexExtractor` interface in the steps package avoids a dependency from libs→services, keeping the pipeline framework generic.

## Impact

- **CLI users**: First-run experience is now seamless — `stigmer server` + `stigmer list mcp-server` works as expected.
- **Platform maintainers**: Every new searchable resource kind only needs to add `IndexSearchStep` to its pipeline — no need to remember to rebuild the search index.
- **Search consistency**: All CRUD operations across agent, workflow, mcp_server, and skill now keep the search index in sync.

## Files Changed

| Area | Files | Changes |
|------|-------|---------|
| Pipeline steps | 1 new | `IndexSearchStep`, `DeleteSearchIndexStep`, `SearchIndexExtractor` interface |
| Domain controllers | 11 modified | Added indexing steps to create/update/delete/push pipelines |
| CLI daemon | 1 modified | Exported `EnsureSeedpackBootstrapped` |
| CLI server cmd | 1 modified | Call seedpack before discovery |
| CLI env resolver | 1 modified | Two-value return for `resolveStigmerAPIKey` |

## Related Work

- Seedpack bootstrap was introduced in the embedded seedpack feature
- FTS5 search service was added in `2026-02-01-121916-oss-backend-search-service-fts5.md`
- MCP server credential auto-resolution was added in `bf57a093` (`feat(cli/run): auto-resolve MCP server credentials from local stores`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
