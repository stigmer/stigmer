# Project: 20260317.01.session-first-web-ux

## Overview
Redesign the Stigmer web console with a session-first UX inspired by Claude Cowork. Replace the current dashboard-centric UI with a 'New Session' launcher as the landing page. Add a default 'assistant' agent to the seedpack. Backend resolves default agent automatically when no agent is specified.

**Created**: 2026-03-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Users can log in and immediately start a session by typing a message — no agent selection required. The backend auto-resolves the default assistant agent. The web console is rebuilt from scratch with a three-panel layout: sidebar (New Session + Recents), main content (session launcher or active session thread), and a collapsible right context panel.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)

### Project Type
Feature Development

### Affected Components
client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Project Context

### Dependencies
Existing @stigmer/react and @stigmer/protos packages, @stigmer/theme, existing auth infrastructure

### Success Criteria
- User lands on New Session screen after login
- User types a message and session starts without selecting an agent
- Backend auto-resolves default assistant agent from seedpack
- Active session view shows conversation thread with right context panel
- Sidebar shows New Session button and recent sessions list
- All existing auth flows still work

### Known Risks & Mitigations
Ensuring auth flow survives the fresh start,@stigmer/react agent-execution components may need adaptation for the new layout,Backend changes for default agent resolution touch session and execution creation paths

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._

## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
| core-thread-streaming | [20260317.02.sp.core-thread-streaming](../20260317.02.sp.core-thread-streaming/) | Active | Build the minimum viable session view at /sessions/[id] with real-time execution streaming, message rendering (markdown), and collapsed tool call summaries. SDK hooks for data fetching and streaming, SDK styled components for messages and tool groups, Console page orchestration. |
| follow-up-conversation-loop | [20260317.03.sp.follow-up-conversation-loop](../20260317.03.sp.follow-up-conversation-loop/) | Active | Add follow-up input to the session view, enabling users to continue conversations by sending additional messages within the same session. SDK FollowUpInput component with model selector, Console-level orchestration for creating executions and streaming them into the existing thread. |
| session-context-panel | [20260317.04.sp.session-context-panel](../20260317.04.sp.session-context-panel/) | Active | Populate the right context panel with execution metadata. Add a context panel slot mechanism so pages can inject content. Build SessionContextContent with execution phase, model, token usage, cost, duration, workspace entries, and resolved context (MCP servers, tools). |
| expandable-tool-groups | [20260317.05.sp.expandable-tool-groups](../20260317.05.sp.expandable-tool-groups/) | Active | Make collapsed tool call summaries expandable to reveal individual tool calls with args, results, status, and timing. Add sub-agent sections as expandable nested threads. Two-level progressive disclosure: summary line -> list of tool calls -> individual call detail. |
| hitl-approvals | [20260317.06.sp.hitl-approvals](../20260317.06.sp.hitl-approvals/) | Active | Add human-in-the-loop approval UI to the session view. Build useSubmitApproval behavior hook and ApprovalCard styled component with approve/skip/reject actions. Integrate approval flow into the conversation thread when executions enter WAITING_FOR_APPROVAL phase. |
