# Sub-Project: 20260317.06.sp.hitl-approvals

## Parent Project

- **Parent**: 20260317.01.session-first-web-ux
- **Parent Path**: [../../20260317.01.session-first-web-ux/](../../20260317.01.session-first-web-ux/)
- **Spawned From Task**: T01.6

---

## Overview
Add human-in-the-loop approval UI to the session view. Build useSubmitApproval behavior hook and ApprovalCard styled component with approve/skip/reject actions. Integrate approval flow into the conversation thread when executions enter WAITING_FOR_APPROVAL phase.

**Created**: 2026-03-17
**Status**: Active

## Sub-Project Information

### Goal
Users can approve, skip, or reject tool calls that require authorization, unblocking paused executions from the session view.

### Technology Stack
TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)

### Project Type
Feature Development

### Affected Components
client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

### Additional Context
This is SP5 of 5 sub-projects decomposing T01.6. Depends on SP1 (core-thread-streaming) and SP4 (expandable-tool-groups) because approvals attach to specific tool calls. Scope: useSubmitApproval hook wrapping stigmer.agentExecution.submitApproval(), ApprovalCard component with PendingApproval props and approve/skip/reject buttons, integration in MessageThread when status.pending_approvals is non-empty, inline rendering within tool call groups.

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
- [Parent Project](../../20260317.01.session-first-web-ux/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
