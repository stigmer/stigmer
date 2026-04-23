# Project: 20260423.02.phase3-persistent-runners-browser-launch

## Overview
Phase 3 of agent-runner-as-resource: enable browser-initiated local runner launch via stigmer:// URL scheme, full CRUD on Settings > Runners page, Docker placement variant, and server-side launch token handshake. Users click 'Launch Local Runner' in the cloud console, the browser hands off to the locally installed Stigmer CLI via stigmer://, the CLI registers as a runner, and executions route to the user's laptop.

**Created**: 2026-04-23
**Status**: Active 🟢

## Project Information

### Primary Goal
A cloud user can click 'Launch Local Runner' in the web console, have their browser hand off to the Stigmer CLI on their laptop via stigmer:// URL scheme, and see their laptop appear as a runner accepting agent executions — all within seconds. The Settings > Runners page gets full CRUD (create, stop, delete). Docker placement is available as an alternative to native execution.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Java/Spring Boot (stigmer-service launch token endpoints), Go (CLI URL scheme handler, Docker placement), TypeScript/React (SDK runner action hooks, web UI CRUD), Python (agent-runner shutdown command handler), Protobuf (command stream shutdown command)

### Project Type
Feature Development

### Affected Components
backend/services/stigmer-service (launch token endpoints, token exchange), client-apps/cli (stigmer:// URL handler, Docker placement, URL scheme registration), sdk/react (runner action hooks, RunnerListPanel CRUD), client-apps/web (Settings > Runners actions, Launch Local Runner flow), apis/ (command stream shutdown proto), backend/services/agent-runner (shutdown command handler)

## Project Context

### Dependencies
Phase 0-2 code complete (agent-runner-as-resource project). Runner-ux-cli-restructure complete (Settings > Runners page exists read-only, runner picker in composer exists, CLI stigmer up runner exists). Runner-command-stream T02-T07 complete (bidi stream and sendCommand API exist). Phase 0 deploy NOT required — this work is about local/persistent runners which use their own credentials.

### Success Criteria
- User clicks Launch Local Runner in browser and laptop appears as Ready runner within 30 seconds
- Settings > Runners page has Create/Stop/Delete buttons
- Docker placement works via stigmer up runner --runtime docker
- Runner stop command gracefully shuts down runner via command stream
- Full browser-to-laptop flow works end-to-end on macOS and Linux

### Known Risks & Mitigations
Platform-specific URL scheme registration varies across macOS/Linux/Windows. Browser-to-CLI handoff may have UX rough edges (browser confirmation dialogs, focus switching). Docker placement requires Docker Desktop or Docker Engine installed. Token exchange security needs careful design (one-time use, short TTL, CSRF protection).

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