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
**Current Task**: T01 — Phase 2, Round 2 (SkillDetailView + McpServerDetailView)
**Status**: In Progress

## Session Progress (2026-03-20, Session 2)

### Completed This Session (Round 1 — AgentDetailView vertical slice)
- **T01.4 `AgentDetailView`** — Full SDK component in `sdk/react/src/agent/AgentDetailView.tsx` (476 lines)
  - 6 sections: Header, Instructions (collapsible), MCP Server Usages (cross-linked), Skills (cross-linked), Sub-Agents (expandable with nested details), Environment Variables
  - Empty-section omission — sections with no data are not rendered
  - Loading skeleton, error state (via `ErrorMessage`), not-found state
  - Cross-resource linking via `onMcpServerClick` / `onSkillClick` callback props (routing-agnostic)
  - Same-org references show slug only; cross-org references show `org/slug` (smart label display)
  - Sub-agent details: expandable with border-left indent, shows instructions, MCP access, skills, model override
  - Zero Console dependencies, fully themed via `--stgm-*` tokens, inline SVG icons
- **T01.7 Agent detail Console page** — `client-apps/web/src/app/library/agents/[slug]/page.tsx` + `AgentDetailPage.tsx`
  - Thin client wrapper: `useParams` for slug, `useActiveOrgSlug` for org, `useRouter` for navigation callbacks
  - `generateStaticParams` placeholder for static export compatibility
- **T01.10 (partial) Agent list wiring** — Added `onItemClick` to `AgentListPage.tsx`
  - `onItemClick={(item) => router.push(`/library/agents/${item.slug}`)}`
- **T01.11 (partial) Barrel exports** — `AgentDetailView` + `AgentDetailViewProps` exported from `agent/index.ts` and root `index.ts`

### Previously Completed (Session 1)
- **Phase 1: SDK Data Hooks** — all 3 hooks (`useAgent`, `useSkill`, `useMcpServer`) implemented and exported
- **Plan reviewed and approved** — T01_0_plan.md with 4 phases

### Key Decisions This Session
- Decided on 2-round approach: Agent first (establishes patterns), then Skill + McpServer together
- No shared `ResourceDetailHeader` extraction yet — will evaluate when building Skill + McpServer views (>80% overlap threshold)
- Instructions collapsible uses line-count approach: split by `\n`, show first 8 lines, "Show more" button
- Sub-agent expansion via `useState<Set<number>>` with `aria-expanded`, border-left indentation for nesting
- Cross-resource link org fallback: when `ref.org` is empty, uses the agent's own org as fallback for click handler
- Removed `onSubAgentMcpServerClick` from plan — sub-agent MCP access is informational (slug-only reference back to parent), not navigational
- Section wrapper: `<section>` with uppercase tracking title + bordered rounded card container with `overflow-hidden`
- Env spec entries sorted alphabetically, show "secret" or "config" badge

### Files Modified This Session
- `sdk/react/src/agent/AgentDetailView.tsx` (new — 476 lines)
- `client-apps/web/src/app/library/agents/[slug]/page.tsx` (new)
- `client-apps/web/src/app/library/agents/[slug]/AgentDetailPage.tsx` (new)
- `client-apps/web/src/app/library/agents/AgentListPage.tsx` (modified — added onItemClick + useRouter)
- `sdk/react/src/agent/index.ts` (modified — added AgentDetailView export)
- `sdk/react/src/index.ts` (modified — added AgentDetailView to root barrel)

## Next Steps (Round 2)

1. **T01.5 `SkillDetailView`** — Header + Skill Content (rendered markdown via `react-markdown` + `remark-gfm`, already dependencies) + Version Info (hash + git provenance)
   - Check if `stgm-prose` markdown styles exist in `@stigmer/theme` or need to be defined
   - Reference existing `MessageEntry.tsx` markdown rendering pattern (uses `MARKDOWN_COMPONENTS` + `stgm-prose` wrapper)
2. **T01.6 `McpServerDetailView`** — Header + Validation banner (INVALID state) + Server Config (stdio vs HTTP conditional) + Discovered Tools list + Resource Templates (if present) + Env Spec + Tags (pill badges)
3. **T01.8 Skill detail Console page** + **T01.9 MCP Server detail Console page**
4. **T01.10 (remaining) Wire Skill + MCP Server list pages** with `onItemClick`
5. **T01.11 (remaining) Barrel exports** for SkillDetailView + McpServerDetailView
6. **T01.12 Breadcrumb polish** (optional — slug is already human-readable)
7. Evaluate shared `ResourceDetailHeader` extraction based on Round 1 evidence

## Context for Resume

- `AgentDetailView` establishes patterns: Section wrapper, Header layout, loading/error/not-found states, cross-linking callbacks, empty-section omission, icon reuse, env spec table
- `react-markdown` v10.1.0 is already in `sdk/react/package.json` — used in `MessageEntry.tsx` with `remarkGfm` and custom `MARKDOWN_COMPONENTS`
- The `stgm-prose` CSS class used in `MessageEntry.tsx` needs verification — may not be defined in `@stigmer/theme` (could be a placeholder or app-provided class)
- Skill proto: `SkillSpec` has `skillMd`, `tag`, `name`, `description`; `SkillStatus` has `state` (enum: UPLOADING/READY/FAILED), `versionHash`, `gitProvenance` (remoteUrl, ref, commit, subdir)
- McpServer proto: `McpServerSpec` has `serverType` (oneof: stdio with command/args/workingDir, http with url/headers/queryParams/timeout), `envSpec`, `tags`, `defaultEnabledTools`; `McpServerStatus` has `validationState` (enum: VALID/INVALID), `validationMessage`, `discoveredCapabilities` (tools array with name/desc/inputSchema, resourceTemplates, lastDiscoveredAt)

## Quick Commands

After loading context:
- "Continue with Round 2" - Build SkillDetailView + McpServerDetailView
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review AgentDetailView patterns" - Check established patterns before building Skill + McpServer

---

*This file provides portable paths to all project resources for quick context loading.*
