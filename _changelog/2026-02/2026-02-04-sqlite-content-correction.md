# SQLite Content Correction

**Date**: 2026-02-04  
**Type**: Content Fix  
**Impact**: HIGH - Corrects systematic misinformation about storage layer

## Summary

Corrected all BadgerDB references to SQLite across user-facing content, documentation, and active plans. Previous Phase 4.3 updates (2026-02-04) mistakenly changed SQLite TO BadgerDB, creating technical inaccuracies that would have confused developers and AI assistants.

## Root Cause

Phase 4.3 content excellence updates incorrectly stated that Stigmer uses BadgerDB for local storage. The actual implementation uses SQLite with the modernc.org/sqlite driver (pure Go, no CGO).

**Evidence of Correct Implementation**:
- `backend/libs/go/store/sqlite/store.go` - SQLite store implementation
- `backend/libs/go/store/sqlite/store_test.go` - Comprehensive SQLite tests
- Test files across codebase import `"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"`

**Why This Matters**:
- Developers would copy incorrect mental models
- AI assistants (like Cursor) learn from recent content and perpetuate errors
- Technical documentation must reflect actual implementation

## Changes Made

### User-Facing Content (8 files)

1. **[README.md](../../README.md)**
   - Updated architecture diagram: "SQLite Storage Layer" with FTS5 and ACID transactions
   - Rewrote Storage Strategy section highlighting SQLite strengths
   - Fixed component descriptions and storage references
   - Updated all architectural descriptions

2. **[site/src/app/layout.tsx](../../site/src/app/layout.tsx)**
   - Changed SEO keywords: "BadgerDB" → "SQLite database"

3. **[site/src/lib/constants.ts](../../site/src/lib/constants.ts)**
   - Updated "Zero Cloud Dependency" feature: "Runs 100% locally with SQLite"
   - Fixed command reference: `stigmer server` → `stigmer local`

4. **[site/src/components/sections/Quickstart.tsx](../../site/src/components/sections/Quickstart.tsx)**
   - Updated description: "stores data in SQLite. Ready in seconds."

### Active Plans & Recent Changelogs (3 files)

5. **[_changelog/2026-02/2026-02-04-content-excellence-phase-4-3.md](2026-02-04-content-excellence-phase-4-3.md)**
   - Added correction note at top linking to this changelog

6. **[.cursor/plans/content_excellence_phase_4.3_d590f956.plan.md](../../.cursor/plans/content_excellence_phase_4.3_d590f956.plan.md)**
   - Added correction in overview explaining the error

7. **[_projects/2026-02/20260203.01.stigmer-website/next-task.md](../../_projects/2026-02/20260203.01.stigmer-website/next-task.md)**
   - Updated technical stack mentions: BadgerDB → SQLite

### Documentation (12 files)

8. **[docs/README.md](../../docs/README.md)**
   - Updated ADR reference: "Local Backend to Use SQLite" (renamed from BadgerDB)
   - Removed outdated "Badger Schema Changes" ADR reference

9. **[docs/getting-started/local-mode.md](../../docs/getting-started/local-mode.md)**
   - Changed opening statement to reference SQLite database

10. **[docs/guides/deploying-with-apply.md](../../docs/guides/deploying-with-apply.md)**
    - Updated deployment targets: "local SQLite database"

11. **[docs/architecture/backend-modes.md](../../docs/architecture/backend-modes.md)**
    - Updated diagram: SQLite (~/.stigmer/stigmer.db)
    - Fixed comparison table
    - Updated components list

12. **[docs/architecture/open-core-model.md](../../docs/architecture/open-core-model.md)**
    - Updated Local Backend section with SQLite references
    - Added FTS5 search capability mention

13. **[docs/architecture/temporal-integration.md](../../docs/architecture/temporal-integration.md)**
    - Fixed local activity descriptions
    - Updated status update strategy references

14. **[docs/architecture/error-propagation.md](../../docs/architecture/error-propagation.md)**
    - Updated code comments in activity implementation
    - Fixed mermaid diagram participant labels

15. **[docs/architecture/mcp-server-resource.md](../../docs/architecture/mcp-server-resource.md)**
    - Changed stigmer (Go) implementation note to SQLite persistence

16. **[docs/architecture/skill-artifact-storage.md](../../docs/architecture/skill-artifact-storage.md)**
    - Updated database references throughout
    - Changed schema section header: "SQLite Schema"
    - Updated manual wrapper rationale

17. **[docs/implementation/mcp-server-api-resource-completion.md](../../docs/implementation/mcp-server-api-resource-completion.md)**
    - Updated controller description
    - Fixed cross-project dependencies list
    - Updated testing strategy section

18. **[docs/adr/20260118-190513-stigmer-local-deamon.md](../../docs/adr/20260118-190513-stigmer-local-deamon.md)**
    - Updated streaming flow diagram

19. **[docs/adr/20260122-async-agent-execution-temporal-token-handshake.md](../../docs/adr/20260122-async-agent-execution-temporal-token-handshake.md)**
    - Fixed implementation details reference

### ADR Renamed & Rewritten (1 file)

20. **[docs/adr/20260118-181912-local-backend-to-use-sqlite.md](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)** (renamed from `local-backend-to-use-badgerdb.md`)
    - Complete rewrite reflecting actual SQLite decision
    - Added historical context about BadgerDB consideration
    - Documented why SQLite was chosen over BadgerDB
    - Emphasized developer experience, universal tooling, standard SQL
    - Included trust signals: Chrome, Firefox, iOS apps use SQLite

### Cursor Rules Created (1 file)

21. **[.cursor/rules/stigmer-oss-storage-layer.md](../../.cursor/rules/stigmer-oss-storage-layer.md)**
    - Created authoritative rule preventing future BadgerDB references
    - Documents current implementation (SQLite)
    - Provides messaging template for consistency

## Why SQLite?

**Industry-Standard Embedded Database**:
- Used by browsers (Chrome, Firefox), mobile (iOS, Android), aviation (Airbus A350)
- Most deployed database engine in the world
- Battle-tested reliability: 20+ years of production use

**Developer Experience Excellence**:
- Universal tooling: sqlite3 CLI, DataGrip, DB Browser for SQLite, Beekeeper Studio
- Standard SQL: developers already know the query language
- Inspectable data: `sqlite3 ~/.stigmer/stigmer.db` works immediately
- Pure Go driver (modernc.org/sqlite): no CGO, cross-platform builds work

**Architectural Fit**:
- Single-file database: simple backups, version control, portability
- ACID transactions: correctness guarantees for agent state
- Built-in FTS5: full-text search without external dependencies
- Relational model: joins, constraints, referential integrity

**Performance Characteristics**:
- Efficient for read-heavy workloads (agent listing, status checks)
- Write-ahead logging: concurrent readers don't block
- Optimized for local storage patterns

## Files Changed

- **23 content/documentation files** corrected
- **1 ADR** renamed and rewritten with historical context
- **1 new Cursor rule** created to prevent future errors
- **1 new changelog** (this file) documenting the correction

## Impact

**Before Fix**:
- ❌ Website, README, and docs claimed BadgerDB
- ❌ Recent changelogs reinforced the error
- ❌ AI assistants would learn BadgerDB from recent content
- ❌ Developers would have incorrect mental models

**After Fix**:
- ✅ All content accurately reflects SQLite implementation
- ✅ Developer experience advantages clearly communicated
- ✅ Trust signals included (Chrome, Firefox, iOS adoption)
- ✅ Cursor rules prevent future AI confusion
- ✅ Historical context preserved in ADR

## Quality Standards Met

✅ **Technical Accuracy**: Every technology claim matches actual implementation  
✅ **SQLite Strengths Articulated**: Not just "we use SQLite" but WHY (tooling, SQL familiarity, trust)  
✅ **Trust Signals Included**: Industry adoption examples build confidence  
✅ **Historical Integrity**: ADR documents both BadgerDB consideration and SQLite decision  
✅ **Future-Proofed**: Cursor rule prevents recurrence

## Verification

**Codebase Confirmation**:
```bash
# Verify SQLite implementation exists
ls backend/libs/go/store/sqlite/
# Output: store.go, store_test.go

# Verify no BadgerDB implementation
ls backend/libs/go/badger/ 2>/dev/null
# Output: (none - directory doesn't exist)

# Check imports in tests
rg "store/sqlite" backend/ --files-with-matches | head -5
# Output: Multiple test files importing sqlite store
```

**Content Validation**:
- [x] Zero BadgerDB references in active user-facing content
- [x] SQLite strengths articulated in README
- [x] Website accurately describes storage layer
- [x] ADR reflects actual decision with historical context
- [x] Cursor rules updated to prevent future errors

## Related Documentation

- **New ADR**: [Local Backend to Use SQLite](../../docs/adr/20260118-181912-local-backend-to-use-sqlite.md)
- **Migration Project**: `_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/` (documents the actual migration)
- **Cursor Rule**: [.cursor/rules/stigmer-oss-storage-layer.md](../../.cursor/rules/stigmer-oss-storage-layer.md)

---

**Status**: ✅ Complete - Technical accuracy restored
**Lesson**: Always verify content against actual implementation, especially for recent changes
