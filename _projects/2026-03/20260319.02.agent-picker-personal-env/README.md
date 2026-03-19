# Project: 20260319.02.agent-picker-personal-env

## Overview
Add AgentPicker component to SessionComposer with automatic personal environment and agent instance management. Users pick an agent from the toolbar, env vars are collected inline on first use, and personal environments store secrets server-side. The agent only receives env vars it declared in its env_spec (least-privilege filtering).

**Created**: 2026-03-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable seamless agent selection in the session composer with automatic personal environment creation, inline env var collection, env_spec whitelist filtering in the backend merge logic, and GitHub token migration from localStorage to server-side personal environment.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
TypeScript/React, Go (backend env merge), Protobuf, OpenFGA

### Project Type
Feature Development

### Affected Components
sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Project Context

### Dependencies
Existing agent, environment, agent_instance CRUD APIs and search service

### Success Criteria
- User can pick an agent in the composer toolbar
- Env vars are collected inline on first use and stored in personal Environment server-side
- Agent execution only receives env vars declared in agent env_spec
- GitHub token migrated from localStorage to personal Environment
- Personal resources identified via stigmer.ai/personal label

### Known Risks & Mitigations
Backend env merge filtering change affects all execution paths and must be backward-compatible, GitHub token migration from localStorage could break existing sessions if not handled gracefully, Label-based queries may need backend search service changes

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
| env-auth-and-secret-redaction | [20260319.03.sp.env-auth-and-secret-redaction](../20260319.03.sp.env-auth-and-secret-redaction/) | Active | Update FGA authorization model to support personal environments (member-level creation permissions) and implement secret value redaction in environment queries with owner-only secret retrieval. |
