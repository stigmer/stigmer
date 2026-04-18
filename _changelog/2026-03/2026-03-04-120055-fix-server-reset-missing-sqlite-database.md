# Fix Server Reset Missing SQLite Database and Persistent State

**Date**: March 4, 2026

## Summary

`stigmer server reset` was not clearing the SQLite database (`stigmer.db`) or several other persistent directories, causing MCP servers, agents, skills, and projects to survive a reset. This fix adds the missing paths to the reset logic so the command genuinely returns the environment to a clean state.

## Problem Statement

After running `stigmer server reset`, previously registered resources (e.g. `planton` MCP server) reappeared on the next `stigmer list mcp-server`. The seedpack only ships `stigmer-mcp-server`, so a fresh reset should yield exactly one MCP server.

### Pain Points

- Users expected reset to be a full wipe, but old resources persisted invisibly
- The "Discovered capabilities for 2 MCP server(s)" message after reset was confusing when only 1 was in the seedpack
- No way to reach a truly clean state without manually deleting `~/.stigmer/stigmer.db`

## Solution

Traced the root cause to the BadgerDB → SQLite migration. The original reset code only deleted `~/.stigmer/data/` (the old BadgerDB location). After the migration, the primary database moved to `~/.stigmer/stigmer.db`, but the reset code was never updated.

Added four new removers to the reset pipeline and centralized the path constants.

## Implementation Details

### `config/config.go` — new constants

Added `DefaultDBFile`, `DefaultStorageDir`, `DefaultSessionsDir`, `DefaultRuntimesDir` alongside the existing `DefaultDataDir` constant so all reset-relevant paths are centralized.

### `daemon/reset.go` — new removers

| Remover                | Paths removed |
|------------------------|---------------|
| `removeSQLiteDatabase` | `stigmer.db`, `stigmer.db-wal`, `stigmer.db-shm` |
| `removeStorageDir`     | `storage/` (skill artifacts) |
| `removeSessionsDir`    | `sessions/` |
| `removeRuntimesDir`    | `runtimes/` (agent-runner state) |

The database remover runs first so the server process cannot reopen the file before the data directory is deleted.

### `server_reset.go` — updated help text

The `Long` description now accurately lists all state that gets cleaned.

### `daemon/reset_test.go` — 7 new tests

Covers all four new removers plus edge cases (partial SQLite sidecar files, no files present, nested directory contents).

## Benefits

- `stigmer server reset` now genuinely returns to a clean state
- Seedpack bootstrap after reset produces exactly the expected resources
- Users can trust the reset command without needing manual filesystem cleanup

## Impact

- **CLI users**: Reset now works as documented — full wipe of all persistent state
- **Developers**: Centralized path constants reduce the chance of future drift when storage locations change

## Related Work

- BadgerDB → SQLite migration (`2026-01-25-151850-implement-skill-backend-secure-storage.md`)
- Auto-start server after reset (`2026-03-03-061938-auto-start-server-after-reset.md`)

---

**Status**: ✅ Production Ready
