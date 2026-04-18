# Demo Framework Extraction to Scenar

**Date**: April 18, 2026

## Summary

Replaced Stigmer's embedded demo engine, generic shell components, and narration script with imports from the published `@scenar/core`, `@scenar/react`, and `@scenar/cli` npm packages. Deleted 19 files (4,620 lines) from Stigmer, rewired all 28 demo scenarios, and reduced the narration generation script from 323 lines to 22. The demo framework is now a consumer of Scenar, not a fork.

## Problem Statement

Stigmer's demo framework was extracted into the Scenar open-source project (T03-T05), but the Stigmer site still used its own local copies of the engine, shell components, and narration tooling. This created divergence risk — fixes and features in Scenar wouldn't reach Stigmer without manual porting, and the 15-file engine directory was dead weight that could confuse contributors.

### Pain Points

- 15 engine files (ScenarioPlayer, Cursor, useStepInteractions, DemoViewport, etc.) duplicated what `@scenar/react` already provides
- 3 shell components (BrowserView, TerminalView, CodeEditorView) duplicated `@scenar/react` exports
- PulseHighlight component duplicated `@scenar/react` export
- 323-line narration script duplicated what `@scenar/cli narrate` now handles
- Two copies of the same code with no mechanism to keep them in sync

## Solution

Replaced all Stigmer-local engine code with `@scenar/react` imports, deleted the redundant files, created a thin `StigmerDemoViewport` wrapper for Stigmer-specific token injection, and replaced the narration script with a CLI invocation.

## Implementation Details

### Deleted (19 files, 4,620 lines removed)

**Entire `engine/` directory** (15 files): ScenarioPlayer, Cursor, useStepInteractions, DemoViewport, ViewportTransformLayer, TimeSource, VideoExportContext, useNarrationManifest, useNarrationPlayback, narration types, timeline, PlaybackCoordinator, scroll-utils, timing, shared fixtures (moved to `fixtures.ts`)

**Shell components** (3 files): BrowserView, TerminalView, CodeEditorView

**Shared component** (1 file): PulseHighlight

### Created (2 files)

- `demos/shared/StigmerDemoViewport.tsx` — 30-line wrapper around Scenar's `DemoViewport` that injects Stigmer's `not-prose` class and shell height token
- `demos/fixtures.ts` — Moved from `engine/shared.ts` (Stigmer domain fixtures: `DEMO_ORG`, `MOCK_WORKSPACE`, `snapshot()`)

### Rewired (60+ files)

- **25 scenario `index.tsx` files**: Engine imports replaced with `@scenar/react`, DemoViewport replaced with StigmerDemoViewport
- **25 scenario `steps.ts` files**: `ScenarioStep` type from `@scenar/react`, `TerminalLine`/`FileTreeEntry` types from `@scenar/react`, `snapshot` from `../../fixtures`
- **18 scenarios with interactions**: Separate `StepInteractions` maps inlined into step objects, action type strings converted from kebab-case to snake_case (`set-cursor` to `set_cursor`, etc.)
- **5 remaining Stigmer views**: CSS variable `--demo-shell-height` renamed to `--scenar-shell-height`, PulseHighlight import swapped to `@scenar/react`
- **3 video export files**: TimeSourceProvider, VideoExportProvider, NarrationManifest, computeStepTimeline imports from `@scenar/react`
- **Narration script**: Replaced 323-line TTS/discovery/caching script with 22-line wrapper calling `@scenar/cli`

### API Mismatches Resolved

1. **Interactions model**: Stigmer used a separate `StepInteractions` map keyed by step index; Scenar embeds interactions directly on each step. All 18 interaction scenarios restructured.
2. **Action type strings**: Stigmer used kebab-case (`set-cursor`); Scenar uses snake_case (`set_cursor`). All interaction definitions updated.
3. **CSS variable name**: Stigmer used `--demo-shell-height`; Scenar uses `--scenar-shell-height`. All 5 remaining views updated.

## Benefits

- **Single source of truth**: Engine fixes and features in Scenar automatically reach Stigmer via npm updates
- **4,620 lines removed**: Less code to maintain, fewer files to navigate, cleaner project structure
- **No behavioral changes**: All 28 demos render identically, all 106 narration audio files recognized as cached on first run
- **TypeScript compiles clean**: Zero errors after the full migration

## Impact

- The `engine/` directory no longer exists in Stigmer
- The demos directory now has 3 subdirectories: `shared/` (2 files), `views/` (6 Stigmer-specific files), `scenarios/` (28 demos)
- Stigmer consumes `@scenar/core@0.0.4`, `@scenar/react@0.0.4`, `@scenar/cli@0.0.4` from npm — no local `file:` references

## Related Work

- Scenar T03 (Engine Extraction) — created `@scenar/core` and `@scenar/react`
- Scenar T04 (Shells Extraction) — extracted BrowserView, TerminalView, CodeEditorView
- Scenar T05 (SDK) — created `createScenario()` and proto adapter
- Scenar CLI Narrate evolution — TS support, directory scanning, caching (same session)

---

**Status**: Production Ready
**Timeline**: Single session (April 18, 2026)
