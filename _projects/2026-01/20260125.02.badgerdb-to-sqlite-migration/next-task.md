# Next Task: 20260125.02.badgerdb-to-sqlite-migration

## Current State
- **Status**: READY FOR PR (Session 4 - Validation pipeline fix)
- **Branch**: feat/badgerdb-to-sqllite-migration
- **Last Session**: 2026-01-25 (Session 4) - Fixed validation pipeline gRPC status errors

## Session Progress (2026-01-25 - Session 4)

### Completed
- ✅ Fixed `ValidateProtoStep` to return proper gRPC status errors
- ✅ Changed `fmt.Errorf()` → `grpclib.InvalidArgumentError()` in validation step
- ✅ Fixed 3 validation-related tests that were failing

### Fix Details
The `ValidateProtoStep` was returning wrapped errors (`fmt.Errorf("validation failed: %w", err)`) instead of proper gRPC status errors. Tests expected `status.FromError()` to work, which requires gRPC status errors.

**Change**: `backend/libs/go/grpc/request/pipeline/steps/validation.go`
```go
// Before
return fmt.Errorf("validation failed: %w", err)

// After
return grpclib.InvalidArgumentError(err.Error())
```

### Tests Fixed (Session 4)
- ✅ `TestGetArtifact_EmptyStorageKey` - Now passes
- ✅ `TestPush_EmptyName` - Now passes
- ✅ `TestPush_EmptyArtifact` - Now passes

### Pre-existing Test Failures (Unrelated)
These failures exist in baseline and are not related to the SQLite migration or validation fix:
| Test | Issue |
|------|-------|
| `TestPush_CreateNew_GeneratesSlug/Email_Tool` | Slug generation bug |
| `TestPush_CreateNew_SetsAuditFields` | Audit field population |
| `TestPush_Update_PreservesCreatedAt` | Timestamp handling |
| `TestPush_Update_UpdatesTimestamp` | Timestamp handling |
| `TestIntegration_ConcurrentGet` | Flaky race condition |

## Test Status
- ✅ Store tests: All pass (27 tests)
- ✅ GetArtifact tests: All pass (5 tests)
- ✅ Validation tests: All pass
- ⚠️ Some pre-existing test failures (see above)

## Commit History
```
dc3410c fix(backend): return gRPC status from validation pipeline
1f13f50 fix(backend): fix audit query ordering and enum naming in tests
62e0848 docs: update project documentation for audit table session
df4463c refactor(backend/libs): add dedicated audit table to SQLite store
5af72bf refactor(backend): migrate from BadgerDB to SQLite storage
```

## Next Steps
1. **Create PR** - Ready for review (5 commits total)
2. **Optional**: Fix pre-existing test failures (separate PR recommended)

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
