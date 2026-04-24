# Project: 20260422.02.runner-command-stream

## Overview
Implement a bidirectional gRPC stream between the Runner supervisor (Go) and Stigmer Server, replacing the unary heartbeat RPC and enabling server-initiated commands like filesystem browsing for workspace selection in session creation.

**Created**: 2026-04-22
**Status**: Active 🟢

## Project Information

### Primary Goal
Establish a persistent bidi gRPC stream from the Runner to the server that carries heartbeats (runner to server) and server-initiated commands (server to runner, e.g., ListDirectory). Phase 1 covers agent runner only; workflow runner integration is deferred.

### Timeline
**Target Completion**: 3-4 weeks

### Technology Stack
Go (runner supervisor/CLI daemon), Python (agent-runner heartbeat migration), Protobuf (stream proto definitions), Java (stigmer-service stream handler)

### Project Type
Feature Development

### Affected Components
apis/ai/stigmer/agentic/runner/v1/ (proto); client-apps/cli/internal/cli/daemon/ (Go supervisor); backend/services/agent-runner/worker/heartbeat.py (Python heartbeat removal); backend/services/stigmer-server/ (Go stream handler); stigmer-cloud/backend/services/stigmer-service/ (Java stream handler)

## Project Context

### Dependencies
Runner as Resource project (Phase 0-2 code complete). runner-ux-cli-restructure project (concurrent, coordinate on daemon refactoring). Side-Channel Proxy deployment (for cloud runner testing).

### Success Criteria
- 1) Runner opens a persistent bidi gRPC stream to the server on startup. 2) Heartbeat flows over the stream instead of unary RPC. 3) Server can push ListDirectory commands and receive responses. 4) Cloud web UI can browse a local runner filesystem for workspace selection. 5) Unary heartbeat RPC deprecated. 6) Implemented in both OSS (Go) and Cloud (Java) servers.

### Known Risks & Mitigations
Bidi stream lifecycle management (reconnection, backpressure, graceful shutdown). Coordination with runner-ux-cli-restructure on daemon refactoring. Dual-edition consistency (Go server + Java service must handle the stream identically). Python heartbeat removal must be backward-compatible during rollout.

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