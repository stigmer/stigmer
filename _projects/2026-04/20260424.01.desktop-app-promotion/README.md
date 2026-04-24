# Project: 20260424.01.desktop-app-promotion

## Overview
Close out documentation for six runner/desktop/CLI projects (Phase A), then build a comprehensive desktop app promotion and distribution system across the web console and marketing site (Phase B).

**Created**: 2026-04-24
**Status**: Active 🟢

## Project Information

### Primary Goal
(1) Runners, desktop app, and CLI runner management are fully documented with concept pages, how-to guides, and SDK reference updates. (2) Users discover and install the Stigmer Desktop app through contextual, non-intrusive promotion in the console and a proper download page on the marketing site.

### Timeline
**Target Completion**: 1 week

### Technology Stack
TypeScript/React (Console), Next.js (marketing site + docs via Fumadocs), MDX, CSS/Tailwind (theme tokens)

### Project Type
Feature Development

### Affected Components
docs/ (documentation — concepts, guides, SDK reference), site/ (marketing site — download page, nav/footer), client-apps/web/ (Console UI — user menu, runner promotion, nudge banner)

## Project Context

### Dependencies
Desktop app project (20260423.03) T05+ complete. Phase 3 runner infrastructure (20260423.02) T02-T08 complete. Desktop release CI (.github/workflows/release.desktop.yaml) operational. Content strategy project (20260331.01) for vocabulary, Diataxis, document writer role.

### Success Criteria
1. Runner concepts page exists in docs/concepts/ alongside other core concepts.
2. Desktop app guide (3 pages) exists in docs/guides/desktop/.
3. CLI runner guides (3 pages) exist in docs/guides/runners/.
4. SDK React runner docs include useLaunchLocalRunner, useStopRunner, useDeleteRunner.
5. Marketing site has a proper download page with platform detection at /download.
6. User menu contains "Get Desktop App" link.
7. Runner-related areas show contextual desktop app promotion.
8. Smart nudge banner appears after user establishes value, dismissible with localStorage persistence.
9. All promotion is Console-only (no SDK boundary violations).
10. Zero linter errors.

### Known Risks & Mitigations
1. SDK docs codegen may not pick up new hooks — may need manual additions or generator fixes.
2. Over-aggressive promotion damages developer trust — one-time dismissible nudge only, no recurring banners.
3. GitHub Release asset URLs are not stable across versions — link to releases page, not direct asset URLs.

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