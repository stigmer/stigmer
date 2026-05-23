# Project: 20260523.02.workflow-ux-implementation

## Overview
Implement state-of-the-art workflow UX based on deep research findings: graph-native execution visualization, semantic node shapes, ELK layout engine, contextual task insertion, inspector panel refactor, and comprehensive E2E test coverage.

**Created**: 2026-05-23
**Status**: Active 🟢

## Project Information

### Primary Goal
Rewrite the workflow UX layer to achieve parity with or exceed AWS Step Functions, n8n, and Retool Workflows — covering execution visualization, visual editor, overview page, and monitoring — with integrated E2E tests for every feature.

### Timeline
**Target Completion**: 4-6 weeks

### Technology Stack
React, TypeScript, @xyflow/react v12, elkjs, Next.js, Tailwind CSS, Playwright (E2E tests)

### Project Type
Feature Development

### Affected Components
sdk/react/src/workflow/ (all workflow components), client-apps/web workflow pages, client-apps/desktop workflow pages, test/e2e/tests/ (E2E test suite)

## Project Context

### Dependencies
elkjs (new dependency for layout), @xyflow/react v12 (existing), Temporal gRPC streaming (existing backend)

### Success Criteria
- Execution viewer shows live graph with node status overlays
- Nodes use semantic shapes (diamond for switch/bar for fork/octagon for human)
- ELK layout produces clean graphs for 50+ node workflows
- Plus buttons open contextual task picker
- Inspector panel is single-purpose configuration
- Overview page has interactive full-width graph
- All features have Playwright E2E tests
- WCAG accessibility for non-color differentiation

### Known Risks & Mitigations
Semantic drift between design and execution views, YAML/visual round-trip fidelity, ELK configuration complexity, Layout instability during editing, Performance with 50+ nodes and live execution overlays

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