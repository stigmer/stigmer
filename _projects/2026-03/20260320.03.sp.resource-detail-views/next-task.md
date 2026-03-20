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
**Current Task**: T01 — All phases complete
**Status**: Complete

## Session Progress (2026-03-20, Session 3 — Round 2)

### Completed This Session (Round 2 — SkillDetailView + McpServerDetailView)

- **Shared markdown extraction** — `MARKDOWN_COMPONENTS` + `REMARK_PLUGINS` extracted from `MessageEntry.tsx` to `sdk/react/src/internal/markdown-components.tsx`. Both `MessageEntry` and `SkillDetailView` import from the shared module. Internal only — not part of public barrel exports.
- **T01.5 `SkillDetailView`** — SDK component in `sdk/react/src/skill/SkillDetailView.tsx`
  - 3 sections: Header (name, tag badge, state badge, visibility, timestamps, description), Skill Content (SKILL.md rendered via `react-markdown`), Version Info (truncated hash with full on hover, git provenance with linkified repo URL)
  - State badge color mapping: Ready = emerald, Failed = destructive, Uploading = amber
  - Git provenance: normalizes SSH/HTTPS URLs, formats repo name, short commit hash, subdirectory display
  - `stgm-prose` finding: not defined in `@stigmer/theme` — styling handled entirely by `MARKDOWN_COMPONENTS` inline overrides (no CSS class needed)
- **T01.6 `McpServerDetailView`** — SDK component in `sdk/react/src/mcp-server/McpServerDetailView.tsx`
  - 7 sections: Validation Banner (conditional, destructive alert), Header (icon/name, validation badge, last discovered timestamp), Server Configuration (stdio/http type-specific), Discovered Tools (name + description, count in title), Resource Templates (name + URI template + description), Environment Variables (alphabetical, secret/config badge), Tags (pill badges)
  - Headers/query params intentionally hidden from Server Configuration (may contain `${API_TOKEN}` placeholders)
  - Tool `input_schema` intentionally not shown (name + description sufficient for initial ship)
- **T01.8 Skill detail Console page** — `client-apps/web/src/app/library/skills/[slug]/page.tsx` + `SkillDetailPage.tsx`
- **T01.9 MCP Server detail Console page** — `client-apps/web/src/app/library/mcp-servers/[slug]/page.tsx` + `McpServerDetailPage.tsx`
- **T01.10 (complete) List wiring** — `SkillListPage.tsx` and `McpServerListPage.tsx` updated with `onItemClick` navigating to detail routes (changed from edit session to detail page)
- **T01.11 (complete) Barrel exports** — `SkillDetailView` + `SkillDetailViewProps` and `McpServerDetailView` + `McpServerDetailViewProps` exported from module barrels and root `index.ts`

### Previously Completed (Session 2 — Round 1)
- **T01.4 `AgentDetailView`** — 476 lines, 6 sections, cross-resource linking
- **T01.7 Agent detail Console page**
- **T01.10 (partial) Agent list wiring**
- **T01.11 (partial) Agent barrel exports**

### Previously Completed (Session 1)
- **Phase 1: SDK Data Hooks** — all 3 hooks (`useAgent`, `useSkill`, `useMcpServer`) implemented and exported
- **Plan reviewed and approved** — T01_0_plan.md with 4 phases

### Key Decisions This Session
- Extracted `MARKDOWN_COMPONENTS` to shared internal module rather than duplicating — DRY, same styling works for both chat messages and skill documents
- `stgm-prose` wrapper class in `MessageEntry.tsx` has no definition in `@stigmer/theme` — confirmed it's a no-op; all styling comes from `MARKDOWN_COMPONENTS` element overrides. Left as-is in `MessageEntry` (harmless), not used in `SkillDetailView`.
- Deferred `ResourceDetailHeader` extraction — overlap is ~70-75% (below 80% threshold). Type-specific badges create enough variation that a shared component would need render-prop slots, adding more complexity than the duplication it saves.
- List pages (`SkillListPage`, `McpServerListPage`) changed from navigating to edit sessions to navigating to detail pages — consistent with `AgentListPage` pattern
- Neither `SkillDetailView` nor `McpServerDetailView` needs cross-resource click callbacks (unlike `AgentDetailView`) — simpler props interface
- `T01.12 Breadcrumb polish` left as optional — slug is already human-readable in the breadcrumb

### Files Created This Session
- `sdk/react/src/internal/markdown-components.tsx` (shared markdown rendering)
- `sdk/react/src/skill/SkillDetailView.tsx` (SDK component)
- `sdk/react/src/mcp-server/McpServerDetailView.tsx` (SDK component)
- `client-apps/web/src/app/library/skills/[slug]/SkillDetailPage.tsx` (Console page)
- `client-apps/web/src/app/library/skills/[slug]/page.tsx` (Next.js route)
- `client-apps/web/src/app/library/mcp-servers/[slug]/McpServerDetailPage.tsx` (Console page)
- `client-apps/web/src/app/library/mcp-servers/[slug]/page.tsx` (Next.js route)

### Files Modified This Session
- `sdk/react/src/execution/MessageEntry.tsx` (extracted MARKDOWN_COMPONENTS to shared module)
- `sdk/react/src/skill/index.ts` (added SkillDetailView export)
- `sdk/react/src/mcp-server/index.ts` (added McpServerDetailView export)
- `sdk/react/src/index.ts` (added both to root barrel)
- `client-apps/web/src/app/library/skills/SkillListPage.tsx` (onItemClick → detail route)
- `client-apps/web/src/app/library/mcp-servers/McpServerListPage.tsx` (onItemClick → detail route)

## Remaining Work

- **T01.12 Breadcrumb polish** (optional) — display resource display name instead of raw slug. Deferred: slug is already human-readable.
- **Visual QA** — test all 3 detail views with real data in the Console
- **`stgm-prose` cleanup** — consider removing the unused class from `MessageEntry.tsx` or defining it in `@stigmer/theme`

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Visual QA" - Test detail views with real data

---

*This file provides portable paths to all project resources for quick context loading.*
