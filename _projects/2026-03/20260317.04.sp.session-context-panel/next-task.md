# Next Task: 20260317.04.sp.session-context-panel

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

## Sub-Project: 20260317.04.sp.session-context-panel

**Description**: Populate the right context panel with execution metadata. Add a context panel slot mechanism so pages can inject content. Build SessionContextContent with execution phase, model, token usage, cost, duration, workspace entries, and resolved context (MCP servers, tools).
**Goal**: Users can view execution details (progress, model, usage metrics, workspace) in the collapsible right context panel while viewing a session.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/dont-dos/
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
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.04.sp.session-context-panel/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 18:16
**Current Task**: T01 COMPLETE — All 4 steps delivered
**Status**: SP3 complete. All builds pass. Ready for parent project update.
**Last Session**: 2026-03-18 — Completed all 4 implementation steps in a single session

## Session Progress (2026-03-18, Session 1)

### Completed: All 4 Steps — Session Context Panel

#### Step 1: Context Panel Slot Mechanism (Console)
- Renamed `use-layout-state.ts` → `use-layout-state.tsx` (JSX needed for Provider component)
- Added `ContextPanelSlotProvider` — React Context holding `{ content: ReactNode | null; setContent }` state
- Added `useContextPanelSlot(content: ReactNode | null): void` — effect-based hook that registers content and clears on unmount
- Added `useContextPanelSlotContent(): ReactNode | null` — reader hook for `ContextPanel`
- `AppShell` wraps children with `ContextPanelSlotProvider`
- `ContextPanel` reads slot content via `useContextPanelSlotContent()` instead of accepting `children` prop

#### Step 2: ExecutionDetails Component (SDK)
- Created `sdk/react/src/execution/ExecutionDetails.tsx`
- Seven sections, each rendering conditionally based on data availability:
  - **Status**: `ExecutionPhaseBadge` (reuse) + started timestamp + live elapsed timer (1s interval for in-progress via `useElapsedMs` hook) or total duration for terminal executions
  - **Model**: provider name + model name in monospace (`usage.primaryProvider`, `usage.primaryModel`)
  - **Tokens**: prompt/completion/total grid + cache write/read (if non-zero) + LLM call count, tabular numeric layout
  - **Cost**: formatted USD (`$0.0234` for small, `$1.52` for larger values)
  - **Context Window**: color-coded progress bar (green < 70% < yellow < 90% < red) with `role="meter"` and compact token counts
  - **Resolved Context**: MCP servers (dot icon + slug + tool count), skills (monospace chips), env key count with key icon
  - **Workspace**: folder icon + entry name + source URL/path (git repos show shortened URL, local paths in monospace)
- Props: `execution: AgentExecution | null`, optional `workspaceEntries: readonly WorkspaceEntry[]`, `className`
- All inline SVG icons (no lucide-react in SDK), all `--stgm-*` token styling, proper `aria-*` attributes
- Internal `Section` primitive for consistent layout (border-b separators, uppercase label, vertical gap)
- Utility formatters: `formatMs`, `formatTimestamp`, `formatNumber`, `formatCompactNumber`, `formatCost`

#### Step 3: SessionPage Integration (Console)
- Derives `activeExecution` from `conv.activeStreamExecution ?? lastCompleted ?? null`
- Calls `useContextPanelSlot` with `<ExecutionDetails>` content — updates live during streaming
- Auto-opens the context panel on first execution data via `useRef` guard (won't re-open if user closes)
- `PanelRight` toggle button positioned absolute top-right of session view (hidden below `lg` breakpoint)

#### Step 4: Barrel Exports + Build Verification
- `ExecutionDetails` and `ExecutionDetailsProps` exported from `execution/index.ts`
- Re-exported from top-level `src/index.ts`
- Verification: `npm run typecheck` (sdk/react), `npm run build` (sdk/react), `npx tsc --noEmit` (web), `npm run build` (web) — all pass clean

### Key Design Decisions

1. **Slot mechanism in Console, not SDK** — The context panel slot is layout infrastructure for bridging Next.js page content to a layout-level panel. Platform builders own their layout.
2. **`ExecutionDetails` in SDK** — Platform builders embedding execution viewers want execution metadata. Self-contained, themed, embeddable.
3. **`execution: AgentExecution | null` as primary prop** — Full proto object avoids prop explosion, keeps API stable as new status fields are added. Zero transformation from hooks.
4. **`workspaceEntries` as optional prop** — Workspace is session-level data. Optional prop lets the component show it when available without forcing consumers to also fetch session data.
5. **Internal sections, not exported** — Individual sections (StatusSection, TokensSection, etc.) are internal for code organization. Not exported in v1 to avoid premature API surface expansion.
6. **React Context for slot, not `useSyncExternalStore`** — Slot content is `ReactNode` (not serializable). Existing `useSyncExternalStore` pattern stays for open/close (primitive boolean).
7. **`useElapsedMs` for live duration** — Client-side timer ticking every 1s during in-progress executions. Stops when terminal. Falls back to `totalDurationMs` from proto for completed executions.
8. **Auto-open with ref guard** — Panel auto-opens on first execution data. `useRef(false)` prevents re-opening after user manually closes.

## Next Steps

1. **SP3 is COMPLETE.** All 4 steps delivered and verified.
2. **Next action**: Update parent project `next-task.md` to mark SP3 as done. Pick SP5 (HITL Approvals) next.

## Context for Resume

- Branch: `feat/session-first-web-ux`
- All 4 steps complete. SP3 fully delivered.
- No remaining follow-ups within SP3 scope.

## SP3 Final Export Surface

```
@stigmer/react exports (from this SP):

  Components:
    ExecutionDetails   → execution metadata panel (status, model, tokens, cost, context window, resolved context, workspace)

  Types:
    ExecutionDetailsProps
```

## Quick Commands

After loading context:
- "Show project status" - Get overview of SP3 completion
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
