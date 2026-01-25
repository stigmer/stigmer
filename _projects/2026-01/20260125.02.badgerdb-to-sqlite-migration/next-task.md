# Next Task: 20260125.02.badgerdb-to-sqlite-migration

## Current State
- **Status**: COMPLETED (Session 3 - Bug fixes committed)
- **Branch**: feat/badgerdb-to-sqllite-migration
- **Last Session**: 2026-01-25 (Session 3) - Bug fixes for audit queries

## Session Progress (2026-01-25 - Session 3)

### Completed
- ✅ Fixed `GetAuditByTag` timestamp ordering bug (sub-second inserts)
- ✅ Fixed `ListAuditHistory` timestamp ordering bug (sub-second inserts)
- ✅ Fixed `push_test.go` enum name (`ApiResourceOwnerScope_platform`)
- ✅ Committed all fixes: `1f13f50`

### Bug Fix Details
The audit queries used `ORDER BY archived_at DESC` which has second-level precision in SQLite. When multiple audit records are inserted within the same second (common in tests), the ordering was undefined. Fixed by adding `id DESC` as a secondary sort criterion since the auto-increment ID is guaranteed to be monotonically increasing.

### Files Modified (Session 3)
- `backend/libs/go/store/sqlite/store.go` - Added `id DESC` tiebreaker
- `backend/services/stigmer-server/pkg/domain/skill/controller/push_test.go` - Fixed enum name
- Plus goimports ordering changes in several files

## Test Status
- ✅ Store tests: All pass (27 tests)
- ✅ Skill controller tests: 36/37 pass
- ⚠️ `TestGetArtifact_EmptyStorageKey`: Pre-existing failure (validation pipeline doesn't wrap errors as gRPC status)

### Pre-existing Test Issue
`TestGetArtifact_EmptyStorageKey` fails because the validation pipeline returns a wrapped error rather than a proper gRPC status error. This is unrelated to the audit migration and was present before these changes.

## Commit History
```
1f13f50 fix(backend): fix audit query ordering and enum naming in tests
62e0848 docs: update project documentation for audit table session
df4463c refactor(backend/libs): add dedicated audit table to SQLite store
5af72bf refactor(backend): migrate from BadgerDB to SQLite storage
```

## Next Steps (Optional Follow-ups)
1. **Fix validation pipeline** - Make ValidateProtoConstraints wrap errors as gRPC status
2. **Add FK constraint** - Consider foreign key for CASCADE DELETE (optional, design decision)
3. **Integration testing** - Manual testing of skill push/get-by-reference/delete workflows
4. **Create PR** - When ready to merge to main

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/next-task.md`

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
