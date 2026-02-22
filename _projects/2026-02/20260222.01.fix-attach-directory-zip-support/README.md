# Project: 20260222.01.fix-attach-directory-zip-support

## Overview
Add directory and zip file support to the --attach flag: CLI auto-zips directories, accepts zip files directly, and the agent runner extracts zip attachments at mount paths.

**Created**: 2026-02-22
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable --attach to accept both individual files and directories (auto-zipped), and ensure the agent runner properly extracts zip files when injecting attachments.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Go (CLI), Python (agent-runner), Protobuf (APIs)

### Project Type
Feature Development

### Affected Components
client-apps/cli/cmd/stigmer/root/run_attachments.go, backend/services/agent-runner/worker/activities/execute_graphton.py, apis/ai/stigmer/agentic/agentexecution/v1/spec.proto

## Project Context

### Dependencies
None identified

### Success Criteria
- --attach ./my-dir/ auto-zips and uploads; --attach archive.zip uploads directly; agent runner extracts both at mount path; individual file behavior unchanged.

### Known Risks & Mitigations
gRPC message size limit (~4MB) for large directories; backward compatibility with existing attachments; ensuring zip extraction is safe (path traversal protection)

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