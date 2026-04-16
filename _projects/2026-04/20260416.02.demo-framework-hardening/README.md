# Project: 20260416.02.demo-framework-hardening

## Overview
Harden the demo video generation framework: fix responsiveness issues with cursor and scroll interactions at different viewport sizes, add all planned future interaction types (click, type, hover, drag, viewport-transition), expand Playwright test coverage, and architect the engine layer for future extraction as a standalone open-source product (working name: DemoScope).

**Created**: 2026-04-16
**Status**: Active 🟢

## Project Information

### Primary Goal
Fix responsiveness, add all future interaction types, expand test coverage, and restructure the engine for DemoScope extraction

### Timeline
**Target Completion**: No hard deadline — solve it properly across multiple sessions

### Technology Stack
TypeScript, React, Framer Motion, Remotion, Playwright

### Project Type
Feature Development

### Affected Components
site/src/components/docs/demos/engine/, site/src/components/docs/demos/shared/, site/src/components/docs/demos/views/, site/video/, site/e2e/, site/scripts/validate-demos.ts, site/playwright.config.ts

## Project Context

### Dependencies
Remotion (already installed), Framer Motion (already installed), Playwright (already installed) — no new external dependencies expected

### Success Criteria
- All 25-35 existing demos render correctly at all tested viewport sizes. Cursor and scroll interactions are pixel-accurate at every viewport. All new interaction types work in both browser playback and Remotion video export. Engine layer has zero imports from @stigmer/* packages. All Playwright tests pass across all viewport projects.

### Known Risks & Mitigations
Fixed virtual viewport on docs site may affect how demos look embedded in prose (Fumadocs layout). New interaction types (drag, type) require dispatching synthetic React events which can be fragile across React versions. Extracting the engine while keeping existing scenarios working requires careful import path management.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Task Roadmap

| Task | Title | Status | Depends On |
|------|-------|--------|------------|
| T01 | Fix Responsiveness — Fixed Virtual Viewport | PENDING REVIEW | — |
| T02 | Resize-Aware Scroll Recovery | PENDING | T01 |
| T03 | Expand Playwright Viewport Coverage | PENDING | T01 |
| T04 | New Interaction — Click (UI State Trigger) | PENDING | T01 |
| T05 | New Interaction — Type (Text Input Simulation) | PENDING | T04 |
| T06 | New Interaction — Hover (Tooltip Reveal) | PENDING | T04 |
| T07 | New Interaction — Drag (Drag-and-Drop) | PENDING | T04 |
| T08 | New Interaction — Viewport Transition (Zoom/Pan) | PENDING | T01 |
| T09 | DemoScope Extraction Architecture | PENDING | T01-T08 |
| T10 | Validation and Testing Updates | PENDING | T01-T09 |

## Future Product Direction

Working name: **DemoScope** — a standalone open-source framework for creating interactive product demos and deterministic video exports from real React components. The engine layer (T09) will be architected for extraction as a separate package.

## Current Status

### Active Task
T01 — Fix Responsiveness (PENDING REVIEW)

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Task plans written (T01-T10)
- [ ] T01: Fix Responsiveness
- [ ] T02: Resize-Aware Scroll Recovery
- [ ] T03: Expand Viewport Coverage
- [ ] T04-T08: New Interaction Types
- [ ] T09: DemoScope Extraction Architecture
- [ ] T10: Validation and Testing Updates
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