# Sub-Project: 20260317.03.sp.follow-up-conversation-loop

## Parent Project

- **Parent**: 20260317.01.session-first-web-ux
- **Parent Path**: [../../20260317.01.session-first-web-ux/](../../20260317.01.session-first-web-ux/)
- **Spawned From Task**: T01.6

---

## Overview
Add follow-up input to the session view, enabling users to continue conversations by sending additional messages within the same session. SDK FollowUpInput component with model selector, Console-level orchestration for creating executions and streaming them into the existing thread.

**Created**: 2026-03-17
**Status**: Active

## Sub-Project Information

### Goal
Users can send follow-up messages in an active session, creating new executions that stream into the existing conversation thread.

### Technology Stack
TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)

### Project Type
Feature Development

### Affected Components
client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

### Additional Context
This is SP2 of 5 sub-projects decomposing T01.6. Depends on SP1 (core-thread-streaming). Scope: FollowUpInput styled component in SDK (textarea, model selector, send button), follow-up flow in Console SessionPage (create execution -> refetch execution list -> stream new execution). Reuses useCreateAgentExecution and ModelSelector.

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
