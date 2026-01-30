# Project: 20260130.03.hitl-approval-flow

## Overview
Human-in-the-loop approval system for agent tool execution with proper integration into existing ToolCall proto and sub-agent architecture

**Created**: 2026-01-30
**Status**: Active 🟢

## Project Information

### Primary Goal
Design and implement a clean approval system that handles direct agent, workflow-to-agent, and sub-agent execution contexts with proper state management

### Timeline
**Target Completion**: TBD after design review - potentially 2-3 weeks for core implementation

### Technology Stack
Protocol Buffers (API contracts), Python/LangGraph (interrupt/resume), Go/Temporal (workflow signals), Java (gRPC handlers)

### Project Type
Feature Development

### Affected Components
apis/ai/stigmer/agentic/agentexecution - ToolCall approval fields, backend/services/agent-runner - LangGraph interrupt handling, stigmer-cloud/backend - Approval signal handlers

## Project Context

### Dependencies
LangGraph interrupt/resume research required, Phase 2 streaming improvements complete, Sub-agent tracking implemented

### Success Criteria
- Tool-level approval working for direct agent calls
- Workflow-to-agent approval propagation
- Sub-agent approval propagation
- Clean integration with existing ToolCall proto
- No separate approval system - unified with execution model

### Known Risks & Mitigations
LangGraph checkpoint mechanics unknown, Sub-agent nesting complexity, State persistence across approval wait times, Race conditions in approval delivery

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

### Why a Fresh Project?

A previous HITL project existed in `stigmer-cloud` (`20260118.01.hitl-approval-multi-layer`), but this is a fresh design because:

1. **Phase 2 streaming work added sub-agents** - The old design didn't account for Agent → Sub-Agent → Tool nesting
2. **ToolCall proto should be extended** - Not creating parallel `ApprovalRequirement` structures
3. **Simpler is better** - Removing unnecessary complexity (double approval, etc.)
4. **Different AI model** - Using OPUS 4.5 which allows for more critical architectural thinking

### Key Architectural Principles

1. **Integrate, don't duplicate** - Approval is part of ToolCall, not beside it
2. **Bubble up, flow down** - Approvals surface at execution boundary, decisions flow to blocked tool
3. **Sub-agents are first-class** - Not an afterthought
4. **No premature complexity** - Start with tool-level approval, add task-level only if needed

### Related Projects

- `20260130.02.agent-execution-streaming-improvements` - Phase 2 work (completed), added sub-agent tracking
- `stigmer-cloud/20260118.01.hitl-approval-multi-layer` - Previous attempt (reference only)