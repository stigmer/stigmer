# Project: 20260422.01.runner-ux-cli-restructure

## Overview
Restructure Stigmer CLI with stigmer up/down commands, implement standalone runner lifecycle (stigmer up runner), multi-runner management, context-aware smart defaults (local vs cloud), and web UI runner integration.

**Created**: 2026-04-22
**Status**: Active 🟢

## Project Information

### Primary Goal
Give users a clean, intuitive way to manage the Stigmer control plane and runners independently, with smart defaults that adapt to local vs cloud context. Replace stigmer server with stigmer up/down. Enable cloud users to register their local machine as a runner.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Go (CLI/Cobra), Python (agent-runner), TypeScript/React (web UI), Protobuf

### Project Type
Feature Development

### Affected Components
client-apps/cli (command structure, daemon, runner lifecycle); sdk/react (runner hooks, session composer); client-apps/web (runner picker, settings page); backend/services/stigmer-server (dispatch enhancement)

## Project Context

### Dependencies
Runner as a Resource project (Phase 0-2) code complete (done). Phase 0 deploy (proxy, HTTPRoute) should be completed before cloud runner mode is tested.

### Success Criteria
- 1) stigmer up starts server+runner locally with one command. 2) stigmer up runner starts a standalone runner connected to local or cloud. 3) Multiple runners per machine with unique names tracked in ~/.stigmer/runners/. 4) Runner picker in web session composer. 5) stigmer server deprecated with alias.

### Known Risks & Mitigations
CLI backward compatibility with stigmer server users. Daemon refactoring complexity (buildComponents split). Python runtime bootstrap reuse outside daemon context.

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