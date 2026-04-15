# Project: 20260415.01.cli-modernization

## Overview
Comprehensive modernization of the Stigmer CLI: close all apply gaps across every resource kind, add CI guards so gaps never recur, replace discover with connect, fix slug-vs-name help text, and rewrite run/resume rendering with @stigmer/ink (React-in-CLI via Ink).

**Created**: 2026-04-15
**Status**: Active 🟢

## Project Information

### Primary Goal
Make the CLI a first-class citizen: every apply-able resource works, CI prevents regressions, connect replaces discover with proper OAuth, and run/resume uses shared React SDK components via Ink for terminal rendering.

### Timeline
**Target Completion**: 1 month (4 phases)

### Technology Stack
Go/Cobra (CLI), TypeScript/React/Ink (SDK), Protobuf (APIs), Bubble Tea/Lip Gloss (current TUI)

### Project Type
Feature Development

### Affected Components
client-apps/cli, sdk/ink (new), sdk/react, sdk/typescript, apis/stubs/go

## Project Context

### Dependencies
None identified

### Success Criteria
- All 13 apply-able resources work in CLI
- CI test fails on missing apply handlers
- discover removed in favor of connect
- all help text uses slug-or-id
- @stigmer/ink package published alongside other SDK packages
- run/resume renders via Ink components

### Known Risks & Mitigations
Ink/Go shell-out integration adds complexity, large scope across 4 phases, @stigmer/react hook compatibility with Ink renderer needs validation

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