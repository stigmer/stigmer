# Project: 20260410.03.mcp-oauth-connect

## Overview
Implement OAuth-based MCP server authentication across Stigmer, supporting MCP OAuth spec (DCR+PKCE) for 9 servers and vendor OAuth for 4 servers, with mid-execution re-auth following the existing HITL approval pattern.

**Created**: 2026-04-10
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable one-click OAuth Connect for 13 MCP servers, store tokens in personal environment, handle mid-execution 401 with pause-and-resume re-auth flow, and support token lifecycle management.

### Timeline
**Target Completion**: 3-4 weeks

### Technology Stack
Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), Python/LangGraph (agent-runner), TypeScript/React (SDK/UI)

### Project Type
Feature Development

### Affected Components
stigmer/apis protos, stigmer-server Go backend, agent-runner Python, stigmer-cloud Java Temporal workflows, React SDK, seedpack MCP server YAMLs

## Project Context

### Dependencies
Vendor MCP servers must support DCR/PKCE per MCP auth spec; existing HITL approval flow as template for re-auth pattern

### Success Criteria
- Users can OAuth-connect to 9+ DCR servers via one-click; tokens stored in personal env; mid-execution 401 triggers re-auth prompt in web UI; execution resumes after re-auth; pre-flight token expiry check prevents stale token starts

### Known Risks & Mitigations
Vendor OAuth implementations may not fully comply with MCP spec; LangGraph checkpoint/resume for 401 retry needs validation; token refresh edge cases across execution context boundaries; Figma restricts DCR to approved clients only

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