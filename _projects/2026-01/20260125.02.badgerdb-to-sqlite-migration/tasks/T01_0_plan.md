# Task T01: BadgerDB to SQLite Migration

**Created**: 2026-01-25
**Status**: PENDING REVIEW
**Type**: Migration
**Timeline**: 1 week

⚠️ **This plan requires your review before execution**

## Executive Summary

Migrate Stigmer's local storage from BadgerDB (key-value store) to SQLite (relational with JSON columns) while maintaining full backward compatibility with the existing Store interface.

## Current Architecture Analysis

### Store Interface (what we must preserve)

```go
type Store struct {
    db *badger.DB
}

// 6 methods to maintain:
SaveResource(ctx, kind ApiResourceKind, id string, msg proto.Message) error
GetResource(ctx, kind ApiResourceKind, id string, msg proto.Message) error
ListResources(ctx, kind ApiResourceKind) ([][]byte, error)
DeleteResource(ctx, kind ApiResourceKind, id string) error
DeleteResourcesByKind(ctx, kind ApiResourceKind) (int64, error)
DeleteResourcesByIdPrefix(ctx, kind ApiResourceKind, idPrefix string) (int64, error)
Close() error
DB() *badger.DB  // Will become DB() interface or removed
```

### Files Impacted (from codebase analysis)

| Category | File Count | Notes |
|----------|------------|-------|
| Core Store | 1 | `backend/libs/go/badger/store.go` → DELETE, replace with SQLite |
| Server Init | 1 | `backend/services/stigmer-server/pkg/server/server.go` |
| Controllers | ~30 | All domain controllers inject `*badger.Store` → `store.Store` |
| Temporal Activities | 2 | `update_status_impl.go` files |
| Debug Endpoint | 1 | `pkg/debug/http.go` → DELETE (SQLite has better tooling) |
| Test Files | ~20 | Create temporary stores |

### Data Model (key format)

```
Current: "<Kind>/<ID>" → protobuf bytes
Example: "SKILL/abc123" → []byte (proto.Marshal(skill))

For audits: "<Kind>/<resource_id>/<timestamp>" 
Example: "SKILL_AUDIT/abc123/1706123456" → []byte
```

## Migration Strategy: Phased Approach

### Phase 1: Create Store Interface Abstraction (Day 1-2)

**Goal**: Zero breaking changes while enabling future backend flexibility

**Step 1.1**: Create `Store` interface in new package `backend/libs/go/store`

```go
// backend/libs/go/store/store.go
package store

type Store interface {
    SaveResource(ctx context.Context, kind ApiResourceKind, id string, msg proto.Message) error
    GetResource(ctx context.Context, kind ApiResourceKind, id string, msg proto.Message) error
    ListResources(ctx context.Context, kind ApiResourceKind) ([][]byte, error)
    DeleteResource(ctx context.Context, kind ApiResourceKind, id string) error
    DeleteResourcesByKind(ctx context.Context, kind ApiResourceKind) (int64, error)
    DeleteResourcesByIdPrefix(ctx context.Context, kind ApiResourceKind, idPrefix string) (int64, error)
    Close() error
}
```

**Step 1.2**: Make existing BadgerDB implementation satisfy the interface (no changes to existing code, just ensure compatibility)

**Step 1.3**: Update all import statements from `badger.Store` to `store.Store` interface type

### Phase 2: Implement SQLite Backend (Day 2-4)

**Goal**: New SQLite store implementation in `backend/libs/go/store/sqlite/`

**Step 2.1**: SQLite driver - `modernc.org/sqlite`

✅ **Decision**: Pure Go driver for easier cross-compilation, no CGO dependencies

**Step 2.2**: Design SQLite schema

```sql
-- Single table for all resources (document store pattern)
CREATE TABLE IF NOT EXISTS resources (
    kind TEXT NOT NULL,           -- ApiResourceKind enum string
    id TEXT NOT NULL,             -- Resource ID
    data BLOB NOT NULL,           -- Protobuf bytes (unchanged from BadgerDB)
    updated_at TEXT NOT NULL,     -- ISO8601 timestamp
    PRIMARY KEY (kind, id)
);

-- Index for efficient prefix scans (simulates BadgerDB's prefix iteration)
CREATE INDEX IF NOT EXISTS idx_resources_kind ON resources(kind);

-- For audit trails: kind + id prefix queries
CREATE INDEX IF NOT EXISTS idx_resources_kind_id_prefix ON resources(kind, id);
```

**Step 2.3**: Implement `sqlite.Store`

```go
// backend/libs/go/store/sqlite/store.go
package sqlite

type Store struct {
    db   *sql.DB
    path string
}

func NewStore(dbPath string) (*Store, error)
func (s *Store) SaveResource(...) error
func (s *Store) GetResource(...) error
func (s *Store) ListResources(...) ([][]byte, error)
func (s *Store) DeleteResource(...) error
func (s *Store) DeleteResourcesByKind(...) (int64, error)
func (s *Store) DeleteResourcesByIdPrefix(...) (int64, error)
func (s *Store) Close() error
```

**Step 2.4**: Key implementation details

| Operation | BadgerDB Pattern | SQLite Equivalent |
|-----------|------------------|-------------------|
| `SaveResource` | `txn.Set(key, data)` | `INSERT OR REPLACE INTO resources` |
| `GetResource` | `txn.Get(key)` | `SELECT data FROM resources WHERE kind=? AND id=?` |
| `ListResources` | `it.ValidForPrefix(prefix)` | `SELECT data FROM resources WHERE kind=?` |
| `DeleteResourcesByIdPrefix` | Prefix scan + batch delete | `DELETE FROM resources WHERE kind=? AND id LIKE ?` |

### Phase 3: Update Callers (Day 4-5)

**Step 3.1**: Update server initialization

```go
// backend/services/stigmer-server/pkg/server/server.go
// Change from:
store, err := badger.NewStore(cfg.DBPath)

// To:
store, err := sqlite.NewStore(cfg.DBPath)
```

**Step 3.2**: Update all controller injections
- Search for `*badger.Store` and replace with `store.Store` interface
- No logic changes needed (interface is identical)

**Step 3.3**: Remove debug endpoint entirely
- ✅ **Decision**: Delete `pkg/debug/http.go` completely
- SQLite files are directly accessible via:
  - DataGrip, DB Browser for SQLite, DBeaver, VS Code extensions
  - Command line: `sqlite3 ~/.stigmer/stigmer.sqlite`
- Remove `DB()` method from Store interface (no longer needed)

### Phase 4: Testing & Validation (Day 5-6)

**Step 4.1**: Port existing tests
- All `store_test.go` tests must pass
- Update test helpers to create SQLite stores

**Step 4.2**: Add SQLite-specific tests
- Concurrent access behavior
- Large dataset performance
- Prefix deletion edge cases

**Step 4.3**: Integration testing
- Full daemon startup/shutdown cycle
- Controller operations through gRPC
- Temporal activity store access

**Step 4.4**: Binary size verification
- Measure binary size before/after
- Target: < 5MB increase

### Phase 5: Cleanup & Documentation (Day 6-7)

**Step 5.1**: Remove BadgerDB dependency
- Remove `github.com/dgraph-io/badger/v4` from go.mod
- Delete `backend/libs/go/badger/` package

**Step 5.2**: Update database path convention
- Old: `~/.stigmer/stigmer.db` (BadgerDB directory)
- New: `~/.stigmer/stigmer.sqlite` (single file)
- ✅ **Decision**: Use `.sqlite` extension for clarity

**Step 5.3**: Document migration in ADR
- Create `docs/adr/ADR-006-sqlite-migration.md`

## File Changes Breakdown

### New Files to Create

```
backend/libs/go/store/
├── store.go                    # Interface definition
├── sqlite/
│   ├── store.go               # SQLite implementation
│   └── store_test.go          # Implementation tests
```

### Files to Modify

```
backend/services/stigmer-server/pkg/server/server.go     # Store init

# All controllers (change import, type signature remains same)
backend/services/stigmer-server/pkg/domain/agent/controller/*.go
backend/services/stigmer-server/pkg/domain/agentinstance/controller/*.go
backend/services/stigmer-server/pkg/domain/agentexecution/controller/*.go
backend/services/stigmer-server/pkg/domain/workflow/controller/*.go
backend/services/stigmer-server/pkg/domain/workflowinstance/controller/*.go
backend/services/stigmer-server/pkg/domain/workflowexecution/controller/*.go
backend/services/stigmer-server/pkg/domain/skill/controller/*.go
backend/services/stigmer-server/pkg/domain/session/controller/*.go
backend/services/stigmer-server/pkg/domain/environment/controller/*.go
backend/services/stigmer-server/pkg/domain/executioncontext/controller/*.go

# Temporal activities
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/*.go
backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities/*.go
```

### Files to Delete

```
backend/libs/go/badger/                              # Entire BadgerDB package
backend/services/stigmer-server/pkg/debug/http.go   # Debug endpoint (SQLite has better tooling)
```

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Prefix scan behavior differences | Extensive testing with audit trail patterns |
| Transaction isolation differences | SQLite uses serialized transactions by default |
| Concurrent write contention | SQLite WAL mode + connection pooling |
| Performance regression | Benchmark critical paths, accept minor regression for simplicity |

## Success Criteria

- [ ] All existing tests pass without modification (interface parity)
- [ ] Binary size increase < 5MB (pure Go SQLite driver)
- [ ] No TCP listeners or background processes (embedded only)
- [ ] Zero health monitoring overhead (file-based health)
- [ ] Backward-compatible database path detection

## Task Breakdown for Execution

| Task | Estimated Effort | Dependencies |
|------|------------------|--------------|
| T01: Create Store interface | 2-3 hours | None |
| T02: Implement SQLite backend | 4-6 hours | T01 |
| T03: Update server initialization | 1 hour | T02 |
| T04: Update all controllers | 2-3 hours | T01, T03 |
| T05: Port and add tests | 3-4 hours | T02 |
| T06: Binary size verification | 30 min | T05 |
| T07: Remove BadgerDB + debug endpoint | 1-2 hours | T05 |
| T08: Documentation (ADR) | 1-2 hours | T07 |

**Total Estimated: 14-22 hours of focused work over 1 week**

## Decisions Made (2026-01-25)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **SQLite Driver** | `modernc.org/sqlite` | Pure Go, easier cross-compilation, no CGO dependencies |
| **Debug Endpoint** | **REMOVE** | SQLite files can be opened by DataGrip, DB Browser, VS Code extensions, etc. - far better tooling than custom endpoint |
| **Database File** | `stigmer.sqlite` | Clear file extension, obvious format |
| **BadgerDB Removal** | **Complete removal** | No fallback, no data migration needed (local daemon, no existing users) |

---

## Status: APPROVED - Ready for Execution

All decisions confirmed. Proceeding with implementation.
