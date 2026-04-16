# Next Task: 20260416.02.demo-framework-hardening

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Demo Framework Hardening & DemoScope Architecture

**Description**: Harden the demo video generation framework: fix responsiveness issues with cursor and scroll interactions at different viewport sizes, add all planned future interaction types (click, type, hover, drag, viewport-transition), expand Playwright test coverage, and architect the engine layer for future extraction as a standalone open-source product (working name: DemoScope).

**Goal**: Fix responsiveness, add all future interaction types, expand test coverage, and restructure the engine for DemoScope extraction

**Tech Stack**: TypeScript, React, Framer Motion, Remotion, Playwright

**Components**: `site/src/components/docs/demos/engine/`, `site/src/components/docs/demos/shared/`, `site/src/components/docs/demos/views/`, `site/video/`, `site/e2e/`, `site/scripts/validate-demos.ts`, `site/playwright.config.ts`

## Task Roadmap

| Task | Title | Status | Depends On |
|------|-------|--------|------------|
| T01 | Fix Responsiveness — Fixed Virtual Viewport | DONE | — |
| T02 | Resize-Aware Scroll Recovery | RESOLVED BY T01 | T01 |
| T03 | Expand Playwright Viewport Coverage | DONE (via T01) | T01 |
| T04 | New Interaction — Click (UI State Trigger) | PENDING | T01 |
| T05 | New Interaction — Type (Text Input Simulation) | PENDING | T04 |
| T06 | New Interaction — Hover (Tooltip Reveal) | PENDING | T04 |
| T07 | New Interaction — Drag (Drag-and-Drop) | PENDING | T04 |
| T08 | New Interaction — Viewport Transition (Zoom/Pan) | PENDING | T01 |
| T09 | DemoScope Extraction Architecture | PENDING | T01-T08 |
| T10 | Validation and Testing Updates | PENDING | T01-T09 |

## Current Task: T04 — New Interaction: Click (UI State Trigger)

**Status**: PENDING — Ready to start (T01 unblocked it)

**Plan file**: `_projects/2026-04/20260416.02.demo-framework-hardening/tasks/T04_0_plan.md`

## Completed: T01 — Fix Responsiveness

Implemented `DemoViewport` wrapper using fixed 896×380 canonical viewport with CSS zoom. All 22 interactive scenarios migrated. Tests pass at desktop (1280×800), small-desktop (1024×600), and mobile (393×851). See design decision `003-fixed-virtual-viewport.md`.

## Essential Files to Review

### Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/tasks/
```

### Knowledge Folders
- **Design Decisions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/design-decisions/`
- **Coding Guidelines**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/coding-guidelines/`
- **Wrong Assumptions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/wrong-assumptions/`
- **Don't Dos**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/dont-dos/`
- **Checkpoints**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.02.demo-framework-hardening/checkpoints/`

### Key Source Files
- **Engine core**: `site/src/components/docs/demos/engine/`
- **DemoViewport**: `site/src/components/docs/demos/engine/DemoViewport.tsx`
- **Cursor**: `site/src/components/docs/demos/engine/Cursor.tsx`
- **Interactions**: `site/src/components/docs/demos/engine/useStepInteractions.ts`
- **Scroll utils**: `site/src/components/docs/demos/engine/scroll-utils.ts`
- **Tokens**: `site/src/components/docs/demos/shared/tokens.ts`
- **Video composition**: `site/video/compositions/DemoVideo.tsx`
- **Playwright config**: `site/playwright.config.ts`
- **Demo validation**: `site/scripts/validate-demos.ts`

## Resume Checklist

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the current task

## Quick Commands

- "Continue with T01" — Resume the responsiveness fix
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
