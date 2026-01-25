# Next Task: 20260125.02.badgerdb-to-sqlite-migration

## Current State
- **Status**: COMPLETED (pending commit)
- **Last Session**: 2026-01-25 - Full implementation completed
- **Active Task**: T01 - BadgerDB to SQLite Migration

## Session Progress (2026-01-25)

### Completed
- ✅ Created `store.Store` interface with `ErrNotFound` sentinel error and `DeleteResourcesByIdPrefix` method
- ✅ Implemented `sqlite.Store` with WAL mode, write serialization (mutex), comprehensive PRAGMA configuration
- ✅ Created 20+ comprehensive tests including concurrent access, prefix scans, edge cases
- ✅ Updated all 10 controller domains (import changes + type changes)
- ✅ Updated temporal worker configs and activity implementations
- ✅ Updated `server.go` with `sqlite.NewStore()` and removed debug endpoint
- ✅ Updated `temporal_manager.go` with `store.Store` interface type assertions
- ✅ Deleted `backend/libs/go/badger/` directory (entire BadgerDB package)
- ✅ Deleted `backend/services/stigmer-server/pkg/debug/` directory
- ✅ Added `modernc.org/sqlite` dependency (pure Go, no CGO)
- ✅ Updated `MODULE.bazel` with `org_modernc_sqlite` repository
- ✅ Fixed all BUILD.bazel files with correct dependencies
- ✅ All tests pass (`go test ./...`)

### Files Modified (72+ files)
- New: `backend/libs/go/store/sqlite/{store.go, store_test.go, BUILD.bazel}`
- Modified: `backend/libs/go/store/interface.go` (enhanced with ErrNotFound, DeleteResourcesByIdPrefix)
- Deleted: `backend/libs/go/badger/` (entire directory)
- Deleted: `backend/services/stigmer-server/pkg/debug/` (entire directory)
- Modified: All domain controllers (10 packages)
- Modified: Temporal worker configs and activities
- Modified: Server initialization code
- Modified: MODULE.bazel, go.mod files

### Key Decisions Made
1. **Write Serialization**: Used mutex for SQLite single-writer limitation (appropriate for local daemon)
2. **Interface Abstraction**: Controllers depend on `store.Store` interface, not concrete implementation
3. **Test Imports**: Test files import both `store` (interface) and `store/sqlite` (implementation)
4. **Debug Removal**: SQLite accessible via standard tools (sqlite3 CLI, DataGrip, etc.)

### Technical Details
- SQLite configured with WAL mode, NORMAL synchronous, 64MB cache
- GLOB used for prefix matching (better index utilization than LIKE)
- `WITHOUT ROWID` table for clustered index on (kind, id)
- Pure Go driver (modernc.org/sqlite) - no CGO dependencies

## Next Steps

1. **Commit changes** - All implementation is complete, needs proper commit
2. **Integration testing** - Run full Bazel build to verify
3. **Binary size verification** - Confirm ~5MB increase acceptable

## Context for Resume
- All implementation work is complete
- Changes are comprehensive but follow consistent patterns
- Tests pass with `go test -count=1 ./backend/libs/go/store/... ./backend/services/stigmer-server/pkg/domain/*/controller/...`
- No blockers

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/next-task.md`

Then:
- Review uncommitted changes: `git status`
- Commit the migration: Use `@commit-stigmer-oss-changes` rule
- Or create PR: Use `@create-stigmer-oss-pull-request` rule

---

## Original Project Context

**Description**: Migrate the Stigmer CLI from BadgerDB key-value store to SQLite with JSON document storage, maintaining the same Store interface while reducing binary footprint and complexity.

**Tech Stack**: Go, SQLite (modernc.org/sqlite), Protobuf serialization (unchanged)

### Store Interface (preserved)
```go
type Store interface {
    SaveResource(ctx, kind, id, msg) error
    GetResource(ctx, kind, id, msg) error
    ListResources(ctx, kind) ([][]byte, error)
    DeleteResource(ctx, kind, id) error
    DeleteResourcesByKind(ctx, kind) (int64, error)
    DeleteResourcesByIdPrefix(ctx, kind, idPrefix) (int64, error)
    Close() error
}
```

*This file provides direct paths to all project resources for quick context loading.*
