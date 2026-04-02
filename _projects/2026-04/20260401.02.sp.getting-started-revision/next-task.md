# Next Task: 20260401.02.sp.getting-started-revision

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260331.01.content-strategy
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260331.01.content-strategy
**Parent Next Task**: `_projects/2026-03/20260331.01.content-strategy/next-task.md`
**Spawned From Task**: T01 Phase 3

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `_projects/2026-03/20260331.01.content-strategy/design-decisions/`
- Parent Coding Guidelines: `_projects/2026-03/20260331.01.content-strategy/coding-guidelines/`
- Parent Wrong Assumptions: `_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/`
- Parent Don't Dos: `_projects/2026-03/20260331.01.content-strategy/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260401.02.sp.getting-started-revision

**Description**: Revise the Getting Started documentation to tell a connected, progressive story. Rewrite Cloud Quickstart (sign up, SDK, implicit assistant agent), Your First Skill (domain knowledge before/after), Local Quickstart (alternative entry), and docs homepage. Build a ScenarioPlayer component for animated playback of real @stigmer/react components in docs. Update the document writer role with narrative continuity, aha-moment design, and progressive disclosure principles.
**Goal**: Deliver a cohesive Getting Started experience where each page builds on the previous one, embedded components replay the real product UI like a GIF, and the document writer role codifies the quality principles so future documentation maintains the same standard.
**Tech Stack**: Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)
**Components**: site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/README.md`
- **Parent README**: `_projects/2026-03/20260331.01.content-strategy/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
_projects/2026-03/20260331.01.content-strategy/design-decisions/
_projects/2026-03/20260331.01.content-strategy/coding-guidelines/
_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/
_projects/2026-03/20260331.01.content-strategy/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-01 18:00
**Current Task**: T01 (Getting Started Documentation Revision)
**Status**: Session 3 complete — Getting Started arc functionally done

## Session Progress

### Session 0 (2026-04-01) — Planning

- Analyzed all three existing Getting Started pages and identified structural problems
- Identified key design insight: seedpack `assistant` agent is the implicit default — Cloud Quickstart does not require agent creation
- Agreed no separate "Your First Agent" page — the implicit assistant handles the initial experience
- Decided on ScenarioPlayer approach for animated component playback (prototype first, then full build)
- Confirmed no off-the-shelf library exists for scenario replay; custom wrapper (~100-150 lines) + framer-motion for animations
- Planned 4 sessions: governance → prototype → quickstart+homepage → skill+local
- Created detailed T01_0_plan.md — awaiting review

### Session 1 (2026-04-01) — Governance and Strategy

- **1A: Document writer role updated** (`_roles/002_document_writer.md`)
  - Added "Tutorial and learning path standards" section with 6 principles: narrative continuity, aha-moment design, progressive concept introduction, implicit defaults, embedded component standards, page bridging pattern
  - Added "Structural path decisions" sub-section referencing the IA for path ordering (replaced duplicating cloud-primary principle)
  - Section named broadly ("Tutorial and learning path") to cover all sequential content, not just Getting Started
- **1B: Information architecture revised** (3 targeted edits)
  - Site map table: Cloud Quickstart description now says "create session, send message" instead of "first agent" and notes implicit assistant agent
  - Getting Started detail: quickstart.mdx description clarified — no agent creation, skill creation deferred to first-skill.mdx
  - Learning paths: added path quality requirement (every page must bridge to the next with a functional gap)
- **1C: ScenarioPlayer design decision documented**
  - Created `design-decisions/scenario-player.md` in sub-project
  - Documents problem, approach, technical sketch, dependencies, rejected alternatives, risks, and prototype-first strategy
  - Grounded in existing demo infrastructure (`DemoTransport`, `createDemoClient`, `DemoSkillCreation` pattern)
- **1D: Docs sidebar fixed**
  - Removed Use Cases and GitHub links from `layout.shared.tsx` `baseOptions()`
  - These marketing links only appeared in the docs chrome (Fumadocs DocsLayout), not the marketing site (which uses its own Header/Footer)
- **Verification**: `tsc --noEmit` passes, `yarn build` passes (13 static pages, zero errors)

### Session 2 (2026-04-02) — ScenarioPlayer Prototype

- **2A: ScenarioPlayer generic engine** (`site/src/components/docs/demos/ScenarioPlayer.tsx`)
  - Generic `ScenarioPlayer<T>` with `children` render prop (~50 lines)
  - Viewport-triggered auto-play via Intersection Observer
  - Progress dots + replay button
  - `useReducedMotion` support (skips to final state)
  - Exports `ScenarioStep<T>` type for scenario data
- **2B: Quickstart playback scenario** (`scenarios/quickstart-playback.ts`)
  - 4-step timeline: 2 user messages, 2 generic AI responses
  - Uses `samples.agentExecution` / `humanMessage` / `aiMessage` from demo infrastructure
  - Delays: 0 → 2000 → 2500 → 2000 ms
- **2C: DemoQuickstartPlayback wrapper** (`DemoQuickstartPlayback.tsx`)
  - MDX-facing component wrapping ScenarioPlayer in StigmerProvider + MessageThread
  - Empty DemoScenario (no fixtures needed — MessageThread is pure)
- **2D: MDX wiring** — exported, registered in `getMDXComponents()`, embedded in quickstart.mdx
- **2E: Design decision updated** — revised to reflect two-layer architecture, MessageThread-is-pure discovery, and state-driven approach
- **Architectural discovery**: `MessageThread` is pure (takes `executions` props, no `useStigmer()` calls). Transport/fixture manipulation unnecessary — state-driven snapshots are simpler.
- **Verification**: `tsc --noEmit` passes, `yarn build` passes (zero errors)

### Session 3 (2026-04-02) — Quickstart + Homepage + Guided Tour

- **3A: Quickstart rewrite** — pure cloud, multi-language (TS/Go/Python/Java), incremental code, file continuity cues, "View complete file" accordion, two-question narrative bridging to Your first Skill
- **3B: ScenarioPlayer UX** — play-once-and-hold, reset on scroll-out, no replay button, duplicate message fix
- **3C: Navigation cleanup** — removed "local" from meta.json, merged "Next step" into "What just happened"
- **3D: Your first Skill rewrite** — pure cloud, skill creation via web app, SDK testing with skillRefs
- **3E: Skill creation demo** (quick project 20260402.01) — three-tier demo architecture (engine/views/scenarios), DemoSkillCreationTour guided tour with animated cursor, AppShell/ComposerView/WidgetsSidebar
- **3F: Docs homepage rewrite** — "Get started" (linked) + "Coming soon" (inert) sections, eliminated 3 dead links
- **Verification**: `tsc --noEmit` passes, Vale zero warnings

## Key Decisions Made

1. **Cloud Quickstart scope**: Sign up → API key → SDK → session → message → response. No skill creation. Implicit assistant agent.
2. **No "First Agent" page**: The reader already has an agent (the assistant). Custom agents come later.
3. **ScenarioPlayer**: Experimental. Prototype first (Session 2), feedback, then full build (Sessions 3-4).
4. **Document writer role update**: 6 principles + IA reference for path structure (cloud-primary principle not duplicated — lives in IA only).
5. **Local Quickstart**: Alternative entry point (not step 2). After initial quickstart, both paths converge.
6. **Section naming**: "Tutorial and learning path standards" (broader than "Getting Started and tutorial standards") to govern all sequential content.
7. **ScenarioPlayer is generic**: Two-layer architecture — generic engine (`ScenarioPlayer<T>`) + scenario-specific wrappers (`DemoQuickstartPlayback`). Engine knows nothing about Stigmer components.
8. **State-driven playback**: `MessageThread` is pure (no `useStigmer()`). Playback via progressive execution snapshots, not transport/fixture manipulation.
9. **Natural message appearance**: No per-message enter animations in prototype. Matches real product behavior. Per-message animations deferred pending feedback.

## Context for Resume

- Parent Phase 3 deliverables exist: `quickstart.mdx`, `local.mdx`, `first-skill.mdx` with `DemoSkillCreation` component
- React demo mode infrastructure (`@stigmer/react/demo`) provides `createDemoClient`, `buildScenario`, `fixtures`, `samples`
- **ScenarioPlayer prototype is live**: `DemoQuickstartPlayback` embedded in `quickstart.mdx` (temporary section)
- **ScenarioPlayer<T> is generic**: render prop API, viewport auto-play, progress dots, replay. Future wrappers for skill/tool/approval scenarios reuse the same engine.
- `MessageThread` is a pure component — takes `executions` props, no `useStigmer()` hook calls. State-driven playback works without fixtures.
- Seedpack assistant agent: `seedpack/agents/assistant.yaml` (label `stigmer.ai/default-agent: "true"`)
- SDK exports ~50+ React components including `MessageThread`, `ArtifactCard`, `ArtifactContentRenderer`, `ApprovalCard`, `ToolCallDetail`, `SessionComposer`
- **Session 3 delivered**: Quickstart rewrite (multi-language, incremental code, play-once ScenarioPlayer), Your first Skill rewrite (cloud flow, DemoSkillCreationTour guided tour), Docs homepage rewrite (active + coming-soon cards). See checkpoint: `checkpoints/session-3-quickstart-homepage.md`
- **Remaining**: Local Quickstart (deferred), Coming-soon page content (Core Concepts, Tutorials, SDK Reference, CLI Reference)

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
