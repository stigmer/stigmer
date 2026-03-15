# Project: 20260315.01.web-libs-setup

## Overview
Set up the _libs pattern in Stigmer web app — workspace packages for reusable, publishable React components. Extract existing execution components into @stigmer/react-ui as the first library. Establish frontend patterns (IoC bridge, pipeline framework) matching Planton's proven approach.

**Created**: 2026-03-15
**Status**: Active 🟢

## Project Information

### Primary Goal
Platform owners can install @stigmer/react-ui from npm and embed agent execution UI in their apps with ~5 lines of code. Stigmer's own web console is the first consumer.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
TypeScript, React 19, Next.js 16, Tailwind CSS v4, shadcn-ui, Connect-RPC (gRPC-Web), npm workspaces

### Project Type
Feature Development

### Affected Components
client-apps/web (components/execution, services, hooks, lib), new client-apps/web/_libs/ directory

## Project Context

### Dependencies
Existing execution components must keep working during extraction. npm org @stigmer must be available for publishing.

### Success Criteria
- 1) _libs pattern established with infra/ui/domain layers. 2) @stigmer/react-ui/execution package contains all execution components. 3) Stigmer web console imports from @stigmer/react-ui instead of local paths. 4) Package is publishable to npm. 5) Platform owner can install and use ExecutionChat with StigmerProvider in ~5 lines.

### Known Risks & Mitigations
Scope creep into AG-UI/protocol work (out of scope — this is about packaging existing components). Breaking existing web console during extraction.

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