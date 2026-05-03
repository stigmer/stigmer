# Project: 20260503.01.react-sdk-streaming-ux

## Overview
Eliminate flickering, jank, and navigation flash in the @stigmer/react SDK's message thread and session composer by re-architecting the data flow from gRPC stream to React rendering. Implements structural-sharing snapshot ingestion, row-level subscriptions, streaming-aware markdown, key-based session caching, virtualization, and composer isolation.

**Created**: 2026-05-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Deliver a state-of-the-art, flicker-free, production-quality streaming conversation experience in @stigmer/react that is comparable to ChatGPT/Claude/Cursor — customers can confidently embed it as a plug-and-play component in their products.

### Timeline
**Target Completion**: No specific deadline — quality over speed. 10 phases, each buildable in 1-3 sessions.

### Technology Stack
TypeScript, React 19, @stigmer/react SDK, @stigmer/sdk, @connectrpc/connect (gRPC), @bufbuild/protobuf, react-markdown, Streamdown, react-virtuoso, Tailwind CSS v4, @stigmer/theme

### Project Type
Refactoring

### Affected Components
sdk/react (MessageThread, MessageEntry, useExecutionStream, useSessionConversation, SessionComposer, useFetch), sdk/typescript (AgentExecutionClient.subscribe), client-apps/web (SessionPage, Sidebar)

## Project Context

### Dependencies
@stigmer/react already has React 19, react-markdown, @stigmer/theme. New deps to evaluate: Streamdown, react-virtuoso, possibly TanStack Query (Console only). Research report completed at _projects/2026-05/research.react-sdk-streaming-ux-quality/04.report.gpt.md

### Success Criteria
- 1) During token streaming
- only the active assistant row re-renders — completed rows do not remount
- composer does not re-render per token. 2) Session-to-session navigation shows no flash of wrong content. 3) Conversations with 100+ messages remain smooth. 4) SDK bundle size increase stays under 15KB gzipped. 5) All existing tests pass
- accessibility preserved (role=log
- aria-live).

### Known Risks & Mitigations
1) Structural-sharing store is the architectural foundation — if the design is wrong, everything downstream is affected. 2) Streamdown is a relatively new library. 3) Virtualization with variable-height chat items and auto-scroll is complex. 4) Public SDK API surface changes must be backward-compatible.

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