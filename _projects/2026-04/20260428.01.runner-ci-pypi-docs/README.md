# Project: 20260428.01.runner-ci-pypi-docs

## Overview
Fix broken desktop CI, harden release pipelines, publish agent-runner as standalone PyPI package, and rewrite runner documentation for platform integrators.

**Created**: 2026-04-28
**Status**: Active 🟢

## Project Information

### Primary Goal
Ensure every tag push produces green builds across all platforms, publish the agent-runner as a pip-installable package on PyPI, and rewrite runner docs from a platform-builder perspective.

### Timeline
**Target Completion**: 3-4 days

### Technology Stack
GitHub Actions CI/CD, Python/Poetry/PyPI, Tauri/Rust, Go CLI, Markdown/MDX documentation

### Project Type
Feature Development

### Affected Components
CI workflows (.github/workflows/), agent-runner (backend/services/agent-runner/), desktop app (client-apps/desktop/), docs (docs/concepts/, docs/guides/)

## Project Context

### Dependencies
PyPI account credentials, TAURI_SIGNING_PRIVATE_KEY for macOS signing

### Success Criteria
- Windows desktop CI build passes on tag push
- Desktop CI runs on main push for early feedback
- Agent-runner published on PyPI as stigmer-runner
- Runner docs rewritten for platform integrators with sidecar and Docker patterns

### Known Risks & Mitigations
PyPI package naming conflicts, Agent-runner internal dependencies on graphton and stigmer-protos may complicate standalone packaging

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