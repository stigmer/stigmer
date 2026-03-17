# Sub-Project: 20260317.02.sp.core-thread-streaming

## Parent Project

- **Parent**: 20260317.01.session-first-web-ux
- **Parent Path**: [../../20260317.01.session-first-web-ux/](../../20260317.01.session-first-web-ux/)
- **Spawned From Task**: T01.6

---

## Overview
Build the minimum viable session view at /sessions/[id] with real-time execution streaming, message rendering (markdown), and collapsed tool call summaries. SDK hooks for data fetching and streaming, SDK styled components for messages and tool groups, Console page orchestration.

**Created**: 2026-03-17
**Status**: Active

## Sub-Project Information

### Goal
Users navigate to a session and see the conversation thread with user messages, markdown-rendered agent responses, collapsed tool call summaries, real-time streaming updates, auto-scroll, and terminal phase indicators.

### Technology Stack
TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)

### Project Type
Feature Development

### Affected Components
client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

### Additional Context
This is SP1 of 5 sub-projects decomposing T01.6. SP1 scope: useSession + useSessionExecutions data hooks, useExecutionStream behavior hook, MessageEntry + ToolCallGroup + ExecutionPhaseBadge + MessageThread styled components, SessionPage rewrite. Dependencies: react-markdown + remark-gfm. No follow-up input, no context panel content, no expandable tools, no HITL approvals.

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
