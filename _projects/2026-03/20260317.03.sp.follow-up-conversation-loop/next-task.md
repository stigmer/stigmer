# Next Task: 20260317.03.sp.follow-up-conversation-loop

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

## Sub-Project: 20260317.03.sp.follow-up-conversation-loop

**Description**: Add follow-up input to the session view, enabling users to continue conversations by sending additional messages within the same session. SDK FollowUpInput component with model selector, Console-level orchestration for creating executions and streaming them into the existing thread.
**Goal**: Users can send follow-up messages in an active session, creating new executions that stream into the existing conversation thread.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/dont-dos/
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
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.03.sp.follow-up-conversation-loop/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 18:16
**Current Task**: T01 COMPLETE — All 5 steps delivered
**Status**: SP2 complete. All builds pass. Ready for parent project update.
**Last Session**: 2026-03-18 — Completed all 5 implementation steps in a single session

## Session Progress (2026-03-18, Session 1)

### Completed: All 5 Steps — Follow-Up Conversation Loop

#### Step 1: FollowUpInput SDK Styled Component
- Created `sdk/react/src/execution/FollowUpInput.tsx`
  - Auto-resizing textarea with Enter to send, Shift+Enter for newline
  - Compact `ModelSelector` integration (optional via `showModelSelector` prop)
  - Send button with inline SVG icons (arrow-up / spinner) — no `lucide-react` dependency
  - `onModelChange` callback for Console-level model persistence
  - Auto-focus when `disabled` transitions from `true` to `false`
  - Uses `<div>` not `<form>` — embeddable inside host forms
  - Themed via `--stgm-*` tokens, no hardcoded colors

#### Step 2: pendingUserMessage Support in MessageThread
- Updated `sdk/react/src/execution/MessageThread.tsx`
  - Added `pendingUserMessage?: string | null` prop
  - Extended `ThreadItem` discriminated union with `pending-message` kind
  - `buildThreadItems` accepts and appends optimistic user message
  - Rendered as a HumanMessage with reduced opacity (0.7) to signal "sending"
  - Additive change — existing consumers see zero difference

#### Step 3: useSessionConversation Behavior Hook
- Created `sdk/react/src/session/useSessionConversation.ts`
  - Composes: `useSession`, `useSessionExecutions`, `useCreateAgentExecution`, `useExecutionStream`, `isTerminalPhase`
  - `pendingExecutionId` state for immediate streaming after creation (bypasses list refetch latency)
  - `pendingUserMessage` state cleared when stream delivers first snapshot
  - `canSendFollowUp = !isSending && activeExecutionId === null` — sequential follow-ups only
  - Stream-to-fetch fallback (SP1 pattern preserved)
  - Re-exports stream health properties (`streamError`, `reconnectStream`)

#### Step 4: SessionPage Console Integration
- Rewrote `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`
  - Replaced inline hook composition with `useSessionConversation(id, org)`
  - Added `FollowUpInput` at the bottom of the page
  - `usePersistedModel()` custom hook for localStorage model persistence (same key as SessionLauncher)
  - Send error display between stream error banner and input
  - Local sub-components (`SessionSkeleton`, `SessionError`, `SessionStarting`, `StreamErrorBanner`) preserved unchanged

#### Step 5: Barrel Exports + Build Verification
- Updated `sdk/react/src/execution/index.ts` — added `FollowUpInput`, `FollowUpInputProps`
- Updated `sdk/react/src/session/index.ts` — added `useSessionConversation`, `UseSessionConversationReturn`
- Updated `sdk/react/src/index.ts` — top-level barrel exports for both
- Verification: `npm run typecheck` (sdk/react), `npm run build` (sdk/react), `npx tsc --noEmit` (web), `npm run build` (web) — all pass clean

### Key Design Decisions

1. **`useSessionConversation` in `@stigmer/react`, not Console** — The conversation loop is the core interaction pattern of the platform. Without this hook, every platform builder would need to replicate ~40 lines of non-trivial orchestration (active execution detection, pending execution management, refetch coordination, stream fallback, optimistic message state). This is the "hard part that platform builders should not have to reimplement."
2. **`org` as explicit parameter, not derived from session** — The Console passes org from `useActiveOrgSlug()`, platform builders pass their own. Simpler than fetching the session just to extract org. The hook needs org at call-time for `useCreateAgentExecution`.
3. **Optimistic user message via `pendingUserMessage` prop** — 200-500ms gap between submit and first stream snapshot would feel sluggish. The optimistic message renders immediately at 70% opacity, then disappears when the real stream data arrives. Low implementation cost, significant UX improvement.
4. **Sequential follow-ups only** — Input disabled while an execution is in progress. Backend allows concurrent executions, but sequential follow-ups (like the CLI) provide predictable UX and simpler state management. Can be relaxed later.
5. **`FollowUpInput` uses `<div>` not `<form>`** — Consistent with decision #23 from parent. SDK components must be embeddable inside host forms.
6. **Inline SVG icons in `FollowUpInput`** — Follows SDK pattern (no `lucide-react`). Two small icons: arrow-up for send, arc for spinner.
7. **`usePersistedModel` extracted as Console-local hook** — localStorage persistence is Console-specific (not SDK). Same storage key as `SessionLauncher` for consistency.

## Next Steps

1. **SP2 is COMPLETE.** All 5 steps delivered and verified.
2. **Next action**: Update parent project `next-task.md` to mark SP2 as done. Pick SP3, SP4, or SP5 next.

## Context for Resume

- Branch: `feat/session-first-web-ux`
- All 5 steps complete. SP2 fully delivered.
- The full conversation loop is wired: `SessionPage` → `useSessionConversation` → `FollowUpInput` + `MessageThread` with optimistic messages.
- No remaining follow-ups within SP2 scope.

## SP2 Final Export Surface

```
@stigmer/react exports (from this SP):

  Hooks:
    useSessionConversation(sessionId, org) → full conversation lifecycle

  Components:
    FollowUpInput → textarea + model selector + send button

  Types:
    UseSessionConversationReturn, FollowUpInputProps
```

## Quick Commands

After loading context:
- "Show project status" - Get overview of SP2 completion
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
