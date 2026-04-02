# Session 2: ScenarioPlayer Prototype

**Date**: April 2, 2026

## Summary

Built a generic `ScenarioPlayer<T>` playback engine and a quickstart-specific
wrapper that auto-plays timed message sequences through real `@stigmer/react`
components. The prototype is embedded in the Cloud Quickstart page for visual
evaluation of timing, rhythm, and overall feel before investing in animation
polish or additional scenarios.

## Problem Statement

Session 1 established the principle that documentation demos should use animated
playback (ScenarioPlayer) rather than static final-state renders for multi-step
interactions. The reader should see messages appearing and responses arriving —
the way the real product behaves. The Session 1 design decision outlined a
transport-based approach (~100-150 lines) that manipulated `DemoTransport`
fixture registries at each step.

### Pain Points

- No animated playback existed — only static `DemoSkillCreation` showing
  a completed conversation
- The design decision assumed transport-level fixture swapping was necessary
- A single-purpose player would require reimplementation for each scenario type

## Solution

A two-layer architecture separating the playback engine from scenario-specific
rendering:

1. **`ScenarioPlayer<T>`** — Generic engine (~50 lines) managing step timing,
   viewport-triggered auto-play, progress indication, replay, and reduced-motion
   accessibility. Uses a `children` render prop so it knows nothing about what
   is being displayed.

2. **`DemoQuickstartPlayback`** — MDX-facing wrapper (~25 lines) providing
   `StigmerProvider` (CSS scoping) and `MessageThread` through the render prop.
   Future scenario wrappers reuse the same engine with different rendering logic.

## Implementation Details

### Architectural discoveries

- **MessageThread is pure**: Takes `executions` as props and does not call
  `useStigmer()`. Playback is driven entirely through React state (progressive
  execution snapshots), not transport/fixture manipulation. This simplified the
  implementation from ~150 lines to ~50.

- **Generic render prop pattern**: `ScenarioStep<T>` uses a type parameter so
  any data shape can drive any rendering. The quickstart uses
  `ScenarioStep<AgentExecution>` with `MessageThread`; a future skill scenario
  might use a compound type rendering `MessageThread` + `ArtifactCard`.

### New files

| File | Lines | Purpose |
|------|-------|---------|
| `site/src/components/docs/demos/ScenarioPlayer.tsx` | ~50 | Generic playback engine |
| `site/src/components/docs/demos/DemoQuickstartPlayback.tsx` | ~25 | Quickstart MDX wrapper |
| `site/src/components/docs/demos/scenarios/quickstart-playback.ts` | ~55 | 4-step timeline data |

### Modified files

| File | Change |
|------|--------|
| `site/src/components/docs/index.ts` | Added barrel export |
| `site/src/components/mdx.tsx` | Registered in MDX component map |
| `docs/getting-started/quickstart.mdx` | Temporary prototype section |
| `design-decisions/scenario-player.md` | Revised with Session 2 findings |
| `next-task.md` | Updated status and session progress |

### ScenarioPlayer engine features

- **Viewport auto-play**: Intersection Observer (30% threshold) triggers
  playback when the component scrolls into view
- **Step timing**: `setTimeout` chain advances through `ScenarioStep<T>[]`
- **Progress dots**: Visual indicator of playback position
- **Replay**: Button appears on completion, resets to step 0
- **Reduced motion**: `useReducedMotion` from framer-motion skips to final state
- **Layout-agnostic**: `className` prop lets wrappers control layout

### Quickstart scenario

Four steps showing a conversation with the implicit assistant agent:

| Step | Delay | Content |
|------|-------|---------|
| 0 | 0ms | User asks about return policy |
| 1 | 2s | AI gives generic answer (no domain knowledge) |
| 2 | 2.5s | User asks about return shipping |
| 3 | 2s | AI gives another generic answer |

The generic answers demonstrate the quickstart aha moment while setting up the
bridge to "Your First Skill" — the agent doesn't know the business yet.

## Benefits

- **Reusable engine**: Future scenarios (skill creation, tool calls, approvals)
  use the same `ScenarioPlayer<T>` with different wrappers
- **Minimal footprint**: ~50 lines for the engine, ~25 for each wrapper
- **No SDK changes**: `MessageThread` works as-is with state-driven snapshots
- **Accessible**: Respects `prefers-reduced-motion` system setting
- **Maintainable**: Scenario data uses typed `samples` helpers — proto shape
  changes cause compile errors, keeping fixtures in sync

## Impact

- Documentation: ScenarioPlayer prototype embedded in Cloud Quickstart page
- Developer experience: Foundation for animated demos across all tutorial pages
- Architecture: Design decision updated to reflect simplified state-driven approach

## Related Work

- Session 1 (governance): `2026-04-01-181630-session-1-governance-getting-started-revision.md`
- Phase 3 (static demos): `2026-04-01-171833-phase-3-getting-started-documentation.md`
- Demo infrastructure: `2026-04-01-164227-react-demo-mode-fumadocs-integration.md`

---

**Status**: Prototype — awaiting feedback on timing, rhythm, and animation needs
**Timeline**: Session 2 of 4 (Getting Started Revision sub-project)
