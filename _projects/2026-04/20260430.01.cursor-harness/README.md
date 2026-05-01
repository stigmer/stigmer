# Project: 20260430.01.cursor-harness

## Overview
Integrate the Cursor TypeScript SDK as a premium execution harness alongside the existing LangGraph harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.

**Created**: 2026-04-30
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable Stigmer sessions to choose between LangGraph (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.

### Timeline
**Target Completion**: 4-6 weeks (phased delivery)

### Technology Stack
TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)

### Project Type
Feature Development

### Affected Components
protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Project Context

### Dependencies
@cursor/sdk npm package (public beta), Cursor service account API key, Temporal TypeScript SDK (@temporalio/worker + @temporalio/activity), bun or pkg for single-binary compilation

### Success Criteria
- 1. User can create a session with harness=CURSOR and have executions processed by the Cursor SDK. 2. Streaming works end-to-end (Cursor SDKMessage -> Stigmer AgentMessage). 3. MCP server usages from session are passed to Cursor Agent. 4. HITL approval flow works (mechanism TBD). 5. Unified cost tracking shows Cursor usage in same format as LangGraph. 6. stigmer up starts both Python and TypeScript workers. 7. Both Cursor Local and Cursor Cloud runtimes work.

### Known Risks & Mitigations
1. Cursor SDK is in public beta -- APIs may change before GA. 2. HITL approval mechanism in Cursor SDK needs research -- may require MCP bridge. 3. Node.js/Bun embedding in Go CLI binary is uncharted territory (Python has python-build-standalone precedent). 4. Conversation state ownership -- Cursor owns checkpoints, so pause/resume/recover not available. 5. Cursor billing integration -- need to map Cursor usage to Stigmer cost model. 6. Feature parity gaps -- some Stigmer features (sandbox mode, custom tools) not available on Cursor harness.

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