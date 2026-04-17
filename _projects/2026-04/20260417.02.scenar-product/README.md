# Project: 20260417.02.scenar-product

## Overview
Extract the demo video framework from Stigmer into a standalone open-source product called Scenar. Users bring their React components, define scenarios declaratively via proto-defined contracts, and get interactive web embeds + pixel-perfect MP4 videos from the same source.

**Created**: 2026-04-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Define the Scenar proto contract (separate from Stigmer protos), extract the generic engine from site/demos/engine/, build a React SDK with createScenario(), and rewire Stigmer demos to import from the extracted package.

### Timeline
**Target Completion**: Ongoing / no fixed deadline

### Technology Stack
TypeScript, React, Framer Motion, Remotion, Protobuf (buf)

### Project Type
Feature Development

### Affected Components
scenar/ (new top-level directory: apis/, engine/, shells/, sdk/), site/src/components/docs/demos/engine/ (extraction source), site/src/components/docs/demos/views/ (extraction source), site/video/ (Remotion integration)

## Project Context

### Dependencies
Existing demo engine must remain functional during extraction (25+ live demos). buf toolchain for proto compilation.

### Success Criteria
- 1. Scenar protos compile independently (buf lint + buf build) with zero Stigmer imports. 2. scenar/engine/ has zero @stigmer/* imports. 3. All existing Stigmer demos work unchanged after rewiring imports. 4. A standalone createScenario() example works outside Stigmer context.

### Known Risks & Mitigations
1. Tight coupling in engine/shared.ts (Stigmer proto fixtures). 2. DemoViewport imports Stigmer tokens - needs clean extraction. 3. View shells (AppShell, BrowserView) may have hidden Stigmer dependencies. 4. Remotion video pipeline integration needs careful handling.

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