# Project: 20260403.01.demo-audio-video

## Overview
Add AI-generated audio narration to demo scenarios and build a video export pipeline for social media content. Extend the ScenarioPlayer engine with audio sync, use Edge TTS for free narration generation, and use Playwright + FFmpeg to export MP4 videos for LinkedIn and YouTube.

**Created**: 2026-04-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Extend the demo engine so each scenario produces both interactive website demos with narrated audio and exportable MP4 videos for LinkedIn/YouTube. One set of step definitions (AI-written by the document writer) produces both outputs.

### Timeline
**Target Completion**: No fixed deadline — iterative, build a proper solution

### Technology Stack
TypeScript, React 19, Next.js 15, Edge TTS, Playwright, FFmpeg, Framer Motion

### Project Type
Feature Development

### Affected Components
site/src/components/docs/demos/engine/ScenarioPlayer.tsx, site/src/components/docs/demos/scenarios/*, site/src/components/docs/demos/engine/shared.ts, site/scripts/, site/Makefile, _roles/002_document_writer.md

## Project Context

### Dependencies
Edge TTS (free, no API key), Playwright (dev dependency), FFmpeg (brew install)

### Success Criteria
- 1. ScenarioStep type extended with narration field. 2. Build script generates MP3 from narration text via Edge TTS. 3. ScenarioPlayer syncs audio playback with step progression. 4. Mute/unmute toggle in player controls. 5. Video export script produces 1920x1080 MP4 files. 6. All existing demo scenarios have narration text. 7. Document writer role updated to include narration authoring.

### Known Risks & Mitigations
Edge TTS voice quality may not meet production bar (upgrade path to paid TTS exists). Browser autoplay policy blocks audio without user interaction (mitigated by mute-by-default UX). Playwright video recording may have timing sync issues with step animations.

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