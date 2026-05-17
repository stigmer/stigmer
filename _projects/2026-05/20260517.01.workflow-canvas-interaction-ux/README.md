# Project: 20260517.01.workflow-canvas-interaction-ux

## Overview
Add production-grade node interaction UX to the visual workflow canvas editor — on-node delete buttons, quick-add '+' buttons with task pickers, right-click context menus, and floating toolbars on selection.

**Created**: 2026-05-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Fix the fundamental UX gaps in the canvas editor so users can add, delete, duplicate, and manipulate nodes directly on the canvas, matching the interaction standards of editors like n8n, Retool, and ComfyUI.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
TypeScript/React, @xyflow/react v12, @stigmer/react SDK, Tailwind CSS, dagre

### Project Type
Feature Development

### Affected Components
sdk/react/src/workflow/ (CanvasTaskNode, CanvasTransitionEdge, WorkflowCanvasInner, WorkflowCanvasEditor, WorkflowInspectorPanel, useWorkflowCanvas, CanvasActionsContext)

## Project Context

### Dependencies
Deep research report at _projects/2026-05/20260508.01.bring-workflows-to-foreground/research.visual-canvas-editor-ux/04.report.gpt.md

### Success Criteria
- 1) Users can delete nodes via a visible icon on the node card (hover or selection). 2) Users can add nodes via '+' on nodes and edges with a task-type picker. 3) Right-click context menu on nodes with Delete
- Duplicate
- Copy actions. 4) Floating NodeToolbar on selection. 5) All actions go through the existing command/history pattern for undo/redo. 6) Performance remains smooth with 50+ nodes.

### Known Risks & Mitigations
1) Performance: rendering action buttons on every node must use CSS hover, not React state. 2) Maintaining undo/redo correctness — all new actions must dispatch through GraphCommand. 3) Task picker popover positioning near canvas edges/viewport boundaries. 4) Touch/mobile support is secondary but should not break.

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