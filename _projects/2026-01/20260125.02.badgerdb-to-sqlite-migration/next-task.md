# Next Task: 20260125.02.badgerdb-to-sqlite-migration

## Current State
- **Status**: IN-PROGRESS (uncommitted changes)
- **Last Session**: 2026-01-25 (Session 2) - SQLite audit table architecture redesign
- **Active Task**: T02 - SQLite Store Architecture Redesign

## Session Progress (2026-01-25 - Session 2)

### Completed
- ✅ Added schema version tracking system (`schema_version` table)
- ✅ Created dedicated `resource_audit` table with proper relational design
- ✅ Added indexes for efficient audit queries (hash, tag, resource_id)
- ✅ Enabled `PRAGMA foreign_keys=ON` for data integrity
- ✅ Added new audit methods to Store interface:
  - `SaveAudit(ctx, kind, resourceId, msg, versionHash, tag)`
  - `GetAuditByHash(ctx, kind, resourceId, versionHash, msg)`
  - `GetAuditByTag(ctx, kind, resourceId, tag, msg)`
  - `ListAuditHistory(ctx, kind, resourceId)`
  - `DeleteAuditByResourceId(ctx, kind, resourceId)`
- ✅ Added `ErrAuditNotFound` sentinel error
- ✅ Deprecated `DeleteResourcesByIdPrefix` (BadgerDB artifact)
- ✅ Implemented migration logic for existing `skill_audit/*` prefixed records
- ✅ Updated `push.go` - uses `SaveAudit()` instead of prefixed ID
- ✅ Updated `load_skill_by_reference.go` - uses indexed audit queries (O(log n) vs O(n))
- ✅ Updated `delete.go` - uses `DeleteAuditByResourceId()`
- ✅ Added comprehensive audit tests to `store_test.go`
- ✅ Updated `skill_controller_test.go` for new audit API

### Files Modified (9 files, +914/-135 lines)
- `backend/libs/go/store/interface.go` - Added audit methods, ErrAuditNotFound
- `backend/libs/go/store/sqlite/store.go` - Migration system + audit implementation
- `backend/libs/go/store/sqlite/store_test.go` - Audit tests
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` - SaveAudit
- `backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go` - Indexed queries
- `backend/services/stigmer-server/pkg/domain/skill/controller/delete.go` - DeleteAuditByResourceId
- `backend/services/stigmer-server/pkg/domain/skill/controller/skill_controller_test.go` - Updated tests

### Key Architectural Decisions
1. **Separate Audit Table**: Created `resource_audit` table instead of co-mingling with resources
2. **Indexed Columns**: Extracted `version_hash` and `tag` for indexed queries
3. **Migration Versioning**: Added `schema_version` table for proper schema evolution
4. **Interface Abstraction**: Clean audit methods instead of prefix-based deletion

### Before vs After

| Aspect | Before (BadgerDB Pattern) | After (Relational) |
|--------|---------------------------|---------------------|
| Query efficiency | Full table scan + app filter | Indexed direct lookup |
| Data integrity | Manual cleanup required | CASCADE-ready design |
| Interface abstraction | Exposes prefix implementation | Clean domain methods |
| Version lookup | O(n) scan all skills | O(log n) index lookup |
| Audit deletion | GLOB pattern match | Direct DELETE by resource_id |

## Next Steps

1. **Run tests** - Verify all tests pass with new architecture
2. **Commit changes** - Create proper commit for audit table architecture
3. **Integration testing** - Test skill push/get-by-reference/delete workflows
4. **Consider FK constraint** - Evaluate adding foreign key for CASCADE DELETE

## Context for Resume
- Plan file exists: `.cursor/plans/sqlite_store_architecture_683ad591.plan.md`
- This is a follow-up to Session 1 (basic SQLite migration)
- Previous uncommitted changes from Session 1 may still be present (temporal_manager.go, update_status_impl.go)
- New changes focus on audit table architecture

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/next-task.md`

Then:
- Review uncommitted changes: `git status`
- Run tests: `go test ./backend/libs/go/store/... ./backend/services/stigmer-server/pkg/domain/skill/controller/...`
- Commit: Use `@commit-stigmer-oss-changes` rule

---

## Project Context

**Description**: Migrate the Stigmer CLI from BadgerDB key-value store to SQLite with proper relational design, including a dedicated audit table for version history.

**Reference**: stigmer-cloud's `SkillAuditRepo` (MongoDB) uses the same pattern with separate collection and indexed queries.

### Store Interface (evolved)
```go
type Store interface {
    // Resource operations
    SaveResource(ctx, kind, id, msg) error
    GetResource(ctx, kind, id, msg) error
    ListResources(ctx, kind) ([][]byte, error)
    DeleteResource(ctx, kind, id) error
    DeleteResourcesByKind(ctx, kind) (int64, error)
    DeleteResourcesByIdPrefix(ctx, kind, idPrefix) (int64, error) // Deprecated
    
    // Audit operations (NEW)
    SaveAudit(ctx, kind, resourceId, msg, versionHash, tag) error
    GetAuditByHash(ctx, kind, resourceId, versionHash, msg) error
    GetAuditByTag(ctx, kind, resourceId, tag, msg) error
    ListAuditHistory(ctx, kind, resourceId) ([][]byte, error)
    DeleteAuditByResourceId(ctx, kind, resourceId) (int64, error)
    
    Close() error
}
```

### Schema (v2)
```sql
-- Resources table (unchanged)
CREATE TABLE resources (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, id)
) WITHOUT ROWID;

-- Audit table (NEW in v2)
CREATE TABLE resource_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    data BLOB NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    version_hash TEXT,
    tag TEXT
);

-- Indexes for efficient queries
CREATE INDEX idx_audit_resource ON resource_audit(kind, resource_id);
CREATE INDEX idx_audit_hash ON resource_audit(kind, resource_id, version_hash);
CREATE INDEX idx_audit_tag ON resource_audit(kind, resource_id, tag, archived_at DESC);
```
