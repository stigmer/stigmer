# Project: 20260403.02.remotion-video-export

## Overview
Replace the Playwright-based video export pipeline with Remotion for pixel-perfect video quality. Remotion renders each frame individually using headless Chrome, eliminating the VP8 quality degradation that plagues the current approach.

**Created**: 2026-04-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Produce high-quality, crisp, readable demo scenario videos with proper audio synchronization using Remotion, replacing the Playwright recordVideo + FFmpeg pipeline.

### Timeline
**Target Completion**: No rush / whenever I get to it

### Technology Stack
TypeScript, React, Remotion, FFmpeg, Next.js

### Project Type
Refactoring

### Affected Components
site/scripts/export-videos.ts, site/src/app/demos/export/[scenario]/ExportShell.tsx, site/src/components/docs/demos/engine/VideoExportContext.tsx, site/src/components/docs/demos/scenarios/registry.ts

## Project Context

### Dependencies
Remotion (@remotion/cli, @remotion/renderer, remotion)

### Success Criteria
- 1. Videos are pixel-perfect with crisp text on dark backgrounds. 2. Audio narration is properly synchronized with step transitions. 3. Output is 1920x1080 H.264 MP4 with AAC audio. 4. All 10 playback scenarios export successfully. 5. No modifications to existing demo scenario components.

### Known Risks & Mitigations
1. Remotion uses a different paradigm (declarative compositions vs. browser recording) requiring rethinking the export architecture. 2. Framer Motion animations between steps may need special handling in Remotion's frame-by-frame rendering model. 3. Audio synchronization approach differs from the current timeline-based FFmpeg compositing.

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