# Project: 20260125.02.badgerdb-to-sqlite-migration

## Overview
Migrate the Stigmer CLI from BadgerDB key-value store to SQLite with JSON document storage, maintaining the same Store interface while reducing binary footprint and complexity.

**Created**: 2026-01-25
**Status**: Active 🟢

## Project Information

### Primary Goal
Replace BadgerDB with a pure SQLite implementation that uses JSON columns for document storage, keeping the existing Store interface intact and ensuring all current functionality works without regression.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Go, SQLite (modernc.org/sqlite or mattn/go-sqlite3), JSON

### Project Type
Migration

### Affected Components
backend/libs/go/badger/store.go, backend/services/stigmer-server/pkg/server, all domain controllers, temporal activities, test files

## Project Context

### Dependencies
None - SQLite libraries are pure Go options available

### Success Criteria
- All existing tests pass
- binary size increase under 5MB
- no TCP listener or health monitoring overhead
- clean abstraction interface for future backend swaps

### Known Risks & Mitigations
Prefix scan behavior differences, transaction semantics, potential performance characteristics for large datasets

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._