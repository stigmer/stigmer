# Sub-Project: 20260401.01.sp.react-demo-mode

## Parent Project

- **Parent**: 20260331.01.content-strategy
- **Parent Path**: [../../20260331.01.content-strategy/](../../20260331.01.content-strategy/)
- **Spawned From Task**: T01

---

## Overview
Build a demo/mock mode for @stigmer/react that allows components to render with realistic sample data without a live Stigmer backend, enabling real product components to be embedded in documentation.

**Created**: 2026-04-01
**Status**: Active

## Sub-Project Information

### Goal
Create a mock StigmerProvider with demo data fixtures covering the key components needed for the Phase 3 Cloud quickstart: SkillDetailView (skill creation flow), MessageThread + SessionComposer (chat conversation), ArtifactsWidget (artifacts panel with push/apply), and ResourceListView (library view).

### Technology Stack
Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)

### Project Type
Feature Development

### Affected Components
site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

### Additional Context
The @stigmer/react package (sdk/react/) exports embeddable components designed for platform builders. Components are themed via --stgm-* CSS tokens and scoped to .stgm container. Currently all components require StigmerProvider with a live Stigmer API client. No Storybook or mock system exists. The demo mode should provide a MockStigmerProvider (or similar) that supplies realistic fake data so components render in static contexts like MDX documentation pages. Key files: sdk/react/src/provider.tsx (StigmerProvider), sdk/react/src/context.ts (StigmerContext), sdk/react/src/hooks.ts (useStigmer).

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [x] Initial analysis complete
- [x] Phase 1: DemoTransport and client factory (complete)
- [ ] Phase 2: Fixture data for Cloud quickstart scenario
- [ ] Phase 3: Fumadocs integration
- [ ] Phase 4: Additional scenarios (stretch)
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260331.01.content-strategy/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
