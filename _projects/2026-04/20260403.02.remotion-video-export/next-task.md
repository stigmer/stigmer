# Next Task: 20260403.02.remotion-video-export

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.02.remotion-video-export

**Description**: Replace the Playwright-based video export pipeline with Remotion for pixel-perfect video quality. Remotion renders each frame individually using headless Chrome, eliminating the VP8 quality degradation that plagues the current approach.
**Goal**: Produce high-quality, crisp, readable demo scenario videos with proper audio synchronization using Remotion, replacing the Playwright recordVideo + FFmpeg pipeline.
**Tech Stack**: TypeScript, React, Remotion, FFmpeg, Next.js
**Components**: site/scripts/export-videos.ts, site/src/app/demos/export/[scenario]/ExportShell.tsx, site/src/components/docs/demos/engine/VideoExportContext.tsx, site/src/components/docs/demos/scenarios/registry.ts

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Predecessor Project

This project continues from **20260403.01.demo-audio-video** (Phase 5: Video
export pipeline), which built the initial Playwright-based recording +
FFmpeg compositing pipeline. That pipeline works end-to-end but produces
low-quality video due to Playwright's VP8 codec. This project replaces
the recording backend with Remotion for pixel-perfect output.

## Current Status

**Created**: 2026-04-03
**Current Task**: T01 — Replace Playwright Video Export with Remotion
**Status**: PENDING REVIEW — plan awaiting developer approval

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
