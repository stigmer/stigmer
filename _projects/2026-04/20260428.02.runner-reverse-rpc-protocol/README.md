# Project: 20260428.02.runner-reverse-rpc-protocol

## Overview
Replace the hand-rolled request-response protocol (oneof command bag + StreamRegistry + request_id correlation) on the runner bidi stream with a proper gRPC reverse tunnel pattern, eliminating manual dispatch, improving extensibility, and enabling standard tooling.

**Created**: 2026-04-28
**Status**: Active 🟢

## Project Information

### Primary Goal
Adopt a gRPC reverse tunnel (e.g. grpctunnel or equivalent) so the server can invoke typed, codegen'd RPCs on the runner through the existing client-initiated connection — removing the StreamRegistry, oneof command bags, manual request_id correlation, and multi-site dispatch switches.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
Go, gRPC, Protocol Buffers, Connect-RPC

### Project Type
Refactoring

### Affected Components
apis/ai/stigmer/agentic/runner/v1/ (proto definitions: io.proto, command.proto), backend/services/stigmer-server/pkg/domain/runner/controller/ (StreamRegistry, connect handler, sendCommand), client-apps/cli/internal/cli/daemon/ (runner_stream.go, runner_stream_commands.go), sdk/typescript/ and sdk/react/ (sendCommand callers)

## Project Context

### Dependencies
Evaluate grpctunnel libraries (jhump/grpctunnel or equivalent) for Connect-RPC compatibility; cloud Redis pub/sub routing must be preserved or replaced

### Success Criteria
- 1) Adding a new runner command requires only adding a method to a proto service definition — no oneof additions
- no dispatch switches. 2) StreamRegistry replaced by reverse tunnel connection management. 3) All existing commands (ListDirectory
- Stop) work identically from the UI perspective. 4) Cloud cross-pod routing still works without Redis pub/sub relay (or with a cleaner relay). 5) Zero breaking changes to the React SDK or CLI UX.

### Known Risks & Mitigations
1) grpctunnel may not be compatible with Connect-RPC (browser transport). 2) Cloud pod-routing for reverse tunnels may require a service mesh or shared registry. 3) Migration must be backward-compatible — old runners must work during rollout.

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