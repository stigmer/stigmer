# Project: 20260319.01.execution-cost-widget

## Overview
Add a real-time execution cost/usage widget to the SDK React package that displays token consumption, LLM call metrics, and estimated cost alongside ExecutionProgress. Includes fixing the server-side usage merge gap so cost data streams progressively.

**Created**: 2026-03-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Deliver an ExecutionCostSummary component in @stigmer/react with a useExecutionUsage hook, fix the Go server-side usage merge so cost data flows in real-time during streaming, and integrate the widget into the Console sidebar next to ExecutionProgress.

### Timeline
**Target Completion**: 3-5 days

### Technology Stack
TypeScript/React (@stigmer/react, @stigmer/sdk, @stigmer/theme), Go (stigmer-server), Protocol Buffers

### Project Type
Feature Development

### Affected Components
sdk/react (new hook + component), backend/services/stigmer-server (usage merge fix), client-apps/web (Console integration), apis/ (proto validation)

## Project Context

### Dependencies
Existing UsageMetrics proto (usage.proto), useExecutionStream hook, StreamBroker, BuildNewStateWithStatusStep in update_status.go

### Success Criteria
- Usage data streams progressively during execution (not just at terminal state)
- ExecutionCostSummary component renders live token counts and estimated cost
- Component is headless-first with hook + styled component separation
- Themed via --stgm-* tokens with zero Console dependencies
- Platform builders can embed the widget independently

### Known Risks & Mitigations
Server-side usage merge change touches a critical path in execution updates - must be backward-compatible. Usage data volume could impact streaming performance if sent too frequently. Sub-agent usage aggregation adds complexity for total cost calculation.

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