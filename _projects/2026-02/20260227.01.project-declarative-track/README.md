# Project: 20260227.01.project-declarative-track

## Overview
Redesign Project API to use references instead of full embedded objects, and add a declarative directory-scanning mode so users can manage groups of Stigmer resources from a folder with full reconciliation.

**Created**: 2026-02-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable users to create a directory with stigmer.yaml (marker) and YAML resource files, run 'stigmer apply', and get automatic resource discovery, individual apply, and server-side reconciliation with orphan pruning — no SDK code required.

### Timeline
**Target Completion**: Flexible

### Technology Stack
Go, Protocol Buffers (buf), gRPC

### Project Type
Refactoring

### Affected Components
APIs/protos (project spec, status), CLI (apply command, project detection, directory scanning), Backend server (project controller, reconciliation service)

## Project Context

### Dependencies
None identified

### Success Criteria
- 1. stigmer.yaml as a marker identifies a Stigmer project directory. 2. CLI scans directory for YAML resources and applies each individually. 3. Project stores references (not full objects) on the server. 4. Orphan pruning works via set-difference on references. 5. SDK synthesis flow still works (applies resources first
- then sends references). 6. Existing atomic apply (stigmer apply -f) is unchanged.

### Known Risks & Mitigations
None identified — existing SDK flow adapts naturally, no hard migration needed.

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