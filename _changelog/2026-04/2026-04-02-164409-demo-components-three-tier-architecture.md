# Demo Components: Three-Tier Architecture Reorganization

**Date**: April 2, 2026

## Summary

Reorganized the flat `demos/` directory into a three-tier architecture (`engine/`, `views/`, `scenarios/`) that communicates the system's layering through folder structure, eliminates duplicated code across 4 files, and establishes a clear "add a scenario = add a folder" pattern. Also removed 3 dead-code files and enhanced `ComposerView` to serve as the single reusable composer building block across all scenarios.

## Problem Statement

The documentation site's interactive demo system had 10 component files sitting flat in a single `demos/` directory with no naming convention or structure distinguishing generic playback machinery from Stigmer-specific UI panels from assembled scenarios. As new scenarios are added for different docs pages, this flat structure would become increasingly difficult to navigate and maintain.

### Pain Points

- No way to tell at a glance which files are reusable building blocks vs. page-level scenarios
- Duplicated utilities across files: `MOCK_WORKSPACE` (2 files), `snapshot()` (2 files), `DEMO_ORG` (2 files), `widgetsSidebar()` (2 files)
- `DemoQuickstartPlayback` reimplemented `SessionComposer` layout instead of reusing `ComposerView`
- 3 dead-code files with zero imports (`DemoSkillCreation.tsx`, `skill-creation.ts`, `quickstart.ts`)
- Inconsistent `Demo*` naming prefix used on both reusable components and scenario-specific components

## Solution

Introduced a three-tier directory structure where folder names communicate the architecture:

```
demos/
├── engine/        # Generic animation/playback (ScenarioPlayer, Cursor, shared.ts)
├── views/         # Stigmer UI panels (AppShell, ComposerView, WidgetsSidebar, SkillsListView)
└── scenarios/     # Per-scenario folders with index.tsx + steps.ts
    ├── quickstart-playback/
    ├── skill-creation-tour/
    └── session-composer/
```

Dependencies flow one way: `scenarios/` -> `views/` -> `engine/`. Engine components know nothing about Stigmer's UI. Views use `@stigmer/react` components. Scenarios assemble both into complete walkthroughs.

## Implementation Details

**Extracted utilities into `engine/shared.ts`:**
- `MOCK_WORKSPACE` — mock workspace entries for `SessionComposer`
- `DEMO_ORG` — demo organization slug constant
- `snapshot()` — builds `AgentExecution` fixtures with correct `spec.message` / `status.messages` split to avoid `MessageThread` duplication

**Enhanced `ComposerView` with new props:**
- `typingMessage?: string` — programmatically fills `SessionComposer` textarea (absorbed `TypingComposer` pattern)
- `placeholder?: string` — configurable placeholder text (defaults to "Describe your skill...")
- `agentRef?: { org: string; slug: string }` — optional agent reference chip

**Added `renderWidgetsSidebar()` helper to `views/WidgetsSidebar.tsx`:**
- Co-located convenience wrapper that creates a `WidgetsSidebar` with standard demo props for a single execution
- Eliminates the duplicated 3-line wrapper in both scenario components

**Per-scenario folders:**
- Each scenario is a self-contained folder with `index.tsx` (component) + optional `steps.ts` (step data)
- Barrel exports in `docs/index.ts` use aliasing to preserve MDX component names (`DemoQuickstartPlayback`, etc.)

## Benefits

- **292 fewer lines of code** (285 insertions vs. 577 deletions) through deduplication
- **Self-documenting structure**: a new engineer understands the architecture by browsing folders, not reading code
- **Clear "add a scenario" pattern**: create a folder in `scenarios/`, add `index.tsx`, import from `engine/` and `views/`
- **Preserved git history**: Git detected renames at 65-100% similarity, so `git log --follow` works
- **Zero MDX churn**: exported component names preserved via barrel export aliases

## Impact

- **Documentation maintainers**: clear structure for adding new interactive demos without overwhelming the codebase
- **Build**: zero impact — TypeScript compiles clean, no linter errors
- **Docs readers**: zero visual change — all demos render identically

## Related Work

- `feat(site): add ScenarioPlayer prototype for animated doc demos` — original creation of the playback engine
- `feat(site): add guided-tour demo for skill creation docs page` — the scenario that drove creation of most building blocks
- `feat(site): add visual storytelling to guided-tour demos` — cursor animations and slide transitions

---

**Status**: Production Ready
**Timeline**: Single session
