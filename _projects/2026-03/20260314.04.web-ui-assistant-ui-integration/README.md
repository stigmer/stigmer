# Project: 20260314.04.web-ui-assistant-ui-integration

## Overview
Evaluate and integrate assistant-ui as the rendering layer for Stigmer's web console agent execution monitoring. Build a StigmerRuntimeProvider adapter that bridges Stigmer's gRPC/protobuf execution data to assistant-ui's ExternalStoreRuntime, replacing hand-built execution components. Structure the adapter for future extraction as @stigmer/assistant-ui-adapter for consumer use.

**Created**: 2026-03-14
**Status**: Active 🟢

## Project Information

### Primary Goal
Determine whether assistant-ui is the right rendering foundation for Stigmer's execution UI, and if so, build the adapter layer that converts Stigmer's gRPC streaming data into assistant-ui components — enabling both Stigmer's own web console and a shippable library for consumers.

### Timeline
**Target Completion**: Flexible — quality over speed. Phase 1 is 2-day research spike, followed by implementation if evaluation passes.

### Technology Stack
TypeScript / React 19 / Next.js 16 / assistant-ui / Connect-RPC (gRPC-Web) / Protobuf / TailwindCSS v4 / shadcn-ui

### Project Type
Research

### Affected Components
client-apps/web (execution components), services/execution-service.ts, apis/stubs/ts (@stigmer/protos), potentially new packages/assistant-ui-adapter

## Project Context

### Dependencies
assistant-ui npm package, existing gRPC-Web integration (from web-console-oss-migration T05), existing @stigmer/protos, pi-mono repo (reference for UX patterns)

### Success Criteria
- Phase 1 (Research): (1) Complete gap analysis of assistant-ui vs Stigmer execution model. (2) Working POC showing Stigmer execution data rendered through assistant-ui Thread component. (3) Clear go/no-go decision with documented rationale. Phase 2 (if go): (4) Stigmer web console execution view renders via assistant-ui. (5) Streaming
- tool calls
- HITL approvals work through the adapter. (6) Adapter structured for extraction as standalone npm package.

### Known Risks & Mitigations
assistant-ui ExternalStoreRuntime may not support Stigmer's full execution model (sub-agents, execution phases, nested tool calls). Gap analysis in Phase 1 will surface these. assistant-ui is a third-party dependency — version churn and breaking changes are a long-term maintenance concern. The research phase may conclude that assistant-ui is not suitable, requiring a pivot to a different strategy.

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