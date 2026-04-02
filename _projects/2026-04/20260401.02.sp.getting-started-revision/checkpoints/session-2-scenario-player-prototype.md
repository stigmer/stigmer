# Checkpoint: Session 2 — ScenarioPlayer Prototype

**Date**: 2026-04-02
**Status**: Complete
**Next**: Session 3 (Cloud Quickstart + Docs Homepage rewrite)

## What was delivered

### 2A. ScenarioPlayer generic engine (`site/src/components/docs/demos/ScenarioPlayer.tsx`)

A generic `ScenarioPlayer<T>` component (~50 lines) that manages:

- **Step timing**: `setTimeout` chain advances through `ScenarioStep<T>[]`
- **Viewport auto-play**: Intersection Observer triggers playback when the
  component scrolls into view (threshold: 30%)
- **Progress indicator**: Row of dots showing playback position
- **Replay**: Button appears when playback completes, resets to step 0
- **Reduced motion**: `useReducedMotion` from framer-motion skips directly
  to the final step
- **Render prop**: `children(data: T, stepIndex: number)` — the engine knows
  nothing about what is being rendered

Exported types: `ScenarioStep<T>`, `ScenarioPlayerProps<T>`.

### 2B. Quickstart playback scenario (`site/src/components/docs/demos/scenarios/quickstart-playback.ts`)

A 4-step timeline showing a conversation with the implicit assistant agent:

| Step | Delay | Content |
|------|-------|---------|
| 0 | 0ms | User: "What is your return policy for defective items?" |
| 1 | 2000ms | AI: generic answer (no domain knowledge) |
| 2 | 2500ms | User: "Do you cover return shipping for defective items?" |
| 3 | 2000ms | AI: another generic answer |

Uses `samples.agentExecution` and `samples.humanMessage`/`samples.aiMessage`
from `@stigmer/react/demo`. Each step is a complete `AgentExecution` snapshot
with cumulative messages.

### 2C. DemoQuickstartPlayback wrapper (`site/src/components/docs/demos/DemoQuickstartPlayback.tsx`)

MDX-facing component (~25 lines) that:

- Wraps `ScenarioPlayer` in `StigmerProvider` (CSS scoping via `div.stgm`)
- Passes `MessageThread` via render prop
- Uses an empty `DemoScenario` — no fixture registrations needed because
  `MessageThread` is a pure component

### 2D. MDX wiring

- Exported from `site/src/components/docs/index.ts`
- Registered in `getMDXComponents()` in `site/src/components/mdx.tsx`
- Embedded in `docs/getting-started/quickstart.mdx` as a temporary
  "ScenarioPlayer prototype" section with a callout noting it will be
  removed in Session 3

### 2E. Design decision updated

`design-decisions/scenario-player.md` revised to reflect:

- Two-layer architecture (generic engine + scenario wrappers)
- MessageThread-is-pure discovery
- State-driven approach instead of transport manipulation
- Natural appearance instead of per-message animations (deferred)

## Architectural discoveries

1. **MessageThread is pure.** Takes `executions` as props, does not call
   `useStigmer()`. Playback is driven through React state — no
   `DemoTransport` or fixture layer involved.

2. **ScenarioPlayer should be generic.** Playback mechanics (timing,
   progress, replay) are identical regardless of rendered content. The
   `children` render prop separates the engine from scenario-specific
   rendering. Future wrappers (e.g., `DemoSkillPlayback`) use the same
   engine with different render logic.

3. **Natural appearance matches the product.** Messages appear without
   per-message enter animations, which is how the real product behaves
   when messages arrive. The timed delays between steps create the
   "thinking" rhythm.

## Verification

- `tsc --noEmit`: pass
- `yarn build`: pass (zero errors)
- No linter errors introduced

## Files created

| File | Purpose |
|------|---------|
| `site/src/components/docs/demos/ScenarioPlayer.tsx` | Generic playback engine |
| `site/src/components/docs/demos/DemoQuickstartPlayback.tsx` | Quickstart wrapper |
| `site/src/components/docs/demos/scenarios/quickstart-playback.ts` | Step timeline data |

## Files modified

| File | Change |
|------|--------|
| `site/src/components/docs/index.ts` | Added `DemoQuickstartPlayback` export |
| `site/src/components/mdx.tsx` | Registered `DemoQuickstartPlayback` in MDX components |
| `docs/getting-started/quickstart.mdx` | Added temporary prototype section |
| `design-decisions/scenario-player.md` | Revised to reflect Session 2 findings |

## Feedback needed before Session 3

1. **Timing**: Do the delays (0 / 2000 / 2500 / 2000 ms) feel natural?
   Too fast? Too slow?
2. **Natural appearance**: Does the instant message appearance feel right,
   or should we invest in enter animations (and at which layer)?
3. **Content**: Are the generic AI responses convincing for the quickstart
   demo? Do they set up the "Your First Skill" bridge effectively?
4. **Progress indicator**: Are the dots + replay sufficient, or should we
   add a play/pause toggle?
5. **Overall feel**: Does this approach ("GIF-like" playback of real
   components) feel like the right direction for documentation demos?

## Decisions deferred

- Per-message enter animations (CSS, container, or SDK level)
- Optimal timing values
- "Thinking" indicator via `activeStreamExecution`
- Pause-on-hover behavior
- Streaming simulation (character-by-character reveal)
- Artifact steps for future scenarios
