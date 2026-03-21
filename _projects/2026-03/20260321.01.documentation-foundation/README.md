# Project: 20260321.01.documentation-foundation

## Overview
Establish documentation standards, patterns, framework, linting rules, and cursor reminders for Stigmer developer documentation. Inspired by docs.temporal.io structure — quickstarts, SDK guides, concept docs — adapted for an agentic platform.

**Created**: 2026-03-21
**Status**: Active 🟢

## Project Information

### Primary Goal
Set up a production-grade documentation system with framework (Fumadocs), content standards, linting, cursor rules/reminders, and initial quickstart structure that ensures all future documentation is consistent, high-quality, and maintainable.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Next.js 15, Fumadocs (MDX), TypeScript, Markdown/MDX, ESLint custom rules, Tailwind CSS

### Project Type
Feature Development

### Affected Components
site (Next.js docs routes), docs/ (markdown content), .cursor/rules (documentation reminders), _roles/002_document_writer.md, @stigmer/theme (docs theming)

## Project Context

### Dependencies
Existing site infrastructure (Next.js 15, Tailwind v4, static export), existing docs/ markdown files (116 files), existing role definitions

### Success Criteria
- Documentation framework integrated into site with /docs routes
- Content standards document with templates for every doc type
- Linting rules for doc quality enforcement
- Cursor rules/reminders for consistent AI-generated docs
- Quickstart page modeled after Temporal
- Homepage docs landing with navigation sidebar

### Known Risks & Mitigations
Static export (output: export) may conflict with some Fumadocs features, Existing 116 docs need migration/adaptation to new framework, Theme integration with existing --stgm-* token system needs careful alignment

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