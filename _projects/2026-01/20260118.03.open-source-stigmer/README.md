# Project: 20260118.03.open-source-stigmer

## Overview
Transition Stigmer from proprietary to Open Core architecture by open sourcing the execution plane (CLI, Runners, SDK) under Apache 2.0 while keeping the control plane proprietary. Includes migration from leftbin/stigmer to stigmer/stigmer organization.

**Created**: 2026-01-18
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement Backend Abstraction Layer with Protobuf interfaces, create BadgerDB-based local backend, refactor all execution components to work with both local and cloud backends seamlessly, and migrate codebase to new stigmer/stigmer repository.

### Timeline
**Target Completion**: Months (flexible, multi-phase project)

### Technology Stack
Go (CLI, Workflow Runner), Python (Agent Runner), Protocol Buffers, BadgerDB, Temporal

### Project Type
Refactoring

### Affected Components
CLI (stigmer-sdk/go/stigmer/), Workflow Runner (stigmer-sdk/go/workflow/), Agent Runner (stigmer-sdk/go/agent/), Backend interfaces (new protobuf), Storage layer (BadgerDB), Repository migration (leftbin/* → stigmer/stigmer)

## Project Context

### Dependencies
None identified

### Success Criteria
- Backend interface defined in Protobuf with Cloud/Local parity; BadgerDB backend implemented; JIT secret resolution in both modes; stigmer agent execute working with zero infrastructure (Tier 1); Repository successfully migrated to stigmer/stigmer with proper licensing

### Known Risks & Mitigations
None - project is pre-production with no current users

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
- [x] Initial analysis complete
- [x] **Phase 1: Foundation Complete** ✅
  - [x] Repository created (stigmer/stigmer)
  - [x] gRPC service architecture documented (in-process adapter pattern)
  - [x] Proto APIs in `apis/` folder (91 files, domain-based)
  - [x] Architecture documentation rewritten (gRPC services as interface)
  - [x] BadgerDB backend framework created
  - [x] CLI framework built
  - [x] Documentation comprehensive and accurate
  - [x] GitHub configured
  - [x] Makefile proto commands added
- [ ] **Phase 2: Backend Implementation** 🟢 **IN PROGRESS**
  - [x] **Protobuf code generation** ✅ **COMPLETE** (2026-01-18)
    - [x] Buf config in apis/ directory
    - [x] Makefile automation (build, lint, fmt, clean)
    - [x] Go stubs generation (apis/stubs/go/)
    - [x] Python stubs generation (apis/stubs/python/)
    - [x] Documentation (apis/README.md + root README.md)
  - [ ] Update imports in CLI/backend code ← **NEXT**
  - [ ] BadgerDB CRUD operations (key-value storage)
  - [ ] CLI-backend wiring
  - [ ] Secret encryption
  - [ ] Integration tests
- [ ] Phase 3: Code Migration
- [ ] Phase 4: Testing and validation
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