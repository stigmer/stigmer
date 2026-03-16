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
**Current Focus**: Tasks 1–3 complete. Next up: Task 4 (transition tokens)

## Session Progress (2026-03-16, session 4)
- Completed Task 3: Added shadow elevation tokens (`--stgm-shadow-sm/md/lg`) to theme system
- Added 3 tokens to `tokens.css` `:root` (Tailwind defaults) and `.dark` (~2.5x opacity for dark surface visibility)
- Added per-preset shadow overrides to all 4 preset files (corporate=prominent, startup=minimal, friendly=soft, fintech=precise)
- Added `--shadow-sm/md/lg` Tailwind `@theme inline` mappings to both SDK `styles.css` and Console `globals.css`
- Verified built CSS resolution chain: `.shadow-md` → `--tw-shadow: var(--stgm-shadow-md)` → token value
- Build clean: `npm run build:libs` passes (TypeScript + Tailwind compilation)

## Session Progress (2026-03-16, session 3)
- Completed Task 2: Added `preset` prop to `StigmerProvider` and fixed dark mode CSS selectors
- Added `ThemePresetId` union type and `resolvePresetClass()` to `@stigmer/theme`
- Fixed dark mode CSS selectors in all 4 preset files — added `.dark .stgm-theme-X` descendant selector for embedded contexts
- Switched `THEME_PRESETS` from explicit type annotation to `as const satisfies readonly ThemePreset[]` to preserve literal types
- Committed: `7118c24f` on branch `feat/move-theme-to-sdk`

## Session Progress (2026-03-16, session 2)
- Moved `@stigmer/theme` from `client-apps/web/_libs/ui/theme/` to `sdk/theme/` (git mv)
- Updated root `package.json` workspaces, tsconfig, package.json, publish script
- Removed orphaned `client-apps/web/_libs/` directory
- Verified: `npm install` + `npm run build:libs` + publish dry-run all pass

## Session Progress (2026-03-16, session 1)
- Completed Task 1: Added 11 token mappings (success, warning, info, chart-1–5) to SDK `styles.css`
- Architectural decision: sidebar tokens deliberately excluded from SDK (Console-only layout concern)
- Committed: `14f0c8ad` on branch `feat/move-theme-to-sdk`

## Next Steps
1. Task 4: Add transition tokens (`--stgm-transition-duration`, `--stgm-transition-timing`) to tokens.css and presets
2. Task 5: Add z-index base token (`--stgm-z-base`) for stacking context isolation
3. Task 6: Write @stigmer/react README for platform builders

## Context for Resume
- Branch: `feat/move-theme-to-sdk`
- `StigmerProvider` now accepts optional `preset` prop — type-safe `ThemePresetId` union
- `THEME_PRESETS` uses `as const satisfies readonly ThemePreset[]` to preserve literal types
- Dark mode CSS selectors now support both compound (`.stgm-theme-X.dark`) and descendant (`.dark .stgm-theme-X`) patterns
- Shadow tokens (`--stgm-shadow-sm/md/lg`) fully wired: tokens.css → @theme inline → Tailwind utilities. Each preset overrides both light and dark.
- Console theming unchanged — `ThemePresetSelector` and `StigmerTransportBridge` remain as-is
- `@stigmer/theme` now lives at `sdk/theme/` — all imports unchanged (resolve by package name)
- Tasks 4–5 (remaining token categories) are independent of each other
- Task 6 (docs) should be last since it documents everything

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

