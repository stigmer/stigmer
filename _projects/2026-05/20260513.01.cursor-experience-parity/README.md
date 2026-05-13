# Project: 20260513.01.cursor-experience-parity

## Overview
Implement usage tracking, context window visibility, chat summarization, and Cursor-like UX features based on deep research findings from three ChatGPT Deep Research reports.

**Created**: 2026-05-13
**Status**: Active 🟢

## Project Information

### Primary Goal
Close the UX gap between Stigmer and Cursor IDE for early adopters: fix $0.00 usage for Cursor sessions, add context window telemetry, implement active chat summarization, and add Plan/Ask mode.

### Timeline
**Target Completion**: 4-6 weeks (phased delivery)

### Technology Stack
TypeScript (cursor-runner), Java (stigmer-service), Python (agent-runner), Protobuf (protos), React (SDK)

### Project Type
Feature Development

### Affected Components
cursor-runner, agent-runner, stigmer-service, React SDK, protos (session/execution/billing), Planton usage dashboard

## Project Context

### Dependencies
@cursor/sdk (public beta), Cursor Admin API, LangGraph/LangChain, Temporal TypeScript+Java SDKs

### Success Criteria
- 1) Cursor sessions show non-zero usage/cost in Planton dashboard. 2) Context window gauge visible in React SDK with category breakdown. 3) Active chat summarization with visible compacted-context cards. 4) Plan/Ask mode toggle available in session UI. 5) Unified usage ledger across both harnesses.

### Known Risks & Mitigations
1) Cursor SDK TurnEndedUpdate.usage is optional — absence semantics undocumented. 2) Cursor Admin API has no documented runId/agentId for per-execution reconciliation. 3) LangGraph streaming+callbacks have known edge cases. 4) Context breakdown for Cursor is estimated, not exact. 5) SDK is public beta — APIs may change.

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