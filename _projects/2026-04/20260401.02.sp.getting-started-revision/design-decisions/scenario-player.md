# Design decision: ScenarioPlayer component

**Date**: 2026-04-01
**Status**: Approved (prototype-first)
**Context**: 20260401.02.sp.getting-started-revision, Session 1

## Problem

The current documentation embeds demo components that render the final state of
a conversation. `DemoSkillCreation` shows a completed `MessageThread` — all
messages visible, all artifacts resolved. The reader sees the destination but
not the journey.

This undermines the tutorial experience. When a quickstart page says "here's
what that conversation looks like," the reader should see messages appearing,
a pause while the agent thinks, and a response arriving — the way the real
product behaves. A static final-state render communicates information; an
animated playback communicates *experience*.

## Chosen approach

A `ScenarioPlayer` React component that delivers fixture data to real
`@stigmer/react` components in timed steps, with CSS transition animations.

### How it works

```
ScenarioPlayer
├── Accepts: DemoScenario + steps[] timeline
├── Each step: { fixtureUpdates, delayMs }
├── On mount: auto-plays through steps sequentially
├── At each step: updates the fixture store → real components re-render
├── Animations: framer-motion AnimatePresence (fade-in + slide-up)
└── Controls: progress indicator, replay button
```

The key insight is that `DemoTransport` receives a `FixtureRegistry` at
construction time. ScenarioPlayer extends this by managing a **stepped fixture
store** — a mutable registry that grows with each step. At step 0, only the
session exists. At step 1, the user message appears. At step 2, the assistant
response arrives. The real `MessageThread` component re-renders at each step
because the underlying data changed.

### Prototype approach (Session 2)

For the prototype, the simplest path is to recreate the demo client at each
step with an expanded fixture set. This avoids modifying `DemoTransport` and
keeps the prototype self-contained (~100-150 lines).

```
Step 0: empty thread
Step 1: user message appears (fade-in)
Step 2: pause (simulated thinking)
Step 3: assistant response appears (fade-in)
```

No artifacts in the prototype. Just enough to evaluate timing, transitions,
and the "GIF-like" feel in the real docs context (fonts, colors, spacing).

### Full build (Sessions 3-4, after feedback)

If the prototype feels right, the full build introduces:

- A `SteppedDemoTransport` that supports mutable fixtures (cleaner than
  recreating the client)
- Artifact steps (skill cards, content previews)
- Configurable timing per step
- Streaming simulation (character-by-character text reveal)
- Pause-on-hover for readers who want to examine a step

## Location

`site/src/components/docs/demos/ScenarioPlayer.tsx`

This follows the existing pattern — `DemoSkillCreation.tsx` lives in the same
directory with its scenario data in `scenarios/`.

## Dependencies

- **`framer-motion`** — animation transitions (AnimatePresence, motion
  components). Well-maintained, widely used, already common in Next.js
  projects. No alternative provides the same enter/exit animation
  coordination with React.
- **`@stigmer/react/demo`** — existing infrastructure: `createDemoClient`,
  `DemoTransport`, `buildScenario`, `fixtures`, `samples`.
- **`@stigmer/react`** — the real components: `StigmerProvider`,
  `MessageThread`, `ArtifactCard`, etc.

## What was considered and rejected

**Off-the-shelf replay/animation libraries**: No library exists that replays
arbitrary React component trees with timed fixture data. Libraries like
`react-player` or `lottie-react` handle video/animation playback, not
component-state sequencing. The sequencing logic is custom; the animation
layer uses a proven library (`framer-motion`).

**Recorded video/GIF embeds**: Would show the real product but at the cost of
maintainability (re-record on every UI change), accessibility (no text
selection, no screen reader support), and bundle size. Real components stay
in sync with the product automatically.

**Static screenshots with captions**: The current approach. It communicates
information but not experience. Rejected as the default for multi-step
interactions; still acceptable for single-state illustrations.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Animation timing feels wrong (too fast, too slow, uncanny) | Prototype first. Get feedback before building scenarios for all pages. |
| `framer-motion` adds bundle size to docs pages | Tree-shakeable; only the components used are bundled. Measure after prototype. |
| Fixture data falls out of sync with real proto messages | Same risk as existing `DemoSkillCreation`. Mitigated by TypeScript types — proto shape changes cause compile errors in fixtures. |
| ScenarioPlayer is over-engineered for simple demos | Keep `DemoSkillCreation`-style static components for single-state renders. ScenarioPlayer is for multi-step interactions only. |

## Strategy

Prototype first. Build the minimal version in Session 2, embed it in the
existing docs for visual evaluation, and collect feedback on timing and feel
before investing in the full build.
