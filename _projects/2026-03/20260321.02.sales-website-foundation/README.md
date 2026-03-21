# Project: 20260321.02.sales-website-foundation

## Overview
Establish patterns, standards, templates, and enforcement mechanisms for the Stigmer sales website. Creates the same standards infrastructure for site/ that the documentation-foundation project created for docs/ — machine-readable standards, page/section templates, Cursor rules, lint tooling, and quality checklists. Ensures AI-assisted development produces consistently high-quality, conversion-optimized content.

**Created**: 2026-03-21
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a complete standards foundation for the Stigmer sales website: website-standards.md, information architecture, machine-readable content requirements, copy guidelines, performance budgets, component standards, page and section templates, Cursor rules for enforcement, lint tooling, and updated roles/reminders.

### Timeline
**Target Completion**: 5-7 sessions

### Technology Stack
Markdown, JSON, MDC (Cursor rules), TypeScript/ESLint (lint tooling), Next.js/Tailwind (existing site stack)

### Project Type
Feature Development

### Affected Components
site/standards/, .cursor/rules/site/, _reminders/, _roles/, tools/ (lint scripts)

## Project Context

### Dependencies
Existing sales website codebase (site/), documentation standards (docs/standards/) as reference model, existing roles (007, 008, 009) and reminders (005, 006)

### Success Criteria
- Every page type has a template
- Every section type has requirements
- Copy guidelines are machine-readable (JSON)
- Cursor rules auto-enforce standards on site/ edits
- Quality review has a defined checklist
- Performance budget is codified
- Roles 007/008/009 reference the new standards
- New reminder 007 points to all standards artifacts
- Lint scripts validate key patterns

### Known Risks & Mitigations
Over-engineering standards before real content to validate against (mitigation: keep templates practical and iterate when content project starts),Standards too rigid and slow down iteration (mitigation: treat as living documents),Lint tooling scope creep (mitigation: start with simple script-based checks before custom ESLint rules)

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