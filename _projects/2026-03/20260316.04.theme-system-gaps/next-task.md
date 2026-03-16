# Next Task: 20260316.04.theme-system-gaps

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260316.04.theme-system-gaps  
**Description**: Close critical gaps in the Stigmer theming system so platform builders can fully customize embedded components — sync SDK token mappings, add programmatic preset API, introduce shadow/transition/z-index tokens, and write SDK integration docs.  
**Goal**: Ship a complete, documented theming surface that platform builders can use to make Stigmer components match their product's design language without CSS workarounds.  
**Tech Stack**: TypeScript / React / CSS (Tailwind v4)  
**Components**: @stigmer/theme, @stigmer/react SDK, StigmerProvider, sdk/react/styles.css, client-apps/web/globals.css

**Created**: 2026-03-16  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.04.theme-system-gaps
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.04.theme-system-gaps/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.04.theme-system-gaps/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.04.theme-system-gaps/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-03-16  
**Current Focus**: Theme moved to SDK. Next up: Task 2 (preset prop for StigmerProvider)

## Session Progress (2026-03-16, session 2)
- Moved `@stigmer/theme` from `client-apps/web/_libs/ui/theme/` to `sdk/theme/` (git mv)
- Updated root `package.json` workspaces: replaced `client-apps/web/_libs/ui/*` with `sdk/theme`
- Made `sdk/theme/tsconfig.json` self-contained (removed extends to old `_libs/tsconfig.base.json`), aligned with other SDK packages
- Updated `sdk/theme/package.json` repository.directory to `sdk/theme`
- Removed orphaned `client-apps/web/_libs/` (only had README.md and tsconfig.base.json after move)
- Fixed `scripts/publish-libs.mjs`: updated path from old location to `sdk/theme`, corrected publish order (theme before react)
- Verified: `npm install` + `npm run build:libs` + publish dry-run all pass

## Session Progress (2026-03-16, session 1)
- Completed Task 1: Added 11 token mappings (success, warning, info, chart-1–5) to SDK `styles.css`
- Architectural decision: sidebar tokens deliberately excluded from SDK (Console-only layout concern)
- Committed: `14f0c8ad` on branch `feat/move-theme-to-sdk`

## Next Steps
1. Task 2: Add `preset` prop to StigmerProvider for programmatic preset application
2. Task 3: Add shadow tokens to tokens.css and presets
3. Task 4: Add transition tokens to tokens.css and presets
4. Task 5: Add z-index base token for stacking context isolation
5. Task 6: Write @stigmer/react README for platform builders

## Context for Resume
- Branch: `feat/move-theme-to-sdk`
- `@stigmer/theme` now lives at `sdk/theme/` — all imports unchanged (resolve by package name)
- `client-apps/web/_libs/` directory fully removed
- `scripts/publish-libs.mjs` PACKAGES order: protos -> typescript -> theme -> react
- The SDK `styles.css` now has all embeddable-component tokens; Console `globals.css` is the superset with sidebar tokens on top
- No SDK components currently use the newly added tokens — they were added proactively
- All 4 presets override chart tokens but none override success/warning/info (they inherit from base tokens.css)

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

