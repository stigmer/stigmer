# Notes: 20260402.01.skill-creation-demo-component

**Created**: 2026-04-02

## Context

This project was spawned from Session 3 of the Getting Started docs revision
(`_projects/2026-04/20260401.02.sp.getting-started-revision/`). The current
`DemoSkillCreation` component in `first-skill.mdx` only shows a static
`MessageThread` conversation. The goal is to replace it with a rich guided-tour
that simulates the full Stigmer web app navigation flow.

## Desired User Experience (from developer)

The component should show the complete journey a user takes in the web app:

1. **Sidebar visible** — the web app layout with the left nav menu
2. **Click Library** — highlight or animate clicking "Library" in the sidebar
3. **Skills list view** — show the Skills page with existing skills listed
4. **Click Create Skill** — the "Create Skill" button is clicked
5. **Session Composer opens** — redirected to the Session Composer with the
   "Skill Creator" agent pre-selected
6. **User types message** — "I want to create a skill for our customer return
   policy."
7. **Conversation plays out** — the Skill Creator asks questions, user responds,
   skill is generated (existing `skillCreationExecution` scenario data)

## Key Resources

### Existing components to build on
- `ScenarioPlayer` (`site/src/components/docs/demos/ScenarioPlayer.tsx`) —
  timed step engine with viewport-triggered play. Each step renders via a
  children render prop. Can be reused to orchestrate the multi-view transitions.
- `DemoSkillCreation` (`site/src/components/docs/demos/DemoSkillCreation.tsx`) —
  current static component. Uses `MessageThread` with fixture data from
  `skillCreationScenario`.
- Scenario data (`site/src/components/docs/demos/scenarios/skill-creation.ts`) —
  has the full conversation, SKILL.md content, agent/session fixtures.

### Web app components for visual reference
- The actual Stigmer web app (`@stigmer/react`) has the real sidebar, session
  composer, and skill views. Check `sdk/react/src/` for the real component
  structure if pixel-accurate fidelity is needed.

### Documentation page
- `docs/getting-started/first-skill.mdx` — the page where the new component
  will be embedded, replacing `<DemoSkillCreation />`.

## Design Decisions (Resolved)

1. **Fidelity level** — Representative / schematic. Clean, stylized illustration
   that communicates the navigation flow without replicating the real console.
   Matches the docs theme. Low maintenance.

2. **Cursor animations** — No. Using highlight/pulse effects instead. Simpler,
   more accessible, works with `prefers-reduced-motion`.

3. **ScenarioPlayer reuse** — Yes. `ScenarioPlayer<GuidedTourStep>` with a
   discriminated union data model. The render prop switches on `step.view` to
   render the appropriate sub-component inside `DemoAppShell`.

4. **Duplicate message bug** — Fixed in `skill-creation-tour.ts` using the same
   `snapshot()` pattern from `quickstart-playback.ts`.

5. **Placement** — All new components are docs-only (`site/src/components/docs/demos/`).
   The conversation portion reuses real `@stigmer/react` components (`MessageThread`)
   per the embedded component standard. No new SDK components needed.

## Architecture

### Data model — `GuidedTourStep` discriminated union

```typescript
type GuidedTourStep =
  | { view: "library-click"; activeNav: "library" }
  | { view: "skills-list" }
  | { view: "create-skill-click" }
  | { view: "composer-ready"; agentName: string }
  | { view: "conversation"; execution: AgentExecution };
```

### Step sequence (8 steps)

| # | View                 | Delay  | What the reader sees                                    |
|---|----------------------|--------|---------------------------------------------------------|
| 1 | `library-click`      | 0ms    | App shell appears; "Library" nav item pulses            |
| 2 | `skills-list`        | 1500ms | Content area shows skills list with existing skills     |
| 3 | `create-skill-click` | 2000ms | "Create Skill" button pulses                            |
| 4 | `composer-ready`     | 1500ms | Session composer; "Skill Creator" agent shown           |
| 5 | `conversation`       | 2000ms | User message: "I want to create a skill..."             |
| 6 | `conversation`       | 2000ms | AI responds with questions                              |
| 7 | `conversation`       | 2500ms | User provides policy details                            |
| 8 | `conversation`       | 2000ms | AI confirms skill creation with summary                 |

### Component hierarchy

```
DemoSkillCreationTour (top-level, exported from barrel)
  └─ ScenarioPlayer<GuidedTourStep>
       └─ render prop: switch on step.view
            └─ DemoAppShell (sidebar + content wrapper)
                 ├─ Sidebar (inline, nav items with highlight)
                 ├─ SkillsListView (mock skill cards + Create button)
                 └─ ComposerView (agent header + MessageThread)
```

### File structure

```
demos/
  DemoSkillCreationTour.tsx    (new — top-level component)
  DemoAppShell.tsx             (new — shell layout + sidebar)
  SkillsListView.tsx           (new — mock skills list)
  ComposerView.tsx             (new — agent header + MessageThread)
  scenarios/
    skill-creation-tour.ts     (new — step definitions + snapshot helper)
    skill-creation.ts          (existing — scenario fixtures, keep for data)
  DemoSkillCreation.tsx        (existing — replaced, remove later)
  ScenarioPlayer.tsx           (existing — reused as-is)
```

## Related

- Parent project: `_projects/2026-04/20260401.02.sp.getting-started-revision/`
- ScenarioPlayer design doc:
  `_projects/2026-04/20260401.02.sp.getting-started-revision/design-decisions/scenario-player.md`
- Architecture plan: `.cursor/plans/skill_creation_guided_tour_dfdca60b.plan.md`
