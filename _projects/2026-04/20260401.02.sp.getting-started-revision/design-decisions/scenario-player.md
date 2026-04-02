# Design decision: ScenarioPlayer component

**Date**: 2026-04-01
**Status**: Prototype built (Session 2)
**Context**: 20260401.02.sp.getting-started-revision

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

A two-layer architecture: a generic `ScenarioPlayer<T>` playback engine
paired with scenario-specific wrapper components.

### Architecture (revised in Session 2)

```
ScenarioPlayer<T>              Generic playback engine
├── Manages: step timing, viewport auto-play, progress, replay
├── Accepts: steps[] + children render prop
├── Knows nothing about Stigmer components
└── Exports: ScenarioStep<T> type

DemoQuickstartPlayback          Scenario-specific wrapper (MDX-facing)
├── Provides: StigmerProvider (CSS scoping) + MessageThread
├── Imports: quickstart-playback steps
└── Passes render prop to ScenarioPlayer
```

### Key discovery: MessageThread is pure

Session 2 exploration revealed that `MessageThread` takes `executions` as
props and does not call `useStigmer()`. This means playback can be driven
entirely through React state — progressive execution snapshots passed as
props — without manipulating `DemoTransport` or the fixture layer.

The Session 1 design assumed transport-level fixture swapping. That approach
is unnecessary for `MessageThread` and would have coupled the engine to the
fixture system. The state-driven approach is simpler (~50 lines vs. ~150)
and keeps the engine generic.

`StigmerProvider` is still needed for CSS scoping (the `div.stgm` class),
but uses a minimal empty-scenario client with no fixture registrations.

### Why the engine is generic

The playback mechanics (timing, progress, replay) are identical regardless of
what is rendered. Future scenarios render different component trees:

- **Your First Skill**: `MessageThread` + `ArtifactCard`
- **Tools tutorial**: messages with `ToolCallGroup` expansions
- **Approval flow**: messages leading to `ApprovalCard`

Hardcoding `MessageThread` inside the engine would require a new player for
each scenario type. The `children` render prop avoids this — the engine
manages timing, the wrapper decides what to render.

### Animation approach (prototype)

New messages appear naturally — no per-message enter animations. This matches
the real product behavior (messages arrive and auto-scroll follows). The timed
delays between steps create the "thinking" rhythm that gives playback its
GIF-like quality.

Per-message enter animations (e.g., `AnimatePresence` on individual messages)
would require modifying `MessageThread` in the SDK — a production component
shared across the platform. This is deferred pending prototype feedback.

### Full build (Sessions 3-4, after feedback)

If the prototype feels right, the full build may introduce:

- Per-message enter animations (CSS or SDK-level, decided based on feedback)
- Artifact steps (skill cards, content previews)
- Streaming simulation (character-by-character text reveal)
- Pause-on-hover for readers who want to examine a step
- "Thinking" indicator via `activeStreamExecution` prop

## Location

- `site/src/components/docs/demos/ScenarioPlayer.tsx` — generic engine
- `site/src/components/docs/demos/DemoQuickstartPlayback.tsx` — quickstart wrapper
- `site/src/components/docs/demos/scenarios/quickstart-playback.ts` — step data

## Dependencies

- **`framer-motion`** — `useReducedMotion` hook for accessibility. Already a
  site dependency (`^12.31.1`). Not used for per-message animations in the
  prototype.
- **`lucide-react`** — `RotateCcw` icon for the replay button. Already a site
  dependency.
- **`@stigmer/react`** — `StigmerProvider`, `MessageThread` (rendered by
  the wrapper, not the engine).
- **`@stigmer/react/demo`** — `createDemoClient`, `samples` (used by the
  wrapper and scenario data, not the engine).

## What was considered and rejected

**Transport-based fixture swapping** (Session 1 approach): Manipulating
`DemoTransport` or recreating `createDemoClient` at each step. Rejected
because `MessageThread` is a pure component — state-driven props are simpler
and keep the engine decoupled from the fixture system.

**Off-the-shelf replay/animation libraries**: No library exists that replays
arbitrary React component trees with timed fixture data. The sequencing logic
is custom (~50 lines); no framework needed.

**Recorded video/GIF embeds**: Would show the real product but at the cost of
maintainability (re-record on every UI change), accessibility (no text
selection, no screen reader support), and bundle size. Real components stay
in sync with the product automatically.

**Static screenshots with captions**: The current approach. It communicates
information but not experience. Rejected as the default for multi-step
interactions; still acceptable for single-state illustrations.

**Per-message enter animations in prototype**: Would require modifying
`MessageThread` in the SDK (production component). Deferred — the natural
appearance with timed delays is sufficient for evaluating the concept.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Timing feels wrong (too fast, too slow, uncanny) | Prototype first. Get feedback before building scenarios for all pages. Delays are easily tuned in the scenario data. |
| Natural appearance (no enter animation) feels abrupt | Upgrade paths: CSS keyframe on last message, container-level framer-motion, or SDK-level AnimatePresence. Each is a separate, scoped decision. |
| Fixture data falls out of sync with real proto messages | Same risk as `DemoSkillCreation`. Mitigated by TypeScript — proto shape changes cause compile errors in scenario data. |
| ScenarioPlayer is over-engineered for simple demos | Keep `DemoSkillCreation`-style static components for single-state renders. ScenarioPlayer is for multi-step interactions only. |

## Strategy

Prototype first. The minimal version is built (Session 2) and embedded in the
Cloud Quickstart page for visual evaluation. Collect feedback on timing and
feel before investing in animation polish or additional scenarios.
