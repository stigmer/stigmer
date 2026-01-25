# Next Task: 20260125.02.badgerdb-to-sqlite-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260125.02.badgerdb-to-sqlite-migration

**Description**: Migrate the Stigmer CLI from BadgerDB key-value store to SQLite with JSON document storage, maintaining the same Store interface while reducing binary footprint and complexity.
**Goal**: Replace BadgerDB with a pure SQLite implementation that uses JSON columns for document storage, keeping the existing Store interface intact and ensuring all current functionality works without regression.
**Tech Stack**: Go, SQLite (modernc.org/sqlite or mattn/go-sqlite3), JSON
**Components**: backend/libs/go/badger/store.go, backend/services/stigmer-server/pkg/server, all domain controllers, temporal activities, test files

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-25 19:39
**Current Task**: T01 (BadgerDB to SQLite Migration)
**Status**: APPROVED - Ready for execution

### Decisions Made (2026-01-25)
- **SQLite Driver**: `modernc.org/sqlite` (pure Go, no CGO)
- **Debug Endpoint**: REMOVE (SQLite accessible via DataGrip, DB Browser, etc.)
- **Database File**: `~/.stigmer/stigmer.sqlite`
- **BadgerDB**: Complete removal, no fallback

### Key Decision: Pure SQLite (not FerretDB)
After analysis, we chose SQLite with JSON columns over FerretDB because:
- Smaller binary footprint (~5MB vs ~15MB)
- No TCP listener overhead
- No health monitoring complexity
- Battle-tested, simpler architecture
- Current query patterns don't need MongoDB wire protocol

### Current Store Interface (to preserve)
```
backend/libs/go/badger/store.go
├── SaveResource(ctx, kind, id, msg)
├── GetResource(ctx, kind, id, msg)
├── ListResources(ctx, kind)
├── DeleteResource(ctx, kind, id)
├── DeleteResourcesByKind(ctx, kind)
├── DeleteResourcesByIdPrefix(ctx, kind, idPrefix)
└── Close()
```

### Files Impacted
- Core store: 1 file (full rewrite)
- Controllers: ~30 files (import change only)
- Tests: ~20 files
- Debug endpoint: 1 file

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
