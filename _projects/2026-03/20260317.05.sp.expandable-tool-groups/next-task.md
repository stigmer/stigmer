# Next Task: 20260317.05.sp.expandable-tool-groups

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260317.01.session-first-web-ux
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260317.01.session-first-web-ux
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`
**Spawned From Task**: T01.6

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260317.05.sp.expandable-tool-groups

**Description**: Make collapsed tool call summaries expandable to reveal individual tool calls with args, results, status, and timing. Add sub-agent sections as expandable nested threads. Two-level progressive disclosure: summary line -> list of tool calls -> individual call detail.
**Goal**: Users can inspect what tools did and see sub-agent activity by expanding collapsed tool groups in the conversation thread.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.05.sp.expandable-tool-groups/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 18:16
**Current Task**: T01 COMPLETE — All 6 steps delivered
**Status**: SP4 complete. All builds pass. Ready for parent project update.
**Last Session**: 2026-03-18 — Completed all 6 implementation steps in a single session

## Session Progress (2026-03-18, Session 1)

### Completed: All 6 Steps — Expandable Tool Groups

#### Step 1: ToolCallDetail — Individual Tool Call Detail Panel
- Created `sdk/react/src/execution/ToolCallDetail.tsx`
  - Metadata row: MCP server badge, status label, duration
  - Arguments section: `args` (JsonObject) as formatted JSON in monospace `<pre>`
  - Result section: auto-detects JSON and formats, otherwise preformatted text
  - Error section: `error` string with `text-destructive` for failed tool calls
  - `CollapsibleCode` sub-component: truncates at 10 lines with "Show all N lines" toggle
  - Exported `formatDuration(startedAt, completedAt)` utility for reuse

#### Step 2: ToolCallItem — Individual Tool Call Row
- Created `sdk/react/src/execution/ToolCallItem.tsx`
  - Clickable `<button>` row with `aria-expanded`, status icon, tool name, MCP server badge, duration, chevron
  - Expands to `ToolCallDetail` for regular tools, `SubAgentSection` for sub-agent delegations
  - Internal `useState` with `defaultExpanded` prop
  - Sub-agent display: uses `subject` or `name` from `SubAgentExecution` as display label

#### Step 3: ToolCallGroup Enhancement — Expandable Summary
- Rewrote `sdk/react/src/execution/ToolCallGroup.tsx`
  - Summary `<div>` → clickable `<button>` with `aria-expanded` and chevron icon
  - New `subAgentExecutions` prop: builds `Map<string, SubAgentExecution>` for O(1) ID-based lookup
  - New `defaultExpanded` prop (defaults to `false`)
  - CSS `grid-template-rows: 0fr → 1fr` animation for smooth expand/collapse
  - When expanded, renders `ToolCallItem` for each tool call
  - Fully backward compatible — existing consumers see same summary with added clickability

#### Step 4: SubAgentSection — Nested Sub-Agent Thread
- Created `sdk/react/src/execution/SubAgentSection.tsx`
  - Header: sub-agent name, `subject` field, status badge (`SubAgentStatus`), duration
  - Body: `buildSubAgentThreadItems` walks sub-agent's `messages`, skips `MESSAGE_TOOL`, renders `MessageEntry` + `ToolCallGroup` — same pattern as `MessageThread`
  - Error footer: conditional, shows `error` string for `SUB_AGENT_FAILED`
  - Visual distinction: `border-l-2 border-primary/20` left border
  - Composition, not duplication — reuses existing `MessageEntry` and `ToolCallGroup`

#### Step 5: MessageThread Integration
- Updated `sdk/react/src/execution/MessageThread.tsx`
  - `ThreadItem` union: `tool-group` variant gains `subAgentExecutions: readonly SubAgentExecution[]`
  - `buildThreadItems`: extracts `exec.status?.subAgentExecutions ?? []` per execution
  - Render loop: passes `subAgentExecutions` prop to `<ToolCallGroup>`
  - No new props on `MessageThreadProps` — data flows from existing `AgentExecution` objects

#### Step 6: Barrel Exports + Build Verification
- Updated `sdk/react/src/execution/index.ts` — added `ToolCallDetail`, `ToolCallDetailProps`, `ToolCallItem`, `ToolCallItemProps`, `SubAgentSection`, `SubAgentSectionProps`, `formatDuration`
- Updated `sdk/react/src/index.ts` — top-level re-exports
- Verification: `npm run typecheck` (sdk/react), `npm run build` (sdk/react), `npx tsc --noEmit` (web), `npm run build` (web) — all pass clean

### Key Design Decisions

1. **Two-level disclosure, not flat expansion** — Summary → item list → item detail. Matches progressive disclosure principle (Hick's Law: reduce choices at each level).
2. **SubAgentExecution passed via prop, not context** — ToolCallGroup receives `subAgentExecutions` as an optional prop. No React Context, no global state. Self-contained and embeddable.
3. **ToolCall.result over MESSAGE_TOOL messages** — Consistent with SP1's design where `MESSAGE_TOOL` is skipped in the thread.
4. **Internal state for expansion, not controlled** — `useState` with `defaultExpanded`. No controlled mode in v1. Platform builders compose primitives directly for full control.
5. **CSS-only expand animation** — `grid-template-rows: 0fr → 1fr` transition. No JS animation library.
6. **Inline SVG icons, no lucide-react in SDK** — Continues SP1 pattern.
7. **Sub-agent ID matching** — `SubAgentExecution.id` matches `ToolCall.id` from parent's "task" tool. One-level nesting only (proto constraint).

## Next Steps

1. **SP4 is COMPLETE.** All 6 steps delivered and verified.
2. **Next action**: Update parent project `next-task.md` to mark SP4 as done. Pick SP3 or SP5 next.

## Context for Resume

- Branch: `feat/session-first-web-ux`
- Commit: `7587e2f0`
- All 6 steps complete. SP4 fully delivered.
- No remaining follow-ups within SP4 scope.

## SP4 Final Export Surface

```
@stigmer/react exports (from this SP):

  Components:
    ToolCallDetail   → args, result, error, timing detail panel
    ToolCallItem     → clickable row with expand/collapse
    SubAgentSection  → nested sub-agent message thread

  Types:
    ToolCallDetailProps, ToolCallItemProps, SubAgentSectionProps

  Utilities:
    formatDuration   → human-readable duration from ISO timestamps
```

## Quick Commands

After loading context:
- "Show project status" - Get overview of SP4 completion
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
