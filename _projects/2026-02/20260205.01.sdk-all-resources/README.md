# Project: 20260205.01.sdk-all-resources

## Overview
Extend Stigmer SDK to support all resources (Agent, Workflow, Skill, MCP Server) with Project as aggregate root for reconciliation

**Created**: 2026-02-05
**Status**: Active 🟢

## Project Information

### Primary Goal
SDK becomes the Universal Definition Language where all resources can be defined, synthesized, and reconciled via Project entity

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
Go SDK, Proto definitions, Code generation

### Project Type
Feature Development

### Affected Components
sdk/go, apis/agentic/project, tools/codegen

## Project Context

### Dependencies
Existing Project backend (controller, reconciliation engine already complete)

### Success Criteria
- SDK can define Project with embedded Agent
- Workflow
- Skill
- MCP Server; synthesis outputs project.pb; CLI reads and applies via Project Apply API

### Known Risks & Mitigations
Backward compatibility with existing agent/workflow synthesis; skill artifact resolution complexity

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