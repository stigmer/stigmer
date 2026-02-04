# Stigmer OSS Storage Layer

## Current Implementation

Stigmer uses **SQLite** (not BadgerDB) for local storage.

**Code location**: `backend/libs/go/store/sqlite/`  
**Driver**: modernc.org/sqlite (pure Go, no CGO)  
**Database file**: `~/.stigmer/stigmer.db` (single file)

## When Writing Content

**ALWAYS say**: "SQLite"  
**NEVER say**: "BadgerDB"

## Why SQLite?

1. **Industry Standard**: Chrome, Firefox, iOS apps use SQLite
2. **Universal Tooling**: sqlite3 CLI, DataGrip, DB Browser for SQLite work immediately
3. **Standard SQL**: Developers already know how to query and inspect data
4. **Pure Go Driver**: modernc.org/sqlite has no CGO dependencies
5. **Built-in FTS5**: Full-text search without external dependencies
6. **Single-File Database**: Easy backups, portability, version control
7. **ACID Transactions**: Correctness guarantees for agent state
8. **Developer-Friendly**: `sqlite3 ~/.stigmer/stigmer.db` provides instant inspection

## Messaging Template

Use this template when describing Stigmer's storage:

```
"Stigmer uses SQLite—the same embedded database powering Chrome, Firefox, and iPhone apps—with a pure Go driver for zero dependencies."
```

## Code Examples

### Storage Strategy (README)

```markdown
### Storage Strategy

Stigmer uses **SQLite** with the pure Go modernc.org/sqlite driver.

**Why SQLite?**
- ✅ Industry standard embedded database (powers Chrome, Firefox, iOS apps)
- ✅ Universal tooling: sqlite3 CLI, DataGrip, DB Browser for SQLite
- ✅ Standard SQL: developers already know the query language
- ✅ Inspectable: `sqlite3 ~/.stigmer/stigmer.db` works immediately
- ✅ Pure Go driver: no CGO dependencies, builds work everywhere
- ✅ ACID transactions: correctness guarantees for agent state
- ✅ Built-in FTS5: full-text search without external dependencies
- ✅ Single-file database: simple backups and portability
```

### Component Descriptions

**stigmer-server**: Go gRPC API server with **SQLite** storage

**Local Mode**: SQLite database in `~/.stigmer/stigmer.db` (single-file, portable)

### Architecture Diagrams

```
│         ┌──────────────────────────────┐
│         │   SQLite Storage Layer       │
│         │  (libs/go/store/sqlite)      │
│         │                              │
│         │  Single-file database:       │
│         │  - ACID transactions         │
│         │  - Full-text search (FTS5)   │
│         │  - Standard SQL queries      │
│         └──────────────────────────────┘
```

## Historical Context

**BadgerDB Consideration**: Earlier architecture discussions considered BadgerDB (a key-value store), but the actual implementation uses SQLite for superior developer experience and universal tooling.

**Migration Project**: `_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/` documents the migration from BadgerDB to SQLite.

**Current ADR**: [docs/adr/20260118-181912-local-backend-to-use-sqlite.md](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)

## Common Mistakes to Avoid

❌ **Don't Say**:
- "Stigmer uses BadgerDB for local storage"
- "BadgerDB key-value store in `~/.stigmer/data/`"
- "Fast BadgerDB prefix scanning"

✅ **Do Say**:
- "Stigmer uses SQLite for local storage"
- "SQLite database in `~/.stigmer/stigmer.db`"
- "Standard SQL queries with SQLite"

## Verification

To verify current implementation:

```bash
# Check SQLite implementation exists
ls backend/libs/go/store/sqlite/

# Verify test imports
rg "store/sqlite" backend/services/ --files-with-matches

# Check database file location
ls ~/.stigmer/stigmer.db
```

## Related Documentation

- **ADR**: [Local Backend to Use SQLite](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)
- **Implementation**: `backend/libs/go/store/sqlite/store.go`
- **Tests**: `backend/libs/go/store/sqlite/store_test.go`
- **Changelog**: [SQLite Content Correction](../../_changelog/2026-02/2026-02-04-sqlite-content-correction.md)

---

**Last Updated**: 2026-02-04  
**Purpose**: Prevent AI assistants from incorrectly suggesting BadgerDB based on outdated content
