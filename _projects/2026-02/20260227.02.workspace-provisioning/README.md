# Project: 20260227.02.workspace-provisioning

## Overview
Redesign workspace provisioning and input file handling to make agent execution fully deployment-agnostic. Introduce WorkspaceSource (git repo, local path, empty), clean credential scoping, workspace-aware system prompts, and streamlined local-mode input files.

**Created**: 2026-02-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Make agent execution fully deployment-agnostic by properly separating workspace provisioning from agent logic, supporting multiple workspace sources (git, local path, empty), and ensuring input files and credentials flow correctly across local and cloud modes.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Python (agent-runner, graphton), Protobuf (APIs), Go (CLI/server)

### Project Type
Feature Development

### Affected Components
apis/protos (session, agentexecution), backend/services/agent-runner (workspace provisioner, sandbox_manager, execute_graphton, prompt_enhancement), backend/libs/graphton (FilesystemBackend), client-apps/cli

## Project Context

### Dependencies
Existing environment merge chain must remain backward-compatible. No breaking changes to current AgentExecution or Session APIs.

### Success Criteria
- Agent code has zero deployment-mode conditionals
- WorkspaceSource proto supports git_repo/local_path/empty
- git clone with GITHUB_TOKEN works in both local and cloud modes
- input files bypass storage round-trip in local mode
- workspace awareness section injected into system prompt
- credential scoping strips provisioning-only keys from agent environment

### Known Risks & Mitigations
Breaking existing execution flows. Backward compatibility with current session/execution APIs. Git clone security (credential leakage, path traversal). Performance regression from workspace provisioning step.

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

## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
| platform-file-isolation | [20260228.01.sp.platform-file-isolation](../20260228.01.sp.platform-file-isolation/) | Active | Design and implement a session-root architecture where platform files (skills, inputs) are physically isolated outside the workspace root directory, with a managed symlink bridge for agent access. This ensures no workspace source type (git_repo, local_path, empty) has platform files polluting the user's project. |
