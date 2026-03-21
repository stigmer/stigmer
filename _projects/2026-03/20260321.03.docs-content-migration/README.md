# Project: 20260321.03.docs-content-migration

## Overview
Migrate, validate, and polish all Stigmer documentation — fix stale content, convert .md to .mdx, replace ASCII diagrams with proper visual elements, improve docs home page with Temporal-style polish, fix typography spacing, and update documentation standards.

**Created**: 2026-03-21
**Status**: Active 🟢

## Project Information

### Primary Goal
Production-quality documentation site where every page is accurate, visually polished, properly structured, and follows established standards — with a home page that matches the quality bar of docs.temporal.io.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4, Mermaid or custom MDX components

### Project Type
Migration

### Affected Components
docs/ (markdown content), site/src/app/docs/ (docs routes), site/src/app/globals.css (typography), docs/standards/ (standards updates), .cursor/rules/docs/ (rule updates)

## Project Context

### Dependencies
Documentation foundation project (complete) — standards, templates, linting, Fumadocs integration all in place

### Success Criteria
- 1. Every migrated page passes make lint-docs. 2. Zero stale factual claims (validated against current implementation). 3. All ASCII art diagrams replaced with proper visual elements. 4. Docs home page has colorful SDK icons and polished copy. 5. Typography spacing matches professional docs sites. 6. Documentation standards updated with diagram and validation rules.

### Known Risks & Mitigations
1. Stale content may require implementation research to validate accuracy. 2. Custom MDX components for diagrams may need Fumadocs component mapping updates. 3. Typography changes could affect marketing pages if CSS is shared.

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