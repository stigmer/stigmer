# Next Task: 20260317.06.sp.hitl-approvals

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

## Sub-Project: 20260317.06.sp.hitl-approvals

**Description**: Add human-in-the-loop approval UI to the session view. Build useSubmitApproval behavior hook and ApprovalCard styled component with approve/skip/reject actions. Integrate approval flow into the conversation thread when executions enter WAITING_FOR_APPROVAL phase.
**Goal**: Users can approve, skip, or reject tool calls that require authorization, unblocking paused executions from the session view.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/dont-dos/
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
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.06.sp.hitl-approvals/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 18:16
**Current Task**: Complete
**Status**: Done
**Last Session**: 2026-03-18 — Full implementation in a single session
**Committed**: `adf565d5`

## Session Progress (2026-03-18)

### Completed: SP5 — HITL Approval UI
- **`useSubmitApproval`** behavior hook — wraps `agentExecution.submitApproval()` with per-tool-call submitting state (`Set<string>`), proto message construction via `create(SubmitApprovalInputSchema, {...})`, error/clearError
- **`ApprovalCard`** styled component — shield icon header, tool name badge, approval message, collapsible args preview (auto-formatted JSON with expand/collapse), live-ticking wait duration, sub-agent attribution, three action buttons (Approve/Skip/Reject) with per-button spinner, `role="alert"`, all `--stgm-*` tokens, inline SVG icons, `<div>` not `<form>`
- **`MessageThread` updated** — new `"approval-request"` ThreadItem kind in discriminated union, optional `onApprovalSubmit` and `submittingApprovalIds` props, `buildThreadItems()` appends approval items from `lastExec.status.pendingApprovals` when callback provided, fully backward compatible
- **`useSessionConversation` updated** — composes `useSubmitApproval()` internally, exposes `submitApproval(toolCallId, action, comment?)` wrapping with current `activeExecutionId`, exposes `pendingApprovals`, `submittingApprovalIds`, `approvalError`, `clearApprovalError`
- **`SessionPage` updated** — passes `onApprovalSubmit` and `submittingApprovalIds` to `MessageThread`, displays `approvalError` alongside existing `sendError`
- **Barrel exports** updated in `execution/index.ts` and `src/index.ts`
- **Build verification**: `typecheck`, `build` pass clean for both `sdk/react` and `client-apps/web`

### Key Decisions
- Thread-level ApprovalCards (not inline in ToolCallItem) — blocking actions must be unmissable, zero clicks to reach
- Per-tool-call submitting state via `Set<string>` — essential for batch approval scenarios
- `useSessionConversation` abstracts executionId — consumer calls `submitApproval(toolCallId, action)` without knowing the executionId
- `onApprovalSubmit` is optional on MessageThread — backward compatible
- No comment field in v1 — reduces friction, proto accepts empty comment
- `ApprovalCard` is independently importable — platform builders can use it standalone with `useSubmitApproval`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
