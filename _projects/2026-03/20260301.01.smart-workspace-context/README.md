# Project: 20260301.01.smart-workspace-context

## Overview
Implement intelligent workspace context retrieval for Stigmer's agent platform — replacing the current reactive, brute-force file discovery with proactive context delivery including workspace tree snapshots, .gitignore-aware filtering, file-tree caching, extended skip-directories, context-efficiency prompt guidance, task-aware relevance signaling, and semantic search indexing.

**Created**: 2026-03-01
**Status**: Active 🟢

## Project Information

### Primary Goal
Close the architectural gaps between Stigmer's reactive workspace interaction and Cursor-style proactive context retrieval so that agents start with structural awareness, discover files efficiently, and use context budgets wisely.

### Timeline
**Target Completion**: Flexible / no hard deadline

### Technology Stack
Python (Graphton library, agent-runner worker), Go (CLI if needed)

### Project Type
Optimization

### Affected Components
backend/libs/python/graphton (filesystem backend, tool wrappers, prompt enhancement), backend/services/agent-runner (workspace provisioner, execute_graphton, workspace sources), potentially client-apps/cli

## Project Context

### Dependencies
pathspec library for .gitignore parsing; embedding model integration for semantic indexing (P3)

### Success Criteria
- 1) Agent receives compact file-tree manifest at startup without exploration calls 2) glob/grep respect .gitignore and use cached file trees 3) Skip-directory set covers common build/vendor directories 4) Prompt includes context-efficiency guidance 5) User message parsed for relevance signals 6) Semantic search tool available for meaning-based file discovery

### Known Risks & Mitigations
Performance of tree generation for very large repos (100K+ files), .gitignore parsing edge cases with nested patterns, embedding pipeline integration complexity for P3

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