# Project: 20260321.04.content-framework-cleanup

## Overview
Unified content framework for docs and sales website — clean up clutter from previous foundation projects, consolidate roles/reminders/rules into a simple separation-of-concerns model (theme → layout → components → content), build the missing docs component library, and establish one-role/one-reminder workflow for all content work.

**Created**: 2026-03-21
**Status**: Active 🟢

## Project Information

### Primary Goal
A single, simple framework where theme, layout, components, and content are separate responsibilities — applied consistently to both docs and sales website. One role, one reminder, clean rules, and content that actually looks good.

### Timeline
**Target Completion**: 3-4 sessions

### Technology Stack
Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4

### Project Type
Refactoring

### Affected Components
docs/ (content), site/src/app/docs/ (layout), site/src/components/mdx/ (doc components), site/src/app/globals.css (theme), .cursor/rules/ (rules cleanup), _roles/ (role consolidation), _reminders/ (reminder consolidation), docs/standards/ (standards cleanup), site/standards/ (standards review)

## Project Context

### Dependencies
Fumadocs built-in components (Callout, Tabs, Steps, Accordion), existing sales website component system

### Success Criteria
- 1) One role file replaces 4+ docs/site roles 2) One reminder replaces reminders 004-008 3) Docs pages use Callout/Tabs/Steps components instead of raw text 4) Breadcrumbs work in docs 5) Agent can produce good content by dragging one role + one reminder into chat

### Known Risks & Mitigations
Scope creep into rewriting all content (focus on framework first, content second)

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