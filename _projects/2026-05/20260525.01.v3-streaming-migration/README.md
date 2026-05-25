# Project: 20260525.01.v3-streaming-migration

## Overview
Migrate the runner streaming pipeline from v2 to v3 streamEvents API to enable proper structured output extraction via run.output and unlock deepagents native streaming features.

**Created**: 2026-05-25
**Status**: Active 🟢

## Project Information

### Primary Goal
Replace v2 streamEvents() with v3 streamEvents() in the ExecuteDeepAgent streaming loop, enabling native access to structuredResponse via run.output/run.values and fixing the Native path structured output pipeline.

### Timeline
**Target Completion**: No hard deadline -- get it right

### Technology Stack
TypeScript, deepagents, LangGraph, LangChain, Temporal

### Project Type
Migration

### Affected Components
backend/services/runner/src/activities/execute-deep-agent/streaming.ts, backend/services/runner/src/activities/execute-deep-agent/index.ts, backend/services/runner/src/activities/execute-deep-agent/status-builder.ts, test/integration-offline/, test/integration/

## Project Context

### Dependencies
deepagents v3 streaming API documentation, LangGraph GraphRunStream API

### Success Criteria
- 1. Native path structured output tests pass (TestAgentExecution_StructuredOutputPipeline native subtests)
- 2. All existing streaming behavior preserved (heartbeats
- stall detection
- HITL
- inline publishing
- writeback)
- 3. StatusBuilder updated for v3 event shapes
- 4. Offline tests pass with v3 streaming
- 5. Full make test-integration-all passes

### Known Risks & Mitigations
1. v3 event shapes may differ significantly from v2, requiring StatusBuilder rewrite. 2. v3 streaming may have different cancellation/pause semantics. 3. deepagents stream transformers only activate in v3, changing visible event set. 4. Performance characteristics may differ.

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