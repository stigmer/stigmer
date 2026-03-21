# Sub-Project: 20260320.03.sp.resource-detail-views

## Parent Project

- **Parent**: 20260320.01.library-and-artifacts-flow
- **Parent Path**: [../../20260320.01.library-and-artifacts-flow/](../../20260320.01.library-and-artifacts-flow/)
- **Spawned From Task**: Phase 5

---

## Overview
Three resource detail view pages for the Library — Agent, Skill, and MCP Server — with single-resource data hooks in the SDK and structured read-only detail view components.

**Created**: 2026-03-20
**Status**: Active

## Sub-Project Information

### Goal
Implement read-only detail view pages for /library/agents/[slug], /library/skills/[slug], and /library/mcp-servers/[slug], including SDK data hooks (useAgent, useSkill, useMcpServer) and embeddable detail view components (AgentDetailView, SkillDetailView, McpServerDetailView) following the SDK-first architecture.

### Technology Stack
TypeScript, React 19, Next.js, @stigmer/react, @stigmer/sdk, @stigmer/theme, TanStack Query, Tailwind CSS

### Project Type
Feature Development

### Affected Components
@stigmer/react (hooks + components), client-apps/web (routing, pages, sidebar), @stigmer/sdk (resource clients), @stigmer/theme (design tokens)

### Additional Context
Phase 5 from the parent plan covers Resource Detail View. This sub-project scopes to the read-only structured detail views only — YAML toggle, version history, edit flow, and dependency graph visualization are explicitly out of scope. The list pages, list hooks, breadcrumb, and ResourceListView (with onItemClick prop) already exist. The TypeScript SDK already has typed get/getByReference methods for all three resource types.

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
- [Parent Project](../../20260320.01.library-and-artifacts-flow/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
