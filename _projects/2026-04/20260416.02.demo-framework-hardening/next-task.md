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
| T04 | New Interaction — Click (UI State Trigger) | DONE | T01 |
| T05 | New Interaction — Type (Text Input Simulation) | DONE | T04 |
| T06 | New Interaction — Hover (Tooltip Reveal) | DONE | T04 |
| T07 | New Interaction — Drag (Drag-and-Drop) | DONE | T04 |
| T08 | New Interaction — Viewport Transition (Zoom/Pan) | PENDING | T01 |
| T09 | DemoScope Extraction Architecture | PENDING | T01-T08 |
| T10 | Validation and Testing Updates | PENDING | T01-T09 |

## Current Task: T08 — New Interaction: Viewport Transition (Zoom/Pan)

**Status**: PENDING — Ready to start (T01 unblocked it)

**Plan file**: `_projects/2026-04/20260416.02.demo-framework-hardening/tasks/T08_0_plan.md`

## Completed: T07 — New Interaction: Drag (Drag-and-Drop)

Added `drag` as the seventh action type to the demo engine's `useStepInteractions` hook. The drag action is four-phase: phase 1 moves the cursor to the drag source at `atPercent`, phase 2 dispatches `pointerdown` and sets `data-dragging="true"` on the source after `CLICK_DELAY_MS` (450ms), phase 3 animates the cursor to the destination after `DRAG_SETTLE_MS` (200ms), phase 4 dispatches `pointerup` on the destination and removes `data-dragging` after another `CLICK_DELAY_MS` (450ms). Both browser (setTimeout) and video (frame-driven) paths are implemented. The `isDragging` prop on `Cursor` switches from the pointer arrow icon to a closed-hand grab icon during the drag. A new `setDragging` callback in `UseStepInteractionsOptions` coordinates drag-visual state between the hook and the Cursor component. Uses pointer events (not HTML5 drag events) for compatibility with modern drag libraries. Uses `data-cursor-target` for both source and destination (no new data attributes). Validated with `drag-reorder-validation`, a two-column task board scenario. See coding guideline `drag-interaction-patterns.md`.

## Completed: T06 — New Interaction: Hover (Tooltip Reveal)

Added `hover` as the sixth action type to the demo engine's `useStepInteractions` hook. The hover action is three-phase: phase 1 moves the cursor to the target at `atPercent` with ripple suppressed via a new `showRipple` prop on `Cursor`, phase 2 dispatches pointer/mouse enter events (`pointerenter`, `pointerover`, `mouseenter`, `mouseover`) and sets `data-hover="true"` after `CLICK_DELAY_MS` (450ms), phase 3 dispatches leave events and removes `data-hover` after `HOVER_HOLD_MS` (1500ms, configurable via `hoverDuration`). Both browser (setTimeout) and video (frame-driven) paths are implemented. The `data-hover` attribute enables CSS hover-state styling for components that cannot be triggered by JavaScript events alone. A new optional `setShowRipple` callback in `UseStepInteractionsOptions` coordinates ripple suppression between the hook and the Cursor component. Validated with `api-key-setup`, which now hovers over the "New API key" button on step 4 before clicking it on step 5. See coding guideline `hover-interaction-patterns.md`.

## Completed: T05 — New Interaction: Type (Text Input Simulation)

Added `type` as the fifth action type to the demo engine's `useStepInteractions` hook. The type action is three-phase: phase 1 moves the cursor to the target at `atPercent`, phase 2 starts typing after `CLICK_DELAY_MS` (450ms), phase 3+ types characters one at a time at `TYPE_CHAR_DELAY_MS` (50ms) intervals. Uses `resolveInput` to find the `<input>`/`<textarea>` inside a `data-cursor-target` wrapper, and the proven `nativeInputValueSetter` pattern to trigger React's onChange. Both browser (setTimeout) and video (frame-driven) paths are implemented. Validated with `api-key-setup`, which replaced the one-off `PrefilledCreateForm` component with the engine-level `type` action. See coding guideline `type-interaction-patterns.md`.

## Completed: T04 — New Interaction: Click (UI State Trigger)

Added `click` as a fourth action type to the demo engine's `useStepInteractions` hook. The click action is two-phase: phase 1 moves the cursor to the target element at `atPercent`, phase 2 dispatches a native DOM click after `CLICK_DELAY_MS` (450ms) so the cursor ripple is visible before the UI reacts. Both browser (setTimeout) and video (frame-driven) paths are implemented. Validated with `approval-flow-playback`, which collapsed from 5 steps to 4 by replacing the three-step snapshot pattern with a real click that triggers `ApprovalCard`'s `onSubmit` handler. See coding guideline `click-interaction-patterns.md`.

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
- **Timing constants**: `site/src/components/docs/demos/engine/timing.ts`
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

- "Continue with T08" — Start the viewport transition interaction
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
