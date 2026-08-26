# Stigmer OSS Storage Layer

## Current Implementation

Stigmer uses **SQLite** for local storage.

**Code location**: `backend/services/stigmer-server/src/store/sqlite/`  
**Driver**: Node's built-in `node:sqlite` (no native dependencies; needs Node >= 22.13 for FTS5)  
**Database file**: `~/.stigmer/stigmer.db` (single file)

## When Writing Content

**ALWAYS say**: "SQLite"

## Why SQLite?

1. **Industry Standard**: Chrome, Firefox, iOS apps use SQLite
2. **Universal Tooling**: sqlite3 CLI, DataGrip, DB Browser for SQLite work immediately
3. **Standard SQL**: Developers already know how to query and inspect data
4. **Built-in Driver**: `node:sqlite` ships with Node — zero install, zero native builds
5. **Built-in FTS5**: Full-text search without external dependencies
6. **Single-File Database**: Easy backups, portability, version control
7. **ACID Transactions**: Correctness guarantees for agent state
8. **Developer-Friendly**: `sqlite3 ~/.stigmer/stigmer.db` provides instant inspection

## Messaging Template

Use this template when describing Stigmer's storage:

```
"Stigmer uses SQLite—the same embedded database powering Chrome, Firefox, and iPhone apps—through Node's built-in driver, so there is nothing extra to install."
```

## Code Examples

### Storage Strategy (README)

```markdown
### Storage Strategy

Stigmer uses **SQLite** through Node's built-in `node:sqlite` driver.

**Why SQLite?**
- ✅ Industry standard embedded database (powers Chrome, Firefox, iOS apps)
- ✅ Universal tooling: sqlite3 CLI, DataGrip, DB Browser for SQLite
- ✅ Standard SQL: developers already know the query language
- ✅ Inspectable: `sqlite3 ~/.stigmer/stigmer.db` works immediately
- ✅ Built-in driver: ships with Node, no native dependencies
- ✅ ACID transactions: correctness guarantees for agent state
- ✅ Built-in FTS5: full-text search without external dependencies
- ✅ Single-file database: simple backups and portability
```

### Component Descriptions

**stigmer-server**: TypeScript gRPC API server with **SQLite** storage

**Local Mode**: SQLite database in `~/.stigmer/stigmer.db` (single-file, portable)

### Architecture Diagrams

```
│         ┌──────────────────────────────┐
│         │   SQLite Storage Layer       │
│         │  (server src/store/sqlite)   │
│         │                              │
│         │  Single-file database:       │
│         │  - ACID transactions         │
│         │  - Full-text search (FTS5)   │
│         │  - Standard SQL queries      │
│         └──────────────────────────────┘
```

## Historical Context

**Current ADR**: [docs/adr/20260118-181912-local-backend-to-use-sqlite.md](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)

The original Go server used the pure-Go modernc.org/sqlite driver; the TypeScript server that replaced it (go-server-retirement, D4 #25) adopts the same database file through `node:sqlite` — the schema carried over via the versioned migration chain, so pre-cutover databases keep working.

## Quick Reference

- "Stigmer uses SQLite for local storage"
- "SQLite database in `~/.stigmer/stigmer.db`"
- "Standard SQL queries with SQLite"

## Verification

To verify current implementation:

```bash
# Check SQLite implementation exists
ls backend/services/stigmer-server/src/store/sqlite/

# Verify usage
rg "node:sqlite" backend/services/stigmer-server/src --files-with-matches

# Check database file location
ls ~/.stigmer/stigmer.db
```

## Related Documentation

- **ADR**: [Local Backend to Use SQLite](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)
- **Implementation**: `backend/services/stigmer-server/src/store/sqlite/store.ts` (migration chain: `migrations.ts`)
- **Tests**: `backend/services/stigmer-server/src/store/sqlite/__tests__/`
- **Changelog**: [SQLite Content Correction](../../_changelog/2026-02/2026-02-04-sqlite-content-correction.md)

---

**Last Updated**: 2026-08-26
