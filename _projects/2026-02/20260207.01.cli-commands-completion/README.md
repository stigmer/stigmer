# Project: 20260207.01.cli-commands-completion

## Overview
Complete and standardize CLI commands for all five resource types (Agent, Workflow, Skill, MCP Server, Project), ensuring command parity across resources.

**Created**: 2026-02-07
**Status**: Active 🟢

## Project Information

### Primary Goal
Ensure all five resource types have consistent command coverage with apply/get/list/delete/validate at minimum. Add missing commands: Skill get/list/delete, MCP Server validate/search/list, Project list.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Go/Cobra CLI

### Project Type
Feature Development

### Affected Components
client-apps/cli/cmd/stigmer/root/, client-apps/cli/internal/cli/

## Project Context

### Dependencies
None identified

### Success Criteria
- All resources have consistent command coverage. Commands follow existing patterns. Build passes with no lint errors.

### Known Risks & Mitigations
Need to ensure backend APIs exist for list/search operations. Some commands may need backend work first.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## CLI Command Coverage Analysis

**Analyzed**: 2026-02-07

| Resource | apply | validate | get | list | search | delete | run/push |
|----------|-------|----------|-----|------|--------|--------|----------|
| **Agent** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ run |
| **Workflow** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ run |
| **Skill** | - | - | ❌ | ❌ | - | ❌ | ✅ push |
| **MCP Server** | ✅ | ❌ | ✅ | ⚠️ stub | ❌ | ✅ | - |
| **Project** | - | ✅ | ✅ | ❌ | - | ✅ | - |

### Identified Gaps (6 total)

1. **Skill get** - `skill_get.go`
2. **Skill list** - `skill_list.go`
3. **Skill delete** - `skill_delete.go`
4. **MCP Server validate** - `mcpserver_validate.go`
5. **MCP Server list** - Complete implementation (currently stub)
6. **Project list** - `project_list.go`

Optional: MCP Server search (depends on backend API)

## Current Status

### Active Task
**T01**: Gap Analysis & Design - **PENDING REVIEW**

See [tasks/T01_0_plan.md](tasks/T01_0_plan.md) for detailed analysis.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Initial analysis complete (CLI command coverage matrix)
- [ ] T01 Review & Approval
- [ ] T02 Skill commands (get/list/delete)
- [ ] T03 MCP Server commands (validate/list)
- [ ] T04 Project list command
- [ ] T05 Integration testing & documentation
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