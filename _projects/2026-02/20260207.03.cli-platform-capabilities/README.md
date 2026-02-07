# Project: 20260207.03.cli-platform-capabilities

## Overview
Implement hybrid capabilities bundle model for AI-powered draft commands. Embed baseline capabilities in CLI binary (go:embed) with optional signed updates from registry. Capabilities are system-scoped, not user-visible skills.

**Created**: 2026-02-07
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable stigmer draft agent|workflow|skill|mcpserver commands with embedded platform capabilities that power AI-assisted YAML authoring. Implement capabilities command group (status, update, pin, list) for managing capability bundles.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Go (CLI), go:embed, YAML, GitHub Releases

### Project Type
Feature Development

### Affected Components
CLI commands (client-apps/cli), Capabilities bundle (internal/capabilities), Registry integration

## Project Context

### Dependencies
- Phase 7 Search & Discovery should be complete for resource discovery during drafting
- **Research Report**: `research.platform-capabilities-draft-implementation/04.report.gpt.md`

### Success Criteria
1. All 4 draft commands working (`stigmer draft agent|workflow|skill|mcpserver`)
2. Embedded baseline bundle (~100KB) works offline with zero config
3. Capabilities commands functional (`status`, `update`, `pin`, `list`)
4. System capabilities NOT visible in `stigmer skill list`
5. Works fully offline with embedded bundle

### Known Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Capability bundle schema evolution | Version schema explicitly; CLI supports N previous versions |
| Security for remote bundle fetching | Sign bundles; verify checksums; pin versions |
| Prompt injection from project context | Treat repo content as untrusted; validate/sanitize |
| Balancing offline-first with updateability | Embedded baseline always works; updates are explicit |

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