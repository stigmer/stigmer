# Task T09: DemoScope Extraction Architecture

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Refactoring / Architecture
**Depends on**: T01-T08

## Goal

Restructure the demo engine layer so it has zero dependencies on Stigmer-specific code, preparing it for future extraction as a standalone open-source package (working name: DemoScope).

## Current State

The engine already has good separation:
- `engine/` contains generic components (ScenarioPlayer, Cursor, useStepInteractions, TimeSource, etc.)
- `views/` contains reusable shell components (AppShell, BrowserView, TerminalView, etc.)
- `shared/` contains tokens and utilities
- `scenarios/` contains Stigmer-specific demo scenarios

However, some cross-cutting concerns exist:
- `engine/shared.ts` imports `@stigmer/protos` for mock data helpers
- Scenarios import from `@stigmer/react` for SDK components
- The registry (`scenarios/registry.ts`) couples engine to specific scenarios

## Proposed Architecture

```
demos/
├── engine/           # DemoScope core — ZERO @stigmer/* imports
│   ├── ScenarioPlayer.tsx
│   ├── Cursor.tsx
│   ├── useStepInteractions.ts
│   ├── TimeSource.tsx
│   ├── VideoExportContext.tsx
│   ├── PlaybackCoordinator.ts
│   ├── timeline.ts
│   ├── scroll-utils.ts
│   ├── narration.ts
│   ├── useNarrationPlayback.ts
│   ├── useNarrationManifest.ts
│   └── index.ts          # Public API exports
├── shells/           # Reusable view shells — ZERO @stigmer/* imports
│   ├── AppShell.tsx
│   ├── BrowserView.tsx
│   ├── TerminalView.tsx
│   ├── CodeEditorView.tsx
│   ├── APIExchangeView.tsx
│   ├── ManagementShell.tsx
│   └── index.ts
├── tokens/           # Design tokens — ZERO @stigmer/* imports
│   └── tokens.ts
├── scenarios/        # Stigmer-specific (NOT part of DemoScope)
│   ├── registry.ts
│   └── <scenario-name>/
└── fixtures/         # Stigmer-specific mock data (NOT part of DemoScope)
    └── shared.ts     # Moved from engine/shared.ts
```

## Implementation Steps

1. Move `engine/shared.ts` (Stigmer fixture helpers) to `fixtures/shared.ts`
2. Update all scenario imports from `engine/shared` to `fixtures/shared`
3. Audit every file in `engine/` for `@stigmer/*` imports — move any Stigmer-specific code out
4. Audit every file in `views/` (future `shells/`) for `@stigmer/*` imports
5. Create `engine/index.ts` barrel export with the full public API
6. Create `shells/index.ts` barrel export
7. Add a lint rule or validation check that `engine/` and `shells/` have zero `@stigmer/*` imports
8. Document the DemoScope authoring model in a `DEMOSCOPE.md` design document

## Success Criteria

- `engine/` directory has zero imports from `@stigmer/*`
- `views/` (shells) directory has zero imports from `@stigmer/*`
- All existing scenarios work unchanged (import paths updated)
- Clear barrel exports for engine and shells
- Validation script catches any future `@stigmer/*` imports in engine/shells
