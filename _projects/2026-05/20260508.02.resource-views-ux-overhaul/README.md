# Project: 20260508.02.resource-views-ux-overhaul

## Overview
Transform Stigmer's resource management screens from basic read-only views into state-of-the-art operational hubs. Covers all resource types: Agents, Skills, MCP Servers, Runners, and Settings — with rich list workbenches, tabbed detail pages, manual+AI creation flows, version history, and cross-cutting UX improvements like command palette, keyboard shortcuts, and improved empty states.

**Created**: 2026-05-08
**Status**: Active 🟢

## Project Information

### Primary Goal
Redesign and rebuild all resource management screens in @stigmer/react SDK and the Console to match the quality of best-in-class developer platforms (Vercel, Linear, Supabase, Stripe). Replace the current read-only library views and flat detail pages with a Resource Workbench pattern (table/card/list views, filters, sort, bulk actions, split inspector), tabbed operational detail hubs, dual-path creation (manual forms + AI sidecar), and foundational UX primitives (command palette, action menus, version timelines, dependency graphs).

### Timeline
**Target Completion**: No specific deadline — phased delivery over 5 phases. Quality over speed. Each phase buildable in multiple sessions.

### Technology Stack
TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, Tailwind CSS v4, @connectrpc/connect (gRPC), @bufbuild/protobuf, TanStack Table, TanStack Virtual, Radix/React Aria, cmdk, CodeMirror 6, Sonner

### Project Type
Refactoring

### Affected Components
sdk/react (ResourceListView, AgentDetailView, SkillDetailView, McpServerDetailView, RunnerListPanel, all settings sections, library components), client-apps/web (library pages, settings pages, runners page, app shell, sidebar), sdk/theme (design tokens, status tokens)

## Project Context

### Dependencies
Deep research report completed at _projects/2026-05/research.resource-views-ux-overhaul/04.report.gpt.md. @stigmer/react already has React 19, react-markdown, @stigmer/theme. New deps to evaluate and adopt: TanStack Table, TanStack Virtual, Radix or React Aria, cmdk, CodeMirror 6. Backend API additions needed for version history, audit logs, usage stats, and richer list metadata.

### Success Criteria
- 1) Resource lists support table/card/list views with filtering sorting and bulk actions
- 2) Detail pages are tabbed operational hubs with inline editing and global actions
- 3) Manual creation forms exist alongside AI-driven flows for all resource types
- 4) Command palette (Cmd+K) works across all resources
- 5) Empty states are contextual with onboarding CTAs
- 6) All new components are accessible (WCAG 2.2 compatible)
- 7) SDK components remain embeddable and themeable via --stgm-* tokens

### Known Risks & Mitigations
1) Scope is very large — must be strictly phased to avoid feature creep. 2) SDK backward compatibility — public API surface changes must be non-breaking. 3) TanStack Table and other new deps increase bundle size — must stay under 15KB gzipped incremental. 4) Headless+styled SDK architecture is a significant refactor of existing component patterns. 5) Backend API additions for version history and audit logs require stigmer-cloud coordination.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Deep research completed (research.resource-views-ux-overhaul/04.report.gpt.md)
- [ ] Phase 0: UX foundations (status tokens, empty states, action menus, feedback)
- [ ] Phase 1: Resource Workbench (table/list/card views, filters, sort, bulk actions)
- [ ] Phase 2: Detail page hubs (tabbed agents, skill editor, MCP tools, runner page)
- [ ] Phase 3: Creation/edit modernization (manual wizards, AI sidecar, import/export)
- [ ] Phase 4: Versioning, graphs, governance (timeline, diff, dependency graph, audit)
- [ ] Phase 5: Power-user polish (Cmd+K, keyboard shortcuts, saved filters, real-time)

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Research Foundation

This project is grounded in a comprehensive deep research report:
- **Research folder**: `_projects/2026-05/research.resource-views-ux-overhaul/`
- **Research prompt**: `01.prompt.md` (8 research parts, 25 benchmark targets, 15 key questions)
- **ChatGPT Deep Research report**: `04.report.gpt.md` (1312 lines, 51 cited sources)
- **Key references**: Cloudscape resource patterns, Vercel, Linear, Stripe, GitHub, Anthropic Console, LangSmith, W&B

## Notes

_Add any additional notes, links, or context here as the project evolves._