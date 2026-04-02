# Sub-Project: 20260401.02.sp.getting-started-revision

## Parent Project

- **Parent**: 20260331.01.content-strategy
- **Parent Path**: [../../20260331.01.content-strategy/](../../20260331.01.content-strategy/)
- **Spawned From Task**: T01 Phase 3

---

## Overview
Revise the Getting Started documentation to tell a connected, progressive story. Rewrite Cloud Quickstart (sign up, SDK, implicit assistant agent), Your First Skill (domain knowledge before/after), Local Quickstart (alternative entry), and docs homepage. Build a ScenarioPlayer component for animated playback of real @stigmer/react components in docs. Update the document writer role with narrative continuity, aha-moment design, and progressive disclosure principles.

**Created**: 2026-04-01
**Status**: Active

## Sub-Project Information

### Goal
Deliver a cohesive Getting Started experience where each page builds on the previous one, embedded components replay the real product UI like a GIF, and the document writer role codifies the quality principles so future documentation maintains the same standard.

### Technology Stack
Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)

### Project Type
Feature Development

### Affected Components
site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

### Additional Context
Key insight: the seedpack assistant agent (stigmer.ai/default-agent) is used implicitly when no agent is specified. Cloud Quickstart does not require the reader to create an agent. ScenarioPlayer is experimental — prototype first, get feedback, then build full version.

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
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260331.01.content-strategy/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
