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
**Current Focus**: Tasks 1–5 complete. Next up: Task 6 (SDK README)

## Session Progress (2026-03-16, session 6)
- Completed Task 5: Added z-index popover token (`--stgm-z-popover`) to theme system
- Discovered Tailwind v4 has NO `--z-*` theme namespace — `@theme inline` cannot create z-index utilities (unlike shadows/transitions)
- Used `@utility z-popover { z-index: var(--stgm-z-popover); }` directive instead — creates a first-class Tailwind utility
- Chose semantic tier approach (`--stgm-z-popover: 50`) over base offset (`--stgm-z-base`) — self-documenting, independently controllable per layer
- Added 1 token to `tokens.css` `:root` only (no `.dark`, no presets — z-index is mode-agnostic and not design-personality)
- Console inherits utility via `@import "@stigmer/react/styles.css"` (resolves to SDK source, not dist)
- Converted `AgentPicker.tsx` from `z-20` to `z-popover`; left `ExecutionStream.tsx` at `z-10` (local stacking, not overlay)
- Build clean: `npm run build:libs` + Console build both pass
- Verified compiled CSS: `.z-popover { z-index: var(--stgm-z-popover) }`

## Session Progress (2026-03-16, session 5)
- Completed Task 4: Added transition tokens (`--stgm-transition-duration`, `--stgm-transition-timing`) to theme system
- Verified Tailwind v4 uses `--default-transition-duration` / `--default-transition-timing-function` as CSS variable fallbacks — overridable via `@theme inline`
- Added 2 tokens to `tokens.css` `:root` only (no `.dark` — motion is mode-agnostic)
- Added per-preset overrides in light selectors only: corporate=200ms deliberate, startup=100ms snappy, friendly=200ms relaxed, fintech=150ms precise
- Wired `--default-transition-duration` and `--default-transition-timing-function` in `@theme inline` for both SDK and Console
- Tailwind v4 inlines the chain: compiled CSS shows `transition-duration: var(--tw-duration, var(--stgm-transition-duration))`
- Build clean: `npm run build:libs` passes (TypeScript + Tailwind compilation)

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
1. Task 6: Write @stigmer/react README for platform builders

## Context for Resume
- Branch: `feat/move-theme-to-sdk`
- `StigmerProvider` now accepts optional `preset` prop — type-safe `ThemePresetId` union
- `THEME_PRESETS` uses `as const satisfies readonly ThemePreset[]` to preserve literal types
- Dark mode CSS selectors now support both compound (`.stgm-theme-X.dark`) and descendant (`.dark .stgm-theme-X`) patterns
- Shadow tokens (`--stgm-shadow-sm/md/lg`) fully wired: tokens.css → @theme inline → Tailwind utilities. Each preset overrides both light and dark.
- Transition tokens (`--stgm-transition-duration`, `--stgm-transition-timing`) fully wired: tokens.css → @theme inline → Tailwind `--default-transition-*` fallback. Light selectors only (motion is mode-agnostic). Preset overrides: corporate=200ms, startup=100ms ease-out, friendly=200ms, fintech=150ms tight curve.
- Z-index token (`--stgm-z-popover: 50`) wired via `@utility` directive (NOT `@theme inline` — Tailwind v4 has no z-index theme namespace). Semantic tier approach — add more tiers when SDK gains overlay components.
- Console theming unchanged — `ThemePresetSelector` and `StigmerTransportBridge` remain as-is
- `@stigmer/theme` now lives at `sdk/theme/` — all imports unchanged (resolve by package name)
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

