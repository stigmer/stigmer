# Remove Stale BadgerDB References Across Codebase

**Date**: March 7, 2026

## Summary

Removed all remaining BadgerDB references from source code, tests, documentation, and the website. The codebase migrated to SQLite months ago, but stale comments, doc strings, and architecture diagrams still referenced BadgerDB — creating confusion for contributors and AI assistants.

## Problem Statement

After the January 2026 BadgerDB-to-SQLite migration, dozens of stale references survived in Go comments, test scaffolding comments, architecture docs, the Mermaid diagrams in `open-core-model.md`, the website's `Architecture.tsx`, and the CLI `COMMANDS.md`. These references were actively misleading.

### Pain Points

- New contributors reading code comments believed BadgerDB was still in use
- AI assistants used stale comments as context, sometimes generating BadgerDB-oriented suggestions
- Architecture documentation and diagrams showed BadgerDB in the data flow
- The `.cursor/rules/stigmer-oss-storage-layer.md` rule had to maintain a "don't say BadgerDB" guard because references still existed

## Solution

Comprehensive search-and-replace of all BadgerDB references in non-historical files, replacing them with accurate SQLite terminology. Historical records (changelogs, project archives, ADR) were intentionally left untouched.

## Implementation Details

**36 files modified** across the codebase:

- **Go source comments** (16 files): Updated `get.go` across 6 domain controllers, `push.go`, `list.go`, `update_status.go`, `workflow_creator.go` (2), temporal activity interfaces (2), `load_by_reference.go`, `store/interface.go`, `store/sqlite/store.go`
- **Test files** (11 files): Fixed `// Create temporary BadgerDB store` → `// Create temporary SQLite store` in all controller test scaffolding
- **Documentation** (5 files): Updated `open-core-model.md` (8 refs including Mermaid diagrams and feature comparison table), `error-propagation.md`, environment controller `README.md`, skill controller `IMPLEMENTATION_SUMMARY.md`, CLI `COMMANDS.md`
- **Website** (1 file): `Architecture.tsx` — removed "SQLite/BadgerDB" label, now just "SQLite"
- **Cursor rules** (1 file): Simplified `stigmer-oss-storage-layer.md` — removed the "don't say BadgerDB" guidance since there are no more references to guard against

**Left untouched** (28 files): `_changelog/`, `_projects/`, `docs/adr/`, `.cursor/plans/` — these correctly document the historical migration.

## Benefits

- Codebase now consistently references SQLite everywhere
- No more misleading comments for contributors or AI assistants
- Architecture docs and diagrams accurately reflect current storage layer
- Removed the need for defensive "never say BadgerDB" rules

## Impact

- All backend Go source and test files
- CLI config and documentation
- Architecture and error propagation docs
- Website public-facing content
- Cursor AI assistant rules

## Related Work

- BadgerDB → SQLite migration (`2026-01-25-151850-implement-skill-backend-secure-storage.md`)
- SQLite content correction (`2026-02-04-sqlite-content-correction.md`)

---

**Status**: ✅ Production Ready
