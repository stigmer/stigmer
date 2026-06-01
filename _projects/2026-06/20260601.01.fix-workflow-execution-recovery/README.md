# Project: 20260601.01.fix-workflow-execution-recovery

## Overview
Fix the workflow execution recovery flow so that clicking Recover on a failed workflow properly resumes execution from the failed task, preserving completed work and continuing from the failure point.

**Created**: 2026-06-01
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement proper task-level resume on recovery: skip completed tasks (using persisted outputs from event log), resume from the failed task, fix the event pipeline sequence collision so progress is visible, and fix Cursor agent resume error classification.

### Timeline
**Target Completion**: 1 week

### Technology Stack
TypeScript (TS runner/workflow engine), Java (stigmer-cloud service), Go (stigmer-server OSS), React (SDK event stream hooks)

### Project Type
Bug Fix

### Affected Components
TS workflow runner (do-executor, workflow-event-activities, engine-core, execute-cursor), Java cloud service (WorkflowExecutionRecoverHandler), Go OSS service (recover.go, lifecycle_steps.go), React SDK (useWorkflowExecutionEventStream), Integration tests

## Project Context

### Dependencies
Cursor SDK behavior (Agent.resume for dead agents is external), Temporal workflow infrastructure, Production MongoDB for manual testing

### Success Criteria
- 1) Clicking Recover on a failed multi-task workflow skips completed tasks and resumes from the failed task. 2) Event pipeline delivers new-run events correctly (sequence continuation). 3) Cursor agent resume works or gracefully falls back to fresh with session memory. 4) UI shows recovery progress (task_skipped for completed tasks
- task_started for resumed task). 5) Integration tests verify the full pipeline.

### Known Risks & Mitigations
1) Cursor SDK Agent.resume behavior for dead agents is external and not fully controllable. 2) Task-level skip changes the TS engine execution model (do-executor) which is core infrastructure. 3) Event sequence changes affect all workflow executions not just recovery. 4) OSS/Cloud parity required for all handler changes.

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