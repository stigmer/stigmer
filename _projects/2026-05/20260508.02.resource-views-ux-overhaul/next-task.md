# Next Task: 20260508.02.resource-views-ux-overhaul

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260508.02.resource-views-ux-overhaul

**Description**: Transform Stigmer's resource management screens from basic read-only views into state-of-the-art operational hubs. Covers all resource types: Agents, Skills, MCP Servers, Runners, and Settings — with rich list workbenches, tabbed detail pages, manual+AI creation flows, version history, and cross-cutting UX improvements like command palette, keyboard shortcuts, and improved empty states.
**Goal**: Redesign and rebuild all resource management screens in @stigmer/react SDK and the Console to match the quality of best-in-class developer platforms (Vercel, Linear, Supabase, Stripe). Replace the current read-only library views and flat detail pages with a Resource Workbench pattern (table/card/list views, filters, sort, bulk actions, split inspector), tabbed operational detail hubs, dual-path creation (manual forms + AI sidecar), and foundational UX primitives (command palette, action menus, version timelines, dependency graphs).
**Tech Stack**: TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, Tailwind CSS v4, @connectrpc/connect (gRPC), @bufbuild/protobuf, TanStack Table, TanStack Virtual, Radix/React Aria, cmdk, CodeMirror 6, Sonner
**Components**: sdk/react (ResourceListView, AgentDetailView, SkillDetailView, McpServerDetailView, RunnerListPanel, all settings sections, library components), client-apps/web (library pages, settings pages, runners page, app shell, sidebar), sdk/theme (design tokens, status tokens)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-09 — Phase 0 UX Foundations complete
- **Active Task**: Phase 0 complete. Next up: Phase 1 (Resource Workbench)

## Session Progress (2026-05-09)

- Completed full Phase 0 implementation (all 5 tasks)
- Added `--stgm-status-*` token namespace to `@stigmer/theme` (7 states × 3 variants × 2 modes)
- Created public `EmptyState` component with 4 semantic variants + `useEmptyState` behavior hook
- Created `StigmerToaster` + `toast` system in SDK wrapping Sonner (moved from Console)
- Created `ActionMenu` compound component for resource item actions
- Migrated Console list pages to use ActionMenu and improved empty state copy
- All typechecks and lint pass clean

## Key Decisions Made (This Session)

- **DD-P0-001**: Status tokens share hue from semantic tokens but are independently overridable
- **DD-P0-002**: EmptyState uses Lucide icons only, with `ReactNode` slot for future extensibility
- **DD-P0-003**: Sonner added as direct dependency to `@stigmer/react` (not peer)

## Next Steps

1. **Phase 1: Resource Workbench** — Build the `ResourceWorkbench` shell component (table/card/list views, URL filters, sort, saved preferences, selection, bulk actions, split inspector)
2. **StatusBadge component** — Now that tokens exist, build a `StatusBadge` styled component that uses them (Phase 1 prerequisite for rich table rows)
3. **Copy ID / Export JSON actions** — Wire trivial action implementations into the ActionMenu items
4. **Grid/list preference persistence** — localStorage or account-preference API for view mode

## Context for Resume

- Phase 0 plan is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T01_0_plan.md`
- Research report at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- The research report's Phase 1 roadmap (report line 1167) defines the ResourceWorkbench deliverables
- Existing `ResourceListView` in `sdk/react/src/library/` is the starting point — Phase 1 will either extend it or build a new higher-level `ResourceWorkbench` that composes it

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.02.resource-views-ux-overhaul/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 1: Resource Workbench

## Quick Commands

After loading context:
- "Continue with Phase 1" - Start the Resource Workbench implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
