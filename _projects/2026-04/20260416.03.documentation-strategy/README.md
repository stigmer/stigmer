# Project: 20260416.03.documentation-strategy

## Overview
Comprehensive documentation strategy covering CLI reference docs with quality gates, Ink SDK reference and integration guide, README overhaul aligned with content strategy, and open-source getting-started path as a first-class citizen in the docs site.

**Created**: 2026-04-16
**Status**: Active 🟢

## Project Information

### Primary Goal
Deliver production-quality documentation across four areas: (1) CLI reference with auto-generation, coverage checks, and CI validation, (2) Ink SDK reference docs and hand-written integration guide mirroring the React SDK pattern, (3) README restructured and aligned with content strategy positioning, (4) open-source/local getting-started path visible and complete in docs navigation.

### Timeline
**Target Completion**: 2-3 weeks (5 phases)

### Technology Stack
Go/Cobra (CLI docs), TypeScript/TypeDoc (Ink SDK docs), MDX/Fumadocs (docs site), Makefile (CI)

### Project Type
Feature Development

### Affected Components
client-apps/cli (Cobra descriptions), sdk/ink (TypeDoc setup + TSDoc), docs/ (all new pages), site/scripts/ (Ink docs generator), Makefile (CI targets), README.md

## Project Context

### Dependencies
CLI modernization project (20260415.01) should be substantially complete before CLI doc content is finalized; Content strategy project (20260331.01) positioning and vocabulary decisions are prerequisites for README

### Success Criteria
- CLI reference pages live on docs site with CI freshness check; every Cobra command has Long+Example enforced by Go test; Ink SDK has TypeDoc validation and auto-generated reference on docs site; hand-written Ink integration guide published; local.mdx visible in sidebar and docs homepage; getting-started tutorials work for both Cloud and Local tracks; README links all valid
- aligned with content strategy positioning

### Known Risks & Mitigations
Ink SDK is new and may change API surface during early adoption; CLI command descriptions need rewriting which touches many Go files; getting-started tabs require writing CLI equivalents for all cloud tutorial steps

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