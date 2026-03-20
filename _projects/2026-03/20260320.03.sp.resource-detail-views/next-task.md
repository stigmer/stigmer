# Next Task: 20260320.03.sp.resource-detail-views

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260320.01.library-and-artifacts-flow
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260320.01.library-and-artifacts-flow
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/next-task.md`
**Spawned From Task**: Phase 5

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260320.03.sp.resource-detail-views

**Description**: Three resource detail view pages for the Library — Agent, Skill, and MCP Server — with single-resource data hooks in the SDK and structured read-only detail view components.
**Goal**: Implement read-only detail view pages for /library/agents/[slug], /library/skills/[slug], and /library/mcp-servers/[slug], including SDK data hooks (useAgent, useSkill, useMcpServer) and embeddable detail view components (AgentDetailView, SkillDetailView, McpServerDetailView) following the SDK-first architecture.
**Tech Stack**: TypeScript, React 19, Next.js, @stigmer/react, @stigmer/sdk, @stigmer/theme, TanStack Query, Tailwind CSS
**Components**: @stigmer/react (hooks + components), client-apps/web (routing, pages, sidebar), @stigmer/sdk (resource clients), @stigmer/theme (design tokens)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.03.sp.resource-detail-views/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-20 18:23
**Current Task**: T01 — Phase 2 (SDK Detail View Components)
**Status**: In Progress

## Session Progress (2026-03-20)

### Completed
- **Phase 1: SDK Data Hooks** — all 3 hooks implemented, exported, zero linter errors
  - `useAgent(org, slug)` → `sdk/react/src/agent/useAgent.ts`
  - `useSkill(org, slug, version?)` → `sdk/react/src/skill/useSkill.ts`
  - `useMcpServer(org, slug)` → `sdk/react/src/mcp-server/useMcpServer.ts`
  - Barrel exports updated in `agent/index.ts`, `skill/index.ts`, `mcp-server/index.ts`, `index.ts`
- **Plan reviewed and approved** — T01_0_plan.md covers all 4 phases (hooks, components, pages, exports)

### Key Decisions
- All hooks follow the `useDefaultAgent`/`useAgentInstance` pattern (`useState` + `useEffect` + `fetchKey` refetch)
- 404 (NOT_FOUND) is mapped to `null` resource without error via `isNotFound()` from `@stigmer/sdk`
- State machine: `isLoading` → fetching; `resource !== null` → found; `resource === null && !isLoading && !error` → not found
- `useSkill` accepts optional `version` parameter (tag or hash) in addition to `org`/`slug`

### Files Modified
- `sdk/react/src/agent/useAgent.ts` (new)
- `sdk/react/src/skill/useSkill.ts` (new)
- `sdk/react/src/mcp-server/useMcpServer.ts` (new)
- `sdk/react/src/agent/index.ts` (modified)
- `sdk/react/src/skill/index.ts` (modified)
- `sdk/react/src/mcp-server/index.ts` (modified)
- `sdk/react/src/index.ts` (modified)

## Next Steps

1. **Phase 2: SDK Detail View Components** — `AgentDetailView`, `SkillDetailView`, `McpServerDetailView`
   - Start with `AgentDetailView` (most complex — establishes the pattern)
   - Need to examine Agent proto spec/status shapes before implementing
   - Need to decide on markdown renderer for `SkillDetailView` (check existing deps)
2. **Phase 3: Console Pages + Wiring** — detail route pages + `onItemClick` on list pages
3. **Phase 4: Exports + Polish** — barrel exports + breadcrumb resource name

## Context for Resume

- The plan is in `tasks/T01_0_plan.md` — has full design mockups for all 3 detail views
- Open question from plan: markdown renderer choice for SKILL.md content (evaluate during T01.5)
- Open question from plan: tool input schema display for MCP Server tools (name+desc first, schema later)
- Parent project design decisions folder has 5 decisions — review for inherited patterns

## Quick Commands

After loading context:
- "Continue with Phase 2" - Start the detail view components
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
